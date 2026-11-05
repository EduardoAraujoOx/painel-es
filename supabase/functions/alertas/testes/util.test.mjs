// node --test supabase/functions/alertas/testes/util.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { emailValido, normalizarEmail, tokenValido, igualConstante, verificarOidc, AUDIENCIA, REPOSITORIO, EMISSOR_GITHUB } from '../util.js';

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

async function par() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return { privateKey, jwks: { keys: [{ ...jwk, kid: 'k1', use: 'sig', alg: 'RS256' }] } };
}
async function assinar(privateKey, payload, cab = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const corpo = b64(cab) + '.' + b64(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(corpo));
  return corpo + '.' + Buffer.from(sig).toString('base64url');
}
const AGORA = 1_800_000_000;
const bom = { iss: EMISSOR_GITHUB, aud: AUDIENCIA, exp: AGORA + 300, nbf: AGORA - 10, repository: REPOSITORIO, ref: 'refs/heads/main' };

test('e-mail: formato e normalização', () => {
  assert.equal(normalizarEmail('  Ana@Exemplo.COM '), 'ana@exemplo.com');
  for (const e of ['ana@exemplo.com', 'a.b+c@sub.exemplo.com.br']) assert.ok(emailValido(e), e);
  for (const e of ['', 'ana', 'ana@', '@x.com', 'a b@x.com', 'a@x', 'a@x.com,b@y.com', 'a<b>@x.com', 'a@x.com\nBcc: z@y.com', 'x'.repeat(250) + '@a.com', null, 5]) assert.ok(!emailValido(e), String(e));
});

test('token: 64 hexadecimais', () => {
  assert.ok(tokenValido('a'.repeat(64)));
  for (const t of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), "a".repeat(63) + "'", null]) assert.ok(!tokenValido(t));
});

test('comparação em tempo constante', () => {
  assert.ok(igualConstante('abc123', 'abc123'));
  assert.ok(!igualConstante('abc123', 'abc124'));
  assert.ok(!igualConstante('abc', 'abcd'));
  assert.ok(!igualConstante('', 'x'));
});

test('OIDC: token do fluxo certo passa', async () => {
  const { privateKey, jwks } = await par();
  const c = await verificarOidc(await assinar(privateKey, bom), jwks, AGORA);
  assert.equal(c.repository, REPOSITORIO);
});

test('OIDC: recusa assinatura de outra chave, adulteração e algoritmo diferente', async () => {
  const a = await par(), b = await par();
  await assert.rejects(verificarOidc(await assinar(b.privateKey, bom), a.jwks, AGORA), /assinatura/);
  const t = await assinar(a.privateKey, bom);
  const [h, p, s] = t.split('.');
  await assert.rejects(verificarOidc(`${h}.${b64({ ...bom, ref: 'refs/heads/outra' })}.${s}`, a.jwks, AGORA), /assinatura/);
  await assert.rejects(verificarOidc(await assinar(a.privateKey, bom, { alg: 'none', kid: 'k1' }), a.jwks, AGORA), /algoritmo/);
  await assert.rejects(verificarOidc(await assinar(a.privateKey, bom, { alg: 'RS256', kid: 'desconhecida' }), a.jwks, AGORA), /chave/);
  await assert.rejects(verificarOidc('a.b', a.jwks, AGORA), /malformado/);
  await assert.rejects(verificarOidc(undefined, a.jwks, AGORA), /malformado/);
});

test('OIDC: recusa emissor, público, prazo, repositório e ramo errados', async () => {
  const { privateKey, jwks } = await par();
  const tenta = (mudanca, agora = AGORA) => assinar(privateKey, { ...bom, ...mudanca }).then((t) => verificarOidc(t, jwks, agora));
  await assert.rejects(tenta({ iss: 'https://outro.exemplo' }), /emissor/);
  await assert.rejects(tenta({ aud: 'outro-publico' }), /público/);
  await assert.rejects(tenta({}, AGORA + 301), /expirado/);
  await assert.rejects(tenta({ exp: undefined }), /expirado/);
  await assert.rejects(tenta({ nbf: AGORA + 3600 }), /ainda não/);
  await assert.rejects(tenta({ repository: 'outro/repo' }), /repositório/);
  await assert.rejects(tenta({ ref: 'refs/pull/1/merge' }), /ramo/);
});
