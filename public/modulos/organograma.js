(() => {
  'use strict';
  // Módulo "Organograma": árvore de unidades de um órgão, com as pessoas de cada unidade,
  // a condição de cada uma (cor + rótulo) e a remuneração somando carreira e cargo.
  const { el, nInt, nBRL, brlCompacto, rotuloMes, titulo, norm } = PF;

  const COND = {
    puro: { rotulo: 'Comissionado sem vínculo efetivo', curto: 'Sem vínculo efetivo', cor: 'var(--serie-1)' },
    carreira: { rotulo: 'Servidor de carreira em cargo em comissão', curto: 'Servidor de carreira', cor: 'var(--serie-2)' },
    fg: { rotulo: 'Servidor de carreira com função gratificada', curto: 'Função gratificada', cor: 'var(--serie-3)' },
    sem: { rotulo: 'Sem cargo em comissão nem função', curto: 'Sem cargo ou função', cor: 'var(--mudo)' },
  };
  const ORDEM = ['puro', 'carreira', 'fg', 'sem'];
  const CONDS_PADRAO = ['puro', 'carreira', 'fg'];   // "sem cargo ou função" começa desligada
  const PADRAO = 'SEFAZ';

  let ctx = null;
  let raiz = null;
  let indice = null;
  const cache = new Map();
  let token = 0;
  const estado = {
    org: null, busca: '', conds: new Set(CONDS_PADRAO), semCarregado: null, abertos: new Set(), pessoasAbertas: new Set(), dados: null,
    vista: 'lista', grafAbertos: new Set(), selecionado: null, incluirSub: false, centralizar: true,
  };
  const $ = (s) => raiz.querySelector(s);

  // ---------- modelo ----------
  function construir(dados) {
    const nos = new Map();
    for (const u of dados.unidades) nos.set(u.id, { ...u, filhos: [], pessoas: [] });
    for (const n of nos.values()) if (n.pai && nos.has(n.pai)) nos.get(n.pai).filhos.push(n);
    for (const p of dados.pessoas) {
      const u = nos.get(p.unidade) || nos.get(dados.sigla);
      p._unidade = norm(`${u.nome} ${u.sigla}`);   // a busca também acha a pessoa pelo nome da unidade
      u.pessoas.push(p);
    }
    return { nos, raiz: nos.get(dados.sigla) };
  }
  function passa(p) {
    if (!estado.conds.has(p.cond)) return false;
    const q = norm(estado.busca);
    return !q || norm(p.nome).includes(q) || norm(p.funcao).includes(q) || norm(p.cargoEfetivo).includes(q)
      || (p._unidade || '').includes(q);
  }
  // agrega a subárvore já considerando os filtros; guarda em n.ag
  function agregar(n) {
    const ag = { n: 0, cond: { puro: 0, carreira: 0, fg: 0, sem: 0 }, valor: 0, bruto: 0 };
    n.visiveis = n.pessoas.filter(passa);
    for (const p of n.visiveis) {
      ag.n++; ag.cond[p.cond]++; ag.valor += p.valor || 0; ag.bruto += p.bruto;
    }
    for (const f of n.filhos) {
      const a = agregar(f);
      ag.n += a.n; ag.valor += a.valor; ag.bruto += a.bruto;
      for (const c of ORDEM) ag.cond[c] += a.cond[c];
    }
    n.ag = ag;
    return ag;
  }
  const filtrando = () => estado.busca.trim() !== ''
    || estado.conds.size !== CONDS_PADRAO.length || CONDS_PADRAO.some((c) => !estado.conds.has(c));

  // ---------- componentes ----------
  function barraCond(cond, total) {
    const b = el('span', { class: 'barra-cond', role: 'img',
      'aria-label': ORDEM.filter((c) => cond[c]).map((c) => `${COND[c].curto}: ${cond[c]}`).join(', ') });
    if (!total) return b;
    for (const c of ORDEM) {
      if (cond[c]) b.append(el('i', { style: `flex:${cond[c]};background:${COND[c].cor}` }));
    }
    return b;
  }
  const chipCond = (c) => el('span', { class: 'chip-cond' }, el('i', { style: `background:${COND[c].cor}` }), COND[c].curto);

  // nomes da plataforma oficial vêm em maiúsculas e sem acento; restitui os acentos das palavras mais comuns
  const ACENTOS = Object.fromEntries(('gerência subgerência administração comunicação informação informações técnica técnico técnicos '
    + 'orçamento orçamentária orçamentário execução programação gestão estratégica estratégico jurídica jurídico política políticas '
    + 'pública públicas público captação educação fiscalização regulação coordenação superintendência inteligência tributária tributário '
    + 'relações patrimônio saúde segurança polícia logística operações ações avaliação formação capacitação atenção assistência '
    + 'inovação agência núcleo seção divisão comissão econômico econômica fazendário rodoviário trânsito pedagógica pedagógico infância '
    + 'família justiça penitenciária sócio habitação ciência tecnológica tecnológico extensão ambulatório auditória memória '
    + 'diária contábil gráfica elétrica eletroeletrônica mecânica médica médico psicossocial jurídico serviço serviços secretário ').split(/\s+/)
    .filter(Boolean).map((w) => [w.normalize('NFD').replace(/\p{Diacritic}/gu, ''), w.charAt(0).toUpperCase() + w.slice(1)]));
  // abreviações inequívocas dos nomes oficiais (ficam fora as ambíguas, como CONTR, REG, ESP, DIR, ADM)
  Object.assign(ACENTOS, { subg: 'Subgerência', subger: 'Subgerência', subgerenc: 'Subgerência', gerenc: 'Gerência',
    asses: 'Assessoria', subsec: 'Subsecretaria', subsecret: 'Subsecretaria', secret: 'Secretaria', planej: 'Planejamento',
    depart: 'Departamento', superint: 'Superintendência', unid: 'Unidade', inst: 'Instituto', gest: 'Gestão', orc: 'Orçamento',
    coord: 'Coordenação' });
  const nomeOficial = (nome) => titulo(nome).split(/(\s+)/).map((t) => ACENTOS[t.toLowerCase()] || t).join('');
  const nomeUnidade = (n) => {
    if (n.id.startsWith('n:')) return n.nome;                                  // rótulos de agrupamento
    if ((n.situacao === 'confirmada' || n.situacao === 'a conferir') && n.sigla) return n.nome;   // tabela manual, já em caixa correta
    return nomeOficial(n.nome);
  };

  function cartaoPessoa(p, unidade) {
    const aberto = estado.pessoasAbertas.has(p.id + p.funcao);
    const detalhes = [];
    if (p.cargoEfetivo) detalhes.push(['Cargo efetivo', titulo(p.cargoEfetivo)]);
    if (p.vinculo) detalhes.push(['Vínculo oficial', titulo(p.vinculo)]);
    detalhes.push(['Condição', COND[p.cond].rotulo]);
    if (p.prov) detalhes.push(['Provimento', p.prov]);
    if (p.subsidioCarreira) detalhes.push(['Subsídio da carreira (não é custo do cargo)', nBRL.format(p.subsidioCarreira)]);
    if (p.abate) detalhes.push(['Abate do teto constitucional', '− ' + nBRL.format(p.abate)]);
    const c = el('li', { class: 'pessoa' + (aberto ? ' aberta' : ''), style: `--cor:${COND[p.cond].cor}` },
      el('button', { type: 'button', class: 'pessoa-topo', 'aria-expanded': String(aberto),
        onclick: () => {
          const k = p.id + p.funcao;
          if (estado.pessoasAbertas.has(k)) estado.pessoasAbertas.delete(k); else estado.pessoasAbertas.add(k);
          desenhar(k);
        }, 'data-foco': p.id + p.funcao },
        el('span', { class: 'pessoa-nome' }, titulo(p.nome)),
        el('span', { class: 'pessoa-funcao' }, p.cond === 'sem' ? 'Cargo efetivo: ' + (titulo(p.cargoEfetivo) || 'não informado') : titulo(p.funcao)),
        unidade ? el('span', { class: 'pessoa-unidade' }, unidade) : null,
        el('span', { class: 'pessoa-linha' }, chipCond(p.cond),
          el('span', { class: 'valores' },
            p.cond === 'sem' ? null : el('span', {}, 'Cargo ', el('b', {}, nBRL.format(p.valor))),
            el('span', {}, 'Bruto ', el('b', {}, nBRL.format(p.bruto)))))),
      aberto ? el('dl', { class: 'detalhes' }, detalhes.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null);
    return c;
  }

  function noUnidade(n, profundidade) {
    const filtro = filtrando();
    if (filtro && n.ag.n === 0) return null;
    const temFilhos = n.filhos.length > 0 || n.pessoas.length > 0;
    const aberto = estado.abertos.has(n.id) || (filtro && n.ag.n > 0);
    const vazio = n.ag.n === 0;
    const rotuloSituacao = n.situacao === 'nao-confirmada' ? 'subordinação não confirmada'
      : n.situacao === 'a conferir' ? 'ligação a conferir' : '';
    const nome = nomeUnidade(n);
    const topo = el('button', { type: 'button', class: 'unidade-topo', 'aria-expanded': String(aberto),
      'data-foco': n.id, disabled: !temFilhos,
      onclick: () => {
        if (estado.abertos.has(n.id)) estado.abertos.delete(n.id); else estado.abertos.add(n.id);
        desenhar(n.id);
      } },
      el('span', { class: 'seta', 'aria-hidden': 'true' }, temFilhos ? '›' : ''),
      el('span', { class: 'unidade-nome' }, nome, n.sigla ? el('span', { class: 'sigla' }, n.sigla) : null,
        rotuloSituacao ? el('span', { class: 'aviso' }, rotuloSituacao) : null),
      el('span', { class: 'unidade-resumo' },
        barraCond(n.ag.cond, n.ag.n),
        el('span', { class: 'qtd' }, vazio ? 'sem ocupantes' : `${nInt.format(n.ag.n)} ${n.ag.n === 1 ? 'pessoa' : 'pessoas'}`),
        vazio ? null : el('span', { class: 'bruto' }, brlCompacto(n.ag.bruto))));
    const li = el('li', { class: 'unidade' + (vazio ? ' vazia' : '') + (n.id === estado.dados.sigla ? ' raiz' : '') }, topo);
    if (aberto) {
      const corpo = el('div', { class: 'unidade-corpo' });
      if (n.fonte && n.situacao !== 'raiz') corpo.append(el('p', { class: 'fonte' }, 'Fonte: ' + n.fonte));
      if (n.visiveis.length) {
        corpo.append(el('ul', { class: 'pessoas' }, n.visiveis.slice(0, 100).map((p) => cartaoPessoa(p))));
        if (n.visiveis.length > 100) corpo.append(el('p', { class: 'fonte' }, `Mostrando 100 de ${nInt.format(n.visiveis.length)}; use a busca ou a exportação para ver todas.`));
      }
      const filhos = n.filhos.map((f) => noUnidade(f, profundidade + 1)).filter(Boolean);
      if (filhos.length) corpo.append(el('ul', { class: 'arvore' }, filhos));
      li.append(corpo);
    }
    return li;
  }


  // ---------- organograma gráfico (caixas e linhas) ----------
  const pendente = (n) => n.situacao === 'nao-confirmada' || n.situacao === 'a conferir';
  const rotuloPendencia = (n) => (n.situacao === 'nao-confirmada' ? 'subordinação não confirmada'
    : n.situacao === 'a conferir' ? 'ligação a conferir' : '');

  function noGrafico(n) {
    const filtro = filtrando();
    if (filtro && n.ag.n === 0) return null;
    const filhos = n.filhos.filter((f) => !filtro || f.ag.n > 0);
    const aberto = filhos.length > 0 && (estado.grafAbertos.has(n.id) || filtro);
    const vazio = n.ag.n === 0;
    const sel = estado.selecionado === n.id;
    const pend = rotuloPendencia(n);
    const nome = nomeUnidade(n);
    const caixa = el('div', { class: 'oc-no' + (sel ? ' sel' : '') + (vazio ? ' vazio' : '') + (pendente(n) ? ' pend' : ''), 'data-id': n.id },
      el('button', { type: 'button', class: 'oc-corpo', 'aria-pressed': String(sel), 'data-foco': n.id,
        onclick: () => { estado.selecionado = n.id; desenhar(n.id, n.id); } },
      el('span', { class: 'oc-nome' }, nome, n.sigla ? el('span', { class: 'sigla' }, n.sigla) : null),
      el('span', { class: 'oc-resumo' }, barraCond(n.ag.cond, n.ag.n),
        el('span', { class: 'qtd' }, vazio ? 'sem ocupantes' : `${nInt.format(n.ag.n)} ${n.ag.n === 1 ? 'pessoa' : 'pessoas'}`)),
      pend ? el('span', { class: 'aviso' }, pend) : null),
      filhos.length ? el('button', { type: 'button', class: 'oc-exp', 'aria-expanded': String(aberto),
        'aria-label': `${aberto ? 'Recolher' : 'Abrir'} ${nome}: ${filhos.length} ${filhos.length === 1 ? 'subunidade' : 'subunidades'}`,
        title: `${aberto ? 'Recolher' : 'Abrir'} (${filhos.length})`,
        onclick: () => {
          if (estado.grafAbertos.has(n.id)) estado.grafAbertos.delete(n.id); else estado.grafAbertos.add(n.id);
          desenhar(undefined, n.id);
        } }, aberto ? '−' : String(filhos.length)) : null);
    const li = el('li', {}, caixa);
    if (aberto) {
      const vis = filhos.map(noGrafico).filter(Boolean);
      // unidades-folha ficam penduradas em coluna sob o pai: o desenho fica bem mais estreito
      const soFolhas = vis.length > 1 && filhos.every((f) => f.filhos.filter((x) => !filtrando() || x.ag.n > 0).length === 0);
      li.append(el('ul', { class: soFolhas ? 'pendurado' : '' }, vis));
    }
    return li;
  }

  function coletar(n, saida = []) {
    for (const p of n.visiveis) saida.push({ p, u: nomeUnidade(n) });
    for (const f of n.filhos) coletar(f, saida);
    return saida;
  }

  function painel(n) {
    const nos = estado.modelo.nos;
    const itens = estado.incluirSub ? coletar(n).sort((a, b) => b.p.valor - a.p.valor)
      : n.visiveis.map((p) => ({ p, u: null }));
    const LIMITE = 120;
    const pend = rotuloPendencia(n);
    return [
      el('p', { class: 'caminho' }, caminho(n, nos)),
      el('h3', {}, nomeUnidade(n), n.sigla ? el('span', { class: 'sigla' }, n.sigla) : null),
      pend ? el('p', { class: 'aviso solto' }, pend) : null,
      n.fonte && n.situacao !== 'raiz' ? el('p', { class: 'fonte' }, 'Fonte: ' + n.fonte) : null,
      el('div', { class: 'painel-numeros' },
        el('div', {}, el('b', {}, nInt.format(n.ag.n)), ' pessoas na unidade e abaixo dela'),
        barraCond(n.ag.cond, n.ag.n),
        el('div', {}, 'Cargos ', el('b', {}, brlCompacto(n.ag.valor)), ' · Bruto ', el('b', {}, brlCompacto(n.ag.bruto)), ' por mês')),
      n.filhos.length ? el('label', { class: 'opcao' },
        el('input', { type: 'checkbox', checked: estado.incluirSub, onchange: (ev) => { estado.incluirSub = ev.target.checked; desenhar(); } }),
        'Listar também as pessoas das subunidades') : null,
      itens.length ? el('ul', { class: 'pessoas' }, itens.slice(0, LIMITE).map(({ p, u }) => cartaoPessoa(p, u)))
        : el('p', { class: 'vazio' }, 'Nenhuma pessoa lotada diretamente nesta unidade.'),
      itens.length > LIMITE ? el('p', { class: 'fonte' }, `Mostrando ${LIMITE} de ${nInt.format(itens.length)}; use a exportação para a lista completa.`) : null,
    ].filter(Boolean);
  }

  function desenharGrafico(ancora, aviso) {
    const cont = $('#arvore');
    let lay = cont.querySelector('.org-layout');
    if (!lay) {
      lay = el('div', { class: 'org-layout' },
        el('div', { class: 'oc-rolagem', tabindex: '0', role: 'region', 'aria-label': 'Organograma; role para ver os ramos' }),
        el('aside', { class: 'oc-painel', 'aria-label': 'Detalhes da unidade selecionada' }));
      cont.replaceChildren(...[aviso, lay].filter(Boolean));
      estado.centralizar = true;
    }
    const rol = lay.querySelector('.oc-rolagem');
    const lateral = lay.querySelector('.oc-painel');
    const { raiz: r, nos } = estado.modelo;
    let sel = nos.get(estado.selecionado);
    if (!sel || (filtrando() && sel.ag.n === 0)) { sel = r; estado.selecionado = r.id; }

    const seletor = (id) => `[data-id="${CSS.escape(id)}"]`;
    const antes = ancora ? rol.querySelector(seletor(ancora)) : null;
    const posAntes = antes ? antes.getBoundingClientRect() : null;
    const topo = noGrafico(r);
    rol.replaceChildren(topo ? el('ul', { class: 'oc' }, topo) : el('p', { class: 'vazio' }, 'Nenhuma pessoa corresponde aos filtros.'));
    if (posAntes) {   // mantém a caixa clicada onde estava, em vez de deixar o ramo "pular"
      const depois = rol.querySelector(seletor(ancora));
      if (depois) {
        const pos = depois.getBoundingClientRect();
        rol.scrollLeft += pos.left - posAntes.left;
        rol.scrollTop += pos.top - posAntes.top;
      }
    } else if (estado.centralizar) {
      rol.scrollLeft = Math.max(0, (rol.scrollWidth - rol.clientWidth) / 2);
      rol.scrollTop = 0;
    }
    estado.centralizar = false;
    lateral.replaceChildren(...painel(sel));
  }

  function desenharLista(aviso, focoId) {
    const arvore = noUnidade(estado.modelo.raiz, 0);
    $('#arvore').replaceChildren(...[aviso, arvore ? el('ul', { class: 'arvore raiz-lista' }, arvore)
      : el('p', { class: 'vazio' }, 'Nenhuma pessoa corresponde aos filtros.')].filter(Boolean));
    if (focoId) {
      const alvo = $('#arvore').querySelector(`[data-foco="${CSS.escape(focoId)}"]`);
      if (alvo) alvo.focus({ preventScroll: true });
    }
  }

  // ---------- desenho ----------
  function desenhar(focoId, ancora) {
    if (!$('#resumo')) return; // a aba foi trocada (ex.: busca com atraso)
    PF.limparObservadores();
    PF.esconderDica();
    const d = estado.dados;
    const { raiz: r } = estado.modelo;
    const ag = agregar(r);
    const info = indice.orgs.find((o) => o.sigla === estado.org);
    const kpis = el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Pessoas'),
        el('div', { class: 'valor' }, nInt.format(ag.n)),
        el('div', { class: 'nota' }, ORDEM.filter((c) => estado.conds.has(c)).map((c) => `${nInt.format(ag.cond[c])} ${COND[c].curto.toLowerCase()}`).join(' · '))),
      el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Valor dos cargos por mês'),
        el('div', { class: 'valor' }, brlCompacto(ag.valor)), el('div', { class: 'nota' }, 'só o que se paga por causa do cargo')),
      el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Remuneração bruta por mês'),
        el('div', { class: 'valor' }, brlCompacto(ag.bruto)), el('div', { class: 'nota' }, 'carreira + cargo, antes do abate do teto')));

    const legenda = el('div', { class: 'filtro-cond', role: 'group', 'aria-label': 'Filtrar por condição' },
      ORDEM.map((c) => el('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(estado.conds.has(c)),
        style: `--cor:${COND[c].cor}`,
        onclick: async () => {
          if (estado.conds.has(c)) estado.conds.delete(c); else estado.conds.add(c);
          if (!estado.conds.size) estado.conds = new Set(CONDS_PADRAO);
          if (estado.conds.has('sem')) await garantirSem();
          desenhar();
        } },
      el('i', {}), COND[c].rotulo, el('span', { class: 'n' }, nInt.format(info ? (c === 'sem' ? info.sem : info[c]) : 0)))));

    const aviso = !info.estruturaOficial
      ? el('p', { class: 'nota-estrutura' }, 'Este órgão ainda não tem a estrutura oficial transcrita: as unidades aparecem agrupadas pelo nível do código do setor, sem subordinação confirmada.') : null;

    const graf = estado.vista === 'grafico';
    const ferramentas = el('div', { class: 'ferramentas' },
      el('div', { class: 'abas', role: 'group', 'aria-label': 'Forma de exibição' },
        [['grafico', 'Organograma'], ['lista', 'Lista']].map(([v, rot]) => el('button', { type: 'button',
          'aria-pressed': String(estado.vista === v),
          onclick: () => { estado.vista = v; PF.guardar('org-vista', v); desenhar(); } }, rot))),
      el('button', { type: 'button', class: 'botao', onclick: () => {
        const todos = new Set(estado.modelo.todos.filter((n) => n.filhos.length || (!graf && n.pessoas.length)).map((n) => n.id));
        if (graf) estado.grafAbertos = todos; else estado.abertos = todos;
        desenhar();
      } }, 'Abrir tudo'),
      el('button', { type: 'button', class: 'botao', onclick: () => {
        if (graf) estado.grafAbertos = new Set([d.sigla]); else estado.abertos = new Set([d.sigla]);
        estado.centralizar = true; desenhar();
      } }, 'Recolher'),
      el('button', { type: 'button', class: 'botao', onclick: exportar }, 'Exportar CSV'));

    $('#resumo').replaceChildren(kpis, legenda, ferramentas);
    if (graf) desenharGrafico(ancora, aviso); else desenharLista(aviso, focoId);
  }

  function caminho(n, nos) {
    const partes = [];
    for (let x = n; x; x = x.pai ? nos.get(x.pai) : null) partes.unshift(x.sigla || nomeUnidade(x));
    return partes.join(' > ');
  }
  function exportar() {
    const { nos } = estado.modelo;
    const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cab = ['Órgão', 'Unidade (caminho)', 'Nome', 'Função', 'Condição', 'Valor do cargo (R$/mês)',
      'Remuneração bruta (R$/mês)', 'Abate do teto (R$/mês)', 'Subsídio da carreira (R$/mês)', 'Vínculo oficial'];
    const f2 = (v) => (v ? v.toFixed(2).replace('.', ',') : '');
    const linhas = [...nos.values()].flatMap((n) => n.pessoas).filter(passa).map((p) => [estado.org, caminho(nos.get(p.unidade) || estado.modelo.raiz, nos),
      p.nome, p.funcao, COND[p.cond].rotulo, f2(p.valor), f2(p.bruto), f2(p.abate), f2(p.subsidioCarreira), p.vinculo || '']);
    const txt = '﻿' + [cab, ...linhas].map((r) => r.map(esc).join(';')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })),
      download: `organograma-${estado.org}-${indice.mes}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- quem não ocupa cargo ou função (arquivo à parte, carregado só quando pedido) ----------
  async function garantirSem() {
    if (estado.semCarregado === estado.org || !$('#arvore')) return;
    const meu = token;
    $('#arvore').classList.add('carregando');
    const info = indice.orgs.find((o) => o.sigla === estado.org);
    let d;
    try {
      d = await ctx.api('todos/' + info.arquivo);
    } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return; }
      estado.conds.delete('sem');
      if (!estado.conds.size) estado.conds = new Set(CONDS_PADRAO);
      return;
    } finally {
      if ($('#arvore')) $('#arvore').classList.remove('carregando');
    }
    if (meu !== token || !$('#arvore') || !estado.modelo) return;   // troca de órgão ou de aba durante a carga
    const { nos, raiz: r } = estado.modelo;
    for (const [id, nome, cargo, vinculo, bruto, abate, iu] of d.pessoas) {
      const u = nos.get(estado.dados.unidades[iu].id) || r;
      u.pessoas.push({ id, nome, funcao: '', tipo: 'SC', cond: 'sem', prov: '', valor: 0, bruto, abate,
        subsidioCarreira: null, cargoEfetivo: cargo, vinculo, _unidade: norm(`${u.nome} ${u.sigla}`) });
    }
    estado.semCarregado = estado.org;
  }

  // ---------- carga ----------
  async function carregarOrg(sigla) {
    const meu = ++token;
    if (!$('#arvore')) return;
    $('#arvore').classList.add('carregando');
    const info = indice.orgs.find((o) => o.sigla === sigla);
    try {
      if (!cache.has(sigla)) cache.set(sigla, await ctx.api('org/' + info.arquivo));
    } catch (e) {
      if (e.sessao) return PF.mostrarLogin();
      if (meu !== token || !$('#arvore')) return;
      $('#arvore').classList.remove('carregando');
      return $('#arvore').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar este órgão.'));
    }
    if (meu !== token || !$('#arvore')) return; // outra carga mais nova, ou a aba já foi trocada
    const dados = cache.get(sigla);
    estado.org = sigla;
    estado.dados = dados;
    const modelo = construir(dados);
    modelo.todos = [...modelo.nos.values()];
    estado.modelo = modelo;
    estado.abertos = new Set([dados.sigla]);
    estado.grafAbertos = new Set([dados.sigla]);
    estado.selecionado = dados.sigla;
    estado.centralizar = true;
    estado.pessoasAbertas = new Set();
    estado.semCarregado = null;
    $('#arvore').replaceChildren();   // recria o layout para este órgão
    $('#arvore').classList.remove('carregando');
    $('#f-org').value = sigla;
    if (estado.conds.has('sem')) await garantirSem();
    if (meu !== token || !$('#arvore')) return;
    desenhar();
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Organograma de cargos e funções</h2>
          <p class="sub">Toque numa unidade para abrir. A cor mostra a condição de cada pessoa; o bruto soma carreira e cargo.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <div class="filtros" role="group" aria-label="Filtros">
        <label>Órgão <select id="f-org"></select></label>
        <label class="busca">Buscar <input id="f-busca" type="search" placeholder="Nome, função ou unidade" autocomplete="off"></label>
      </div>
      <div id="resumo"></div>
      <div id="arvore"></div>
      <footer class="rodape">
        <details>
          <summary>Como ler, e o que este organograma não garante</summary>
          <div id="metodo"></div>
        </details>
      </footer>
    </section>`;

  function metodo() {
    $('#metodo').replaceChildren(
      el('p', {}, 'Organograma e lista. No computador, o organograma mostra as caixas ligadas por linhas: o número na base da caixa abre ou fecha o ramo, e tocar na caixa mostra, no painel ao lado, as pessoas daquela unidade. A lista traz a mesma árvore em formato expansível, melhor no celular.'),
      el('p', {}, 'Condição. Em azul, quem ocupa cargo em comissão sem vínculo efetivo (livre nomeação). Em laranja, o servidor de carreira que ocupa cargo em comissão: o cargo se soma ao salário de origem. Em verde, o servidor de carreira que recebe função gratificada. A cor nunca vem sozinha: cada pessoa traz o rótulo escrito.'),
      el('p', {}, 'Quem não ocupa cargo. A condição cinza, "sem cargo ou função", reúne os servidores ativos que não ocupam cargo em comissão nem função gratificada; fica desligada até você ativá-la no filtro, e só então o arquivo daquele órgão é carregado. Para eles aparecem o cargo efetivo e a remuneração bruta, sem "valor do cargo". Ficam de fora estagiários, médicos residentes (bolsa não é salário) e vínculos sem nenhuma rubrica de pagamento no mês; funções não remuneradas entram, por serem servidores comuns.'),
      el('p', {}, 'Valores. "Cargo" é o que se paga por causa do cargo (regra do módulo Cargos em comissão). "Bruto" é a soma das rubricas de pagamento do mês, somando carreira e cargo; não inclui auxílios, indenizações, 13º, férias nem resíduos de acerto. O abate do teto constitucional aparece à parte, no detalhe da pessoa.'),
      el('p', {}, 'Estrutura. A subordinação entre unidades vem do Organograma ES (organograma.es.gov.br), a plataforma oficial de organogramas do Governo do ES, de que este painel guarda um retrato datado de cada órgão (a data consta na fonte de cada unidade). A base de dados abertos informa o setor de cada pessoa, mas não diz quem é subordinado a quem; por isso as pessoas são ligadas às unidades pelo nome do setor, pela sigla ou pelo código. Quando o setor da pessoa não é encontrado no organograma, ou a base só informa o nome do órgão (caso do IASES e da SESP), a pessoa aparece num agrupamento "subordinação não confirmada", ordenado pelo nível do código do setor, e nada é inferido por palpite. Os nomes das unidades vêm da plataforma, em maiúsculas e sem acento; a interface restitui os acentos mais comuns.'),
      el('p', {}, 'Lotação. O setor de cada pessoa é o da base de vínculos, que mostra a situação de hoje, e não o histórico. A estrutura muda por decreto, então a tabela precisa ser revista a cada alteração.'));
    $('#mesref').textContent = 'Referência: ' + rotuloMes(indice.mes, true);
  }

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    ++token; // invalida cargas iniciadas antes de uma troca de aba
    estado.vista = PF.ler('org-vista') || (matchMedia('(min-width: 900px)').matches ? 'grafico' : 'lista');
    raiz.innerHTML = ESQUELETO; // modelo estático, sem dados externos
    try {
      indice = await ctx.api('index');
    } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#arvore').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar os dados.'));
      return false;
    }
    const sel = $('#f-org');
    const ordenadas = [...indice.orgs].sort((a, b) => (b.estruturaOficial - a.estruturaOficial) || (b.pessoas - a.pessoas));
    sel.replaceChildren(...ordenadas.map((o) => el('option', { value: o.sigla },
      `${o.sigla} · ${titulo(o.nome)}${o.estruturaOficial ? '' : ' (sem estrutura oficial)'}`)));
    sel.addEventListener('change', () => ctx.irPara(sel.value));
    let t;
    $('#f-busca').value = estado.busca;
    $('#f-busca').addEventListener('input', (ev) => {
      clearTimeout(t);
      t = setTimeout(() => { estado.busca = ev.target.value.trim(); if (estado.dados) desenhar(); }, 180);
    });
    metodo();
    return true;
  }

  function aoNavegar(resto) {
    if (!indice) return;
    const pedido = decodeURIComponent(resto || '');
    const sigla = indice.orgs.some((o) => o.sigla === pedido) ? pedido
      : (indice.orgs.some((o) => o.sigla === PADRAO) ? PADRAO : indice.orgs[0].sigla);
    carregarOrg(sigla);
  }

  function desmontar() {
    indice = null;
    cache.clear();
    estado.dados = null;
  }

  PF.registrar({ id: 'organograma', titulo: 'Organograma', montar, aoNavegar, desmontar });
})();
