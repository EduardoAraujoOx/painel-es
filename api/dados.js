// Entrega os arquivos de data/ somente a quem tem sessão válida.
//   GET /api/dados?arq=index
//   GET /api/dados?arq=org&sigla=SEFAZ
const fs = require('fs');
const path = require('path');
const { sessaoValida, lerCookie, responder } = require('./_auth');

const RAIZ = process.cwd();
const PASTA = process.env.DADOS_DIR || 'data'; // variável usada só nos testes locais

module.exports = (req, res) => {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'método não permitido' });
  let autorizado = false;
  try {
    autorizado = sessaoValida(lerCookie(req));
  } catch (e) {
    return responder(res, 503, { erro: 'acesso não configurado' });
  }
  if (!autorizado) return responder(res, 401, { erro: 'sessão ausente ou expirada' });

  const url = new URL(req.url, 'http://x');
  const arq = url.searchParams.get('arq');
  let caminho;
  if (arq === 'index') {
    caminho = path.join(RAIZ, PASTA, 'index.json');
  } else if (arq === 'org') {
    const sigla = url.searchParams.get('sigla') || '';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(sigla)) return responder(res, 400, { erro: 'órgão inválido' });
    caminho = path.join(RAIZ, PASTA, 'org', sigla + '.json');
  } else {
    return responder(res, 400, { erro: 'arquivo inválido' });
  }

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
