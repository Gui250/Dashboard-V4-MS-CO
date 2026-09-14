# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Painel de tráfego pago que lê a Marketing API da Meta ao vivo. Next.js 16 (App
Router) + React 19 + Tailwind v4 + shadcn/ui (preset `radix-nova`). Interface e
comentários em pt-BR. Sem banco, sem worker, sem cron.

## Comandos

```bash
npm run dev                                       # localhost:3000
npm run build                                     # inclui typecheck
npm run lint
npm test                                          # node --test lib/*.test.ts
node --test lib/normalize.test.ts                 # um arquivo
node --test --test-name-pattern "mediana" lib/*.test.ts   # um teste
npx tsc --noEmit                                  # typecheck isolado
```

Não há vitest nem jest — os testes rodam no runner nativo do Node com type
stripping. Isso impõe duas regras:

- **Imports em arquivos `*.test.ts` precisam da extensão `.ts`** (`from
  "./normalize.ts"`). Por isso `allowImportingTsExtensions` está no tsconfig.
- **`lib/normalize.ts` e `lib/format.ts` não podem importar `server-only`,
  `node:fs` nem sintaxe não-apagável** (ex.: `readonly` em parâmetro de
  construtor). São o alvo dos testes. Se precisar mover lógica pura para perto
  do I/O, o teste quebra — mantenha a separação.

## Onde a lógica mora

```
app/page.tsx  ──►  <Dashboard>  ──► useSWR(120s) ──► /api/insights
   (server,                (client)                      │
    force-dynamic)                                       ▼
                                              lib/meta.ts (5 fetch paralelos)
                                                         │
                                              lib/normalize.ts (puro, testado)
```

- **`lib/normalize.ts` / `lib/format.ts`** — puros, sem rede. Toda a lógica que
  erra silenciosamente números mora aqui, e é o que os testes cobrem.
- **`lib/meta.ts`** — cliente da Graph API: versão, token, `appsecret_proof`,
  cache, paginação, classificação de erro. `server-only`.
- **`lib/credentials.ts`** — de onde vem a credencial (abaixo).
- **`app/api/insights/route.ts`** — endpoint único do painel.
- **`app/api/settings/route.ts`** — lê estado mascarado, valida na Meta, grava.

`components/ui/` é gerado pelo shadcn; o que é deste projeto está em
`components/dashboard/`.

## Credenciais

Precedência: **o que a tela salvou vence**, senão variáveis de ambiente. A tela
grava em `.meta-credentials.json` (modo `0600`, no `.gitignore`); se o disco é
somente leitura (Vercel), grava num cookie httpOnly cifrado com AES-GCM, chave
derivada de `SETTINGS_SECRET` || `META_APP_SECRET` || `META_ACCESS_TOKEN`, que
vale só naquele navegador. `DELETE /api/settings` volta ao ambiente.

Já foi o contrário (env travava a tela). Foi invertido porque um
`META_ACCESS_TOKEN` bloqueado pela Meta deixava o painel sem saída. Não volte.

`getCredentials()` é **async** (lê `cookies()`), então tudo em `lib/meta.ts`
passa por `session()`. O token nunca vai ao browser em claro: só `mask()` e o
cookie cifrado atravessam o fio.

**Não há portão por origem da requisição, e não adicione um.** Já existiram dois:
o primeiro testava o header `Host` (falsificável); o segundo testava `NODE_ENV` +
"existe header de proxy?" — e como o Next preenche `x-forwarded-for` em TODA
requisição, com ou sem proxy, ele bloqueava até o localhost. Ambos travaram o
dono da máquina e protegiam pouco: o `GET` só devolve máscara, então o formulário
não vaza o token; o pior caso é vandalismo.

`resolveAccounts()` (`lib/meta.ts`) descobre as contas via `/me/adaccounts`
quando há token mas nenhuma lista configurada, para um deploy com só
`META_ACCESS_TOKEN` não cair na tela de conexão.

`saveCredentials` só lança (vira 501 com mensagem) quando não há disco gravável
nem segredo para cifrar o cookie.

A exposição séria num deploy é outra: **o painel não tem autenticação nenhuma**,
e quem abrir a URL vê o gasto da conta.

`app/page.tsx` tem `export const dynamic = "force-dynamic"` porque lê estado
mutável do disco. Sem isso a home é prerenderizada no build e fica presa na tela
de setup para sempre.

## Armadilhas da API da Meta

Erros aqui não quebram nada — produzem números errados que parecem certos.

- **`spend`, não `amount_spent`.** `spend` é do período, na unidade principal da
  moeda. `amount_spent` é lifetime da conta, em centavos.
- **Não somar janelas de atribuição.** Em `actions[]`, `value` já é a soma da
  janela padrão; somar `1d_click` + `7d_click` conta duas vezes.
- **Action types se sobrepõem.** `post_engagement` já inclui `post_reaction`,
  `comment` e `link_click`. Somar tudo duplica.
- **`reach`, `frequency` e `cpp` não somam** entre linhas nem entre dias. Trocar
  de período refaz a consulta; nunca agregue no cliente.
- **A linha da conta vem sem `objective`.** `pickResult()` nela escolhe um
  action_type só; numa conta com formulário + WhatsApp o total mostrava só os
  leads. Conversões da conta = soma do resultado de cada campanha
  (`conversionsByDate`), com o tipo fixado no período e aplicado a cada balde.
- **Mediana, não média**, no limiar de alerta: um CPM de R$157 arrasta a média
  sozinho.
- **Não enviar `action_attribution_windows` nem `use_unified_attribution_setting`** —
  desde 06/2025 a API ignora e usa a configuração do ad set. Aceitar o padrão é
  o que faz bater com o Gerenciador.
- **`thumbnail_url` sai em 64px** sem `thumbnail_width`/`thumbnail_height`, e é
  URL de CDN assinada que caduca em horas. Nunca persista; trate `onError`.
- **Batch requests não economizam cota** — cada sub-requisição conta separado.
  Poupa round-trip, não chamada. Por isso são 5 `fetch` paralelos.
- **Breakdown por hora não combina** com `reach`, `frequency`, métricas de vídeo
  nem com plataforma/posicionamento. Está fora de propósito.
- **`purchase_roas` vem vazio** sem evento de compra no pixel — não é bug. O
  painel avisa em vez de mostrar zero.
- **Rankings retornam `UNKNOWN` abaixo de 500 impressões** — significa dados
  insuficientes, não desempenho ruim.
- **"API access blocked." (código 200) é o app da Meta restrito**, não permissão
  faltando — falha até em `/me`, e qualquer token do mesmo app falha igual.
  `explain()` em `lib/meta.ts` traduz.
- **Erro 190/102/200 é fatal** (token morto, exige ação); 4/17/613/80004 é rate
  limit e passa sozinho. `MetaError.fatal` carrega essa distinção e o SWR não
  re-tenta os fatais.

## Atualização

O cliente busca a cada 120s (`REFRESH_MS` em `components/dashboard/dashboard.tsx`);
o servidor passa `REVALIDATE = 300` a cada `fetch` (`lib/meta.ts`). A diferença
é deliberada: a Meta só recalcula insights a cada ~15 min, então a tela pulsa
como pedido enquanto o cache do Next absorve a maioria dos ticks. Não "conserte"
alinhando os dois. Criativos ficam em cache por 1h (`REVALIDATE_CREATIVES`).

## Regras visuais

- **Vermelho (`--v4`, `text-destructive`) é a única cor, e significa uma coisa
  só: este criativo está caro** (≥2× a mediana do custo por resultado). Não
  existe verde de "bom" — saudável é branco. Um par verde/vermelho espalhado por
  quarenta células treina o olho a ignorar os dois.
- **Todo número usa `.tnum`** (JetBrains Mono, tabular) para as colunas de
  dinheiro alinharem na vírgula. Texto usa Archivo.
- **Formatadores de `lib/format.ts`, sempre.** Devolvem `—` para `null`, e a
  distinção entre "sem dado" e zero é significativa no painel.
- O único movimento é o componente `<Num>`, que pisca quando o valor muda no
  refresh. Respeita `prefers-reduced-motion`.
- Tema escuro por compromisso, sem alternador: os tokens ficam direto no `:root`
  de `app/globals.css`.

## Verificação sem token

As rotas alcançam a Graph API de verdade, então dá para exercitar os caminhos de
erro sem credencial válida:

```bash
curl -s -X POST localhost:3000/api/settings -H 'content-type: application/json' \
  -d '{"accessToken":"EAAinvalido"}'      # 400 + código 190 real da Meta
curl -s localhost:3000/api/insights?preset=last_7d
```

Para inspeção visual sem dados reais, crie um `app/preview/page.tsx` temporário
que monte os componentes com fixtures de `lib/normalize.ts` — e apague depois.
