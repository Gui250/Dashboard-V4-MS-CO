import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conversionRate,
  conversionsByDate,
  costFactors,
  flattenActions,
  median,
  normalizeRow,
  pickResult,
} from "./normalize.ts";
import type { InsightRow } from "./meta-types.ts";

/** Linha real de uma conta em produção — o criativo caro. */
const CARO: InsightRow = {
  ad_id: "120249286563940521",
  ad_name: "Post do Instagram: Comprar o CRM é a parte fácil...",
  objective: "OUTCOME_ENGAGEMENT",
  spend: "221.28",
  impressions: "1403",
  reach: "672",
  frequency: "2.087798",
  clicks: "16",
  inline_link_clicks: "9",
  ctr: "1.14041",
  cpc: "13.83",
  cpm: "157.7192",
  actions: [
    { action_type: "post_engagement", value: "24" },
    { action_type: "link_click", value: "9" },
    { action_type: "post_reaction", value: "12" },
  ],
  cost_per_action_type: [
    { action_type: "post_engagement", value: "9.22" },
    { action_type: "link_click", value: "24.586667" },
  ],
  purchase_roas: [],
};

/** Linha real da conta — o criativo eficiente. */
const BARATO: InsightRow = {
  ad_id: "120248315702690521",
  ad_name: "Post do Instagram: 🚀 Seu negócio local vendendo...",
  objective: "LINK_CLICKS",
  spend: "89.84",
  impressions: "32278",
  reach: "27442",
  clicks: "596",
  inline_link_clicks: "541",
  ctr: "1.846459",
  cpc: "0.150738",
  cpm: "2.783011",
  actions: [
    { action_type: "link_click", value: "541" },
    { action_type: "post_engagement", value: "612" },
    { action_type: "landing_page_view", value: "203" },
  ],
  cost_per_action_type: [
    { action_type: "link_click", value: "0.166063" },
    { action_type: "landing_page_view", value: "0.442562" },
  ],
};

test("achata actions sem somar janelas de atribuição", () => {
  // `value` já é a soma da janela padrão; 1d_click e 7d_click são cumulativos.
  const map = flattenActions([
    { action_type: "link_click", value: "541", "1d_click": "500", "7d_click": "541" },
  ] as never);
  assert.equal(map.link_click, 541, "deve usar `value`, nunca a soma das janelas");
  assert.equal(Object.keys(map).length, 1);
});

test("ignora entradas malformadas em vez de virar NaN", () => {
  const map = flattenActions([
    { action_type: "lead", value: "12" },
    { action_type: "quebrado", value: "n/a" },
    { action_type: "", value: "3" },
  ]);
  assert.equal(map.lead, 12);
  assert.ok(!("quebrado" in map), "valor não-numérico não entra no mapa");
  assert.ok(!("" in map), "action_type vazio não entra no mapa");
});

test("resultado segue o objetivo da campanha", () => {
  // Engajamento com conversa disponível: conversa ganha de post_engagement.
  const mensagens = pickResult(
    "OUTCOME_ENGAGEMENT",
    { "onsite_conversion.messaging_conversation_started_7d": 8, post_engagement: 240 },
    { "onsite_conversion.messaging_conversation_started_7d": 27.66 },
  );
  assert.equal(mensagens.results, 8);
  assert.equal(mensagens.resultLabel, "Conversas iniciadas");
  assert.equal(mensagens.costPerResult, 27.66);

  // Mesmo objetivo, sem conversa: cai para engajamento.
  assert.equal(pickResult("OUTCOME_ENGAGEMENT", { post_engagement: 24 }, {}).results, 24);

  // Tráfego: clique no link, não engajamento (que é sempre maior e enganaria).
  assert.equal(pickResult("LINK_CLICKS", { link_click: 541, post_engagement: 612 }, {}).results, 541);

  // Leads.
  const leads = pickResult("OUTCOME_LEADS", { lead: 14 }, { lead: 31.5 });
  assert.equal(leads.resultLabel, "Leads");
  assert.equal(leads.costPerResult, 31.5);

  // Objetivo desconhecido cai no fallback, não quebra.
  assert.equal(pickResult(undefined, { link_click: 3 }, {}).results, 3);

  // Sem nenhuma ação: null, para a UI mostrar "—" em vez de zero mentiroso.
  assert.deepEqual(pickResult("OUTCOME_SALES", {}, {}), {
    results: null,
    resultLabel: null,
    costPerResult: null,
  });
});

test("normaliza a linha real do criativo caro", () => {
  const row = normalizeRow(CARO, "ad");
  assert.equal(row.id, "120249286563940521");
  assert.equal(row.spend, 221.28, "spend vem como string e precisa virar número");
  assert.equal(row.impressions, 1403);
  assert.equal(row.cpm, 157.7192);
  assert.equal(row.results, 24, "sem conversa, engajamento é o resultado");
  assert.equal(row.costPerResult, 9.22);
  assert.equal(row.roas, null, "purchase_roas vazio vira null, não 0");
  assert.equal(row.videoPlays, null, "criativo estático não tem métrica de vídeo");
});

test("normaliza a linha real do criativo eficiente", () => {
  const row = normalizeRow(BARATO, "ad");
  assert.equal(row.spend, 89.84);
  assert.equal(row.results, 541);
  assert.equal(row.resultLabel, "Cliques no link");
  assert.equal(row.costPerResult, 0.166063);
});

test("campos ausentes viram 0, nunca NaN", () => {
  const row = normalizeRow({ ad_id: "1", ad_name: "vazio" }, "ad");
  for (const key of ["spend", "impressions", "clicks", "cpm", "ctr"] as const) {
    assert.equal(row[key], 0, `${key} deveria ser 0`);
    assert.ok(!Number.isNaN(row[key]));
  }
});

test("hook rate e hold rate a partir das reproduções de vídeo", () => {
  const row = normalizeRow(
    {
      ad_id: "v1",
      ad_name: "vídeo",
      impressions: "2031",
      video_play_actions: [{ action_type: "video_view", value: "406" }],
      video_p25_watched_actions: [{ action_type: "video_view", value: "284" }],
      video_p50_watched_actions: [{ action_type: "video_view", value: "173" }],
      video_p75_watched_actions: [{ action_type: "video_view", value: "112" }],
      video_p100_watched_actions: [{ action_type: "video_view", value: "81" }],
    },
    "ad",
  );
  assert.equal(row.videoPlays, 406);
  assert.ok(Math.abs(row.hookRate! - 406 / 2031) < 1e-9, "hook = plays / impressões");
  assert.ok(Math.abs(row.holdRate! - 81 / 406) < 1e-9, "hold = 100% / plays");

  // Retenção divide por reproduções, não por impressões, e nunca sobe.
  const r = row.retention!;
  assert.ok(Math.abs(r.p25 - 284 / 406) < 1e-9, "p25 = 25% / plays");
  assert.ok(Math.abs(r.p100 - row.holdRate!) < 1e-9, "p100 é o hold rate");
  assert.ok(r.p25 >= r.p50 && r.p50 >= r.p75 && r.p75 >= r.p100, "curva é monotônica");
});

test("sem vídeo não há curva de retenção", () => {
  const row = normalizeRow({ ad_id: "s1", ad_name: "estático", impressions: "900" }, "ad");
  assert.equal(row.retention, null, "estático não tem retenção — nem zero");
});

test("mediana resiste ao outlier que a média não resistiria", () => {
  // Custos por resultado reais da conta, com o de R$24,58 no meio.
  const custos = [0.166, 0.22, 0.25, 0.31, 24.586];
  assert.equal(median(custos), 0.25);
  const media = custos.reduce((a, b) => a + b, 0) / custos.length;
  assert.ok(media > 5, "a média seria arrastada pelo outlier — por isso mediana");

  assert.equal(median([]), null);
  assert.equal(median([0, 0]), null, "zeros não contam como custo válido");
  assert.equal(median([2, 4]), 3, "par: média dos dois centrais");
});

test("custo por resultado se decompõe exatamente nos três fatores", () => {
  // Números redondos para a identidade ficar verificável a olho:
  // 10.000 impressões, 200 cliques (CTR 2%), 20 resultados (conversão 10%),
  // R$100 gastos => CPM R$10, custo por resultado R$5.
  const cpm = 10, ctr = 2, clicks = 200, results = 20;
  const conversion = conversionRate(clicks, results)!;
  assert.equal(conversion, 0.1);

  // (CPM/1000) ÷ CTR ÷ conversão, com CTR em fração.
  const reconstruido = cpm / 1000 / (ctr / 100) / conversion;
  assert.ok(
    Math.abs(reconstruido - 5) < 1e-9,
    `identidade deveria dar R$5,00 e deu ${reconstruido}`,
  );
});

test("ratio dos fatores aponta na mesma direção nos três", () => {
  const medians = { cpm: 10, ctr: 2, conversion: 0.1 };

  // CPM o dobro: valor alto encarece -> pior.
  const caro = costFactors({ cpm: 20, ctr: 2, clicks: 200, results: 20 }, medians);
  assert.equal(caro.find((f) => f.key === "cpm")!.ratio, 2);

  // CTR pela metade: valor baixo encarece -> também deve dar 2, não 0,5.
  const semClique = costFactors({ cpm: 10, ctr: 1, clicks: 100, results: 10 }, medians);
  assert.equal(semClique.find((f) => f.key === "ctr")!.ratio, 2);

  // Conversão pela metade (5%): mesma lógica.
  const semConversao = costFactors({ cpm: 10, ctr: 2, clicks: 200, results: 10 }, medians);
  assert.equal(semConversao.find((f) => f.key === "conversion")!.ratio, 2);
});

test("fatores sem base viram null, nunca Infinity", () => {
  const zerado = costFactors(
    { cpm: 0, ctr: 0, clicks: 0, results: null },
    { cpm: 0, ctr: 0, conversion: null },
  );
  for (const factor of zerado) {
    assert.equal(factor.ratio, null, `${factor.key} deveria ser null`);
    assert.ok(Number.isFinite(factor.value));
  }
  // Sem cliques não há taxa de conversão possível.
  assert.equal(conversionRate(0, 10), null);
  assert.equal(conversionRate(100, null), null);
});

test("conversões da conta somam o resultado de cada campanha", () => {
  // Formato da JC Indenizações: formulário + WhatsApp + reconhecimento.
  const form = "OUTCOME_LEADS";
  const out = conversionsByDate([
    // Formulário: lead no dia 1; no dia 2 só conversa, que não é o resultado dela.
    { campaignId: "form", date: "d1", objective: form, actions: { "onsite_conversion.lead_grouped": 5, lead: 5, "onsite_conversion.messaging_conversation_started_7d": 2 } },
    { campaignId: "form", date: "d2", objective: form, actions: { "onsite_conversion.messaging_conversation_started_7d": 3 } },
    // WhatsApp com objetivo de leads: o resultado é a conversa.
    { campaignId: "zap", date: "d1", objective: form, actions: { "onsite_conversion.messaging_conversation_started_7d": 20 } },
    { campaignId: "zap", date: "d2", objective: form, actions: { "onsite_conversion.messaging_conversation_started_7d": 10 } },
    // Reconhecimento cai em clique no link — não é conversão.
    { campaignId: "recon", date: "d2", objective: "OUTCOME_AWARENESS", actions: { link_click: 40 } },
  ]);
  assert.ok(out);
  assert.equal(out.label, "Conversões", "leads + conversas misturados");
  assert.equal(out.byDate.get("d1"), 25);
  assert.equal(out.byDate.get("d2"), 10, "formulário não conta conversa no dia sem lead");

  // Um tipo só mantém o nome dele.
  assert.equal(
    conversionsByDate([{ campaignId: "a", date: "d1", objective: form, actions: { lead: 3 } }])?.label,
    "Leads",
  );
  // Sem conversão nenhuma: null, e o chamador mantém o pickResult da conta.
  assert.equal(
    conversionsByDate([{ campaignId: "a", date: "d1", objective: "LINK_CLICKS", actions: { link_click: 9 } }]),
    null,
  );
});
