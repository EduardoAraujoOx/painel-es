(() => {
  'use strict';
  // Módulo "Fundos": raio-x dos fundos públicos do Estado. Para cada fundo, de onde vem o dinheiro que ele paga (fonte de recursos),
  // o que ele paga, quanto arrecada, o que a lei diz sobre usá-lo e se há saldo conhecido. Serve para apontar onde pode haver
  // margem para realocar recursos e onde não há. Os sinais são leituras automáticas dos dados; a lei e o saldo decidem.
  const { el, nInt, brlCompacto, soma, titulo, rotuloMes } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  let tela = '';
  const detalhes = {};
  const est = { filtro: '', ano: '' };

  const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: d }) + '%');
  const kpi = (rotulo, valor, nota, tom) => el('div', { class: 'kpi' + (tom ? ' ' + tom : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const nomeDe = (f) => (f.nomeOficial ? f.nomeOficial + (f.sigla ? ` (${f.sigla})` : '') : titulo(f.nome));
  const mesRef = () => rotuloMes(dados.ate, true);

  // ---------- sinais: rótulo curto e explicação ----------
  const SINAIS = {
    tesouro: ['Tesouro, sem vinculação', () => 'Mais da metade do que o fundo pagou veio de fontes não vinculadas (impostos livres). O fundo funciona como caixa do Tesouro, e a destinação final decorre da lei orçamentária. É o sinal de maior margem aparente.'],
    federal: ['Transferência federal', () => 'Mais da metade veio de transferências da União com finalidade definida (SUS, assistência, segurança pública, cultura). A margem tende a ser baixa: mudar o destino exige o aval do concedente.'],
    royalties: ['Royalties da União', () => 'Mais da metade veio de royalties, compensações financeiras ou cessão onerosa da União. O uso desses recursos é restringido por lei federal; confira a regra aplicável antes de qualquer realocação.'],
    propria: ['Receita própria vinculada', () => 'Mais da metade veio de receita que a lei destina ao fundo (taxas, multas, contribuições). A margem depende do que a lei de criação permite e, em geral, de projeto de lei para mudar a destinação.'],
    pessoal: ['Despesa de pessoal', () => 'Mais da metade do pago é pessoal e encargos, que é despesa de execução obrigatória e difícil de reduzir.'],
    flexivel: ['Despesa programável', () => 'Mais da metade é investimento, inversão financeira ou transferência, despesas que dependem de programação e podem ser reorientadas, desde que a finalidade legal do fundo permita.'],
    rap: ['Restos a pagar altos', () => `Um quarto ou mais do pago no ano veio de empenhos de anos anteriores (restos a pagar). Sinal de execução defasada: confira se os compromissos antigos ainda são devidos.`],
    acumula: ['Arrecada mais do que gasta', () => 'A arrecadação própria do ano foi pelo menos 20% maior do que o pago. Sinal de possível acúmulo de saldo, a confirmar com o saldo do fundo, que não é público.'],
    abastecido: ['Depende do Tesouro', () => 'A arrecadação própria cobriu até metade do pago; o restante chega por transferência financeira do Tesouro, que não aparece como receita do fundo. O fundo depende do caixa do Tesouro, o que indica menor autonomia de caixa e mais margem para reordenar.'],
  };
  const sinalSelo = (s) => el('span', { class: 'selo sinal-' + s, title: SINAIS[s][1]() }, SINAIS[s][0]);

  // saldo segundo a lei (campo "reversao" do cadastro, lido pelo painel no texto levantado)
  const REVERSAO = {
    permite: ['Lei permite reverter o saldo', 'A lei do fundo, ou a LC 947/2020, permite reverter o superávit financeiro ao Tesouro de forma desvinculada, exceto recursos vinculados por Constituição, lei federal, convênio ou operação de crédito.'],
    nao: ['Saldo fica no fundo', 'A lei manda o saldo passar ao exercício seguinte a crédito do próprio fundo. Reverter ao Tesouro exigiria mudar a lei.'],
    condicionada: ['Reversão condicionada', 'A lei só permite reverter ou resgatar saldo sob condições específicas, descritas na base legal.'],
    informa: ['Lei não trata do saldo', 'O texto levantado não prevê reversão ao Tesouro nem a descarta; confirme com a PGE.'],
  };
  const reversaoSelo = (r) => (REVERSAO[r] ? el('span', { class: 'selo reversao-' + r, title: REVERSAO[r][1] }, REVERSAO[r][0]) : null);
  const leitura = (f) => f.leitura || 'verificar';
  const ROTULO_LEITURA = { mais: 'Maior margem aparente', verificar: 'A verificar na lei', menos: 'Menor margem aparente' };
  const COR_LEITURA = { mais: 'n-a', verificar: 'n-m', menos: 'n-i' };

  // ---------- mini barra de origem do dinheiro (3 grupos, 3 cores da paleta) ----------
  const GRUPOS = [
    ['livre', 'Tesouro, sem vinculação', 'var(--serie-2)', ['livre']],
    ['uniao', 'Transferências da União', 'var(--serie-1)', ['federal', 'royalties']],
    ['proprio', 'Receita própria e outras', 'var(--serie-3)', ['propria', 'credito', 'prev', 'outras']],
  ];
  function minibarra(fonte) {
    const t = soma(Object.values(fonte), (x) => Math.max(0, x));
    if (!t) return el('span', { class: 'mix vazio' });
    const partes = GRUPOS.map(([, r, cor, chaves]) => [r, cor, soma(chaves, (k) => Math.max(0, fonte[k] || 0)) / t]);
    return el('span', { class: 'mix', role: 'img', 'aria-label': partes.map(([r, , v]) => `${r}: ${pct(v)}`).join('; '), title: partes.map(([r, , v]) => `${r}: ${pct(v)}`).join('\n') },
      partes.filter(([, , v]) => v > 0.004).map(([, cor, v]) => el('i', { style: `flex:${v};background:${cor}` })));
  }
  const legendaMix = () => el('div', { class: 'legenda' }, GRUPOS.map(([, r, cor]) => el('span', {}, el('i', { class: 'chave-caixa', style: `background:${cor}` }), r)));

  // ---------- barras horizontais ordenadas (valores) ----------
  function barras(itens, tomar) {
    const lista = itens.filter((i) => i.v > 0.5).sort((a, b) => b.v - a.v);
    if (!lista.length) return el('p', { class: 'vazio' }, 'Sem valores no período.');
    const max = Math.max(...lista.map((i) => i.v)), tot = soma(lista, (i) => i.v);
    return el('div', { class: 'linhas' }, lista.map((i) => el('div', { class: 'linha-barra sem-clique' },
      el('span', { class: 'nome' }, i.nome, i.sub ? el('small', {}, i.sub) : null),
      el('span', { class: 'trilho' }, el('i', { class: 'barra', style: `width:${Math.max(0.5, (i.v / max) * 62)}%` }),
        el('span', { class: 'num' }, `${brlCompacto(i.v)} · ${pct(i.v / tot)}`)))));
  }

  // ---------- tela inicial ----------
  const ordemRef = (f) => (f.anos[f.ref] ? f.anos[f.ref].total : 0);
  function filtrar() {
    const f = est.filtro;
    return dados.fundos.filter((x) => !f || (f === 'tesouro' && x.sinais.includes('tesouro')) || (f === 'uniao' && (x.sinais.includes('federal') || x.sinais.includes('royalties')))
      || (f === 'propria' && x.sinais.includes('propria')) || (f === 'acumula' && x.sinais.includes('acumula')) || (f === 'saldo' && saldoDe(x.ug)) || (f === 'reverte' && x.reversao === 'permite'));
  }
  const saldoDe = (ug) => (dados.saldos || []).find((s) => s.ug === ug);
  const implicitoDe = (f) => (!saldoDe(f.ug) && f.implicito ? f.implicito : null);
  const celulaSaldo = (f) => {
    const s = saldoDe(f.ug), i = implicitoDe(f);
    if (s) return brlCompacto(s.valor);
    if (i) return el('span', { class: 'estimado', title: `Estimativa em ordem de grandeza: rendimento de aplicações de ${i.ano} (${brlCompacto(i.rend)}) dividido pela Selic média do ano (${i.taxa.toLocaleString('pt-BR')}% a.a.). Tende a subestimar.` }, '≈ ' + brlCompacto(i.valor));
    return el('span', { class: 'mudo' }, 'não público');
  };
  const FILTROS = [['', 'Todos'], ['tesouro', 'Tesouro sem vinculação'], ['uniao', 'Transferência da União'], ['propria', 'Receita própria'], ['acumula', 'Arrecada mais do que gasta'], ['reverte', 'Lei permite reverter o saldo'], ['saldo', 'Com saldo conhecido']];

  function cartaoCaixa() {
    const r = dados.caixaRGF;
    if (!r) return null;
    const lin = (rotulo, v, destaque) => el('tr', destaque ? { class: 'destaque' } : {}, el('td', { class: /^\s/.test(rotulo) ? 'recuo' : '' }, rotulo.trim()), el('td', { class: 'num' }, brlCompacto(v.bruta)), el('td', { class: 'num' }, brlCompacto(v.liquida)));
    return el('div', { class: 'cartao' },
      el('h2', {}, 'O que o Estado tem em caixa, por tipo de recurso'),
      el('p', { class: 'sub' }, `Relatório de Gestão Fiscal, Anexo 5, posição em ${dataBR(r.data)}. A destinação do recurso não separa fundo por fundo, então serve de pano de fundo, não de saldo de cada fundo.`),
      el('div', { class: 'rolagem' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Tipo de recurso'), el('th', { class: 'num' }, 'Caixa bruta'), el('th', { class: 'num' }, 'Disponível após obrigações'))),
        el('tbody', {}, r.linhas.map((l) => lin(l.rotulo, l, l.destaque))))),
      el('p', { class: 'fm-nota' }, 'O total dos recursos vinculados a fundos (exceto educação, saúde, assistência e previdência) é pequeno diante do que os fundos pagam num ano, o que sugere que a maioria opera por fluxo, e não por estoque. O saldo de cada fundo, que decide se há o que realocar, não é público: está em Informações a solicitar. ',
        el('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Abrir o relatório')));
  }

  function renderInicio(c) {
    const lista = filtrar();
    const ult = dados.anoCorrente, ant = String(+ult - 1);
    const pagoRef = soma(dados.fundos, (f) => (f.anos[ant] ? f.anos[ant].total : 0));
    const pagoAtual = soma(dados.fundos, (f) => (f.anos[ult] ? f.anos[ult].total : 0));
    const livre = soma(dados.fundos, (f) => (f.anos[ant] ? f.anos[ant].fonte.livre || 0 : 0));
    const grupo = (g) => dados.fundos.filter((f) => leitura(f) === g);
    const saldos = dados.saldos || [];
    const estimados = dados.fundos.filter((f) => implicitoDe(f));
    const kp = el('div', { class: 'kpis' },
      kpi('Fundos em análise', nInt.format(dados.fundos.length), `${nInt.format(dados.fora.length)} ficaram fora da análise, com o motivo`),
      kpi(`Pago em ${ant}`, brlCompacto(pagoRef), 'pago mais restos a pagar pagos, só dos fundos em análise'),
      kpi(`Pago em ${ult} até ${mesRef()}`, brlCompacto(pagoAtual), 'mesmo critério'),
      kpi('Vindo do Tesouro, sem vinculação', brlCompacto(livre), `${pct(livre / pagoRef)} do pago em ${ant}`, 'alerta'),
      kpi('Saldo conhecido', saldos.length ? brlCompacto(soma(saldos, (s) => s.valor)) : '—', saldos.length ? `${nInt.format(saldos.length)} fundo (${saldos.map((s) => s.sigla).join(', ')}); o dos demais não é público` : 'não é público'),
      kpi('Saldo estimado nos demais', brlCompacto(soma(estimados, (f) => f.implicito.valor)), `${nInt.format(estimados.length)} fundos, a partir do rendimento das aplicações: ordem de grandeza que tende a subestimar`, 'alerta'));
    const faixa = el('div', { class: 'cartao fundos-leitura' }, el('h2', {}, 'Leitura dos dados: onde há mais e menos margem'),
      el('p', { class: 'sub' }, 'Resumo que combina a origem do dinheiro que o fundo paga (dados de execução) e o que a lei diz sobre o saldo. É um ponto de partida para as perguntas, não uma conclusão: o texto da lei e o saldo real decidem.'),
      el('div', { class: 'leitura-trio' }, ['mais', 'verificar', 'menos'].map((g) => {
        const fs = grupo(g), v = soma(fs, (f) => (f.anos[ant] ? f.anos[ant].total : 0));
        return el('div', { class: 'leitura-item ' + COR_LEITURA[g] }, el('b', {}, ROTULO_LEITURA[g]), el('span', { class: 'leitura-n' }, `${nInt.format(fs.length)} fundos · ${brlCompacto(v)} pagos em ${ant}`),
          el('small', {}, g === 'mais' ? 'Pagam com recurso do Tesouro sem vinculação, ou a lei permite reverter o saldo ao Tesouro.' : g === 'menos' ? 'Pagam com transferência da União ou royalties, ou a lei mantém o saldo no fundo.' : 'Sem sinal claro nos dados ou na lei: depende de leitura caso a caso.'));
      })));
    const linhas = lista.map((f) => {
      const a = f.anos[f.ref] || {}, b = f.anos[ult] || {};
      const s = saldoDe(f.ug);
      return el('tr', { class: 'fundo-linha', tabindex: '0', role: 'link', onclick: () => ctx.irPara(f.ug), onkeydown: (ev) => { if (ev.key === 'Enter') ctx.irPara(f.ug); } },
        el('td', { class: 'objeto' }, el('strong', {}, nomeDe(f)), el('small', {}, [f.leiCriacao, 'UG ' + f.ug].filter(Boolean).join(' · '))),
        el('td', { class: 'num' }, a.total ? brlCompacto(a.total) : '—', el('small', {}, f.ref !== ant ? 'em ' + f.ref : '')),
        el('td', { class: 'num' }, b.total ? brlCompacto(b.total) : '—'),
        el('td', {}, a.fonte ? minibarra(a.fonte) : null),
        el('td', { class: 'num' }, a.arrec != null ? brlCompacto(a.arrec) : '—'),
        el('td', { class: 'num' }, celulaSaldo(f)),
        el('td', {}, el('div', { class: 'selos' }, [reversaoSelo(f.reversao), ...f.sinais.filter((x) => ['tesouro', 'federal', 'royalties', 'propria', 'acumula', 'abastecido'].includes(x)).map(sinalSelo)].filter(Boolean))));
    });
    const movel = PF.telaEstreita();
    const cartoes = lista.map((f) => {
      const a = f.anos[f.ref] || {}, b = f.anos[ult] || {}, s = saldoDe(f.ug);
      return el('button', { type: 'button', class: 'fundo-cartao', onclick: () => ctx.irPara(f.ug) },
        el('strong', {}, nomeDe(f)), el('small', {}, [f.leiCriacao, 'UG ' + f.ug].filter(Boolean).join(' · ')),
        el('span', { class: 'fundo-nums' }, el('span', {}, el('b', {}, a.total ? brlCompacto(a.total) : '—'), ` em ${f.ref}`), el('span', {}, el('b', {}, b.total ? brlCompacto(b.total) : '—'), ` em ${ult}`)),
        a.fonte ? minibarra(a.fonte) : null,
        el('span', { class: 'fundo-nums' }, el('span', {}, 'Arrecadou ', el('b', {}, a.arrec != null ? brlCompacto(a.arrec) : '—')), el('span', {}, 'Saldo ', el('b', {}, celulaSaldo(f)))),
        el('div', { class: 'selos' }, [reversaoSelo(f.reversao), ...f.sinais.filter((x) => ['tesouro', 'federal', 'royalties', 'propria', 'acumula', 'abastecido'].includes(x)).map(sinalSelo)].filter(Boolean)));
    });
    const tabela = !lista.length ? el('p', { class: 'vazio' }, 'Nenhum fundo neste filtro.') : movel ? el('div', { class: 'fundos-lista' }, cartoes) : el('div', { class: 'rolagem' }, el('table', { class: 'tabela-fundos' },
      el('thead', {}, el('tr', {}, [`Fundo`, `Pago em ${ant}`, `Pago em ${ult}`, 'Origem do dinheiro que pagou', `Arrecadou em ${ant}`, 'Saldo (≈ estimado)', 'Sinais'].map((t, n) => el('th', { class: n === 1 || n === 2 || n === 4 || n === 5 ? 'num' : '' }, t)))),
      el('tbody', {}, linhas)));
    const fora = el('details', { class: 'fm-detalhes' }, el('summary', {}, `O que ficou fora da análise (${nInt.format(dados.fora.length)} fundos) e por quê`),
      Object.keys(dados.rotuloFora).map((g) => {
        const fs = dados.fora.filter((x) => x.grupo === g);
        if (!fs.length) return null;
        return el('div', { class: 'lac-bloco' }, el('h4', {}, `${dados.rotuloFora[g]} · ${brlCompacto(soma(fs, (x) => x.total[ant] || 0))} pagos em ${ant}`),
          el('p', {}, fs[0].motivo), el('p', { class: 'mudo' }, fs.map((x) => titulo(x.nome)).join('; ') + '.'));
      }));
    c.replaceChildren(...[
      el('p', { class: 'fm-intro' }, 'Para cada fundo, quanto arrecada e paga, de onde vem o dinheiro que ele paga, o que a lei diz sobre usá-lo e o saldo, quando conhecido. A ideia é apontar onde o Estado pode ter margem para realocar recursos entre políticas públicas e onde não tem. Fundos previdenciários, o da Saúde e os de outros Poderes ficam fora, porque não há margem do Executivo sobre eles.'),
      kp, faixa, cartaoCaixa(),
      el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, `Fundos (${nInt.format(lista.length)})`),
        el('p', {}, 'Do maior para o menor valor pago. Clique em um fundo para ver o raio-x, a base legal e as perguntas a esclarecer.'))),
      el('div', { class: 'filtro-cond' }, el('div', { class: 'abas', role: 'group' }, FILTROS.map(([v, r]) => el('button', { type: 'button', 'aria-pressed': String(v === est.filtro), onclick: () => { est.filtro = v; render(); } }, r)))),
      legendaMix(), tabela,
      lista.length ? PF.barraCompartilhar(() => compartilharLista(lista)) : null),
      fora, el('p', { class: 'fm-nota' }, `Fonte: ${dados.fonteDados}. Valores até ${mesRef()}.`)].filter(Boolean));
  }

  function compartilharLista(lista) {
    const ult = dados.anoCorrente, ant = String(+ult - 1);
    const filtros = [`Fundos públicos do Estado do ES: pago (mais restos a pagar pagos) em ${ant} e em ${ult} até ${mesRef()}; origem do dinheiro, arrecadação própria e saldo conhecido`,
      est.filtro ? 'Filtro: ' + FILTROS.find((x) => x[0] === est.filtro)[1] : '',
      'Leitura automática dos dados, não substitui a leitura da lei de cada fundo. Ficaram fora fundos previdenciários, o da Saúde e os de outros Poderes.'].filter(Boolean);
    return { titulo: 'Raio-x dos fundos públicos', filtros, arquivo: `fundos-raio-x-${dados.ate}`,
      colunas: [{ t: 'Fundo', w: 4.2 }, { t: 'Lei', w: 1.8 }, { t: `Pago ${ant}`, w: 1.2, n: 1 }, { t: `Pago ${ult}`, w: 1.2, n: 1 }, { t: 'Tesouro livre', w: 1, n: 1 }, { t: 'União', w: 1, n: 1 }, { t: 'Arrec. ' + ant, w: 1.2, n: 1 }, { t: 'Saldo', w: 1.2, n: 1 }, { t: 'Sinais', w: 3 }],
      linhas: lista.map((f) => { const a = f.anos[f.ref] || {}, b = f.anos[ult] || {}, t = a.total || 0, fo = a.fonte || {}; const s = saldoDe(f.ug);
        return [nomeDe(f), f.leiCriacao || '-', a.total ? brlCompacto(a.total) : '-', b.total ? brlCompacto(b.total) : '-', t ? pct((fo.livre || 0) / t) : '-', t ? pct(((fo.federal || 0) + (fo.royalties || 0)) / t) : '-', a.arrec != null ? brlCompacto(a.arrec) : '-', s ? brlCompacto(s.valor) : implicitoDe(f) ? 'aprox. ' + brlCompacto(implicitoDe(f).valor) + ' (est.)' : 'nao publico', f.sinais.filter((x) => SINAIS[x]).map((x) => SINAIS[x][0]).join('; ')]; }),
      texto: lista.slice(0, 10).map((f, i) => `${i + 1}. ${nomeDe(f)} - ${brlCompacto((f.anos[f.ref] || {}).total || 0)} em ${f.ref}`).concat(lista.length > 10 ? [`... e mais ${lista.length - 10}. O PDF traz a lista completa.`] : []) };
  }

  // ---------- página de um fundo ----------
  function trilha(rotulo) {
    return el('div', { class: 'trilha' }, el('button', { type: 'button', onclick: () => ctx.irPara('') }, 'Fundos'), el('span', { class: 'sep' }, '›'), el('span', { class: 'atual' }, rotulo));
  }
  const bloco = ([t, p]) => (p ? el('div', { class: 'lac-bloco' }, el('h4', {}, t), el('p', {}, p)) : null);
  const anoDe = (d, a) => d.anos[a] || null;

  function cartaoLei(f, d) {
    const cad = d.cadastro;
    if (!cad) {
      return el('div', { class: 'cartao' }, el('h2', {}, 'Base legal'), el('p', { class: 'vazio' }, 'A base legal deste fundo ainda não foi levantada no painel. Consulte a lei de criação na Assembleia Legislativa.'));
    }
    const links = (cad.links || []).filter((l) => l.url);
    return el('div', { class: 'cartao' }, el('h2', {}, 'Base legal e finalidade'),
      el('p', { class: 'sub' }, 'Resumo do texto das leis, levantado em fontes oficiais. Confira o texto no link antes de qualquer decisão.'),
      bloco(['Lei de criação', cad.leiCriacaoCompleta || cad.leiCriacao]), (cad.alteracoes || []).length ? el('div', { class: 'lac-bloco' }, el('h4', {}, 'Principais alterações'), el('ul', { class: 'lista-simples' }, cad.alteracoes.map((a) => el('li', {}, a)))) : null,
      bloco(['Finalidade', cad.finalidade]), bloco(['De onde vêm os recursos, segundo a lei', cad.receitas]), bloco(['Quem administra', cad.gestao]),
      bloco(['Vinculação e quem pode alterar', cad.vinculacao]),
      links.length ? el('div', { class: 'lac-bloco' }, el('h4', {}, 'Textos legais'), el('p', { class: 'links-lei' }, links.map((l) => el('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.rotulo)))) : null,
      cad.lacunas ? el('p', { class: 'fm-nota' }, 'A confirmar: ' + cad.lacunas) : null,
      cad.confianca ? el('p', { class: 'fm-nota' }, `Confiança do levantamento: ${cad.confianca}.`) : null);
  }

  function cartaoSaldo(f) {
    const s = saldoDe(f.ug), i = implicitoDe(f);
    if (!s && i) {
      const v = (dados.validacaoImplicito || [])[0];
      return el('div', { class: 'cartao' }, el('h2', {}, 'Saldo'),
        el('p', { class: 'sub' }, 'O saldo deste fundo não é publicado nos dados abertos. Mas os rendimentos de aplicações financeiras que ele arrecada deixam uma pista do tamanho do dinheiro aplicado.'),
        el('div', { class: 'kpis' }, kpi(`Rendimentos de aplicações em ${i.ano}`, brlCompacto(i.rend), 'receita patrimonial, rubrica de valores mobiliários'),
          kpi('Saldo aplicado estimado', '≈ ' + brlCompacto(i.valor), `rendimento dividido pela Selic média de ${i.ano} (${i.taxa.toLocaleString('pt-BR')}% a.a.)`, 'alerta')),
        el('p', { class: 'fm-nota' }, 'É uma estimativa em ordem de grandeza, não o saldo. Ela supõe que todo o dinheiro rendeu a Selic o ano inteiro; se parte ficou em conta sem rendimento, o saldo é maior. ',
          v ? `No Fundo Soberano, o único com saldo conhecido, a mesma conta dá ${pct(v.razao)} do saldo real (${brlCompacto(v.estimado)} contra ${brlCompacto(v.real)} em ${dataBR(v.data)}), então tende a subestimar. ` : '',
          'O saldo e a disponibilidade de caixa por fundo estão em Informações a solicitar.'));
    }
    if (!s) {
      return el('div', { class: 'cartao fm-fora' }, el('h3', {}, 'Saldo'),
        el('p', {}, 'O saldo deste fundo não é publicado nos dados abertos, e o rendimento das aplicações que ele arrecada é pequeno demais para estimá-lo. É a informação que decide se há dinheiro parado para realocar. Está listado em Informações a solicitar.'));
    }
    return el('div', { class: 'cartao' }, el('h2', {}, 'Saldo'),
      el('p', { class: 'sub' }, `${s.rotulo}, posição em ${dataBR(s.data)}. ${s.fonte}`),
      el('div', { class: 'kpis' }, kpi('Superávit financeiro', brlCompacto(s.valor), 'ativo financeiro menos passivo financeiro'), ...s.detalhes.map((x) => kpi(x[0], brlCompacto(x[1]), x[2] || ''))),
      el('p', { class: 'fm-nota' }, el('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'Abrir as demonstrações contábeis'), s.nota ? ' · ' + s.nota : ''));
  }

  function cartaoSinais(f) {
    const itens = f.sinais.filter((x) => SINAIS[x]);
    const pergs = [];
    if (f.sinais.includes('tesouro') || f.sinais.includes('abastecido')) pergs.push('Por que o fundo recebe transferência do Tesouro em vez de a despesa correr direto pelo orçamento do órgão? A transferência é prevista em lei ou é decisão de gestão?');
    if (f.sinais.includes('acumula')) pergs.push('Qual o saldo atual do fundo, de que fontes e para que está reservado?');
    if (f.sinais.includes('propria')) pergs.push('A lei de criação permite usar essa receita em outra finalidade? Que lei teria de mudar?');
    if (f.sinais.includes('federal') || f.sinais.includes('royalties')) pergs.push('Qual o instrumento e o concedente? O saldo pode ser remanejado ou deve ser devolvido?');
    if (f.sinais.includes('rap')) pergs.push('Os restos a pagar mais antigos ainda são devidos? Há empenhos que podem ser cancelados?');
    pergs.push('Quanto do que o fundo paga já está comprometido em contratos e convênios em vigor?');
    return el('div', { class: 'cartao' }, el('h2', {}, 'Sinais dos dados e o que esclarecer'),
      itens.length ? el('div', {}, itens.map((s) => el('div', { class: 'lac-bloco' }, el('h4', {}, SINAIS[s][0]), el('p', {}, SINAIS[s][1]())))) : el('p', { class: 'sub' }, 'Nenhum dos sinais automáticos se aplica a este fundo no período.'),
      el('div', { class: 'lac-bloco' }, el('h4', {}, 'O que esclarecer'), el('ul', { class: 'lista-simples' }, pergs.map((p) => el('li', {}, p)))),
      el('p', { class: 'fm-nota' }, 'Os sinais são leituras automáticas dos dados de execução, com limiares fixos (50% da origem ou da natureza, 25% de restos a pagar, 120% e 50% da arrecadação sobre o pago). Não substituem a leitura da lei.'));
  }

  function renderFundo(c, f, d) {
    const ult = dados.anoCorrente, ant = String(+ult - 1);
    const anos = Object.keys(d.anos).sort();
    if (!est.ano || !d.anos[est.ano]) est.ano = d.anos[f.ref] ? f.ref : anos[anos.length - 1];
    const a = anoDe(d, est.ano), s = saldoDe(f.ug);
    const refA = anoDe(d, ant), curA = anoDe(d, ult);
    const kp = el('div', { class: 'kpis' },
      kpi(`Pago em ${ant}`, refA ? brlCompacto(refA.total) : '—', 'pago mais restos a pagar pagos'),
      kpi(`Pago em ${ult} até ${mesRef()}`, curA ? brlCompacto(curA.total) : '—', ''),
      kpi(`Arrecadou em ${ant}`, refA && refA.rec ? brlCompacto(refA.rec.arrec) : '—', 'receita orçamentária própria; não inclui transferência do Tesouro'),
      kpi('Saldo', s ? brlCompacto(s.valor) : implicitoDe(f) ? '≈ ' + brlCompacto(implicitoDe(f).valor) : 'não público', s ? 'superávit financeiro em ' + dataBR(s.data) : implicitoDe(f) ? 'estimado pelos rendimentos; o saldo não é público' : 'pedido em Informações a solicitar', s ? '' : 'alerta'));
    const meses = [], vals = [];
    for (const y of anos) for (const m of Object.keys(d.anos[y].mes || {})) { meses.push(m); vals.push(d.anos[y].mes[m]); }
    const grafico = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, 'Quanto o fundo pagou por mês'), el('p', {}, 'Pago mais restos a pagar pagos.'))));
    if (meses.length > 1) PF.graficoBarras(grafico, { meses, series: [{ nome: 'Pago', cor: 'var(--serie-1)', vals }], fmt: brlCompacto, eixo: brlCompacto });
    const seletor = el('div', { class: 'abas', role: 'group' }, anos.map((y) => el('button', { type: 'button', 'aria-pressed': String(y === est.ano), onclick: () => { est.ano = y; render(); } }, y === ult ? `${y} até ${rotuloMes(dados.ate)}` : y)));
    let origem = null, paga = null, entra = null;
    if (a) {
      const t = a.total || 1;
      origem = el('div', { class: 'cartao' }, el('h2', {}, `De onde vem o dinheiro que o fundo pagou em ${est.ano}`),
        el('p', { class: 'sub' }, 'Fonte de recursos de cada pagamento. É o que mais diz sobre a margem: recurso do Tesouro sem vinculação pode ser reordenado pela lei orçamentária; transferência carimbada, não.'),
        barras(Object.entries(a.fonte).map(([k, v]) => ({ nome: dados.fontes[k] || k, v }))),
        el('details', { class: 'fm-detalhes' }, el('summary', {}, 'Fontes de recursos detalhadas'),
          barras(a.fonteDet.map(([cod, nome, v]) => ({ nome: titulo(nome), sub: 'fonte ' + cod, v })))));
      paga = el('div', { class: 'cartao' }, el('h2', {}, `O que o fundo pagou em ${est.ano}`),
        el('p', { class: 'sub' }, `${brlCompacto(a.total)} pagos; empenhado ${brlCompacto(a.emp)}, liquidado ${brlCompacto(a.liq)} (no ano, incluindo o que ainda será pago). Restos a pagar pagos: ${brlCompacto(a.rap)} (${pct(a.rap / t)}).`),
        el('h4', { class: 'sec' }, 'Por natureza da despesa'), barras(Object.entries(a.nat).map(([k, v]) => ({ nome: dados.naturezas[k] || k, v }))),
        el('h4', { class: 'sec' }, 'Principais elementos de despesa'), barras(a.elem.map(([g, cod, nome, v]) => ({ nome: titulo(nome), sub: `grupo ${g} · elemento ${cod}`, v }))),
        a.prog.length ? el('h4', { class: 'sec' }, 'Principais programas e ações') : null, a.prog.length ? barras(a.prog.map(([p, ac, v]) => ({ nome: titulo(ac), sub: titulo(p), v }))) : null,
        a.fav.length ? el('h4', { class: 'sec' }, 'Maiores favorecidos (empresas e órgãos)') : null, a.fav.length ? barras(a.fav.map(([tp, nm, v]) => ({ nome: titulo(nm), sub: tp, v }))) : null);
      if (a.rec) {
        entra = el('div', { class: 'cartao' }, el('h2', {}, `O que entrou no fundo em ${est.ano}`),
          el('p', { class: 'sub' }, `Receita orçamentária própria arrecadada: ${brlCompacto(a.rec.arrec)} (prevista ${brlCompacto(a.rec.prev)}). Compare com ${brlCompacto(a.total)} pagos. A diferença, quando o pago é maior, costuma vir de transferência financeira do Tesouro, que não é receita do fundo.`),
          a.rec.orig.length ? barras(a.rec.orig.map(([n, v]) => ({ nome: titulo(n), v }))) : el('p', { class: 'vazio' }, 'O fundo não registrou receita orçamentária própria no período.'),
          a.rec.rub.length ? el('details', { class: 'fm-detalhes' }, el('summary', {}, 'Rubricas de receita'), barras(a.rec.rub.map(([n, v]) => ({ nome: titulo(n), v })))) : null);
      }
    }
    const cab = el('div', { class: 'cartao' }, el('div', { class: 'cartao-topo' }, el('div', {}, el('h2', {}, nomeDe(f)), el('p', {}, [f.leiCriacao, 'unidade gestora ' + f.ug].filter(Boolean).join(' · '))),
      el('span', { class: 'selo ' + COR_LEITURA[leitura(f)], title: f.leituraNota || 'Leitura automática da origem dos recursos, não da lei' }, el('b', {}, ROTULO_LEITURA[leitura(f)]))),
      el('div', { class: 'selos' }, [reversaoSelo(f.reversao), ...f.sinais.filter((x) => SINAIS[x]).map(sinalSelo)].filter(Boolean)),
      f.leituraNota ? el('p', { class: 'fm-nota' }, f.leituraNota) : null);
    c.replaceChildren(...[trilha(nomeDe(f)), cab, kp, cartaoSaldo(f), grafico, el('div', { class: 'filtro-cond' }, seletor), origem, paga, entra, cartaoLei(f, d), cartaoSinais(f),
      PF.barraCompartilhar(() => compartilharFundo(f, d)), el('p', { class: 'fm-nota' }, `Fonte: ${dados.fonteDados}. Valores até ${mesRef()}.`)].filter(Boolean));
  }

  function compartilharFundo(f, d) {
    const ult = dados.anoCorrente, ant = String(+ult - 1), a = anoDe(d, est.ano), cad = d.cadastro || {};
    const s = saldoDe(f.ug);
    const linhas = [];
    const sec = (nome, itens) => itens.forEach(([i, v], k) => linhas.push([k ? '' : nome, i, v]));
    sec('Visão geral', [[`Pago em ${ant}`, anoDe(d, ant) ? brlCompacto(anoDe(d, ant).total) : '-'], [`Pago em ${ult} até ${mesRef()}`, anoDe(d, ult) ? brlCompacto(anoDe(d, ult).total) : '-'],
      [`Arrecadou em ${ant}`, anoDe(d, ant) && anoDe(d, ant).rec ? brlCompacto(anoDe(d, ant).rec.arrec) : '-'], ['Saldo', s ? `${brlCompacto(s.valor)} em ${dataBR(s.data)}` : implicitoDe(f) ? `aprox. ${brlCompacto(implicitoDe(f).valor)} (estimado pelos rendimentos; o saldo nao e publico)` : 'nao publicado (pedir ao Estado)']]);
    if (a) {
      sec(`Origem do dinheiro em ${est.ano}`, Object.entries(a.fonte).filter(([, v]) => v > 0.5).sort((x, y) => y[1] - x[1]).map(([k, v]) => [dados.fontes[k] || k, `${brlCompacto(v)} (${pct(v / a.total)})`]));
      sec(`O que pagou em ${est.ano}`, Object.entries(a.nat).filter(([, v]) => v > 0.5).sort((x, y) => y[1] - x[1]).map(([k, v]) => [dados.naturezas[k] || k, `${brlCompacto(v)} (${pct(v / a.total)})`]));
      sec('Principais favorecidos', a.fav.slice(0, 8).map(([tp, nm, v]) => [titulo(nm), brlCompacto(v)]));
    }
    sec('Sinais dos dados', f.sinais.filter((x) => SINAIS[x]).map((x) => [SINAIS[x][0], SINAIS[x][1]()]));
    if (cad.leiCriacao) sec('Base legal', [['Lei de criacao', cad.leiCriacao], ['Finalidade', cad.finalidade || '-'], ['Vinculacao e quem altera', cad.vinculacao || '-']]);
    return { titulo: `Raio-x do fundo: ${nomeDe(f)}`, paisagem: false, arquivo: `fundo-${f.ug}-${dados.ate}`,
      filtros: [`${nomeDe(f)} (unidade gestora ${f.ug}); valores em pago mais restos a pagar pagos, ate ${mesRef()}`, 'Leitura automatica dos dados de execucao; nao substitui a leitura da lei do fundo.'],
      colunas: [{ t: 'Secao', w: 2 }, { t: 'Item', w: 4 }, { t: 'Valor', w: 6 }], linhas,
      texto: [`${nomeDe(f)}: pago ${brlCompacto((anoDe(d, ant) || {}).total || 0)} em ${ant}. Leitura: ${ROTULO_LEITURA[leitura(f)]}.`, 'O PDF traz a origem do dinheiro, o que o fundo paga, o saldo e a base legal.'] };
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
    tela = decodeURIComponent(resto || '');
    render();
    if (tela) window.scrollTo({ top: 0 });
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Fundos</h2>
          <p class="sub">Raio-x dos fundos públicos: o que arrecadam, o que pagam, o que a lei permite e onde pode haver margem.</p>
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
