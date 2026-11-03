// Testes do login por usuário e senha. Sem rede; usa credenciais fictícias.
//   node --test api/testes
const test = require('node:test');
const assert = require('node:assert');

process.env.PAINEL_SEGREDO = 'x'.repeat(40);
process.env.PAINEL_SENHA = 'senha-unica-ficticia';
process.env.PAINEL_USUARIOS = JSON.stringify({ 'Maria.Teste': 'abc@123', outro: 'zzz' });
process.env.PAINEL_ACESSO = 'senha';   // prevalece sobre o acesso.json do repositório

const { credencialValida, acessoConfigurado } = require('../_auth');
const login = require('../login');

function chamar(corpo) {
  return new Promise((resolve) => {
    const cab = {};
    const res = { statusCode: 0, setHeader: (k, v) => { cab[k.toLowerCase()] = v; }, end: (b) => resolve({ status: res.statusCode, cab, corpo: JSON.parse(b) }) };
    login({ method: 'POST', body: corpo, headers: {} }, res);
  });
}

test('usuário e senha corretos; usuário sem distinção de caixa', () => {
  assert.ok(credencialValida('maria.teste', 'abc@123'));
  assert.ok(credencialValida('  MARIA.TESTE ', 'abc@123'));
  assert.ok(credencialValida('outro', 'zzz'));
});

test('senha errada, senha de outro usuário e caixa da senha são recusadas', () => {
  assert.ok(!credencialValida('maria.teste', 'ABC@123'));
  assert.ok(!credencialValida('maria.teste', 'zzz'));
  assert.ok(!credencialValida('inexistente', 'abc@123'));
  assert.ok(!credencialValida('maria.teste', ''));
});

test('sem usuário vale a senha única, e só ela', () => {
  assert.ok(credencialValida('', 'senha-unica-ficticia'));
  assert.ok(!credencialValida('', 'abc@123'));
  assert.ok(!credencialValida('maria.teste', 'senha-unica-ficticia'));
});

test('PAINEL_USUARIOS inválido não libera nada', () => {
  const antes = process.env.PAINEL_USUARIOS;
  for (const ruim of ['{quebrado', '[]', '"texto"', 'null']) {
    process.env.PAINEL_USUARIOS = ruim;
    assert.ok(!credencialValida('maria.teste', 'abc@123'));
  }
  process.env.PAINEL_USUARIOS = antes;
});

test('acesso não configurado quando não há senha única nem usuários', () => {
  const s = process.env.PAINEL_SENHA, u = process.env.PAINEL_USUARIOS;
  delete process.env.PAINEL_SENHA; delete process.env.PAINEL_USUARIOS;
  assert.ok(!acessoConfigurado());
  process.env.PAINEL_SENHA = s; process.env.PAINEL_USUARIOS = u;
  assert.ok(acessoConfigurado());
});

test('endpoint: credenciais certas devolvem 200 e o cookie de sessão; erradas, 401 sem cookie', async () => {
  const bom = await chamar({ usuario: 'Maria.Teste', senha: 'abc@123' });
  assert.equal(bom.status, 200);
  assert.match(bom.cab['set-cookie'], /^dfes_sessao=\d+\.[0-9a-f]+; HttpOnly; Secure; SameSite=Strict/);
  const ruim = await chamar({ usuario: 'Maria.Teste', senha: 'errada' });
  assert.equal(ruim.status, 401);
  assert.equal(ruim.cab['set-cookie'], undefined);
});
