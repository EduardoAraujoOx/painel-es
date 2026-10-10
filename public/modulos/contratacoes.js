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
    f: { situ: 'vigentes', cat: '', modal: '', alerta: '', q: '' }, ordem: { col: 'anual', dir: -1 }, limite: 50,
    aberto: new Set(),
  };
  const PESO = { a: 3, m: 1, i: 0 };
  const NIVEL = { a: 'Alta', m: 'Média', i: 'Info' };

  // ---------- utilidades ----------
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
  function irOrg(id) { estado.f = { situ: 'vigentes', cat: '', modal: '', alerta: '', q: '' }; estado.limite = 50; estado.aberto.clear(); estado.verTodosForn = false; ctx.irPara(String(id)); }
  function irForn(cnpj, origem) { estado.origem = origem == null ? estado.org : origem; ctx.irPara('f:' + cnpj); }
  function aoNavegar(resto) {
    if (!dados) return;
    const r = decodeURIComponent(resto || '');
    estado.forn = r.startsWith('f:') ? r.slice(2) : null;
    const id = !estado.forn && r ? Number(r) : null;
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
    if (!estado.forn && !estado.org) { t.replaceChildren(el('span', { class: 'atual' }, 'Governo do ES')); return; }
    if (org) {
      itens.push(sep());
      itens.push(estado.forn ? el('button', { type: 'button', onclick: () => irOrg(org.id) }, org.nome) : el('span', { class: 'atual' }, org.nome));
    }
    if (estado.forn) { itens.push(sep()); itens.push(el('span', { class: 'atual' }, 'Fornecedor ' + cnpjFmt(estado.forn))); }
    t.replaceChildren(...itens);
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
      kpi('Empenhado nos contratos', brlCompacto(tot('empAnt') + tot('empAtu')), `${aAnt}: ${brlCompacto(tot('empAnt'))} · ${aAtu} (até a data): ${brlCompacto(tot('empAtu'))}`),
      kpi('Alertas de nível alto', nInt.format(tot('contratosAlta')), 'contratos com ao menos um sinal alto'));

    const medidas = { anual: ['Compromisso anual dos contratos vigentes', (x) => x.anualVigente], emp: [`Empenhado em ${aAnt} e ${aAtu}`, (x) => x.empAnt + x.empAtu],
      alertas: ['Contratos com alerta alto', (x) => x.contratosAlta] };
    const [rotuloMedida, valorDe] = medidas[estado.medida];
    const cartao = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' },
      el('div', {}, el('h2', {}, 'Quem concentra os contratos'),
        el('p', {}, `Área proporcional a: ${rotuloMedida.toLowerCase()}. Clique num órgão para detalhar.`)),
      el('div', { class: 'grupo-abas' },
        abas([['anual', 'Compromisso anual'], ['emp', 'Empenhado'], ['alertas', 'Alertas']], estado.medida, (v) => { estado.medida = v; render(); }),
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
            dicaLinha(null, nInt.format(b.o.vigentes), 'contratos vigentes'), dicaLinha(null, brlCompacto(b.o.empAnt + b.o.empAtu), 'empenhado no período'),
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
      el('thead', {}, el('tr', {}, ['Órgão e fornecedor', 'Objeto', 'Por ano', 'Alertas'].map((t, i) => el('th', { class: i === 2 ? 'num' : '' }, t)))),
      el('tbody', {}, prior.map((p) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => { irOrg(p.org); },
        onkeydown: (ev) => { if (ev.key === 'Enter') irOrg(p.org); } },
      el('td', {}, el('strong', {}, nomeProprio(p.forn)), el('small', {}, p.orgNome)),
      el('td', { class: 'objeto' }, p.objeto, el('small', {}, p.cat)),
      el('td', { class: 'num' }, brlCompacto(p.anual), el('small', {}, 'saldo ' + brlCompacto(p.saldo))),
      el('td', {}, selos(p.alertas, 3))))))),
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

    c.replaceChildren(kp, el('div', { class: 'ferramentas' }, caixaBusca()), cartao, cPrior, cForn);
  }

  function tabelaOrgs() {
    const { col, dir } = estado.ordemOrgs;
    const linhas = [...dados.orgs].filter((x) => x.vigentes || x.empAnt || x.empAtu);
    linhas.sort((a, b) => (col === 'nome' ? a.nome.localeCompare(b.nome, 'pt-BR') : (a[col] - b[col])) * dir);
    const cols = [['nome', 'Órgão'], ['vigentes', 'Vigentes', 1], ['anualVigente', 'Compromisso anual', 1], ['saldoVigente', 'Saldo a executar', 1],
      ['empAnt', 'Empenhado ' + dados.anosGasto[0], 1], ['empAtu', 'Empenhado ' + dados.anosGasto[1], 1], ['diretaPct', 'Contratação direta', 1],
      ['maiorFornAnual', 'Maior fornecedor', 1], ['contratosAlta', 'Alertas altos', 1], ['fornecedoresSinalizados', 'Fornecedores sinalizados', 1]];
    return el('div', { class: 'rolagem' }, el('table', {},
      cabecalhoOrdenavel(cols, estado.ordemOrgs, (k) => { estado.ordemOrgs = { col: k, dir: col === k ? -dir : -1 }; render(); }),
      el('tbody', {}, linhas.map((x) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => irOrg(x.id), onkeydown: (ev) => { if (ev.key === 'Enter') irOrg(x.id); } },
        el('td', {}, el('strong', {}, x.nome)),
        el('td', { class: 'num' }, nInt.format(x.vigentes)), el('td', { class: 'num' }, brlCompacto(x.anualVigente)), el('td', { class: 'num' }, brlCompacto(x.saldoVigente)),
        el('td', { class: 'num' }, brlCompacto(x.empAnt)), el('td', { class: 'num' }, brlCompacto(x.empAtu)), el('td', { class: 'num' }, pct(x.diretaPct)),
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
      kpi('Empenhado nos contratos', brlCompacto(org.empAnt + org.empAtu), `${aAnt}: ${brlCompacto(org.empAnt)} · ${aAtu}: ${brlCompacto(org.empAtu)}`),
      kpi('Contratação direta', pct(org.diretaPct), `dispensa e inexigibilidade, do valor contratado em ${aAnt}–${aAtu}`),
      kpi('Maior fornecedor', pct(org.maiorFornAnual), 'participação no compromisso anual vigente'),
      kpi('Alertas', `${nInt.format(org.contratosAlta)} altos`, `${nInt.format(org.contratosMedia)} contratos com sinal médio · ${nInt.format(org.fornecedoresSinalizados)} fornecedores sinalizados`));
    const aviso = cob != null && cob < 0.35 ? el('p', { class: 'aviso solto' },
      `Atenção: os empenhos registrados no SIGA cobrem só ${pct(cob)} do compromisso anual deste órgão. Parte da execução (obras, por exemplo) ocorre fora desse registro, e por isso os alertas que dependem de empenho são menos confiáveis aqui.`) : null;

    // categorias e modalidades (compromisso anual dos vigentes)
    const por = (campo) => {
      const m = new Map();
      for (const k of vig) m.set(k[campo], (m.get(k[campo]) || 0) + k.anual);
      return [...m].sort((a, b) => b[1] - a[1]);
    };
    const barras = (lista, campo, titulo_, sub) => {
      const max = Math.max(1, ...lista.map((x) => x[1]));
      return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, titulo_), el('p', {}, sub))),
        lista.length ? el('div', { class: 'linhas' }, lista.slice(0, 10).map(([n, v]) => el('button', { type: 'button', class: 'linha-barra' + (estado.f[campo] === n ? ' ativa' : ''),
          onclick: () => { estado.f[campo] = estado.f[campo] === n ? '' : n; estado.limite = 50; render(); } },
        el('span', { class: 'nome' }, n), el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, (v / max) * 64)}%` }),
          el('span', { class: 'num' }, brlCompacto(v)))))) : el('p', { class: 'vazio' }, 'Sem contratos vigentes.'));
    };
    const cCat = barras(por('cat'), 'cat', 'O que se contrata', 'Compromisso anual dos contratos vigentes por tipo de objeto (classificação automática por palavras-chave). Clique para filtrar a lista.');
    const cMod = barras(por('modal'), 'modal', 'Como se contrata', 'Compromisso anual por modalidade do processo. Dispensa e inexigibilidade dispensam a competição.');

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

    c.replaceChildren(...[kp, aviso, el('div', { class: 'duas-colunas' }, cCat, cMod), cForn, cSerie, cartaoContratos(todos, org)].filter(Boolean));
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
      sel(f.modal, [['', 'Todas'], ...mods.map((x) => [x, x])], (v) => { f.modal = v; }, 'Modalidade'),
      sel(f.alerta, [['', 'Todos'], ['algum', 'Com algum alerta'], ['alto', 'Com alerta alto'], ...codigos.map((x) => ['cod:' + x, dados.alertas[x].titulo])], (v) => { f.alerta = v; }, 'Alerta'),
      el('label', { class: 'busca' }, 'Buscar', el('input', { type: 'search', value: f.q, placeholder: 'Fornecedor, objeto, nº do contrato ou CNPJ', autocomplete: 'off',
        oninput: (ev) => { clearTimeout(cartaoContratos.t); cartaoContratos.t = setTimeout(() => { f.q = ev.target.value.trim(); estado.limite = 50; render(true); }, 220); } })));
    const cols = [['forn', 'Fornecedor e objeto'], ['-', 'Tipo'], ['anual', 'Por ano', 1], ['saldo', 'Saldo a executar', 1], ['fimef', 'Vigência até'], ['pts', 'Alertas']];
    const visiveis = lista.slice(0, estado.limite);
    const linhas = visiveis.flatMap((k) => {
      const aberto = estado.aberto.has(k.doc + k.proc);
      const tr = el('tr', { class: 'clicavel' + (aberto ? ' aberta' : ''), tabindex: '0', 'aria-expanded': String(aberto),
        onclick: () => { const id = k.doc + k.proc; if (estado.aberto.has(id)) estado.aberto.delete(id); else estado.aberto.add(id); render(true); },
        onkeydown: (ev) => { if (ev.key === 'Enter') ev.currentTarget.click(); } },
      el('td', { class: 'objeto' }, el('strong', {}, nomeProprio(k.forn)), el('small', {}, k.objeto.length > 150 ? k.objeto.slice(0, 150) + '…' : k.objeto)),
      el('td', {}, k.cat, el('small', {}, k.modal + (k.rp ? ' · registro de preços' : ''))),
      el('td', { class: 'num' }, brlCompacto(k.anual), el('small', {}, 'total ' + brlCompacto(k.vfin))),
      el('td', { class: 'num' }, k.saldo == null ? '—' : brlCompacto(k.saldo)),
      el('td', {}, dataBR(k.fimef), k.npror ? el('small', {}, `${k.npror} prorrog.`) : null),
      el('td', {}, selos(k.alertas, 2)));
      if (!aberto) return [tr];
      const dl = el('dl', { class: 'detalhes' },
        ...[['Objeto', k.objeto], ['Instrumento', k.doc], ['Processo', k.proc], ['Fornecedor', `${nomeProprio(k.forn)} · ${cnpjFmt(k.cnpj)}`],
          ['Celebração', dataBR(k.cel)], ['Vigência', `${dataBR(k.ini)} a ${dataBR(k.fim)}` + (k.fimef !== k.fim ? ` (com aditivos: até ${dataBR(k.fimef)})` : '')],
          ['Valor inicial → final', `${brlCompacto(k.vini)} → ${brlCompacto(k.vfin)}`],
          ['Empenhado', `${dados.anosGasto[0]}: ${brlCompacto(k.empAnt)} · ${dados.anosGasto[1]}: ${brlCompacto(k.empAtu)}`],
          ['Situação no SIGA', k.sit]].flatMap(([t, v]) => [el('dt', {}, t), el('dd', {}, v)]));
      const alertas = k.alertas.length ? el('ul', { class: 'lista-alertas' }, k.alertas.map((a) => el('li', {}, selo(a), ' ', dados.alertas[a.split(':')[0]].descricao))) : null;
      const acao = el('button', { type: 'button', class: 'botao', onclick: (ev) => { ev.stopPropagation(); irForn(k.cnpj, org.id); } }, 'Ficha do fornecedor e sócios');
      return [tr, el('tr', { class: 'detalhe-linha' }, el('td', { colspan: 6 }, dl, alertas, acao))];
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
      'Celebração', 'Vigência até', 'Situação', 'Alertas'];
    const linhas = lista.map((k) => [org.nome, k.doc, k.proc, k.forn, k.cnpj, k.objeto, k.cat, k.modal, k.vini, k.vfin, k.anual, k.saldo, k.cel, k.fimef, k.sit,
      k.alertas.map((a) => `${NIVEL[a.split(':')[1]]}: ${dados.alertas[a.split(':')[0]].titulo}`).join(' | ')]);
    const csv = '﻿' + [cab, ...linhas].map((l) => l.map(aspas).join(';')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `contratos-${org.nome.replace(/\W+/g, '-')}-${dados.ref}.csv` });
    document.body.append(a); a.click(); a.remove();
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
      el('thead', {}, el('tr', {}, [['Órgão'], ['Contratos', 1], ['Vigentes', 1], ['Por ano (vigentes)', 1], ['Empenhado total', 1], ['Empenhado recente', 1]].map(([t, n]) => el('th', { class: n ? 'num' : '' }, t)))),
      el('tbody', {}, f.orgaos.map(([id, nome, nct, vig, anual, empT, empR]) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => irOrg(id), onkeydown: (ev) => { if (ev.key === 'Enter') irOrg(id); } },
        el('td', {}, el('strong', {}, nome)), el('td', { class: 'num' }, nInt.format(nct)), el('td', { class: 'num' }, nInt.format(vig)),
        el('td', { class: 'num' }, brlCompacto(anual)), el('td', { class: 'num' }, brlCompacto(empT)), el('td', { class: 'num' }, brlCompacto(empR))))))));
    c.replaceChildren(ficha, alertas, socios, orgs);
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
    const pronto = estado.forn ? renderForn(c) : estado.org ? renderOrg(c) : renderGoverno(c);
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
        <span id="mesref" class="mesref"></span>
      </div>
      <nav id="trilha" class="trilha" aria-label="Navegação"></nav>
      <div id="conteudo"></div>
      <footer class="rodape"><details><summary>Fonte e método de cálculo</summary><div id="metodo"></div></details></footer>
    </section>`;

  function preencherMetodo() {
    const lista = Object.values(dados.alertas).map((v) => el('li', {}, el('b', {}, `${v.titulo} (nível padrão: ${v.nivel}): `), v.descricao));
    $('#metodo').replaceChildren(
      el('p', {}, `Fontes: ${dados.fonte.contratos}; ${dados.fonte.cadastro}; e a folha de pagamento do Poder Executivo (módulo Cargos), para o cruzamento de nomes de sócios com servidores. Posição em ${dataBR(dados.ref)}.`),
      el('p', {}, 'Contrato vigente é o instrumento do tipo contrato, carta-contrato ou termo de adesão cuja data final, já considerados os aditivos de prazo, não passou, e cuja situação não é de encerramento, rescisão ou anulação. Compras avulsas (autorizações de compra, ordens de fornecimento e de serviço, notas de empenho) não entram na lista de vigentes, mas entram nos totais empenhados e na contratação direta.'),
      el('p', {}, 'Valor final é o valor total do instrumento. Em registros de preços, costuma ser o máximo estimado, não o que será executado. Compromisso anual é o valor final dividido pela duração em meses (no mínimo 12) e multiplicado por 12. Saldo a executar é o valor final menos o total empenhado no instrumento. Empenhado é o valor empenhado no ano, conforme o SIGA, que não cobre toda a execução: obras e outras despesas pagas por fora do sistema não aparecem.'),
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
    return true;
  }
  function desmontar() { dados = null; cacheOrg.clear(); cacheForn.clear(); listaBusca = null; }
  PF.registrar({ id: 'contratacoes', titulo: 'Contratações', montar, aoNavegar, desmontar });
})();
