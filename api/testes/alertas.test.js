// Testes da inscrição nos alertas (api/alertas.js). Sem rede: o fetch para a função do Supabase é simulado.
//   node --test api/testes
const test = require('node:test');
const assert = require('node:assert');

process.env.PAINEL_SEGREDO = 'x'.repeat(40);
process.env.PAINEL_SENHA = 'senha-unica-ficticia';
process.env.PAINEL_ACESSO = 'senha';   // prevalece sobre o acesso.json do repositório

const { emitirSessao, COOKIE } = require('../_auth');
const alertas = require('../alertas');

function chamar({ metodo = 'POST', corpo, cookie, origem, host = 'painel.exemplo' } = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader: () => {}, end: (b) => resolve({ status: res.statusCode, corpo: JSON.parse(b) }) };
    const headers = { host };
    if (cookie) headers.cookie = cookie;
    if (origem) headers.origin = origem;
    alertas({ method: metodo, body: corpo, headers }, res);
  });
}

function simularSupabase() {
  const chamadas = [];
  global.fetch = async (url, op) => {
    chamadas.push({ url, corpo: JSON.parse(op.body) });
    return { status: 200, json: async () => ({ ok: true, msg: 'Pronto!' }) };
  };
  return chamadas;
}

const sessao = () => `${COOKIE}=${emitirSessao()}`;

test('sem código e sem sessão do painel: recusa e não chama o Supabase', async () => {
  const chamadas = simularSupabase();
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const r = await chamar({ corpo: { acao: 'assinar', email: 'a@b.co' } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(chamadas.length, 0);
});

test('com sessão do painel e sem código: a função acrescenta o código e repassa', async () => {
  const chamadas = simularSupabase();
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const r = await chamar({ corpo: { acao: 'assinar', email: 'a@b.co' }, cookie: sessao() });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(chamadas[0].corpo.codigo, 'codigo-ficticio');
  assert.strictEqual(chamadas[0].corpo.email, 'a@b.co');
});

test('com sessão, mas sem a variável ALERTAS_CODIGO: avisa que não está ligada', async () => {
  const chamadas = simularSupabase();
  delete process.env.ALERTAS_CODIGO;
  const r = await chamar({ corpo: { acao: 'assinar', email: 'a@b.co' }, cookie: sessao() });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(chamadas.length, 0);
});

test('cookie falso ou vencido não vale como sessão', async () => {
  const chamadas = simularSupabase();
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const r = await chamar({ corpo: { acao: 'assinar', email: 'a@b.co' }, cookie: `${COOKIE}=1.abc` });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(chamadas.length, 0);
});

test('com código no corpo (link do convite): segue como antes, sem sessão e sem usar a variável', async () => {
  const chamadas = simularSupabase();
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const r = await chamar({ corpo: { acao: 'assinar', email: 'a@b.co', codigo: 'do-convite' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(chamadas[0].corpo.codigo, 'do-convite');
});

test('sair continua público e não leva código', async () => {
  const chamadas = simularSupabase();
  process.env.ALERTAS_CODIGO = 'codigo-ficticio';
  const r = await chamar({ corpo: { acao: 'sair', t: 'a'.repeat(64) } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(chamadas[0].corpo.codigo, undefined);
});

test('pedido de outro site e método errado continuam recusados', async () => {
  simularSupabase();
  assert.strictEqual((await chamar({ corpo: { acao: 'sair', t: 'a'.repeat(64) }, origem: 'https://outro.site' })).status, 403);
  assert.strictEqual((await chamar({ metodo: 'GET' })).status, 405);
});
