import { test } from "node:test";
import assert from "node:assert/strict";
import { mask, parseAccounts } from "./format.ts";

test("mask nunca revela o miolo do segredo", () => {
  const token = "EAAG1234567890abcdefghijklmnopqrstuvwxyz9876";
  const masked = mask(token);

  assert.ok(masked.startsWith("EAAG12"), "mantém o começo, para reconhecer qual é");
  assert.ok(masked.endsWith("9876"), "mantém o fim");
  assert.ok(
    !masked.includes("abcdefghij"),
    "o miolo não pode aparecer — é o vazamento que a máscara existe para evitar",
  );
  assert.ok(masked.length < token.length, "a máscara é mais curta que o segredo");
});

test("mask esconde por completo um segredo curto", () => {
  // Curto demais para mostrar pontas sem entregar quase tudo.
  assert.equal(mask("abc123"), "••••••");
  assert.equal(mask("123456789012"), "••••••••••••");
  assert.equal(mask(""), "", "vazio continua vazio, não vira bolinhas");
});

test("parseAccounts lê o formato id:nome separado por barra", () => {
  assert.deepEqual(parseAccounts("841618581984716:MS&CO|1410365954445708:CA01 Guilherme"), [
    { id: "841618581984716", name: "MS&CO" },
    { id: "1410365954445708", name: "CA01 Guilherme" },
  ]);
});

test("parseAccounts tolera entrada bagunçada", () => {
  // Sem nome: cai para o próprio id.
  assert.deepEqual(parseAccounts("123"), [{ id: "123", name: "123" }]);
  // Espaços, entradas vazias e barra sobrando.
  assert.deepEqual(parseAccounts("  123 : Conta A ||"), [{ id: "123", name: "Conta A" }]);
  // Nome com dois-pontos permanece inteiro.
  assert.deepEqual(parseAccounts("123:V4: MS&CO"), [{ id: "123", name: "V4: MS&CO" }]);
  // Id não-numérico é descartado: viraria act_<lixo> na URL da Graph API.
  assert.deepEqual(parseAccounts("act_123:Errado|456:Certo"), [
    { id: "456", name: "Certo" },
  ]);
  assert.deepEqual(parseAccounts(undefined), []);
  assert.deepEqual(parseAccounts(""), []);
});
