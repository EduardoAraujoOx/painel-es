const { sessaoValida, lerCookie, responder } = require('./_auth');

// Indica à página se há sessão válida (200) ou se deve mostrar o login (401).
module.exports = (req, res) => {
  try {
    if (sessaoValida(lerCookie(req))) return responder(res, 200, { ok: true });
  } catch (e) {
    return responder(res, 503, { erro: 'acesso não configurado' });
  }
  return responder(res, 401, { erro: 'sessão ausente ou expirada' });
};
