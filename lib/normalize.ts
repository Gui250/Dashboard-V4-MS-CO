/**
 * Lógica pura de normalização: sem rede, sem `server-only`, sem estado.
 * Fica separada de meta.ts justamente para rodar em `node --test`.
 */
import type { ActionStat, InsightRow, Row } from "./meta-types";

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export const num = (v: string | undefined | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `actions` volta como [{action_type, value, 1d_click, 7d_click, ...}].
 * `value` já é a soma da janela de atribuição padrão — somar as janelas
 * individuais duplicaria a contagem, porque elas são cumulativas.
 */
export function flattenActions(stats?: ActionStat[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stat of stats ?? []) {
    if (!stat?.action_type) continue;
    const n = Number(stat.value);
    if (Number.isFinite(n)) out[stat.action_type] = n;
  }
  return out;
}

/** Primeira chave presente na lista de candidatos. */
function firstOf(
  map: Record<string, number>,
  candidates: readonly string[],
): { key: string; value: number } | null {
  for (const key of candidates) {
    if (map[key] !== undefined) return { key, value: map[key] };
  }
  return null;
}

/**
 * O "resultado" muda conforme o objetivo da campanha — é a mesma lógica que a
 * coluna Resultados do Gerenciador aplica. Ordem = preferência.
 */
const RESULT_CANDIDATES: Record<string, readonly string[]> = {
  OUTCOME_LEADS: [
    "onsite_conversion.lead_grouped",
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.messaging_conversation_started_7d",
  ],
  LEAD_GENERATION: ["onsite_conversion.lead_grouped", "lead"],
  OUTCOME_SALES: [
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "purchase",
    "onsite_conversion.messaging_conversation_started_7d",
    "offsite_conversion.fb_pixel_initiate_checkout",
  ],
  CONVERSIONS: ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"],
  OUTCOME_ENGAGEMENT: [
    "onsite_conversion.messaging_conversation_started_7d",
    "post_engagement",
    "page_engagement",
  ],
  POST_ENGAGEMENT: ["post_engagement"],
  OUTCOME_TRAFFIC: ["landing_page_view", "link_click"],
  LINK_CLICKS: ["link_click", "landing_page_view"],
  OUTCOME_AWARENESS: ["reach"],
  OUTCOME_APP_PROMOTION: ["omni_app_install", "mobile_app_install"],
};

/** Usado quando o objetivo é desconhecido ou nenhum candidato apareceu. */
const RESULT_FALLBACK = [
  "onsite_conversion.lead_grouped",
  "lead",
  "omni_purchase",
  "onsite_conversion.messaging_conversation_started_7d",
  "landing_page_view",
  "link_click",
  "post_engagement",
] as const;

export const RESULT_LABELS: Record<string, string> = {
  "onsite_conversion.lead_grouped": "Leads",
  lead: "Leads",
  "offsite_conversion.fb_pixel_lead": "Leads (pixel)",
  "onsite_conversion.messaging_conversation_started_7d": "Conversas iniciadas",
  omni_purchase: "Compras",
  "offsite_conversion.fb_pixel_purchase": "Compras (pixel)",
  purchase: "Compras",
  "offsite_conversion.fb_pixel_initiate_checkout": "Checkouts iniciados",
  post_engagement: "Engajamento",
  page_engagement: "Engajamento na página",
  landing_page_view: "Visitas à página",
  link_click: "Cliques no link",
  omni_app_install: "Instalações",
  mobile_app_install: "Instalações",
  reach: "Alcance",
};

export function pickResult(
  objective: string | undefined,
  actions: Record<string, number>,
  costPerAction: Record<string, number>,
) {
  const candidates = [
    ...(RESULT_CANDIDATES[objective ?? ""] ?? []),
    ...RESULT_FALLBACK,
  ];
  const hit = firstOf(actions, candidates);
  if (!hit) return { results: null, resultLabel: null, costPerResult: null };
  return {
    results: hit.value,
    resultLabel: RESULT_LABELS[hit.key] ?? hit.key,
    costPerResult: costPerAction[hit.key] ?? null,
  };
}

/** Vem como array de ActionStat mesmo sendo um número só. Vazio sem pixel de compra. */
function firstValue(stats?: ActionStat[]): number | null {
  const n = Number(stats?.[0]?.value);
  return Number.isFinite(n) ? n : null;
}

function videoMetrics(row: InsightRow, impressions: number) {
  const plays = firstValue(row.video_play_actions);
  if (plays === null || plays === 0) {
    return { videoPlays: null, hookRate: null, holdRate: null };
  }
  const completions = firstValue(row.video_p100_watched_actions) ?? 0;
  return {
    videoPlays: plays,
    hookRate: impressions > 0 ? plays / impressions : null,
    holdRate: plays > 0 ? completions / plays : null,
  };
}

export function normalizeRow(row: InsightRow, level: Row["level"]): Row {
  const actions = flattenActions(row.actions);
  const costPerAction = flattenActions(row.cost_per_action_type);
  const values = flattenActions(row.action_values);
  const impressions = num(row.impressions);

  const id =
    level === "ad"
      ? (row.ad_id ?? "")
      : level === "adset"
        ? (row.adset_id ?? "")
        : level === "campaign"
          ? (row.campaign_id ?? "")
          : (row.account_id ?? "account");

  const name =
    level === "ad"
      ? (row.ad_name ?? id)
      : level === "adset"
        ? (row.adset_name ?? id)
        : level === "campaign"
          ? (row.campaign_name ?? id)
          : "Conta";

  const roas =
    firstValue(row.purchase_roas) ?? firstValue(row.website_purchase_roas);
  const revenue =
    values["omni_purchase"] ??
    values["offsite_conversion.fb_pixel_purchase"] ??
    values["purchase"] ??
    null;

  return {
    id,
    name,
    level,
    campaignName: row.campaign_name,
    adsetName: row.adset_name,
    objective: row.objective,

    spend: num(row.spend),
    impressions,
    reach: num(row.reach),
    frequency: num(row.frequency),
    clicks: num(row.clicks),
    linkClicks: num(row.inline_link_clicks),
    ctr: num(row.ctr),
    linkCtr: num(row.inline_link_click_ctr),
    cpc: num(row.cpc),
    cpm: num(row.cpm),
    cpp: num(row.cpp),

    ...pickResult(row.objective, actions, costPerAction),
    roas,
    revenue,
    ...videoMetrics(row, impressions),

    // A Meta devolve UNKNOWN abaixo de 500 impressões — não é zero, é insuficiente.
    quality: row.quality_ranking,
    engagementRank: row.engagement_rate_ranking,
    conversionRank: row.conversion_rate_ranking,

    actions,
    costPerAction,
  };
}

/** Mediana, não média: um criativo de R$157 de CPM arrastaria a média sozinho. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

