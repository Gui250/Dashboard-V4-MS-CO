"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { count, decimal, money, moneyExact, percent, ratio } from "@/lib/format";
import type { Creative, Row } from "@/lib/meta-types";
import {
  accountFactorMedians,
  costFactors,
  type CostFactor,
} from "@/lib/normalize";

type TrackMetric = "costPerResult" | "cpm" | "cpc";

const METRICS: { value: TrackMetric; label: string; help: string }[] = [
  { value: "costPerResult", label: "Custo por resultado", help: "custo por resultado" },
  { value: "cpm", label: "CPM", help: "custo por mil impressões" },
  { value: "cpc", label: "CPC", help: "custo por clique" },
];

/** Quantas vezes o custo do criativo supera a mediana antes de virar alerta. */
const ALERT_THRESHOLD = 2;

/** Miniatura (44px) + anel + folga: o espaço que duas vizinhas precisam ter. */
const THUMB_CLEARANCE_PX = 60;

/**
 * A pista é instrumento de triagem, não catálogo. Numa conta com 63 anúncios
 * ativos ela vira dez faixas empilhadas e não responde mais a pergunta que
 * existe para responder. Mostramos os que têm mais dinheiro em jogo; o resto
 * está na tabela, que é o lugar de listar.
 */
const TRACK_LIMIT = 16;

type Plotted = {
  row: Row;
  creative?: Creative;
  value: number;
  x: number;
  lane: number;
  index: number;
};

/**
 * Distribui em faixas para que miniaturas próximas não se sobreponham.
 * Guloso: cada uma vai para a faixa mais alta ainda livre naquela posição.
 */
function assignLanes(items: Omit<Plotted, "lane">[], minGap: number): Plotted[] {
  const lastX: number[] = [];
  return items.map((item) => {
    let lane = lastX.findIndex((x) => item.x - x >= minGap);
    if (lane === -1) lane = lastX.length;
    lastX[lane] = item.x;
    return { ...item, lane };
  });
}

export function CreativeTrack({
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
  const [metric, setMetric] = useState<TrackMetric>("costPerResult");
  const [hovered, setHovered] = useState<string | null>(null);

  // A folga mínima entre miniaturas é em pixels, mas as posições são em %.
  // Sem medir o trilho, a mesma porcentagem sobrepõe no celular e desperdiça
  // faixas no monitor.
  const rail = useRef<HTMLDivElement>(null);
  const [railWidth, setRailWidth] = useState(0);

  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setRailWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const byAdId = useMemo(
    () => new Map(creatives.map((creative) => [creative.adId, creative])),
    [creatives],
  );

  const { plotted, min, max, median, unplotted, spread, hidden } = useMemo(() => {
    // Recorta por gasto — o critério de "importa" — e só então posiciona por custo.
    const top = [...ads].sort((a, b) => b.spend - a.spend).slice(0, TRACK_LIMIT);
    const withValue = top
      .map((row) => ({ row, value: row[metric] }))
      .filter((item): item is { row: Row; value: number } =>
        typeof item.value === "number" && Number.isFinite(item.value) && item.value > 0,
      )
      .sort((a, b) => a.value - b.value);

    if (withValue.length === 0) {
      return {
        plotted: [],
        min: 0,
        max: 0,
        median: null,
        unplotted: top.length,
        spread: 1,
        hidden: ads.length - top.length,
      };
    }

    const values = withValue.map((item) => item.value);
    const lo = values[0];
    const hi = values[values.length - 1];
    const mid = Math.floor(values.length / 2);
    const med =
      values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;

    // Escala logarítmica: sem ela, um criativo 56x mais caro esmaga todos os
    // outros contra a borda esquerda e a pista não mostra nada.
    const logLo = Math.log(lo);
    const logHi = Math.log(hi);
    const span = logHi - logLo;

    const items = withValue.map((item, index) => ({
      ...item,
      creative: byAdId.get(item.row.id),
      index,
      // Margem nas pontas para a miniatura do extremo não ser cortada.
      // Arredondado: float longo em `left:%` diverge entre servidor e cliente.
      x: Number(
        (span > 0 ? 3 + ((Math.log(item.value) - logLo) / span) * 94 : 50).toFixed(3),
      ),
    }));

    return {
      plotted: assignLanes(items, railWidth > 0 ? (THUMB_CLEARANCE_PX / railWidth) * 100 : 6),
      min: lo,
      max: hi,
      median: med,
      unplotted: top.length - withValue.length,
      spread: lo > 0 ? hi / lo : 1,
      hidden: ads.length - top.length,
    };
  }, [ads, byAdId, metric, railWidth]);

  // Base de comparação dos fatores: a própria conta, no período selecionado.
  const factorMedians = useMemo(() => accountFactorMedians(ads), [ads]);

  const lanes = Math.max(1, ...plotted.map((item) => item.lane + 1));
  const medianX =
    median !== null && max > min
      ? Number(
          (3 + ((Math.log(median) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 94).toFixed(3),
        )
      : 50;

  const focused = hovered ?? selectedAd;
  // Sem cursor e sem seleção, o painel abre no criativo mais caro — é o que
  // precisa de atenção, e mantém a capa sempre na tela.
  const active = focused
    ? plotted.find((item) => item.row.id === focused)
    : plotted.at(-1);
  const showingDefault = !focused && Boolean(active);

  return (
    <section
      aria-label="Pista de criativos"
      className="border-border bg-card rounded-lg border p-5"
    >
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="eyebrow">Pista de criativos</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {plotted.length > 1 ? (
              <>
                O mais caro custa{" "}
                <strong
                  className={cn(
                    "tnum font-semibold",
                    spread >= 10 ? "text-destructive" : "text-foreground",
                  )}
                >
                  {spread >= 1000
                    ? `${Math.round(spread / 1000)} mil`
                    : spread.toFixed(spread >= 10 ? 0 : 1).replace(".", ",")}
                  ×
                </strong>{" "}
                o mais barato
                {hidden > 0 && (
                  <>
                    {" "}
                    — entre os {plotted.length} de maior investimento
                  </>
                )}
                .
              </>
            ) : (
              "Cada anúncio posicionado pelo seu custo, em escala logarítmica."
            )}
          </p>
        </div>

        <div
          role="group"
          aria-label="Métrica da pista"
          className="border-border flex overflow-hidden rounded-md border text-xs"
        >
          {METRICS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMetric(option.value)}
              aria-pressed={metric === option.value}
              className={cn(
                "px-3 py-1.5 font-medium transition-colors",
                metric === option.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {plotted.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          Nenhum anúncio com {METRICS.find((m) => m.value === metric)?.help} no período.
        </p>
      ) : (
        <>
          <div
            ref={rail}
            className="relative mx-1"
            style={{ height: `${lanes * 58 + 26}px` }}
            onMouseLeave={() => setHovered(null)}
          >
            {/* O trilho. A distância ao longo dele é o dado. */}
            <div className="bg-border absolute inset-x-0 top-0 h-px" />

            {median !== null && plotted.length > 2 && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 -translate-x-1/2"
                style={{ left: `${medianX}%` }}
                aria-hidden
              >
                <div className="bg-line-bright h-full w-px" />
                <span className="text-muted-foreground tnum absolute -bottom-0.5 left-1.5 text-[10px] whitespace-nowrap">
                  mediana {moneyExact(median)}
                </span>
              </div>
            )}

            {plotted.map((item) => {
              const ratioToMedian = median ? item.value / median : 1;
              const alert = ratioToMedian >= ALERT_THRESHOLD;
              const selected = selectedAd === item.row.id;
              const creative = item.creative;

              return (
                <button
                  key={item.row.id}
                  type="button"
                  onMouseEnter={() => setHovered(item.row.id)}
                  onFocus={() => setHovered(item.row.id)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelect(selected ? "" : item.row.id)}
                  aria-pressed={selected}
                  aria-label={`${item.row.name}. ${METRICS.find((m) => m.value === metric)?.help} ${moneyExact(item.value)}${alert ? ". Acima do dobro da mediana." : ""}`}
                  className="absolute -translate-x-1/2 transition-transform duration-150 hover:z-20 hover:scale-110"
                  style={{
                    left: `${item.x}%`,
                    top: `${20 + item.lane * 58}px`,
                    zIndex: selected || hovered === item.row.id ? 20 : 10 - item.lane,
                  }}
                >
                  <span
                    className={cn(
                      "block size-11 overflow-hidden rounded ring-2 ring-offset-2",
                      "ring-offset-card bg-secondary",
                      alert
                        ? "ring-destructive"
                        : selected
                          ? "ring-foreground"
                          : "ring-transparent",
                      selectedAd && !selected && "opacity-40",
                    )}
                  >
                    {creative?.thumbnailUrl ? (
                      /* URL assinada e efêmera do CDN da Meta — next/image
                         tentaria cachear o que expira em horas. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={creative.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-muted-foreground tnum flex size-full items-center justify-center text-[10px]">
                        {item.index + 1}
                      </span>
                    )}
                  </span>
                  {alert && (
                    <span className="text-destructive tnum mt-1 block text-center text-[10px] font-semibold whitespace-nowrap">
                      {moneyExact(item.value)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="text-muted-foreground mt-3 flex items-baseline justify-between gap-4 text-[11px]">
            <span>
              ◄ eficiente <span className="tnum text-foreground">{moneyExact(min)}</span>
            </span>
            <span className="truncate">
              {[
                unplotted > 0 &&
                  `${unplotted} sem essa métrica`,
                hidden > 0 &&
                  `outros ${hidden} anúncios na tabela abaixo`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span>
              <span className="tnum text-destructive">{moneyExact(max)}</span> caro ►
            </span>
          </div>

          {active && (
            <CreativeDetail
              item={active}
              median={median}
              medians={factorMedians}
              isDefault={showingDefault}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Meta serve thumbnail em URL de CDN assinada, que caduca em horas. Quando
 * caduca, o navegador mostraria o ícone de imagem quebrada — o placeholder
 * evita isso e diz o que houve.
 */
function CreativeCover({
  url,
  alert,
  position,
}: {
  url: string | null;
  alert: boolean;
  position: number;
}) {
  const [broken, setBroken] = useState(false);
  const ring = alert ? "ring-destructive" : "ring-line-bright";

  if (!url || broken) {
    return (
      <span
        className={cn(
          "bg-ink flex h-[140px] w-[112px] shrink-0 self-start flex-col items-center justify-center gap-1 rounded ring-1 sm:h-[168px] sm:w-[134px]",
          ring,
        )}
      >
        <span className="text-muted-foreground tnum text-lg">{position}</span>
        <span className="text-muted-foreground text-[10px]">sem prévia</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "bg-ink flex h-[140px] shrink-0 self-start items-center justify-center overflow-hidden rounded ring-1 sm:h-[168px]",
        ring,
      )}
    >
      {/* URL assinada e efêmera do CDN da Meta — next/image tentaria cachear
          o que expira em horas. Já veio no cache pela miniatura da pista. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        onError={() => setBroken(true)}
        className="h-full w-auto max-w-[240px] object-contain"
      />
    </span>
  );
}

/**
 * Curva de retenção: quanto das reproduções sobrevive a cada quarto do vídeo.
 * A queda entre 25% e 50% é onde o criativo perde a audiência.
 */
function Retention({
  retention,
}: {
  retention: NonNullable<Row["retention"]>;
}) {
  const marks = [
    ["25%", retention.p25],
    ["50%", retention.p50],
    ["75%", retention.p75],
    ["100%", retention.p100],
  ] as const;

  return (
    <div className="mt-4">
      <p className="text-muted-foreground text-[11px]">Retenção do vídeo</p>
      <div className="mt-2 flex gap-2">
        {marks.map(([label, value]) => (
          <div key={label} className="flex-1">
            <div className="bg-ink h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-foreground h-full rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, value * 100)).toFixed(1)}%` }}
              />
            </div>
            <p className="tnum mt-1.5 text-xs">{ratio(value)}</p>
            <p className="text-muted-foreground tnum text-[10px]">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreativeDetail({
  item,
  median,
  medians,
  isDefault,
}: {
  item: Plotted;
  median: number | null;
  medians: ReturnType<typeof accountFactorMedians>;
  isDefault: boolean;
}) {
  const { row } = item;
  const alert = median !== null && item.value >= median * ALERT_THRESHOLD;

  const stats: [string, string][] = [
    ["Investido", money(row.spend)],
    ["Impressões", count(row.impressions)],
    ["Alcance", count(row.reach)],
    ["CTR", percent(row.ctr)],
    ["CPC", moneyExact(row.cpc)],
    ["CPM", moneyExact(row.cpm)],
    [row.resultLabel ?? "Resultados", count(row.results)],
    ["CPA (custo/result.)", moneyExact(row.costPerResult)],
  ];
  // ROAS só existe com evento de compra no pixel. Sem ele a Meta devolve
  // vazio, e uma célula "—" mentiria menos que um 0 mas ainda ocuparia espaço.
  if (row.roas !== null) stats.push(["ROAS", `${decimal(row.roas)}×`]);
  if (row.videoPlays !== null) stats.push(["Hook rate", ratio(row.hookRate)]);

  return (
    <div className="border-border bg-surface-raised mt-5 flex flex-col gap-4 rounded-md border p-4 sm:flex-row">
      <CreativeCover
        url={item.creative?.coverUrl ?? item.creative?.thumbnailUrl ?? null}
        alert={alert}
        position={item.index + 1}
      />

      <div className="min-w-0 flex-1">
        {isDefault && (
          <p className="eyebrow mb-1.5">Mais caro do período</p>
        )}

        <div className="flex flex-col items-start gap-1 sm:flex-row sm:gap-3">
          <p className="text-foreground min-w-0 flex-1 text-sm leading-snug font-medium">
            {row.name}
          </p>
          {item.creative?.permalink && (
            <a
              href={item.creative.permalink}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline underline-offset-2"
            >
              Ver no Instagram
            </a>
          )}
        </div>

        {row.videoPlays !== null && (
          <p className="text-muted-foreground mt-1.5 text-[11px]">
            Vídeo — a capa é o primeiro quadro.
          </p>
        )}

        <dl className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground text-[11px]">{label}</dt>
              <dd className="tnum text-sm">{value}</dd>
            </div>
          ))}
        </dl>

        <CostBreakdown row={row} medians={medians} />

        {row.retention && <Retention retention={row.retention} />}

        {row.quality && row.quality !== "UNKNOWN" && (
          <p className="text-muted-foreground mt-3.5 text-[11px]">
            Classificação de qualidade:{" "}
            {row.quality === "ABOVE_AVERAGE"
              ? "acima da média"
              : row.quality === "AVERAGE"
                ? "na média"
                : "abaixo da média"}
          </p>
        )}
        {row.quality === "UNKNOWN" && (
          <p className="text-muted-foreground mt-3.5 text-[11px]">
            Sem classificação de qualidade: a Meta só calcula acima de 500 impressões.
          </p>
        )}
      </div>
    </div>
  );
}

const FACTOR_COPY: Record<
  CostFactor["key"],
  { label: string; format: (v: number) => string; culprit: string }
> = {
  cpm: {
    label: "CPM",
    format: (v) => moneyExact(v),
    culprit: "a entrega está cara — público disputado, frequência alta ou qualidade baixa",
  },
  ctr: {
    label: "Taxa de clique",
    format: (v) => percent(v),
    culprit: "o criativo aparece mas não arranca clique",
  },
  conversion: {
    label: "Conversão do clique",
    format: (v) => ratio(v),
    culprit: "o clique acontece mas não vira resultado — olhe destino e oferta, não o criativo",
  },
};

/** A partir daqui o fator deixa de ser variação normal e vira gargalo. */
const BOTTLENECK = 1.5;

/**
 * Custo por resultado é identidade, não caixa-preta:
 *
 *     custo/resultado = (CPM / 1000) ÷ CTR ÷ conversão
 *
 * Então dá para dizer de onde vem cada real — e é isso que alguém quer saber
 * ao clicar num criativo caro. As barras crescem em escala logarítmica porque
 * um fator 20× pior e um 3× pior precisam caber na mesma régua.
 *
 * Só o pior fator fica vermelho. Pintar os três que passaram da mediana
 * devolveria o problema que o vermelho existe para resolver.
 */
function CostBreakdown({
  row,
  medians,
}: {
  row: Row;
  medians: ReturnType<typeof accountFactorMedians>;
}) {
  const factors = costFactors(row, medians);
  const comparable = factors.filter((f) => f.ratio !== null);
  if (!comparable.length) return null;

  const worst = comparable.reduce((a, b) => (b.ratio! > a.ratio! ? b : a));
  const isBottleneck = worst.ratio! >= BOTTLENECK;

  return (
    <section className="border-line mt-4 border-t pt-4">
      <h4 className="eyebrow mb-3">
        Por que este resultado custa {moneyExact(row.costPerResult)}
      </h4>

      <ul className="space-y-2">
        {factors.map((factor) => {
          const copy = FACTOR_COPY[factor.key];
          const culprit = isBottleneck && factor.key === worst.key;
          // log10: 10× pior enche a barra, 2× pior ocupa ~30%.
          const fill =
            factor.ratio && factor.ratio > 1
              ? Math.min(100, (Math.log10(factor.ratio) / 1) * 100)
              : 0;

          return (
            <li key={factor.key} className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground w-32 shrink-0 truncate">
                {copy.label}
              </span>
              <span
                className={cn(
                  "tnum w-20 shrink-0 text-right",
                  culprit && "text-destructive font-semibold",
                )}
              >
                {copy.format(factor.value)}
              </span>

              <span className="bg-secondary relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    culprit ? "bg-destructive" : "bg-muted-foreground",
                  )}
                  style={{ width: `${fill}%` }}
                />
              </span>

              <span
                className={cn(
                  "w-36 shrink-0 text-right text-[11px]",
                  culprit ? "text-destructive font-semibold" : "text-muted-foreground",
                )}
              >
                {factor.ratio === null ? (
                  "sem base"
                ) : factor.ratio >= 1.05 ? (
                  <>
                    <span className="tnum">{formatRatio(factor.ratio)}×</span> pior que a
                    mediana
                  </>
                ) : factor.ratio <= 0.95 ? (
                  <>
                    <span className="tnum">{formatRatio(1 / factor.ratio)}×</span> melhor
                  </>
                ) : (
                  "na mediana"
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
        {isBottleneck ? (
          <>
            O gargalo é <strong className="text-foreground">{FACTOR_COPY[worst.key].label.toLowerCase()}</strong>:{" "}
            {FACTOR_COPY[worst.key].culprit}.
          </>
        ) : (
          "Nenhum fator destoa da conta — o custo deste criativo é o custo normal do período."
        )}
        {row.frequency >= 2.5 && (
          <>
            {" "}
            A frequência está em{" "}
            <strong className="text-foreground tnum">{decimal(row.frequency)}</strong>: as
            mesmas pessoas já viram este anúncio várias vezes, o que derruba o clique e
            sobe o CPM.
          </>
        )}
      </p>
    </section>
  );
}

/** 24,3× polui; 24× basta. Abaixo de 10 o decimal ainda informa. */
function formatRatio(value: number): string {
  return value >= 10
    ? String(Math.round(value))
    : value.toFixed(1).replace(".", ",");
}
