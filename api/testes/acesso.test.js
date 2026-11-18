// Testes da contagem de logins (api/login.js + pseudonimo em api/_auth.js). Sem rede: o fetch para a função do Supabase é simulado.
//   node --test api/testes/acesso.test.js
const test = require('node:test');
const assert = require('node:assert');

process.env.PAINEL_SEGREDO = 'x'.repeat(40);
process.env.PAINEL_SENHA = 'senha-unica-ficticia';
process.env.PAINEL_USUARIOS = JSON.stringify({ 'Maria.Teste': 'abc@123' });
process.env.PAINEL_ACESSO = 'senha';

const { pseudonimo } = require('../_auth');
const login = require('../login');

function entrar(corpo) {
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader: () => {}, end: (b) => resolve({ status: res.statusCode, corpo: JSON.parse(b) }) };
    login({ method: 'POST', body: corpo, headers: {} }, res);
  });
}

function simularSupabase(comportamento) {
  const chamadas = [];
  global.fetch = async (url, op) => {
    chamadas.push({ url, corpo: JSON.parse(op.body) });
    return comportamento ? comportamento() : { status: 200, json: async () => ({ ok: true }) };
  };
  return chamadas;
}

test('o código de pessoa tem 12 hexadecimais, é estável, ignora caixa e não contém o nome', () => {
  const a = pseudonimo('Maria.Teste');
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.strictEqual(a, pseudonimo('  maria.teste '));
  assert.notStrictEqual(a, pseudonimo('outro'));
  assert.notStrictEqual(pseudonimo(''), pseudonimo('outro'));
  assert.ok(!a.includes('maria'));
});

test('login certo: conta uma vez, com código de pessoa e o código do convite, sem o nome', async () => {
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const chamadas = simularSupabase();
  const r = await entrar({ usuario: 'Maria.Teste', senha: 'abc@123' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(chamadas.length, 1);
  assert.deepStrictEqual(chamadas[0].corpo, { acao: 'acesso', codigo: 'codigo-ficticio', pessoa: pseudonimo('maria.teste') });
  assert.ok(!JSON.stringify(chamadas[0].corpo).toLowerCase().includes('maria'));
});

test('senha única também conta, como uma pessoa só', async () => {
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const chamadas = simularSupabase();
  const r = await entrar({ usuario: '', senha: 'senha-unica-ficticia' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(chamadas[0].corpo.pessoa, pseudonimo(''));
});

test('login errado não conta', async () => {
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const chamadas = simularSupabase();
  const r = await entrar({ usuario: 'Maria.Teste', senha: 'errada' });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(chamadas.length, 0);
});

test('sem ALERTAS_CODIGO o login funciona e não tenta contar', async () => {
  delete process.env.ALERTAS_CODIGO;
  const chamadas = simularSupabase();
  const r = await entrar({ usuario: 'Maria.Teste', senha: 'abc@123' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(chamadas.length, 0);
});

test('se o Supabase falhar ou recusar, o login funciona do mesmo jeito', async () => {
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  simularSupabase(() => { throw new Error('rede caiu'); });
  assert.strictEqual((await entrar({ usuario: 'Maria.Teste', senha: 'abc@123' })).status, 200);
  simularSupabase(() => ({ status: 500, json: async () => ({ ok: false }) }));
  assert.strictEqual((await entrar({ usuario: 'Maria.Teste', senha: 'abc@123' })).status, 200);
});
