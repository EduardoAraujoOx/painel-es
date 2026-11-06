// node --test supabase/functions/alertas/testes/api.test.mjs
// Testa o repasse do servidor do painel (api/alertas.js) sem rede: fetch simulado, req/res falsos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../../../../api/alertas.js');

function res() {
  return { status: 0, headers: {}, corpo: '', setHeader(k, v) { this.headers[k] = v; }, end(t) { this.corpo = t; }, set statusCode(v) { this.status = v; }, get statusCode() { return this.status; } };
}
const pedido = (corpo, extra = {}) => ({ method: 'POST', headers: { host: 'painel-es.vercel.app', ...(extra.headers || {}) }, body: corpo, ...extra });

test('repassa só as ações públicas e só os campos conhecidos', async () => {
  const vistos = [];
  globalThis.fetch = async (url, opc) => { vistos.push({ url, corpo: JSON.parse(opc.body) }); return { status: 200, json: async () => ({ ok: true, msg: 'Pronto', segredo: 'x' }) }; };
  const r = res();
  await handler(pedido({ acao: 'assinar', email: 'a@b.com', codigo: 'c', extra: 'nao', ids: [1] }), r);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.corpo), { ok: true, msg: 'Pronto' }); // nada além de ok e msg volta ao navegador
  assert.deepEqual(vistos[0].corpo, { acao: 'assinar', email: 'a@b.com', codigo: 'c' });
  assert.match(vistos[0].url, /supabase\.co\/functions\/v1\/alertas$/);
});

test('a porta privada (lista e marcar) não passa pelo painel', async () => {
  globalThis.fetch = async () => { throw new Error('não devia chamar'); };
  for (const acao of ['lista', 'marcar', 'confirmar', 'x', undefined]) {
    const r = res();
    await handler(pedido({ acao }), r);
    assert.equal(r.status, 400, String(acao));
  }
});

test('só POST, só da própria origem, sem corpo enorme', async () => {
  globalThis.fetch = async () => { throw new Error('não devia chamar'); };
  let r = res();
  await handler({ method: 'GET', headers: {} }, r);
  assert.equal(r.status, 405);
  r = res();
  await handler(pedido({ acao: 'sair', t: 'a'.repeat(64) }, { headers: { host: 'painel-es.vercel.app', origin: 'https://outro-site.com' } }), r);
  assert.equal(r.status, 403);
  r = res();
  await handler(pedido({ acao: 'sair', t: 'a'.repeat(64) }, { headers: { host: 'painel-es.vercel.app', origin: 'não é url' } }), r);
  assert.equal(r.status, 403);
});

test('origem do próprio painel passa; campo longo é cortado; falha da função vira 502', async () => {
  const vistos = [];
  globalThis.fetch = async (url, opc) => { vistos.push(JSON.parse(opc.body)); return { status: 200, json: async () => ({ ok: true, msg: 'ok' }) }; };
  let r = res();
  await handler(pedido({ acao: 'assinar', email: 'a'.repeat(1000) + '@b.com', codigo: 'c' }, { headers: { host: 'painel-es.vercel.app', origin: 'https://painel-es.vercel.app' } }), r);
  assert.equal(r.status, 200);
  assert.equal(vistos[0].email.length, 300);
  globalThis.fetch = async () => { throw new Error('rede'); };
  r = res();
  await handler(pedido({ acao: 'sair', t: 'a'.repeat(64) }), r);
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(r.corpo).ok, false);
});

test('resposta que não é JSON não derruba o painel', async () => {
  globalThis.fetch = async () => ({ status: 500, json: async () => { throw new Error('html'); } });
  const r = res();
  await handler(pedido({ acao: 'sair', t: 'a'.repeat(64) }), r);
  assert.equal(r.status, 500);
  assert.deepEqual(JSON.parse(r.corpo), { ok: false, msg: 'resposta inesperada' });
});
