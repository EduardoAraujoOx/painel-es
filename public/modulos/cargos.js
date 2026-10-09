(() => {
  'use strict';
  // Módulo "Cargos em comissão e funções gratificadas".
  const { el, nInt, nBRL, brlCompacto, rotuloMes, mesesEntre, titulo, norm, soma, mediana,
    mostrarDica, esconderDica, dicaLinha, dicaNoElemento, observar,
    graficoLinhas, graficoBarras, mapaDeBlocos } = PF;

  // Órgãos destacados no mapa; os demais ficam em cinza (ênfase, não categorias).
  const FOCO = ['SEFAZ', 'SEP'];
  const PROV_PURO = 'Comissionado sem vínculo efetivo';
  const PROV_SUBSIDIO = 'Subsídio';

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);

  // ---------- estado ----------
  let dados = null;
  const cacheOrg = new Map();
  let tokenRender = 0;
  const estado = {
    tipo: 'todos', medida: 'custo', prov: 'todos', busca: '',
    org: null, funcao: null, vistaOrgs: 'mapa', verTodasFuncoes: false,
    ordemOrgs: { col: 'custo', dir: -1 }, ordemOcup: { col: 'valor', dir: -1 }, limite: 100,
  };
  const incluiCC = () => estado.tipo !== 'FG';
  const incluiFG = () => estado.tipo !== 'CC';
  const qtd = (r) => (incluiCC() ? r.cc : 0) + (incluiFG() ? r.fg : 0);
  const custo = (r) => (incluiCC() ? r.custoCC : 0) + (incluiFG() ? r.custoFG : 0);
  const entradas = (r) => (incluiCC() ? r.entCC : 0) + (incluiFG() ? r.entFG : 0);
  const saidas = (r) => (incluiCC() ? r.saiCC : 0) + (incluiFG() ? r.saiFG : 0);

  // ---------- filtros e navegação ----------
  function orgsVisiveis() {
    const q = norm(estado.busca);
    return dados.orgs.filter((o) => !q || norm(o.sigla).includes(q) || norm(o.nome).includes(q));
  }
  function passaProv(o) {
    if (estado.prov === 'todos') return true;
    if (estado.prov === 'puro') return o.prov === PROV_PURO;
    if (estado.prov === 'subsidio') return o.prov === PROV_SUBSIDIO;
    return o.prov.startsWith('Servidor com vínculo');
  }
  function ocupantesBase(lista) {
    const q = norm(estado.busca);
    return lista.filter((o) => (o.tipo === 'CC' ? incluiCC() : incluiFG()) && passaProv(o)
      && (!q || norm(o.nome).includes(q) || norm(o.funcao).includes(q) || norm(o.unidade).includes(q)));
  }
  const chaveFuncao = (o) => o.tipo + '|' + o.funcao;
  function somarSerie(orgs) {
    return dados.meses.map((m, i) => {
      const t = { mes: m, cc: 0, fg: 0, custoCC: 0, custoFG: 0, entCC: 0, entFG: 0, saiCC: 0, saiFG: 0, trocCC: 0, trocFG: 0 };
      for (const o of orgs) { const r = o.s[i]; for (const k in t) if (k !== 'mes') t[k] += r[k]; }
      return t;
    });
  }
  function selecionarOrg(sigla) {
    estado.funcao = null; estado.limite = 100; estado.verTodasFuncoes = false;
    ctx.irPara(sigla || '');
  }
  function aoNavegar(resto) {
    if (!dados) return;
    const sigla = decodeURIComponent(resto || '');
    estado.org = dados.orgs.some((o) => o.sigla === sigla) ? sigla : null;
    estado.funcao = null; estado.limite = 100;
    render();
  }

  function renderTrilha() {
    const t = $('#trilha');
    const itens = [];
    if (estado.org) {
      itens.push(el('button', { type: 'button', onclick: () => selecionarOrg(null) }, 'Governo do ES'));
      itens.push(el('span', { class: 'sep' }, '›'));
      if (estado.funcao) {
        itens.push(el('button', { type: 'button', onclick: () => { estado.funcao = null; render(); } }, estado.org));
        itens.push(el('span', { class: 'sep' }, '›'));
        itens.push(el('span', { class: 'atual' }, titulo(estado.funcao.split('|')[1])));
      } else {
        itens.push(el('span', { class: 'atual' }, estado.org));
      }
    } else {
      itens.push(el('span', { class: 'atual' }, 'Governo do ES'));
    }
    t.replaceChildren(...itens);
  }

  // ---------- componentes ----------
  const kpi = (rotulo, valor, nota) => el('div', { class: 'kpi' },
    el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);

  function abas(opcoes, atual, aoMudar) {
    return el('div', { class: 'abas', role: 'group' }, opcoes.map(([v, r]) =>
      el('button', { type: 'button', 'aria-pressed': String(v === atual), onclick: () => aoMudar(v) }, r)));
  }
  const rotuloMedida = () => (estado.medida === 'custo' ? 'custo mensal dos cargos' : 'número de ocupantes');
  const rotuloTipo = () => (estado.tipo === 'CC' ? 'cargos em comissão' : estado.tipo === 'FG' ? 'funções gratificadas' : 'cargos em comissão e funções gratificadas');

  function cartaoEvolucao(serie, titulo_) {
    const meses = serie.map((r) => r.mes);
    const series = [];
    if (incluiCC()) series.push({ nome: 'Cargos em comissão', cor: 'var(--serie-1)', vals: serie.map((r) => r.cc) });
    if (incluiFG()) series.push({ nome: 'Funções gratificadas', cor: 'var(--serie-2)', vals: serie.map((r) => r.fg) });
    const fluxo = [
      { nome: 'Entradas', cor: 'var(--serie-1)', barra: true, vals: serie.map(entradas) },
      { nome: 'Saídas', cor: 'var(--serie-2)', barra: true, vals: serie.map(saidas) },
    ];
    const a = el('div', { class: 'cartao' },
      el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, titulo_),
        el('p', {}, 'Ocupantes por mês, ' + rotuloTipo() + '.'))));
    graficoLinhas(a, { meses, series, fmt: (v) => nInt.format(v) });
    const b = el('div', { class: 'cartao' },
      el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Entradas e saídas por mês'),
        el('p', {}, 'Pessoas que passaram a ocupar ou deixaram de ocupar a função, em relação ao mês anterior.'))));
    graficoBarras(b, { meses: meses.slice(1), series: fluxo.map((s) => ({ ...s, vals: s.vals.slice(1) })), fmt: (v) => nInt.format(v) });
    return el('div', { class: 'duas-colunas' }, a, b);
  }

  // ---------- visão: governo ----------
  function renderGoverno(c) {
    const orgs = orgsVisiveis();
    const serie = somarSerie(orgs);
    const u = serie[serie.length - 1];
    const ult12 = serie.slice(-12);
    const sai12 = soma(ult12, saidas);
    const kp = el('div', { class: 'kpis' },
      kpi('Ocupantes', nInt.format(qtd(u)), `em ${orgs.filter((o) => qtd(o.s[o.s.length - 1]) > 0).length} órgãos · ${rotuloMes(dados.mes, true)}`),
      kpi('Custo mensal dos cargos', brlCompacto(custo(u)), 'soma do valor do cargo no mês'),
      kpi('Custo anualizado', brlCompacto(custo(u) * 12), 'mês × 12, sem 13º, férias e encargos'),
      kpi('Saídas em 12 meses', nInt.format(sai12), qtd(u) ? `${((sai12 / qtd(u)) * 100).toFixed(0).replace('.', ',')}% do quadro atual` : ''));

    const itens = orgs.map((o) => {
      const r = o.s[o.s.length - 1];
      return { o, v: estado.medida === 'custo' ? custo(r) : qtd(r), n: qtd(r), c: custo(r) };
    }).filter((i) => i.v > 0);

    const cartao = el('div', { class: 'cartao' },
      el('div', { class: 'cartao-topo' },
        el('div', {}, el('h2', {}, 'Onde estão os cargos'),
          el('p', {}, `Área proporcional ao ${rotuloMedida()} (${rotuloMes(dados.mes, true)}). Clique num órgão para detalhar.`)),
        abas([['mapa', 'Mapa'], ['tabela', 'Tabela']], estado.vistaOrgs, (v) => { estado.vistaOrgs = v; render(); })));
    if (!itens.length) {
      cartao.append(el('p', { class: 'vazio' }, 'Nenhum órgão corresponde aos filtros.'));
    } else if (estado.vistaOrgs === 'mapa') {
      cartao.append(el('div', { class: 'legenda' },
        el('span', {}, el('i', { class: 'chave-caixa', style: 'background:var(--serie-1)' }), 'Órgãos em foco (' + FOCO.join(', ') + ')'),
        el('span', {}, el('i', { class: 'chave-caixa', style: 'background:var(--neutro)' }), 'Demais órgãos')));
      const mapa = el('div', { class: 'mapa' });
      cartao.append(mapa);
      observar(mapa, (W) => {
        const H = W < 560 ? 360 : 440;
        mapa.style.height = H + 'px';
        mapa.replaceChildren(...mapaDeBlocos(itens, W, H).map((b) => {
          const nos = () => [el('div', { class: 'tit' }, b.o.nome !== b.o.sigla ? `${b.o.sigla} · ${b.o.nome}` : b.o.sigla),
            dicaLinha(null, nInt.format(b.n), 'ocupantes'), dicaLinha(null, brlCompacto(b.c), 'custo mensal dos cargos')];
          const rotulo = b.w >= 84 && b.h >= 44;
          const btn = el('button', { type: 'button', 'aria-label': `${b.o.sigla}: ${nInt.format(b.n)} ocupantes, ${brlCompacto(b.c)} por mês`,
            onclick: () => { esconderDica(); selecionarOrg(b.o.sigla); },
            onpointermove: (ev) => mostrarDica(nos(), ev.clientX, ev.clientY),
            onpointerleave: esconderDica, onfocus: () => dicaNoElemento(btn, nos), onblur: esconderDica },
            rotulo ? el('b', {}, b.o.sigla) : null,
            rotulo && b.h >= 62 ? el('small', {}, estado.medida === 'custo' ? brlCompacto(b.c) : nInt.format(b.n)) : null);
          return el('div', { class: 'bloco' + (rotulo ? ' rot' : '') + (FOCO.includes(b.o.sigla) ? ' foco' : ''),
            style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px` }, btn);
        }));
      });
    } else {
      cartao.append(tabelaOrgs(orgs));
    }
    c.replaceChildren(kp, cartao, cartaoEvolucao(serie, 'Evolução mensal no governo'));
  }

  function tabelaOrgs(orgs) {
    const linhas = orgs.map((o) => {
      const s = o.s, r = s[s.length - 1];
      return { o, cc: r.cc, fg: r.fg, custoCC: r.custoCC, custoFG: r.custoFG,
        custo: custo(r), ent: soma(s.slice(-12), entradas), sai: soma(s.slice(-12), saidas) };
    }).filter((l) => l.cc + l.fg > 0);
    const { col, dir } = estado.ordemOrgs;
    linhas.sort((a, b) => (col === 'sigla' ? a.o.sigla.localeCompare(b.o.sigla, 'pt-BR') : a[col] - b[col]) * dir);
    const cols = [['sigla', 'Órgão'], ['cc', 'Cargos em comissão', 1], ['fg', 'Funções gratificadas', 1],
      ['custoCC', 'Custo mensal CC', 1], ['custoFG', 'Custo mensal FG', 1], ['ent', 'Entradas (12m)', 1], ['sai', 'Saídas (12m)', 1]];
    return el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, cols.map(([k, r, n]) => el('th', { class: n ? 'num' : '', 'aria-sort': col === k ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
        el('button', { type: 'button', onclick: () => { estado.ordemOrgs = { col: k, dir: col === k ? -dir : -1 }; render(); } }, r + (col === k ? (dir > 0 ? ' ▲' : ' ▼') : '')))))),
      el('tbody', {}, linhas.map((l) => el('tr', { class: 'clicavel', tabindex: '0', onclick: () => selecionarOrg(l.o.sigla),
        onkeydown: (ev) => { if (ev.key === 'Enter') selecionarOrg(l.o.sigla); } },
        el('td', {}, el('strong', {}, l.o.sigla), l.o.nome !== l.o.sigla ? el('small', {}, titulo(l.o.nome)) : null),
        el('td', { class: 'num' }, nInt.format(l.cc)), el('td', { class: 'num' }, nInt.format(l.fg)),
        el('td', { class: 'num' }, brlCompacto(l.custoCC)), el('td', { class: 'num' }, brlCompacto(l.custoFG)),
        el('td', { class: 'num' }, nInt.format(l.ent)), el('td', { class: 'num' }, nInt.format(l.sai)))))));
  }

  // ---------- visão: órgão ----------
  async function carregarOrg(org) {
    if (!cacheOrg.has(org.sigla)) cacheOrg.set(org.sigla, await ctx.api('org/' + org.arquivo));
    return cacheOrg.get(org.sigla);
  }
  async function renderOrg(c) {
    const org = dados.orgs.find((o) => o.sigla === estado.org);
    const meu = ++tokenRender;
    c.classList.add('carregando');
    let det;
    try { det = await carregarOrg(org); } catch (e) {
      if (e.sessao) return PF.mostrarLogin();
      c.classList.remove('carregando');
      return c.replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar este órgão.'));
    }
    if (meu !== tokenRender) return;
    c.classList.remove('carregando');

    const base = ocupantesBase(det.ocupantes);
    const serie = org.s;
    const sai12 = soma(serie.slice(-12), saidas);
    const duracoes = base.map((o) => ({ m: mesesEntre(o.desde, dados.mes) + 1, lim: o.limite }));
    const med = mediana(duracoes.map((d) => d.m));
    const limitado = duracoes.some((d) => d.lim && d.m === med) || (duracoes.length && duracoes.filter((d) => d.lim).length > duracoes.length / 2);
    const nomeOrg = org.nome !== org.sigla ? titulo(org.nome) : '';
    const kp = el('div', { class: 'kpis' },
      kpi('Ocupantes', nInt.format(base.length), nomeOrg ? `${nomeOrg} · ${rotuloMes(dados.mes, true)}` : rotuloMes(dados.mes, true)),
      kpi('Custo mensal dos cargos', brlCompacto(soma(base, (o) => o.valor)), `≈ ${brlCompacto(soma(base, (o) => o.valor) * 12)} por ano, sem 13º e encargos`),
      kpi('Tempo mediano na função', med == null ? '—' : `${limitado ? '≥ ' : ''}${nInt.format(Math.round(med))} meses`,
        limitado ? `janela de ${dados.meses.length} meses: parte dos ocupantes já estava na função no início` : 'contado a partir da primeira competência observada'),
      kpi('Saídas em 12 meses', nInt.format(sai12), base.length ? `${((sai12 / base.length) * 100).toFixed(0)}% do quadro atual` : ''));

    // funções
    const grupos = new Map();
    for (const o of base) {
      const k = chaveFuncao(o);
      const g = grupos.get(k) || { k, funcao: o.funcao, tipo: o.tipo, n: 0, c: 0 };
      g.n++; g.c += o.valor; grupos.set(k, g);
    }
    const lista = [...grupos.values()].sort((a, b) => (estado.medida === 'custo' ? b.c - a.c : b.n - a.n));
    const maxV = Math.max(1, ...lista.map((g) => (estado.medida === 'custo' ? g.c : g.n)));
    const visiveis = estado.verTodasFuncoes ? lista : lista.slice(0, 14);
    const cartaoFuncoes = el('div', { class: 'cartao' },
      el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Cargos e funções'),
        el('p', {}, `Ordenados por ${rotuloMedida()}. Clique numa linha para ver os ocupantes.`))),
      lista.length ? el('div', { class: 'linhas' }, visiveis.map((g) => {
        const v = estado.medida === 'custo' ? g.c : g.n;
        const nos = () => [el('div', { class: 'tit' }, titulo(g.funcao) + (g.tipo === 'FG' ? ' (função gratificada)' : '')),
          dicaLinha(null, nInt.format(g.n), 'ocupantes'), dicaLinha(null, brlCompacto(g.c), 'custo mensal'),
          dicaLinha(null, brlCompacto(g.c / g.n), 'média por ocupante')];
        const b = el('button', { type: 'button', class: 'linha-barra' + (estado.funcao === g.k ? ' ativa' : ''),
          onclick: () => { esconderDica(); estado.funcao = estado.funcao === g.k ? null : g.k; estado.limite = 100; render(); },
          onpointermove: (ev) => mostrarDica(nos(), ev.clientX, ev.clientY), onpointerleave: esconderDica,
          onfocus: () => dicaNoElemento(b, nos), onblur: esconderDica },
          el('span', { class: 'nome' }, titulo(g.funcao) + (g.tipo === 'FG' && estado.tipo === 'todos' ? ' (FG)' : '')),
          el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, (v / maxV) * 68)}%` }),
            el('span', { class: 'num' }, `${nInt.format(g.n)} · ${brlCompacto(g.c)}`)));
        return b;
      })) : el('p', { class: 'vazio' }, 'Nenhum ocupante corresponde aos filtros.'),
      lista.length > 14 ? el('div', { class: 'rodape-tabela' }, el('button', { type: 'button', class: 'botao',
        onclick: () => { estado.verTodasFuncoes = !estado.verTodasFuncoes; render(); } },
        estado.verTodasFuncoes ? 'Mostrar menos' : `Mostrar todas (${lista.length})`)) : null);

    c.replaceChildren(kp, cartaoFuncoes, cartaoEvolucao(serie, 'Evolução mensal em ' + org.sigla),
      cartaoOcupantes(org, base));
  }

  // ---------- tabela de ocupantes ----------
  const COLS = [
    ['nome', 'Nome'], ['funcao', 'Função'], ['prov', 'Provimento'], ['valor', 'Valor do cargo (mês)', 1],
    ['desde', 'Na função desde'], ['vinculo', 'Vínculo oficial'],
  ];
  function textoDesde(o) {
    const m = mesesEntre(o.desde, dados.mes) + 1;
    return { linha: (o.limite ? '≤ ' : '') + rotuloMes(o.desde, true), meses: `${o.limite ? '≥ ' : ''}${m} ${m === 1 ? 'mês' : 'meses'}` };
  }
  function cartaoOcupantes(org, base) {
    let linhas = estado.funcao ? base.filter((o) => chaveFuncao(o) === estado.funcao) : base;
    const { col, dir } = estado.ordemOcup;
    linhas = [...linhas].sort((a, b) => {
      const x = a[col], y = b[col];
      const r = typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR');
      return (r || a.nome.localeCompare(b.nome, 'pt-BR')) * dir;
    });
    const topo = el('div', { class: 'cartao-topo' },
      el('div', {}, el('h2', {}, 'Ocupantes'),
        el('p', {}, `${nInt.format(linhas.length)} ${linhas.length === 1 ? 'registro' : 'registros'} em ${rotuloMes(dados.mes, true)}.`),
        estado.funcao ? el('span', { class: 'chip' }, 'Função: ' + titulo(estado.funcao.split('|')[1]),
          el('button', { type: 'button', 'aria-label': 'Remover filtro de função', onclick: () => { estado.funcao = null; render(); } }, '×')) : null),
      el('button', { type: 'button', class: 'botao', onclick: () => baixarCSV(org, linhas) }, 'Exportar CSV'));
    const cartao = el('div', { class: 'cartao' }, topo);
    if (!linhas.length) { cartao.append(el('p', { class: 'vazio' }, 'Nenhum ocupante corresponde aos filtros.')); return cartao; }
    const corpo = linhas.slice(0, estado.limite).map((o) => {
      const d = textoDesde(o);
      return el('tr', {},
        el('td', {}, el('strong', {}, titulo(o.nome)), o.cargoEfetivo ? el('small', {}, 'Cargo efetivo: ' + titulo(o.cargoEfetivo)) : null),
        el('td', {}, titulo(o.funcao), o.unidade ? el('small', {}, titulo(o.unidade)) : null),
        el('td', {}, o.prov),
        el('td', { class: 'num' }, nBRL.format(o.valor),
          o.subsidioCarreira ? el('small', { title: 'Remuneração da carreira de origem, recebida de qualquer modo; não é custo do cargo.' },
            'subsídio da carreira: ' + nBRL.format(o.subsidioCarreira)) : null),
        el('td', { title: o.limite ? 'Já ocupava a função na primeira competência da janela; o início pode ser anterior.' : '' }, d.linha, el('small', {}, d.meses)),
        el('td', {}, o.vinculo ? titulo(o.vinculo) : '—'));
    });
    cartao.append(el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, COLS.map(([k, r, n]) => el('th', { class: n ? 'num' : '', 'aria-sort': col === k ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
        el('button', { type: 'button', onclick: () => { estado.ordemOcup = { col: k, dir: col === k ? -dir : (k === 'valor' ? -1 : 1) }; render(); } },
          r + (col === k ? (dir > 0 ? ' ▲' : ' ▼') : '')))))),
      el('tbody', {}, corpo))));
    if (linhas.length > estado.limite) {
      cartao.append(el('div', { class: 'rodape-tabela' }, el('span', {}, `Mostrando ${nInt.format(estado.limite)} de ${nInt.format(linhas.length)}`),
        el('button', { type: 'button', class: 'botao', onclick: () => { estado.limite += 200; render(); } }, 'Mostrar mais')));
    }
    return cartao;
  }
  function baixarCSV(org, linhas) {
    const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cab = ['Órgão', 'Nome', 'Função', 'Tipo', 'Unidade', 'Cargo efetivo', 'Provimento', 'Valor do cargo (R$/mês)',
      'Subsídio da carreira de origem, não computado (R$/mês)', 'Na função desde', 'Início é limite da janela', 'Meses na função', 'Vínculo oficial', 'Exercício do vínculo'];
    const rows = linhas.map((o) => [org.sigla, o.nome, o.funcao, o.tipo === 'CC' ? 'Cargo em comissão' : 'Função gratificada', o.unidade,
      o.cargoEfetivo, o.prov, o.valor.toFixed(2).replace('.', ','),
      o.subsidioCarreira ? o.subsidioCarreira.toFixed(2).replace('.', ',') : '', o.desde, o.limite ? 'sim' : 'não',
      mesesEntre(o.desde, dados.mes) + 1, o.vinculo || '', o.exercicio || '']);
    const txt = '﻿' + [cab, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })),
      download: `ocupantes-${org.sigla}-${dados.mes}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- método (rodapé) ----------
  function preencherMetodo() {
    $('#metodo').replaceChildren(
      el('p', {}, 'Fonte: ', el('a', { href: dados.fonte.url, target: '_blank', rel: 'noopener noreferrer' }, dados.fonte.conjunto),
        `, folha mensal dos órgãos da administração direta, autarquias e fundações. Janela analisada: ${rotuloMes(dados.meses[0], true)} a ${rotuloMes(dados.mes, true)}. Empresas públicas e sociedades de economia mista (Bandes, Banestes, Cesan e outras) não constam dessa base.`),
      el('p', {}, 'Valor do cargo. A folha é publicada com uma linha por rubrica; o valor do cargo é reconstruído somando apenas as rubricas do cargo na competência corrente: vencimento do cargo comissionado (puro ou de servidor efetivo), subsídio (secretários e similares) e gratificação de produtividade de comissionado. O princípio é que valor do cargo é o que se paga por causa do cargo. Por isso, para quem opta pelo cargo comissionado mantendo a remuneração do cargo efetivo, entra só a rubrica de opção e as gratificações; e o subsídio só conta quando é o subsídio da própria função (o padrão pago a quem não tem cargo efetivo). Servidor de carreira que recebe o subsídio da carreira, como um secretário que é Auditor Fiscal, tem o valor do cargo restrito às gratificações, e o subsídio da carreira aparece à parte, na tabela, sem ser somado ao custo. Em função gratificada entram só as rubricas "Função Gratificada". Não entram 13º, férias, auxílios, descontos nem ajustes de outras competências.'),
      el('p', {}, 'Quem é ocupante. Só entra quem tem pagamento do cargo na competência. Registros sem nenhuma rubrica de cargo (por exemplo, apenas "insuficiência de saldo", resíduo de acerto de quem foi desligado ou afastado) são descartados: sem essa regra, todo janeiro apareceria cerca de mil comissionados fictícios.'
        + (dados.orgaosExcluidos && Object.keys(dados.orgaosExcluidos).length
          ? ' Foram excluídos por não pertencerem ao Poder Executivo: ' + Object.entries(dados.orgaosExcluidos).map(([k, v]) => `${k} (${v})`).join('; ') + '.' : '')),
      el('p', {}, 'Custo anualizado é o valor mensal multiplicado por 12; não inclui 13º salário, terço de férias nem encargos patronais.'),
      el('p', {}, 'Tempo na função é inferido pela primeira competência, dentro da janela, em que a pessoa aparece na mesma função de forma contínua. O sinal "≤" indica que ela já ocupava a função na primeira competência da janela e que o início pode ser anterior.'),
      el('p', {}, 'Entradas e saídas comparam cada mês com o anterior, por pessoa e tipo (cargo em comissão ou função gratificada) dentro do órgão. Uma pessoa que muda de órgão aparece como saída num e entrada noutro.'));
    $('#mesref').textContent = 'Referência: ' + rotuloMes(dados.mes, true);
  }

  // ---------- render ----------
  function render() {
    if (!raiz || !$('#conteudo')) return; // a aba foi trocada (ex.: busca com atraso)
    PF.limparObservadores();
    esconderDica();
    $('#rotulo-prov').hidden = !estado.org;
    renderTrilha();
    const c = $('#conteudo');
    ++tokenRender;
    c.classList.remove('carregando');
    if (!estado.org) renderGoverno(c); else renderOrg(c);
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Cargos em comissão e funções gratificadas</h2>
          <p class="sub">Quadro de ocupantes, custo mensal e rotatividade, a partir da folha oficial do Poder Executivo.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <div class="filtros" role="group" aria-label="Filtros">
        <label>Tipo
          <select id="f-tipo">
            <option value="todos">Cargos em comissão e funções gratificadas</option>
            <option value="CC">Somente cargos em comissão</option>
            <option value="FG">Somente funções gratificadas</option>
          </select>
        </label>
        <label>Medida
          <select id="f-medida">
            <option value="custo">Custo mensal dos cargos</option>
            <option value="qtd">Número de ocupantes</option>
          </select>
        </label>
        <label id="rotulo-prov" hidden>Provimento
          <select id="f-prov">
            <option value="todos">Todos</option>
            <option value="puro">Comissionado sem vínculo efetivo</option>
            <option value="efetivo">Servidor com vínculo de origem</option>
            <option value="subsidio">Subsídio</option>
          </select>
        </label>
        <label class="busca">Buscar
          <input id="f-busca" type="search" placeholder="Nome, função ou órgão" autocomplete="off">
        </label>
      </div>
      <nav id="trilha" class="trilha" aria-label="Navegação"></nav>
      <div id="conteudo"></div>
      <footer class="rodape">
        <details>
          <summary>Fonte e método de cálculo</summary>
          <div id="metodo"></div>
        </details>
      </footer>
    </section>`;

  function vincularFiltros() {
    for (const [id, chave] of [['#f-tipo', 'tipo'], ['#f-medida', 'medida'], ['#f-prov', 'prov']]) {
      $(id).value = estado[chave];
      $(id).addEventListener('change', (ev) => { estado[chave] = ev.target.value; estado.limite = 100; if (dados) render(); });
    }
    $('#f-busca').value = estado.busca;
    let temporizador;
    $('#f-busca').addEventListener('input', (ev) => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => { estado.busca = ev.target.value.trim(); estado.limite = 100; if (dados) render(); }, 180);
    });
  }

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO; // modelo estático, sem dados externos
    vincularFiltros();
    try {
      dados = await ctx.api('index');
    } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#conteudo').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar os dados.'));
      return false;
    }
    for (const o of dados.orgs) {
      const cols = dados.colunasSerie;
      o.s = o.serie.map((r) => Object.fromEntries(cols.map((k, i) => [k, r[i]])));
    }
    preencherMetodo();
    return true;
  }

  function desmontar() {
    dados = null;
    cacheOrg.clear();
  }

  PF.registrar({ id: 'cargos', titulo: 'Cargos em comissão', montar, aoNavegar, desmontar });
})();
