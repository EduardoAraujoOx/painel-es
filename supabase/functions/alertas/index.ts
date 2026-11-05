// Edge Function "alertas": cadastro de e-mails para receber os resumos do painel (Painel Fiscal ES).
// Uma única função, sem JWT do Supabase (verify_jwt = false), com duas portas:
//   pública (chamada pelo servidor do painel, api/alertas.js):  assinar, confirmar, sair
//   privada (chamada só pelo fluxo do GitHub, com token OIDC):    lista, marcar
// O banco só é acessado aqui, com a chave de serviço que o próprio Supabase injeta; as tabelas têm RLS ligado e nenhuma política,
// então nada é legível pela chave pública. O envio dos e-mails (confirmação e resumos) é feito pelo fluxo do GitHub, que já tem o SMTP.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { emailValido, normalizarEmail, tokenValido, igualConstante, verificarOidc } from './util.js';

const LIMITE_ATIVOS = 80; // confirmados + pendentes: a lista é de algumas dezenas de pessoas
const LIMITE_PEDIDOS_HORA = 15; // pedidos válidos de cadastro por hora, no total
const LIMITE_FALHAS_HORA = 30; // convites errados por hora, no total: passou disso, tudo é recusado até esfriar
const VALIDADE_PENDENTE_DIAS = 7;
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

  const generico = { ok: true, msg: 'Pedido recebido. Em até uma hora você recebe um e-mail para confirmar o cadastro.' };
  const { data: atual } = await db.from('alertas_assinantes').select('id, estado').eq('email', email).maybeSingle();
  if (atual?.estado === 'confirmado') return resp(200, generico); // não revela quem já está na lista
  if (atual) {
    await db.from('alertas_assinantes').update({ estado: 'pendente', confirmacao_enviada_em: null, saiu_em: null, criado_em: new Date().toISOString() }).eq('id', atual.id);
    return resp(200, generico);
  }
  const ativos = await contar(db.from('alertas_assinantes').select('id', { count: 'exact', head: true }).in('estado', ['pendente', 'confirmado']));
  if (ativos >= LIMITE_ATIVOS) return resp(409, { ok: false, msg: 'A lista de alertas está cheia. Fale com Eduardo Araújo.' });
  const { error } = await db.from('alertas_assinantes').insert({ email });
  if (error) return resp(500, { ok: false, msg: 'Não foi possível registrar agora. Tente de novo.' });
  return resp(200, generico);
}

async function confirmar(corpo: Record<string, unknown>) {
  if (!tokenValido(corpo.t)) return resp(400, { ok: false, msg: 'Link inválido.' });
  const { data } = await db.from('alertas_assinantes').select('id, estado, criado_em').eq('token_confirmar', corpo.t as string).maybeSingle();
  if (!data) return resp(404, { ok: false, msg: 'Link inválido ou já usado.' });
  if (data.estado === 'confirmado') return resp(200, { ok: true, msg: 'Cadastro já confirmado. Você vai receber os resumos do painel.' });
  if (data.estado !== 'pendente' || Date.parse(data.criado_em) < Date.now() - VALIDADE_PENDENTE_DIAS * 86400_000) {
    return resp(410, { ok: false, msg: 'Este link expirou. Peça um novo cadastro pelo link do convite.' });
  }
  await db.from('alertas_assinantes').update({ estado: 'confirmado', confirmado_em: new Date().toISOString() }).eq('id', data.id);
  return resp(200, { ok: true, msg: 'Cadastro confirmado. Você vai receber os resumos do painel.' });
}

async function sair(corpo: Record<string, unknown>) {
  if (!tokenValido(corpo.t)) return resp(400, { ok: false, msg: 'Link inválido.' });
  const { data } = await db.from('alertas_assinantes').select('id, estado').eq('token_sair', corpo.t as string).maybeSingle();
  if (!data) return resp(404, { ok: false, msg: 'Link inválido.' });
  if (data.estado !== 'saiu') await db.from('alertas_assinantes').update({ estado: 'saiu', saiu_em: new Date().toISOString() }).eq('id', data.id);
  return resp(200, { ok: true, msg: 'Pronto: você não receberá mais os resumos.' });
}

// porta privada: o fluxo do GitHub pede os confirmados (para o resumo) e os pendentes sem e-mail de confirmação
async function lista() {
  await db.from('alertas_assinantes').delete().eq('estado', 'pendente').lt('criado_em', desde(VALIDADE_PENDENTE_DIAS * 86400_000));
  await db.from('alertas_log').delete().lt('criado_em', desde(2 * 86400_000));
  const { data: conf, error: e1 } = await db.from('alertas_assinantes').select('email, token_sair').eq('estado', 'confirmado').order('confirmado_em');
  const { data: pend, error: e2 } = await db.from('alertas_assinantes').select('id, email, token_confirmar').eq('estado', 'pendente').is('confirmacao_enviada_em', null).order('criado_em');
  if (e1 || e2) return resp(500, { ok: false, msg: 'consulta falhou' });
  return resp(200, { ok: true, confirmados: conf, pendentes: pend });
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
      case 'confirmar': return await confirmar(corpo);
      case 'sair': return await sair(corpo);
      case 'lista': return (await autorizadoGithub(req)) ? await lista() : resp(401, { ok: false, msg: 'não autorizado' });
      case 'marcar': return (await autorizadoGithub(req)) ? await marcar(corpo) : resp(401, { ok: false, msg: 'não autorizado' });
      default: return resp(400, { ok: false, msg: 'ação desconhecida' });
    }
  } catch {
    return resp(500, { ok: false, msg: 'erro interno' });
  }
});
