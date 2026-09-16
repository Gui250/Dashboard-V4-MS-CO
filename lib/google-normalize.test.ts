import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adDisplayName,
  creativeFromRow,
  normalizeGoogleRow,
  presetRange,
  type GoogleRow,
} from "./google-normalize.ts";

/** Linha de `ad_group_ad` como a REST API devolve: camelCase, int64 em string. */
const RSA: GoogleRow = {
  campaign: { name: "Pesquisa | Marca", advertisingChannelType: "SEARCH" },
  adGroup: { name: "Marca exata" },
  adGroupAd: {
    status: "ENABLED",
    ad: {
      id: "700000000001",
      type: "RESPONSIVE_SEARCH_AD",
      finalUrls: ["https://exemplo.com.br/"],
      responsiveSearchAd: { headlines: [{ text: "" }, { text: "Agência V4" }] },
    },
  },
  metrics: {
    costMicros: "221280000",
    impressions: "1403",
    clicks: "16",
    ctr: 0.011404,
    averageCpc: "13830000",
    averageCpm: 157719200,
    conversions: 4,
    conversionsValue: 0,
    videoViews: "0",
  },
};

test("normalizeGoogleRow converte micros, fração de CTR e conversões", () => {
  const row = normalizeGoogleRow(RSA, "ad");
  assert.equal(row.id, "700000000001");
  assert.equal(row.name, "Agência V4");
  assert.equal(row.objective, "SEARCH");
  assert.equal(row.spend, 221.28);
  assert.equal(row.impressions, 1403);
  assert.equal(row.clicks, 16);
  assert.ok(Math.abs(row.ctr - 1.1404) < 1e-9);
  assert.equal(row.cpc, 13.83);
  assert.equal(row.cpm, 157.7192);
  assert.equal(row.results, 4);
  assert.equal(row.resultLabel, "Conversões");
  assert.equal(row.costPerResult, 55.32);
  // Sem valor de conversão não há ROAS — "—", não 0.
  assert.equal(row.roas, null);
  assert.equal(row.videoPlays, null);
});

test("vídeo: quartis passam de fração das impressões para fração das reproduções", () => {
  const row = normalizeGoogleRow(
    {
      adGroupAd: { ad: { id: "1", type: "VIDEO_RESPONSIVE_AD" } },
      metrics: {
        impressions: "1000",
        videoViews: "400",
        videoQuartileP25Rate: 0.3,
        videoQuartileP100Rate: 0.1,
        costMicros: "0",
      },
    },
    "ad",
  );
  assert.equal(row.videoPlays, 400);
  assert.equal(row.hookRate, 0.4);
  assert.ok(Math.abs(row.retention!.p25 - 0.75) < 1e-9);
  assert.ok(Math.abs(row.holdRate! - 0.25) < 1e-9);
});

test("adDisplayName cai para tipo + id quando não há nome nem título", () => {
  assert.equal(adDisplayName({ id: "9", type: "IMAGE_AD" }), "image ad 9");
});

test("creativeFromRow usa a imagem do anúncio e a URL final", () => {
  const creative = creativeFromRow({
    adGroupAd: {
      status: "PAUSED",
      ad: { id: "5", type: "IMAGE_AD", imageAd: { imageUrl: "https://cdn/x.png" }, finalUrls: ["https://x"] },
    },
  });
  assert.deepEqual(creative, {
    adId: "5",
    name: "image ad 5",
    status: "PAUSED",
    thumbnailUrl: "https://cdn/x.png",
    coverUrl: "https://cdn/x.png",
    permalink: "https://x",
    isVideo: false,
  });
  assert.equal(creativeFromRow({}), null);
});

test("presetRange segue a convenção da Meta: últimos N dias terminam ontem", () => {
  // 2026-09-16 é uma quarta-feira.
  const today = "2026-09-16";
  assert.deepEqual(presetRange("today", today), { since: today, until: today });
  assert.deepEqual(presetRange("yesterday", today), { since: "2026-09-15", until: "2026-09-15" });
  assert.deepEqual(presetRange("last_7d", today), { since: "2026-09-09", until: "2026-09-15" });
  assert.deepEqual(presetRange("last_30d", today), { since: "2026-08-17", until: "2026-09-15" });
  assert.deepEqual(presetRange("this_month", today), { since: "2026-09-01", until: today });
  assert.deepEqual(presetRange("last_month", today), { since: "2026-08-01", until: "2026-08-31" });
  assert.deepEqual(presetRange("last_quarter", today), { since: "2026-04-01", until: "2026-06-30" });
  assert.deepEqual(presetRange("this_year", today), { since: "2026-01-01", until: today });
  assert.deepEqual(presetRange("last_year", today), { since: "2025-01-01", until: "2025-12-31" });
  assert.deepEqual(presetRange("this_week_mon_today", today), { since: "2026-09-14", until: today });
  assert.deepEqual(presetRange("last_week_mon_sun", today), { since: "2026-09-07", until: "2026-09-13" });
  assert.deepEqual(presetRange("last_week_sun_sat", today), { since: "2026-09-06", until: "2026-09-12" });
  // Virada de ano no "mês passado".
  assert.deepEqual(presetRange("last_month", "2026-01-10"), { since: "2025-12-01", until: "2025-12-31" });
  // Desconhecido vira 30 dias.
  assert.deepEqual(presetRange("qualquer", today), presetRange("last_30d", today));
});
