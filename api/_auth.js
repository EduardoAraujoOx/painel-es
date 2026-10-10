// Autenticação por senha única compartilhada, com sessão em cookie assinado (HMAC).
// Variáveis de ambiente (configuradas no Vercel, nunca no repositório):
//   PAINEL_SENHA    senha de acesso
//   PAINEL_SEGREDO  chave de assinatura da sessão (>= 32 caracteres)
//   PAINEL_ACESSO   opcional; "aberto" desliga a senha (modo de teste). Prevalece sobre o arquivo acesso.json.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'dfes_sessao';
const DURACAO_S = 12 * 60 * 60;

// Modo de teste: sem senha. Duas formas de ligar, nesta ordem de prioridade:
//   1) variável de ambiente PAINEL_ACESSO ("aberto" liga; qualquer outro valor mantém a senha);
//   2) arquivo acesso.json na raiz do projeto: {"modo": "aberto"} liga; {"modo": "senha"} mantém a senha.
// Na dúvida (arquivo ausente ou ilegível), vale a senha.
function acessoAberto() {
  const env = process.env.PAINEL_ACESSO;
  if (env !== undefined && env !== '') return env === 'aberto';
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'acesso.json'), 'utf8')).modo === 'aberto';
  } catch (e) {
    return false;
  }
}

function segredo() {
  const s = process.env.PAINEL_SEGREDO;
  if (!s || s.length < 32) throw new Error('PAINEL_SEGREDO ausente ou curto demais');
  return s;
}

function assinar(exp) {
  return crypto.createHmac('sha256', segredo()).update(String(exp)).digest('hex');
}

function iguais(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function emitirSessao() {
  const exp = Math.floor(Date.now() / 1000) + DURACAO_S;
  return `${exp}.${assinar(exp)}`;
}

function sessaoValida(token) {
  if (!token) return false;
  const [exp, assinatura] = token.split('.');
  if (!exp || !assinatura || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return iguais(assinatura, assinar(exp));
}

function lerCookie(req) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

function cookieSessao(token, maxAge) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

async function lerCorpo(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  }
  const partes = [];
  let tamanho = 0;
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > 10_000) throw new Error('corpo grande demais');
    partes.push(p);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
}

function responder(res, status, objeto, extras = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  for (const [k, v] of Object.entries(extras)) res.setHeader(k, v);
  res.end(JSON.stringify(objeto));
}

module.exports = {
  COOKIE, DURACAO_S, acessoAberto, iguais, emitirSessao, sessaoValida, lerCookie, cookieSessao, lerCorpo, responder,
};
