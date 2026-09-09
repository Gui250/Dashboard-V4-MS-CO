"use client";

import { useRouter } from "next/navigation";
import { SettingsPanel } from "./settings-panel";

export function Setup() {
  const router = useRouter();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-12">
      <p className="eyebrow mb-4">V4 Company MS&amp;CO · Painel de Mídia</p>
      <SettingsPanel variant="setup" onSaved={() => router.refresh()} />
      <details className="text-muted-foreground mt-6 text-xs">
        <summary className="hover:text-foreground cursor-pointer">
          Como gerar o token do System User
        </summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-4 leading-relaxed">
          <li>
            Em{" "}
            <a
              className="underline underline-offset-2"
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              developers.facebook.com/apps
            </a>
            , crie um app do tipo <strong>Empresa</strong> e adicione o produto Marketing API.
          </li>
          <li>
            Em{" "}
            <a
              className="underline underline-offset-2"
              href="https://business.facebook.com/settings"
              target="_blank"
              rel="noreferrer"
            >
              business.facebook.com/settings
            </a>
            , crie um <strong>Usuário do sistema</strong> com função Admin.
          </li>
          <li>
            Nele, <em>Adicionar ativos</em> → Contas de anúncios → marque as contas com
            permissão <strong>Ver desempenho</strong>.
          </li>
          <li>
            <em>Gerar novo token</em> → escolha o app → marque <code>ads_read</code> e{" "}
            <code>business_management</code> → deixe <strong>desmarcada</strong> a caixa
            &ldquo;O token expira em 60 dias&rdquo;.
          </li>
          <li>Cole o token acima.</li>
        </ol>
      </details>
    </main>
  );
}
