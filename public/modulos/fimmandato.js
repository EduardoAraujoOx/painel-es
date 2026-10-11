(() => {
  'use strict';
  // Módulo "Fim de mandato": o que o governo que sai assumiu nos dois últimos quadrimestres e o próximo herda.
  // Tela inicial com dois alertas; cada um abre numa página com a base legal, o critério, os cuidados, o que esclarecer
  // e a lista de contratos (do maior para o menor valor), que pode ser compartilhada em PDF.
  const { el, nInt, brlCompacto, soma, norm } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  let tela = '';
  const est = { novos: { tipo: '', soPrincipais: false, mais: 25 }, aditivos: { tipo: '', soPrincipais: false, mais: 25 } };

  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const nomeProprio = (s) => (s && s === s.toUpperCase() ? PF.titulo(s) : s || '');
  const cortar = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '...' : t);
  const pct = (x) => (x == null ? '—' : (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%');
  const kpi = (rotulo, valor, nota, tom) => el('div', { class: 'kpi' + (tom ? ' ' + tom : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);

  // ---------- dados em objetos ----------
  const objs = (campos, linhas) => linhas.map((l) => Object.fromEntries(campos.map((c, i) => [c, l[i]])));
  let novos = [], aditivos = [];
  const tipoObjeto = (x) => (x.cat === 'Obras e engenharia' ? 'obras' : x.cat === 'Mão de obra e serviços de apoio' ? 'apoio' : 'demais');
  const ROTULO_TIPO = { '': 'Todos', obras: 'Obras e engenharia', apoio: 'Serviços de apoio (contínuos)', demais: 'Demais' };
  const ROTULO_ADIT = { '': 'Todos', valor: 'De valor', prazo: 'De prazo' };

  function abas(opcoes, atual, aoMudar) {
    return el('div', { class: 'abas', role: 'group' }, opcoes.map(([v, r]) =>
      el('button', { type: 'button', 'aria-pressed': String(v === atual), onclick: () => aoMudar(v) }, r)));
  }
  const chipPrincipais = (e, aoMudar) => el('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(e.soPrincipais),
    title: 'Contratos que, do maior para o menor valor, somam 80% do compromisso anual do Estado', onclick: () => aoMudar() }, 'Só contratos principais');

  // ---------- textos de cada alerta (base legal, critério, cuidados, o que esclarecer) ----------
  const ALERTAS = {
    novos: {
      titulo: 'Contratos assinados desde 1º de maio com parcelas em 2027 ou depois',
      resumo: 'Obrigações novas que passam para o governo seguinte.',
      e: 'A Lei de Responsabilidade Fiscal (art. 42) proíbe, nos dois últimos quadrimestres do mandato, assumir obrigação de despesa que não possa ser cumprida dentro dele ou que deixe parcelas para o ano seguinte sem disponibilidade de caixa. Para o governo que entra, cada contrato firmado nesse período e com vigência depois de 31/12/2026 é um compromisso herdado.',
      como: () => `Contratos vigentes no SIGA, com data de celebração a partir de ${dataBR(dados.marco)} e fim de vigência (com aditivos) depois de ${dataBR(dados.fimMandato)}. A parcela depois de 2026 é uma estimativa: valor anual do contrato vezes os dias que passam de 31/12/2026, sobre 365, limitada ao valor final. Posição em ${dataBR(dados.ref)}.`,
      cuidados: 'Assinar contrato no fim do mandato não é irregular por si: obra programada e serviço essencial costumam ser legítimos. O que decide se houve infração é o saldo de caixa por fonte em 31/12, que não é público; ele está na tela Informações a solicitar. Em obras e registros de preços o valor é um teto, não o que será pago. Serviços contínuos (apoio e limpeza, por exemplo) têm interpretação jurídica própria, por isso aparecem num filtro à parte. Contratos conduzidos fora do SIGA não entram. Poucos registros trazem data de celebração posterior à posição dos dados: foram mantidos e marcados.',
      esclarecer: 'Havia disponibilidade de caixa para as parcelas de 2027? Por que o contrato foi firmado nessa data e não antes ou depois da posse? Há previsão orçamentária para 2027 e o objeto é de execução já programada?',
    },
    aditivos: {
      titulo: 'Aditivos de prazo e de valor desde 1º de maio',
      resumo: 'Contratos em curso que foram prorrogados ou tiveram o valor acrescido.',
      e: 'Prorrogar o prazo ou acrescer o valor de um contrato em curso também cria obrigação para o governo seguinte, e o exame do art. 42 da LRF vale para o que se contrai nos dois últimos quadrimestres. Os acréscimos de valor têm limite legal: em regra, 25% do valor inicial atualizado (Lei 14.133/2021, art. 125; Lei 8.666/1993, art. 65), e 50% em reforma de edificação ou equipamento.',
      como: () => `Alterações registradas no SIGA a partir de ${dataBR(dados.marco)} em contratos vigentes, de dois tipos: prorrogação de prazo e acréscimo ou supressão quantitativa. Reajustes, repactuações e mudanças de cadastro (${nInt.format(soma(Object.values(dados.universo.ignoradas), (v) => v))} registros) não entram, por serem rotina. O percentual do acréscimo compara o valor do aditivo com o valor inicial do contrato. Posição em ${dataBR(dados.ref)}.`,
      cuidados: 'Prorrogação é rotina em serviços contínuos e não indica problema por si; o foco está nos contratos de maior valor e nos acréscimos grandes. O valor do aditivo vem do SIGA e pode estar em branco. O valor inicial do contrato pode já refletir alterações anteriores, e "acima de 25%" é um sinal para conferir, não conclusão. Alguns registros trazem data posterior à posição dos dados (registro antecipado): foram mantidos e marcados.',
      esclarecer: 'Qual a justificativa técnica e econômica do aditivo? O acréscimo respeitou o limite legal sobre o valor inicial atualizado? Há disponibilidade orçamentária e de caixa para o que vence em 2027?',
    },
  };

  // ---------- tela inicial ----------
  function cartaoAlerta(chave, numeros) {
    const a = ALERTAS[chave];
    return el('button', { type: 'button', class: 'cartao alerta-cartao', onclick: () => ctx.irPara(chave) },
      el('h2', {}, a.titulo), el('p', { class: 'alerta-resumo' }, a.resumo),
      el('div', { class: 'alerta-numeros' }, numeros.map(([v, r]) => el('div', {}, el('b', {}, v), el('span', {}, r)))),
      el('span', { class: 'alerta-abrir' }, 'Abrir a lista e a justificativa →'));
  }
  function renderInicio(c) {
    const alem = soma(novos, (x) => x.alem);
    const acrescimos = aditivos.filter((x) => x.valor);
    const acima = acrescimos.filter((x) => x.valorAlt && x.vini && x.valorAlt / x.vini > 0.25);
    c.replaceChildren(
      el('p', { class: 'fm-intro' }, `O que o governo que sai assumiu desde ${dataBR(dados.marco)}, início dos dois últimos quadrimestres do mandato (LRF, art. 42), e o próximo governo herda. São dois alertas, escolhidos por serem verificáveis nos dados públicos.`),
      el('div', { class: 'duas-colunas' },
        cartaoAlerta('novos', [[nInt.format(novos.length), 'contratos'], [brlCompacto(soma(novos, (x) => x.anual)), 'por ano'], [brlCompacto(alem), 'depois de 2026 (est.)']]),
        cartaoAlerta('aditivos', [[nInt.format(aditivos.length), 'aditivos'], [brlCompacto(soma(acrescimos, (x) => x.valorAlt || 0)), 'em acréscimos'], [nInt.format(acima.length), 'acima de 25% do inicial']])),
      el('div', { class: 'cartao fm-fora' }, el('h3', {}, 'O que ainda não está aqui'),
        el('p', {}, 'O empenhado e ainda não pago só passa a significar algo em 31 de dezembro, quando se sabe o que ficou como restos a pagar; entra nessa época. O saldo de caixa por fonte, que decide se o art. 42 foi cumprido, não é público: está na tela Informações a solicitar.')));
  }

  // ---------- páginas dos alertas ----------
  function trilha(rotulo) {
    return el('div', { class: 'trilha' }, el('button', { type: 'button', onclick: () => ctx.irPara('') }, 'Fim de mandato'), el('span', { class: 'sep' }, '›'), el('span', { class: 'atual' }, rotulo));
  }
  function textos(a) {
    const bloco = ([t, p]) => el('div', { class: 'lac-bloco' }, el('h4', {}, t), el('p', {}, p));
    return el('div', { class: 'cartao' }, el('h2', {}, a.titulo), bloco(['O que é', a.e]), bloco(['O que esclarecer', a.esclarecer]),
      el('details', { class: 'fm-detalhes' }, el('summary', {}, 'Como o painel identificou e cuidados na leitura'), bloco(['Como o painel identificou', a.como()]), bloco(['Cuidados na leitura', a.cuidados])));
  }
  const linkForn = (x) => el('a', { href: `#/contratacoes/${encodeURIComponent('f:' + x.cnpj)}` }, nomeProprio(x.forn));
  const celulaObjeto = (x) => el('td', { class: 'objeto' }, el('strong', {}, linkForn(x)), x.principal ? el('span', { class: 'selo n-i', title: 'Entre os contratos que somam 80% do compromisso anual do Estado' }, el('b', {}, 'Principal')) : null,
    el('small', {}, x.orgNome + ' · ' + x.doc), el('small', {}, cortar(x.objeto, 160)));

  function rodapeLista(e, total, mostrados, aoMais) {
    return total > mostrados ? el('div', { class: 'rodape-tabela' }, el('span', {}, `Mostrando ${nInt.format(mostrados)} de ${nInt.format(total)}`),
      el('button', { type: 'button', class: 'botao', onclick: () => { e.mais += 50; aoMais(); } }, 'Mostrar mais')) : null;
  }

  function renderNovos(c) {
    const e = est.novos, a = ALERTAS.novos;
    const lista = novos.filter((x) => (!e.tipo || tipoObjeto(x) === e.tipo) && (!e.soPrincipais || x.principal));
    const refresh = () => render();
    const kp = el('div', { class: 'kpis' },
      kpi('Contratos', nInt.format(lista.length), e.tipo || e.soPrincipais ? 'no filtro escolhido' : `de ${nInt.format(dados.universo.celebradosDesdeMarco)} celebrados desde ${dataBR(dados.marco)}`),
      kpi('Compromisso anual', brlCompacto(soma(lista, (x) => x.anual)), 'valor por ano de vigência'),
      kpi('Depois de 2026 (estimativa)', brlCompacto(soma(lista, (x) => x.alem)), 'parcelas que ficam para o governo seguinte', 'alerta'));
    const linhas = lista.slice(0, e.mais).map((x, i) => el('tr', {}, el('td', { class: 'num' }, String(i + 1)), celulaObjeto(x),
      el('td', {}, dataBR(x.cel), el('small', {}, 'até ' + dataBR(x.fimef)), x.cel > dados.ref ? el('small', { class: 'fm-futura' }, 'data posterior à posição dos dados') : null), el('td', {}, x.modal || '—', x.rp ? el('small', {}, 'registro de preços') : null),
      el('td', { class: 'num' }, brlCompacto(x.anual)), el('td', { class: 'num' }, brlCompacto(x.alem))));
    const tabela = lista.length ? el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, ['#', 'Fornecedor, órgão e objeto', 'Assinado em', 'Modalidade', 'Por ano', 'Depois de 2026 (est.)'].map((t, n) => el('th', { class: n === 0 || n >= 4 ? 'num' : '' }, t)))),
      el('tbody', {}, linhas))) : el('p', { class: 'vazio' }, 'Nenhum contrato neste filtro.');
    c.replaceChildren(trilha('Contratos novos'), kp, textos(a),
      el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, `Contratos (${nInt.format(lista.length)})`),
        el('p', {}, 'Do maior para o menor compromisso anual. Clique no fornecedor para ver a ficha, os sócios e os alertas.'))),
      el('div', { class: 'filtro-cond' }, abas(Object.entries(ROTULO_TIPO), e.tipo, (v) => { e.tipo = v; e.mais = 25; refresh(); }), chipPrincipais(e, () => { e.soPrincipais = !e.soPrincipais; e.mais = 25; refresh(); })),
      tabela, rodapeLista(e, lista.length, Math.min(e.mais, lista.length), refresh),
      lista.length ? PF.barraCompartilhar(() => compartilharNovos(lista, e)) : null));
  }

  function compartilharNovos(lista, e) {
    const filtros = [`Contratos celebrados desde ${dataBR(dados.marco)} com vigência depois de ${dataBR(dados.fimMandato)} (LRF, art. 42); posição em ${dataBR(dados.ref)}`,
      `${nInt.format(lista.length)} contratos, somando ${brlCompacto(soma(lista, (x) => x.anual))} por ano e cerca de ${brlCompacto(soma(lista, (x) => x.alem))} depois de 2026 (estimativa)`,
      [e.tipo && 'Tipo: ' + ROTULO_TIPO[e.tipo], e.soPrincipais && 'Só contratos principais'].filter(Boolean).join(' | '),
      'Sinal para conferir, não conclusão: o saldo de caixa que decide o cumprimento do art. 42 não é público.'].filter(Boolean);
    return { titulo: 'Contratos novos com parcelas depois de 2026', filtros, arquivo: `fim-de-mandato-contratos-novos-${dados.ref}`,
      colunas: [{ t: '#', w: 0.5 }, { t: 'Órgão', w: 2.2 }, { t: 'Fornecedor e objeto', w: 5.5 }, { t: 'Assinado', w: 1.1 }, { t: 'Até', w: 1.1 }, { t: 'Modalidade', w: 1.4 }, { t: 'Por ano', w: 1.2, n: 1 }, { t: 'Após 2026', w: 1.2, n: 1 }],
      linhas: lista.map((x, i) => [i + 1, x.orgNome, `${nomeProprio(x.forn)}: ${cortar(x.objeto, 180)}`, dataBR(x.cel), dataBR(x.fimef), x.modal || '-', brlCompacto(x.anual), brlCompacto(x.alem)]),
      texto: lista.slice(0, 12).map((x, i) => `${i + 1}. ${nomeProprio(x.forn)} (${x.orgNome}) - ${brlCompacto(x.anual)}/ano, até ${dataBR(x.fimef)} - ${cortar(x.objeto, 70)}`).concat(lista.length > 12 ? [`... e mais ${lista.length - 12}. O PDF traz a lista completa.`] : []) };
  }

  const acima25 = (x) => x.valor && x.valorAlt && x.vini && x.valorAlt / x.vini > 0.25;
  function renderAditivos(c) {
    const e = est.aditivos, a = ALERTAS.aditivos;
    const lista = aditivos.filter((x) => (!e.tipo || (e.tipo === 'valor' ? x.valor : x.prazo)) && (!e.soPrincipais || x.principal))
      .sort((p, q) => (e.tipo === 'valor' ? (q.valorAlt || 0) - (p.valorAlt || 0) : q.anual - p.anual));
    const refresh = () => render();
    const acresc = lista.filter((x) => x.valor);
    const kp = el('div', { class: 'kpis' },
      kpi('Aditivos', nInt.format(lista.length), `${nInt.format(lista.filter((x) => x.prazo).length)} de prazo e ${nInt.format(acresc.length)} de valor`),
      kpi('Acréscimos de valor', brlCompacto(soma(acresc, (x) => x.valorAlt || 0)), 'soma dos valores informados no SIGA'),
      kpi('Acima de 25% do inicial', nInt.format(lista.filter(acima25).length), 'acréscimos que passam do limite de referência', 'alerta'));
    const linhas = lista.slice(0, e.mais).map((x) => el('tr', {}, celulaObjeto(x),
      el('td', {}, dataBR(x.data), el('small', {}, x.formal), x.data > dados.ref ? el('small', { class: 'fm-futura', title: 'A data de alteração é posterior à posição dos dados: registro antecipado ou com data de início de efeito.' }, 'data posterior à posição dos dados') : null),
      el('td', {}, [x.prazo ? 'Prazo' : '', x.valor ? 'Valor' : ''].filter(Boolean).join(' e '), x.prazo && x.novoFim ? el('small', {}, 'até ' + dataBR(x.novoFim)) : null),
      el('td', { class: 'num' }, x.valor ? (x.valorAlt != null ? brlCompacto(x.valorAlt) : '—') : '—', x.valor && x.valorAlt && x.vini ? el('small', {}, pct(x.valorAlt / x.vini) + ' do inicial' + (acima25(x) ? ' (acima de 25%)' : '')) : null),
      el('td', { class: 'num' }, brlCompacto(x.anual))));
    const tabela = lista.length ? el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Fornecedor, órgão e objeto', 'Data', 'Tipo', 'Valor do aditivo', 'Contrato por ano'].map((t, n) => el('th', { class: n >= 3 ? 'num' : '' }, t)))),
      el('tbody', {}, linhas))) : el('p', { class: 'vazio' }, 'Nenhum aditivo neste filtro.');
    c.replaceChildren(trilha('Aditivos'), kp, textos(a),
      el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, `Aditivos (${nInt.format(lista.length)})`),
        el('p', {}, e.tipo === 'valor' ? 'Do maior para o menor valor de acréscimo.' : 'Do maior para o menor valor anual do contrato.'))),
      el('div', { class: 'filtro-cond' }, abas(Object.entries(ROTULO_ADIT), e.tipo, (v) => { e.tipo = v; e.mais = 25; refresh(); }), chipPrincipais(e, () => { e.soPrincipais = !e.soPrincipais; e.mais = 25; refresh(); })),
      tabela, rodapeLista(e, lista.length, Math.min(e.mais, lista.length), refresh),
      lista.length ? PF.barraCompartilhar(() => compartilharAditivos(lista, e)) : null));
  }

  function compartilharAditivos(lista, e) {
    const filtros = [`Aditivos de prazo e de valor registrados no SIGA desde ${dataBR(dados.marco)} em contratos vigentes (LRF, art. 42; Lei 14.133, art. 125); posição em ${dataBR(dados.ref)}`,
      `${nInt.format(lista.length)} aditivos; ${nInt.format(lista.filter(acima25).length)} acréscimos acima de 25% do valor inicial`,
      [e.tipo && 'Tipo: ' + ROTULO_ADIT[e.tipo], e.soPrincipais && 'Só contratos principais'].filter(Boolean).join(' | '),
      'Sinal para conferir, não conclusão: prorrogação é rotina em serviços contínuos.'].filter(Boolean);
    return { titulo: 'Aditivos de prazo e de valor desde 1º de maio', filtros, arquivo: `fim-de-mandato-aditivos-${dados.ref}`,
      colunas: [{ t: 'Órgão', w: 2.2 }, { t: 'Fornecedor e objeto', w: 5.5 }, { t: 'Data', w: 1.1 }, { t: 'Tipo', w: 1.2 }, { t: 'Nova vigência', w: 1.2 }, { t: 'Valor do aditivo', w: 1.4, n: 1 }, { t: '% do inicial', w: 1, n: 1 }, { t: 'Contrato/ano', w: 1.3, n: 1 }],
      linhas: lista.map((x) => [x.orgNome, `${nomeProprio(x.forn)}: ${cortar(x.objeto, 160)}`, dataBR(x.data), [x.prazo ? 'Prazo' : '', x.valor ? 'Valor' : ''].filter(Boolean).join(' e '), x.prazo ? dataBR(x.novoFim) : '-',
        x.valor && x.valorAlt != null ? brlCompacto(x.valorAlt) : '-', x.valor && x.valorAlt && x.vini ? pct(x.valorAlt / x.vini) : '-', brlCompacto(x.anual)]),
      texto: lista.slice(0, 12).map((x, i) => `${i + 1}. ${nomeProprio(x.forn)} (${x.orgNome}) - ${[x.prazo ? 'prazo' : '', x.valor ? 'valor' : ''].filter(Boolean).join(' e ')} em ${dataBR(x.data)} - contrato de ${brlCompacto(x.anual)}/ano`).concat(lista.length > 12 ? [`... e mais ${lista.length - 12}. O PDF traz a lista completa.`] : []) };
  }

  // ---------- roteamento ----------
  function render() {
    if (!raiz || !$('#conteudo')) return;
    PF.esconderDica();
    const c = $('#conteudo');
    if (tela === 'novos') renderNovos(c); else if (tela === 'aditivos') renderAditivos(c); else renderInicio(c);
  }
  function aoNavegar(resto) {
    if (!dados) return;
    const r = decodeURIComponent(resto || '');
    tela = r === 'novos' || r === 'aditivos' ? r : '';
    render();
    if (tela) window.scrollTo({ top: 0 });
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Fim de mandato</h2>
          <p class="sub">O que foi assumido nos dois últimos quadrimestres e fica para o próximo governo.</p>
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
    novos = objs(dados.camposNovos, dados.novos);
    aditivos = objs(dados.camposAditivos, dados.aditivos);
    $('#mesref').textContent = 'Referência: ' + dataBR(dados.ref);
    return true;
  }
  function desmontar() { dados = null; novos = []; aditivos = []; }
  PF.registrar({ id: 'fimmandato', titulo: 'Fim de mandato', montar, aoNavegar, desmontar });
})();
