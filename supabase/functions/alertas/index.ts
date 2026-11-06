// Edge Function "alertas": cadastro de e-mails para receber os resumos do painel (Painel Fiscal ES).
// Uma única função, sem JWT do Supabase (verify_jwt = false), com duas portas:
//   pública (chamada pelo servidor do painel, api/alertas.js):  assinar, sair
//   privada (chamada só pelo fluxo do GitHub, com token OIDC):    lista, marcar
// O banco só é acessado aqui, com a chave de serviço que o próprio Supabase injeta; as tabelas têm RLS ligado e nenhuma política,
// então nada é legível pela chave pública. O cadastro é direto (convite + e-mail, sem clique de confirmação); o envio dos e-mails (boas-vindas e resumos) é feito pelo fluxo do GitHub, que já tem o SMTP.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { emailValido, normalizarEmail, tokenValido, igualConstante, verificarOidc } from './util.js';

const LIMITE_ATIVOS = 80; // assinantes ativos: a lista é de algumas dezenas de pessoas
const LIMITE_PEDIDOS_HORA = 15; // pedidos válidos de cadastro por hora, no total
const LIMITE_FALHAS_HORA = 30; // convites errados por hora, no total: passou disso, tudo é recusado até esfriar
const MAX_CORPO = 4000;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const resp = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const desde = (ms: number) => new Date(Date.now() - ms).toISOString();

let jwksCache: { em: number; jwks: unknown } | null = null;
async function jwks() {
  if (jwksCache && Date.now() - jwksCache.em < 3600_000) return jwksCache.jwks;
  const r = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks');
  if (!r.ok) throw new Error('jwks indisponível');
  jwksCache = { em: Date.now(), jwks: await r.json() };
  return jwksCache.jwks;
}

async function autorizadoGithub(req: Request) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return false;
  try {
    await verificarOidc(m[1], await jwks(), Math.floor(Date.now() / 1000));
    return true;
  } catch {
    return false;
  }
}

async function contar(consulta: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await consulta;
  if (error) throw new Error('consulta falhou');
  return count ?? 0;
}

async function assinar(corpo: Record<string, unknown>) {
  if (corpo.site) return resp(200, { ok: true, msg: 'Pedido recebido.' }); // campo-isca preenchido por robôs: finge que deu certo
  const email = normalizarEmail(corpo.email);
  if (!emailValido(email)) return resp(400, { ok: false, msg: 'Informe um e-mail válido.' });

  const falhas = await contar(db.from('alertas_log').select('id', { count: 'exact', head: true }).eq('evento', 'convite_errado').gte('criado_em', desde(3600_000)));
  if (falhas >= LIMITE_FALHAS_HORA) return resp(429, { ok: false, msg: 'Muitas tentativas. Tente de novo mais tarde.' });

  const { data: cfg } = await db.from('alertas_config').select('valor').eq('chave', 'codigo_convite').maybeSingle();
  if (!cfg || !igualConstante(String(corpo.codigo ?? '').trim(), cfg.valor)) {
    await db.from('alertas_log').insert({ evento: 'convite_errado' });
    return resp(403, { ok: false, msg: 'Convite inválido. Use o link que você recebeu.' });
  }

  const pedidos = await contar(db.from('alertas_log').select('id', { count: 'exact', head: true }).eq('evento', 'pedido').gte('criado_em', desde(3600_000)));
  if (pedidos >= LIMITE_PEDIDOS_HORA) return resp(429, { ok: false, msg: 'Muitos pedidos agora. Tente de novo mais tarde.' });
  await db.from('alertas_log').insert({ evento: 'pedido' });

  const resposta = { ok: true, msg: 'Pronto! Você vai receber os resumos do painel (às 8h, 12h e 18h). Em até uma hora chega um e-mail de boas-vindas, com o link para sair da lista.' };
  const agora = new Date().toISOString();
  const { data: atual } = await db.from('alertas_assinantes').select('id, estado').eq('email', email).maybeSingle();
  if (atual?.estado === 'confirmado') return resp(200, resposta); // já está na lista: não revela, nem repete a boas-vindas
  if (atual) { // tinha saído (ou ficou pendente de uma versão anterior): volta à lista e recebe nova boas-vindas
    await db.from('alertas_assinantes').update({ estado: 'confirmado', confirmado_em: agora, confirmacao_enviada_em: null, saiu_em: null }).eq('id', atual.id);
    return resp(200, resposta);
  }
  const ativos = await contar(db.from('alertas_assinantes').select('id', { count: 'exact', head: true }).eq('estado', 'confirmado'));
  if (ativos >= LIMITE_ATIVOS) return resp(409, { ok: false, msg: 'A lista de alertas está cheia. Fale com Eduardo Araújo.' });
  const { error } = await db.from('alertas_assinantes').insert({ email, estado: 'confirmado', confirmado_em: agora });
  if (error) return resp(500, { ok: false, msg: 'Não foi possível registrar agora. Tente de novo.' });
  return resp(200, resposta);
}

async function sair(corpo: Record<string, unknown>) {
  if (!tokenValido(corpo.t)) return resp(400, { ok: false, msg: 'Link inválido.' });
  const { data } = await db.from('alertas_assinantes').select('id, estado').eq('token_sair', corpo.t as string).maybeSingle();
  if (!data) return resp(404, { ok: false, msg: 'Link inválido.' });
  if (data.estado !== 'saiu') await db.from('alertas_assinantes').update({ estado: 'saiu', saiu_em: new Date().toISOString() }).eq('id', data.id);
  return resp(200, { ok: true, msg: 'Pronto: você não receberá mais os resumos.' });
}

// porta privada: o fluxo do GitHub pede os assinantes (para o resumo) e os que ainda não receberam o e-mail de boas-vindas
async function lista() {
  await db.from('alertas_log').delete().lt('criado_em', desde(2 * 86400_000));
  const { data: conf, error: e1 } = await db.from('alertas_assinantes').select('id, email, token_sair, confirmacao_enviada_em').eq('estado', 'confirmado').order('confirmado_em');
  if (e1) return resp(500, { ok: false, msg: 'consulta falhou' });
  const confirmados = conf.map(({ email, token_sair }) => ({ email, token_sair }));
  const novos = conf.filter((c) => !c.confirmacao_enviada_em).map(({ id, email, token_sair }) => ({ id, email, token_sair }));
  return resp(200, { ok: true, confirmados, novos });
}

async function marcar(corpo: Record<string, unknown>) {
  const ids = Array.isArray(corpo.ids) ? corpo.ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)).slice(0, LIMITE_ATIVOS) : [];
  if (ids.length) await db.from('alertas_assinantes').update({ confirmacao_enviada_em: new Date().toISOString() }).in('id', ids);
  return resp(200, { ok: true, marcados: ids.length });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resp(405, { ok: false, msg: 'método não permitido' });
  const texto = await req.text();
  if (texto.length > MAX_CORPO) return resp(413, { ok: false, msg: 'pedido grande demais' });
  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(texto);
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('corpo');
  } catch {
    return resp(400, { ok: false, msg: 'pedido inválido' });
  }
  try {
    switch (corpo.acao) {
      case 'assinar': return await assinar(corpo);
      case 'sair': return await sair(corpo);
      case 'lista': return (await autorizadoGithub(req)) ? await lista() : resp(401, { ok: false, msg: 'não autorizado' });
      case 'marcar': return (await autorizadoGithub(req)) ? await marcar(corpo) : resp(401, { ok: false, msg: 'não autorizado' });
      default: return resp(400, { ok: false, msg: 'ação desconhecida' });
    }
  } catch {
    return resp(500, { ok: false, msg: 'erro interno' });
  }
});
