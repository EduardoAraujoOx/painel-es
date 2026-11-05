// Funções puras do cadastro de alertas, sem dependência de Deno nem do Supabase, para poderem ser testadas em Node
// (node --test supabase/functions/alertas/testes/util.test.mjs). Usadas por index.ts.

export const REPOSITORIO = 'EduardoAraujoOx/painel-es';
export const AUDIENCIA = 'painel-es-alertas';
export const EMISSOR_GITHUB = 'https://token.actions.githubusercontent.com';

const RE_EMAIL = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;

export function normalizarEmail(e) {
  return String(e ?? '').trim().toLowerCase();
}

export function emailValido(e) {
  return typeof e === 'string' && e.length <= 254 && RE_EMAIL.test(e);
}

// token de 64 caracteres hexadecimais (confirmar e sair)
export function tokenValido(t) {
  return typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);
}

// comparação em tempo constante (não vaza, pelo tempo, quantos caracteres batem)
export function igualConstante(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''));
  const y = new TextEncoder().encode(String(b ?? ''));
  let d = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

function b64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const lerJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

// Verifica um token OIDC do GitHub Actions: assinatura RS256 com a chave pública do GitHub (jwks), emissor, público, prazo,
// repositório e ramo. Só o fluxo desta repositório, no ramo main, pode pedir a lista de assinantes. Lança Error se algo falhar.
export async function verificarOidc(token, jwks, agoraS, opcoes = {}) {
  const { audiencia = AUDIENCIA, repositorio = REPOSITORIO, ref = 'refs/heads/main' } = opcoes;
  const partes = String(token ?? '').split('.');
  if (partes.length !== 3) throw new Error('token malformado');
  const cab = lerJson(partes[0]);
  if (cab.alg !== 'RS256') throw new Error('algoritmo não aceito');
  const jwk = (jwks?.keys ?? []).find((k) => k.kid === cab.kid && k.kty === 'RSA');
  if (!jwk) throw new Error('chave desconhecida');
  const chave = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chave, b64url(partes[2]), new TextEncoder().encode(partes[0] + '.' + partes[1]));
  if (!ok) throw new Error('assinatura inválida');
  const c = lerJson(partes[1]);
  if (c.iss !== EMISSOR_GITHUB) throw new Error('emissor inválido');
  if (c.aud !== audiencia) throw new Error('público inválido');
  if (typeof c.exp !== 'number' || c.exp <= agoraS) throw new Error('token expirado');
  if (typeof c.nbf === 'number' && c.nbf > agoraS + 60) throw new Error('token ainda não vale');
  if (c.repository !== repositorio) throw new Error('repositório não autorizado');
  if (c.ref !== ref) throw new Error('ramo não autorizado');
  return c;
}
