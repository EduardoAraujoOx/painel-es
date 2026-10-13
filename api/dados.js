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
// Arquivos que só saem com o painel protegido por senha (dado pessoal sensível). Vazio por decisão do dono do painel
// enquanto o endereço não for divulgado; para voltar a proteger a lista nominal: new Set(['politico/pessoas']).
const SO_COM_SENHA = new Set([]);
const RE_MODULO = /^[a-z0-9_-]{1,30}$/;
const RE_ARQUIVO = /^[A-Za-z0-9_-]{1,60}(\/[A-Za-z0-9_-]{1,60})?$/;

module.exports = (req, res) => {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'método não permitido' });
  let autorizado = false, aberto = false;
  try {
    aberto = acessoAberto();
    autorizado = aberto || sessaoValida(lerCookie(req));
  } catch (e) {
    return responder(res, 503, { erro: 'acesso não configurado' });
  }
  if (!autorizado) return responder(res, 401, { erro: 'sessão ausente ou expirada' });

  const url = new URL(req.url, 'http://x');
  const modulo = url.searchParams.get('mod') || '';
  const arq = url.searchParams.get('arq') || '';
  if (!RE_MODULO.test(modulo) || !RE_ARQUIVO.test(arq)) return responder(res, 400, { erro: 'pedido inválido' });

  // Arquivos com dado pessoal sensível (opinião política de pessoas identificadas) só saem com o painel protegido por senha.
  if (aberto && SO_COM_SENHA.has(modulo + '/' + arq)) return responder(res, 403, { erro: 'disponível só com o painel protegido por senha' });

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
  // Navegador: guarda por 5 min, para não baixar de novo a cada toque. Com o painel aberto (sem senha) não há o que proteger,
  // então a rede de distribuição da Vercel também guarda a resposta (por implantação: uma nova implantação zera esse cache,
  // inclusive ao religar a senha) e a resposta sai de perto de quem pede, sem esperar a função acordar. Com senha, só o navegador guarda.
  res.setHeader('Cache-Control', aberto ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' : 'private, max-age=300');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(conteudo);
};
