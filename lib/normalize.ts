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

/** action_type que conta como resultado para este objetivo, ou null. */
function resultKey(objective: string | undefined, actions: Record<string, number>) {
  const candidates = [
    ...(RESULT_CANDIDATES[objective ?? ""] ?? []),
    ...RESULT_FALLBACK,
  ];
  return candidates.find((key) => actions[key] !== undefined) ?? null;
}

export function pickResult(
  objective: string | undefined,
  actions: Record<string, number>,
  costPerAction: Record<string, number>,
) {
  const key = resultKey(objective, actions);
  if (!key) return { results: null, resultLabel: null, costPerResult: null };
  return {
    results: actions[key],
    resultLabel: RESULT_LABELS[key] ?? key,
    costPerResult: costPerAction[key] ?? null,
  };
}

/** Resultado de campanha de tráfego ou engajamento — não é conversão. */
const NOT_CONVERSION = new Set([
  "link_click",
  "landing_page_view",
  "post_engagement",
  "page_engagement",
]);

export type CampaignBucket = {
  campaignId: string;
  date: string;
  objective?: string;
  actions: Record<string, number>;
};

/**
 * A linha da conta vem sem `objective` — a Meta só o devolve por campanha —,
 * então pickResult() nela escolhe UM action_type pela ordem do fallback. Numa
 * conta que mistura formulário e WhatsApp, o total mostrava só os leads.
 *
 * Conversões da conta = soma do resultado de cada campanha, escolhido pelo
 * objetivo dela, que é como o Gerenciador conta. Tráfego e engajamento ficam de
 * fora: clique não é conversão.
 *
 * O tipo de cada campanha é escolhido no período inteiro e aplicado a todos os
 * baldes. Escolher por balde faria uma campanha de formulário contar conversas
 * nos dias sem lead. Contagem de ação soma entre dias (reach é que não soma).
 *
 * null quando nenhuma campanha do período converte: aí vale o pickResult().
 */
export function conversionsByDate(buckets: CampaignBucket[]) {
  const period = new Map<string, { objective?: string; actions: Record<string, number> }>();
  for (const b of buckets) {
    const campaign = period.get(b.campaignId) ?? { objective: b.objective, actions: {} };
    for (const [type, n] of Object.entries(b.actions)) {
      campaign.actions[type] = (campaign.actions[type] ?? 0) + n;
    }
    period.set(b.campaignId, campaign);
  }

  const keys = new Map<string, string>();
  for (const [id, campaign] of period) {
    const key = resultKey(campaign.objective, campaign.actions);
    if (key && !NOT_CONVERSION.has(key)) keys.set(id, key);
  }
  if (!keys.size) return null;

  const byDate = new Map<string, number>();
  for (const b of buckets) {
    const key = keys.get(b.campaignId);
    byDate.set(b.date, (byDate.get(b.date) ?? 0) + (key ? (b.actions[key] ?? 0) : 0));
  }

  // Um tipo só mantém o nome dele ("Leads"); tipos misturados viram "Conversões".
  const labels = new Set([...keys.values()].map((key) => RESULT_LABELS[key] ?? key));
  return {
    label: labels.size === 1 ? [...labels][0] : "Conversões",
    byDate,
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
    return { videoPlays: null, hookRate: null, holdRate: null, retention: null };
  }
  const completions = firstValue(row.video_p100_watched_actions) ?? 0;
  return {
    videoPlays: plays,
    hookRate: impressions > 0 ? plays / impressions : null,
    holdRate: plays > 0 ? completions / plays : null,
    // Retenção: cada marco como fração das reproduções iniciadas — não das
    // impressões. Dividir por impressões misturaria quem nunca deu play.
    retention: {
      p25: (firstValue(row.video_p25_watched_actions) ?? 0) / plays,
      p50: (firstValue(row.video_p50_watched_actions) ?? 0) / plays,
      p75: (firstValue(row.video_p75_watched_actions) ?? 0) / plays,
      p100: completions / plays,
    },
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


// ---------------------------------------------------------------------------
// Decomposição do custo por resultado
// ---------------------------------------------------------------------------

export type FactorKey = "cpm" | "ctr" | "conversion";

export type CostFactor = {
  key: FactorKey;
  /** Valor do criativo neste fator. */
  value: number;
  /**
   * Quantas vezes PIOR que a mediana da conta. Sempre na mesma direção,
   * qualquer que seja o fator: >1 encarece, <1 barateia. null = sem base.
   */
  ratio: number | null;
};

/** Resultados por clique. É o elo que a Meta não entrega pronto. */
export function conversionRate(clicks: number, results: number | null): number | null {
  if (!clicks || results === null) return null;
  return results / clicks;
}

/**
 * Custo por resultado não é caixa-preta — é identidade:
 *
 *     custo/resultado = (CPM / 1000) ÷ CTR ÷ taxa de conversão
 *
 * porque (custo/impressão) ÷ (cliques/impressão) ÷ (resultados/clique)
 * cancela tudo e sobra custo/resultado.
 *
 * Todo real de custo vem, então, de um de três lugares: a entrega está cara,
 * o criativo não arranca clique, ou o clique não converte. Comparar cada fator
 * com a mediana da conta aponta qual dos três é o culpado — que é a pergunta
 * que alguém faz ao clicar num criativo caro.
 *
 * `ratio` é normalizado para que >1 signifique "pior" nos três: em CPM o valor
 * alto encarece, em CTR e conversão é o valor baixo que encarece.
 */
export function costFactors(
  row: Pick<Row, "cpm" | "ctr" | "clicks" | "results">,
  medians: { cpm: number | null; ctr: number | null; conversion: number | null },
): CostFactor[] {
  const conversion = conversionRate(row.clicks, row.results);
  const safe = (a: number | null, b: number | null) =>
    a !== null && b !== null && a > 0 && b > 0 ? b / a : null;

  return [
    // Mais alto encarece.
    { key: "cpm", value: row.cpm, ratio: safe(medians.cpm, row.cpm) },
    // Mais baixo encarece: a razão inverte.
    { key: "ctr", value: row.ctr, ratio: safe(row.ctr, medians.ctr) },
    {
      key: "conversion",
      value: conversion ?? 0,
      ratio: safe(conversion, medians.conversion),
    },
  ];
}

/** Medianas da conta, base de comparação dos fatores. */
export function accountFactorMedians(
  rows: Pick<Row, "cpm" | "ctr" | "clicks" | "results">[],
) {
  return {
    cpm: median(rows.map((r) => r.cpm)),
    ctr: median(rows.map((r) => r.ctr)),
    conversion: median(
      rows
        .map((r) => conversionRate(r.clicks, r.results))
        .filter((v): v is number => v !== null),
    ),
  };
}
