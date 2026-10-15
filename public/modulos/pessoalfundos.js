(() => {
  'use strict';
  // Módulo "Pagamentos por fundos" (painel Pessoal): pagamentos a pessoal feitos por fundos, fora da folha do órgão. O caso de pessoa a pessoa é a
  // indenização de transporte dos Auditores Fiscais, paga pelo Funsefaz: a tela lista quem recebe, quanto, e como fica a remuneração com o pagamento
  // do fundo somado à folha. No fundo da PGE a folha é paga em bloco e não há nomes na execução; aparecem só as séries e os componentes.
  const { el, nInt, nBRL, brlCompacto, soma, titulo, norm, rotuloMes } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  let pessoas = null;
  const est = { fundo: '', busca: '', ordem: { col: 'media', dir: -1 }, mais: 25 };

  const brl = (v) => nBRL.format(v);
  const pct = (x) => (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + '%';
  const kpi = (rotulo, valor, nota, tom) => el('div', { class: 'kpi' + (tom ? ' ' + tom : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const fundoAtual = () => dados.fundos.find((f) => f.id === est.fundo) || dados.fundos[0];
  const mesesSerie = (f) => Object.keys(f.serie).sort().filter((m) => m <= dados.folhaMes);

  function cartaoSerie(f) {
    const meses = mesesSerie(f);
    const cartao = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Quanto o fundo pagou por mês'), el('p', {}, `Pago e restos a pagar pagos, até ${rotuloMes(dados.folhaMes, true)}, a competência da folha (o mês seguinte da execução ainda está incompleto).`))));
    if (meses.length > 1) PF.graficoBarras(cartao, { meses, series: [{ nome: 'Pago no mês', cor: 'var(--serie-1)', vals: meses.map((m) => f.serie[m].pago) }], fmt: brlCompacto, eixo: brlCompacto });
    return cartao;
  }

  function cartaoComponentes(f) {
    if (!f.componentes.length) return null;
    const janela = new Set(Object.keys(f.serie).filter((m) => m >= f.janela[0] && m <= f.janela[1]));
    const comp = f.componentes.map((c) => ({ ...c, v: soma([...janela], (m) => c.serie[m] || 0) })).sort((a, b) => b.v - a.v);
    const resto = f.total12 - soma(comp, (c) => c.v);
    if (resto > 1e4) comp.push({ rotulo: 'Demais elementos de despesa', cod: '', elemento: '', v: resto });
    const max = Math.max(1, ...comp.map((c) => c.v));
    return el('div', { class: 'cartao' }, el('h2', {}, 'Componentes dos últimos 12 meses'),
      el('div', { class: 'linhas' }, comp.map((c) => el('div', { class: 'linha-barra sem-clique' }, el('span', { class: 'nome' }, c.rotulo, el('small', {}, c.cod ? `elemento ${c.cod}${c.elemento ? ' · ' + titulo(c.elemento) : ''}` : 'pagos pelo fundo, fora dos componentes acima')),
        el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, (c.v / max) * 62)}%` }), el('span', { class: 'num' }, `${brlCompacto(c.v)} · ${pct(c.v / Math.max(1, f.total12))}`))))));
  }

  // ---------- lista de pessoas ----------
  const COLS = [['nome', 'Pessoa e lotação'], ['media', 'Média mensal do fundo', 1], ['ultimo', 'Último mês', 1], ['folha', `Folha (corrente)`, 1], ['total', 'Folha + fundo', 1], ['acresc', 'Acréscimo', 1]];
  const valorOrdem = (p, col) => ({ nome: p.nome, media: p.media, ultimo: p.ultimo, folha: p.folha ? p.folha.corrente : -1, total: p.folha ? p.folha.corrente + p.media : -1, acresc: p.folha && p.folha.corrente ? p.media / p.folha.corrente : -1 })[col];

  function ficha(p) {
    if (!p.folha) return;
    const o = { id: p.folha.id, nome: p.folha.nome, funcao: p.folha.cargo || 'Servidor', tipo: '', unidade: p.folha.unidade, prov: 'Sem cargo em comissão ou função gratificada', cargoEfetivo: '', vinculo: '', valor: 0, rub: p.folha.rub };
    PF.fichaPessoa({ sigla: p.folha.org || p.sigla, id: p.folha.id, alternativa: o, mes: dados.folhaMes, nomeOrg: p.folha.org || p.sigla });
  }

  function cartaoPessoas(f) {
    const lista0 = pessoas.pessoas.filter((p) => p.fundo === f.id);
    const q = norm(est.busca);
    const { col, dir } = est.ordem;
    const lista = lista0.filter((p) => !q || norm(p.nome).includes(q) || (p.folha && norm(p.folha.unidade).includes(q))).sort((a, b) => {
      const x = valorOrdem(a, col), y = valorOrdem(b, col);
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * dir || a.nome.localeCompare(b.nome, 'pt-BR');
    });
    const refresh = () => render();
    const linhas = lista.slice(0, est.mais).map((p) => {
      const fo = p.folha;
      return el('tr', { class: fo ? 'clicavel' : '', tabindex: fo ? '0' : null, title: fo ? 'Ver a composição da folha' : 'Sem correspondência na folha do mês', onclick: () => ficha(p), onkeydown: (ev) => { if (ev.key === 'Enter') ficha(p); } },
        el('td', {}, el('strong', {}, titulo(p.nome)), el('small', {}, fo ? [titulo(fo.cargo), titulo(fo.unidade)].filter(Boolean).join(' · ') : 'sem correspondência na folha do mês')),
        el('td', { class: 'num' }, brl(p.media), el('small', {}, `${p.meses} de 12 meses`)), el('td', { class: 'num' }, p.ultimo ? brl(p.ultimo) : '—'),
        el('td', { class: 'num' }, fo ? brl(fo.corrente) : '—'), el('td', { class: 'num' }, fo ? brl(fo.corrente + p.media) : '—'),
        el('td', { class: 'num' }, fo && fo.corrente ? '+' + pct(p.media / fo.corrente) : '—'));
    });
    const cab = el('tr', {}, COLS.map(([k, r, n]) => el('th', { class: n ? 'num' : '', 'aria-sort': col === k ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', onclick: () => { est.ordem = { col: k, dir: col === k ? -dir : (k === 'nome' ? 1 : -1) }; est.mais = 25; refresh(); } }, r + (col === k ? (dir > 0 ? ' ▲' : ' ▼') : '')))));
    const tabela = lista.length ? el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, cab), el('tbody', {}, linhas))) : el('p', { class: 'vazio' }, 'Nenhuma pessoa neste filtro.');
    const busca = el('input', { type: 'search', placeholder: 'Buscar por nome ou lotação', value: est.busca, autocomplete: 'off', 'aria-label': 'Buscar' });
    let t;
    busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { est.busca = busca.value.trim(); est.mais = 25; refresh(); }, 200); });
    return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, `Quem recebeu (${nInt.format(lista.length)})`),
      el('p', {}, `Média por mês nos 12 meses até ${rotuloMes(f.janela[1], true)}, somada à remuneração corrente da folha de ${rotuloMes(dados.folhaMes, true)} (sem 13º, férias e rescisão). Clique numa pessoa para ver a folha completa.`))),
      el('div', { class: 'filtros' }, el('label', { class: 'busca' }, 'Buscar', busca)), tabela,
      lista.length > est.mais ? el('div', { class: 'rodape-tabela' }, el('span', {}, `Mostrando ${nInt.format(Math.min(est.mais, lista.length))} de ${nInt.format(lista.length)}`), el('button', { type: 'button', class: 'botao', onclick: () => { est.mais += 50; refresh(); } }, 'Mostrar mais')) : null,
      lista.length ? PF.barraCompartilhar(() => compartilhar(f, lista)) : null);
  }

  function compartilhar(f, lista) {
    return { titulo: `${f.titulo}: pagamento do ${f.fundo}`, arquivo: `pessoal-fundos-${f.id}-${dados.ate}`,
      filtros: [`${f.titulo}, pago pelo ${f.fundo} (${titulo(f.ugNome)}), fora da folha de ${f.sigla}; media mensal dos 12 meses ate ${rotuloMes(f.janela[1], true)}; folha de ${rotuloMes(dados.folhaMes, true)} (remuneracao corrente, sem 13o, ferias e rescisao)`,
        `${nInt.format(lista.length)} pessoas`, 'Dado pessoal de agente publico, de fonte publica (SIGEFES e Portal da Transparencia): uso restrito a equipe de transicao.'],
      colunas: [{ t: 'Pessoa', w: 3.4 }, { t: 'Lotacao', w: 3 }, { t: 'Media do fundo', w: 1.4, n: 1 }, { t: 'Ultimo mes', w: 1.3, n: 1 }, { t: 'Folha', w: 1.4, n: 1 }, { t: 'Folha + fundo', w: 1.5, n: 1 }, { t: 'Acresc.', w: 1, n: 1 }],
      linhas: lista.map((p) => [titulo(p.nome), p.folha ? [titulo(p.folha.cargo), titulo(p.folha.unidade)].filter(Boolean).join(' - ') : '-', brl(p.media), p.ultimo ? brl(p.ultimo) : '-', p.folha ? brl(p.folha.corrente) : '-', p.folha ? brl(p.folha.corrente + p.media) : '-', p.folha && p.folha.corrente ? '+' + pct(p.media / p.folha.corrente) : '-']),
      texto: lista.slice(0, 10).map((p, i) => `${i + 1}. ${titulo(p.nome)} - media de ${brl(p.media)}/mes do ${f.fundo}`).concat(lista.length > 10 ? [`... e mais ${lista.length - 10}. O PDF traz a lista completa.`] : []) };
  }

  // ---------- tela ----------
  function render() {
    if (!raiz || !$('#conteudo')) return;
    PF.esconderDica();
    const c = $('#conteudo');
    const f = fundoAtual();
    if (!est.fundo) est.fundo = f.id;
    const seletor = el('div', { class: 'abas', role: 'group' }, dados.fundos.map((x) => el('button', { type: 'button', 'aria-pressed': String(x.id === f.id), onclick: () => { est.fundo = x.id; est.mais = 25; est.busca = ''; render(); } }, `${x.sigla} · ${x.fundo}`)));
    const kp = [kpi('Pago em 12 meses', brlCompacto(f.total12), `${rotuloMes(f.janela[0], true)} a ${rotuloMes(f.janela[1], true)}, pago e restos a pagar pagos`),
      kpi('Média por mês', brlCompacto(f.total12 / 12), 'pelo ' + f.fundo)];
    if (f.resumo) {
      const r = f.resumo;
      kp.push(kpi('Pessoas pagas', nInt.format(r.pessoas), `${nInt.format(r.ligadasAFolha)} ligadas à folha de ${rotuloMes(dados.folhaMes, true)}`),
        kpi('Remuneração média com o fundo', brlCompacto(r.mediaComFundo), `${brlCompacto(r.mediaFolha)} na folha + ${brlCompacto(r.mediaMensal)} do fundo: +${pct(r.mediaMensal / Math.max(1, r.mediaFolha))}`, 'alerta'));
    }
    const texto = el('div', { class: 'cartao' }, el('h2', {}, f.titulo), el('p', { class: 'fm-intro' }, f.descricao),
      f.bonificacao ? el('p', { class: 'fm-nota' }, `O programa de remuneração por desempenho da ${f.sigla} (rubrica "Bonificação por desempenho") não vem do fundo: é pago pela folha. Em ${rotuloMes(dados.folhaMes, true)}, ${nInt.format(f.bonificacao.pessoas)} pessoas receberam ${brlCompacto(f.bonificacao.mensal)} no mês; entre quem recebe o pagamento do fundo, ${nInt.format(f.bonificacao.pessoasNosBeneficiarios)} também recebem a bonificação, em média ${brl(f.bonificacao.mediaNosBeneficiarios)}. A bonificação aparece na ficha de cada pessoa e já está dentro da remuneração corrente da tabela abaixo.`) : null,
      !f.beneficiarios ? el('p', { class: 'fm-nota' }, 'Neste fundo a folha é paga em bloco: o favorecido do pagamento é a própria folha, sem o nome de cada pessoa. Por isso aparecem as séries e os componentes, mas não a lista de quem recebe. O pagamento nominal está em Informações a solicitar.') : null);
    c.replaceChildren(...[el('div', { class: 'filtro-cond' }, seletor), el('div', { class: 'kpis' }, kp), texto, cartaoSerie(f), cartaoComponentes(f), f.beneficiarios && pessoas ? cartaoPessoas(f) : null,
      el('p', { class: 'fm-nota' }, `Fonte: ${dados.fonte}; folha do Portal da Transparência (${rotuloMes(dados.folhaMes, true)}). O valor é o pago mais restos a pagar pagos; os nomes vêm do favorecido do pagamento e são ligados à folha pelo nome, dentro do órgão.`)].filter(Boolean));
  }
  function aoNavegar() { render(); }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Pagamentos de pessoal por fundos</h2>
          <p class="sub">O que fundos pagam a pessoal fora da folha do órgão, e como isso soma à remuneração.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <div id="conteudo"></div>
    </section>`;

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); pessoas = await ctx.api('pessoas'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#conteudo').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar os dados.'));
      return false;
    }
    $('#mesref').textContent = 'Folha de ' + rotuloMes(dados.folhaMes, true);
    return true;
  }
  function desmontar() { dados = null; pessoas = null; }
  PF.registrar({ id: 'pessoalfundos', titulo: 'Pagamentos por fundos', montar, aoNavegar, desmontar });
})();
