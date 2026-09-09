import { Suspense } from "react";
import { hasToken, resolveAccounts } from "@/lib/meta";
import { Dashboard } from "@/components/dashboard/dashboard";
import { Setup } from "@/components/dashboard/setup";

/**
 * Lê as credenciais gravadas a cada request. Sem isto o Next prerenderiza a
 * página no build e ela ficaria presa na tela de setup para sempre.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const options = await resolveAccounts();

  // Sem token ou sem conta liberada não há painel possível — a primeira tela
  // é a de conexão, não uma mensagem mandando editar arquivo na mão.
  if (!hasToken() || !options.length) {
    return <Setup />;
  }

  return (
    <Suspense>
      <Dashboard accounts={options} />
    </Suspense>
  );
}
