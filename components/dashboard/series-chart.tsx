"use client";

import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { FunnelChart, type FunnelStage } from "@/components/ui/funnel-chart";
import { cn } from "@/lib/utils";
import { count, decimal, money, moneyExact, percent } from "@/lib/format";
import type { SeriesPoint } from "@/lib/meta-types";
import type { Filters } from "@/hooks/use-filters";

type Granularity = Filters["granularity"];
type ViewKey = "retorno" | "custo" | "fadiga";

const GRANULARITY: { value: Granularity; label: string }[] = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];

/**
 * Um seletor de nove métricas mostra nove versões do mesmo número, e ninguém
 * pergunta "quanto foi meu CTR no dia 14". As perguntas reais de quem compra
 * mídia são sempre sobre duas séries que se explicam — então cada leitura é um
 * par, e o subtítulo diz o que procurar no desenho.
 */
const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  {
    key: "retorno",
    label: "Investimento e retorno",
    hint: "A linha deve acompanhar as barras. Se a verba sobe e o resultado não, a escala parou de funcionar.",
  },
  {
    key: "custo",
    label: "Custo por resultado",
    hint: "Em vermelho, os períodos acima da média. Se o vermelho se concentra no fim, está encarecendo.",
  },
  {
    key: "fadiga",
    label: "Fadiga do público",
    hint: "Frequência subindo com CTR caindo é saturação: as mesmas pessoas, cansadas do mesmo anúncio.",
  },
];

/**
 * Rótulo, cor e formato de cada série num lugar só. Manter o rótulo no
 * ChartConfig e o formato num mapa paralelo foi o que deixou o tooltip
 * escrevendo "costPerResult" no lugar de "Custo por resultado".
 */
const SERIES = {
  spend: { label: "Investimento", color: "var(--chart-3)", format: money },
  results: { label: "Resultados", color: "var(--chart-1)", format: count },
  costPerResult: {
    label: "Custo por resultado",
    color: "var(--chart-1)",
    format: moneyExact,
  },
  frequency: {
    label: "Frequência",
    color: "var(--chart-1)",
    format: (v: number) => decimal(v, 2),
  },
  ctr: { label: "CTR", color: "var(--chart-2)", format: (v: number) => percent(v, 2) },
} as const satisfies Record<
  string,
  { label: string; color: string; format: (v: number) => string }
>;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function bucketLabel(iso: string, granularity: Granularity): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month) return iso;
  if (granularity === "month") return `${MONTHS[Number(month) - 1]}/${year.slice(2)}`;
  return `${day}/${month}`;
}

/** No tooltip cabe dizer que balde é aquele; no eixo, não. */
function bucketTitle(iso: string, granularity: Granularity): string {
  const short = bucketLabel(iso, granularity);
  if (granularity === "week") return `Semana de ${short}`;
  if (granularity === "month") return short;
  return short;
}

export function SeriesChart({
  series,
  granularity,
  view,
  resultLabel,
  onGranularityChange,
  onViewChange,
}: {
  series: SeriesPoint[];
  granularity: Granularity;
  view: ViewKey;
  resultLabel: string | null;
  onGranularityChange: (value: Granularity) => void;
  onViewChange: (value: ViewKey) => void;
}) {
  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  /**
   * Média do período ponderada — gasto total sobre resultado total, não a média
   * das médias diárias. Um dia com dois resultados não pode pesar igual a um
   * dia com duzentos.
   */
  const { average, gradientStop } = useMemo(() => {
    const spend = series.reduce((sum, p) => sum + p.spend, 0);
    const results = series.reduce((sum, p) => sum + (p.results ?? 0), 0);
    const avg = results > 0 ? spend / results : null;

    const values = series
      .map((p) => p.costPerResult)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (!values.length || avg === null) return { average: avg, gradientStop: 0 };

    const max = Math.max(...values, avg);
    const min = Math.min(...values, avg);
    // Onde a média cai entre o topo e o fundo: acima dela o preenchimento
    // vira vermelho, que é o que o vermelho significa em todo o painel.
    const stop = max === min ? 0 : (max - avg) / (max - min);
    return { average: avg, gradientStop: Math.max(0, Math.min(1, stop)) };
  }, [series]);

  /**
   * Impressões, cliques e resultados somam entre baldes — alcance e frequência
   * não, e por isso ficam de fora do funil. O último estágio só entra quando o
   * objetivo produziu resultado; sem isso o funil terminaria num zero que
   * parece queda de desempenho e é só ausência de evento.
   */
  const funnel = useMemo<FunnelStage[]>(() => {
    const impressions = series.reduce((sum, p) => sum + p.impressions, 0);
    const linkClicks = series.reduce((sum, p) => sum + p.linkClicks, 0);
    const results = series.reduce((sum, p) => sum + (p.results ?? 0), 0);
    if (impressions <= 0) return [];

    const stages: FunnelStage[] = [
      { label: "Impressões", value: impressions, color: "var(--chart-3)" },
      { label: "Cliques no link", value: linkClicks, color: "var(--chart-2)" },
    ];
    if (results > 0) {
      stages.push({
        label: resultLabel ?? "Resultados",
        value: results,
        color: "var(--chart-1)",
      });
    }
    return stages;
  }, [series, resultLabel]);

  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        Object.entries(SERIES).map(([key, { label, color }]) => [key, { label, color }]),
      ),
    [],
  );

  const axis = {
    tickLine: false,
    axisLine: false,
    tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  } as const;

  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="eyebrow">Evolução</h2>
        <Toggle
          ariaLabel="Agrupar por"
          options={GRANULARITY}
          value={granularity}
          onChange={onGranularityChange}
        />
      </header>

      <Toggle
        ariaLabel="Leitura"
        options={VIEWS.map((v) => ({ value: v.key, label: v.label }))}
        value={view}
        onChange={onViewChange}
        className="mb-2"
      />
      <p className="text-muted-foreground mb-5 text-xs leading-relaxed">{active.hint}</p>

      {series.length < 2 ? (
        <p className="text-muted-foreground py-16 text-center text-sm">
          {series.length === 0
            ? "Sem dados no período."
            : granularity === "day"
              ? "Um dia só não faz série. Escolha um período mais longo."
              : "O período escolhido cabe em um único balde. Use uma granularidade menor ou amplie as datas."}
        </p>
      ) : (
        <ChartContainer config={config} className="h-[260px] w-full">
          <ComposedChart data={series} margin={{ left: 4, right: 4, top: 8 }}>
            <defs>
              <linearGradient id="custo-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} stopColor="var(--v4)" stopOpacity={0.55} />
                <stop offset={gradientStop} stopColor="var(--v4)" stopOpacity={0.12} />
                <stop offset={gradientStop} stopColor="var(--chart-1)" stopOpacity={0.16} />
                <stop offset={1} stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => bucketLabel(value, granularity)}
              minTickGap={28}
              {...axis}
            />

            {view === "retorno" && (
              <>
                <YAxis
                  yAxisId="left"
                  width={56}
                  tickFormatter={(v: number) => money(v)}
                  {...axis}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={48}
                  tickFormatter={(v: number) => count(v)}
                  {...axis}
                />
                <ChartTooltip content={<SeriesTooltip granularity={granularity} />} />
                <Bar
                  yAxisId="left"
                  dataKey="spend"
                  fill="var(--chart-4)"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  dataKey="results"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
              </>
            )}

            {view === "custo" && (
              <>
                <YAxis width={56} tickFormatter={(v: number) => moneyExact(v)} {...axis} />
                <ChartTooltip content={<SeriesTooltip granularity={granularity} />} />
                {average !== null && (
                  <ReferenceLine
                    y={average}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="3 4"
                    label={{
                      value: `média ${moneyExact(average)}`,
                      position: "insideTopRight",
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                    }}
                  />
                )}
                <Area
                  dataKey="costPerResult"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={1.5}
                  fill="url(#custo-fill)"
                  connectNulls
                  dot={false}
                  isAnimationActive={false}
                />
              </>
            )}

            {view === "fadiga" && (
              <>
                <YAxis
                  yAxisId="left"
                  width={44}
                  tickFormatter={(v: number) => decimal(v, 1)}
                  {...axis}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={52}
                  tickFormatter={(v: number) => percent(v, 1)}
                  {...axis}
                />
                <ChartTooltip content={<SeriesTooltip granularity={granularity} />} />
                <Line
                  yAxisId="left"
                  dataKey="frequency"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  dataKey="ctr"
                  type="monotone"
                  stroke="var(--chart-2)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </>
            )}
          </ComposedChart>
        </ChartContainer>
      )}

      {funnel.length > 1 && (
        <div className="border-line mt-5 border-t pt-5">
          <h3 className="eyebrow mb-1">Do impacto ao resultado</h3>
          <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
            A taxa fica sobre cada gargalo: é a passagem de uma etapa para a
            seguinte no período inteiro.
          </p>
          <FunnelChart data={funnel} />
        </div>
      )}
    </section>
  );
}

function SeriesTooltip({
  granularity,
  ...props
}: { granularity: Granularity } & React.ComponentProps<typeof ChartTooltipContent>) {
  return (
    <ChartTooltipContent
      {...props}
      labelFormatter={(label) => bucketTitle(String(label), granularity)}
      /**
       * Quando existe `formatter`, o ChartTooltipContent troca a linha inteira
       * — some o indicador de cor e o alinhamento rótulo/valor. Como só a
       * formatação do número não servia (o padrão usa toLocaleString), o
       * fragmento reconstrói a linha e mantém as duas coisas.
       */
      formatter={(value, name) => {
        const serie = SERIES[String(name) as keyof typeof SERIES];
        return (
          <>
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: serie?.color ?? "var(--chart-1)" }}
            />
            <span className="flex flex-1 items-center justify-between gap-4 leading-none">
              <span className="text-muted-foreground">{serie?.label ?? String(name)}</span>
              <span className="tnum text-foreground font-medium">
                {serie ? serie.format(Number(value)) : count(Number(value))}
              </span>
            </span>
          </>
        );
      }}
    />
  );
}

function Toggle<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: {
  ariaLabel: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "border-border flex w-fit max-w-full overflow-x-auto rounded-md border text-xs",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
            value === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
