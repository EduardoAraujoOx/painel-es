const { cookieSessao, responder } = require('./_auth');

module.exports = (req, res) => responder(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao('', 0) });
