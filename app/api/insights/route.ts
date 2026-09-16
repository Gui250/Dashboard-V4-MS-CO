import { NextResponse } from "next/server";
import {
  getAccountMeta,
  getCreatives,
  getInsights,
  getPlatforms,
  getSeries,
  resolveAccounts,
  median,
  MetaError,
  type AdAccount,
  type Granularity,
  type Query,
} from "@/lib/meta";
import {
  getGoogleAccountMeta,
  getGoogleCreatives,
  getGoogleInsights,
  getGooglePlatforms,
  getGoogleSeries,
  googlePeriod,
  GoogleError,
  resolveGoogleAccounts,
} from "@/lib/google";
import type { Payload, Row } from "@/lib/meta-types";

const LEVELS = ["campaign", "adset", "ad"] as const;

/** https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/ */
const PRESETS = new Set([
  "today", "yesterday", "this_month", "last_month", "this_quarter", "last_quarter",
  "this_year", "last_year", "this_week_mon_today", "this_week_sun_today",
  "last_week_mon_sun", "last_week_sun_sat", "last_3d", "last_7d", "last_14d",
  "last_28d", "last_30d", "last_90d", "maximum",
]);

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(request: Request) {
  const [metaAccounts, googleAccounts] = await Promise.all([
    resolveAccounts(),
    resolveGoogleAccounts(),
  ]);
  if (!metaAccounts.length && !googleAccounts.length) {
    return NextResponse.json(
      { error: "Nenhuma conta configurada. Abra Configurar acesso.", fatal: true },
      { status: 500 },
    );
  }

  const params = new URL(request.url).searchParams;

  // Fronteira de confiança: o id de conta vem da URL, mas o token é nosso.
  // Só contas da allowlist podem ser consultadas — e a lista diz a origem.
  const requested = params.get("account");
  const metaHit = metaAccounts.find((a) => a.id === requested);
  const googleHit = googleAccounts.find((a) => a.id === requested);
  const { source, account }: { source: Payload["source"]; account: AdAccount } = metaHit
    ? { source: "meta", account: metaHit }
    : googleHit
      ? { source: "google", account: googleHit }
      : metaAccounts[0]
        ? { source: "meta", account: metaAccounts[0] }
        : { source: "google", account: googleAccounts[0] };

  const levelParam = params.get("level");
  const level = (LEVELS as readonly string[]).includes(levelParam ?? "")
    ? (levelParam as Row["level"])
    : "campaign";

  const since = params.get("since");
  const until = params.get("until");
  const presetParam = params.get("preset");
  const custom = isDate(since) && isDate(until) && since <= until;
  const preset = custom ? undefined : PRESETS.has(presetParam ?? "") ? presetParam! : "last_30d";

  const statusParam = params.get("status");
  const status = (["active", "paused"] as const).find((s) => s === statusParam) ?? "all";

  const granularityParam = params.get("granularity");
  const granularity: Granularity =
    (["day", "week", "month"] as const).find((g) => g === granularityParam) ?? "day";

  const query: Query = {
    accountId: account.id,
    status,
    granularity,
    since: custom ? since : undefined,
    until: custom ? until : undefined,
    preset,
    level,
  };

  try {
    const payload =
      source === "google"
        ? await googlePayload(query, account)
        : await metaPayload(query, account);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof MetaError || error instanceof GoogleError) {
      return NextResponse.json(
        { error: error.message, code: error.code, fatal: error.fatal },
        // Token morto pede ação sua; rate limit some sozinho.
        { status: error.fatal ? 401 : 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao consultar a API.", fatal: false },
      { status: 502 },
    );
  }
}

const emptyRow = (account: AdAccount): Row => ({
  id: account.id, name: account.name, level: "account",
  spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, linkClicks: 0,
  ctr: 0, linkCtr: 0, cpc: 0, cpm: 0, cpp: 0,
  results: null, resultLabel: null, costPerResult: null, roas: null, revenue: null,
  videoPlays: null, hookRate: null, holdRate: null, retention: null,
  actions: {}, costPerAction: {},
});

async function metaPayload(query: Query, account: AdAccount): Promise<Payload> {
  const { level, since, until, preset } = query;
  // Paralelo, não em batch: a doc é explícita que cada sub-requisição de um
  // batch conta separadamente para a cota, então batch só pouparia round-trips.
  // Quem realmente corta chamadas é o cache do Next em lib/meta.ts.
  const [meta, totalsRows, { points: series, conversionLabel }, adRows, levelRows, platforms] =
    await Promise.all([
      getAccountMeta(account.id),
      getInsights(query, "account"),
      getSeries(query),
      getInsights(query, "ad"),
      level === "ad" ? Promise.resolve(null) : getInsights(query, level),
      // Breakdown é enriquecimento, não o painel: falha sozinho em vez de
      // derrubar a tela inteira.
      getPlatforms(query).catch(() => null),
    ]);

  // Depende dos anúncios: só buscamos miniatura de quem entregou no período.
  // Listar a conta inteira estoura o limite de dados da Graph API em contas
  // com centenas de anúncios acumulados.
  const creatives = await getCreatives(
    [...adRows].sort((a, b) => b.spend - a.spend).map((row) => row.id),
  ).catch(() => null);

  const warnings: string[] = [];
  const rows = levelRows ?? adRows;

  if (creatives === null) {
    warnings.push(
      "Miniaturas indisponíveis: o System User precisa da conta de anúncios como ativo com permissão de leitura.",
    );
  }
  if (platforms === null) {
    warnings.push("Divisão por plataforma indisponível neste período.");
  }

  if (!adRows.some((row) => row.roas !== null)) {
    warnings.push(
      "ROAS indisponível: nenhuma campanha desta conta tem evento de compra no pixel.",
    );
  }

  let totals = totalsRows[0] ?? emptyRow(account);
  if (conversionLabel) {
    // A linha da conta escolhe um tipo de ação só; a soma por campanha é o total real.
    const results = series.reduce((sum, point) => sum + (point.results ?? 0), 0);
    totals = {
      ...totals,
      results,
      resultLabel: conversionLabel,
      costPerResult: results > 0 ? totals.spend / results : null,
    };
  }

  return {
    source: "meta",
    account: {
      id: account.id,
      name: meta.name || account.name,
      currency: meta.currency ?? "BRL",
      timezone: meta.timezone_name ?? "America/Sao_Paulo",
    },
    period: {
      since: since ?? (series[0]?.date ?? ""),
      until: until ?? (series.at(-1)?.date ?? ""),
      preset: preset ?? null,
    },
    totals,
    series,
    rows,
    ads: adRows,
    creatives: creatives ?? [],
    platforms: platforms ?? [],
    medianCostPerResult: median(
      adRows.map((row) => row.costPerResult ?? 0).filter((v) => v > 0),
    ),
    fetchedAt: new Date().toISOString(),
    stale: false,
    warnings,
  };
}

/**
 * Mesmo Payload, vindo do Google Ads. A conta não tem o problema da Meta com
 * `objective`: a linha de `customer` já soma as conversões de todas as campanhas.
 */
async function googlePayload(query: Query, account: AdAccount): Promise<Payload> {
  const { level, preset } = query;
  const [meta, period, totalsRows, series, adRows, levelRows, platforms, creatives] =
    await Promise.all([
      getGoogleAccountMeta(account.id),
      googlePeriod(query),
      getGoogleInsights(query, "account"),
      getGoogleSeries(query),
      getGoogleInsights(query, "ad"),
      level === "ad" ? Promise.resolve(null) : getGoogleInsights(query, level),
      getGooglePlatforms(query).catch(() => null),
      // Sai da mesma consulta dos anúncios; se aquela passou, esta passa.
      getGoogleCreatives(query).catch(() => []),
    ]);

  const warnings: string[] = [];
  if (platforms === null) warnings.push("Divisão por rede e dispositivo indisponível neste período.");
  if (!adRows.some((row) => row.roas !== null)) {
    warnings.push(
      "ROAS indisponível: nenhuma conversão do período tem valor configurado no Google Ads.",
    );
  }
  if (adRows.length && !creatives.some((c) => c.coverUrl)) {
    warnings.push(
      "Anúncios de pesquisa não têm prévia de imagem: a pista de criativos mostra só a posição e o título.",
    );
  }

  return {
    source: "google",
    account: {
      id: account.id,
      name: meta.name || account.name,
      currency: meta.currency,
      timezone: meta.timezone,
    },
    period: { ...period, preset: preset ?? null },
    totals: totalsRows[0] ?? emptyRow(account),
    series,
    rows: levelRows ?? adRows,
    ads: adRows,
    creatives,
    platforms: platforms ?? [],
    medianCostPerResult: median(
      adRows.map((row) => row.costPerResult ?? 0).filter((v) => v > 0),
    ),
    fetchedAt: new Date().toISOString(),
    stale: false,
    warnings,
  };
}
