(async () => {
  'use strict';
  // Página de cadastro de alertas: formulário (com o código do convite vindo do link) e o botão de sair (link dos e-mails).
  // Sair só acontece ao apertar o botão: um programa de segurança do e-mail que "abre" o link não cancela nada sozinho.
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const retorno = (txt, ok) => { const r = $('retorno'); r.textContent = txt; r.className = ok ? 'certo' : 'erro'; r.hidden = false; };

  async function chamar(corpo) {
    try {
      const r = await fetch('/api/alertas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => ({}));
      return { ok: !!d.ok, msg: d.msg || (r.ok ? 'Pronto.' : 'Não foi possível concluir. Tente de novo.') };
    } catch (e) {
      return { ok: false, msg: 'Sem conexão. Tente de novo.' };
    }
  }

  const acao = q.get('acao');
  const t = q.get('t') || '';
  if (acao === 'sair' && /^[0-9a-f]{64}$/.test(t)) {
    $('titulo').textContent = 'Sair da lista de alertas';
    $('explica').textContent = 'Aperte o botão para deixar de receber os resumos do painel.';
    const b = $('botao-acao');
    b.textContent = 'Sair da lista';
    $('acao').hidden = false;
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await chamar({ acao: 'sair', t });
      retorno(r.msg, r.ok);
      if (r.ok) $('acao').hidden = true; else b.disabled = false;
    });
    return;
  }

  // Quem entrou no painel só informa o e-mail (a sessão vale como convite); o código só aparece para quem chega por um link de convite sem ter entrado no painel.
  const c = q.get('c');
  let logado = false;
  try { logado = (await fetch('/api/sessao')).ok; } catch (e) { /* sem rede: trata como não logado */ }
  if (logado) {
    $('explica').textContent = 'Resumos por e-mail, às 8h, 12h e 18h, com as notícias do governo do Espírito Santo, os atos do Diário Oficial sobre contratos e as obras paralisadas. Informe o seu e-mail e pronto: chega um e-mail de boas-vindas, e todo resumo traz o link para sair da lista.';
    $('codigo').required = false;
    $('form-assinar').hidden = false;
  } else if (c) {
    $('codigo').value = c.slice(0, 64);
    $('rotulo-codigo').hidden = false;
    $('form-assinar').hidden = false;
  } else {
    $('explica').textContent = 'Para receber os resumos por e-mail, entre no painel e informe o seu e-mail na tela de Notícias.';
    $('botao-entrar').hidden = false;
  }
  $('form-assinar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { retorno('Informe um e-mail válido.', false); return; }
    const botao = ev.submitter || ev.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const codigo = $('rotulo-codigo').hidden ? '' : $('codigo').value.trim(); // sem código, a API usa a sessão do painel
    const r = await chamar({ acao: 'assinar', email, ...(codigo ? { codigo } : {}), site: $('site').value });
    retorno(r.msg, r.ok);
    botao.disabled = false;
  });
})();
