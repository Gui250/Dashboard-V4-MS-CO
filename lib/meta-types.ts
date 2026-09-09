/** Formas cruas devolvidas pela Graph API. Todo numérico vem como string. */

export type ActionStat = {
  action_type: string;
  value: string;
};

export type InsightRow = {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  objective?: string;

  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  unique_clicks?: string;
  ctr?: string;
  inline_link_click_ctr?: string;
  unique_ctr?: string;
  cpc?: string;
  cpm?: string;
  cpp?: string;

  actions?: ActionStat[];
  action_values?: ActionStat[];
  cost_per_action_type?: ActionStat[];
  purchase_roas?: ActionStat[];
  website_purchase_roas?: ActionStat[];

  video_play_actions?: ActionStat[];
  video_p25_watched_actions?: ActionStat[];
  video_p50_watched_actions?: ActionStat[];
  video_p75_watched_actions?: ActionStat[];
  video_p100_watched_actions?: ActionStat[];
  video_avg_time_watched_actions?: ActionStat[];

  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;

  publisher_platform?: string;
  platform_position?: string;
};

export type RawAd = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    thumbnail_url?: string;
    image_url?: string;
    effective_object_story_id?: string;
    instagram_permalink_url?: string;
  };
};

/** Forma normalizada que o cliente consome. Números são números. */
export type Row = {
  id: string;
  name: string;
  level: "account" | "campaign" | "adset" | "ad";
  campaignName?: string;
  adsetName?: string;
  objective?: string;

  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  linkClicks: number;
  ctr: number;
  linkCtr: number;
  cpc: number;
  cpm: number;
  cpp: number;

  /** Resultado adequado ao objetivo, escolhido em pickResult(). */
  results: number | null;
  resultLabel: string | null;
  costPerResult: number | null;
  roas: number | null;
  revenue: number | null;

  /** Métricas de vídeo — null quando o criativo não é vídeo. */
  videoPlays: number | null;
  hookRate: number | null;
  holdRate: number | null;

  quality?: string;
  engagementRank?: string;
  conversionRank?: string;

  actions: Record<string, number>;
  costPerAction: Record<string, number>;
};

export type Creative = {
  adId: string;
  name: string;
  status: string;
  thumbnailUrl: string | null;
  permalink: string | null;
};

export type SeriesPoint = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  results: number | null;
  costPerResult: number | null;
};

export type PlatformSlice = {
  platform: string;
  position: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
};

export type Payload = {
  account: { id: string; name: string; currency: string; timezone: string };
  period: { since: string; until: string; preset: string | null };
  totals: Row;
  series: SeriesPoint[];
  rows: Row[];
  ads: Row[];
  creatives: Creative[];
  platforms: PlatformSlice[];
  /** Mediana do custo por resultado entre os anúncios — base do índice de eficiência. */
  medianCostPerResult: number | null;
  fetchedAt: string;
  stale: boolean;
  warnings: string[];
};
