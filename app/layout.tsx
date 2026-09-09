import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** Archivo carrega rótulo e texto; a largura no peso alto dá o tom do painel. */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/** Mono em todo número: as colunas de dinheiro alinham e a tela lê como telemetria. */
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "V4 Company MS&CO — Painel de Mídia",
  description: "Métricas de tráfego pago e performance de criativos, direto da API da Meta.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full">{children}</body>
    </html>
  );
}
