"use client";

import useSWR from "swr";
import { useFilters } from "@/hooks/use-filters";
import type { Payload } from "@/lib/meta-types";
import { AccountBar, type AccountOption } from "./account-bar";
import { CreativeTrack } from "./creative-track";
import { TopCreatives } from "./top-creatives";
import { MetricStrip } from "./metric-strip";
import { SeriesChart } from "./series-chart";
import { PlatformSplit } from "./platform-split";
import { EntityTable } from "./entity-table";

/** O painel pisca de 2 em 2 minutos, como pedido. */
const REFRESH_MS = 120_000;

type ApiError = { error: string; fatal?: boolean; code?: number };

async function fetcher(url: string): Promise<Payload> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    const error = new Error(body.error ?? `Falha ${response.status}`);
    Object.assign(error, { fatal: body.fatal, code: body.code });
    throw error;
  }
  return response.json();
}

export function Dashboard({ accounts }: { accounts: AccountOption[] }) {
  const { filters, set, queryKey } = useFilters();

  const { data, error, isValidating, mutate } = useSWR<Payload>(queryKey, fetcher, {
    refreshInterval: REFRESH_MS,
    // Mantém os números na tela durante o refetch em vez de piscar esqueleto.
    keepPreviousData: true,
    revalidateOnFocus: true,
    // Token morto não melhora com insistência; rate limit melhora.
    shouldRetryOnError: (err: Error & { fatal?: boolean }) => !err.fatal,
    errorRetryInterval: 15_000,
  });

  const fatal = (error as (Error & { fatal?: boolean }) | undefined)?.fatal;
  // Antes de o payload chegar, a origem vem da conta escolhida no seletor.
  const source =
    data?.source ??
    accounts.find((account) => account.id === (filters.account || accounts[0]?.id))?.source ??
    "meta";
  const platform = source === "google" ? "O Google" : "A Meta";

  return (
    <div className="min-h-full">
      <AccountBar
        accounts={accounts}
        filters={filters}
        onFilterChange={set}
        fetchedAt={data?.fetchedAt ?? null}
        loading={isValidating}
        onRefresh={() => mutate()}
      />

      <main className="mx-auto max-w-[1600px] space-y-4 px-5 py-5">
        {error && (
          <div
            role="alert"
            className={
              fatal
                ? "border-destructive bg-destructive/10 rounded-lg border p-4 text-sm"
                : "border-border bg-card text-muted-foreground rounded-lg border p-4 text-sm"
            }
          >
            <p className="text-foreground font-medium">
              {fatal ? `${platform} recusou a credencial` : "Não deu para atualizar agora"}
            </p>
            <p className="mt-1">{(error as Error).message}</p>
            {!fatal && data && (
              <p className="mt-1">Mostrando os últimos dados que chegaram.</p>
            )}
          </div>
        )}

        {data?.warnings.map((warning) => (
          <p
            key={warning}
            className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-2.5 text-xs"
          >
            {warning}
          </p>
        ))}

        {!data && !error ? (
          <Loading />
        ) : data ? (
          <>
            <CreativeTrack
              ads={data.ads}
              creatives={data.creatives}
              selectedAd={filters.ad}
              onSelect={(ad) => set({ ad, level: ad ? "ad" : filters.level })}
            />

            <TopCreatives
              ads={data.ads}
              creatives={data.creatives}
              selectedAd={filters.ad}
              onSelect={(ad) => set({ ad, level: ad ? "ad" : filters.level })}
            />

            <MetricStrip totals={data.totals} source={data.source} />

            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              <SeriesChart
                series={data.series}
                granularity={filters.granularity}
                view={filters.metric as "retorno" | "custo" | "fadiga"}
                totals={data.totals}
                onGranularityChange={(granularity) => set({ granularity })}
                onViewChange={(metric) => set({ metric })}
              />
              <PlatformSplit platforms={data.platforms} />
            </div>

            <EntityTable
              rows={data.rows}
              filters={filters}
              medianCostPerResult={data.medianCostPerResult}
              source={data.source}
              onFilterChange={set}
            />

            <footer className="text-muted-foreground pt-1 pb-6 text-[11px]">
              Conta {data.account.name} · {data.account.currency} · fuso{" "}
              {data.account.timezone}.{" "}
              {data.source === "google"
                ? "O Google Ads atualiza relatórios com até 3 horas de atraso; conversões podem se ajustar por dias, conforme a janela de conversão."
                : "A Meta recalcula insights a cada ~15 minutos; conversões podem se ajustar por alguns dias."}
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando dados">
      <div className="border-border bg-card h-56 animate-pulse rounded-lg border" />
      <div className="border-border bg-card h-24 animate-pulse rounded-lg border" />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="border-border bg-card h-72 animate-pulse rounded-lg border" />
        <div className="border-border bg-card h-72 animate-pulse rounded-lg border" />
      </div>
    </div>
  );
}
