(() => {
  'use strict';
  // Módulo "Organograma": árvore de unidades de um órgão, com as pessoas de cada unidade,
  // a condição de cada uma (cor + rótulo) e a remuneração somando carreira e cargo.
  const { el, nInt, nBRL, brlCompacto, rotuloMes, titulo, norm } = PF;

  const COND = {
    puro: { rotulo: 'Comissionado sem vínculo efetivo', curto: 'Sem vínculo efetivo', cor: 'var(--serie-1)' },
    carreira: { rotulo: 'Servidor de carreira em cargo em comissão', curto: 'Servidor de carreira', cor: 'var(--serie-2)' },
    fg: { rotulo: 'Servidor de carreira com função gratificada', curto: 'Função gratificada', cor: 'var(--serie-3)' },
  };
  const ORDEM = ['puro', 'carreira', 'fg'];
  const PADRAO = 'SEFAZ';

  let ctx = null;
  let raiz = null;
  let indice = null;
  const cache = new Map();
  let token = 0;
  const estado = {
    org: null, busca: '', conds: new Set(ORDEM), abertos: new Set(), pessoasAbertas: new Set(), dados: null,
  };
  const $ = (s) => raiz.querySelector(s);

  // ---------- modelo ----------
  function construir(dados) {
    const nos = new Map();
    for (const u of dados.unidades) nos.set(u.id, { ...u, filhos: [], pessoas: [] });
    for (const n of nos.values()) if (n.pai && nos.has(n.pai)) nos.get(n.pai).filhos.push(n);
    for (const p of dados.pessoas) (nos.get(p.unidade) || nos.get(dados.sigla)).pessoas.push(p);
    return { nos, raiz: nos.get(dados.sigla) };
  }
  function passa(p) {
    if (!estado.conds.has(p.cond)) return false;
    const q = norm(estado.busca);
    return !q || norm(p.nome).includes(q) || norm(p.funcao).includes(q);
  }
  // agrega a subárvore já considerando os filtros; guarda em n.ag
  function agregar(n) {
    const ag = { n: 0, cond: { puro: 0, carreira: 0, fg: 0 }, valor: 0, bruto: 0 };
    n.visiveis = n.pessoas.filter(passa);
    for (const p of n.visiveis) {
      ag.n++; ag.cond[p.cond]++; ag.valor += p.valor; ag.bruto += p.bruto;
    }
    for (const f of n.filhos) {
      const a = agregar(f);
      ag.n += a.n; ag.valor += a.valor; ag.bruto += a.bruto;
      for (const c of ORDEM) ag.cond[c] += a.cond[c];
    }
    n.ag = ag;
    return ag;
  }
  const filtrando = () => estado.busca.trim() !== '' || estado.conds.size < ORDEM.length;

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

  function cartaoPessoa(p) {
    const aberto = estado.pessoasAbertas.has(p.id + p.funcao);
    const detalhes = [];
    if (p.cargoEfetivo) detalhes.push(['Cargo efetivo', titulo(p.cargoEfetivo)]);
    if (p.vinculo) detalhes.push(['Vínculo oficial', titulo(p.vinculo)]);
    detalhes.push(['Condição', COND[p.cond].rotulo]);
    detalhes.push(['Provimento', p.prov]);
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
        el('span', { class: 'pessoa-funcao' }, titulo(p.funcao)),
        el('span', { class: 'pessoa-linha' }, chipCond(p.cond),
          el('span', { class: 'valores' },
            el('span', {}, 'Cargo ', el('b', {}, nBRL.format(p.valor))),
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
    const nome = (n.sigla || n.id.startsWith('n:')) ? n.nome : titulo(n.nome);
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
      if (n.visiveis.length) corpo.append(el('ul', { class: 'pessoas' }, n.visiveis.map(cartaoPessoa)));
      const filhos = n.filhos.map((f) => noUnidade(f, profundidade + 1)).filter(Boolean);
      if (filhos.length) corpo.append(el('ul', { class: 'arvore' }, filhos));
      li.append(corpo);
    }
    return li;
  }

  // ---------- desenho ----------
  function desenhar(focoId) {
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
        el('div', { class: 'nota' }, ORDEM.map((c) => `${nInt.format(ag.cond[c])} ${COND[c].curto.toLowerCase()}`).join(' · '))),
      el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Valor dos cargos por mês'),
        el('div', { class: 'valor' }, brlCompacto(ag.valor)), el('div', { class: 'nota' }, 'só o que se paga por causa do cargo')),
      el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Remuneração bruta por mês'),
        el('div', { class: 'valor' }, brlCompacto(ag.bruto)), el('div', { class: 'nota' }, 'carreira + cargo, antes do abate do teto')));

    const legenda = el('div', { class: 'filtro-cond', role: 'group', 'aria-label': 'Filtrar por condição' },
      ORDEM.map((c) => el('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(estado.conds.has(c)),
        style: `--cor:${COND[c].cor}`,
        onclick: () => { if (estado.conds.has(c)) estado.conds.delete(c); else estado.conds.add(c); if (!estado.conds.size) estado.conds = new Set(ORDEM); desenhar(); } },
      el('i', {}), COND[c].rotulo, el('span', { class: 'n' }, nInt.format(info ? info[c] : 0)))));

    const arvore = noUnidade(r, 0);
    const aviso = !info.estruturaOficial
      ? el('p', { class: 'nota-estrutura' }, 'Este órgão ainda não tem a estrutura oficial transcrita: as unidades aparecem agrupadas pelo nível do código do setor, sem subordinação confirmada.') : null;

    const ferramentas = el('div', { class: 'ferramentas' },
      el('button', { type: 'button', class: 'botao', onclick: () => { estado.abertos = new Set(estado.modelo.todos.filter((n) => n.filhos.length || n.pessoas.length).map((n) => n.id)); desenhar(); } }, 'Abrir tudo'),
      el('button', { type: 'button', class: 'botao', onclick: () => { estado.abertos = new Set([d.sigla]); desenhar(); } }, 'Recolher'),
      el('button', { type: 'button', class: 'botao', onclick: exportar }, 'Exportar CSV'));

    $('#resumo').replaceChildren(kpis, legenda, ferramentas);
    $('#arvore').replaceChildren(...[aviso, arvore ? el('ul', { class: 'arvore raiz-lista' }, arvore)
      : el('p', { class: 'vazio' }, 'Nenhuma pessoa corresponde aos filtros.')].filter(Boolean));
    if (focoId) {
      const alvo = $('#arvore').querySelector(`[data-foco="${CSS.escape(focoId)}"]`);
      if (alvo) alvo.focus({ preventScroll: true });
    }
  }

  function caminho(n, nos) {
    const partes = [];
    for (let x = n; x; x = x.pai ? nos.get(x.pai) : null) partes.unshift(x.sigla || x.nome);
    return partes.join(' > ');
  }
  function exportar() {
    const { nos } = estado.modelo;
    const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cab = ['Órgão', 'Unidade (caminho)', 'Nome', 'Função', 'Condição', 'Valor do cargo (R$/mês)',
      'Remuneração bruta (R$/mês)', 'Abate do teto (R$/mês)', 'Subsídio da carreira (R$/mês)', 'Vínculo oficial'];
    const f2 = (v) => (v ? v.toFixed(2).replace('.', ',') : '');
    const linhas = estado.dados.pessoas.filter(passa).map((p) => [estado.org, caminho(nos.get(p.unidade) || estado.modelo.raiz, nos),
      p.nome, p.funcao, COND[p.cond].rotulo, f2(p.valor), f2(p.bruto), f2(p.abate), f2(p.subsidioCarreira), p.vinculo || '']);
    const txt = '﻿' + [cab, ...linhas].map((r) => r.map(esc).join(';')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })),
      download: `organograma-${estado.org}-${indice.mes}.csv` });
    document.body.append(a); a.click(); a.remove();
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
    estado.pessoasAbertas = new Set();
    $('#arvore').classList.remove('carregando');
    $('#f-org').value = sigla;
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
        <label class="busca">Buscar <input id="f-busca" type="search" placeholder="Nome ou função" autocomplete="off"></label>
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
      el('p', {}, 'Condição. Em azul, quem ocupa cargo em comissão sem vínculo efetivo (livre nomeação). Em laranja, o servidor de carreira que ocupa cargo em comissão: o cargo se soma ao salário de origem. Em verde, o servidor de carreira que recebe função gratificada. A cor nunca vem sozinha: cada pessoa traz o rótulo escrito.'),
      el('p', {}, 'Valores. "Cargo" é o que se paga por causa do cargo (regra do módulo Cargos em comissão). "Bruto" é a soma das rubricas de pagamento do mês, somando carreira e cargo; não inclui auxílios, indenizações, 13º, férias nem resíduos de acerto. O abate do teto constitucional aparece à parte, no detalhe da pessoa.'),
      el('p', {}, 'Estrutura. A subordinação entre unidades vem de tabelas transcritas de decretos e organogramas oficiais, com a fonte de cada linha: hoje, a SEFAZ (Anexo III do Decreto 6005-R, de 2025, e o Decreto 6160-R, de 2025). A base de dados abertos informa o setor de cada pessoa, mas não diz quem é subordinado a quem, e o código do setor não é confiável como nível hierárquico. Onde não há estrutura oficial transcrita, ou a unidade não consta dela, a unidade fica num agrupamento "subordinação não confirmada", e nada é inferido por nome ou sigla. Ligações marcadas "a conferir" foram lidas de uma imagem e merecem verificação.'),
      el('p', {}, 'Lotação. O setor de cada pessoa é o da base de vínculos, que mostra a situação de hoje, e não o histórico. A estrutura muda por decreto, então a tabela precisa ser revista a cada alteração.'));
    $('#mesref').textContent = 'Referência: ' + rotuloMes(indice.mes, true);
  }

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    ++token; // invalida cargas iniciadas antes de uma troca de aba
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
