import "server-only";
import { createHmac } from "node:crypto";
import type {
  Creative,
  InsightRow,
  PlatformSlice,
  RawAd,
  Row,
  SeriesPoint,
} from "./meta-types";
import { normalizeRow, num } from "./normalize";
import { getCredentials, type StoredAccount } from "./credentials";

export { flattenActions, median, normalizeRow, pickResult, RESULT_LABELS } from "./normalize";

const graphBase = () => `https://graph.facebook.com/${getCredentials().apiVersion}`;

/**
 * A Meta recalcula insights a cada ~15 min e não muda mais depois de 28 dias.
 * O painel pulsa de 2 em 2 minutos, mas o cache do Next absorve a maioria dos
 * ticks — só ~1 em cada 3 chega à Graph API.
 * https://developers.facebook.com/docs/marketing-api/insights/best-practices/
 */
const REVALIDATE = 300;
/** Criativos mudam raramente. Uma hora é folgado e economiza cota. */
const REVALIDATE_CREATIVES = 3600;

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code: number,
    /** Token morto/permissão faltando é fatal; rate limit é temporário. */
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

export type AdAccount = StoredAccount;

export function accounts(): AdAccount[] {
  return getCredentials().accounts;
}

export function hasToken(): boolean {
  return Boolean(getCredentials().accessToken);
}

function token(): string {
  const { accessToken } = getCredentials();
  if (!accessToken) {
    throw new MetaError(
      "Token da Meta não configurado. Abra Configurar acesso e cole o token do System User.",
      0,
      true,
    );
  }
  return accessToken;
}

/** Exigido quando o app tem "Require App Secret" ligado, e boa prática sempre. */
function appSecretProof(accessToken: string, secret = getCredentials().appSecret) {
  if (!secret) return null;
  return createHmac("sha256", secret).update(accessToken).digest("hex");
}

/** Rate limit (4/17/613/80004) é temporário; OAuth (190/102/200) é fatal. */
const FATAL_CODES = new Set([10, 102, 190, 200, 294]);

async function metaFetch<T>(
  path: string,
  params: Record<string, string | undefined>,
  revalidate = REVALIDATE,
): Promise<T> {
  const accessToken = token();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  query.set("access_token", accessToken);
  const proof = appSecretProof(accessToken);
  if (proof) query.set("appsecret_proof", proof);

  const res = await fetch(`${graphBase()}/${path}?${query}`, {
    next: { revalidate, tags: ["meta"] },
  });

  if (!res.ok) {
    let code = res.status;
    let message = `Graph API respondeu ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { message?: string; code?: number; error_user_msg?: string };
      };
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.error_user_msg || body.error.message || message;
      }
    } catch {
      // corpo não-JSON: fica a mensagem de status
    }
    throw new MetaError(message, code, FATAL_CODES.has(code));
  }

  return (await res.json()) as T;
}

/** Segue paging.next até acabar. Para por data vazia — paging.next mente às vezes. */
async function fetchAll<T>(
  path: string,
  params: Record<string, string | undefined>,
  revalidate = REVALIDATE,
): Promise<T[]> {
  const out: T[] = [];
  let page = await metaFetch<{ data: T[]; paging?: { next?: string } }>(
    path,
    params,
    revalidate,
  );
  out.push(...(page.data ?? []));

  let guard = 0;
  while (page.paging?.next && page.data?.length && guard++ < 20) {
    const res = await fetch(page.paging.next, { next: { revalidate, tags: ["meta"] } });
    if (!res.ok) break;
    page = (await res.json()) as { data: T[]; paging?: { next?: string } };
    out.push(...(page.data ?? []));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Campos pedidos à API
// ---------------------------------------------------------------------------

const BASE_FIELDS = [
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "inline_link_click_ctr",
  "cpc",
  "cpm",
  "cpp",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
  "website_purchase_roas",
  "objective",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
];

const LEVEL_FIELDS: Record<Row["level"], string[]> = {
  account: [],
  campaign: ["campaign_id", "campaign_name"],
  adset: ["adset_id", "adset_name", "campaign_name"],
  // Rankings só existem no nível de anúncio.
  ad: [
    "ad_id",
    "ad_name",
    "adset_name",
    "campaign_name",
    "quality_ranking",
    "engagement_rate_ranking",
    "conversion_rate_ranking",
  ],
};

function timeParams(since?: string, until?: string, preset?: string) {
  // time_range tem precedência sobre date_preset — mandar os dois é erro.
  if (since && until) {
    return { time_range: JSON.stringify({ since, until }) };
  }
  return { date_preset: preset || "last_30d" };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export type Query = {
  accountId: string;
  since?: string;
  until?: string;
  preset?: string;
  level: Row["level"];
  status?: "all" | "active" | "paused";
};

/**
 * Insights só devolve entidades que tiveram entrega no período — uma campanha
 * pausada há meses já não aparece. Este filtro serve para o caso de quem gastou
 * ontem e foi pausado hoje.
 */
function statusFilter(level: Row["level"], status: Query["status"]) {
  if (!status || status === "all" || level === "account") return undefined;
  const value = status === "active" ? ["ACTIVE"] : ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"];
  return JSON.stringify([
    { field: `${level}.effective_status`, operator: "IN", value },
  ]);
}

export async function getAccountMeta(accountId: string) {
  return metaFetch<{
    name?: string;
    currency?: string;
    timezone_name?: string;
  }>(`act_${accountId}`, { fields: "name,currency,timezone_name" }, REVALIDATE_CREATIVES);
}

export async function getInsights(q: Query, level: Row["level"]): Promise<Row[]> {
  const rows = await fetchAll<InsightRow>(`act_${q.accountId}/insights`, {
    level: level === "account" ? "account" : level,
    fields: [...BASE_FIELDS, ...LEVEL_FIELDS[level]].join(","),
    limit: "500",
    filtering: statusFilter(level, q.status),
    ...timeParams(q.since, q.until, q.preset),
  });
  return rows.map((row) => normalizeRow(row, level));
}

export async function getSeries(q: Query): Promise<SeriesPoint[]> {
  const rows = await fetchAll<InsightRow>(`act_${q.accountId}/insights`, {
    level: "account",
    fields: BASE_FIELDS.join(","),
    time_increment: "1",
    limit: "500",
    ...timeParams(q.since, q.until, q.preset),
  });

  return rows
    .map((raw) => {
      const row = normalizeRow(raw, "account");
      return {
        date: raw.date_start ?? "",
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        linkClicks: row.linkClicks,
        ctr: row.ctr,
        cpc: row.cpc,
        cpm: row.cpm,
        results: row.results,
        costPerResult: row.costPerResult,
      };
    })
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * publisher_platform + platform_position é uma combinação permitida.
 * impression_device passou a exigir opt-in em 06/08/2026 e pode voltar vazio
 * sem erro, então fica de fora.
 */
export async function getPlatforms(q: Query): Promise<PlatformSlice[]> {
  const rows = await fetchAll<InsightRow>(`act_${q.accountId}/insights`, {
    level: "account",
    fields: "spend,impressions,clicks,ctr,cpm",
    breakdowns: "publisher_platform,platform_position",
    limit: "500",
    ...timeParams(q.since, q.until, q.preset),
  });

  return rows
    .map((row) => ({
      platform: row.publisher_platform ?? "desconhecido",
      position: row.platform_position ?? "desconhecido",
      spend: num(row.spend),
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      ctr: num(row.ctr),
      cpm: num(row.cpm),
    }))
    .filter((slice) => slice.impressions > 0)
    .sort((a, b) => b.spend - a.spend);
}

/**
 * thumbnail_url sai em 64px se não pedir tamanho — inútil num card.
 * Posts de Instagram impulsionados não têm image_url nem object_story_spec,
 * só thumbnail_url e effective_object_story_id.
 */
export async function getCreatives(accountId: string): Promise<Creative[]> {
  const ads = await fetchAll<RawAd>(
    `act_${accountId}/ads`,
    {
      fields:
        "id,name,effective_status,creative{id,thumbnail_url,image_url,instagram_permalink_url}",
      thumbnail_width: "600",
      thumbnail_height: "600",
      limit: "500",
    },
    REVALIDATE_CREATIVES,
  );

  return ads.map((ad) => ({
    adId: ad.id,
    name: ad.name ?? ad.id,
    status: ad.effective_status ?? "UNKNOWN",
    thumbnailUrl: ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? null,
    permalink: ad.creative?.instagram_permalink_url ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Validação de credencial (usada pela tela de configuração)
// ---------------------------------------------------------------------------

export type TokenCheck =
  | { ok: true; accounts: StoredAccount[]; discovered: boolean }
  | { ok: false; message: string; code?: number };

/**
 * Testa um token candidato ANTES de gravar, e de quebra descobre as contas que
 * ele enxerga — assim ninguém precisa digitar id de conta na mão.
 *
 * Usa fetch direto, sem cache e sem as credenciais salvas: o objetivo é
 * justamente validar uma credencial que ainda não é a vigente.
 */
export async function verifyToken(
  accessToken: string,
  appSecret: string,
  apiVersion: string,
): Promise<TokenCheck> {
  const query = new URLSearchParams({
    access_token: accessToken,
    fields: "account_id,name,currency,account_status",
    limit: "200",
  });
  if (appSecret) {
    query.set(
      "appsecret_proof",
      createHmac("sha256", appSecret).update(accessToken).digest("hex"),
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${apiVersion}/me/adaccounts?${query}`,
      { cache: "no-store" },
    );
  } catch {
    return { ok: false, message: "Não foi possível falar com a Meta. Verifique a conexão." };
  }

  const body = (await response.json().catch(() => ({}))) as {
    data?: { account_id?: string; name?: string; account_status?: number }[];
    error?: { message?: string; code?: number; error_user_msg?: string };
  };

  if (!response.ok || body.error) {
    const code = body.error?.code;
    // 190 é token inválido; 200/10 é permissão faltando no System User.
    const message =
      code === 190
        ? "Token inválido ou revogado pela Meta. Gere um novo no Business Manager."
        : code === 200 || code === 10
          ? "O token é válido, mas falta a permissão ads_read ou o acesso às contas de anúncio."
          : (body.error?.error_user_msg ??
            body.error?.message ??
            `A Meta respondeu ${response.status}.`);
    return { ok: false, message, code };
  }

  const discovered = (body.data ?? [])
    .filter((account) => account.account_id)
    .map((account) => ({
      id: account.account_id!,
      name: account.name?.trim() || account.account_id!,
    }));

  return { ok: true, accounts: discovered, discovered: discovered.length > 0 };
}

/**
 * Lista de contas do seletor, com descoberta automática.
 *
 * Num deploy é comum definir só `META_ACCESS_TOKEN` e esquecer
 * `META_AD_ACCOUNTS`. Sem isto o painel ficaria preso: sem contas ele cai na
 * tela de conexão, que está travada pelo ambiente e não consegue gravar em
 * disco somente leitura. O token já dá acesso à lista — então busque.
 */
export async function resolveAccounts(): Promise<AdAccount[]> {
  const configured = accounts();
  if (configured.length || !hasToken()) return configured;

  try {
    const { data } = await metaFetch<{
      data?: { account_id?: string; name?: string }[];
    }>(
      "me/adaccounts",
      { fields: "account_id,name", limit: "200" },
      REVALIDATE_CREATIVES,
    );
    return (data ?? [])
      .filter((account) => account.account_id)
      .map((account) => ({
        id: account.account_id!,
        name: account.name?.trim() || account.account_id!,
      }));
  } catch {
    // Token inválido ou sem permissão: a tela de conexão explica o problema.
    return [];
  }
}
