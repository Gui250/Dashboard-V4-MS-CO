import "server-only";
import type { Creative, PlatformSlice, Row, SeriesPoint } from "./meta-types";
import type { Query } from "./meta";
import {
  getGoogleCredentials,
  type GoogleCredentials,
  type StoredAccount,
} from "./credentials";
import {
  creativeFromRow,
  LEVEL_FIELDS,
  literal,
  METRIC_FIELDS,
  normalizeGoogleRow,
  presetRange,
  RESOURCE,
  todayIn,
  type GoogleRow,
} from "./google-normalize";

/**
 * Cliente REST da Google Ads API. Toda leitura é um `searchStream` com GAQL:
 * POST, corpo `{query}`, resposta em array de blocos `{results: [...]}`.
 *
 * Mesmo ritmo da Meta: o painel pulsa a cada 2 min e o cache absorve a maioria
 * dos ticks. Como é POST, o cache de dados do Next não entra — a memoização é
 * em processo (ver `memo`).
 */
const REVALIDATE_MS = 300_000;
const REVALIDATE_META_MS = 3_600_000;

type Creds = Omit<GoogleCredentials, "accounts">;

export class GoogleError extends Error {
  constructor(
    message: string,
    /** Enum do erro (DEVELOPER_TOKEN_NOT_APPROVED…) ou status HTTP. */
    readonly code: string | number,
    /** Credencial ruim é fatal; cota e 5xx passam sozinhos. */
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export async function hasGoogle(): Promise<boolean> {
  const c = await getGoogleCredentials();
  return Boolean(c.refreshToken && c.clientId && c.clientSecret && c.developerToken);
}

// ---------------------------------------------------------------------------
// Cache em processo
// ---------------------------------------------------------------------------

/**
 * ponytail: cache em memória do processo, com a promise em voo para que
 * chamadas paralelas ao mesmo dado disparem uma requisição só. Não é
 * compartilhado entre instâncias e some no restart — mesmo teto do cache de
 * criativos em meta.ts; troque por Redis se um dia houver mais de um servidor.
 */
const cache = new Map<string, { until: number; value: Promise<unknown> }>();

function memo<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { until: Date.now() + ttl, value });
  // Erro não fica em cache: o próximo tick tenta de novo.
  value.catch(() => cache.delete(key));
  return value;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Access token dura 1h. Chave = refresh token, então trocar credencial invalida sozinho. */
async function accessToken(c: Pick<Creds, "clientId" | "clientSecret" | "refreshToken">) {
  return memo(`token:${c.clientId}:${c.refreshToken}`, 50 * 60_000, async () => {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: c.refreshToken,
      }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new GoogleError(explainOAuth(body.error, body.error_description), body.error ?? res.status, true);
    }
    return body.access_token;
  });
}

function explainOAuth(error: string | undefined, description: string | undefined) {
  if (error === "invalid_grant") {
    return "O Google recusou o refresh token (invalid_grant): foi revogado ou expirou. Se a tela de consentimento OAuth do projeto está em modo Teste, todo refresh token caduca em 7 dias — publique o app ou autorize de novo em Configurar acesso.";
  }
  if (error === "invalid_client") {
    return "Client ID ou Client Secret incorretos (invalid_client). Confira em console.cloud.google.com → APIs e serviços → Credenciais.";
  }
  return description || error || "Não foi possível obter o access token do Google.";
}

/** Erros que nenhuma insistência resolve; o resto é cota ou instabilidade. */
const EXPLAIN: Record<string, string> = {
  DEVELOPER_TOKEN_NOT_APPROVED:
    "O developer token ainda tem acesso de Teste: só enxerga contas de teste. Peça acesso Básico em ads.google.com → Ferramentas → Centro de API.",
  DEVELOPER_TOKEN_PROHIBITED:
    "Este developer token pertence a outro projeto do Google Cloud. Gere o client OAuth no mesmo projeto ou use o token da MCC dona do client.",
  DEVELOPER_TOKEN_INVALID: "Developer token inválido. Copie de novo do Centro de API do Google Ads.",
  CUSTOMER_NOT_ENABLED: "A conta do Google Ads está cancelada ou ainda não foi ativada.",
  USER_PERMISSION_DENIED:
    "O usuário que autorizou não tem acesso a esta conta. Se ela é gerida por uma MCC, informe o ID da MCC em 'Conta de administrador'.",
  NOT_ADS_USER: "A conta Google que autorizou não tem nenhuma conta do Google Ads.",
  OAUTH_TOKEN_INVALID: "Access token inválido. Autorize de novo.",
  OAUTH_TOKEN_REVOKED: "A autorização foi revogada no Google. Autorize de novo.",
  RESOURCE_EXHAUSTED: "Cota da Google Ads API esgotada por agora. Volta sozinho.",
};

async function parseError(res: Response): Promise<GoogleError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: {
      message?: string;
      status?: string;
      details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[];
    };
  };
  const first = body.error?.details?.flatMap((d) => d.errors ?? [])[0];
  const kind = Object.keys(first?.errorCode ?? {})[0];
  const value = first?.errorCode?.[kind] ?? body.error?.status ?? res.status;
  const temporary =
    res.status === 429 || res.status >= 500 || kind === "quotaError" || kind === "internalError";
  const message =
    EXPLAIN[String(value)] ??
    first?.message ??
    body.error?.message ??
    `Google Ads API respondeu ${res.status}`;
  return new GoogleError(message, value, !temporary);
}

// ---------------------------------------------------------------------------
// GAQL
// ---------------------------------------------------------------------------

async function session(creds?: Creds) {
  const c = creds ?? (await getGoogleCredentials());
  if (!c.refreshToken || !c.clientId || !c.clientSecret || !c.developerToken) {
    throw new GoogleError(
      "Google Ads não configurado. Abra Configurar acesso → Google Ads.",
      0,
      true,
    );
  }
  return {
    base: `https://googleads.googleapis.com/${c.apiVersion}`,
    headers: (login: string) => ({
      "developer-token": c.developerToken,
      ...(login ? { "login-customer-id": login } : {}),
    }),
    token: () => accessToken(c),
    login: c.loginCustomerId,
  };
}

type GaqlOptions = { creds?: Creds; login?: string; ttl?: number };

async function gaql(customerId: string, query: string, o: GaqlOptions = {}): Promise<GoogleRow[]> {
  const s = await session(o.creds);
  const login = o.login ?? s.login;
  const load = async () => {
    const res = await fetch(`${s.base}/customers/${customerId}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        ...s.headers(login),
        authorization: `Bearer ${await s.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
    if (!res.ok) throw await parseError(res);
    const chunks = (await res.json()) as { results?: GoogleRow[] }[];
    return (Array.isArray(chunks) ? chunks : [chunks]).flatMap((c) => c.results ?? []);
  };
  // Verificação de credencial nova nunca lê do cache.
  if (o.creds) return load();
  return memo(`${customerId}|${login}|${query}`, o.ttl ?? REVALIDATE_MS, load);
}

const select = (fields: string[], from: string, where: string[]) =>
  `SELECT ${fields.join(", ")} FROM ${from}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;

export async function getGoogleAccountMeta(customerId: string) {
  const [row] = await gaql(
    customerId,
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer",
    { ttl: REVALIDATE_META_MS },
  );
  return {
    name: row?.customer?.descriptiveName ?? "",
    currency: row?.customer?.currencyCode ?? "BRL",
    timezone: row?.customer?.timeZone ?? "America/Sao_Paulo",
  };
}

/** Datas absolutas do período, no calendário da conta. */
export async function googlePeriod(q: Query): Promise<{ since: string; until: string }> {
  if (q.since && q.until) return { since: q.since, until: q.until };
  const { timezone } = await getGoogleAccountMeta(q.accountId);
  return presetRange(q.preset ?? "last_30d", todayIn(timezone));
}

const STATUS_FIELD: Record<Row["level"], string | null> = {
  account: null,
  campaign: "campaign.status",
  adset: "ad_group.status",
  ad: "ad_group_ad.status",
};

async function where(q: Query, level: Row["level"]) {
  const { since, until } = await googlePeriod(q);
  const clauses = [`segments.date BETWEEN ${literal(since)} AND ${literal(until)}`];
  const field = STATUS_FIELD[level];
  if (field && q.status && q.status !== "all") {
    clauses.push(`${field} = '${q.status === "active" ? "ENABLED" : "PAUSED"}'`);
  }
  // Como o Insights da Meta: só quem entregou no período aparece.
  if (level !== "account") clauses.push("metrics.impressions > 0");
  return clauses;
}

export async function getGoogleInsights(q: Query, level: Row["level"]): Promise<Row[]> {
  const rows = await gaql(
    q.accountId,
    select([...LEVEL_FIELDS[level], ...METRIC_FIELDS], RESOURCE[level], await where(q, level)),
  );
  return rows.map((row) => normalizeGoogleRow(row, level));
}

/** Mesma consulta do nível de anúncio — bate no cache — lida como criativos. */
export async function getGoogleCreatives(q: Query): Promise<Creative[]> {
  const rows = await gaql(
    q.accountId,
    select([...LEVEL_FIELDS.ad, ...METRIC_FIELDS], RESOURCE.ad, await where(q, "ad")),
  );
  return rows.map(creativeFromRow).filter((c): c is Creative => c !== null);
}

const BUCKET = { day: "segments.date", week: "segments.week", month: "segments.month" } as const;

export async function getGoogleSeries(q: Query): Promise<SeriesPoint[]> {
  const bucket = BUCKET[q.granularity ?? "day"];
  const rows = await gaql(
    q.accountId,
    select([bucket, ...METRIC_FIELDS], "customer", await where(q, "account")),
  );
  return rows
    .map((raw) => {
      const row = normalizeGoogleRow(raw, "account");
      const s = raw.segments ?? {};
      return {
        date: s.date ?? s.week ?? s.month ?? "",
        spend: row.spend,
        impressions: row.impressions,
        reach: row.reach,
        frequency: row.frequency,
        clicks: row.clicks,
        linkClicks: row.linkClicks,
        ctr: row.ctr,
        cpc: row.cpc,
        cpm: row.cpm,
        results: row.results,
        costPerResult: row.costPerResult,
      };
    })
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Rede (Pesquisa, Display, YouTube…) × dispositivo faz o papel de plataforma × posicionamento. */
export async function getGooglePlatforms(q: Query): Promise<PlatformSlice[]> {
  const rows = await gaql(
    q.accountId,
    select(
      [
        "segments.ad_network_type",
        "segments.device",
        "metrics.cost_micros",
        "metrics.impressions",
        "metrics.clicks",
        "metrics.ctr",
        "metrics.average_cpm",
      ],
      "customer",
      await where(q, "account"),
    ),
  );
  return rows
    .map((raw) => {
      const row = normalizeGoogleRow(raw, "account");
      return {
        platform: raw.segments?.adNetworkType ?? "UNKNOWN",
        position: raw.segments?.device ?? "UNKNOWN",
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: row.ctr,
        cpm: row.cpm,
      };
    })
    .filter((slice) => slice.impressions > 0)
    .sort((a, b) => b.spend - a.spend);
}

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------

/**
 * `listAccessibleCustomers` devolve só o que o usuário acessa diretamente —
 * inclusive MCCs, que não têm dados próprios. As contas de verdade estão em
 * `customer_client` de cada uma dessas raízes.
 */
async function discover(creds: Creds): Promise<{ accounts: StoredAccount[]; loginCustomerId: string }> {
  const s = await session(creds);
  let roots: string[];
  if (creds.loginCustomerId) {
    roots = [creds.loginCustomerId];
  } else {
    const res = await fetch(`${s.base}/customers:listAccessibleCustomers`, {
      headers: { ...s.headers(""), authorization: `Bearer ${await s.token()}` },
      cache: "no-store",
    });
    if (!res.ok) throw await parseError(res);
    const body = (await res.json()) as { resourceNames?: string[] };
    roots = (body.resourceNames ?? []).map((r) => r.replace("customers/", "")).slice(0, 10);
  }

  const accounts = new Map<string, StoredAccount>();
  let loginCustomerId = creds.loginCustomerId;
  const errors: GoogleError[] = [];

  await Promise.all(
    roots.map(async (root) => {
      try {
        const rows = await gaql(
          root,
          "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.status = 'ENABLED'",
          { creds, login: root },
        );
        for (const row of rows) {
          const c = row.customerClient ?? {};
          if (!c.id) continue;
          // ponytail: a primeira MCC vira o login-customer-id de todas as
          // consultas. Contas em MCCs diferentes pedem um por conta.
          if (c.manager && c.id === root && !loginCustomerId) loginCustomerId = root;
          if (!c.manager) accounts.set(c.id, { id: c.id, name: c.descriptiveName?.trim() || c.id });
        }
      } catch (error) {
        // Uma conta cancelada na lista não invalida as outras.
        if (error instanceof GoogleError) errors.push(error);
      }
    }),
  );

  if (!accounts.size && errors[0]) throw errors[0];
  return { accounts: [...accounts.values()], loginCustomerId };
}

/** Lista do seletor, descobrindo pelo token quando ninguém configurou contas. */
export async function resolveGoogleAccounts(): Promise<StoredAccount[]> {
  const creds = await getGoogleCredentials();
  if (creds.accounts.length || !(await hasGoogle())) return creds.accounts;
  try {
    return (await memo("google:accounts", REVALIDATE_META_MS, () => discover(creds))).accounts;
  } catch {
    // Credencial inválida: a tela de conexão explica.
    return [];
  }
}

export type GoogleCheck =
  | { ok: true; accounts: StoredAccount[]; loginCustomerId: string }
  | { ok: false; message: string; code?: string | number };

/** Testa uma credencial ANTES de gravar e descobre as contas que ela enxerga. */
export async function verifyGoogle(creds: Creds): Promise<GoogleCheck> {
  try {
    return { ok: true, ...(await discover(creds)) };
  } catch (error) {
    if (error instanceof GoogleError) return { ok: false, message: error.message, code: error.code };
    return { ok: false, message: "Não foi possível falar com o Google. Verifique a conexão." };
  }
}
