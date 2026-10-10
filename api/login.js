const { iguais, emitirSessao, cookieSessao, lerCorpo, responder, acessoAberto, DURACAO_S } = require('./_auth');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'método não permitido' });
  if (acessoAberto()) return responder(res, 200, { ok: true, aberto: true });
  const senhaCorreta = process.env.PAINEL_SENHA;
  if (!senhaCorreta) return responder(res, 503, { erro: 'acesso não configurado' });

  let corpo;
  try {
    corpo = await lerCorpo(req);
  } catch (e) {
    return responder(res, 400, { erro: 'requisição inválida' });
  }
  const informada = typeof corpo.senha === 'string' ? corpo.senha : '';

  if (!iguais(informada, senhaCorreta)) {
    await espera(900); // atrito contra tentativas em série
    return responder(res, 401, { erro: 'senha incorreta' });
  }
  return responder(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(emitirSessao(), DURACAO_S) });
};
