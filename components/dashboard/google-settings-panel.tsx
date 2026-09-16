"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { AccountList, Field } from "./settings-panel";

type Account = { id: string; name: string };

type Status = {
  configured: boolean;
  needsAuth: boolean;
  clientId: string;
  clientSecretMask: string;
  developerTokenMask: string;
  refreshTokenMask: string;
  loginCustomerId: string;
  apiVersion: string;
  accounts: Account[];
  fromEnv: boolean;
  envHasGoogle: boolean;
  defaultApiVersion: string;
  redirectUri: string;
};

const getStatus = async (url: string): Promise<Status> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Estado indisponível (${response.status})`);
  return response.json();
};

const INPUT =
  "border-border bg-surface-raised focus:border-line-bright w-full rounded-md border px-3 py-2 font-mono text-sm outline-none";

/**
 * Mesmo desenho do painel da Meta, com a diferença que o Google exige OAuth:
 * client + developer token primeiro, refresh token depois — colado ou pelo
 * botão que leva ao consentimento do Google e volta para /?google=….
 */
export function GoogleSettingsPanel({
  onSaved,
  variant,
}: {
  onSaved: () => void;
  variant: "setup" | "panel";
}) {
  const { data: status, error: statusError, mutate } = useSWR<Status>(
    "/api/settings/google",
    getStatus,
    { keepPreviousData: false, errorRetryInterval: 4000 },
  );
  // Resultado do fluxo OAuth, que aterrissa na home com ?google=ok|mensagem.
  const oauthResult = useSearchParams().get("google");

  const [developerToken, setDeveloperToken] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [loginCustomerId, setLoginCustomerId] = useState<string | null>(null);
  const [apiVersionInput, setApiVersionInput] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apiVersion = apiVersionInput ?? status?.apiVersion ?? "";
  const chosen = selected ?? (status?.accounts ?? []).map((account) => account.id);
  const hasClient = Boolean((clientId ?? status?.clientId) && (clientSecret || status?.clientSecretMask));
  const willAuthorize = !refreshToken && !status?.refreshTokenMask;

  async function resetToEnv() {
    setState("saving");
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/settings/google", { method: "DELETE" });
      if (!response.ok) {
        setError("Não foi possível voltar às credenciais do ambiente.");
        return;
      }
      setSelected(null);
      await mutate();
      onSaved();
    } catch {
      setError("Falha de rede.");
    } finally {
      setState("idle");
    }
  }

  async function save(accounts?: Account[]) {
    setState("saving");
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/settings/google", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          developerToken,
          clientId: clientId ?? undefined,
          clientSecret,
          refreshToken,
          loginCustomerId: loginCustomerId ?? undefined,
          apiVersion,
          accounts,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Não foi possível salvar.");
        return;
      }
      if (body.needsAuth) {
        // Client gravado; o refresh token vem do consentimento do Google. É um
        // Route Handler que redireciona para fora, não uma página: navegação cheia.
        window.location.assign(new URL("/api/settings/google/oauth", window.location.origin).href);
        return;
      }
      // Segredos não ficam em memória depois de salvos.
      setDeveloperToken("");
      setClientSecret("");
      setRefreshToken("");
      setSelected(null);
      setSaved(true);
      await mutate();
      onSaved();
    } catch {
      setError("Falha de rede ao salvar.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className={cn(variant === "setup" && "border-border bg-card rounded-lg border p-6")}>
      {variant === "setup" && (
        <header className="mb-6">
          <h2 className="flex items-baseline gap-2 text-lg font-extrabold tracking-tight">
            <span className="bg-v4 inline-block h-4 w-1 translate-y-0.5 rounded-[1px]" />
            Conectar ao Google Ads
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Developer token do Centro de API e um client OAuth do Google Cloud. O painel
            autoriza no Google, testa a credencial e descobre suas contas sozinho.
          </p>
        </header>
      )}

      {oauthResult && (
        <p
          role="status"
          className={cn(
            "mb-4 rounded-md border px-3 py-2.5 text-sm",
            oauthResult === "ok"
              ? "border-border bg-surface-raised text-muted-foreground"
              : "border-destructive bg-destructive/10",
          )}
        >
          {oauthResult === "ok"
            ? "Google Ads autorizado. Credencial validada e salva."
            : oauthResult}
        </p>
      )}

      {statusError ? (
        <div role="alert" className="border-border bg-surface-raised rounded-md border p-4 text-sm">
          <p className="text-foreground font-medium">Não deu para ler a configuração atual</p>
          <p className="text-muted-foreground mt-1">{(statusError as Error).message}.</p>
          <button
            type="button"
            onClick={() => void mutate()}
            className="border-border mt-3 rounded-md border px-3 py-1.5 text-xs font-medium"
          >
            Tentar de novo
          </button>
        </div>
      ) : !status ? (
        <div className="bg-secondary h-40 animate-pulse rounded-md" />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <Field
            label="Developer token"
            hint={
              status.developerTokenMask
                ? `${status.fromEnv ? "Vindo de GOOGLE_ADS_DEVELOPER_TOKEN" : "Salvo"}: ${status.developerTokenMask}. Em branco mantém.`
                : "Em ads.google.com → Ferramentas → Centro de API, na conta de administrador (MCC)."
            }
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={developerToken}
              onChange={(event) => setDeveloperToken(event.target.value)}
              placeholder={status.developerTokenMask ? "••••••••  (manter o atual)" : "Ab1CdEf…"}
              className={INPUT}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Client ID"
              hint="Do client OAuth (tipo Aplicativo da Web) em console.cloud.google.com."
            >
              <input
                autoComplete="off"
                spellCheck={false}
                value={clientId ?? status.clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="…apps.googleusercontent.com"
                className={INPUT}
              />
            </Field>
            <Field
              label="Client Secret"
              hint={status.clientSecretMask ? `Salvo: ${status.clientSecretMask}. Em branco mantém.` : "GOCSPX-…"}
            >
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={status.clientSecretMask ? "••••••••  (manter o atual)" : "GOCSPX-…"}
                className={INPUT}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field
              label="Conta de administrador (MCC)"
              hint="Opcional. Só se as contas forem acessadas por uma MCC. O painel preenche sozinho quando descobre uma."
            >
              <input
                autoComplete="off"
                spellCheck={false}
                value={loginCustomerId ?? status.loginCustomerId}
                onChange={(event) => setLoginCustomerId(event.target.value)}
                placeholder="123-456-7890"
                className={cn(INPUT, "tnum")}
              />
            </Field>
            <Field label="Versão da API" hint={`Padrão ${status.defaultApiVersion}`}>
              <input
                value={apiVersion}
                onChange={(event) => setApiVersionInput(event.target.value)}
                spellCheck={false}
                className={cn(INPUT, "tnum")}
              />
            </Field>
          </div>

          <Field
            label="Refresh token"
            hint={
              status.refreshTokenMask
                ? `${status.fromEnv ? "Vindo de GOOGLE_ADS_REFRESH_TOKEN" : "Salvo"}: ${status.refreshTokenMask}. Em branco mantém.`
                : "Opcional: deixe em branco para autorizar pelo Google, ou cole um gerado por fora."
            }
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={refreshToken}
              onChange={(event) => setRefreshToken(event.target.value)}
              placeholder={status.refreshTokenMask ? "••••••••  (manter o atual)" : "1//0g…"}
              className={INPUT}
            />
          </Field>

          {error && (
            <p role="alert" className="border-destructive bg-destructive/10 rounded-md border px-3 py-2.5 text-sm">
              {error}
            </p>
          )}

          {saved && !error && (
            <p className="text-muted-foreground text-sm">Credencial validada no Google e salva.</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={state === "saving" || (!hasClient && !developerToken)}
              className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {state === "saving"
                ? "Verificando no Google…"
                : willAuthorize
                  ? "Salvar e autorizar no Google"
                  : "Verificar e salvar"}
            </button>
            {status.needsAuth && (
              <a
                href="/api/settings/google/oauth"
                className="border-border rounded-md border px-3 py-2 text-xs font-medium"
              >
                Autorizar no Google
              </a>
            )}
            {!status.fromEnv && status.envHasGoogle && (
              <button
                type="button"
                disabled={state === "saving"}
                onClick={() => void resetToEnv()}
                className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-40"
              >
                Voltar a usar as credenciais do ambiente
              </button>
            )}
          </div>

          <p className="text-muted-foreground text-[11px] leading-relaxed">
            URI de redirecionamento a cadastrar no client OAuth:{" "}
            <code className="tnum select-all">{status.redirectUri}</code>
          </p>
        </form>
      )}

      {!statusError && (status?.accounts.length ?? 0) > 0 && (
        <AccountList
          accounts={status!.accounts}
          chosen={chosen}
          dirty={selected !== null}
          saving={state === "saving"}
          onChange={setSelected}
          onSave={() =>
            void save(status!.accounts.filter((account) => chosen.includes(account.id)))
          }
        />
      )}

      {variant === "setup" && <GoogleHowTo />}

      <div className="text-muted-foreground mt-7 space-y-2.5 text-xs leading-relaxed">
        <p>
          Salvo em <code className="tnum">.google-credentials.json</code> na sua máquina, ou
          em cookie cifrado onde o disco é somente leitura — mesmas regras da Meta. Segredos
          nunca voltam a esta tela, só a versão mascarada.
        </p>
        <p className="border-line-bright border-l-2 pl-3">
          Com a tela de consentimento OAuth em modo <strong>Teste</strong>, o Google
          expira o refresh token em 7 dias. Publique o app (não precisa de verificação
          para uso interno) para ele durar.
        </p>
      </div>
    </div>
  );
}

function GoogleHowTo() {
  return (
    <details className="text-muted-foreground mt-6 text-xs">
      <summary className="hover:text-foreground cursor-pointer">
        Como obter developer token e client OAuth
      </summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-4 leading-relaxed">
        <li>
          Em{" "}
          <a className="underline underline-offset-2" href="https://ads.google.com/aw/apicenter" target="_blank" rel="noreferrer">
            ads.google.com/aw/apicenter
          </a>
          , logado numa conta de <strong>administrador (MCC)</strong>, solicite o developer
          token. Com acesso de <em>Teste</em> ele só lê contas de teste; peça acesso{" "}
          <strong>Básico</strong> para ler contas reais.
        </li>
        <li>
          Em{" "}
          <a className="underline underline-offset-2" href="https://console.cloud.google.com/apis/library/googleads.googleapis.com" target="_blank" rel="noreferrer">
            console.cloud.google.com
          </a>
          , crie um projeto e ative a <strong>Google Ads API</strong>.
        </li>
        <li>
          <em>APIs e serviços</em> → <em>Tela de consentimento OAuth</em>: tipo Externo, e
          adicione o escopo <code>…/auth/adwords</code>. Depois publique o app.
        </li>
        <li>
          <em>Credenciais</em> → <em>Criar credenciais</em> → <strong>ID do cliente OAuth</strong>{" "}
          → tipo <strong>Aplicativo da Web</strong> → cole o URI de redirecionamento mostrado
          acima.
        </li>
        <li>
          Preencha os campos e clique em <em>Salvar e autorizar no Google</em>. Entre com a
          conta Google que tem acesso ao Google Ads.
        </li>
      </ol>
    </details>
  );
}
