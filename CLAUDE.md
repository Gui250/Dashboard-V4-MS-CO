# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Painel de tráfego pago que lê a Marketing API da Meta e a Google Ads API ao
vivo. Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui (preset `radix-nova`). Interface e
comentários em pt-BR. Sem banco, exceto a tabela de vendas no Supabase; sem
worker, sem cron.

## Comandos

```bash
npm run dev                                       # localhost:3000
npm run build                                     # inclui typecheck
npm run lint
npm test                                          # node --test lib/*.test.ts
node --test lib/normalize.test.ts                 # um arquivo (há também google-normalize.test.ts)
node --test --test-name-pattern "mediana" lib/*.test.ts   # um teste
npx tsc --noEmit                                  # typecheck isolado
```

Não há vitest nem jest — os testes rodam no runner nativo do Node com type
stripping. Isso impõe duas regras:

- **Imports em arquivos `*.test.ts` precisam da extensão `.ts`** (`from
  "./normalize.ts"`). Por isso `allowImportingTsExtensions` está no tsconfig.
- **`lib/normalize.ts`, `lib/google-normalize.ts` e `lib/format.ts` não podem
  importar `server-only`, `node:fs` nem sintaxe não-apagável** (ex.: `readonly` em parâmetro de
  construtor). São o alvo dos testes. Se precisar mover lógica pura para perto
  do I/O, o teste quebra — mantenha a separação.

## Onde a lógica mora

```
app/page.tsx  ──►  <Dashboard>  ──► useSWR(120s) ──► /api/insights
   (server,                (client)                      │
    force-dynamic)                                       ▼
                                              lib/meta.ts (5 fetch paralelos)
                                              ou lib/google.ts (GAQL searchStream)
                                                         │
                                              lib/normalize.ts / google-normalize.ts
                                              (puros, testados)
```

A rota decide a origem pela conta pedida: `resolveAccounts()` (Meta) e
`resolveGoogleAccounts()` (Google) formam a allowlist, cada conta com `source`.
Os dois produzem o mesmo `Payload`; `Payload.source` diz ao cliente o que
esconder (alcance/frequência não existem no Google).

- **`lib/normalize.ts` / `lib/format.ts`** — puros, sem rede. Toda a lógica que
  erra silenciosamente números mora aqui, e é o que os testes cobrem.
- **`lib/meta.ts`** — cliente da Graph API: versão, token, `appsecret_proof`,
  cache, paginação, classificação de erro. `server-only`.
- **`lib/google.ts` / `lib/google-normalize.ts`** — o mesmo par para o Google
  Ads: cliente REST (`server-only`) e lógica pura.
- **`lib/credentials.ts`** — de onde vem a credencial (abaixo), Meta e Google.
- **`app/api/insights/route.ts`** — endpoint único do painel.
- **`app/api/settings/route.ts`** — lê estado mascarado, valida na Meta, grava.
- **`app/api/settings/google/route.ts`** — idem para o Google;
  **`…/google/oauth/route.ts`** é o fluxo OAuth (começa e termina no mesmo GET).

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

### Google Ads

Mesma precedência (tela vence ambiente), arquivo `.google-credentials.json` e
cookie `google-credentials`. A credencial se completa em dois passos: client +
developer token são salvos primeiro; o refresh token vem do consentimento do
Google (`/api/settings/google/oauth`), que exige o client já gravado. Por isso
"a tela salvou algo" para o Google é `clientId`, não o token.

`discover()` em `lib/google.ts` lista as contas: `listAccessibleCustomers`
devolve só o que o usuário acessa direto (inclusive MCCs, sem dados próprios);
as contas reais estão em `customer_client` de cada raiz. A primeira MCC
encontrada vira o `login-customer-id` de todas as consultas.

## Armadilhas da Google Ads API

- **Dinheiro vem em micros** (`cost_micros`, `average_cpc`, `average_cpm`):
  dividir por 1e6. **`ctr` é fração** (0,05), a Meta manda 5,0 — o painel
  segue a Meta e multiplica por 100 em `normalizeGoogleRow`.
- **Não há `reach` nem `frequency`** em relatórios padrão. Ficam em 0 na `Row`
  e o cliente esconde a célula quando `source === "google"`; não mostre 0.
- **`conversions` ≠ `all_conversions`.** O painel usa `conversions`, que é a
  coluna "Conversões" da interface. `conversions_value` só existe se a ação de
  conversão tem valor; ROAS sai `null` sem isso.
- **Quartis de vídeo são fração das impressões**, não das reproduções. O
  painel converte para fração das reproduções (× impressões ÷ views) para bater
  com a curva de retenção da Meta.
- **`searchStream` é POST**, então o cache de dados do Next não se aplica; a
  memoização é em processo (`memo` em `lib/google.ts`, 5 min; conta, 1 h).
- **Presets de data são calculados** em `presetRange()` no fuso da conta
  (`customer.time_zone`) e mandados como `BETWEEN`. O GAQL só tem `DURING`
  para alguns deles, e "últimos N dias" termina ontem, como na Meta.
- **`FROM campaign` devolve campanhas sem entrega** — o `WHERE
  metrics.impressions > 0` imita o Insights da Meta, que só lista quem entregou.
- **Anúncio quase nunca tem `ad.name`**: o nome exibido é o primeiro título do
  RSA (`adDisplayName`). Só `image_ad.image_url` dá prévia; pesquisa não tem.
- **Refresh token caduca em 7 dias** se a tela de consentimento OAuth do
  projeto estiver em modo Teste (`invalid_grant`). Publicar o app resolve.
- **Developer token em acesso Teste** só enxerga contas de teste
  (`DEVELOPER_TOKEN_NOT_APPROVED`). Precisa de acesso Básico para contas reais.
- **Erros fatais vs. temporários**: 401/403 e `authenticationError`/
  `authorizationError` são fatais; 429, 5xx e `quotaError` passam sozinhos.
  `GoogleError.fatal` carrega a distinção, como `MetaError.fatal`.

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

## Vendas do WhatsApp

Uma venda fechada por conversa no WhatsApp nunca gera evento de compra no
pixel, então nunca entra no `purchase_roas` que a Meta devolve. `lib/sales.ts`
lê e grava numa tabela `whatsapp_sales` do Supabase, por PostgREST puro (sem
`@supabase/supabase-js` — são três chamadas, não vale a dependência), com a
`service_role` key, no mesmo padrão do token da Meta: nunca vai ao browser.

- **ROAS combinado = `(receita do pixel + venda do WhatsApp) ÷ spend`.**
  `blendRevenue()` em `lib/normalize.ts` soma as receitas antes de dividir —
  nunca soma ou tira média de dois ROAS, pelo mesmo motivo que `reach` não
  soma entre linhas. Sem venda lançada, o ROAS continua sendo o
  `purchase_roas` puro da Meta, para bater com o Gerenciador.
- **Cada venda é presa a um `campaign_id`.** No nível de conjunto ou anúncio
  não há como atribuir a receita do WhatsApp, então ali o ROAS é só do pixel —
  a `EntityTable` avisa isso no rodapé quando o nível não é campanha.
- Sem `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, `salesConfigured()` volta
  `false`: o formulário em `whatsapp-sales.tsx` fica desativado e o resto do
  painel segue funcionando normal, só com ROAS do pixel.

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

curl -s -X POST localhost:3000/api/settings/google -H 'content-type: application/json' \
  -d '{"developerToken":"x","clientId":"x","clientSecret":"x","refreshToken":"x"}'
                                        # 400 + invalid_client real do Google
```

Para inspeção visual sem dados reais, crie um `app/preview/page.tsx` temporário
que monte os componentes com fixtures de `lib/normalize.ts` — e apague depois.
