// Cadastro de e-mails para os alertas do painel. Repassa ao Supabase (Edge Function "alertas", que guarda a lista) só as três ações
// públicas: assinar, confirmar e sair. A lista e o "marcar enviado" são da porta privada, que só o fluxo do GitHub alcança (token OIDC).
//   POST /api/alertas   {"acao":"assinar","email":"...","codigo":"..."}   |   {"acao":"confirmar","t":"..."}   |   {"acao":"sair","t":"..."}
// Fica de propósito fora da senha do painel: quem recebe o convite se cadastra sem entrar no painel.
const { responder } = require('./_auth');

const FUNCAO = process.env.ALERTAS_FUNCAO_URL || 'https://ecjeuwadpmtvbkcvrxoc.supabase.co/functions/v1/alertas';
const ACOES = new Set(['assinar', 'confirmar', 'sair']);
const MAX_CORPO = 2000;

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body); // a Vercel já leu o JSON
  return new Promise((ok, falha) => {
    let t = '';
    req.on('data', (c) => { t += c; if (t.length > MAX_CORPO) { falha(new Error('grande')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(t || '{}')); } catch (e) { falha(e); } });
    req.on('error', falha);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { ok: false, msg: 'método não permitido' }, { Allow: 'POST' });
  // pedido de outro site (navegador) não passa: só a própria página do painel chama
  const origem = req.headers.origin;
  if (origem) {
    let host = '';
    try { host = new URL(origem).host; } catch (e) { /* origem ilegível: recusa abaixo */ }
    if (host !== req.headers.host) return responder(res, 403, { ok: false, msg: 'origem não permitida' });
  }
  let corpo;
  try { corpo = await lerCorpo(req); } catch (e) { return responder(res, 400, { ok: false, msg: 'pedido inválido' }); }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo) || !ACOES.has(corpo.acao)) return responder(res, 400, { ok: false, msg: 'pedido inválido' });
  // só os campos conhecidos seguem adiante
  const envio = { acao: corpo.acao };
  for (const k of ['email', 'codigo', 't', 'site']) if (typeof corpo[k] === 'string') envio[k] = corpo[k].slice(0, 300);
  try {
    const r = await fetch(FUNCAO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envio), signal: AbortSignal.timeout(15000) });
    let dados;
    try { dados = await r.json(); } catch (e) { dados = { ok: false, msg: 'resposta inesperada' }; }
    return responder(res, r.status >= 200 && r.status < 600 ? r.status : 502, { ok: !!dados.ok, msg: String(dados.msg || '') });
  } catch (e) {
    return responder(res, 502, { ok: false, msg: 'Serviço de cadastro indisponível agora. Tente de novo em instantes.' });
  }
};
