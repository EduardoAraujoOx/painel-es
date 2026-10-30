(() => {
  'use strict';
  // Módulo "Notícias": manchetes da imprensa capixaba sobre o governo do Estado e a transição, coletadas todo dia
  // (pipeline/noticias/coletar.py). Mostra só título, veículo, data e link; a matéria é lida no site do veículo.
  const { el, nInt, norm } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  const PERIODOS = [['1', 'Últimas 24 horas'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['0', 'Todo o período guardado']];
  const POR_VEZ = 60;
  const filtros = { tema: '', veiculo: '', periodo: '7', busca: '' };
  let visiveis = POR_VEZ;

  const FUSO = 'America/Sao_Paulo';
  const diaChave = (d) => d.toLocaleDateString('sv-SE', { timeZone: FUSO });
  const diaRotulo = (d) => { const t = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); };
  const hora = (d) => d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const kpi = (rotulo, valor, nota) => el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  // O link vem de feed de terceiros: só http(s) vira href.
  const hrefSeguro = (u) => (/^https?:\/\//i.test(u) ? u : null);
  const seloTema = (t) => el('span', { class: 'selo ' + (t === 'transicao' ? 'n-m' : 'n-i') }, el('b', {}, dados.temas[t] || t));

  function filtrar() {
    const agora = Date.now();
    const corte = filtros.periodo === '0' ? 0 : agora - Number(filtros.periodo) * 86400000;
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    return dados.itens.filter((i) => {
      if (new Date(i.data).getTime() < corte) return false;
      if (filtros.tema === 'outros' ? i.temas.length : filtros.tema && !i.temas.includes(filtros.tema)) return false;
      if (filtros.veiculo && i.veiculo !== filtros.veiculo) return false;
      if (termos.length) { const t = norm(i.titulo + ' ' + i.veiculo); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function linha(i) {
    const d = new Date(i.data);
    const href = hrefSeguro(i.url);
    const titulo = href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, i.titulo) : el('span', {}, i.titulo);
    const outras = (i.outras || []).filter((o) => hrefSeguro(o.url)).map((o) => el('a', { href: o.url, target: '_blank', rel: 'noopener noreferrer' }, o.veiculo));
    return el('li', { class: 'noticia' },
      el('div', { class: 'noticia-titulo' }, titulo),
      el('div', { class: 'noticia-meta' }, el('span', { class: 'noticia-veiculo' }, i.veiculo), el('span', {}, hora(d)),
        i.temas.map(seloTema),
        outras.length ? el('span', { class: 'noticia-tambem' }, 'também em: ', outras.flatMap((a, k) => (k ? [', ', a] : [a]))) : null));
  }

  function renderLista(c, lista) {
    if (!lista.length) return c.replaceChildren(el('p', { class: 'vazio' }, 'Nenhuma notícia corresponde aos filtros.'));
    const pedaco = lista.slice(0, visiveis);
    const blocos = [];
    let diaAtual = null, ul = null;
    for (const i of pedaco) {
      const d = new Date(i.data), chave = diaChave(d);
      if (chave !== diaAtual) {
        diaAtual = chave;
        ul = el('ul', { class: 'noticias' });
        blocos.push(el('section', { class: 'noticias-dia' }, el('h3', {}, diaRotulo(d)), ul));
      }
      ul.append(linha(i));
    }
    c.replaceChildren(...blocos, lista.length > visiveis
      ? el('div', { class: 'ferramentas' }, el('button', { type: 'button', class: 'botao', onclick: () => { visiveis += POR_VEZ; render(); } },
        `Mostrar mais (${nInt.format(lista.length - visiveis)} restantes)`)) : null);
  }

  function render() {
    if (!raiz || !dados || !$('#lista')) return;
    const agora = Date.now();
    const nas = (dias) => dados.itens.filter((i) => new Date(i.data).getTime() >= agora - dias * 86400000);
    const atencao = (lista) => lista.filter((i) => i.temas.some((t) => t !== 'governador')).length;
    const falhas = dados.fontes.filter((f) => !f.ok).length;
    const veiculos = [...new Set(dados.itens.map((i) => i.veiculo))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const sel = (campo, opcoes, rotulo) => el('label', {}, rotulo, el('select', { onchange: (ev) => { filtros[campo] = ev.target.value; visiveis = POR_VEZ; render(); } },
      opcoes.map(([v, r]) => el('option', { value: v, selected: filtros[campo] === v }, r))));
    const temas = Object.entries(dados.temas).map(([v, r]) => [v, r]);

    $('#kpis').replaceChildren(
      kpi('Últimas 24 horas', nInt.format(nas(1).length), `${nInt.format(atencao(nas(1)))} com tema de atenção (transição, finanças, contratos, pessoal ou controle)`),
      kpi('Últimos 7 dias', nInt.format(nas(7).length), `${nInt.format(atencao(nas(7)))} com tema de atenção`),
      kpi('Guardadas', nInt.format(dados.itens.length), `últimos ${nInt.format(dados.retencao_dias)} dias`),
      kpi('Fontes lidas na última coleta', `${nInt.format(dados.fontes.length - falhas)} de ${nInt.format(dados.fontes.length)}`, falhas ? `${nInt.format(falhas)} sem resposta: veja "Fonte e método"` : 'todas responderam'));

    $('#filtros').replaceChildren(
      sel('periodo', PERIODOS, 'Período'),
      sel('tema', [['', 'Todos os temas'], ...temas, ['outros', 'Sem tema específico']], 'Tema'),
      sel('veiculo', [['', 'Todos os veículos'], ...veiculos.map((v) => [v, v])], 'Veículo'),
      el('label', { class: 'busca' }, 'Buscar no título', el('input', { type: 'search', value: filtros.busca, placeholder: 'Ex.: orçamento, secretaria, auditoria…', maxlength: 80,
        oninput: (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(render.t); render.t = setTimeout(atualizarLista, 150); } })));
    atualizarLista();
  }
  function atualizarLista() {
    const lista = filtrar();
    $('#resumo').textContent = `(${nInt.format(lista.length)})`;
    renderLista($('#lista'), lista);
  }

  function metodo() {
    const lista = dados.fontes.map((f) => el('li', {}, el('b', {}, f.fonte), ' · ', f.consulta.length > 90 ? f.consulta.slice(0, 90) + '…' : f.consulta, ': ',
      f.ok ? `${nInt.format(f.lidos)} lidas, ${nInt.format(f.aceitos)} aceitas` : el('span', { class: 'noticia-erro' }, 'sem resposta')));
    return el('details', { class: 'cartao noticias-metodo' }, el('summary', {}, 'Fonte e método'),
      el('p', {}, 'Uma rotina automática lê, todo dia, o Google Notícias (consultas sobre o governo do Estado, incluindo buscas dentro de veículos que não permitem leitura direta) e os feeds RSS de A Gazeta, Folha Vitória e ES Hoje. O painel guarda apenas título, veículo, data de publicação e link; o texto da matéria fica no site do veículo.'),
      el('p', {}, 'Uma notícia entra quando o título cita o governo estadual, um órgão do Estado, a transição ou os nomes acompanhados, ou quando trata de finanças, contratos, pessoal ou controle e menciona o Espírito Santo. Os temas são marcados por regras de palavras no título (arquivo pipeline/noticias/config.json): servem para indicar onde olhar, podem errar e não substituem a leitura da notícia. Uma notícia sem tema específico é mantida porque citou o governo do Estado.'),
      el('p', {}, `Última coleta: ${dataHora(dados.gerado_em)} (horário de Brasília), com janela de ${nInt.format(dados.janela_dias)} dias. Notícias com mais de ${nInt.format(dados.retencao_dias)} dias saem da lista.`),
      el('ul', { class: 'noticias-fontes' }, lista));
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Notícias</h2>
          <p class="sub">O que a imprensa capixaba publica sobre o governo do Estado e a transição, reunido todo dia. Mostra o título e leva à matéria no site do veículo.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <div id="kpis" class="kpis"></div>
      <div class="cartao">
        <div class="cartao-topo"><div><h2>Manchetes <small id="resumo" class="mesref"></small></h2></div></div>
        <div id="filtros" class="filtros"></div>
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
    $('#mesref').textContent = 'Última coleta: ' + dataHora(dados.gerado_em);
    $('#metodo').replaceChildren(metodo());
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; visiveis = POR_VEZ; }
  PF.registrar({ id: 'noticias', titulo: 'Notícias', montar, aoNavegar, desmontar });
})();
