(() => {
  'use strict';
  // Módulo "Notícias": manchetes da imprensa capixaba sobre o governo do Estado e a transição, desde a eleição, da mais
  // recente para a mais antiga (pipeline/noticias/coletar.py). Só título, veículo, data e link; a matéria é lida no veículo.
  const { el, nInt, norm } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  const POR_VEZ = 40;
  const DESTAQUES = 4;
  const filtros = { tema: '', busca: '' };
  let visiveis = POR_VEZ;

  const FUSO = 'America/Sao_Paulo';
  const diaChave = (d) => d.toLocaleDateString('sv-SE', { timeZone: FUSO });
  const diaRotulo = (d) => { const t = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); };
  const hora = (d) => d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const dataBR = (aaaammdd) => aaaammdd.split('-').reverse().join('/');
  const ha = (d) => {
    const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (min < 60) return `há ${min} min`;
    return min < 1440 ? `há ${Math.floor(min / 60)} h` : null;
  };
  // O link vem de feed de terceiros: só http(s) vira href.
  const hrefSeguro = (u) => (/^https?:\/\//i.test(u) ? u : null);
  const seloTema = (t) => el('span', { class: 'selo ' + (t === 'transicao' ? 'n-m' : 'n-i') }, el('b', {}, dados.temas[t] || t));
  const temFiltro = () => !!(filtros.tema || filtros.busca.trim());

  function filtrar() {
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    return dados.itens.filter((i) => {
      if (filtros.tema && !i.temas.includes(filtros.tema)) return false;
      if (termos.length) { const t = norm(i.titulo + ' ' + i.veiculo); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function tituloLink(i) {
    const href = hrefSeguro(i.url);
    return href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, i.titulo) : el('span', {}, i.titulo);
  }
  function meta(i, comHa) {
    const d = new Date(i.data);
    const outras = (i.outras || []).filter((o) => hrefSeguro(o.url)).map((o) => el('a', { href: o.url, target: '_blank', rel: 'noopener noreferrer' }, o.veiculo));
    return el('div', { class: 'noticia-meta' }, el('span', { class: 'noticia-veiculo' }, i.veiculo), el('span', {}, comHa && ha(d) ? `${hora(d)} · ${ha(d)}` : hora(d)),
      i.temas.map(seloTema),
      outras.length ? el('span', { class: 'noticia-tambem' }, 'também em: ', outras.flatMap((a, k) => (k ? [', ', a] : [a]))) : null);
  }
  const linha = (i) => el('li', { class: 'noticia' }, el('div', { class: 'noticia-titulo' }, tituloLink(i)), meta(i, false));

  // Lista agrupada por dia, da mais recente para a mais antiga.
  function porDia(itens) {
    const blocos = [];
    let diaAtual = null, ul = null;
    for (const i of itens) {
      const d = new Date(i.data), chave = diaChave(d);
      if (chave !== diaAtual) {
        diaAtual = chave;
        ul = el('ul', { class: 'noticias' });
        blocos.push(el('section', { class: 'noticias-dia' }, el('h3', {}, diaRotulo(d)), ul));
      }
      ul.append(linha(i));
    }
    return blocos;
  }

  function renderLista(c, lista) {
    if (!lista.length) return c.replaceChildren(el('p', { class: 'vazio' }, 'Nenhuma notícia corresponde à busca.'));
    // Capa: manchete e destaques só na visão completa; com busca ou tema, vira lista simples.
    const capa = !temFiltro();
    const [manchete, ...resto] = capa ? lista : [null, ...lista];
    const destaques = capa ? resto.slice(0, DESTAQUES) : [];
    const demais = capa ? resto.slice(DESTAQUES) : resto;
    const pedaco = demais.slice(0, visiveis);
    c.replaceChildren(
      capa ? el('article', { class: 'manchete' }, el('div', { class: 'kicker' }, 'Mais recente'), el('h3', { class: 'manchete-titulo' }, tituloLink(manchete)), meta(manchete, true)) : null,
      destaques.length ? el('div', { class: 'destaques' }, destaques.map((i) => el('article', { class: 'destaque' }, el('h4', {}, tituloLink(i)), meta(i, true)))) : null,
      ...porDia(pedaco),
      demais.length > visiveis ? el('div', { class: 'ferramentas' }, el('button', { type: 'button', class: 'botao', onclick: () => { visiveis += POR_VEZ; atualizarLista(); } },
        `Mostrar mais (${nInt.format(demais.length - visiveis)} restantes)`)) : null);
  }

  function atualizarLista() {
    if (!raiz || !dados || !$('#lista')) return;
    const lista = filtrar();
    $('#resumo').textContent = temFiltro() ? `${nInt.format(lista.length)} ${lista.length === 1 ? 'notícia' : 'notícias'} na busca` : '';
    renderLista($('#lista'), lista);
  }

  function chips() {
    const conta = (t) => dados.itens.filter((i) => !t || i.temas.includes(t)).length;
    const um = (valor, rotulo) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.tema === valor),
      onclick: () => { filtros.tema = valor; visiveis = POR_VEZ; render(); } }, rotulo, el('small', {}, nInt.format(conta(valor))));
    return [um('', 'Todas'), ...Object.entries(dados.temas).filter(([t]) => conta(t)).map(([t, r]) => um(t, r))];
  }

  function render() {
    if (!raiz || !dados || !$('#lista')) return;
    const agora = Date.now();
    const ult24 = dados.itens.filter((i) => new Date(i.data).getTime() >= agora - 86400000).length;
    $('#faixa-dados').replaceChildren(el('b', {}, nInt.format(dados.itens.length)), ` notícias desde a eleição (${dataBR(dados.desde)}) · `, el('b', {}, nInt.format(ult24)), ' nas últimas 24 horas');
    $('#atualizado').textContent = `Atualizado em ${dataHora(dados.gerado_em)}`;
    $('#chips').replaceChildren(...chips());
    atualizarLista();
  }

  let recarregando = false;
  async function recarregar() {
    if (recarregando) return;
    recarregando = true;
    const botao = $('#recarregar'), aviso = $('#aviso-recarga');
    botao.disabled = true; botao.textContent = 'Atualizando…'; aviso.textContent = '';
    try {
      const r = await fetch('/api/dados?mod=noticias&arq=index', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) { PF.mostrarLogin(); return; }
      if (!r.ok) throw new Error(String(r.status));
      const novo = await r.json();
      const antes = new Set(dados.itens.map((i) => i.id));
      const n = novo.itens.filter((i) => !antes.has(i.id)).length;
      dados = novo;
      render();
      $('#metodo').replaceChildren(metodo());
      aviso.textContent = n ? `${nInt.format(n)} ${n === 1 ? 'notícia nova' : 'notícias novas'}.` : 'Sem notícias novas desde a última coleta.';
    } catch (e) {
      aviso.textContent = 'Não foi possível atualizar agora.';
    } finally {
      recarregando = false; botao.disabled = false; botao.textContent = 'Atualizar';
    }
  }

  function metodo() {
    const falhas = dados.fontes.filter((f) => !f.ok).length;
    const lista = dados.fontes.map((f) => el('li', {}, el('b', {}, f.fonte), ' · ', f.consulta.length > 90 ? f.consulta.slice(0, 90) + '…' : f.consulta, ': ',
      f.ok ? `${nInt.format(f.lidos)} lidas, ${nInt.format(f.aceitos)} aceitas` : el('span', { class: 'noticia-erro' }, 'sem resposta')));
    return el('details', { class: 'cartao noticias-metodo' }, el('summary', {}, 'Fonte e método'),
      el('p', {}, 'Uma rotina automática consulta, a cada duas horas, o Google Notícias (consultas sobre o governo do Estado, incluindo buscas dentro de veículos que não permitem leitura direta) e os feeds RSS de A Gazeta, Folha Vitória e ES Hoje. O painel guarda apenas título, veículo, data de publicação e link; o texto da matéria fica no site do veículo. Aparecem as notícias publicadas desde a eleição, da mais recente para a mais antiga.'),
      el('p', {}, 'Uma notícia entra quando o título cita o governo estadual, um órgão do Estado, a transição ou os nomes acompanhados, ou quando trata de finanças, contratos, pessoal ou controle e menciona o Espírito Santo. Notícias policiais e de acidente só ficam se tiverem também tema de transição, finanças, contratos ou pessoal. Os temas são marcados por regras de palavras no título (arquivo pipeline/noticias/config.json): servem para indicar onde olhar, podem errar e não substituem a leitura da notícia.'),
      el('p', {}, 'O Google Notícias não devolve a mesma lista a cada consulta, então uma coleta isolada pode deixar passar matérias; as coletas repetidas se acumulam e reduzem essa perda, mas a lista não é garantidamente completa. O botão Atualizar recarrega o que já foi coletado; ele não dispara uma coleta nova.'),
      el('p', {}, `Última coleta com novidades: ${dataHora(dados.gerado_em)} (horário de Brasília). Fontes na última coleta: ${nInt.format(dados.fontes.length - falhas)} de ${nInt.format(dados.fontes.length)} responderam.`),
      el('ul', { class: 'noticias-fontes' }, lista));
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Notícias</h2>
          <p class="sub">O que a imprensa capixaba publica sobre o governo do Estado e a transição, desde a eleição. Mostra o título e leva à matéria no site do veículo.</p>
        </div>
      </div>
      <div class="faixa-noticias">
        <span id="faixa-dados"></span>
        <span class="faixa-acoes"><span id="atualizado" class="mesref"></span><button id="recarregar" type="button" class="botao">Atualizar</button><span id="aviso-recarga" class="mesref" role="status"></span></span>
      </div>
      <div class="cartao">
        <div class="filtros">
          <label class="busca">Buscar nas manchetes<input id="busca" type="search" maxlength="80" placeholder="Ex.: orçamento, secretaria, auditoria, Sefaz…"></label>
        </div>
        <div id="chips" class="chips" role="group" aria-label="Filtrar por tema"></div>
        <p id="resumo" class="mesref"></p>
        <div id="lista"></div>
      </div>
      <div id="metodo"></div>
    </section>`;

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar as notícias.'));
      return false;
    }
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(atualizarLista, 150); });
    $('#recarregar').addEventListener('click', recarregar);
    $('#metodo').replaceChildren(metodo());
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; visiveis = POR_VEZ; }
  PF.registrar({ id: 'noticias', titulo: 'Notícias', montar, aoNavegar, desmontar });
})();
