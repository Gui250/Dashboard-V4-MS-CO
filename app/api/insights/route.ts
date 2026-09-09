import { NextResponse } from "next/server";
import {
  accounts,
  getAccountMeta,
  getCreatives,
  getInsights,
  getPlatforms,
  getSeries,
  median,
  MetaError,
  type Query,
} from "@/lib/meta";
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
  const allowed = accounts();
  if (!allowed.length) {
    return NextResponse.json(
      { error: "Nenhuma conta configurada. Defina META_AD_ACCOUNTS no .env.local.", fatal: true },
      { status: 500 },
    );
  }

  const params = new URL(request.url).searchParams;

  // Fronteira de confiança: o id de conta vem da URL, mas o token é nosso.
  // Só contas da allowlist podem ser consultadas.
  const requested = params.get("account");
  const account = allowed.find((a) => a.id === requested) ?? allowed[0];

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

  const query: Query = {
    accountId: account.id,
    status,
    since: custom ? since : undefined,
    until: custom ? until : undefined,
    preset,
    level,
  };

  try {
    // Paralelo, não em batch: a doc é explícita que cada sub-requisição de um
    // batch conta separadamente para a cota, então batch só pouparia round-trips.
    // Quem realmente corta chamadas é o cache do Next em lib/meta.ts.
    const [meta, totalsRows, series, adRows, levelRows, creatives, platforms] =
      await Promise.all([
        getAccountMeta(account.id),
        getInsights(query, "account"),
        getSeries(query),
        getInsights(query, "ad"),
        level === "ad" ? Promise.resolve(null) : getInsights(query, level),
        // Miniaturas e breakdown são enriquecimento, não o painel. Pedem
        // permissões de ativo diferentes das de insights, então falham sozinhos
        // em vez de derrubar a tela inteira.
        getCreatives(account.id).catch(() => null),
        getPlatforms(query).catch(() => null),
      ]);

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

    const empty: Row = {
      id: account.id, name: account.name, level: "account",
      spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, linkClicks: 0,
      ctr: 0, linkCtr: 0, cpc: 0, cpm: 0, cpp: 0,
      results: null, resultLabel: null, costPerResult: null, roas: null, revenue: null,
      videoPlays: null, hookRate: null, holdRate: null,
      actions: {}, costPerAction: {},
    };

    const payload: Payload = {
      account: {
        id: account.id,
        name: meta.name || account.name,
        currency: meta.currency ?? "BRL",
        timezone: meta.timezone_name ?? "America/Sao_Paulo",
      },
      period: {
        since: custom ? since! : (series[0]?.date ?? ""),
        until: custom ? until! : (series.at(-1)?.date ?? ""),
        preset: preset ?? null,
      },
      totals: totalsRows[0] ?? empty,
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

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof MetaError) {
      return NextResponse.json(
        { error: error.message, code: error.code, fatal: error.fatal },
        // Token morto pede ação sua; rate limit some sozinho.
        { status: error.fatal ? 401 : 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao consultar a Meta.", fatal: false },
      { status: 502 },
    );
  }
}
