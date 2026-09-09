import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenActions, median, normalizeRow, pickResult } from "./normalize.ts";
import type { InsightRow } from "./meta-types.ts";

/** Linha real da conta 841618581984716 — o criativo caro. */
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
