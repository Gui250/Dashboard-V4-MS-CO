"use client";

import { count, money, moneyExact, percent } from "@/lib/format";
import type { Row } from "@/lib/meta-types";
import { Num } from "./num";

/**
 * Totais do período. Discreto de propósito: a pista de criativos é a manchete,
 * isto é a linha de apoio.
 */
export function MetricStrip({ totals }: { totals: Row }) {
  const cells: { label: string; value: number | null; format: (v: never) => string }[] = [
    { label: "Investido", value: totals.spend, format: money as never },
    { label: "Impressões", value: totals.impressions, format: count as never },
    { label: "Alcance", value: totals.reach, format: count as never },
    { label: "Cliques", value: totals.clicks, format: count as never },
    { label: "CTR", value: totals.ctr, format: percent as never },
    { label: "CPC", value: totals.cpc, format: moneyExact as never },
    { label: "CPM", value: totals.cpm, format: moneyExact as never },
    {
      label: totals.resultLabel ?? "Resultados",
      value: totals.results,
      format: count as never,
    },
    { label: "Custo/result.", value: totals.costPerResult, format: moneyExact as never },
    { label: "ROAS", value: totals.roas, format: ((v: number | null) => (v === null ? "—" : `${v.toFixed(2).replace(".", ",")}×`)) as never },
  ];

  return (
    <dl className="border-border bg-card grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((cell) => (
        <div key={cell.label} className="bg-card px-4 py-3.5">
          <dt className="text-muted-foreground truncate text-[11px]">{cell.label}</dt>
          <dd className="mt-0.5 text-xl font-medium">
            <Num value={cell.value} format={cell.format} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
