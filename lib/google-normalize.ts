/**
 * Lógica pura da integração com Google Ads: sem rede, sem `server-only`.
 * Separada de google.ts para rodar em `node --test`, como normalize.ts.
 *
 * A API devolve os campos em camelCase, int64 como string e double como
 * número. Dinheiro vem em micros (1 BRL = 1.000.000) e taxas como fração
 * (0,05 = 5%), enquanto a Meta manda ctr em pontos percentuais. O painel segue
 * a convenção da Meta, então tudo é convertido aqui.
 */
import type { Creative, Row } from "./meta-types";

export type GoogleRow = {
  customer?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string };
  customerClient?: {
    id?: string;
    descriptiveName?: string;
    manager?: boolean;
    level?: string | number;
    status?: string;
  };
  campaign?: { id?: string; name?: string; advertisingChannelType?: string; status?: string };
  adGroup?: { id?: string; name?: string; status?: string };
  adGroupAd?: {
    status?: string;
    ad?: {
      id?: string;
      name?: string;
      type?: string;
      finalUrls?: string[];
      responsiveSearchAd?: { headlines?: { text?: string }[] };
      imageAd?: { imageUrl?: string };
    };
  };
  segments?: {
    date?: string;
    week?: string;
    month?: string;
    adNetworkType?: string;
    device?: string;
  };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    ctr?: string | number;
    averageCpc?: string | number;
    averageCpm?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
    videoViews?: string | number;
    videoQuartileP25Rate?: string | number;
    videoQuartileP50Rate?: string | number;
    videoQuartileP75Rate?: string | number;
    videoQuartileP100Rate?: string | number;
  };
};

/** Sem importar normalize.ts: o test runner do Node exigiria a extensão .ts no import. */
const n = (v: string | number | undefined): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const micros = (v: string | number | undefined) => n(v) / 1e6;

/** Nível do painel → recurso GAQL. "adset" da Meta é "ad_group" no Google. */
export const RESOURCE: Record<Row["level"], string> = {
  account: "customer",
  campaign: "campaign",
  adset: "ad_group",
  ad: "ad_group_ad",
};

export const METRIC_FIELDS = [
  "metrics.cost_micros",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.ctr",
  "metrics.average_cpc",
  "metrics.average_cpm",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.video_views",
  "metrics.video_quartile_p25_rate",
  "metrics.video_quartile_p50_rate",
  "metrics.video_quartile_p75_rate",
  "metrics.video_quartile_p100_rate",
];

export const LEVEL_FIELDS: Record<Row["level"], string[]> = {
  account: ["customer.id"],
  campaign: ["campaign.id", "campaign.name", "campaign.advertising_channel_type", "campaign.status"],
  adset: ["ad_group.id", "ad_group.name", "campaign.name", "campaign.advertising_channel_type"],
  ad: [
    "ad_group_ad.ad.id",
    "ad_group_ad.ad.name",
    "ad_group_ad.ad.type",
    "ad_group_ad.ad.final_urls",
    "ad_group_ad.ad.responsive_search_ad.headlines",
    "ad_group_ad.ad.image_ad.image_url",
    "ad_group_ad.status",
    "ad_group.name",
    "campaign.name",
    "campaign.advertising_channel_type",
  ],
};

/** Anúncio do Google raramente tem nome; o primeiro título é o que o Gerenciador mostra. */
export function adDisplayName(ad: NonNullable<GoogleRow["adGroupAd"]>["ad"]): string {
  if (!ad) return "";
  return (
    ad.name?.trim() ||
    ad.responsiveSearchAd?.headlines?.find((h) => h.text?.trim())?.text?.trim() ||
    `${(ad.type ?? "AD").replace(/_/g, " ").toLowerCase()} ${ad.id ?? ""}`.trim()
  );
}

export function normalizeGoogleRow(row: GoogleRow, level: Row["level"]): Row {
  const m = row.metrics ?? {};
  const spend = micros(m.costMicros);
  const impressions = n(m.impressions);
  const clicks = n(m.clicks);
  const ctr = n(m.ctr) * 100;
  const conversions = n(m.conversions);
  const value = n(m.conversionsValue);
  const views = n(m.videoViews);

  const id =
    level === "ad"
      ? (row.adGroupAd?.ad?.id ?? "")
      : level === "adset"
        ? (row.adGroup?.id ?? "")
        : level === "campaign"
          ? (row.campaign?.id ?? "")
          : (row.customer?.id ?? "account");

  const name =
    level === "ad"
      ? adDisplayName(row.adGroupAd?.ad) || id
      : level === "adset"
        ? (row.adGroup?.name ?? id)
        : level === "campaign"
          ? (row.campaign?.name ?? id)
          : "Conta";

  // Quartis vêm como fração das impressões; o painel mostra fração das
  // reproduções, como na Meta. views/impressões cancela a base.
  const quart = (rate: string | number | undefined) =>
    views > 0 ? Math.min(1, (n(rate) * impressions) / views) : 0;
  const video =
    views > 0
      ? {
          videoPlays: views,
          hookRate: impressions > 0 ? views / impressions : null,
          holdRate: quart(m.videoQuartileP100Rate),
          retention: {
            p25: quart(m.videoQuartileP25Rate),
            p50: quart(m.videoQuartileP50Rate),
            p75: quart(m.videoQuartileP75Rate),
            p100: quart(m.videoQuartileP100Rate),
          },
        }
      : { videoPlays: null, hookRate: null, holdRate: null, retention: null };

  return {
    id,
    name,
    level,
    campaignName: row.campaign?.name,
    adsetName: row.adGroup?.name,
    objective: row.campaign?.advertisingChannelType,

    spend,
    impressions,
    // Google Ads não expõe alcance nem frequência em relatórios padrão.
    reach: 0,
    frequency: 0,
    clicks,
    linkClicks: clicks,
    ctr,
    linkCtr: ctr,
    cpc: micros(m.averageCpc),
    cpm: micros(m.averageCpm),
    cpp: 0,

    // "Conversões" é a coluna homônima do Google Ads: só as ações marcadas
    // para entrar nela, não all_conversions.
    results: conversions,
    resultLabel: "Conversões",
    costPerResult: conversions > 0 ? spend / conversions : null,
    roas: value > 0 && spend > 0 ? value / spend : null,
    revenue: value > 0 ? value : null,
    ...video,

    actions: conversions > 0 ? { conversions } : {},
    costPerAction: conversions > 0 ? { conversions: spend / conversions } : {},
  };
}

/** A prévia sai da própria linha do anúncio: não há segunda chamada. */
export function creativeFromRow(row: GoogleRow): Creative | null {
  const ad = row.adGroupAd?.ad;
  if (!ad?.id) return null;
  const image = ad.imageAd?.imageUrl ?? null;
  return {
    adId: ad.id,
    name: adDisplayName(ad),
    status: row.adGroupAd?.status ?? "UNKNOWN",
    thumbnailUrl: image,
    coverUrl: image,
    permalink: ad.finalUrls?.[0] ?? null,
    isVideo: /VIDEO/.test(ad.type ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

const DAY = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (date: string, days: number) => iso(new Date(Date.parse(date) + days * DAY));
const utc = (y: number, m: number, d: number) => iso(new Date(Date.UTC(y, m, d)));

/**
 * Traduz os presets da Meta em datas absolutas para o `segments.date BETWEEN`.
 * O GAQL tem `DURING LAST_7_DAYS` e afins, mas não cobre todos os presets do
 * seletor; calcular tudo aqui é uma regra só. `today` é o dia no fuso da
 * conta — quem chama resolve isso, aqui é aritmética pura.
 *
 * Como na Meta, "últimos N dias" termina ontem.
 */
export function presetRange(preset: string, today: string): { since: string; until: string } {
  const [y, m] = today.split("-").map(Number);
  const month = m - 1;
  const dow = new Date(Date.parse(today)).getUTCDay(); // 0 = domingo
  const quarter = Math.floor(month / 3) * 3;
  const lastDays = (days: number) => ({ since: shift(today, -days), until: shift(today, -1) });

  switch (preset) {
    case "today":
      return { since: today, until: today };
    case "yesterday":
      return lastDays(1);
    case "last_3d":
      return lastDays(3);
    case "last_7d":
      return lastDays(7);
    case "last_14d":
      return lastDays(14);
    case "last_28d":
      return lastDays(28);
    case "last_90d":
      return lastDays(90);
    case "this_month":
      return { since: utc(y, month, 1), until: today };
    case "last_month":
      return { since: utc(y, month - 1, 1), until: utc(y, month, 0) };
    case "this_quarter":
      return { since: utc(y, quarter, 1), until: today };
    case "last_quarter":
      return { since: utc(y, quarter - 3, 1), until: utc(y, quarter, 0) };
    case "this_year":
      return { since: utc(y, 0, 1), until: today };
    case "last_year":
      return { since: utc(y - 1, 0, 1), until: utc(y - 1, 11, 31) };
    case "this_week_mon_today":
      return { since: shift(today, -((dow + 6) % 7)), until: today };
    case "this_week_sun_today":
      return { since: shift(today, -dow), until: today };
    case "last_week_mon_sun": {
      const monday = shift(today, -((dow + 6) % 7) - 7);
      return { since: monday, until: shift(monday, 6) };
    }
    case "last_week_sun_sat": {
      const sunday = shift(today, -dow - 7);
      return { since: sunday, until: shift(sunday, 6) };
    }
    case "maximum":
      // ponytail: o Google não tem "desde sempre"; uma data anterior a qualquer
      // conta em operação faz o mesmo papel.
      return { since: "2010-01-01", until: today };
    default:
      return lastDays(30);
  }
}

/** Data de hoje (YYYY-MM-DD) no fuso da conta, que é o calendário dos relatórios. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // Fuso desconhecido: UTC é o erro menor.
    return iso(now);
  }
}

/** Sanitiza o que entra num literal GAQL. Só ids numéricos e datas chegam aqui, mas custa nada. */
export const literal = (value: string) => `'${value.replace(/[^\w\- :.]/g, "")}'`;
