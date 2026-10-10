// Entrega os arquivos de data/<módulo>/ somente a quem tem sessão válida.
//   GET /api/dados?mod=cargos&arq=index
//   GET /api/dados?mod=cargos&arq=org/SEFAZ
// Cada módulo do painel guarda seus dados em data/<módulo>/.
const fs = require('fs');
const path = require('path');
const { sessaoValida, lerCookie, responder, acessoAberto } = require('./_auth');

const RAIZ = process.cwd();
const PASTA = process.env.DADOS_DIR || 'data'; // variável usada só nos testes locais

// Listas fechadas de caracteres: nada de pontos ou barras fora do formato <pasta>/<nome>.
const RE_MODULO = /^[a-z0-9_-]{1,30}$/;
const RE_ARQUIVO = /^[A-Za-z0-9_-]{1,60}(\/[A-Za-z0-9_-]{1,60})?$/;

module.exports = (req, res) => {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'método não permitido' });
  let autorizado = false;
  try {
    autorizado = acessoAberto() || sessaoValida(lerCookie(req));
  } catch (e) {
    return responder(res, 503, { erro: 'acesso não configurado' });
  }
  if (!autorizado) return responder(res, 401, { erro: 'sessão ausente ou expirada' });

  const url = new URL(req.url, 'http://x');
  const modulo = url.searchParams.get('mod') || '';
  const arq = url.searchParams.get('arq') || '';
  if (!RE_MODULO.test(modulo) || !RE_ARQUIVO.test(arq)) return responder(res, 400, { erro: 'pedido inválido' });

  const base = path.join(RAIZ, PASTA, modulo);
  const caminho = path.join(base, arq + '.json');
  if (!caminho.startsWith(base + path.sep)) return responder(res, 400, { erro: 'pedido inválido' });

  let conteudo;
  try {
    conteudo = fs.readFileSync(caminho);
  } catch (e) {
    return responder(res, 404, { erro: 'não encontrado' });
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(conteudo);
};
