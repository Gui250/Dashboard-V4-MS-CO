"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  count,
  EM_DASH,
  money,
  moneyExact,
  objective as objectiveLabel,
  percent,
  ratio,
} from "@/lib/format";
import type { Row } from "@/lib/meta-types";
import type { Filters } from "@/hooks/use-filters";
import { Num } from "./num";

type Column = {
  key: string;
  label: string;
  numeric: keyof Row;
  format: (value: never) => string;
  /** Nesta coluna, valor mais alto é pior. */
  lowerIsBetter?: boolean;
};

const COLUMNS: Column[] = [
  { key: "spend", label: "Investido", numeric: "spend", format: money as never },
  { key: "impressions", label: "Impr.", numeric: "impressions", format: count as never },
  { key: "reach", label: "Alcance", numeric: "reach", format: count as never },
  { key: "clicks", label: "Cliques", numeric: "clicks", format: count as never },
  { key: "ctr", label: "CTR", numeric: "ctr", format: percent as never },
  { key: "cpc", label: "CPC", numeric: "cpc", format: moneyExact as never, lowerIsBetter: true },
  { key: "cpm", label: "CPM", numeric: "cpm", format: moneyExact as never, lowerIsBetter: true },
  { key: "results", label: "Result.", numeric: "results", format: count as never },
  {
    key: "costPerResult",
    label: "Custo/result.",
    numeric: "costPerResult",
    format: moneyExact as never,
    lowerIsBetter: true,
  },
];

const LEVEL_LABELS = {
  campaign: "Campanhas",
  adset: "Conjuntos",
  ad: "Anúncios",
} as const;

export function EntityTable({
  rows,
  filters,
  medianCostPerResult,
  onFilterChange,
}: {
  rows: Row[];
  filters: Filters;
  medianCostPerResult: number | null;
  onFilterChange: (patch: Partial<Filters>) => void;
}) {
  const objectives = useMemo(
    () => [...new Set(rows.map((row) => row.objective).filter(Boolean))] as string[],
    [rows],
  );

  const visible = useMemo(() => {
    const term = filters.q.trim().toLowerCase();
    const [sortKey, direction] = filters.sort.split("_");
    const sign = direction === "asc" ? 1 : -1;

    return rows
      .filter((row) => !filters.objective || row.objective === filters.objective)
      .filter((row) => !term || row.name.toLowerCase().includes(term))
      .filter((row) => !filters.ad || row.id === filters.ad)
      .sort((a, b) => {
        if (sortKey === "name") return sign * a.name.localeCompare(b.name, "pt-BR");
        // Nulos sempre no fim, independente da direção — "sem dado" não é o menor valor.
        const av = a[sortKey as keyof Row];
        const bv = b[sortKey as keyof Row];
        if (typeof av !== "number") return 1;
        if (typeof bv !== "number") return -1;
        return sign * (av - bv);
      });
  }, [rows, filters.objective, filters.q, filters.ad, filters.sort]);

  const toggleSort = (key: string) => {
    const [current, direction] = filters.sort.split("_");
    onFilterChange({
      sort: current === key && direction === "desc" ? `${key}_asc` : `${key}_desc`,
    });
  };

  const [sortKey, sortDirection] = filters.sort.split("_");

  return (
    <section className="border-border bg-card rounded-lg border">
      <header className="border-border flex flex-wrap items-center gap-3 border-b p-4">
        <div
          role="group"
          aria-label="Nível"
          className="border-border flex overflow-hidden rounded-md border text-xs"
        >
          {(Object.keys(LEVEL_LABELS) as (keyof typeof LEVEL_LABELS)[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onFilterChange({ level, ad: "" })}
              aria-pressed={filters.level === level}
              className={cn(
                "px-3 py-1.5 font-medium transition-colors",
                filters.level === level
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {LEVEL_LABELS[level]}
            </button>
          ))}
        </div>

        <select
          aria-label="Status"
          value={filters.status}
          onChange={(event) =>
            onFilterChange({ status: event.target.value as Filters["status"] })
          }
          className="border-border bg-surface-raised rounded-md border px-2.5 py-1.5 text-xs"
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="paused">Pausados</option>
        </select>

        {objectives.length > 1 && (
          <select
            aria-label="Objetivo"
            value={filters.objective}
            onChange={(event) => onFilterChange({ objective: event.target.value })}
            className="border-border bg-surface-raised rounded-md border px-2.5 py-1.5 text-xs"
          >
            <option value="">Todos os objetivos</option>
            {objectives.map((value) => (
              <option key={value} value={value}>
                {objectiveLabel(value)}
              </option>
            ))}
          </select>
        )}

        <input
          type="search"
          value={filters.q}
          onChange={(event) => onFilterChange({ q: event.target.value })}
          placeholder="Buscar por nome"
          aria-label="Buscar por nome"
          className="border-border bg-surface-raised placeholder:text-muted-foreground min-w-40 flex-1 rounded-md border px-2.5 py-1.5 text-xs"
        />

        {filters.ad && (
          <button
            type="button"
            onClick={() => onFilterChange({ ad: "" })}
            className="border-destructive text-destructive rounded-md border px-2.5 py-1.5 text-xs"
          >
            Limpar criativo ✕
          </button>
        )}

        <span className="text-muted-foreground tnum text-xs">
          {visible.length} de {rows.length}
        </span>
      </header>

      {visible.length === 0 ? (
        <p className="text-muted-foreground p-10 text-center text-sm">
          Nada corresponde a esses filtros no período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b">
                <th
                  scope="col"
                  className="p-0"
                  aria-sort={
                    sortKey === "name"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="text-muted-foreground hover:text-foreground w-full px-4 py-2.5 text-left text-[11px] font-medium"
                  >
                    Nome {sortKey === "name" && (sortDirection === "asc" ? "↑" : "↓")}
                  </button>
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="p-0"
                    aria-sort={
                      sortKey === column.key
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="text-muted-foreground hover:text-foreground w-full px-3 py-2.5 text-right text-[11px] font-medium whitespace-nowrap"
                    >
                      {column.label}{" "}
                      {sortKey === column.key && (sortDirection === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                // O vermelho aparece uma vez por linha, na célula que o justifica.
                const alert =
                  medianCostPerResult !== null &&
                  row.costPerResult !== null &&
                  row.costPerResult >= medianCostPerResult * 2;

                return (
                  <tr
                    key={row.id}
                    className="border-border hover:bg-surface-raised border-b last:border-0"
                  >
                    <th scope="row" className="max-w-xs px-4 py-2.5 text-left font-normal">
                      <span className="block truncate" title={row.name}>
                        {row.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {row.level === "ad" && row.campaignName
                          ? row.campaignName
                          : objectiveLabel(row.objective)}
                        {row.videoPlays !== null &&
                          ` · hook ${ratio(row.hookRate)} · hold ${ratio(row.holdRate)}`}
                      </span>
                    </th>
                    {COLUMNS.map((column) => {
                      const value = row[column.numeric];
                      const flag = alert && column.key === "costPerResult";
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            "px-3 py-2.5 text-right whitespace-nowrap",
                            flag && "text-destructive font-semibold",
                          )}
                        >
                          {typeof value === "number" || value === null ? (
                            <Num value={value} format={column.format} />
                          ) : (
                            EM_DASH
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
