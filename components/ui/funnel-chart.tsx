import { cn } from "@/lib/utils";
import { count, ratio } from "@/lib/format";

export type FunnelStage = {
  label: string;
  value: number;
  /** Cor base do estágio; as camadas variam a opacidade dela. */
  color?: string;
};

export type FunnelChartProps = {
  data: FunnelStage[];
  /**
   * Um funil de mídia paga vai de 400 mil impressões a 200 compras. Em escala
   * linear os dois últimos estágios viram um fio de cabelo e o desenho não
   * informa nada. `compressed` (padrão) desenha a espessura pela quarta raiz da
   * fração — a ordem e a queda continuam legíveis, e o número exato de cada
   * etapa está escrito logo abaixo.
   */
  scale?: "compressed" | "linear";
  /** Camadas concêntricas que dão volume ao corpo do funil. */
  layers?: number;
  gap?: number;
  edges?: "curved" | "straight";
  height?: number;
  className?: string;
  formatValue?: (value: number) => string;
  /** Recebe fração (0,0184 = 1,84%). */
  formatPercentage?: (fraction: number) => string;
};

/** Taxas de mídia paga variam de 0,3% a 60%: a casa decimal acompanha. */
function adaptiveRatio(fraction: number): string {
  return ratio(fraction, fraction < 0.1 ? 2 : 1);
}

/**
 * O desenho é sempre 100×100 e estica com `preserveAspectRatio="none"`. Sem
 * medir o container não há ResizeObserver, estado nem efeito — o funil é HTML
 * estático que o CSS redimensiona.
 */
function segmentPath(normStart: number, normEnd: number, scale: number, straight: boolean) {
  const half = 50;
  const a = normStart * 46 * scale;
  const b = normEnd * 46 * scale;
  if (straight) {
    return `M 0 ${half - a} L 100 ${half - b} L 100 ${half + b} L 0 ${half + a} Z`;
  }
  return (
    `M 0 ${half - a} C 55 ${half - a}, 45 ${half - b}, 100 ${half - b} ` +
    `L 100 ${half + b} C 45 ${half + b}, 55 ${half + a}, 0 ${half + a} Z`
  );
}

export function FunnelChart({
  data,
  layers = 3,
  scale = "compressed",
  gap = 4,
  edges = "curved",
  height = 96,
  className,
  formatValue = count,
  formatPercentage = adaptiveRatio,
}: FunnelChartProps) {
  const first = data[0];
  if (!first || first.value <= 0) return null;

  const top = first.value;
  const n = data.length;
  const thickness = (value: number) => {
    const fraction = Math.max(0, value / top);
    return scale === "linear" ? fraction : Math.max(fraction ** 0.25, 0.09);
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="relative">
        <div className="flex" style={{ gap, height }}>
          {data.map((stage, i) => {
            const normStart = thickness(stage.value);
            const normEnd = thickness(data[i + 1]?.value ?? stage.value);
            const color = stage.color ?? "var(--chart-2)";

            return (
              <svg
                key={stage.label}
                aria-hidden
                role="presentation"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="h-full min-w-0 flex-1"
              >
                {Array.from({ length: layers }, (_, l) => (
                  <path
                    key={l}
                    d={segmentPath(
                      normStart,
                      normEnd,
                      1 - (l / layers) * 0.35,
                      edges === "straight",
                    )}
                    fill={color}
                    opacity={0.18 + (l / (layers - 1 || 1)) * 0.65}
                  />
                ))}
              </svg>
            );
          })}
        </div>

        {/* A taxa pertence à passagem, não ao estágio: fica sobre o gargalo. */}
        {data.slice(1).map((stage, i) => {
          const previous = data[i];
          if (!previous || previous.value <= 0) return null;
          const conversion = stage.value / previous.value;
          return (
            <span
              key={stage.label}
              title={`${formatPercentage(conversion)} de ${previous.label.toLowerCase()} viraram ${stage.label.toLowerCase()}`}
              className="border-line bg-background tnum text-foreground absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{ left: `${((i + 1) / n) * 100}%` }}
            >
              {formatPercentage(conversion)}
            </span>
          );
        })}
      </div>

      <div className="mt-2 flex" style={{ gap }}>
        {data.map((stage, i) => (
          <div key={stage.label} className="min-w-0 flex-1 text-center">
            <p className="tnum text-foreground text-sm font-medium">
              {formatValue(stage.value)}
            </p>
            <p className="text-muted-foreground truncate text-[11px]">{stage.label}</p>
            {i > 0 && (
              <p className="text-muted-foreground tnum text-[10px]">
                {formatPercentage(stage.value / top)} do topo
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
