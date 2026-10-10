(() => {
  'use strict';
  // Módulo "Contratações": contratos vigentes por órgão, fornecedores, quadro societário e alertas de triagem.
  const { el, nInt, brlCompacto, titulo, norm, soma, mostrarDica, esconderDica, dicaLinha, dicaNoElemento, observar,
    graficoBarras, mapaDeBlocos } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);

  let dados = null;
  let CAMPOS = null;
  const cacheOrg = new Map();
  const cacheForn = new Map();
  let listaBusca = null;
  let tokenRender = 0;
  const estado = {
    medida: 'anual', vista: 'mapa', ordemOrgs: { col: 'anualVigente', dir: -1 },
    org: null, forn: null, origem: null, verTodosForn: false, verMaisPrioridades: false,
    f: { situ: 'vigentes', cat: '', modal: '', alerta: '', ess: '', q: '' }, rev: { status: '', motivo: '', org: '', decididos: false, sensivel: false }, msg: '', tela: '', par: { base: 'anual', ess: new Set(), corte: 80, mais: 10, pub: false }, ordem: { col: 'anual', dir: -1 }, limite: 50,
    aberto: new Set(),
  };
  const PESO = { a: 3, m: 1, i: 0 };
  const NIVEL = { a: 'Alta', m: 'Média', i: 'Info' };

  // ---------- utilidades ----------
  const ESS = () => dados.essencialidade;
  const mesesAte = (iso) => (iso ? Math.max(0, Math.round((new Date(iso) - new Date(dados.ref)) / 2629800000)) : null);
  const duracao = (m) => (m == null ? '—' : m < 1 ? 'menos de 1 mês' : m < 24 ? `${m} ${m === 1 ? 'mês' : 'meses'}` : `${(m / 12).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos`);
  const anosDesde = (iso) => (iso ? Math.max(0, (new Date(dados.ref) - new Date(iso)) / 31557600000) : null);
  const tagEss = (e) => el('span', { class: 'tag-ess e-' + e, title: 'Classificação sugerida pelo tipo de objeto; valide com o gestor' }, ESS()[e] || e);
  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const pct = (x) => (x == null ? '—' : x > 0 && x < 0.01 ? '<1%' : (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%');
  const cnpjFmt = (c) => (c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'));
  const nomeProprio = (s) => (s && s === s.toUpperCase() ? titulo(s) : s || '');
  const kpi = (rotulo, valor, nota) => el('div', { class: 'kpi' },
    el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  function abas(opcoes, atual, aoMudar) {
    return el('div', { class: 'abas', role: 'group' }, opcoes.map(([v, r]) =>
      el('button', { type: 'button', 'aria-pressed': String(v === atual), onclick: () => aoMudar(v) }, r)));
  }
  function cabecalhoOrdenavel(cols, atual, aoOrdenar) {
    return el('thead', {}, el('tr', {}, cols.map(([k, r, n]) => el('th', { class: n ? 'num' : '',
      'aria-sort': atual.col === k ? (atual.dir > 0 ? 'ascending' : 'descending') : 'none' },
    k === '-' ? r : el('button', { type: 'button', onclick: () => aoOrdenar(k) }, r + (atual.col === k ? (atual.dir > 0 ? ' ▲' : ' ▼') : ''))))));
  }
  function selo(cod) {
    const [c, n] = cod.split(':');
    const def = dados.alertas[c] || { titulo: c, descricao: '' };
    return el('span', { class: 'selo n-' + n, title: `${NIVEL[n]}: ${def.descricao}` }, el('b', {}, NIVEL[n]), ' ' + def.titulo);
  }
  const selos = (lista, max) => {
    const unicos = [...new Map(lista.map((c) => [c.split(':')[0], c])).values()]
      .sort((x, y) => PESO[y.split(':')[1]] - PESO[x.split(':')[1]]);
    return el('div', { class: 'selos' }, unicos.slice(0, max || 99).map(selo),
      max && unicos.length > max ? el('span', { class: 'selo mais', title: unicos.slice(max).map((c) => dados.alertas[c.split(':')[0]].titulo).join('; ') }, `+${unicos.length - max}`) : null);
  };
  const pontos = (alertas) => soma(alertas, (c) => PESO[c.split(':')[1]]);
  const contrato = (linha) => Object.fromEntries(CAMPOS.map((k, i) => [k, linha[i]]));

  // ---------- navegação ----------
  function irOrg(id) { estado.f = { situ: 'vigentes', cat: '', modal: '', alerta: '', ess: '', q: '' }; estado.limite = 50; estado.aberto.clear(); estado.verTodosForn = false; ctx.irPara(String(id)); }
  function irForn(cnpj, origem) { estado.origem = origem == null ? estado.org : origem; ctx.irPara('f:' + cnpj); }
  function aoNavegar(resto) {
    if (!dados) return;
    const r = decodeURIComponent(resto || '');
    estado.tela = r === 'revisao' || r === 'relatorio' ? r : '';
    estado.forn = r.startsWith('f:') ? r.slice(2) : null;
    const id = !estado.forn && !estado.tela && r ? Number(r) : null;
    estado.org = id && dados.orgs.some((o) => o.id === id) ? id : null;
    if (!estado.forn && !estado.org) estado.origem = null;
    render();
  }
  function renderTrilha() {
    const t = $('#trilha');
    const itens = [el('button', { type: 'button', onclick: () => ctx.irPara('') }, 'Governo do ES')];
    const sep = () => el('span', { class: 'sep' }, '›');
    const orgId = estado.forn ? estado.origem : estado.org;
    const org = orgId && dados.orgs.find((o) => o.id === orgId);
    if (estado.tela === 'revisao') { t.replaceChildren(itens[0], sep(), el('span', { class: 'atual' }, 'Lista de revisão')); return; }
    if (estado.tela === 'relatorio') { t.replaceChildren(itens[0], sep(), el('button', { type: 'button', onclick: () => ctx.irPara('revisao') }, 'Lista de revisão'), sep(), el('span', { class: 'atual' }, 'Relatório')); return; }
    if (!estado.forn && !estado.org) { t.replaceChildren(el('span', { class: 'atual' }, 'Governo do ES')); return; }
    if (org) {
      itens.push(sep());
      itens.push(estado.forn ? el('button', { type: 'button', onclick: () => irOrg(org.id) }, org.nome) : el('span', { class: 'atual' }, org.nome));
    }
    if (estado.forn) { itens.push(sep()); itens.push(el('span', { class: 'atual' }, 'Fornecedor ' + cnpjFmt(estado.forn))); }
    t.replaceChildren(...itens);
  }

  let todosForn = null;
  async function carregarTodosForn() {
    if (!todosForn) todosForn = (await ctx.api('fornecedores')).fornecedores;
    return todosForn;
  }

  // ---------- busca de fornecedor ----------
  async function carregarBusca() {
    if (!listaBusca) listaBusca = (await ctx.api('busca')).map(([c, n, s]) => ({ c, n, s, k: norm(n + ' ' + c + ' ' + s) }));
    return listaBusca;
  }
  function caixaBusca() {
    const saida = el('div', { class: 'resultados', role: 'listbox', hidden: true });
    const campo = el('input', { type: 'search', placeholder: 'Buscar fornecedor, CNPJ ou nome de sócio', autocomplete: 'off', 'aria-label': 'Buscar fornecedor' });
    let tempo;
    campo.addEventListener('input', () => {
      clearTimeout(tempo);
      tempo = setTimeout(async () => {
        const q = norm(campo.value.trim()).replace(/[.\-/]/g, '');
        if (q.length < 3) { saida.hidden = true; return; }
        let lista;
        try { lista = await carregarBusca(); } catch (e) { if (e.sessao) PF.mostrarLogin(); return; }
        const achados = lista.filter((x) => x.k.replace(/[.\-/]/g, '').includes(q)).slice(0, 12);
        saida.replaceChildren(...(achados.length ? achados.map((x) => el('button', { type: 'button', role: 'option', onclick: () => irForn(x.c, null) },
          el('strong', {}, nomeProprio(x.n)), el('small', {}, cnpjFmt(x.c) + (x.s && norm(x.s).includes(q) ? ' · sócio: ' + x.s.split('; ').find((n) => norm(n).includes(q)) : ''))))
          : [el('p', { class: 'vazio' }, 'Nenhum fornecedor encontrado.')]));
        saida.hidden = false;
      }, 200);
    });
    return el('div', { class: 'busca-forn' }, campo, saida);
  }

  // ---------- visão: governo ----------
  function renderGoverno(c) {
    const o = dados.orgs;
    const [aAnt, aAtu] = dados.anosGasto;
    const tot = (k) => soma(o, (x) => x[k]);
    const kp = el('div', { class: 'kpis' },
      kpi('Contratos vigentes', nInt.format(tot('vigentes')), `em ${o.filter((x) => x.vigentes).length} órgãos · posição de ${dataBR(dados.ref)}`),
      kpi('Compromisso anual', brlCompacto(tot('anualVigente')), 'valor dos contratos vigentes distribuído por ano de vigência'),
      kpi('Saldo a executar', brlCompacto(tot('saldoVigente')), 'valor contratado ainda não empenhado no SIGA (que registra só parte da execução)'),
      kpi('Pago aos fornecedores', brlCompacto(tot('pagoAnt') + tot('pagoAtu')), `${aAnt}: ${brlCompacto(tot('pagoAnt'))} · ${aAtu} (até a data): ${brlCompacto(tot('pagoAtu'))} · dinheiro que saiu do caixa (SIGEFES)`),
      kpi('Empenhado nos contratos', brlCompacto(tot('empAnt') + tot('empAtu')), `${aAnt}: ${brlCompacto(tot('empAnt'))} · ${aAtu} (até a data): ${brlCompacto(tot('empAtu'))} · só o que o SIGA registra`),
      kpi('Alertas de nível alto', nInt.format(tot('contratosAlta')), 'contratos com ao menos um sinal alto'));

    const medidas = { anual: ['Compromisso anual dos contratos vigentes', (x) => x.anualVigente], pago: [`Pago em ${aAnt} e ${aAtu}`, (x) => x.pagoAnt + x.pagoAtu], emp: [`Empenhado em ${aAnt} e ${aAtu}`, (x) => x.empAnt + x.empAtu],
      alertas: ['Contratos com alerta alto', (x) => x.contratosAlta] };
    const [rotuloMedida, valorDe] = medidas[estado.medida];
    const cartao = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' },
      el('div', {}, el('h2', {}, 'Quem concentra os contratos'),
        el('p', {}, `Área proporcional a: ${rotuloMedida.toLowerCase()}. Clique num órgão para detalhar.`)),
      el('div', { class: 'grupo-abas' },
        abas([['anual', 'Compromisso anual'], ['pago', 'Pago'], ['emp', 'Empenhado'], ['alertas', 'Alertas']], estado.medida, (v) => { estado.medida = v; render(); }),
        abas([['mapa', 'Mapa'], ['tabela', 'Tabela']], estado.vista, (v) => { estado.vista = v; render(); }))));
    if (estado.vista === 'mapa') {
      const itens = o.map((x) => ({ o: x, v: valorDe(x) })).filter((i) => i.v > 0);
      const mapa = el('div', { class: 'mapa' });
      cartao.append(mapa);
      observar(mapa, (W) => {
        const H = W < 560 ? 380 : 460;
        mapa.style.height = H + 'px';
        mapa.replaceChildren(...mapaDeBlocos(itens, W, H).map((b) => {
          const nos = () => [el('div', { class: 'tit' }, b.o.nome), dicaLinha(null, brlCompacto(b.o.anualVigente), 'compromisso anual'),
            dicaLinha(null, nInt.format(b.o.vigentes), 'contratos vigentes'), dicaLinha(null, brlCompacto(b.o.pagoAnt + b.o.pagoAtu), 'pago no período'), dicaLinha(null, brlCompacto(b.o.empAnt + b.o.empAtu), 'empenhado no período'),
            dicaLinha(null, nInt.format(b.o.contratosAlta), 'contratos com alerta alto')];
          const rotulo = b.w >= 96 && b.h >= 46;
          const btn = el('button', { type: 'button', 'aria-label': `${b.o.nome}: ${brlCompacto(b.o.anualVigente)} por ano em ${b.o.vigentes} contratos`,
            onclick: () => { esconderDica(); irOrg(b.o.id); }, onpointermove: (ev) => mostrarDica(nos(), ev.clientX, ev.clientY),
            onpointerleave: esconderDica, onfocus: () => dicaNoElemento(btn, nos), onblur: esconderDica },
          rotulo ? el('b', {}, b.o.nome.replace(/^(Secretaria de Estado|Secretaria|Departamento Estadual|Departamento|Agência|Instituto|Fundação)\s+(d[aeo]s?\s+)?/i, '').slice(0, 34)) : null,
          rotulo && b.h >= 64 ? el('small', {}, medidas[estado.medida][0].startsWith('Contratos') ? nInt.format(b.v) : brlCompacto(b.v)) : null);
          return el('div', { class: 'bloco' + (rotulo ? ' rot' : ''), style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px` }, btn);
        }));
      });
    } else {
      cartao.append(tabelaOrgs());
    }

    const prior = estado.verMaisPrioridades ? dados.prioridades : dados.prioridades.slice(0, 15);
    const cPrior = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {},
      el('h2', {}, 'Contratos para olhar primeiro'),
      el('p', {}, 'Contratos vigentes de pelo menos R$ 1 milhão por ano, ordenados por pontos de alerta (alto = 3, médio = 1) ponderados pelo valor. É triagem, não conclusão.'))),
    el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Órgão e fornecedor', 'Objeto', 'Por ano', 'Alertas', ''].map((t, i) => el('th', { class: i === 2 ? 'num' : '' }, t)))),
      el('tbody', {}, prior.map((p) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => { irOrg(p.org); },
        onkeydown: (ev) => { if (ev.key === 'Enter') irOrg(p.org); } },
      el('td', {}, el('strong', {}, nomeProprio(p.forn)), el('small', {}, p.orgNome)),
      el('td', { class: 'objeto' }, p.objeto, el('small', {}, p.cat)),
      el('td', { class: 'num' }, brlCompacto(p.anual), el('small', {}, 'saldo ' + brlCompacto(p.saldo))),
      el('td', {}, selos(p.alertas, 3)),
      el('td', {}, el('button', { type: 'button', class: 'botao', title: 'Colocar na lista de revisão', onclick: (ev) => { ev.stopPropagation(); marcarRapido(p.org, p.doc, ev.currentTarget); } }, Object.keys(revisao.itens).some((k) => k.startsWith(p.org + '|') && k.endsWith('|' + p.doc)) ? '⚑ Na lista' : '⚑ Marcar'))))))),
    dados.prioridades.length > 15 ? el('div', { class: 'rodape-tabela' }, el('button', { type: 'button', class: 'botao',
      onclick: () => { estado.verMaisPrioridades = !estado.verMaisPrioridades; render(); } },
    estado.verMaisPrioridades ? 'Mostrar menos' : `Mostrar os ${dados.prioridades.length}`)) : null);

    const maxF = Math.max(1, ...dados.topFornecedores.map((f) => f.anual + f.emp));
    const cForn = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {},
      el('h2', {}, 'Fornecedores de maior exposição'),
      el('p', {}, 'Compromisso anual vigente somado ao empenhado no período, em todos os órgãos. Clique para ver a ficha e os sócios.'))),
    el('div', { class: 'linhas' }, dados.topFornecedores.slice(0, 15).map((f) => {
      const b = el('button', { type: 'button', class: 'linha-barra', onclick: () => irForn(f.cnpj, null) },
        el('span', { class: 'nome' }, nomeProprio(f.nome), f.orgaos > 1 ? el('small', {}, f.orgaos + ' órgãos') : null),
        el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, ((f.anual + f.emp) / maxF) * 62)}%` }),
          el('span', { class: 'num' }, brlCompacto(f.anual + f.emp))));
      return el('div', { class: 'linha-com-selos' }, b, f.alertas.length ? selos(f.alertas, 2) : null);
    })));

    const slot = el('div', {}, el('p', { class: 'vazio' }, 'Carregando a curva de Pareto…'));
    const slotPol = el('div', {});
    c.replaceChildren(kp, el('div', { class: 'ferramentas' }, caixaBusca()), cartao, slot, slotPol, cPrior, cForn);
    const meu = tokenRender;
    return carregarTodosForn().then((lista) => { if (meu === tokenRender && slot.isConnected) { slot.replaceChildren(cartaoPareto(paretoItensGoverno(lista), 'Regra de Pareto: poucos fornecedores, quase todo o valor')); const cp = cartaoDoadores(paretoItensGoverno(lista)); if (cp) slotPol.replaceChildren(cp); } },
      (e) => { if (e.sessao) PF.mostrarLogin(); });
  }

  function tabelaOrgs() {
    const { col, dir } = estado.ordemOrgs;
    const linhas = [...dados.orgs].filter((x) => x.vigentes || x.empAnt || x.empAtu);
    linhas.sort((a, b) => (col === 'nome' ? a.nome.localeCompare(b.nome, 'pt-BR') : (a[col] - b[col])) * dir);
    const cols = [['nome', 'Órgão'], ['vigentes', 'Vigentes', 1], ['anualVigente', 'Compromisso anual', 1], ['saldoVigente', 'Saldo a executar', 1],
      ['pagoAnt', 'Pago ' + dados.anosGasto[0], 1], ['pagoAtu', 'Pago ' + dados.anosGasto[1], 1], ['empAnt', 'Empenhado ' + dados.anosGasto[0], 1], ['empAtu', 'Empenhado ' + dados.anosGasto[1], 1], ['diretaPct', 'Contratação direta', 1],
      ['maiorFornAnual', 'Maior fornecedor', 1], ['contratosAlta', 'Alertas altos', 1], ['fornecedoresSinalizados', 'Fornecedores sinalizados', 1]];
    return el('div', { class: 'rolagem' }, el('table', {},
      cabecalhoOrdenavel(cols, estado.ordemOrgs, (k) => { estado.ordemOrgs = { col: k, dir: col === k ? -dir : -1 }; render(); }),
      el('tbody', {}, linhas.map((x) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => irOrg(x.id), onkeydown: (ev) => { if (ev.key === 'Enter') irOrg(x.id); } },
        el('td', {}, el('strong', {}, x.nome)),
        el('td', { class: 'num' }, nInt.format(x.vigentes)), el('td', { class: 'num' }, brlCompacto(x.anualVigente)), el('td', { class: 'num' }, brlCompacto(x.saldoVigente)),
        el('td', { class: 'num' }, brlCompacto(x.pagoAnt)), el('td', { class: 'num' }, brlCompacto(x.pagoAtu)), el('td', { class: 'num' }, brlCompacto(x.empAnt)), el('td', { class: 'num' }, brlCompacto(x.empAtu)), el('td', { class: 'num' }, pct(x.diretaPct)),
        el('td', { class: 'num' }, pct(x.maiorFornAnual)), el('td', { class: 'num' }, nInt.format(x.contratosAlta)), el('td', { class: 'num' }, nInt.format(x.fornecedoresSinalizados)))))));
  }

  // ---------- visão: órgão ----------
  async function carregarOrg(id) {
    if (!cacheOrg.has(id)) cacheOrg.set(id, await ctx.api('org/' + id));
    CAMPOS = cacheOrg.get(id).campos;
    return cacheOrg.get(id);
  }
  function passaFiltro(k, vigenteOuNao) {
    const f = estado.f;
    const venc = k.alertas.some((a) => a.startsWith('vigencia_vencida'));
    if (f.situ === 'vigentes' && !vigenteOuNao) return false;
    if (f.situ === 'vencidos' && !venc) return false;
    if (f.cat && k.cat !== f.cat) return false;
    if (f.ess && k.ess !== f.ess) return false;
    if (f.modal && k.modal !== f.modal) return false;
    if (f.alerta === 'alto' && !k.alertas.some((a) => a.endsWith(':a'))) return false;
    if (f.alerta === 'algum' && !k.alertas.length) return false;
    if (f.alerta.startsWith('cod:') && !k.alertas.some((a) => a.startsWith(f.alerta.slice(4) + ':'))) return false;
    if (f.q) {
      const texto = norm(`${k.forn} ${k.objeto} ${k.doc} ${k.proc} ${k.cnpj}`);
      const q = norm(f.q);
      if (!texto.includes(q) && !texto.includes(q.replace(/[.\-/]/g, ''))) return false;
    }
    return true;
  }
  async function renderOrg(c) {
    const org = dados.orgs.find((o) => o.id === estado.org);
    const meu = ++tokenRender;
    c.classList.add('carregando');
    let det;
    try { det = await carregarOrg(org.id); } catch (e) {
      if (e.sessao) return PF.mostrarLogin();
      c.classList.remove('carregando');
      return c.replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar este órgão.'));
    }
    if (meu !== tokenRender) return;
    c.classList.remove('carregando');
    const hoje = dados.ref;
    const todos = det.contratos.map(contrato).map((k) => ({ ...k, vigente: !k.fimef || k.fimef >= hoje }));
    const vig = todos.filter((k) => k.vigente);
    const [aAnt, aAtu] = dados.anosGasto;
    const cob = org.coberturaEmpenho;
    const kp = el('div', { class: 'kpis' },
      kpi('Contratos vigentes', nInt.format(org.vigentes), `${brlCompacto(org.valorVigente)} em valor total`),
      kpi('Compromisso anual', brlCompacto(org.anualVigente), `saldo a executar: ${brlCompacto(org.saldoVigente)}`),
      kpi('Pago aos fornecedores', brlCompacto(org.pagoAnt + org.pagoAtu), `${aAnt}: ${brlCompacto(org.pagoAnt)} · ${aAtu}: ${brlCompacto(org.pagoAtu)} · caixa (SIGEFES)`),
      kpi('Empenhado nos contratos', brlCompacto(org.empAnt + org.empAtu), `${aAnt}: ${brlCompacto(org.empAnt)} · ${aAtu}: ${brlCompacto(org.empAtu)} · só o que o SIGA registra`),
      kpi('Contratação direta', pct(org.diretaPct), `dispensa e inexigibilidade, do valor contratado em ${aAnt}–${aAtu}`),
      kpi('Maior fornecedor', pct(org.maiorFornAnual), 'participação no compromisso anual vigente'),
      kpi('Alertas', `${nInt.format(org.contratosAlta)} altos`, `${nInt.format(org.contratosMedia)} contratos com sinal médio · ${nInt.format(org.fornecedoresSinalizados)} fornecedores sinalizados`));
    const aviso = cob != null && cob < 0.35 ? el('p', { class: 'aviso solto' },
      `Atenção: os empenhos registrados no SIGA cobrem só ${pct(cob)} do compromisso anual deste órgão. Use a coluna "pago" (SIGEFES), que traz o dinheiro que saiu do caixa para os fornecedores, e não o empenho, para medir a execução.`) : null;

    // categorias e modalidades (compromisso anual dos vigentes)
    const por = (campo) => {
      const m = new Map();
      for (const k of vig) m.set(k[campo], (m.get(k[campo]) || 0) + k.anual);
      return [...m].sort((a, b) => b[1] - a[1]);
    };
    const barras = (lista, campo, titulo_, sub, rot = (x) => x) => {
      const max = Math.max(1, ...lista.map((x) => x[1]));
      return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, titulo_), el('p', {}, sub))),
        lista.length ? el('div', { class: 'linhas' }, lista.slice(0, 10).map(([n, v]) => el('button', { type: 'button', class: 'linha-barra' + (estado.f[campo] === n ? ' ativa' : ''),
          onclick: () => { estado.f[campo] = estado.f[campo] === n ? '' : n; estado.limite = 50; render(); } },
        el('span', { class: 'nome' }, rot(n)), el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, (v / max) * 64)}%` }),
          el('span', { class: 'num' }, brlCompacto(v)))))) : el('p', { class: 'vazio' }, 'Sem contratos vigentes.'));
    };
    const cCat = barras(por('cat'), 'cat', 'O que se contrata', 'Compromisso anual dos contratos vigentes por tipo de objeto (classificação automática por palavras-chave). Clique para filtrar a lista.');
    const cMod = barras(por('modal'), 'modal', 'Como se contrata', 'Compromisso anual por modalidade do processo. Dispensa e inexigibilidade dispensam a competição.');
    const cEss = barras(por('ess'), 'ess', 'Quão essencial é', 'Compromisso anual por essencialidade sugerida do objeto: essencial (saúde, alimentação, utilidades), suporte, investimento (adiável) e discricionário (cortável).', (x) => ESS()[x] || x);

    // fornecedores
    const forns = det.fornecedores;
    const maxF = Math.max(1, ...forns.map((f) => f.anual + f.empAnt + f.empAtu));
    const visF = estado.verTodosForn ? forns : forns.slice(0, 12);
    const cForn = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {},
      el('h2', {}, 'Principais fornecedores'),
      el('p', {}, `Compromisso anual vigente somado ao empenhado em ${aAnt}–${aAtu}. Clique para ver a ficha, os sócios e os alertas.`))),
    el('div', { class: 'linhas' }, visF.map((f) => el('div', { class: 'linha-com-selos' },
      el('button', { type: 'button', class: 'linha-barra', onclick: () => irForn(f.cnpj, org.id) },
        el('span', { class: 'nome' }, nomeProprio(f.nome)),
        el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, ((f.anual + f.empAnt + f.empAtu) / maxF) * 62)}%` }),
          el('span', { class: 'num' }, brlCompacto(f.anual + f.empAnt + f.empAtu)))),
      f.alertas.length ? selos(f.alertas, 2) : null))),
    forns.length > 12 ? el('div', { class: 'rodape-tabela' }, el('button', { type: 'button', class: 'botao',
      onclick: () => { estado.verTodosForn = !estado.verTodosForn; render(); } }, estado.verTodosForn ? 'Mostrar menos' : `Mostrar ${forns.length}`)) : null);

    // série anual
    const cSerie = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {},
      el('h2', {}, 'Contratado e empenhado por ano'),
      el('p', {}, 'Contratado: valor dos instrumentos celebrados no ano. Empenhado: valor empenhado no ano nos instrumentos registrados no SIGA. O ano corrente está incompleto.'))));
    graficoBarras(cSerie, { meses: det.serie.anos.map(String), rotulo: (m) => m, rotuloLongo: (m) => m, eixo: brlCompacto, fmt: brlCompacto,
      series: [{ nome: 'Contratado', cor: 'var(--serie-1)', barra: true, vals: det.serie.contratado }, { nome: 'Empenhado', cor: 'var(--serie-2)', barra: true, vals: det.serie.empenhado }] });

    c.replaceChildren(...[kp, aviso, el('div', { class: 'duas-colunas' }, cCat, cMod), cEss, cForn, cartaoPareto(paretoItensOrg(det.fornecedores), 'Regra de Pareto: poucos fornecedores, quase todo o valor', org.id), cSerie, cartaoContratos(todos, org)].filter(Boolean));
  }

  function cartaoContratos(todos, org) {
    const f = estado.f;
    const lista = todos.filter((k) => passaFiltro(k, k.vigente));
    const { col, dir } = estado.ordem;
    const chave = { forn: (k) => k.forn, anual: (k) => k.anual, saldo: (k) => k.saldo ?? -1, fimef: (k) => k.fimef || '9999', pts: (k) => pontos(k.alertas) };
    lista.sort((a, b) => { const x = chave[col](a), y = chave[col](b); return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * dir || b.anual - a.anual; });
    const cats = [...new Set(todos.map((k) => k.cat))].sort();
    const mods = [...new Set(todos.map((k) => k.modal))].sort();
    const codigos = [...new Set(todos.flatMap((k) => k.alertas.map((a) => a.split(':')[0])))].sort((x, y) => dados.alertas[x].titulo.localeCompare(dados.alertas[y].titulo, 'pt-BR'));
    const sel = (valor, opcoes, aoMudar, rotulo) => el('label', {}, rotulo, el('select', { onchange: (ev) => { aoMudar(ev.target.value); estado.limite = 50; render(); } },
      opcoes.map(([v, r]) => el('option', { value: v, selected: v === valor }, r))));
    const filtros = el('div', { class: 'filtros' },
      sel(f.situ, [['vigentes', 'Vigentes'], ['vencidos', 'Vencidos com empenho posterior'], ['todos', 'Todos']], (v) => { f.situ = v; }, 'Situação'),
      sel(f.cat, [['', 'Todos'], ...cats.map((x) => [x, x])], (v) => { f.cat = v; }, 'Objeto'),
      sel(f.ess, [['', 'Todas'], ...Object.entries(ESS()).filter(([k]) => todos.some((c) => c.ess === k)).map(([k, r]) => [k, r])], (v) => { f.ess = v; }, 'Essencialidade'),
      sel(f.modal, [['', 'Todas'], ...mods.map((x) => [x, x])], (v) => { f.modal = v; }, 'Modalidade'),
      sel(f.alerta, [['', 'Todos'], ['algum', 'Com algum alerta'], ['alto', 'Com alerta alto'], ...codigos.map((x) => ['cod:' + x, dados.alertas[x].titulo])], (v) => { f.alerta = v; }, 'Alerta'),
      el('label', { class: 'busca' }, 'Buscar', el('input', { type: 'search', value: f.q, placeholder: 'Fornecedor, objeto, nº do contrato ou CNPJ', autocomplete: 'off',
        oninput: (ev) => { clearTimeout(cartaoContratos.t); cartaoContratos.t = setTimeout(() => { f.q = ev.target.value.trim(); estado.limite = 50; render(true); }, 220); } })));
    const cols = [['forn', 'Fornecedor e objeto'], ['-', 'Tipo'], ['anual', 'Por ano', 1], ['saldo', 'Saldo a executar', 1], ['fimef', 'Até quando'], ['pts', 'Alertas']];
    const visiveis = lista.slice(0, estado.limite);
    const linhas = visiveis.flatMap((k) => {
      const aberto = estado.aberto.has(k.doc + k.proc);
      const tr = el('tr', { class: 'clicavel' + (aberto ? ' aberta' : ''), tabindex: '0', 'aria-expanded': String(aberto),
        onclick: () => { const id = k.doc + k.proc; if (estado.aberto.has(id)) estado.aberto.delete(id); else estado.aberto.add(id); render(true); },
        onkeydown: (ev) => { if (ev.key === 'Enter') ev.currentTarget.click(); } },
      el('td', { class: 'objeto' }, el('strong', {}, nomeProprio(k.forn)), naLista(org.id, k) ? el('span', { class: 'selo n-m' }, el('b', {}, '⚑'), ' na lista de revisão') : null, el('small', {}, k.objeto.length > 150 ? k.objeto.slice(0, 150) + '…' : k.objeto)),
      el('td', {}, k.cat, el('small', {}, k.modal + (k.rp ? ' · registro de preços' : '')), tagEss(k.ess)),
      el('td', { class: 'num' }, brlCompacto(k.anual), el('small', {}, 'total ' + brlCompacto(k.vfin)), k.pago > 0 ? el('small', {}, `pago ${brlCompacto(k.pago)} (${pct(k.vfin ? k.pago / k.vfin : 0)})`) : null),
      el('td', { class: 'num' }, k.saldo == null ? '—' : brlCompacto(k.saldo)),
      el('td', {}, dataBR(k.fimef), el('small', {}, k.fimef ? `faltam ${duracao(mesesAte(k.fimef))}` : 'sem prazo definido'),
        el('small', {}, `desde ${dataBR(k.ini)}` + (k.npror ? ` · ${k.npror} prorrog.` : ''))),
      el('td', {}, selos(k.alertas, 2)));
      if (!aberto) return [tr];
      const dl = el('dl', { class: 'detalhes' },
        ...[['Objeto', k.objeto], ['Instrumento', k.doc], ['Processo', k.proc], ['Fornecedor', `${nomeProprio(k.forn)} · ${cnpjFmt(k.cnpj)}`],
          ['Celebração', dataBR(k.cel)], ['Vigência', `${dataBR(k.ini)} a ${dataBR(k.fim)}` + (k.fimef !== k.fim ? ` (com aditivos: até ${dataBR(k.fimef)})` : '')],
          ['Valor inicial → final', `${brlCompacto(k.vini)} → ${brlCompacto(k.vfin)}`], ['Ainda a receber (estimativa)', brlCompacto(k.restante)], ['Pago nos empenhos do contrato', k.pago > 0 ? `${brlCompacto(k.pago)} desde 2021 (${dados.anosGasto[0]}: ${brlCompacto(k.pagoAnt)} · ${dados.anosGasto[1]}: ${brlCompacto(k.pagoAtu)})` : 'nenhum pagamento vinculado aos empenhos registrados'], ['Essencialidade sugerida', ESS()[k.ess]],
          ['Empenhado', `${dados.anosGasto[0]}: ${brlCompacto(k.empAnt)} · ${dados.anosGasto[1]}: ${brlCompacto(k.empAtu)}`],
          ['Situação no SIGA', k.sit]].flatMap(([t, v]) => [el('dt', {}, t), el('dd', {}, v)]));
      const alertas = k.alertas.length ? el('ul', { class: 'lista-alertas' }, k.alertas.map((a) => el('li', {}, selo(a), ' ', dados.alertas[a.split(':')[0]].descricao))) : null;
      const acao = el('button', { type: 'button', class: 'botao', onclick: (ev) => { ev.stopPropagation(); irForn(k.cnpj, org.id); } }, 'Ficha do fornecedor e sócios');
      return [tr, el('tr', { class: 'detalhe-linha' }, el('td', { colspan: 6 }, dl, alertas, formRevisao(org, k), acao))];
    });
    const rolagem = el('div', { class: 'rolagem' }, el('table', {},
      cabecalhoOrdenavel(cols, estado.ordem, (k) => { estado.ordem = { col: k, dir: estado.ordem.col === k ? -estado.ordem.dir : -1 }; render(true); }),
      el('tbody', {}, linhas.length ? linhas : [el('tr', {}, el('td', { colspan: 6 }, el('p', { class: 'vazio' }, 'Nenhum contrato corresponde aos filtros.')))])));
    const titulos = { vigentes: 'Contratos vigentes', vencidos: 'Contratos vencidos que seguem recebendo empenhos', todos: 'Contratos' };
    return el('div', { class: 'cartao', id: 'lista-contratos' }, el('div', { class: 'cartao-topo' }, el('div', {},
      el('h2', {}, `${titulos[f.situ]} (${nInt.format(lista.length)})`),
      el('p', {}, `Somam ${brlCompacto(soma(lista, (k) => k.anual))} por ano. Clique numa linha para abrir os detalhes e os motivos de cada alerta.`)),
    el('button', { type: 'button', class: 'botao', onclick: () => exportar(lista, org) }, 'Exportar CSV')),
    filtros, rolagem,
    lista.length > visiveis.length ? el('div', { class: 'rodape-tabela' }, el('button', { type: 'button', class: 'botao',
      onclick: () => { estado.limite += 100; render(true); } }, `Mostrar mais (${nInt.format(lista.length - visiveis.length)} restantes)`)) : null);
  }

  function exportar(lista, org) {
    const aspas = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const cab = ['Órgão', 'Instrumento', 'Processo', 'Fornecedor', 'CNPJ', 'Objeto', 'Tipo de objeto', 'Modalidade', 'Valor inicial', 'Valor final', 'Por ano', 'Saldo a executar',
      'Celebração', 'Vigência até', 'Situação', 'Essencialidade', 'Ainda a receber', 'Pago desde 2021', 'Alertas'];
    const linhas = lista.map((k) => [org.nome, k.doc, k.proc, k.forn, k.cnpj, k.objeto, k.cat, k.modal, k.vini, k.vfin, k.anual, k.saldo, k.cel, k.fimef, k.sit, ESS()[k.ess], k.restante, k.pago,
      k.alertas.map((a) => `${NIVEL[a.split(':')[1]]}: ${dados.alertas[a.split(':')[0]].titulo}`).join(' | ')]);
    const csv = '﻿' + [cab, ...linhas].map((l) => l.map(aspas).join(';')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `contratos-${org.nome.replace(/\W+/g, '-')}-${dados.ref}.csv` });
    document.body.append(a); a.click(); a.remove();
  }


  function cartaoDoadores(itens) {
    const lista = itens.filter((x) => x.doadoGov > 0).sort((a, b) => (b.anual + b.pago) - (a.anual + a.pago));
    if (!lista.length) return null;
    return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Fornecedores com sócios doadores de campanha ao governo do ES'),
      el('p', {}, `${nInt.format(lista.length)} fornecedores têm sócio que doou a candidato a governador ou vice (2018 e 2022), conforme o TSE. Somam ${brlCompacto(soma(lista, (x) => x.anual))} por ano em contratos vigentes e ${brlCompacto(soma(lista, (x) => x.pago))} pagos em ${dados.anosGasto.join('–')}. Doação é legal e pública; o quadro mostra proximidade a conferir, não irregularidade. Clique para ver os detalhes.`))),
    el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, ['Fornecedor', 'Doado ao governo', 'Contratado por ano', 'Pago recente', 'Até quando', 'Essencialidade'].map((t, n) => el('th', { class: n >= 1 && n <= 3 ? 'num' : '' }, t)))),
      el('tbody', {}, lista.slice(0, 25).map((x) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => irForn(x.cnpj, null), onkeydown: (ev) => { if (ev.key === 'Enter') irForn(x.cnpj, null); } },
        el('td', {}, el('strong', {}, nomeProprio(x.nome)), el('small', {}, x.cat || '')), el('td', { class: 'num' }, PF.nBRL.format(x.doadoGov)), el('td', { class: 'num' }, brlCompacto(x.anual)), el('td', { class: 'num' }, brlCompacto(x.pago)),
        el('td', {}, x.ate ? dataBR(x.ate) : '—', el('small', {}, x.ate ? 'faltam ' + duracao(mesesAte(x.ate)) : '')), el('td', {}, tagEss(x.ess))))))));
  }

  // ---------- regra de Pareto (curva ABC) ----------
  const BASES = { anual: ['Compromisso anual dos contratos vigentes', (x) => x.anual], pago: ['Pago em {ANOS}', (x) => x.pago], emp: ['Empenhado em {ANOS}', (x) => x.emp],
    restante: ['O que ainda têm a receber (estimativa)', (x) => x.restante] };
  function paretoItensOrg(forns) {
    return forns.map((f) => ({ cnpj: f.cnpj, nome: f.nome, anual: f.anual, pago: f.pagoAnt + f.pagoAtu, emp: f.empAnt + f.empAtu, restante: f.restante, desde: f.desde, ate: f.ate,
      ess: f.ess, cat: f.cat, alertas: f.alertas, nOrgs: 1, natureza: f.natureza }));
  }
  function paretoItensGoverno(lista) {
    return lista.map((r) => ({ cnpj: r[0], nome: r[1], anual: r[2], pago: r[13], restante: r[3], emp: r[4], desde: r[5], ate: r[6], nOrgs: r[7], cat: r[9], ess: r[10], alertas: r[11], natureza: r[14], doadoGov: r[15] || 0, doadoTot: r[16] || 0, dividaCobranca: r[17] || 0, sancao: r[18] || 0 }));
  }
  function cartaoPareto(itens, titulo_, origem) {
    const P = estado.par;
    const [rotuloBaseBruto, valorDe] = BASES[P.base];
    const rotuloBase = rotuloBaseBruto.replace('{ANOS}', dados.anosGasto.join('–'));
    const rotulos = Object.entries(ESS());
    const publico = (x) => /(economia mista|empresa p[uú]blica|[óo]rg[aã]o p[uú]blico|autarquia|funda[cç][aã]o p[uú]blica|munic[ií]pio|estado ou distrito)/i.test(x.natureza || '')
      || /(^|\s)(banco|caixa econ[oô]mica|prefeitura|munic[ií]pio)/i.test(x.nome);
    const base = itens.filter((x) => (P.pub || !publico(x)) && (!P.ess.size || P.ess.has(x.ess)) && valorDe(x) > 0).sort((a, b) => valorDe(b) - valorDe(a));
    const total = soma(base, valorDe);
    let acum = 0;
    const serie = base.map((x) => { acum += valorDe(x); return { x, v: valorDe(x), cum: total ? acum / total : 0 }; });
    const corte = P.corte / 100;
    const kA = serie.findIndex((r) => r.cum >= corte - 1e-9) + 1 || serie.length;
    const caixa = el('div', { class: 'grafico' });
    const cartao = el('div', { class: 'cartao pareto' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, titulo_),
      el('p', {}, 'Fornecedores ordenados do maior para o menor; a curva mostra quanto do valor total as primeiras empresas acumulam. A classe A é o grupo que atinge o corte escolhido: é onde a renegociação rende mais.'))),
    el('div', { class: 'filtros' },
      el('label', {}, 'Medida', el('select', { onchange: (ev) => { P.base = ev.target.value; P.mais = 10; render(true); } },
        Object.entries(BASES).map(([k, [r]]) => el('option', { value: k, selected: k === P.base }, r.replace('{ANOS}', dados.anosGasto.join('–')))))),
      el('label', {}, `Corte: ${P.corte}% do valor`, el('input', { type: 'range', min: 50, max: 95, step: 5, value: P.corte,
        oninput: (ev) => { ev.target.previousSibling.textContent = `Corte: ${ev.target.value}% do valor`; },
        onchange: (ev) => { P.corte = Number(ev.target.value); P.mais = 10; render(true); } }))),
    el('div', { class: 'filtro-cond', role: 'group', 'aria-label': 'Essencialidade' }, rotulos.filter(([k]) => itens.some((x) => x.ess === k)).map(([k, r]) =>
      el('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(!P.ess.size || P.ess.has(k)),
        onclick: () => { if (P.ess.has(k)) P.ess.delete(k); else P.ess.add(k); P.mais = 10; render(true); } }, r)),
    el('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(P.pub), title: 'Bancos, empresas públicas, autarquias e prefeituras costumam receber repasses e financiamentos, não pagamentos de fornecimento',
      onclick: () => { P.pub = !P.pub; P.mais = 10; render(true); } }, 'Incluir bancos, entes públicos e prefeituras')));
    if (!serie.length) { cartao.append(el('p', { class: 'vazio' }, 'Nenhum fornecedor com valor nesta medida e filtro.')); return cartao; }
    const pctA = kA / serie.length;
    cartao.append(el('p', { class: 'conclusao' }, el('strong', {}, `${nInt.format(kA)} de ${nInt.format(serie.length)} fornecedores (${pct(pctA)})`),
      ` concentram ${P.corte}% de ${brlCompacto(total)} (${rotuloBase.toLowerCase()}). Os outros ${nInt.format(serie.length - kA)} dividem o restante.`), caixa);
    observar(caixa, (W) => {
      const H = 230, ml = 44, mr = 14, mt = 12, mb = 34, iw = W - ml - mr, ih = H - mt - mb;
      const X = (i) => ml + (i / serie.length) * iw, Y = (c) => mt + ih - c * ih;
      const svgEl = PF.svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        svgEl.append(PF.svg('line', { class: t === 0 ? 'eixo' : 'grade', x1: ml, x2: W - mr, y1: Y(t), y2: Y(t) }));
        const tx = PF.svg('text', { x: ml - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = Math.round(t * 100) + '%'; svgEl.append(tx);
        const ty = PF.svg('text', { x: ml + t * iw, y: H - 16, 'text-anchor': t === 1 ? 'end' : t === 0 ? 'start' : 'middle' }); ty.textContent = Math.round(t * 100) + '%'; svgEl.append(ty);
      }
      const rotX = PF.svg('text', { x: ml + iw / 2, y: H - 2, 'text-anchor': 'middle' }); rotX.textContent = '% dos fornecedores (do maior para o menor)'; svgEl.append(rotX);
      const passo = Math.max(1, Math.floor(serie.length / 300));
      let d = `M${X(0)},${Y(0)}`;
      for (let i = 0; i < serie.length; i += passo) d += `L${X(i + 1).toFixed(1)},${Y(serie[i].cum).toFixed(1)}`;
      d += `L${X(serie.length)},${Y(1)}`;
      svgEl.append(PF.svg('path', { d, fill: 'none', 'stroke-width': 2.5, 'stroke-linejoin': 'round', style: 'stroke:var(--serie-1)' }));
      svgEl.append(PF.svg('line', { x1: ml, x2: X(kA), y1: Y(corte), y2: Y(corte), 'stroke-dasharray': '4 3', style: 'stroke:var(--serie-2)', 'stroke-width': 1.5 }));
      svgEl.append(PF.svg('line', { x1: X(kA), x2: X(kA), y1: Y(corte), y2: Y(0), 'stroke-dasharray': '4 3', style: 'stroke:var(--serie-2)', 'stroke-width': 1.5 }));
      svgEl.append(PF.svg('circle', { cx: X(kA), cy: Y(corte), r: 5, style: 'fill:var(--serie-2);stroke:var(--superficie);stroke-width:2' }));
      const rot = PF.svg('text', { class: 'rotulo-final', x: Math.min(W - mr, X(kA) + 8), y: Y(corte) + 18, 'text-anchor': X(kA) > W * 0.7 ? 'end' : 'start' });
      rot.textContent = `${nInt.format(kA)} fornecedores → ${P.corte}%`;
      if (X(kA) > W * 0.7) rot.setAttribute('x', X(kA) - 8);
      svgEl.append(rot);
      const sobre = PF.svg('rect', { x: ml, y: mt, width: iw, height: ih, fill: 'transparent' });
      sobre.addEventListener('pointermove', (ev) => {
        const r = sobre.getBoundingClientRect();
        const i = Math.min(serie.length - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * serie.length)));
        mostrarDica([el('div', { class: 'tit' }, `${i + 1}º: ${nomeProprio(serie[i].x.nome)}`), dicaLinha(null, brlCompacto(serie[i].v), 'valor na medida'),
          dicaLinha(null, pct(serie[i].cum), 'acumulado até aqui')], ev.clientX, ev.clientY);
      });
      sobre.addEventListener('pointerleave', esconderDica);
      svgEl.append(sobre);
      caixa.replaceChildren(svgEl);
    });
    const classeA = serie.slice(0, kA);
    const vis = classeA.slice(0, P.mais);
    cartao.append(el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, [['#'], ['Classe A: fornecedor'], ['Valor', 1], ['% do total', 1], ['% acumulado', 1], ['Desde'], ['Até quando'], ['Ainda a receber', 1], ['Essencialidade'], ['Alertas']]
        .map(([t, n]) => el('th', { class: n ? 'num' : '' }, t)))),
      el('tbody', {}, vis.map((r, i) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => irForn(r.x.cnpj, origem == null ? null : origem),
        onkeydown: (ev) => { if (ev.key === 'Enter') irForn(r.x.cnpj, origem == null ? null : origem); } },
      el('td', {}, String(i + 1)),
      el('td', {}, el('strong', {}, nomeProprio(r.x.nome)), el('small', {}, (r.x.cat || '') + (r.x.nOrgs > 1 ? ` · ${r.x.nOrgs} órgãos` : '') + (r.x.natureza ? ` · ${r.x.natureza}` : ''))),
      el('td', { class: 'num' }, brlCompacto(r.v)), el('td', { class: 'num' }, pct(total ? r.v / total : 0)), el('td', { class: 'num' }, pct(r.cum)),
      el('td', {}, r.x.desde ? r.x.desde.slice(0, 4) : '—', el('small', {}, r.x.desde ? `${(anosDesde(r.x.desde) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos` : '')),
      el('td', {}, r.x.ate ? dataBR(r.x.ate) : '—', el('small', {}, r.x.ate ? 'faltam ' + duracao(mesesAte(r.x.ate)) : '')),
      el('td', { class: 'num' }, brlCompacto(r.x.restante)), el('td', {}, tagEss(r.x.ess)),
      el('td', {}, r.x.alertas.length ? selos(r.x.alertas.filter((a) => !a.endsWith(':i')), 2) : null)))))),
    classeA.length > P.mais ? el('div', { class: 'rodape-tabela' }, el('button', { type: 'button', class: 'botao',
      onclick: () => { P.mais += 20; render(true); } }, `Mostrar mais (${nInt.format(classeA.length - P.mais)} restantes na classe A)`)) : null);
    return cartao;
  }

  // ---------- situação fiscal, sanções e vínculos políticos (ficha do fornecedor) ----------
  function cartaoFiscal(ex) {
    if (!ex || !(ex.divida || (ex.sancoes && ex.sancoes.length) || (ex.sociosSancionados && ex.sociosSancionados.length))) return null;
    const d = ex.divida;
    const rotTipo = { fgts: 'FGTS', prev: 'Previdenciária', naoprev: 'Não previdenciária' };
    const blocos = [];
    if (d) {
      const cobr = Object.entries(d.situ).filter(([k]) => /cobran/i.test(k.normalize('NFD').replace(/\p{Diacritic}/gu, ''))).reduce((t, [, v]) => t + v, 0);
      blocos.push(el('dl', { class: 'detalhes grade2' },
        el('dt', {}, 'Dívida ativa da União'), el('dd', {}, `${PF.nBRL.format(d.total)} inscritos em ${nInt.format(d.n)} inscrições (todas as filiais), ${PF.nBRL.format(cobr)} em cobrança`),
        el('dt', {}, 'Por natureza'), el('dd', {}, Object.entries(d.tipos).map(([k, v]) => `${rotTipo[k] || k}: ${PF.nBRL.format(v)}`).join(' · ')),
        el('dt', {}, 'Por situação'), el('dd', {}, Object.entries(d.situ).map(([k, v]) => `${k}: ${PF.nBRL.format(v)}`).join(' · ')),
        el('dt', {}, 'Já ajuizado'), el('dd', {}, PF.nBRL.format(d.ajuizado) + (d.primeira ? ` · primeira inscrição em ${dataBR(d.primeira)}` : ''))));
    }
    const linhaSancao = (i, quem) => el('tr', {}, el('td', {}, quem || i.cad), el('td', {}, i.tipo), el('td', {}, `${i.ini || '—'} a ${i.fim || 'sem data final'}`), el('td', {}, `${i.orgao} (${(i.esfera || '').toLowerCase()}${i.uf ? ', ' + i.uf : ''})`));
    const sancoes = [...(ex.sancoes || []).map((i) => linhaSancao(i, 'Empresa · ' + i.cad)), ...(ex.sociosSancionados || []).flatMap((x) => x.itens.map((i) => linhaSancao(i, `Sócio ${nomeProprio(x.socio)} · ${i.cad}`)))];
    if (sancoes.length) blocos.push(el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, ['Quem · cadastro', 'Sanção', 'Período', 'Órgão sancionador'].map((t) => el('th', {}, t)))), el('tbody', {}, sancoes))));
    return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Situação fiscal e sanções'),
      el('p', {}, `Dívida ativa da União (PGFN) por CNPJ-raiz e cadastros de sanções (CEIS e CNEP, da CGU). Conferir o alcance de cada sanção e se a dívida está garantida ou parcelada.`))), ...blocos);
  }
  const tagConf = (c, base) => el('span', { class: 'tag-conf c-' + (c || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s/g, ''), title: base || '' }, c === 'confirmado' ? 'Confirmado' : c === 'provável' ? 'Provável' : 'A conferir');
  const resultadoTxt = (r) => (!r || r === '#NULO' ? '' : /^eleito/i.test(r) ? 'eleito' : /suplente/i.test(r) ? 'suplente' : /n[aã]o eleito/i.test(r) ? 'não eleito' : r.toLowerCase());
  function cartaoPolitico(ex, f) {
    if (!ex || !((ex.doacoes && ex.doacoes.length) || (ex.candidatos && ex.candidatos.length) || (ex.campanhas && ex.campanhas.length) || (ex.doacoesPj && ex.doacoesPj.length))) return null;
    const blocos = [];
    if (ex.doacoes && ex.doacoes.length) {
      const tot = soma(ex.doacoes, (x) => x.valor);
      blocos.push(el('h3', {}, `Doações de sócios: ${PF.nBRL.format(tot)} em ${nInt.format(soma(ex.doacoes, (x) => x.n))} doações`),
        el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, ['Sócio', 'Ano', 'Destino', 'Cargo', 'Resultado', 'Vínculo', 'Valor'].map((t, n) => el('th', { class: n === 6 ? 'num' : '' }, t)))),
          el('tbody', {}, ex.doacoes.map((x) => el('tr', {}, el('td', {}, nomeProprio(x.socio)), el('td', {}, String(x.ano)),
            el('td', {}, x.tipo === 'partidos' ? `Órgão partidário · ${x.partido}` : `${nomeProprio(x.candidato)} · ${x.partido}`),
            el('td', {}, `${x.cargo}${x.uf ? ' · ' + x.uf : ''}`), el('td', {}, resultadoTxt(x.resultado)), el('td', {}, tagConf(x.confianca, x.base)), el('td', { class: 'num' }, PF.nBRL.format(x.valor))))))));
    }
    if (ex.candidatos && ex.candidatos.length) {
      blocos.push(el('h3', {}, 'Sócios que foram candidatos'), el('ul', { class: 'lista-simples' }, ex.candidatos.map((x) => el('li', {}, `${nomeProprio(x.socio)}: ${x.cargo}, ${x.municipio && x.municipio !== x.uf ? x.municipio + ', ' : ''}${x.uf}, ${x.ano}, ${x.partido}${resultadoTxt(x.resultado) ? ', ' + resultadoTxt(x.resultado) : ''}${x.ocupacao && x.ocupacao !== '#NULO' ? ' · ocupação declarada: ' + x.ocupacao.toLowerCase() : ''} `, tagConf(x.confianca, x.base)))));
    }
    if (ex.campanhas && ex.campanhas.length) {
      blocos.push(el('h3', {}, 'Campanhas que contrataram a empresa'), el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, ['Ano', 'Candidato', 'Cargo', 'Valor contratado'].map((t, n) => el('th', { class: n === 3 ? 'num' : '' }, t)))),
        el('tbody', {}, ex.campanhas.map((x) => el('tr', {}, el('td', {}, String(x.ano)), el('td', {}, `${nomeProprio(x.candidato)} · ${x.partido}`), el('td', {}, `${x.cargo} · ${x.uf}`), el('td', { class: 'num' }, PF.nBRL.format(x.valor))))))));
    }
    if (ex.doacoesPj && ex.doacoesPj.length) {
      blocos.push(el('h3', {}, 'A própria empresa como doadora'), el('ul', { class: 'lista-simples' }, ex.doacoesPj.map((x) => el('li', {}, `${x.ano}: ${PF.nBRL.format(x.valor)} para ${x.tipo === 'partidos' ? 'órgão partidário ' + x.partido : nomeProprio(x.candidato) + ' (' + x.cargo + ', ' + x.uf + ')'}`))));
    }
    return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Vínculos políticos e eleitorais'),
      el('p', {}, 'Prestação de contas de campanhas e partidos e cadastro de candidaturas (TSE, 2018 a 2024) cruzados com os sócios. Provável: nome igual e seis dígitos do meio do CPF iguais. Confirmado: além disso, algum dado oficial coerente, como município do doador igual ao da sede da empresa ou faixa etária da Receita compatível com a data de nascimento do candidato. A conferir: só o nome coincide (o TSE oculta o CPF dos candidatos de 2024) ou há divergência de idade. Doação é ato legal e público; o dado mostra proximidade a conferir, não irregularidade. A ausência de registro não prova ausência de vínculo: parentes, doações por terceiros e eleições anteriores a 2018 não estão aqui.'))), ...blocos);
  }

  // ---------- visão: fornecedor ----------
  async function carregarForn(cnpj) {
    const fatia = cnpj.length === 14 ? cnpj.slice(0, 2) : 'pf';
    if (!cacheForn.has(fatia)) cacheForn.set(fatia, await ctx.api('forn/' + fatia));
    return cacheForn.get(fatia)[cnpj] || null;
  }
  async function renderForn(c) {
    const meu = ++tokenRender;
    c.classList.add('carregando');
    let f;
    try { f = await carregarForn(estado.forn); } catch (e) {
      if (e.sessao) return PF.mostrarLogin();
      c.classList.remove('carregando');
      return c.replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar este fornecedor.'));
    }
    if (meu !== tokenRender) return;
    c.classList.remove('carregando');
    if (!f) return c.replaceChildren(el('p', { class: 'vazio' }, 'Este CNPJ não consta nos contratos recentes do Estado.'));
    const irregular = f.situacao_cod && !['02', '2'].includes(f.situacao_cod);
    const kv = (t, v) => (v ? [el('dt', {}, t), el('dd', {}, v)] : []);
    const ficha = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {},
      el('h2', {}, nomeProprio(f.nome)), el('p', {}, cnpjFmt(f.cnpj) + (f.fantasia ? ` · ${nomeProprio(f.fantasia)}` : '')))),
    f.cadastro ? el('dl', { class: 'detalhes grade2' },
      ...kv('Situação cadastral', el('span', {}, f.situacao + (f.data_situacao ? ` desde ${dataBR(f.data_situacao)}` : '') + (f.motivo ? ` (${f.motivo})` : ''), irregular ? el('span', { class: 'selo n-a' }, el('b', {}, 'Alta'), ' irregular') : null)),
      ...kv('Abertura', dataBR(f.abertura)), ...kv('Natureza jurídica', f.natureza), ...kv('Porte', f.porte),
      ...kv('Capital social', f.capital != null ? PF.nBRL.format(f.capital) : ''), ...kv('Atividade principal', f.cnae && f.cnae[1] ? `${f.cnae[0]} · ${f.cnae[1]}` : ''),
      ...kv('Endereço', [f.endereco, f.bairro, f.cep && 'CEP ' + f.cep].filter(Boolean).join(', ')), ...kv('Município', f.municipio ? `${f.municipio}/${f.uf}` : ''))
      : el('p', { class: 'vazio' }, 'Sem cadastro na Receita Federal para este CNPJ (ou fornecedor pessoa física).'));

    const alertas = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Alertas'),
      el('p', {}, 'Sinais de triagem do cruzamento entre contratos, cadastro da Receita e folha estadual. Cada um pede conferência, não prova irregularidade.'))),
    f.alertas.length ? el('ul', { class: 'lista-alertas' }, f.alertas.map(([cod, n, txt]) => el('li', {}, selo(`${cod}:${n}`), ' ', txt))) : el('p', { class: 'vazio' }, 'Nenhum alerta para este fornecedor.'));

    const socios = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Quadro societário'),
      el('p', {}, `Receita Federal, publicação de ${dataBR(dados.receita)}. O CPF é mascarado pela própria Receita.`))),
    f.socios.length ? el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Sócio', 'Qualificação', 'Entrada', 'Outras empresas', 'Cruzamentos'].map((t) => el('th', {}, t)))),
      el('tbody', {}, f.socios.map((s) => el('tr', {},
        el('td', {}, el('strong', {}, nomeProprio(s.nome)), el('small', {}, `${s.tipo === 'PF' ? 'Pessoa física' : s.tipo === 'PJ' ? 'Pessoa jurídica' : 'Exterior'} · ${s.doc}${s.faixa && s.faixa !== '0' ? ' · faixa etária ' + s.faixa : ''}`)),
        el('td', {}, s.qual), el('td', {}, dataBR(s.entrada)),
        el('td', {}, s.rede ? `${nInt.format(s.rede)} empresa${s.rede > 1 ? 's' : ''} no país` : '—'),
        el('td', {}, s.outros && s.outros.length ? el('div', {}, 'Também sócio de fornecedor(es) do Estado: ', s.outros.map((o, i) => [i ? ', ' : '',
          el('a', { href: `#/contratacoes/${encodeURIComponent('f:' + o.cnpj)}` }, nomeProprio(o.nome))])) : null,
        s.servidor && s.servidor.length ? el('small', { class: 'aviso-inline' }, `Nome igual ao de servidor ativo (${s.servidor.slice(0, 4).join(', ')}); pode ser homonímia.`) : null))))))
      : el('p', { class: 'vazio' }, 'Quadro societário não disponível.'));

    const orgs = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Quem contrata este fornecedor'),
      el('p', {}, 'Instrumentos registrados no SIGA desde 2016; empenhado é o total acumulado e o recente refere-se a ' + dados.anosGasto.join('–') + '.'))),
    el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, [['Órgão'], ['Contratos', 1], ['Vigentes', 1], ['Por ano (vigentes)', 1], ['Pago recente', 1], ['Pago desde 2021', 1], ['Empenhado total', 1], ['Empenhado recente', 1]].map(([t, n]) => el('th', { class: n ? 'num' : '' }, t)))),
      el('tbody', {}, f.orgaos.map(([id, nome, nct, vig, anual, empT, empR, pagoR, pagoT]) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => irOrg(id), onkeydown: (ev) => { if (ev.key === 'Enter') irOrg(id); } },
        el('td', {}, el('strong', {}, nome)), el('td', { class: 'num' }, nInt.format(nct)), el('td', { class: 'num' }, nInt.format(vig)),
        el('td', { class: 'num' }, brlCompacto(anual)), el('td', { class: 'num' }, brlCompacto(pagoR)), el('td', { class: 'num' }, brlCompacto(pagoT)), el('td', { class: 'num' }, brlCompacto(empT)), el('td', { class: 'num' }, brlCompacto(empR))))))));
    const r = f.resumo;
    const faixa = r ? el('div', { class: 'kpis' },
      kpi('Contratado por ano', brlCompacto(r.anual), r.vig ? `${nInt.format(r.vig)} contrato(s) vigente(s) · empenhado em ${dados.anosGasto.join('–')}: ${brlCompacto(r.emp)}` : `sem contrato vigente · empenhado em ${dados.anosGasto.join('–')}: ${brlCompacto(r.emp)}`),
      kpi('Recebeu de fato', brlCompacto(r.pago), `pago em ${dados.anosGasto.join('–')}, por todos os órgãos (SIGEFES)`),
      kpi('Desde quando', r.desde ? String(r.desde.slice(0, 4)) : '—', r.desde ? `primeiro instrumento registrado em ${dataBR(r.desde)}${r.desde.startsWith('2016') ? ' (a base começa em 2016)' : ''} · ${(anosDesde(r.desde) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos` : ''),
      kpi('Por mais quanto tempo', r.ate ? duracao(mesesAte(r.ate)) : '—', r.ate ? `contratos vigentes até ${dataBR(r.ate)}` : 'sem contrato vigente'),
      kpi('Ainda a receber', brlCompacto(r.restante), 'estimativa: valor anual × tempo restante de cada contrato'),
      kpi('Essencialidade', ESS()[r.ess] || '—', r.cat ? `objeto principal: ${r.cat}` : '')) : null;
    let cPagos = null;
    if (r && r.pagoAno && Object.keys(r.pagoAno).length) {
      const anos = Object.keys(r.pagoAno);
      cPagos = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Quanto recebeu, ano a ano'),
        el('p', {}, `Valor pago pelo Estado ao CNPJ em cada ano (${anos[0]}–${anos[anos.length - 1]}), todos os órgãos. O ano corrente está incompleto.`))));
      graficoBarras(cPagos, { meses: anos, rotulo: (m) => m, rotuloLongo: (m) => m, eixo: brlCompacto, fmt: brlCompacto,
        series: [{ nome: 'Pago', cor: 'var(--serie-1)', barra: true, vals: anos.map((a) => r.pagoAno[a]) }] });
    }
    const hojeTxt = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const cab = el('div', { class: 'somente-impressao rel-cabecalho' }, el('p', { class: 'rel-sup' }, 'Painel Fiscal · Espírito Santo · Contratações'), el('h1', {}, 'Ficha do fornecedor'),
      el('p', { class: 'rel-data' }, `${nomeProprio(f.nome)} · CNPJ ${cnpjFmt(f.cnpj)} · emitida em ${hojeTxt} · posição dos dados: ${dataBR(dados.ref)}`));
    const barra = el('div', { class: 'no-print ferramentas' }, el('button', { type: 'button', class: 'botao-primario', onclick: () => window.print() }, 'Imprimir ou salvar ficha em PDF'));
    const dig = f.cnpj;
    const fontes = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Como conferir nas fontes oficiais'),
      el('p', {}, 'Consulte o CNPJ ' + cnpjFmt(f.cnpj) + ' em cada fonte; o painel mostra o que cada uma publicou na data indicada.'))),
    el('ul', { class: 'lista-simples' },
      el('li', {}, 'Situação cadastral e quadro societário: ', el('a', { href: `https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp?cnpj=${dig}`, target: '_blank', rel: 'noopener' }, 'Receita Federal (consulta de CNPJ)')),
      el('li', {}, 'Sanções (CEIS e CNEP): ', el('a', { href: 'https://portaldatransparencia.gov.br/sancoes/consulta', target: '_blank', rel: 'noopener' }, 'Portal da Transparência da União'), ' (buscar pelo CNPJ)'),
      el('li', {}, 'Dívida ativa da União: ', el('a', { href: 'https://www.regularize.pgfn.gov.br/', target: '_blank', rel: 'noopener' }, 'PGFN, Regularize'), ' e dados abertos em dadosabertos.pgfn.gov.br'),
      el('li', {}, 'Doações e candidaturas: ', el('a', { href: 'https://divulgacandcontas.tse.jus.br/', target: '_blank', rel: 'noopener' }, 'DivulgaCandContas (TSE)'), ' e dados abertos em dadosabertos.tse.jus.br'),
      el('li', {}, 'Contratos e pagamentos do Estado: ', el('a', { href: 'https://transparencia.es.gov.br/', target: '_blank', rel: 'noopener' }, 'Portal da Transparência do ES'), ' (buscar pelo CNPJ ou pelo número do contrato)')));
    c.replaceChildren(...[cab, barra, faixa, ficha, cPagos, alertas, cartaoPolitico(f.externo, f), cartaoFiscal(f.externo), socios, orgs, fontes].filter(Boolean));
  }

  // ---------- lista de revisão ----------
  // As marcações ficam só neste navegador (localStorage); a lista pode ser exportada e importada em arquivo.
  const CHAVE_REV = 'pf.contratacoes.revisao.v1';
  const MOTIVOS = { renegociar: 'Renegociar preço ou escopo', dispensavel: 'Objeto dispensável ou adiável', rescindir: 'Rescindir ou não renovar',
    licitar: 'Substituir por licitação', apurar: 'Apurar indício de irregularidade', fornecedor: 'Rever fornecedor (cadastro ou sócios)', outro: 'Outro motivo' };
  const STATUS = { revisar: 'A revisar', analise: 'Em análise', decidido: 'Decidido' };
  function lerRevisao() {
    try { const j = JSON.parse(PF.ler(CHAVE_REV) || 'null'); if (j && j.itens && typeof j.itens === 'object') return { titulo: '', intro: '', ...j }; } catch (e) { /* lista corrompida: começa vazia */ }
    return { itens: {}, titulo: '', intro: '' };
  }
  let revisao = lerRevisao();
  const nItens = () => Object.keys(revisao.itens).length;
  function atualizarContador() {
    const b = raiz && raiz.querySelector('#ir-revisao');
    if (b) b.textContent = `⚑ Lista de revisão (${nItens()})`;
  }
  function salvarRevisao() { PF.guardar(CHAVE_REV, JSON.stringify(revisao)); atualizarContador(); }
  const chaveRev = (orgId, k) => `${orgId}|${k.proc}|${k.doc}`;
  const naLista = (orgId, k) => revisao.itens[chaveRev(orgId, k)];

  async function marcar(org, k, motivo, status, nota) {
    const chave = chaveRev(org.id, k);
    const item = revisao.itens[chave] ? { ...revisao.itens[chave] } : { em: new Date().toISOString().slice(0, 10) };
    Object.assign(item, { org: org.id, orgNome: org.nome, doc: k.doc, proc: k.proc, forn: k.forn, cnpj: k.cnpj, objeto: k.objeto, cat: k.cat, modal: k.modal,
      ess: k.ess, vini: k.vini, vfin: k.vfin, anual: k.anual, restante: k.restante, pago: k.pago, cel: k.cel, ini: k.ini, fim: k.fim, fimef: k.fimef, sit: k.sit,
      alertas: k.alertas, ref: dados.ref, motivo, status, nota });
    if (!item.fornInfo && k.cnpj) {
      try {
        const f = await carregarForn(k.cnpj);
        if (f) item.fornInfo = { situacao: f.situacao || '', abertura: f.abertura || '', capital: f.capital == null ? null : f.capital, porte: f.porte || '',
          socios: (f.socios || []).filter((s) => s.tipo === 'PF').slice(0, 6).map((s) => s.nome) };
      } catch (e) { /* a ficha é opcional no relatório */ }
    }
    revisao.itens[chave] = item;
    salvarRevisao();
  }
  async function marcarRapido(orgId, doc, botao) {
    botao.disabled = true;
    try {
      const det = await carregarOrg(orgId);
      const k = det.contratos.map(contrato).find((x) => x.doc === doc);
      const org = dados.orgs.find((o) => o.id === orgId);
      if (k && org) {
        const a = naLista(orgId, k);
        await marcar(org, k, a ? a.motivo : 'renegociar', a ? a.status : 'revisar', a ? a.nota : '');
        botao.textContent = '⚑ Na lista';
      }
    } catch (e) { if (e.sessao) PF.mostrarLogin(); }
    botao.disabled = false;
  }

  function formRevisao(org, k) {
    const atual = naLista(org.id, k);
    const opcoes = (m, v) => Object.entries(m).map(([c, r]) => el('option', { value: c, selected: c === v }, r));
    const motivo = el('select', { 'aria-label': 'Motivo' }, opcoes(MOTIVOS, atual ? atual.motivo : 'renegociar'));
    const status = el('select', { 'aria-label': 'Situação da revisão' }, opcoes(STATUS, atual ? atual.status : 'revisar'));
    const nota = el('textarea', { rows: 2, placeholder: 'Anotação: por que revisar, o que fazer, quem consultar', 'aria-label': 'Anotação' }, atual ? atual.nota : '');
    return el('div', { class: 'form-revisao' },
      el('strong', {}, atual ? '⚑ Este contrato está na lista de revisão' : 'Marcar para revisão'),
      el('div', { class: 'linha-form' }, el('label', {}, 'Motivo', motivo), el('label', {}, 'Situação', status)),
      el('label', {}, 'Anotação', nota),
      el('div', { class: 'linha-form' },
        el('button', { type: 'button', class: 'botao-primario', onclick: async (ev) => { ev.target.disabled = true; await marcar(org, k, motivo.value, status.value, nota.value.trim()); render(true); } }, atual ? 'Atualizar' : 'Colocar na lista'),
        atual ? el('button', { type: 'button', class: 'botao', onclick: () => { delete revisao.itens[chaveRev(org.id, k)]; salvarRevisao(); render(true); } }, 'Tirar da lista') : null));
  }

  const itensRevisao = () => Object.entries(revisao.itens).map(([chave, i]) => ({ chave, ...i }));
  const somaRev = (lista, campo) => soma(lista, (i) => i[campo] || 0);
  function baixarArquivo(nome, conteudo, tipo) {
    const a = el('a', { href: URL.createObjectURL(new Blob([conteudo], { type: tipo })), download: nome });
    document.body.append(a); a.click(); a.remove();
  }
  function csvRevisao() {
    const aspas = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const cab = ['Órgão', 'Fornecedor', 'CNPJ', 'Objeto', 'Instrumento', 'Motivo', 'Situação da revisão', 'Anotação', 'Valor final', 'Por ano', 'Ainda a receber', 'Pago desde 2021',
      'Vigência até', 'Alertas', 'Marcado em'];
    const linhas = itensRevisao().sort((a, b) => b.anual - a.anual).map((i) => [i.orgNome, i.forn, i.cnpj, i.objeto, i.doc, MOTIVOS[i.motivo], STATUS[i.status], i.nota, i.vfin, i.anual,
      i.restante, i.pago, i.fimef, (i.alertas || []).map((a) => (dados.alertas[a.split(':')[0]] ? dados.alertas[a.split(':')[0]].titulo : a)).join(' | '), i.em]);
    return '﻿' + [cab, ...linhas].map((l) => l.map(aspas).join(';')).join('\r\n');
  }
  async function atualizarValores() {
    let n = 0;
    for (const orgId of [...new Set(itensRevisao().map((i) => i.org))]) {
      let det;
      try { det = await carregarOrg(orgId); } catch (e) { continue; }
      const mapa = new Map(det.contratos.map(contrato).map((k) => [`${k.proc}|${k.doc}`, k]));
      for (const [chave, i] of Object.entries(revisao.itens)) {
        const k = i.org === orgId && mapa.get(`${i.proc}|${i.doc}`);
        if (k) { Object.assign(revisao.itens[chave], { vfin: k.vfin, anual: k.anual, restante: k.restante, pago: k.pago, fimef: k.fimef, alertas: k.alertas, sit: k.sit, ref: dados.ref }); n++; }
      }
    }
    salvarRevisao();
    return n;
  }

  function renderRevisao(c) {
    const f = estado.rev;
    const todos = itensRevisao();
    const lista = todos.filter((i) => (!f.status || i.status === f.status) && (!f.motivo || i.motivo === f.motivo) && (!f.org || String(i.org) === f.org))
      .sort((a, b) => (b.anual || 0) - (a.anual || 0));
    const kp = el('div', { class: 'kpis' },
      kpi('Contratos na lista', nInt.format(todos.length), `${nInt.format(new Set(todos.map((i) => i.cnpj)).size)} fornecedores · ${nInt.format(new Set(todos.map((i) => i.org)).size)} órgãos`),
      kpi('Compromisso anual', brlCompacto(somaRev(todos, 'anual')), 'soma do valor anual dos contratos marcados'),
      kpi('Ainda a receber', brlCompacto(somaRev(todos, 'restante')), 'estimativa do que ainda será desembolsado até o fim das vigências'),
      kpi('Já pago', brlCompacto(somaRev(todos, 'pago')), 'pagamentos vinculados aos empenhos dos contratos, desde 2021'));
    const msg = el('p', { class: 'aviso solto', role: 'status', hidden: !estado.msg }, estado.msg || '');
    const arquivo = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (ev) => {
      const a = ev.target.files[0];
      if (!a) return;
      try {
        const j = JSON.parse(await a.text());
        if (!j || typeof j.itens !== 'object') throw new Error('formato');
        let n = 0;
        for (const [k, v] of Object.entries(j.itens)) if (v && v.doc && v.org != null) { revisao.itens[k] = v; n++; }
        if (j.titulo && !revisao.titulo) revisao.titulo = String(j.titulo).slice(0, 200);
        salvarRevisao(); estado.msg = `${n} contrato(s) importado(s).`;
      } catch (e) { estado.msg = 'Arquivo inválido: use um arquivo salvo por esta tela.'; }
      render();
    } });
    const barra = el('div', { class: 'ferramentas' },
      el('button', { type: 'button', class: 'botao-primario', disabled: !todos.length, onclick: () => ctx.irPara('relatorio') }, 'Gerar relatório para imprimir'),
      el('button', { type: 'button', class: 'botao', disabled: !todos.length, onclick: () => baixarArquivo(`lista-de-revisao-${dados.ref}.csv`, csvRevisao(), 'text/csv;charset=utf-8') }, 'Exportar CSV'),
      el('button', { type: 'button', class: 'botao', disabled: !todos.length, onclick: () => baixarArquivo(`lista-de-revisao-${dados.ref}.json`, JSON.stringify(revisao), 'application/json') }, 'Salvar lista (arquivo)'),
      el('button', { type: 'button', class: 'botao', onclick: () => arquivo.click() }, 'Abrir lista salva'), arquivo,
      el('button', { type: 'button', class: 'botao', disabled: !todos.length, onclick: async (ev) => { ev.target.disabled = true; const n = await atualizarValores(); estado.msg = `${n} contrato(s) com valores atualizados para a posição de ${dataBR(dados.ref)}.`; render(); } }, 'Atualizar valores'),
      el('button', { type: 'button', class: 'botao', disabled: !todos.length, onclick: () => { if (confirm('Remover todos os contratos da lista de revisão neste navegador?')) { revisao.itens = {}; salvarRevisao(); estado.msg = ''; render(); } } }, 'Esvaziar'));
    const sel = (campo, mapa, rotulo) => el('label', {}, rotulo, el('select', { onchange: (ev) => { f[campo] = ev.target.value; render(); } },
      el('option', { value: '' }, 'Todos'), Object.entries(mapa).map(([v, r]) => el('option', { value: v, selected: f[campo] === v }, r))));
    const orgsRev = Object.fromEntries([...new Map(todos.map((i) => [String(i.org), i.orgNome])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')));
    const filtros = el('div', { class: 'filtros' }, sel('status', STATUS, 'Situação'), sel('motivo', MOTIVOS, 'Motivo'), sel('org', orgsRev, 'Órgão'));
    const edita = (i, campo, valor) => { revisao.itens[i.chave][campo] = valor; salvarRevisao(); };
    const select = (mapa, i, campo) => el('select', { 'aria-label': campo, onchange: (ev) => { edita(i, campo, ev.target.value); if (campo === 'status' && f.status) render(); } },
      Object.entries(mapa).map(([v, r]) => el('option', { value: v, selected: i[campo] === v }, r)));
    const tabela = lista.length ? el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Fornecedor e órgão', 'Objeto', 'Valores', 'Até quando', 'Motivo', 'Situação', 'Anotação', ''].map((t, n) => el('th', { class: n === 2 ? 'num' : '' }, t)))),
      el('tbody', {}, lista.map((i) => el('tr', {},
        el('td', {}, el('strong', {}, nomeProprio(i.forn)), el('small', {}, i.orgNome), el('small', {}, cnpjFmt(i.cnpj || ''))),
        el('td', { class: 'objeto' }, i.objeto.length > 160 ? i.objeto.slice(0, 160) + '…' : i.objeto, el('small', {}, `${i.cat} · ${i.modal}`)),
        el('td', { class: 'num' }, brlCompacto(i.anual) + ' por ano', el('small', {}, 'total ' + brlCompacto(i.vfin)), el('small', {}, 'a receber ' + brlCompacto(i.restante))),
        el('td', {}, dataBR(i.fimef), el('small', {}, i.fimef ? 'faltam ' + duracao(mesesAte(i.fimef)) : '')),
        el('td', {}, select(MOTIVOS, i, 'motivo')), el('td', {}, select(STATUS, i, 'status')),
        el('td', {}, el('input', { type: 'text', value: i.nota || '', maxlength: 400, 'aria-label': 'Anotação', onchange: (ev) => edita(i, 'nota', ev.target.value.trim()) })),
        el('td', {}, el('button', { type: 'button', class: 'botao', title: 'Tirar da lista', onclick: () => { delete revisao.itens[i.chave]; salvarRevisao(); render(); } }, '✕')))))))
      : el('p', { class: 'vazio' }, todos.length ? 'Nenhum contrato corresponde aos filtros.' : 'A lista está vazia. Abra um órgão, clique numa linha de contrato e use "Colocar na lista"; ou use "Marcar" na tabela "Contratos para olhar primeiro", no painel do governo.');
    c.replaceChildren(kp, msg, el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Lista de revisão'),
      el('p', {}, 'Contratos a renegociar, rever ou apurar. A lista fica salva neste navegador; use "Salvar lista (arquivo)" para guardá-la ou levá-la a outro computador.'))),
    barra, filtros, tabela));
  }

  // ---------- relatório para impressão ----------
  function renderRelatorio(c) {
    const f = estado.rev;
    const todos = itensRevisao().filter((i) => f.decididos || i.status !== 'decidido');
    const porOrg = new Map();
    for (const i of todos) { if (!porOrg.has(i.org)) porOrg.set(i.org, []); porOrg.get(i.org).push(i); }
    const orgs = [...porOrg.entries()].map(([id, lista]) => ({ id, nome: lista[0].orgNome, lista: lista.sort((a, b) => b.anual - a.anual), anual: somaRev(lista, 'anual'), restante: somaRev(lista, 'restante'), vfin: somaRev(lista, 'vfin') }))
      .sort((a, b) => b.anual - a.anual);
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const titulo_ = revisao.titulo || 'Contratos a rever';
    const SENSIVEIS = /^(socio_|doacao_|fornecedor_campanha|rede_grande|endereco_comum)/;
    const textoAlertas = (i) => (i.alertas || []).filter((a) => !a.endsWith(':i') && (f.sensivel || !SENSIVEIS.test(a))).map((a) => (dados.alertas[a.split(':')[0]] ? dados.alertas[a.split(':')[0]].titulo : a));
    const porMotivo = Object.entries(MOTIVOS).map(([m, r]) => { const l = todos.filter((i) => i.motivo === m); return [r, l.length, somaRev(l, 'anual'), somaRev(l, 'restante')]; }).filter((x) => x[1]);
    const controles = el('div', { class: 'no-print cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Relatório para impressão'),
      el('p', {}, 'Ajuste o título e a introdução, confira a prévia abaixo e use "Imprimir ou salvar em PDF" (no diálogo do navegador, escolha "Salvar como PDF").'))),
    el('div', { class: 'filtros' },
      el('label', { class: 'busca' }, 'Título do relatório', el('input', { type: 'text', value: revisao.titulo, placeholder: 'Contratos a rever', maxlength: 160, onchange: (ev) => { revisao.titulo = ev.target.value.trim(); salvarRevisao(); render(); } })),
      el('label', { class: 'busca' }, 'Introdução (opcional)', el('textarea', { rows: 3, placeholder: 'Contexto, critério de escolha dos contratos, destinatário…', onchange: (ev) => { revisao.intro = ev.target.value.trim(); salvarRevisao(); render(); } }, revisao.intro))),
    el('div', { class: 'ferramentas' },
      el('button', { type: 'button', class: 'botao-primario', onclick: () => window.print() }, 'Imprimir ou salvar em PDF'),
      el('button', { type: 'button', class: 'botao', onclick: () => ctx.irPara('revisao') }, 'Voltar à lista'),
      el('label', { class: 'opcao' }, el('input', { type: 'checkbox', checked: !!f.decididos, onchange: (ev) => { f.decididos = ev.target.checked; render(); } }), ' Incluir os já decididos'),
      el('label', { class: 'opcao', title: 'Nomes de sócios e alertas sobre doações, candidaturas e sócios em comum. Deixe desligado para circulação ampla.' }, el('input', { type: 'checkbox', checked: !!f.sensivel, onchange: (ev) => { f.sensivel = ev.target.checked; render(); } }), ' Incluir sócios e vínculos políticos (versão restrita)')));
    if (!todos.length) return c.replaceChildren(controles, el('p', { class: 'vazio' }, 'Não há contratos para o relatório.'));
    const cab = (cols) => el('thead', {}, el('tr', {}, cols.map((t, n) => el('th', { class: n ? 'num' : '' }, t))));
    const resumo = el('table', { class: 'tabela-resumo' }, cab(['Órgão', 'Contratos', 'Por ano', 'Ainda a receber']),
      el('tbody', {}, orgs.map((o) => el('tr', {}, el('td', {}, o.nome), el('td', { class: 'num' }, nInt.format(o.lista.length)), el('td', { class: 'num' }, brlCompacto(o.anual)), el('td', { class: 'num' }, brlCompacto(o.restante)))),
        el('tr', { class: 'total' }, el('td', {}, 'Total'), el('td', { class: 'num' }, nInt.format(todos.length)), el('td', { class: 'num' }, brlCompacto(somaRev(todos, 'anual'))), el('td', { class: 'num' }, brlCompacto(somaRev(todos, 'restante'))))));
    const motivos = el('table', { class: 'tabela-resumo' }, cab(['Motivo da revisão', 'Contratos', 'Por ano', 'Ainda a receber']),
      el('tbody', {}, porMotivo.map(([r, n, a, rest]) => el('tr', {}, el('td', {}, r), el('td', { class: 'num' }, nInt.format(n)), el('td', { class: 'num' }, brlCompacto(a)), el('td', { class: 'num' }, brlCompacto(rest))))));
    const secoes = orgs.map((o) => el('section', { class: 'rel-orgao' }, el('h3', {}, `${o.nome} · ${nInt.format(o.lista.length)} contrato(s) · ${brlCompacto(o.anual)} por ano`),
      el('table', {}, el('thead', {}, el('tr', {}, ['#', 'Fornecedor e objeto', 'Valores', 'Vigência', 'Revisão'].map((t, n) => el('th', { class: n === 2 ? 'num' : '' }, t)))),
        el('tbody', {}, o.lista.map((i, n) => {
          const fi = i.fornInfo;
          const linhaForn = fi ? [fi.situacao && `Receita: ${fi.situacao.toLowerCase()}`, fi.abertura && `aberta em ${dataBR(fi.abertura)}`, fi.porte, fi.capital != null && `capital ${brlCompacto(fi.capital)}`].filter(Boolean).join(' · ') : '';
          return el('tr', {},
            el('td', {}, String(n + 1)),
            el('td', { class: 'objeto' }, el('strong', {}, nomeProprio(i.forn)), el('small', {}, cnpjFmt(i.cnpj || '') + ' · ' + i.doc), i.objeto, el('small', {}, `${i.cat} · ${i.modal} · ${ESS()[i.ess] || ''}`),
              linhaForn ? el('small', {}, linhaForn) : null, f.sensivel && fi && fi.socios.length ? el('small', {}, 'Sócios: ' + fi.socios.map(nomeProprio).join(', ')) : null,
              textoAlertas(i).length ? el('small', { class: 'alertas-rel' }, 'Alertas: ' + textoAlertas(i).join('; ')) : null),
            el('td', { class: 'num' }, brlCompacto(i.anual) + ' por ano', el('small', {}, 'total ' + brlCompacto(i.vfin)), el('small', {}, 'a receber ' + brlCompacto(i.restante)), i.pago > 0 ? el('small', {}, 'pago ' + brlCompacto(i.pago)) : null),
            el('td', {}, `${dataBR(i.ini)} a ${dataBR(i.fimef)}`, el('small', {}, i.fimef ? 'faltam ' + duracao(mesesAte(i.fimef)) : 'sem prazo definido')),
            el('td', {}, el('strong', {}, MOTIVOS[i.motivo]), el('small', {}, STATUS[i.status]), i.nota ? el('small', { class: 'nota-rel' }, i.nota) : null));
        })))));
    const relatorio = el('article', { class: 'relatorio' },
      el('header', {}, el('p', { class: 'rel-sup' }, 'Painel Fiscal · Espírito Santo · Contratações'), el('h1', {}, titulo_),
        el('p', { class: 'rel-data' }, `Emitido em ${hoje}. Posição dos dados: ${dataBR(dados.ref)}.`),
        revisao.intro ? el('p', { class: 'rel-intro' }, revisao.intro) : null),
      el('section', {}, el('h3', {}, 'Resumo'),
        el('p', {}, `${nInt.format(todos.length)} contratos de ${nInt.format(new Set(todos.map((i) => i.cnpj)).size)} fornecedores em ${nInt.format(orgs.length)} órgãos, somando ${brlCompacto(somaRev(todos, 'anual'))} por ano e ${brlCompacto(somaRev(todos, 'restante'))} ainda a receber até o fim das vigências (estimativa).`),
        resumo, el('div', { class: 'espaco' }), motivos),
      ...secoes,
      el('section', { class: 'rel-notas' }, el('h3', {}, 'Notas'),
        el('p', {}, `Fontes: ${dados.fonte.contratos}; ${dados.fonte.cadastro}; execução da despesa (SIGEFES) do Portal da Transparência.`),
        el('p', {}, 'Valor por ano é o valor final do contrato distribuído pela duração (no mínimo 12 meses). "A receber" é estimativa linear sobre o tempo restante. "Pago" soma os pagamentos dos empenhos que o SIGA vincula ao contrato, de 2021 em diante.'),
        el('p', {}, 'Os alertas são regras objetivas de triagem e indicam onde olhar primeiro; não provam irregularidade. A classificação do objeto e a essencialidade são sugestões automáticas a validar. Este é um documento de trabalho.'),
        el('p', {}, f.sensivel ? 'Versão restrita: contém nomes de sócios e alertas sobre vínculos políticos; não deve circular além de quem precisa conferir.' : 'Versão de circulação ampla: sem nomes de sócios nem alertas sobre doações, candidaturas e sócios em comum.')));
    c.replaceChildren(controles, relatorio);
  }

  // ---------- montagem ----------
  function render(manterFoco) {
    if (!raiz || !$('#conteudo')) return;
    const rolagem = manterFoco ? window.scrollY : null;
    const ativo = manterFoco && document.activeElement && document.activeElement.type === 'search' ? document.activeElement.closest('label') : null;
    PF.limparObservadores();
    esconderDica();
    renderTrilha();
    const c = $('#conteudo');
    ++tokenRender;
    c.classList.remove('carregando');
    const pronto = estado.tela === 'revisao' ? renderRevisao(c) : estado.tela === 'relatorio' ? renderRelatorio(c) : estado.forn ? renderForn(c) : estado.org ? renderOrg(c) : renderGoverno(c);
    if (rolagem != null) Promise.resolve(pronto).then(() => {
      window.scrollTo(0, rolagem);
      if (ativo) { const campo = $('#lista-contratos .busca input'); if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); } }
    });
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Contratações</h2>
          <p class="sub">Contratos do Poder Executivo por órgão, fornecedores, quadro societário e alertas de triagem para revisão.</p>
        </div>
        <span class="topo-acoes"><button type="button" id="ir-revisao" class="botao">⚑ Lista de revisão (0)</button><span id="mesref" class="mesref"></span></span>
      </div>
      <nav id="trilha" class="trilha" aria-label="Navegação"></nav>
      <div id="conteudo"></div>
      <footer class="rodape"><details><summary>Fonte e método de cálculo</summary><div id="metodo"></div></details></footer>
    </section>`;

  function preencherMetodo() {
    const lista = Object.values(dados.alertas).map((v) => el('li', {}, el('b', {}, `${v.titulo} (nível padrão: ${v.nivel}): `), v.descricao));
    $('#metodo').replaceChildren(
      el('p', {}, `Fontes: ${dados.fonte.contratos}; ${dados.fonte.cadastro}; e a folha de pagamento do Poder Executivo (módulo Cargos), para o cruzamento de nomes de sócios com servidores. Posição em ${dataBR(dados.ref)}.`),
      el('p', {}, 'Desde quando é a data do primeiro instrumento registrado do fornecedor no SIGA (a base começa em 2016). Ainda a receber é uma estimativa linear: valor anual do contrato vezes o tempo que falta, limitado ao valor final. A essencialidade é uma classificação sugerida pelo tipo de objeto (essencial, suporte, investimento, discricionário), para orientar a conversa com o gestor, não para decidir por ele.'),
      el('p', {}, 'Contrato vigente é o instrumento do tipo contrato, carta-contrato ou termo de adesão cuja data final, já considerados os aditivos de prazo, não passou, e cuja situação não é de encerramento, rescisão ou anulação. Compras avulsas (autorizações de compra, ordens de fornecimento e de serviço, notas de empenho) não entram na lista de vigentes, mas entram nos totais empenhados e na contratação direta.'),
      el('p', {}, 'Valor final é o valor total do instrumento. Em registros de preços, costuma ser o máximo estimado, não o que será executado. Compromisso anual é o valor final dividido pela duração em meses (no mínimo 12) e multiplicado por 12. Saldo a executar é o valor final menos o total empenhado no instrumento. Empenhado é o valor empenhado no ano, conforme o SIGA, que não cobre toda a execução. Pago vem da execução da despesa do SIGEFES (Portal da Transparência, despesas): somam-se os pagamentos aos CNPJs que aparecem nos contratos, por unidade gestora, ligada ao órgão do SIGA pelo número do empenho. No contrato, o pago soma só os empenhos que o SIGA vincula a ele e cobre de 2021 em diante; no órgão e na ficha do fornecedor, é tudo o que o órgão pagou ao CNPJ, com ou sem contrato.'),
      el('p', {}, 'O tipo de objeto é uma classificação automática por palavras-chave e serve apenas para triagem. Os alertas são regras objetivas, listadas abaixo; indicam onde vale olhar primeiro e não provam irregularidade. A comparação de preços entre contratações ainda não foi feita.'),
      el('ul', { class: 'lista-metodo' }, lista));
    $('#mesref').textContent = 'Referência: ' + dataBR(dados.ref);
  }

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#conteudo').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar os dados.'));
      return false;
    }
    preencherMetodo();
    $('#ir-revisao').addEventListener('click', () => ctx.irPara('revisao'));
    atualizarContador();
    return true;
  }
  function desmontar() { revisao = lerRevisao(); dados = null; cacheOrg.clear(); cacheForn.clear(); listaBusca = null; todosForn = null; }
  PF.registrar({ id: 'contratacoes', titulo: 'Contratações', montar, aoNavegar, desmontar });
})();
