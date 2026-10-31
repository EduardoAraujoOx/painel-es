(() => {
  'use strict';
  // Botão "Compartilhar": envia o link da seção atual (/noticias, /contratos...), cuja prévia no WhatsApp mostra a imagem de convite
  // daquela seção (public/compartilhar-img/). O link da barra do navegador termina em #/seção, parte que o WhatsApp não lê.
  const botao = document.getElementById('compartilhar');
  if (!botao) return;
  const SECOES_COM_LINK = ['pessoal', 'contratos', 'fundos', 'transicao', 'noticias']; // o endereço não depende do arquivo de textos, que carrega à parte
  let secoes = null;
  fetch('/compartilhar-img/secoes.json').then((r) => (r.ok ? r.json() : null)).then((j) => { secoes = j; }).catch(() => {});
  const rotulo = botao.textContent;
  let t = null;
  const aviso = (txt) => { botao.textContent = txt; clearTimeout(t); t = setTimeout(() => { botao.textContent = rotulo; }, 2400); };
  botao.addEventListener('click', async () => {
    const atual = document.body.dataset.painel;
    const id = SECOES_COM_LINK.includes(atual) ? atual : 'painel';
    const s = secoes && secoes[id]; // sem o arquivo (ainda carregando ou falhou), só o título muda: o link continua o da seção
    const url = location.origin + (id === 'painel' ? '/' : '/' + id);
    try {
      if (navigator.share) { await navigator.share({ title: s ? s.og_titulo : 'Painel Fiscal ES', text: s ? s.og_titulo : 'Painel Fiscal ES', url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; } // cancelou a folha de compartilhar: não copia
    try { await navigator.clipboard.writeText(url); aviso('Link copiado'); } catch (e) { aviso('Copie: ' + url); }
  });
})();
