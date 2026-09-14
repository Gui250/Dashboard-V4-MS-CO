import type { Metadata } from "next";

/**
 * Política pública exigida pela Meta em App settings → Basic (Privacy Policy
 * URL e User data deletion → /privacidade#exclusao). Precisa abrir sem login.
 */
export const metadata: Metadata = {
  title: "Política de Privacidade — V4 Company MS&CO",
};

// Troque antes de enviar a URL para a Meta: o revisor procura um contato real.
const CONTATO = "contato@seudominio.com.br";
const ATUALIZADO = "14/09/2026";

export default function Privacidade() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-6 py-12 text-sm leading-relaxed">
      <header>
        <p className="eyebrow mb-4">V4 Company MS&amp;CO · Painel de Mídia</p>
        <h1 className="text-2xl font-bold">Política de Privacidade</h1>
        <p className="text-muted-foreground mt-1">Atualizada em {ATUALIZADO}</p>
      </header>

      <section className="space-y-2">
        <h2 className="font-semibold">O que é este aplicativo</h2>
        <p>
          Um painel interno da V4 Company MS&amp;CO que exibe métricas de campanhas
          de anúncios da Meta (Facebook e Instagram) das contas de anúncio que a
          própria empresa administra. Não é oferecido ao público e não tem login de
          usuários do Facebook.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Quais dados acessamos</h2>
        <p>
          Via Marketing API, com a permissão <code>ads_read</code>: nomes e status
          de campanhas, conjuntos e anúncios; métricas agregadas (investimento,
          impressões, alcance, cliques, resultados) e miniaturas dos criativos.
          Não acessamos dados pessoais de quem viu ou interagiu com os anúncios,
          nem listas de leads.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Como armazenamos</h2>
        <p>
          O painel não tem banco de dados. As métricas são consultadas na Meta a
          cada acesso e ficam em cache temporário no servidor por até 1 hora. O
          token de acesso fica no servidor, em arquivo com acesso restrito ou em
          cookie cifrado, e nunca é exibido no navegador.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Compartilhamento</h2>
        <p>
          Não vendemos, cedemos nem compartilhamos dados obtidos da Meta com
          terceiros. Eles são usados apenas para acompanhar o desempenho das
          campanhas da própria empresa.
        </p>
      </section>

      <section id="exclusao" className="space-y-2">
        <h2 className="font-semibold">Exclusão de dados</h2>
        <p>Para remover o acesso e os dados deste aplicativo:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            No Facebook, acesse Configurações → Integrações comerciais e remova o
            aplicativo; ou, no Gerenciador de Negócios, revogue o token do usuário
            do sistema.
          </li>
          <li>
            Envie um pedido para <a className="underline underline-offset-2" href={`mailto:${CONTATO}`}>{CONTATO}</a>.
            Apagamos a credencial armazenada em até 30 dias e confirmamos por e-mail.
          </li>
        </ol>
        <p>O cache de métricas expira sozinho em até 1 hora após a revogação.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Contato</h2>
        <p>
          Dúvidas sobre esta política:{" "}
          <a className="underline underline-offset-2" href={`mailto:${CONTATO}`}>{CONTATO}</a>
        </p>
      </section>
    </main>
  );
}
