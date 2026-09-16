import { Suspense } from "react";
import { resolveAccounts } from "@/lib/meta";
import { resolveGoogleAccounts } from "@/lib/google";
import { Dashboard } from "@/components/dashboard/dashboard";
import type { AccountOption } from "@/components/dashboard/account-bar";
import { Setup } from "@/components/dashboard/setup";

/**
 * Lê as credenciais gravadas a cada request. Sem isto o Next prerenderiza a
 * página no build e ela ficaria presa na tela de setup para sempre.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const [meta, google] = await Promise.all([resolveAccounts(), resolveGoogleAccounts()]);
  const options: AccountOption[] = [
    ...meta.map((a) => ({ ...a, source: "meta" as const })),
    ...google.map((a) => ({ ...a, source: "google" as const })),
  ];

  // Sem conta liberada em nenhuma das duas plataformas não há painel possível —
  // a primeira tela é a de conexão, não uma mensagem mandando editar arquivo na mão.
  if (!options.length) {
    return (
      <Suspense>
        <Setup />
      </Suspense>
    );
  }

  return (
    <Suspense>
      <Dashboard accounts={options} />
    </Suspense>
  );
}
