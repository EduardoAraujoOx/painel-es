(() => {
  'use strict';
  // Módulo "Fundos": para cada fundo público do Estado, para onde foram os pagamentos (do maior para o menor valor), o saldo,
  // quando há dado, e um quadro único com a lei: como foi criado, para que serve, como é financiado, o nível de margem do
  // gasto e o link para o texto legal. A leitura de margem é automática (origem do dinheiro e regra do saldo na lei); a lei e o
  // saldo real decidem.
  const { el, nInt, brlCompacto, soma, titulo, rotuloMes } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  let tela = '';
  const detalhes = {};
  const est = { filtro: '', ano: '', visao: 'fav', mais: 10 };

  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: d }) + '%');
  const kpi = (rotulo, valor, nota, tom) => el('div', { class: 'kpi' + (tom ? ' ' + tom : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const nomeDe = (f) => (f.nomeOficial ? f.nomeOficial + (f.sigla ? ` (${f.sigla})` : '') : titulo(f.nome));
  const mesRef = () => rotuloMes(dados.ate, true);
  const saldoDe = (ug) => (dados.saldos || []).find((s) => s.ug === ug);
  const implicitoDe = (f) => (!saldoDe(f.ug) && f.implicito ? f.implicito : null);

  // ---------- margem ----------
  const ROTULO_LEITURA = { mais: 'Maior margem aparente', verificar: 'A verificar na lei', menos: 'Menor margem aparente' };
  const COR_LEITURA = { mais: 'n-a', verificar: 'n-m', menos: 'n-i' };
  const leitura = (f) => f.leitura || 'verificar';
  const seloLeitura = (f) => el('span', { class: 'selo ' + COR_LEITURA[leitura(f)], title: f.leituraNota || 'Leitura automática: origem do dinheiro que o fundo pagou e regra do saldo na lei' }, el('b', {}, ROTULO_LEITURA[leitura(f)]));
  const REVERSAO = {
    permite: 'A lei do fundo, ou a LC 947/2020, permite reverter o superávit financeiro ao Tesouro de forma desvinculada, exceto recursos vinculados por Constituição, lei federal, convênio ou operação de crédito.',
    nao: 'A lei manda o saldo passar ao exercício seguinte a crédito do próprio fundo; reverter ao Tesouro exigiria mudar a lei.',
    condicionada: 'A lei só permite reverter ou resgatar saldo sob condições específicas.',
    informa: 'O texto levantado não trata da reversão do saldo ao Tesouro; confirme com a PGE.',
  };
  const FONTE_FRASE = {
    livre: 'recursos do Tesouro sem vinculação', federal: 'transferências da União com finalidade definida', royalties: 'royalties e compensações da União',
    propria: 'receita própria vinculada ao fundo ou à lei', credito: 'operações de crédito e venda de bens', prev: 'fonte previdenciária', outras: 'outras vinculações',
  };
  const NAT_FRASE = {
    pessoal: 'pessoal e encargos (despesa obrigatória)', custeio: 'custeio de aplicação direta', transf_mun: 'transferências a municípios', transf_priv: 'transferências a instituições privadas',
    transf_out: 'outras transferências', invest: 'investimento', inversoes: 'inversão financeira',
  };
  function frasesMargem(f) {
    const a = f.anos[f.ref] || {}, t = a.total || 0, saida = [];
    if (t >= 100000) {
      const fo = Object.entries(a.fonte || {}).sort((x, y) => y[1] - x[1])[0];
      const na = Object.entries(a.nat || {}).sort((x, y) => y[1] - x[1])[0];
      if (fo) saida.push(`Em ${f.ref}, ${pct(fo[1] / t)} do que o fundo pagou veio de ${FONTE_FRASE[fo[0]] || fo[0]}.`);
      if (na) saida.push(`${pct(na[1] / t)} foi ${NAT_FRASE[na[0]] || na[0]}.`);
    } else saida.push(`O fundo pagou pouco em ${f.ref} (${brlCompacto(t)}).`);
    if (f.reversao && REVERSAO[f.reversao]) saida.push(REVERSAO[f.reversao]);
    return saida;
  }
  // corta um texto longo no fim de uma frase (ou de uma palavra, com reticências) e guarda o texto inteiro num "ver texto completo"
  function resumir(txt, max) {
    const t = String(txt || '').trim().replace(/\s+/g, ' ');
    if (t.length <= max) return [t, ''];
    const corte = t.slice(0, max);
    const i = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('; '));
    if (i > max * 0.45) return [t.slice(0, i + 1).trim(), t];
    return [corte.slice(0, corte.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…', t];
  }
  const bloco = (rotulo, txt, max = 330) => {
    if (!txt) return null;
    const [curto, inteiro] = resumir(txt, max);
    return el('div', { class: 'lac-bloco' }, el('h4', {}, rotulo), el('p', {}, curto), inteiro ? el('details', { class: 'fm-detalhes' }, el('summary', {}, 'Ver texto completo'), el('p', {}, inteiro)) : null);
  };

  // ---------- tela inicial ----------
  const FILTROS = [['', 'Todos'], ['mais', ROTULO_LEITURA.mais], ['verificar', ROTULO_LEITURA.verificar], ['menos', ROTULO_LEITURA.menos], ['reverte', 'Lei permite reverter o saldo']];
  function filtrar() {
    const f = est.filtro;
    return dados.fundos.filter((x) => !f || (f === 'reverte' ? x.reversao === 'permite' : leitura(x) === f));
  }
  const textoSaldo = (f) => {
    const s = saldoDe(f.ug), i = implicitoDe(f);
    if (s) return brlCompacto(s.valor);
    if (i) return el('span', { class: 'estimado', title: `Estimativa em ordem de grandeza: rendimento de aplicações de ${i.ano} (${brlCompacto(i.rend)}) dividido pela Selic média do ano (${i.taxa.toLocaleString('pt-BR')}% a.a.). Tende a subestimar.` }, '≈ ' + brlCompacto(i.valor));
    return el('span', { class: 'mudo' }, 'não público');
  };

  function cartaoCaixa() {
    const r = dados.caixaRGF;
    if (!r) return null;
    const lin = (l) => el('tr', l.destaque ? { class: 'destaque' } : {}, el('td', { class: /^\s/.test(l.rotulo) ? 'recuo' : '' }, l.rotulo.trim()), el('td', { class: 'num' }, brlCompacto(l.bruta)), el('td', { class: 'num' }, brlCompacto(l.liquida)));
    return el('details', { class: 'cartao fm-detalhes' }, el('summary', {}, 'O que o Estado tem em caixa, por tipo de recurso (RGF)'),
      el('p', { class: 'sub' }, `Relatório de Gestão Fiscal, Anexo 5, posição em ${dataBR(r.data)}. Não separa fundo por fundo, então serve de pano de fundo, não de saldo de cada fundo. A linha "vinculados a fundos" é pequena diante do que os fundos pagam num ano.`),
      el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Tipo de recurso'), el('th', { class: 'num' }, 'Caixa bruta'), el('th', { class: 'num' }, 'Disponível após obrigações'))), el('tbody', {}, r.linhas.map(lin)))),
      el('p', { class: 'fm-nota' }, el('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Abrir o relatório')));
  }

  function renderInicio(c) {
    const lista = filtrar();
    const ult = dados.anoCorrente, ant = String(+ult - 1);
    const pagoRef = soma(dados.fundos, (f) => (f.anos[ant] ? f.anos[ant].total : 0));
    const livre = soma(dados.fundos, (f) => (f.anos[ant] ? f.anos[ant].fonte.livre || 0 : 0));
    const saldos = dados.saldos || [];
    const estimados = dados.fundos.filter((f) => implicitoDe(f));
    const kp = el('div', { class: 'kpis' },
      kpi('Fundos em análise', nInt.format(dados.fundos.length), `${nInt.format(dados.fora.length)} ficaram fora, com o motivo`),
      kpi(`Pago em ${ant}`, brlCompacto(pagoRef), 'pago mais restos a pagar pagos'),
      kpi('Vindo do Tesouro, sem vinculação', brlCompacto(livre), `${pct(livre / pagoRef)} do pago em ${ant}`, 'alerta'),
      kpi('Saldo conhecido', saldos.length ? brlCompacto(soma(saldos, (s) => s.valor)) : '—', `${saldos.map((s) => s.sigla).join(', ')}; nos outros ${nInt.format(estimados.length)} com rendimento, estimado em ≈ ${brlCompacto(soma(estimados, (f) => f.implicito.valor))}`));
    const linhas = lista.map((f) => {
      const a = f.anos[f.ref] || {}, b = f.anos[ult] || {};
      return el('tr', { class: 'fundo-linha', tabindex: '0', role: 'link', onclick: () => ctx.irPara(f.ug), onkeydown: (ev) => { if (ev.key === 'Enter') ctx.irPara(f.ug); } },
        el('td', { class: 'objeto' }, el('strong', {}, nomeDe(f)), el('small', {}, [f.leiCriacao, 'UG ' + f.ug].filter(Boolean).join(' · '))),
        el('td', { class: 'num' }, a.total ? brlCompacto(a.total) : '—', el('small', {}, f.ref !== ant ? 'em ' + f.ref : '')),
        el('td', { class: 'num' }, b.total ? brlCompacto(b.total) : '—'),
        el('td', { class: 'num' }, textoSaldo(f)),
        el('td', {}, seloLeitura(f)));
    });
    const cartoes = lista.map((f) => {
      const a = f.anos[f.ref] || {}, b = f.anos[ult] || {};
      return el('button', { type: 'button', class: 'fundo-cartao', onclick: () => ctx.irPara(f.ug) },
        el('strong', {}, nomeDe(f)), el('small', {}, [f.leiCriacao, 'UG ' + f.ug].filter(Boolean).join(' · ')),
        el('span', { class: 'fundo-nums' }, el('span', {}, el('b', {}, a.total ? brlCompacto(a.total) : '—'), ` em ${f.ref}`), el('span', {}, el('b', {}, b.total ? brlCompacto(b.total) : '—'), ` em ${ult}`)),
        el('span', { class: 'fundo-nums' }, el('span', {}, 'Saldo ', el('b', {}, textoSaldo(f))), seloLeitura(f)));
    });
    const tabela = !lista.length ? el('p', { class: 'vazio' }, 'Nenhum fundo neste filtro.') : PF.telaEstreita() ? el('div', { class: 'fundos-lista' }, cartoes)
      : el('div', { class: 'rolagem' }, el('table', { class: 'tabela-fundos' }, el('thead', {}, el('tr', {}, [`Fundo`, `Pago em ${ant}`, `Pago em ${ult} até ${mesRef()}`, 'Saldo (≈ estimado)', 'Margem aparente'].map((t, n) => el('th', { class: n === 1 || n === 2 || n === 3 ? 'num' : '' }, t)))), el('tbody', {}, linhas)));
    const fora = el('details', { class: 'fm-detalhes' }, el('summary', {}, `O que ficou fora da análise (${nInt.format(dados.fora.length)} fundos) e por quê`),
      Object.keys(dados.rotuloFora).map((g) => {
        const fs = dados.fora.filter((x) => x.grupo === g);
        if (!fs.length) return null;
        return el('div', { class: 'lac-bloco' }, el('h4', {}, `${dados.rotuloFora[g]} · ${brlCompacto(soma(fs, (x) => x.total[ant] || 0))} pagos em ${ant}`), el('p', {}, fs[0].motivo), el('p', { class: 'mudo' }, fs.map((x) => titulo(x.nome)).join('; ') + '.'));
      }));
    c.replaceChildren(...[
      el('p', { class: 'fm-intro' }, 'Para cada fundo, para onde foram os pagamentos, o saldo (quando há dado) e um resumo da lei. A "margem aparente" combina a origem do dinheiro que o fundo paga e o que a lei diz sobre o saldo: é um ponto de partida, não uma conclusão. Fundos previdenciários, o da Saúde e os de outros Poderes ficam fora, porque o Executivo não tem margem sobre eles.'),
      kp,
      el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, `Fundos (${nInt.format(lista.length)})`), el('p', {}, 'Do maior para o menor valor pago. Clique em um fundo para ver os pagamentos, o saldo e a lei.'))),
        el('div', { class: 'filtro-cond' }, el('div', { class: 'abas', role: 'group' }, FILTROS.map(([v, r]) => el('button', { type: 'button', 'aria-pressed': String(v === est.filtro), onclick: () => { est.filtro = v; render(); } }, r)))),
        tabela, lista.length ? PF.barraCompartilhar(() => compartilharLista(lista)) : null),
      cartaoCaixa(), fora, el('p', { class: 'fm-nota' }, `Fonte: ${dados.fonteDados}. Valores até ${mesRef()}.`)].filter(Boolean));
  }

  function compartilharLista(lista) {
    const ult = dados.anoCorrente, ant = String(+ult - 1);
    const filtros = [`Fundos públicos do Estado do ES: pago (mais restos a pagar pagos) em ${ant} e em ${ult} até ${mesRef()}, saldo e margem aparente`,
      est.filtro ? 'Filtro: ' + FILTROS.find((x) => x[0] === est.filtro)[1] : '',
      'Margem aparente é leitura automática (origem do dinheiro e regra do saldo na lei); não substitui a leitura da lei. Saldo com ≈ é estimado pelos rendimentos. Ficaram fora fundos previdenciários, o da Saúde e os de outros Poderes.'].filter(Boolean);
    return { titulo: 'Fundos públicos: pagamentos, saldo e margem', filtros, arquivo: `fundos-${dados.ate}`,
      colunas: [{ t: 'Fundo', w: 5 }, { t: 'Lei', w: 1.8 }, { t: `Pago ${ant}`, w: 1.3, n: 1 }, { t: `Pago ${ult}`, w: 1.3, n: 1 }, { t: 'Saldo', w: 1.5, n: 1 }, { t: 'Margem aparente', w: 2.2 }],
      linhas: lista.map((f) => { const a = f.anos[f.ref] || {}, b = f.anos[ult] || {}, s = saldoDe(f.ug), i = implicitoDe(f);
        return [nomeDe(f), f.leiCriacao || '-', a.total ? brlCompacto(a.total) : '-', b.total ? brlCompacto(b.total) : '-', s ? brlCompacto(s.valor) : i ? 'aprox. ' + brlCompacto(i.valor) + ' (est.)' : 'nao publico', ROTULO_LEITURA[leitura(f)]]; }),
      texto: lista.slice(0, 10).map((f, k) => `${k + 1}. ${nomeDe(f)} - ${brlCompacto((f.anos[f.ref] || {}).total || 0)} em ${f.ref}`).concat(lista.length > 10 ? [`... e mais ${lista.length - 10}. O PDF traz a lista completa.`] : []) };
  }

  // ---------- página de um fundo ----------
  function trilha(rotulo) {
    return el('div', { class: 'trilha' }, el('button', { type: 'button', onclick: () => ctx.irPara('') }, 'Fundos'), el('span', { class: 'sep' }, '›'), el('span', { class: 'atual' }, rotulo));
  }

  // linhas ordenadas da visão escolhida (quem recebeu ou o que financiou), com o "resto" em linhas à parte
  function linhasPagamento(a, visao) {
    if (visao === 'acao') {
      return { itens: a.acao.map(([p, ac, v]) => ({ nome: titulo(ac), sub: titulo(p), v })), extras: a.acaoResto > 0.5 ? [{ nome: 'Demais ações', v: a.acaoResto }] : [] };
    }
    const extras = [];
    if (a.favResto.valor > 0.5) extras.push({ nome: `Outros ${nInt.format(a.favResto.n)} favorecidos (empresas e órgãos)`, v: a.favResto.valor });
    if (a.pf > 0.5) extras.push({ nome: 'Pessoas físicas e pagamentos sem empresa ou órgão identificado', v: a.pf });
    return { itens: a.fav.map(([tp, nm, v]) => ({ nome: titulo(nm), sub: tp === 'Órgão ou entidade' ? tp : '', v })), extras };
  }

  function cartaoPagamentos(f, d) {
    const anos = Object.keys(d.anos).sort();
    if (!est.ano || !d.anos[est.ano]) est.ano = d.anos[f.ref] ? f.ref : anos[anos.length - 1];
    const a = d.anos[est.ano], ult = dados.anoCorrente;
    const seletor = el('div', { class: 'abas', role: 'group' }, anos.map((y) => el('button', { type: 'button', 'aria-pressed': String(y === est.ano), onclick: () => { est.ano = y; est.mais = 10; render(); } }, y === ult ? `${y} até ${rotuloMes(dados.ate)}` : y)));
    const visoes = el('div', { class: 'abas', role: 'group' }, [['fav', 'Quem recebeu'], ['acao', 'O que financiou']].map(([v, r]) => el('button', { type: 'button', 'aria-pressed': String(v === est.visao), onclick: () => { est.visao = v; est.mais = 10; render(); } }, r)));
    const { itens, extras } = linhasPagamento(a, est.visao);
    const tot = a.total || 1;
    const mostrados = itens.slice(0, est.mais);
    const linhas = mostrados.map((i, k) => el('tr', {}, el('td', { class: 'num' }, String(k + 1)), el('td', { class: 'objeto' }, el('strong', {}, i.nome), i.sub ? el('small', {}, i.sub) : null), el('td', { class: 'num' }, brlCompacto(i.v)), el('td', { class: 'num' }, pct(i.v / tot, i.v / tot < 0.1 ? 1 : 0))));
    const resto = extras.map((i) => el('tr', { class: 'extra' }, el('td', {}), el('td', { class: 'objeto' }, i.nome), el('td', { class: 'num' }, brlCompacto(i.v)), el('td', { class: 'num' }, pct(i.v / tot, 1))));
    const tabela = a.total > 0.5 ? el('div', { class: 'rolagem' }, el('table', { class: 'tabela-pagamentos' },
      el('thead', {}, el('tr', {}, ['#', est.visao === 'fav' ? 'Favorecido' : 'Ação do orçamento (programa)', 'Pago', '% do total'].map((t, n) => el('th', { class: n === 0 || n >= 2 ? 'num' : '' }, t)))),
      el('tbody', {}, linhas, itens.length > est.mais ? null : resto), el('tfoot', {}, el('tr', {}, el('td', {}), el('td', {}, 'Total pago'), el('td', { class: 'num' }, brlCompacto(a.total)), el('td', { class: 'num' }, '100%'))))) : el('p', { class: 'vazio' }, 'O fundo não fez pagamentos neste período.');
    const rodape = itens.length > est.mais ? el('div', { class: 'rodape-tabela' }, el('span', {}, `Mostrando ${nInt.format(est.mais)} de ${nInt.format(itens.length)} linhas`),
      el('button', { type: 'button', class: 'botao', onclick: () => { est.mais += 20; render(); } }, 'Mostrar mais')) : null;
    return el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Para onde foram os pagamentos'),
      el('p', {}, `Do maior para o menor valor, em ${est.ano === ult ? `${est.ano} até ${mesRef()}` : est.ano}. Pago mais restos a pagar pagos.`))),
      el('div', { class: 'filtro-cond' }, seletor, visoes), tabela, rodape);
  }

  function cartaoSaldo(f, d) {
    const s = saldoDe(f.ug), i = implicitoDe(f);
    const ant = String(+dados.anoCorrente - 1), ra = (d.anos[ant] || {}).rec;
    const fluxo = ra ? `Em ${ant}, o fundo arrecadou ${brlCompacto(ra.arrec)} em receita própria e pagou ${brlCompacto(d.anos[ant].total)}. ` : '';
    if (s) {
      return el('div', { class: 'cartao' }, el('h2', {}, 'Saldo'), el('p', { class: 'sub' }, `${s.rotulo}, posição em ${dataBR(s.data)}. ${s.fonte}`),
        el('div', { class: 'kpis' }, kpi('Superávit financeiro', brlCompacto(s.valor), 'ativo financeiro menos passivo financeiro'), ...s.detalhes.map((x) => kpi(x[0], brlCompacto(x[1]), x[2] || ''))),
        el('p', { class: 'fm-nota' }, fluxo, el('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'Abrir as demonstrações contábeis'), s.nota ? ' · ' + s.nota : ''));
    }
    if (i) {
      const v = (dados.validacaoImplicito || [])[0];
      return el('div', { class: 'cartao' }, el('h2', {}, 'Saldo'), el('p', { class: 'sub' }, 'O saldo deste fundo não é publicado nos dados abertos. Os rendimentos de aplicações financeiras que ele arrecada dão uma pista do tamanho do dinheiro aplicado.'),
        el('div', { class: 'kpis' }, kpi(`Rendimentos de aplicações em ${i.ano}`, brlCompacto(i.rend), 'receita patrimonial, valores mobiliários'),
          kpi('Saldo aplicado estimado', '≈ ' + brlCompacto(i.valor), `rendimento dividido pela Selic média de ${i.ano} (${i.taxa.toLocaleString('pt-BR')}% a.a.)`, 'alerta')),
        el('p', { class: 'fm-nota' }, fluxo, 'É ordem de grandeza, não o saldo: supõe que todo o dinheiro rendeu a Selic o ano inteiro. ',
          v ? `No Fundo Soberano, o único com saldo conhecido, a mesma conta deu ${pct(v.razao)} do saldo real (${brlCompacto(v.estimado)} contra ${brlCompacto(v.real)} em ${dataBR(v.data)}), então tende a subestimar. ` : '', 'O saldo e a disponibilidade de caixa por fundo estão em Informações a solicitar.'));
    }
    return el('div', { class: 'cartao fm-fora' }, el('h3', {}, 'Saldo'),
      el('p', {}, fluxo + 'O saldo deste fundo não é publicado nos dados abertos, e o rendimento das aplicações que ele arrecada é pequeno demais para estimá-lo. É o dado que decide se há dinheiro parado para realocar, e está em Informações a solicitar.'));
  }

  function cartaoLei(f, d) {
    const cad = d.cadastro;
    if (!cad) {
      return el('div', { class: 'cartao' }, el('h2', {}, 'O fundo e a lei'), el('p', { class: 'vazio' }, 'A base legal deste fundo ainda não foi levantada no painel. Consulte a lei de criação na Assembleia Legislativa.'));
    }
    const links = (cad.links || []).filter((l) => l.url);
    return el('div', { class: 'cartao' }, el('h2', {}, 'O fundo e a lei'),
      el('p', { class: 'sub' }, 'Resumo do texto legal, levantado em fontes oficiais. Confira o texto no link antes de qualquer decisão.'),
      bloco('Como foi criado', cad.leiCriacaoCompleta || cad.leiCriacao, 260),
      (cad.alteracoes || []).length ? el('details', { class: 'fm-detalhes' }, el('summary', {}, 'Alterações da lei'), el('ul', { class: 'lista-simples' }, cad.alteracoes.map((x) => el('li', {}, x)))) : null,
      bloco('Para que serve', cad.finalidade),
      bloco('Como é financiado', cad.receitas),
      el('div', { class: 'lac-bloco' }, el('h4', {}, 'Nível de margem do gasto'),
        el('p', {}, frasesMargem(f).join(' ')), f.leituraNota ? el('p', { class: 'fm-nota' }, f.leituraNota) : null,
        cad.vinculacao ? el('details', { class: 'fm-detalhes' }, el('summary', {}, 'Vinculação e quem pode alterar, segundo a lei'), el('p', {}, cad.vinculacao)) : null),
      links.length ? el('div', { class: 'lac-bloco' }, el('h4', {}, 'Legislação'), el('p', { class: 'links-lei' }, links.map((l, k) => el('a', { href: l.url, target: '_blank', rel: 'noopener', class: k === 0 ? 'botao-primario' : '' }, l.rotulo)))) : null,
      cad.lacunas ? el('details', { class: 'fm-detalhes' }, el('summary', {}, `A confirmar (confiança do levantamento: ${cad.confianca || '—'})`), el('p', {}, cad.lacunas)) : null);
  }

  function renderFundo(c, f, d) {
    const ult = dados.anoCorrente, ant = String(+ult - 1);
    const refA = d.anos[ant], curA = d.anos[ult], s = saldoDe(f.ug), i = implicitoDe(f);
    const cab = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, nomeDe(f)), el('p', {}, [f.leiCriacao, 'unidade gestora ' + f.ug].filter(Boolean).join(' · '))), seloLeitura(f)),
      el('div', { class: 'kpis kpis-fundo' }, kpi(`Pago em ${ant}`, refA ? brlCompacto(refA.total) : '—', 'pago mais restos a pagar pagos'), kpi(`Pago em ${ult} até ${mesRef()}`, curA ? brlCompacto(curA.total) : '—', ''),
        kpi('Saldo', s ? brlCompacto(s.valor) : i ? '≈ ' + brlCompacto(i.valor) : 'não público', s ? 'superávit financeiro em ' + dataBR(s.data) : i ? 'estimado pelos rendimentos' : 'pedido em Informações a solicitar', s ? '' : 'alerta')));
    c.replaceChildren(trilha(nomeDe(f)), cab, cartaoPagamentos(f, d), cartaoSaldo(f, d), cartaoLei(f, d),
      PF.barraCompartilhar(() => compartilharFundo(f, d)), el('p', { class: 'fm-nota' }, `Fonte: ${dados.fonteDados}. Valores até ${mesRef()}.`));
  }

  function compartilharFundo(f, d) {
    const ult = dados.anoCorrente, ant = String(+ult - 1), a = d.anos[est.ano] || {}, cad = d.cadastro || {}, s = saldoDe(f.ug), i = implicitoDe(f);
    const { itens, extras } = linhasPagamento(a, est.visao);
    const linhas = [];
    const sec = (nome, lista) => lista.forEach(([it, v], k) => linhas.push([k ? '' : nome, it, v]));
    sec('Visao geral', [[`Pago em ${ant}`, d.anos[ant] ? brlCompacto(d.anos[ant].total) : '-'], [`Pago em ${ult} ate ${mesRef()}`, d.anos[ult] ? brlCompacto(d.anos[ult].total) : '-'],
      ['Saldo', s ? `${brlCompacto(s.valor)} em ${dataBR(s.data)}` : i ? `aprox. ${brlCompacto(i.valor)} (estimado pelos rendimentos; o saldo nao e publico)` : 'nao publicado (pedir ao Estado)'], ['Margem aparente', ROTULO_LEITURA[leitura(f)]]]);
    sec(`${est.visao === 'fav' ? 'Quem recebeu' : 'O que financiou'} em ${est.ano}`, [...itens.slice(0, 40).map((x) => [x.nome, `${brlCompacto(x.v)} (${pct(x.v / (a.total || 1), 1)})`]), ...extras.map((x) => [x.nome, brlCompacto(x.v)])]);
    if (cad.leiCriacao) sec('A lei', [['Criacao', cad.leiCriacaoCompleta || cad.leiCriacao], ['Finalidade', resumir(cad.finalidade, 400)[0]], ['Financiamento', resumir(cad.receitas, 400)[0]], ['Margem do gasto', frasesMargem(f).join(' ')]]);
    return { titulo: `Fundo: ${nomeDe(f)}`, paisagem: false, arquivo: `fundo-${f.ug}-${dados.ate}`,
      filtros: [`${nomeDe(f)} (unidade gestora ${f.ug}); valores em pago mais restos a pagar pagos, ate ${mesRef()}`, 'Margem aparente e saldo estimado sao leituras automaticas; nao substituem a leitura da lei nem o saldo real.'],
      colunas: [{ t: 'Secao', w: 2 }, { t: 'Item', w: 5 }, { t: 'Valor', w: 5 }], linhas,
      texto: [`${nomeDe(f)}: pago ${brlCompacto((d.anos[ant] || {}).total || 0)} em ${ant}. ${ROTULO_LEITURA[leitura(f)]}.`, 'O PDF traz para onde foram os pagamentos, o saldo e o resumo da lei.'] };
  }

  // ---------- roteamento ----------
  function render() {
    if (!raiz || !$('#conteudo')) return;
    PF.esconderDica();
    const c = $('#conteudo');
    if (!tela) { renderInicio(c); return; }
    const f = dados.fundos.find((x) => x.ug === tela);
    if (!f) { renderInicio(c); return; }
    if (detalhes[tela]) { renderFundo(c, f, detalhes[tela]); return; }
    c.replaceChildren(el('p', { class: 'vazio', role: 'status' }, 'Carregando o fundo…'));
    ctx.api('f/' + tela).then((d) => { detalhes[tela] = d; if (tela === f.ug) render(); }).catch((e) => {
      if (e.sessao) { PF.mostrarLogin(); return; }
      c.replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar os dados deste fundo.'));
    });
  }
  function aoNavegar(resto) {
    if (!dados) return;
    const nova = decodeURIComponent(resto || '');
    if (nova !== tela) { est.ano = ''; est.mais = 10; est.visao = 'fav'; }
    tela = nova;
    render();
    if (tela) window.scrollTo({ top: 0 });
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Fundos</h2>
          <p class="sub">Para onde vão os pagamentos de cada fundo público, o saldo e o que a lei diz.</p>
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
    $('#mesref').textContent = 'Dados até ' + mesRef();
    return true;
  }
  function desmontar() { dados = null; for (const k of Object.keys(detalhes)) delete detalhes[k]; }
  PF.registrar({ id: 'fundos', titulo: 'Fundos', montar, aoNavegar, desmontar });
})();
