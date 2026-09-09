"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { count, money, moneyExact, percent, shortDate } from "@/lib/format";
import type { SeriesPoint } from "@/lib/meta-types";

const SERIES_METRICS = [
  { value: "spend", label: "Investimento", format: money },
  { value: "impressions", label: "Impressões", format: count },
  { value: "clicks", label: "Cliques", format: count },
  { value: "linkClicks", label: "Cliques no link", format: count },
  { value: "ctr", label: "CTR", format: percent },
  { value: "cpc", label: "CPC", format: moneyExact },
  { value: "cpm", label: "CPM", format: moneyExact },
  { value: "results", label: "Resultados", format: count },
  { value: "costPerResult", label: "Custo por resultado", format: moneyExact },
] as const;

export type SeriesMetric = (typeof SERIES_METRICS)[number]["value"];

export function SeriesChart({
  series,
  metric,
  onMetricChange,
}: {
  series: SeriesPoint[];
  metric: SeriesMetric;
  onMetricChange: (metric: SeriesMetric) => void;
}) {
  const selected =
    SERIES_METRICS.find((m) => m.value === metric) ?? SERIES_METRICS[0];

  const config = {
    [metric]: { label: selected.label, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="eyebrow">Evolução diária</h2>
        <label className="sr-only" htmlFor="series-metric">
          Métrica do gráfico
        </label>
        <select
          id="series-metric"
          value={metric}
          onChange={(event) => onMetricChange(event.target.value as SeriesMetric)}
          className="border-border bg-surface-raised rounded-md border px-2.5 py-1.5 text-xs"
        >
          {SERIES_METRICS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      {series.length < 2 ? (
        <p className="text-muted-foreground py-16 text-center text-sm">
          {series.length === 0
            ? "Sem dados no período."
            : "Um dia só não faz série. Escolha um período mais longo."}
        </p>
      ) : (
        <ChartContainer config={config} className="h-[240px] w-full">
          <AreaChart data={series} margin={{ left: 4, right: 4, top: 4 }}>
            <defs>
              <linearGradient id="series-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(value: number) => selected.format(value)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [selected.format(Number(value)), selected.label]}
                />
              }
            />
            <Area
              dataKey={metric}
              type="monotone"
              stroke="var(--chart-1)"
              strokeWidth={1.5}
              fill="url(#series-fill)"
              dot={false}
              activeDot={{ r: 3, fill: "var(--chart-1)" }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </section>
  );
}
