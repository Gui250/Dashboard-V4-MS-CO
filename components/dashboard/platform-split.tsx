"use client";

import { useMemo } from "react";
import { count, money, moneyExact, percent } from "@/lib/format";
import type { PlatformSlice } from "@/lib/meta-types";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  threads: "Threads",
  unknown: "Não identificado",
};

const POSITION_LABELS: Record<string, string> = {
  feed: "Feed",
  story: "Stories",
  reels: "Reels",
  explore: "Explorar",
  explore_home: "Explorar (início)",
  profile_feed: "Feed do perfil",
  instagram_explore_grid_home: "Explorar",
  instream_video: "Vídeo in-stream",
  video_feeds: "Feed de vídeo",
  marketplace: "Marketplace",
  right_hand_column: "Coluna da direita",
  search: "Busca",
  facebook_reels: "Reels",
  instagram_reels: "Reels",
  an_classic: "Audience Network",
  rewarded_video: "Vídeo premiado",
  unknown: "Não identificado",
};

const label = (map: Record<string, string>, key: string) =>
  map[key] ?? key.replace(/_/g, " ");

/**
 * Barras, não pizza: comparar comprimentos ao longo de um eixo comum é o que o
 * olho faz bem, e aqui a pergunta é sempre "onde está indo a verba".
 */
export function PlatformSplit({ platforms }: { platforms: PlatformSlice[] }) {
  const { rows, total } = useMemo(() => {
    const sum = platforms.reduce((acc, slice) => acc + slice.spend, 0);
    return { rows: platforms.slice(0, 8), total: sum };
  }, [platforms]);

  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <h2 className="eyebrow mb-5">Onde a verba está indo</h2>

      {rows.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center text-sm">
          Sem entrega por posicionamento no período.
        </p>
      ) : (
        <ul className="space-y-3.5">
          {rows.map((slice) => {
            const share = total > 0 ? slice.spend / total : 0;
            return (
              <li key={`${slice.platform}-${slice.position}`}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate">
                    {label(PLATFORM_LABELS, slice.platform)}
                    <span className="text-muted-foreground">
                      {" · "}
                      {label(POSITION_LABELS, slice.position)}
                    </span>
                  </span>
                  <span className="tnum text-muted-foreground shrink-0">
                    {money(slice.spend)} · CPM {moneyExact(slice.cpm)} · CTR{" "}
                    {percent(slice.ctr)}
                  </span>
                </div>
                <div
                  className="bg-secondary h-1.5 overflow-hidden rounded-full"
                  role="img"
                  aria-label={`${(share * 100).toFixed(0)}% do investimento, ${count(slice.impressions)} impressões`}
                >
                  <div
                    className="bg-foreground h-full rounded-full"
                    style={{ width: `${Math.max(share * 100, 1)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
