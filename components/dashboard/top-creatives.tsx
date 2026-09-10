"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { count, moneyExact, percent, ratio } from "@/lib/format";
import type { Creative, Row } from "@/lib/meta-types";

const PODIUM = 5;

/** Fatia do investimento que define quais criativos contam como "com verba". */
const CORE_SHARE = 0.8;

/**
 * Um criativo que gastou 58 centavos e colheu engajamento barato não é o
 * vencedor da conta, é arredondamento — e recomendá-lo seria mentira.
 *
 * Piso por contagem de resultados não resolve: 109 engajamentos a R$0,005
 * passam por qualquer piso. Piso pela mediana de gasto também não, porque a
 * distribuição costuma ser torta demais (uma conta tinha mediana de R$1,25 e
 * total de R$4.720).
 *
 * O corte que funciona é de Pareto: ordena por investimento e pega os que
 * somam 80% da verba. Isso se calibra sozinho em qualquer distribuição, e o
 * número resultante aparece na tela — nunca é um corte misterioso.
 */
function coreSpenders(ads: Row[]): Row[] {
  const total = ads.reduce((sum, row) => sum + row.spend, 0);
  if (total <= 0) return ads;
  const target = total * CORE_SHARE;
  const core: Row[] = [];
  let accumulated = 0;
  for (const row of [...ads].sort((a, b) => b.spend - a.spend)) {
    if (accumulated >= target) break;
    core.push(row);
    accumulated += row.spend;
  }
  return core;
}

export function TopCreatives({
  ads,
  creatives,
  selectedAd,
  onSelect,
}: {
  ads: Row[];
  creatives: Creative[];
  selectedAd: string;
  onSelect: (adId: string) => void;
}) {
  const byAdId = useMemo(
    () => new Map(creatives.map((creative) => [creative.adId, creative])),
    [creatives],
  );

  const { podium, considered } = useMemo(() => {
    const withResults = ads.filter(
      (row) => (row.results ?? 0) > 0 && (row.costPerResult ?? 0) > 0,
    );
    const eligible = coreSpenders(withResults);

    // Uma conta mistura objetivos: custo por clique e custo por lead convivem.
    // Comparar os dois contra uma mediana única seria comparar moedas
    // diferentes — e o clique, sempre mais barato, tomaria o pódio inteiro.
    // Cada criativo é medido contra a mediana do SEU tipo de resultado, e a
    // ordenação usa essa razão: quem mais superou os próprios pares vence.
    const byType = new Map<string, number[]>();
    for (const row of eligible) {
      const key = row.resultLabel ?? "resultado";
      byType.set(key, [...(byType.get(key) ?? []), row.costPerResult!]);
    }
    const medians = new Map<string, number>();
    for (const [key, costs] of byType) {
      const sorted = [...costs].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medians.set(
        key,
        sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
      );
    }

    const scored = eligible.map((row) => {
      const peerMedian = medians.get(row.resultLabel ?? "resultado") ?? null;
      return {
        row,
        peerMedian,
        edge: peerMedian ? peerMedian / row.costPerResult! : 1,
      };
    });

    return {
      podium: scored.sort((a, b) => b.edge - a.edge).slice(0, PODIUM),
      considered: eligible.length,
    };
  }, [ads]);

  return (
    <section
      aria-label="Melhores criativos"
      className="border-border bg-card rounded-lg border p-5"
    >
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="eyebrow">Melhores criativos</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Quem mais supera os pares no próprio objetivo. Estes merecem mais verba.
          </p>
        </div>
        {podium.length > 0 && (
          <p className="text-muted-foreground text-[11px]">
            entre os {considered} que concentram 80% do investimento
          </p>
        )}
      </header>

      {podium.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          Nenhum criativo acumulou resultado no período. Amplie o intervalo de datas.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {podium.map((entry, index) => (
            <PodiumCard
              key={entry.row.id}
              rank={index + 1}
              row={entry.row}
              creative={byAdId.get(entry.row.id)}
              edge={entry.edge}
              selected={selectedAd === entry.row.id}
              dimmed={Boolean(selectedAd) && selectedAd !== entry.row.id}
              onSelect={() => onSelect(selectedAd === entry.row.id ? "" : entry.row.id)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function PodiumCard({
  rank,
  row,
  creative,
  edge,
  selected,
  dimmed,
  onSelect,
}: {
  rank: number;
  row: Row;
  creative?: Creative;
  edge: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const cover = creative?.coverUrl ?? creative?.thumbnailUrl ?? null;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "group block w-full text-left transition-opacity",
          dimmed && "opacity-40 hover:opacity-100",
        )}
      >
        <span
          className={cn(
            "bg-ink relative block aspect-[4/5] overflow-hidden rounded ring-1 transition-colors",
            selected ? "ring-foreground" : "ring-line group-hover:ring-line-bright",
          )}
        >
          {cover && !broken ? (
            /* URL assinada e efêmera do CDN da Meta. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="size-full object-cover"
            />
          ) : (
            <span className="text-muted-foreground flex size-full items-center justify-center text-[11px]">
              sem prévia
            </span>
          )}

          {/* A ordem é o dado: o numeral carrega o ranking sem precisar de cor. */}
          <span className="absolute top-0 left-0 bg-black/65 px-2 py-0.5 text-lg leading-tight font-extrabold backdrop-blur-sm">
            {rank}
          </span>

          {creative?.isVideo && (
            <span className="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] tracking-wide uppercase backdrop-blur-sm">
              vídeo
            </span>
          )}
        </span>

        <p className="tnum mt-2 text-sm font-medium">
          {moneyExact(row.costPerResult)}
        </p>
        <p className="text-muted-foreground truncate text-[11px]">
          por {(row.resultLabel ?? "resultado").toLowerCase()}
        </p>
        <p className="text-muted-foreground mt-1.5 text-[11px]">
          {edge > 1.05 ? (
            <>
              <span className="tnum text-foreground">
                {edge >= 10
                  ? Math.round(edge)
                  : edge.toFixed(1).replace(".", ",")}
                ×
              </span>{" "}
              melhor que a média do mesmo objetivo
            </>
          ) : (
            "na média do mesmo objetivo"
          )}
        </p>
        <p className="text-muted-foreground mt-1 truncate text-[11px]" title={row.name}>
          {count(row.results)} · CTR {percent(row.ctr)}
          {row.videoPlays !== null && ` · hold ${ratio(row.holdRate)}`}
        </p>
      </button>
    </li>
  );
}
