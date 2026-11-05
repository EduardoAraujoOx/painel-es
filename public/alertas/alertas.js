(() => {
  'use strict';
  // Página de cadastro de alertas: formulário (com o código do convite vindo do link), e os botões de confirmar e de sair (links dos e-mails).
  // Confirmar e sair só acontecem ao apertar o botão: um programa de segurança do e-mail que "abre" os links não confirma nem cancela nada sozinho.
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
  if ((acao === 'confirmar' || acao === 'sair') && /^[0-9a-f]{64}$/.test(t)) {
    const conf = acao === 'confirmar';
    $('titulo').textContent = conf ? 'Confirmar o cadastro' : 'Sair da lista de alertas';
    $('explica').textContent = conf ? 'Aperte o botão para confirmar que este e-mail deve receber os resumos do painel.' : 'Aperte o botão para deixar de receber os resumos do painel.';
    const b = $('botao-acao');
    b.textContent = conf ? 'Confirmar cadastro' : 'Sair da lista';
    $('acao').hidden = false;
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await chamar({ acao, t });
      retorno(r.msg, r.ok);
      if (r.ok) $('acao').hidden = true; else b.disabled = false;
    });
    return;
  }

  $('form-assinar').hidden = false;
  const c = q.get('c');
  if (c) $('codigo').value = c.slice(0, 64);
  $('form-assinar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { retorno('Informe um e-mail válido.', false); return; }
    const botao = ev.submitter || ev.target.querySelector('button[type=submit]');
    botao.disabled = true;
    const r = await chamar({ acao: 'assinar', email, codigo: $('codigo').value.trim(), site: $('site').value });
    retorno(r.msg, r.ok);
    botao.disabled = false;
  });
})();
