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
import { conversionsByDate, flattenActions, normalizeRow, num } from "./normalize";
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
  granularity?: Granularity;
};

export type Granularity = "day" | "week" | "month";

/**
 * time_increment aceita 1..90 (dias) ou "monthly".
 * https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/
 */
const TIME_INCREMENT: Record<Granularity, string> = {
  day: "1",
  week: "7",
  month: "monthly",
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

/**
 * Série diária da conta. `conversionLabel` vem preenchido quando alguma campanha
 * converte: aí `results` de cada balde é a soma por campanha (ver
 * conversionsByDate) e o total da conta deve ser a soma dos baldes.
 */
export async function getSeries(
  q: Query,
): Promise<{ points: SeriesPoint[]; conversionLabel: string | null }> {
  const common = {
    time_increment: TIME_INCREMENT[q.granularity ?? "day"],
    limit: "500",
    ...timeParams(q.since, q.until, q.preset),
  };
  const [rows, campaignRows] = await Promise.all([
    fetchAll<InsightRow>(`act_${q.accountId}/insights`, {
      level: "account",
      fields: BASE_FIELDS.join(","),
      ...common,
    }),
    // A linha da conta vem sem `objective`; o resultado só se decide por campanha.
    fetchAll<InsightRow>(`act_${q.accountId}/insights`, {
      level: "campaign",
      fields: "campaign_id,objective,actions",
      ...common,
    }),
  ]);

  const conversions = conversionsByDate(
    campaignRows.map((raw) => ({
      campaignId: raw.campaign_id ?? "",
      date: raw.date_start ?? "",
      objective: raw.objective,
      actions: flattenActions(raw.actions),
    })),
  );

  const points = rows
    .map((raw) => {
      const row = normalizeRow(raw, "account");
      const results = conversions
        ? (conversions.byDate.get(raw.date_start ?? "") ?? 0)
        : row.results;
      const costPerResult = conversions
        ? results ? row.spend / results : null
        : row.costPerResult;
      return {
        date: raw.date_start ?? "",
        spend: row.spend,
        impressions: row.impressions,
        reach: row.reach,
        // A Meta calcula frequência por balde; somar entre baldes seria errado,
        // então ela vem pronta da API e nunca é agregada aqui.
        frequency: row.frequency,
        clicks: row.clicks,
        linkClicks: row.linkClicks,
        ctr: row.ctr,
        cpc: row.cpc,
        cpm: row.cpm,
        results,
        costPerResult,
      };
    })
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { points, conversionLabel: conversions?.label ?? null };
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

const CREATIVE_FIELDS =
  "id,name,effective_status,creative{id,thumbnail_url,image_url,instagram_permalink_url,effective_instagram_media_id}";

/** Teto de operações por batch na Graph API. */
const BATCH_MAX = 50;

/**
 * Só buscamos miniatura dos anúncios que mais gastaram: a pista fica ilegível
 * muito antes disso, e cada anúncio custa uma sub-requisição.
 */
const CREATIVE_LIMIT = 100;

const CREATIVE_TTL_MS = 60 * 60 * 1000;
/**
 * ponytail: cache em memória do processo. Teto: não é compartilhado entre
 * instâncias e some no restart. Se um dia houver mais de um servidor, troque
 * por cache do Next ou Redis — hoje é um processo só e criativo muda de mês em mês.
 */
const creativeCache = new Map<string, { at: number; value: Creative }>();

type BatchReply = { code?: number; body?: string };

/**
 * Buscar miniaturas listando `/act_<id>/ads` não escala: contas com algumas
 * centenas de anúncios acumulados devolvem erro 1 ("Please reduce the amount of
 * data you're asking for") mesmo com limit=100, porque a expansão `creative{}`
 * é aplicada à conta inteira. Só ~60 desses anúncios entregam no período.
 *
 * Então pedimos anúncio a anúncio, em lotes: `POST /?batch=[...]` contorna a
 * edge pesada. (`?ids=` faria o mesmo, mas foi descontinuado na v26.0.)
 *
 * thumbnail_url sai em 64px sem `thumbnail_width`/`thumbnail_height`, e é URL
 * de CDN assinada que caduca em horas — nunca persista, sempre trate onError.
 */
export async function getCreatives(adIds: string[]): Promise<Creative[]> {
  const now = Date.now();
  const wanted = adIds.slice(0, CREATIVE_LIMIT);
  const found: Creative[] = [];
  const missing: string[] = [];

  for (const id of wanted) {
    const hit = creativeCache.get(id);
    if (hit && now - hit.at < CREATIVE_TTL_MS) found.push(hit.value);
    else missing.push(id);
  }
  if (!missing.length) return found;

  const accessToken = token();
  const proof = appSecretProof(accessToken);
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += BATCH_MAX) {
    chunks.push(missing.slice(i, i + BATCH_MAX));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const body = new URLSearchParams({
        batch: JSON.stringify(
          chunk.map((id) => ({
            method: "GET",
            relative_url: `${id}?fields=${encodeURIComponent(CREATIVE_FIELDS)}&thumbnail_width=600&thumbnail_height=600`,
          })),
        ),
        include_headers: "false",
        access_token: accessToken,
      });
      if (proof) body.set("appsecret_proof", proof);

      const res = await fetch(`${graphBase()}/`, {
        method: "POST",
        body,
        cache: "no-store",
      });
      if (!res.ok) return [];
      const replies = (await res.json().catch(() => null)) as BatchReply[] | null;
      if (!Array.isArray(replies)) return [];

      return replies.flatMap((reply) => {
        if (reply?.code !== 200 || !reply.body) return [];
        try {
          const ad = JSON.parse(reply.body) as RawAd;
          return ad?.id ? [ad] : [];
        } catch {
          // Uma sub-resposta quebrada não invalida as outras 49.
          return [];
        }
      });
    }),
  );

  const ads = results.flat();
  const covers = await resolveCovers(ads);

  for (const ad of ads) {
    const media = covers.get(ad.creative?.effective_instagram_media_id ?? "");
    const creative: Creative = {
      adId: ad.id,
      name: ad.name ?? ad.id,
      status: ad.effective_status ?? "UNKNOWN",
      thumbnailUrl: ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? null,
      // Sem mídia acessível, a capa cai para o thumbnail de 64px: pequeno,
      // mas melhor que um buraco.
      coverUrl:
        media?.url ??
        ad.creative?.image_url ??
        ad.creative?.thumbnail_url ??
        null,
      permalink: ad.creative?.instagram_permalink_url ?? null,
      isVideo: media?.isVideo ?? false,
    };
    creativeCache.set(ad.id, { at: now, value: creative });
    found.push(creative);
  }

  return found;
}

/**
 * `thumbnail_url` do AdCreative sai em 64×64 e ignora `thumbnail_width` —
 * testado, os parâmetros não têm efeito. A imagem em resolução real está na
 * mídia do Instagram por trás do anúncio: até 1080×1920.
 *
 * Para VIDEO o campo certo é `thumbnail_url` (o poster em alta), não
 * `media_url`, que é o MP4 de vários megabytes.
 *
 * Anúncios antigos podem não expor a mídia ("Unsupported get request"); nesse
 * caso o chamador cai no thumbnail pequeno.
 */
async function resolveCovers(
  ads: RawAd[],
): Promise<Map<string, { url: string; isVideo: boolean }>> {
  const out = new Map<string, { url: string; isVideo: boolean }>();
  const mediaIds = [
    ...new Set(
      ads
        .map((ad) => ad.creative?.effective_instagram_media_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!mediaIds.length) return out;

  const accessToken = token();
  const proof = appSecretProof(accessToken);
  const chunks: string[][] = [];
  for (let i = 0; i < mediaIds.length; i += BATCH_MAX) {
    chunks.push(mediaIds.slice(i, i + BATCH_MAX));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const body = new URLSearchParams({
        batch: JSON.stringify(
          chunk.map((id) => ({
            method: "GET",
            relative_url: `${id}?fields=media_type,media_url,thumbnail_url`,
          })),
        ),
        include_headers: "false",
        access_token: accessToken,
      });
      if (proof) body.set("appsecret_proof", proof);

      const res = await fetch(`${graphBase()}/`, {
        method: "POST",
        body,
        cache: "no-store",
      });
      if (!res.ok) return;
      const replies = (await res.json().catch(() => null)) as BatchReply[] | null;
      if (!Array.isArray(replies)) return;

      replies.forEach((reply, index) => {
        if (reply?.code !== 200 || !reply.body) return;
        try {
          const media = JSON.parse(reply.body) as {
            media_type?: string;
            media_url?: string;
            thumbnail_url?: string;
          };
          const isVideo = media.media_type === "VIDEO";
          const url = isVideo ? media.thumbnail_url : media.media_url;
          if (url) out.set(chunk[index], { url, isVideo });
        } catch {
          // Uma mídia inacessível não invalida as outras.
        }
      });
    }),
  );

  return out;
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

// ---------------------------------------------------------------------------
// Validação de credencial (usada pela tela de configuração)
// ---------------------------------------------------------------------------

export type TokenLife = {
  /** ISO da expiração, ou null quando o token não expira. */
  expiresAt: string | null;
  /** USER, PAGE, SYSTEM_USER… — diz se veio do lugar certo. */
  type: string | null;
  scopes: string[];
};

export type TokenCheck =
  | { ok: true; accounts: StoredAccount[]; discovered: boolean; life: TokenLife }
  | { ok: false; message: string; code?: number };

/**
 * Um token de System User não expira; um User token do Graph API Explorer dura
 * uma ou duas horas. Os dois são aceitos pela API e não há como distinguir
 * olhando a string — só perguntando. Perguntar na hora de colar transforma uma
 * falha silenciosa daqui a duas horas em informação agora.
 *
 * `/debug_token` aceita o próprio token como credencial de consulta.
 * `expires_at: 0` significa "não expira".
 */
async function inspectToken(
  accessToken: string,
  apiVersion: string,
): Promise<TokenLife> {
  const empty: TokenLife = { expiresAt: null, type: null, scopes: [] };
  try {
    const query = new URLSearchParams({
      input_token: accessToken,
      access_token: accessToken,
    });
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/debug_token?${query}`,
      { cache: "no-store" },
    );
    if (!response.ok) return empty;
    const body = (await response.json()) as {
      data?: { expires_at?: number; type?: string; scopes?: string[] };
    };
    const expires = body.data?.expires_at ?? 0;
    return {
      expiresAt: expires > 0 ? new Date(expires * 1000).toISOString() : null,
      type: body.data?.type ?? null,
      scopes: body.data?.scopes ?? [],
    };
  } catch {
    // Diagnóstico é bônus: nunca deve impedir o token válido de ser salvo.
    return empty;
  }
}

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
    data?: { account_id?: string; name?: string }[];
    error?: { message?: string; code?: number; error_user_msg?: string };
  };

  if (!response.ok || body.error) {
    const code = body.error?.code;
    const message =
      code === 190
        ? "Token expirado, inválido ou revogado. Se você gerou pelo Graph API Explorer, aquele token dura só algumas horas — gere um de System User em business.facebook.com/settings e deixe DESMARCADA a caixa de 60 dias."
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

  return {
    ok: true,
    accounts: discovered,
    discovered: discovered.length > 0,
    life: await inspectToken(accessToken, apiVersion),
  };
}
