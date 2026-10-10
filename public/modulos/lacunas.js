(() => {
  'use strict';
  // Módulo "Informações a solicitar": lacunas de dados e de transparência encontradas na análise, com a evidência,
  // a decisão que cada informação habilitaria, o que pedir e a quem. Gera a lista para o pedido da equipe de transição.
  const { el, nInt, brlCompacto } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  let tela = '';
  const CHAVE = 'pf.lacunas.v1';
  const STATUS = { pendente: 'A decidir', pedido: 'No pedido', enviado: 'Enviado', parcial: 'Recebido em parte', recebido: 'Recebido', descartado: 'Descartado' };
  const filtros = { area: '', prioridade: '', dest: '', status: '' };
  const pedidoOpc = { evidencias: true, enviados: false };

  function ler() {
    try { const j = JSON.parse(PF.ler(CHAVE) || 'null'); if (j && j.itens) return { titulo: '', intro: '', ...j }; } catch (e) { /* começa vazio */ }
    return { itens: {}, titulo: '', intro: '' };
  }
  let estado = ler();
  const salvar = () => PF.guardar(CHAVE, JSON.stringify(estado));
  const situacao = (id) => (estado.itens[id] && estado.itens[id].status) || 'pendente';
  const nota = (id) => (estado.itens[id] && estado.itens[id].nota) || '';
  function definir(id, campos) { estado.itens[id] = { ...(estado.itens[id] || {}), ...campos }; salvar(); }
  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const kpi = (rotulo, valor, notaTxt) => el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), notaTxt ? el('div', { class: 'nota' }, notaTxt) : null);
  const tagPrioridade = (p, criterio) => el('span', { class: 'selo ' + (p === 'alta' ? 'n-a' : p === 'média' ? 'n-m' : 'n-i'), title: criterio }, el('b', {}, p));
  const rotuloValor = (v) => (v > 0 ? brlCompacto(v) + ' por ano' : '—');

  function baixar(nome, conteudo, tipo) {
    const a = el('a', { href: URL.createObjectURL(new Blob([conteudo], { type: tipo })), download: nome });
    document.body.append(a); a.click(); a.remove();
  }
  function csv(itens) {
    const aspas = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const cab = ['Prioridade', 'Área', 'Título', 'O que falta', 'O que o painel mostra', 'Decisão que habilita', 'O que solicitar', 'A quem', 'Situação', 'Anotação'];
    const l = itens.map((i) => [i.prioridade, i.area, i.titulo, i.lacuna, i.evidencia, i.decisao, i.solicitar, i.destinatarios.join('; '), STATUS[situacao(i.id)], nota(i.id)]);
    return '﻿' + [cab, ...l].map((x) => x.map(aspas).join(';')).join('\r\n');
  }

  function renderLista(c) {
    const todos = dados.itens;
    const lista = todos.filter((i) => (!filtros.area || i.area === filtros.area) && (!filtros.prioridade || i.prioridade === filtros.prioridade)
      && (!filtros.dest || i.destinatarios.includes(filtros.dest)) && (!filtros.status || situacao(i.id) === filtros.status));
    const conta = (p) => todos.filter((i) => i.prioridade === p).length;
    const kp = el('div', { class: 'kpis' },
      kpi('Informações a solicitar', nInt.format(todos.length), `${nInt.format(todos.filter((i) => !i.verificado).length)} ainda a validar com o Estado`),
      kpi('Prioridade alta', nInt.format(conta('alta')), 'habilitam decisões sobre os contratos de maior valor ou tratam de integridade'),
      kpi('Prioridade média', nInt.format(conta('média')), 'informação transversal ou de valor intermediário'),
      kpi('Prioridade baixa', nInt.format(conta('baixa')), 'complementares'),
      kpi('No pedido', nInt.format(todos.filter((i) => situacao(i.id) === 'pedido').length), `${nInt.format(todos.filter((i) => ['enviado', 'parcial', 'recebido'].includes(situacao(i.id))).length)} já enviadas ou recebidas`));
    const unicos = (campo) => [...new Set(todos.flatMap((i) => (Array.isArray(i[campo]) ? i[campo] : [i[campo]])))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const sel = (campo, opcoes, rotulo) => el('label', {}, rotulo, el('select', { onchange: (ev) => { filtros[campo] = ev.target.value; render(); } },
      el('option', { value: '' }, 'Todos'), opcoes.map(([v, r]) => el('option', { value: v, selected: filtros[campo] === v }, r))));
    const barra = el('div', { class: 'filtros' }, sel('prioridade', ['alta', 'média', 'baixa'].map((x) => [x, x[0].toUpperCase() + x.slice(1)]), 'Prioridade'),
      sel('area', unicos('area').map((x) => [x, x]), 'Área'), sel('dest', unicos('destinatarios').map((x) => [x, x]), 'A quem'), sel('status', Object.entries(STATUS), 'Situação'));
    const ferramentas = el('div', { class: 'ferramentas' },
      el('button', { type: 'button', class: 'botao-primario', onclick: () => ctx.irPara('pedido') }, 'Gerar lista para o pedido'),
      el('button', { type: 'button', class: 'botao', onclick: () => { todos.filter((i) => i.prioridade === 'alta' && situacao(i.id) === 'pendente').forEach((i) => definir(i.id, { status: 'pedido' })); render(); } }, 'Colocar as de prioridade alta no pedido'),
      el('button', { type: 'button', class: 'botao', onclick: () => baixar(`informacoes-a-solicitar-${dados.ref}.csv`, csv(lista), 'text/csv;charset=utf-8') }, 'Exportar CSV'));
    const cartoes = lista.map((i) => {
      const bloco = (t, v, forte) => el('div', { class: 'lac-bloco' }, el('h4', {}, t), el('p', forte ? { class: 'forte' } : {}, v));
      return el('article', { class: 'cartao lacuna' },
        el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, i.titulo),
          el('div', { class: 'selos' }, tagPrioridade(i.prioridade, 'Critério: ' + i.criterio), el('span', { class: 'selo n-i' }, i.area), ...i.destinatarios.map((d) => el('span', { class: 'selo n-i' }, '→ ' + d)),
            i.verificado ? null : el('span', { class: 'selo n-m', title: 'A existência da lacuna precisa ser confirmada com o Estado' }, 'a validar'))),
        el('div', { class: 'lac-valor' }, el('small', {}, 'valor anual afetado'), el('strong', {}, rotuloValor(i.valorAfetado)))),
        bloco('O que falta', i.lacuna), bloco('O que o painel mostra', i.evidencia), bloco('Decisão que a informação habilita', i.decisao), bloco('O que solicitar', i.solicitar, true),
        el('div', { class: 'linha-form lac-controle' },
          el('label', {}, 'Situação', el('select', { onchange: (ev) => { definir(i.id, { status: ev.target.value }); render(); } }, Object.entries(STATUS).map(([v, r]) => el('option', { value: v, selected: situacao(i.id) === v }, r)))),
          el('label', { class: 'busca' }, 'Anotação', el('input', { type: 'text', value: nota(i.id), maxlength: 300, placeholder: 'Quem pediu, quando, resposta recebida…', onchange: (ev) => definir(i.id, { nota: ev.target.value.trim() }) }))),
        el('p', { class: 'fonte-lac' }, 'Fonte da evidência: ' + i.fonteEvidencia));
    });
    c.replaceChildren(kp, el('p', { class: 'aviso solto' }, dados.criterioPrioridade), el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, `Lista de informações (${nInt.format(lista.length)})`),
      el('p', {}, 'Lacunas de dados e de transparência que a análise dos contratos e do pessoal encontrou, com o que pedir e a quem. A situação e as anotações ficam salvas neste navegador.'))), ferramentas, barra),
    ...(cartoes.length ? cartoes : [el('p', { class: 'vazio' }, 'Nenhum item corresponde aos filtros.')]));
  }

  function renderPedido(c) {
    const itens = dados.itens.filter((i) => situacao(i.id) === 'pedido' || (pedidoOpc.enviados && ['enviado', 'parcial'].includes(situacao(i.id))));
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const controles = el('div', { class: 'no-print cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Lista para o pedido de informações'),
      el('p', {}, 'Reúne as informações marcadas como "No pedido", agrupadas por destinatário, para compor a solicitação da equipe de transição. Ajuste o título e a introdução, confira a prévia e use "Imprimir ou salvar em PDF".'))),
    el('div', { class: 'filtros' },
      el('label', { class: 'busca' }, 'Título', el('input', { type: 'text', value: estado.titulo, placeholder: 'Solicitação de informações da equipe de transição', maxlength: 180, onchange: (ev) => { estado.titulo = ev.target.value.trim(); salvar(); render(); } })),
      el('label', { class: 'busca' }, 'Introdução (opcional)', el('textarea', { rows: 3, placeholder: 'Contexto, base do pedido, prazo desejado…', onchange: (ev) => { estado.intro = ev.target.value.trim(); salvar(); render(); } }, estado.intro))),
    el('div', { class: 'ferramentas' },
      el('button', { type: 'button', class: 'botao-primario', onclick: () => window.print() }, 'Imprimir ou salvar em PDF'),
      el('button', { type: 'button', class: 'botao', onclick: () => ctx.irPara('') }, 'Voltar à lista'),
      el('label', { class: 'opcao' }, el('input', { type: 'checkbox', checked: pedidoOpc.evidencias, onchange: (ev) => { pedidoOpc.evidencias = ev.target.checked; render(); } }), ' Incluir o contexto observado nos dados'),
      el('label', { class: 'opcao' }, el('input', { type: 'checkbox', checked: pedidoOpc.enviados, onchange: (ev) => { pedidoOpc.enviados = ev.target.checked; render(); } }), ' Incluir os já enviados')));
    if (!itens.length) return c.replaceChildren(controles, el('p', { class: 'vazio' }, 'Nenhuma informação está no pedido. Volte à lista e marque a situação "No pedido".'));
    const porDest = new Map();
    for (const i of itens) for (const d of i.destinatarios) { if (!porDest.has(d)) porDest.set(d, []); porDest.get(d).push(i); }
    let n = 0;
    const secoes = [...porDest.entries()].sort((a, b) => b[1].length - a[1].length).map(([dest, lista]) => el('section', { class: 'rel-orgao' }, el('h3', {}, `${dest} (${nInt.format(lista.length)})`),
      ...lista.map((i) => { n++; return el('div', { class: 'pedido-item' }, el('p', { class: 'pedido-titulo' }, `${n}. ${i.titulo}`),
        el('p', {}, el('b', {}, 'Solicita-se: '), i.solicitar), el('p', {}, el('b', {}, 'Finalidade: '), i.decisao),
        pedidoOpc.evidencias ? el('p', { class: 'pedido-contexto' }, el('b', {}, 'Contexto observado nos dados abertos: '), i.evidencia) : null,
        nota(i.id) ? el('p', { class: 'pedido-contexto' }, el('b', {}, 'Observação: '), nota(i.id)) : null); })));
    const doc = el('article', { class: 'relatorio' },
      el('header', {}, el('p', { class: 'rel-sup' }, 'Painel Fiscal · Espírito Santo · Informações a solicitar'), el('h1', {}, estado.titulo || 'Solicitação de informações da equipe de transição'),
        el('p', { class: 'rel-data' }, `Emitido em ${hoje}. Posição dos dados do painel: ${dataBR(dados.ref)}.`), estado.intro ? el('p', { class: 'rel-intro' }, estado.intro) : null),
      el('section', {}, el('p', {}, `${nInt.format(itens.length)} informações, reunidas por destinatário. As informações referem-se a dados que não estão disponíveis ou estão incompletos nas bases públicas do Estado e são necessárias para a análise dos contratos e do pessoal.`)),
      ...secoes,
      el('section', { class: 'rel-notas' }, el('h3', {}, 'Notas'), el('p', {}, 'O contexto citado resulta da análise de dados abertos do Estado (Portal da Transparência: contratos, empenhos e despesas) e de bases públicas federais. Os números dos contratos referem-se à posição indicada e não implicam juízo sobre a regularidade de qualquer contrato; indicam onde a informação pública não permite a verificação.')));
    c.replaceChildren(controles, doc);
  }

  function render() {
    if (!raiz || !$('#conteudo')) return;
    PF.esconderDica();
    const c = $('#conteudo');
    if (tela === 'pedido') renderPedido(c); else renderLista(c);
  }
  function aoNavegar(resto) {
    if (!dados) return;
    tela = decodeURIComponent(resto || '') === 'pedido' ? 'pedido' : '';
    render();
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Informações a solicitar</h2>
          <p class="sub">Lacunas de dados e de transparência encontradas na análise, com o que pedir ao Estado, a quem e para decidir o quê.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <div id="conteudo"></div>
    </section>`;

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#conteudo').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar os dados.'));
      return false;
    }
    $('#mesref').textContent = 'Referência: ' + dataBR(dados.ref);
    return true;
  }
  function desmontar() { dados = null; estado = ler(); }
  PF.registrar({ id: 'lacunas', titulo: 'Informações a solicitar', montar, aoNavegar, desmontar });
})();
