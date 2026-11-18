const { credencialValida, acessoConfigurado, emitirSessao, cookieSessao, lerCorpo, responder, acessoAberto, DURACAO_S, pseudonimo, FUNCAO_ALERTAS } = require('./_auth');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Conta o login (só dia e quantidade, por um código que não revela o usuário). Nunca atrapalha o login: sem a variável ALERTAS_CODIGO, ou se o Supabase demorar
// ou falhar, segue sem contar. A resposta espera no máximo 1,5 s, porque a Vercel pode encerrar a função assim que ela responde.
async function contarLogin(usuario) {
  const codigo = process.env.ALERTAS_CODIGO;
  if (!codigo) return;
  try {
    await fetch(FUNCAO_ALERTAS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'acesso', codigo, pessoa: pseudonimo(usuario) }), signal: AbortSignal.timeout(1500) });
  } catch (e) { /* sem contagem; o login segue */ }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'método não permitido' });
  if (acessoAberto()) return responder(res, 200, { ok: true, aberto: true });
  if (!acessoConfigurado()) return responder(res, 503, { erro: 'acesso não configurado' });

  let corpo;
  try {
    corpo = await lerCorpo(req);
  } catch (e) {
    return responder(res, 400, { erro: 'requisição inválida' });
  }
  const informada = typeof corpo.senha === 'string' ? corpo.senha : '';
  const usuario = typeof corpo.usuario === 'string' ? corpo.usuario : '';

  if (!credencialValida(usuario, informada)) {
    await espera(900); // atrito contra tentativas em série
    return responder(res, 401, { erro: 'usuário ou senha incorretos' });
  }
  await contarLogin(usuario);
  return responder(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(emitirSessao(), DURACAO_S) });
};
