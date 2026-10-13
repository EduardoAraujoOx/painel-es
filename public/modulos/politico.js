(() => {
  'use strict';
  // Módulo "Vínculos políticos": ocupantes de cargo em comissão e função gratificada que aparecem como doadores
  // de campanha (TSE) a candidatos ao Executivo (governador, presidente) e ao Legislativo (deputados e senador).
  // Os totais valem com o painel aberto; a lista nominal (dado pessoal sensível) só com o painel protegido por senha.
  const { el, nInt, brlCompacto, soma } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  let pessoas = null;           // lista nominal, quando liberada
  let pessoasEstado = '';       // '', 'carregando', 'indisponivel'
  let tela = '';
  const est = { executivo: { cand: '', orgao: '', tipo: '', mais: 25 }, legislativo: { cand: '', orgao: '', tipo: '', mais: 25 } };

  const nome = (s) => PF.titulo(s || '');
  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const kpi = (rotulo, valor, nota) => el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const pct = (x) => (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + '%';
  const brl = (v) => PF.nBRL.format(v);
  const RESULTADO = { eleito: 'eleito', nao: 'não eleito', 'segundo-turno': 'foi ao 2º turno', 'sem-resultado': '' };
  const rotuloResultado = (c) => (c.ano === 2026 ? 'em disputa' : RESULTADO[c.resultado] || '');
  const GRUPOS = {
    executivo: {
      titulo: 'Doações a candidatos ao Executivo',
      resumo: 'Governador do ES e presidente: a relação de quem ocupa cargo de confiança com a campanha de quem governa ou disputa governar.',
      e: 'Doações de pessoa física a candidatos a governador do Espírito Santo e a presidente, registradas na prestação de contas de campanha ao TSE, feitas por quem hoje ocupa cargo em comissão ou função gratificada no Poder Executivo estadual. O governador é o chefe do Executivo e quem nomeia e exonera esses cargos; por isso o vínculo com a campanha de quem governa, ou disputa governar, é a relação política mais direta.',
    },
    legislativo: {
      titulo: 'Doações a candidatos ao Legislativo',
      resumo: 'Deputados estaduais e federais e senadores pelo ES: a ligação de quem ocupa cargo de confiança com a base política do Legislativo.',
      e: 'Doações de pessoa física a candidatos a deputado estadual, deputado federal e senador pelo Espírito Santo, registradas na prestação de contas de campanha ao TSE, feitas por quem hoje ocupa cargo em comissão ou função gratificada no Poder Executivo estadual. Ajuda a ver a ligação de ocupantes de cargos de confiança com mandatos do Legislativo.',
    },
  };
  const cuidados = () => `Doar é ato legal e não indica filiação partidária nem opinião sobre o governo; o painel também não sabe se a doação foi feita antes ou depois de a pessoa assumir o cargo. É dado pessoal sensível (opinião política): o uso deve ficar restrito à equipe de transição, e a lista não deve orientar decisão individual sobre as pessoas. Os dados de 2026 são parciais, até ${dados.tse['2026']}, e a eleição ainda não terminou. Ficam de fora doações a partidos, de pessoa jurídica e do próprio candidato a si.`;
  const como = () => `Mesma pessoa quando o nome e os seis dígitos do meio do CPF coincidem entre a base de vínculos dos servidores (CPF mascarado) e a prestação de contas do TSE (CPF completo). Folha de ${dados.folha.slice(5)}/${dados.folha.slice(0, 4)}: ${nInt.format(dados.universo.ocupantes)} ocupantes, dos quais ${nInt.format(dados.universo.comMascara)} puderam ser testados (os demais não têm CPF mascarado na base). Nenhuma chave se repetiu, o que afasta homônimos. TSE: 2018, 2022 e 2026 (parcial).`;

  const grupoCands = (g) => dados.candidatos.filter((c) => c.grupo === g);
  const abas = (opcoes, atual, aoMudar) => el('div', { class: 'abas', role: 'group' }, opcoes.map(([v, r]) => el('button', { type: 'button', 'aria-pressed': String(v === atual), onclick: () => aoMudar(v) }, r)));

  // ---------- início ----------
  function cartaoGrupo(g) {
    const t = GRUPOS[g], a = dados[g], porAno = dados[g + 'PorAno'];
    return el('button', { type: 'button', class: 'cartao alerta-cartao', onclick: () => ctx.irPara(g) },
      el('h2', {}, t.titulo), el('p', { class: 'alerta-resumo' }, t.resumo),
      el('div', { class: 'alerta-numeros' }, [[nInt.format(a.pessoas), 'ocupantes doadores'], [brlCompacto(a.valor), 'doados'], [nInt.format(porAno['2026'].pessoas), 'em 2026 (parcial)']].map(([v, r]) => el('div', {}, el('b', {}, v), el('span', {}, r)))),
      el('span', { class: 'alerta-abrir' }, 'Abrir os números e a lista →'));
  }
  function renderInicio(c) {
    c.replaceChildren(
      el('p', { class: 'fm-intro' }, `Cruza os ${nInt.format(dados.universo.ocupantes)} ocupantes de cargo em comissão e função gratificada (folha de ${dados.folha.slice(5)}/${dados.folha.slice(0, 4)}) com as doações de campanha a candidatos registradas no TSE em 2018, 2022 e 2026 (parcial). ${nInt.format(dados.pessoasDistintas)} ocupantes aparecem como doadores. É dado pessoal sensível (opinião política): use só para a análise da transição e não divulgue o endereço do painel.`),
      el('div', { class: 'duas-colunas' }, cartaoGrupo('executivo'), cartaoGrupo('legislativo')));
  }

  // ---------- páginas ----------
  const trilha = (rotulo) => el('div', { class: 'trilha' }, el('button', { type: 'button', onclick: () => ctx.irPara('') }, 'Vínculos políticos'), el('span', { class: 'sep' }, '›'), el('span', { class: 'atual' }, rotulo));

  function textoGovernadores() {
    const lista = dados.governadores.filter((h) => h.resultados && Object.values(h.resultados).includes('eleito'));
    if (!lista.length) return null;
    return lista.map((h) => `${nome(h.nome)} (${h.partido}), eleito governador em ${h.anos.filter((a) => h.resultados[String(a)] === 'eleito').join(' e ')}: ${nInt.format(h.pessoas)} ocupantes distintos doaram à campanha, somando ${brl(h.valor)}.`).join(' ');
  }

  function cartaoCandidatos(g) {
    const lista = grupoCands(g);
    const governadores = g === 'executivo' ? textoGovernadores() : null;
    const linhas = lista.map((c) => el('tr', {}, el('td', {}, String(c.ano) + (c.ano === 2026 ? ' (parcial)' : '')), el('td', {}, el('strong', {}, nome(c.nome)), el('small', {}, c.partido + ' · ' + c.cargo)),
      el('td', {}, rotuloResultado(c) || '—'), el('td', { class: 'num' }, nInt.format(c.pessoas)), el('td', { class: 'num' }, brl(c.valor))));
    return el('div', { class: 'cartao' }, el('h2', {}, 'Por candidato'), governadores ? el('p', { class: 'fm-intro' }, governadores) : null,
      el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, ['Eleição', 'Candidato', 'Resultado', 'Ocupantes doadores', 'Valor doado'].map((t, n) => el('th', { class: n >= 3 ? 'num' : '' }, t)))), el('tbody', {}, linhas))));
  }

  function cartaoOrgaos(g) {
    const lista = dados.orgaos.filter((o) => o[g] > 0).sort((a, b) => b[g] - a[g]).slice(0, 12);
    const max = Math.max(1, ...lista.map((o) => o[g]));
    return el('div', { class: 'cartao' }, el('h2', {}, 'Por órgão'), el('p', { class: 'fm-intro' }, 'Ocupantes doadores em cada órgão e a parcela que representam dos ocupantes do órgão (os 12 maiores).'),
      el('div', { class: 'linhas' }, lista.map((o) => el('div', { class: 'linha-barra sem-clique' },
        el('span', { class: 'nome' }, PF.titulo(o.nome.replace(/-\s*[A-Z]+$/, '').trim()), el('small', {}, `${o.sigla} · ${nInt.format(o.ocupantes)} ocupantes`)),
        el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, (o[g] / max) * 62)}%` }), el('span', { class: 'num' }, `${nInt.format(o[g])} (${pct(o[g] / o.ocupantes)})`))))));
  }

  // lista nominal
  const candKey = (d) => d[0] + '|' + d[1];
  const infoCand = (d) => dados.candidatos.find((c) => c.ano === d[0] && c.sq === d[1]);
  function pessoasDoGrupo(g, e) {
    const doGrupo = new Set(grupoCands(g).map((c) => c.ano + '|' + c.sq));
    return pessoas.pessoas.map((p) => ({ ...p, ds: p.doacoes.filter((d) => doGrupo.has(candKey(d)) && (!e.cand || candKey(d) === e.cand)) })).filter((p) => p.ds.length && (!e.orgao || p.sigla === e.orgao) && (!e.tipo || p.tipo === e.tipo))
      .map((p) => ({ ...p, total: soma(p.ds, (d) => d[2]) })).sort((a, b) => b.total - a.total);
  }
  const textoDoacoes = (p) => p.ds.map((d) => { const c = infoCand(d); return `${d[0]}: ${c ? nome(c.nome) + ' (' + c.partido + ')' : '?'} ${brl(d[2])}`; });

  function cartaoLista(g) {
    const e = est[g];
    if (pessoasEstado === 'restrita') {
      return el('div', { class: 'cartao fm-fora' }, el('h3', {}, 'Lista nominal'), el('p', {}, 'A lista com os nomes é dado pessoal sensível (opinião política) e só é exibida com o painel protegido por senha. Os totais acima valem normalmente.'));
    }
    if (!pessoas && pessoasEstado === 'indisponivel') return el('div', { class: 'cartao fm-fora' }, el('h3', {}, 'Lista nominal'), el('p', {}, 'A lista nominal não está publicada neste ambiente. Os totais acima valem normalmente.'));
    if (!pessoas) return el('div', { class: 'cartao' }, el('p', { class: 'vazio' }, 'Carregando a lista…'));
    const lista = pessoasDoGrupo(g, e);
    const candidatos = grupoCands(g).sort((a, b) => b.ano - a.ano || b.valor - a.valor);
    const orgaos = [...new Map(pessoas.pessoas.map((p) => [p.sigla, p.sigla])).keys()].sort();
    const sel = (valor, opcoes, aoMudar, rotulo) => el('label', {}, rotulo, el('select', { onchange: (ev) => { aoMudar(ev.target.value); e.mais = 25; render(); } }, opcoes.map(([v, r]) => el('option', { value: v, selected: v === valor }, r))));
    const filtros = el('div', { class: 'filtros' },
      sel(e.cand, [['', 'Todos'], ...candidatos.map((c) => [c.ano + '|' + c.sq, `${c.ano} · ${nome(c.nome)} (${c.partido})`])], (v) => { e.cand = v; }, 'Candidato'),
      sel(e.orgao, [['', 'Todos'], ...orgaos.map((o) => [o, o])], (v) => { e.orgao = v; }, 'Órgão'),
      sel(e.tipo, [['', 'Todos'], ['CC', 'Cargo em comissão'], ['FG', 'Função gratificada']], (v) => { e.tipo = v; }, 'Tipo'));
    const linhas = lista.slice(0, e.mais).map((p, i) => el('tr', {}, el('td', { class: 'num' }, String(i + 1)),
      el('td', {}, el('strong', {}, nome(p.nome)), el('small', {}, p.sigla + ' · ' + (p.tipo === 'CC' ? 'cargo em comissão' : 'função gratificada') + ' · ' + nome(p.cargo))),
      el('td', {}, ...textoDoacoes(p).map((t) => el('small', {}, t))), el('td', { class: 'num' }, brl(p.total))));
    return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, `Ocupantes doadores (${nInt.format(lista.length)})`), el('p', {}, 'Do maior para o menor valor doado. Dado pessoal sensível: uso restrito à equipe de transição, sem divulgar o endereço.'))),
      filtros,
      lista.length ? el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, ['#', 'Ocupante', 'Doações', 'Total'].map((t, n) => el('th', { class: n === 0 || n === 3 ? 'num' : '' }, t)))), el('tbody', {}, linhas))) : el('p', { class: 'vazio' }, 'Nenhum ocupante neste filtro.'),
      lista.length > e.mais ? el('div', { class: 'rodape-tabela' }, el('span', {}, `Mostrando ${nInt.format(Math.min(e.mais, lista.length))} de ${nInt.format(lista.length)}`), el('button', { type: 'button', class: 'botao', onclick: () => { e.mais += 50; render(); } }, 'Mostrar mais')) : null,
      lista.length ? PF.barraCompartilhar(() => compartilhar(g, lista, e)) : null);
  }

  function compartilhar(g, lista, e) {
    const cand = e.cand ? dados.candidatos.find((c) => c.ano + '|' + c.sq === e.cand) : null;
    const filtros = [`${GRUPOS[g].titulo}: ocupantes de cargo em comissão e função gratificada (folha de ${dados.folha.slice(5)}/${dados.folha.slice(0, 4)}) que constam como doadores no TSE; 2026 parcial até ${dados.tse['2026']}`,
      `${nInt.format(lista.length)} ocupantes, somando ${brl(soma(lista, (p) => p.total))}`,
      [cand && `Candidato: ${nome(cand.nome)} (${cand.ano})`, e.orgao && 'Órgão: ' + e.orgao, e.tipo && 'Tipo: ' + e.tipo].filter(Boolean).join(' | '),
      'DADO PESSOAL SENSIVEL (opinião política): uso restrito. Doação de campanha é legal e não indica filiação partidária.'].filter(Boolean);
    return { titulo: GRUPOS[g].titulo, filtros, arquivo: `vinculos-politicos-${g}-${dados.folha}`,
      colunas: [{ t: '#', w: 0.5 }, { t: 'Ocupante', w: 3 }, { t: 'Órgão', w: 1.1 }, { t: 'Cargo', w: 3 }, { t: 'Doações', w: 4.5 }, { t: 'Total', w: 1.3, n: 1 }],
      linhas: lista.map((p, i) => [i + 1, nome(p.nome), p.sigla, `${p.tipo} - ${nome(p.cargo)}`, textoDoacoes(p).join('; '), brl(p.total)]),
      texto: lista.slice(0, 10).map((p, i) => `${i + 1}. ${nome(p.nome)} (${p.sigla}) - ${brl(p.total)}`).concat(['', 'Dado pessoal sensivel: uso restrito.']) };
  }

  function renderGrupo(c, g) {
    const t = GRUPOS[g], a = dados[g];
    const orgs = dados.orgaos.filter((o) => o[g] > 0).length;
    c.replaceChildren(trilha(t.titulo.replace('Doações a candidatos ao ', '')),
      el('div', { class: 'kpis' },
        kpi('Ocupantes doadores', nInt.format(a.pessoas), `${pct(a.pessoas / dados.universo.comMascara)} dos ${nInt.format(dados.universo.comMascara)} ocupantes testados`),
        kpi('Valor doado', brl(a.valor), 'soma de 2018, 2022 e 2026 (parcial)'),
        kpi('Órgãos com doadores', nInt.format(orgs), 'órgãos em que ao menos um ocupante doou')),
      el('div', { class: 'cartao' }, el('h2', {}, t.titulo),
        [['O que é', t.e], ['Cuidados na leitura', cuidados()]].map(([h, p]) => el('div', { class: 'lac-bloco' }, el('h4', {}, h), el('p', {}, p))),
        el('details', { class: 'fm-detalhes' }, el('summary', {}, 'Como o painel identificou'), el('div', { class: 'lac-bloco' }, el('p', {}, como())))),
      cartaoCandidatos(g), cartaoOrgaos(g), cartaoLista(g));
  }

  // ---------- roteamento ----------
  async function carregarPessoas() {
    if (pessoas) return;
    pessoasEstado = 'carregando';
    try { pessoas = await ctx.api('pessoas'); pessoasEstado = ''; } catch (e) { pessoas = null; if (e.sessao) throw e; pessoasEstado = e.status === 403 ? 'restrita' : 'indisponivel'; }
  }
  function render() {
    if (!raiz || !$('#conteudo')) return;
    PF.esconderDica();
    const c = $('#conteudo');
    if (tela === 'executivo' || tela === 'legislativo') renderGrupo(c, tela); else renderInicio(c);
  }
  function aoNavegar(resto) {
    if (!dados) return;
    const r = decodeURIComponent(resto || '');
    tela = r === 'executivo' || r === 'legislativo' ? r : '';
    render();
    if (tela) { window.scrollTo({ top: 0 }); if (!pessoas) carregarPessoas().then(render).catch(() => {}); }
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Vínculos políticos</h2>
          <p class="sub">Ocupantes de cargos de confiança que constam como doadores de campanha, com foco no chefe do Executivo.</p>
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
    $('#mesref').textContent = `Folha de ${dados.folha.slice(5)}/${dados.folha.slice(0, 4)} · TSE até ${dados.tse['2026']}`;
    return true;
  }
  function desmontar() { dados = null; pessoas = null; pessoasEstado = ''; }
  PF.registrar({ id: 'politico', titulo: 'Vínculos políticos', montar, aoNavegar, desmontar });
})();
