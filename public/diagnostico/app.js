// Interface da página de diagnóstico fiscal. Depende de dados.js (window.DADOS) e de modelo.js (window.Modelo).
// Sem estilos nem scripts embutidos: a política de segurança do painel (vercel.json) só admite arquivos do próprio domínio.
(function () {
  'use strict';
  var D = window.DADOS, M = window.Modelo, TB = window.Tabelas;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LARGO = 640, ESTREITO = 360, W = LARGO; // largura (em unidades do desenho) usada nos gráficos; muda conforme a tela
  function medirLargura() { return window.innerWidth < 560 ? ESTREITO : LARGO; }

  /* ---------- utilidades ---------- */
  function $(id) { return document.getElementById(id); }
  function limpar(no) { while (no.firstChild) no.removeChild(no.firstChild); }
  function anexar(no, filhos) {
    (filhos || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      no.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return no;
  }
  function h(tag, props, filhos) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') e.textContent = props[k]; else e.setAttribute(k, props[k]);
    });
    return anexar(e, filhos);
  }
  function s(tag, attrs, filhos) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return anexar(e, filhos);
  }
  function texto(tag, attrs, conteudo) { var e = s(tag, attrs); e.textContent = conteudo; return e; }
  function num(x, casas) { return x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }
  function pct(x, casas) { return num(x * 100, casas === undefined ? 1 : casas) + '%'; }
  function bi(x) { return (x < 0 && Math.abs(x) >= 0.005 ? '-' : '') + 'R$ ' + num(Math.abs(x), 2) + ' bi'; }
  function mi(x) { return (Math.round(x) < 0 ? '-' : '') + 'R$ ' + num(Math.abs(Math.round(x)), 0) + ' mi'; }
  function pp(x) { return num(x, 1) + ' pontos percentuais'; }
  function arredondar(x, passo) { return Math.ceil(x / passo) * passo; }
  function selo(nota) { return h('span', { 'class': 'letra n' + nota, text: nota }); }
  function soma(v) { return v.reduce(function (a, b) { return a + b; }, 0); }
  function serie(chave, de, ate) {
    return D.historico_caixa.filter(function (q) { return q.ano >= de && q.ano <= ate; }).map(function (q) { return q[chave]; });
  }
  function ano(a) { return D.historico_caixa.filter(function (q) { return q.ano === a; })[0]; }

  /* ---------- 1. tabela de folgas hoje ---------- */
  function montarTabelaEspaco() {
    var E = M.espacosAtuais(D);
    var linhas = [
      { nome: 'Endividamento', hoje: pct(D.dc_rcl), nota: M.notaDC(D.dc_rcl),
        limites: ['Limite: abaixo de 60% da receita'],
        folga: [bi(E.divida) + ' de dívida nova'],
        consome: 'Novos empréstimos. Uma receita maior aumenta a folga e uma receita menor a reduz.' },
      { nome: 'Poupança corrente', hoje: pct(D.pc), nota: M.notaPC(D.pc),
        limites: ['Conforto: abaixo de 85%', 'Absoluto: abaixo de 95%'],
        folga: ['Conforto: ' + bi(E.despesaAteB) + ' por ano', 'Absoluto: ' + bi(E.despesaAteC) + ' por ano'],
        consome: 'Despesa que se repete todo ano, como folha, custeio e emendas impositivas. Só pesa por inteiro depois de três anos.' },
      { nome: 'Liquidez relativa', hoje: pct(D.lr), nota: M.notaLR(D.lr),
        limites: ['Conforto: 5% ou mais', 'Absoluto: acima de zero'],
        folga: ['Conforto: ' + bi(E.caixaAteB), 'Absoluto: ' + bi(E.caixaAteC)],
        consome: 'Qualquer gasto novo sem receita nova e a perda de receita. A folga é um estoque e se gasta uma única vez.' }
    ];
    var cab = h('thead', {}, [h('tr', {}, [
      h('th', { text: 'Ponteiro' }), h('th', { text: 'Fechamento de ' + D.ano_base + ' (estimado)' }), h('th', { text: 'Limites da nota A' }),
      h('th', { text: 'Folga em reais' }), h('th', { text: 'O que consome a folga' })])]);
    var corpo = h('tbody', {}, linhas.map(function (l) {
      function bloco(itens) { return itens.map(function (t) { return h('div', { text: t }); }); }
      return h('tr', {}, [
        h('td', { 'class': 'nome', 'data-rotulo': 'Ponteiro', text: l.nome }),
        h('td', { 'data-rotulo': 'Fechamento de ' + D.ano_base + ' (estimado)' }, [h('span', { 'class': 'destaque-num', text: l.hoje }), selo(l.nota)]),
        h('td', { 'data-rotulo': 'Limites da nota A' }, bloco(l.limites)),
        h('td', { 'data-rotulo': 'Folga em reais' }, bloco(l.folga)),
        h('td', { 'data-rotulo': 'O que consome a folga', text: l.consome })
      ]);
    }));
    var alvo = $('tabela-espaco'); limpar(alvo);
    alvo.appendChild(h('table', {}, [cab, corpo]));

    // Parágrafo de leitura: fluxo contra estoque.
    var novo = (D.extras_padrao.emenda + D.extras_padrao.poderes) / 1000;
    var anosCaixa = E.caixaAteB / novo;
    var duracao = anosCaixa > 0.95 && anosCaixa < 1.05 ? 'cerca de um ano' : 'cerca de ' + num(anosCaixa, 1) + ' anos';
    $('leitura-espaco').textContent =
      'A diferença de natureza entre as folgas é o ponto central da tabela. A poupança corrente compara a despesa e a receita de cada ano, de modo que a folga de ' +
      bi(E.despesaAteB) + ' se renova todo ano. A liquidez compara o caixa acumulado com a receita, de modo que a folga de ' + bi(E.caixaAteB) +
      ' é um balde que se esvazia uma única vez. Um gasto novo de ' + mi(novo * 1000) + ' por ano, valor de referência deste estudo, usa ' +
      pct(novo / E.despesaAteB, 0) + ' da folga anual da poupança corrente, mas esvazia o balde da liquidez em ' + duracao +
      '. Nas premissas desta página, isso faz da liquidez a primeira válvula a ceder.';
  }

  /* ---------- gráfico de barras ---------- */
  // o: rotulos [], rotulos2 [] (opcional, segunda linha), series [{valores, classe, rotular}], classeDe(i, k) opcional, fmt, altura, aria
  function barras(o) {
    var H = o.altura || 230, L = 34, R = W - 8, T = 18, B = H - (o.rotulos2 ? 42 : 26);
    var vs = [];
    o.series.forEach(function (sr) { sr.valores.forEach(function (v) { if (v !== null && v !== undefined) vs.push(v); }); });
    var vmin = Math.min.apply(null, vs.concat([0])), vmax = Math.max.apply(null, vs.concat([0]));
    var folga = (vmax - vmin) * 0.14;
    vmax += folga; if (vmin < 0) vmin -= folga;
    function py(v) { return B - (v - vmin) / (vmax - vmin) * (B - T); }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria });
    var n = o.rotulos.length, gw = (R - L) / n, ns = o.series.length, bw = Math.min(30, gw * 0.78 / ns);
    svg.appendChild(s('line', { x1: L, y1: py(0), x2: R, y2: py(0), 'class': 'mapa-eixo' }));
    svg.appendChild(texto('text', { x: L - 6, y: py(0) + 4, 'class': 'tique-rotulo eixo-y' }, '0'));
    var maior2 = o.rotulos2 ? Math.max.apply(null, o.rotulos2.map(function (r) { return r.length; })) : 0;
    var passo2 = maior2 * 5.6 + 4 > gw ? 2 : 1; // com pouco espaço, a segunda linha aparece em anos alternados
    o.rotulos.forEach(function (r, i) {
      svg.appendChild(texto('text', { x: L + gw * (i + 0.5), y: B + 16, 'class': 'tique-rotulo' }, String(r)));
      if (o.rotulos2 && i % passo2 === 0) svg.appendChild(texto('text', { x: L + gw * (i + 0.5), y: B + 30, 'class': 'tique-rotulo suave' }, o.rotulos2[i]));
      o.series.forEach(function (sr, k) {
        var v = sr.valores[i];
        if (v === null || v === undefined) return;
        var x = L + gw * i + (gw - bw * ns) / 2 + bw * k;
        var y0 = py(0), y1 = py(v);
        var rect = s('rect', { x: x, y: Math.min(y0, y1), width: bw - 1, height: Math.max(1, Math.abs(y1 - y0)), 'class': o.classeDe ? o.classeDe(i, k) : sr.classe });
        rect.appendChild(texto('title', {}, r + ': ' + o.fmt(v)));
        svg.appendChild(rect);
        if (sr.rotular) svg.appendChild(texto('text', { x: x + (bw - 1) / 2, y: v >= 0 ? y1 - 4 : y1 + 12, 'class': 'valor-barra' }, o.fmt(v)));
      });
    });
    return svg;
  }

  /* ---------- 2. evidências ---------- */
  function montarEvidencias() {
    var H = D.historico_caixa, anos = H.map(function (q) { return q.ano; });
    var X = D.externos, p26 = D.parcial_2026;

    // Caixa livre
    var caixa = serie('caixa_livre', 2018, 2025), c2125 = serie('caixa_livre', 2021, 2025), r2125 = serie('rcl', 2021, 2025);
    $('leg-caixa').textContent = 'Caixa bruto das fontes não vinculadas, menos as obrigações e menos as insuficiências das fontes vinculadas, em R$ bilhões. Sob cada ano, a proporção da receita corrente líquida.';
    var gc = $('graf-caixa'); limpar(gc);
    gc.appendChild(barras({ rotulos: anos, rotulos2: H.map(function (q) { return pct(q.caixa_livre_rcl, 1); }), fmt: function (v) { return num(v, 2); },
      series: [{ valores: caixa, classe: 'barra-caixa', rotular: true }], aria: 'Caixa livre do Executivo de 2018 a 2025, em R$ bilhões.' }));
    $('nota-caixa').textContent = 'De 2021 a 2025 o caixa livre oscilou entre ' + bi(Math.min.apply(null, c2125)) + ' e ' + bi(Math.max.apply(null, c2125)) +
      ', enquanto a receita corrente líquida cresceu ' + pct(r2125[r2125.length - 1] / r2125[0] - 1, 0) + '. Como proporção da receita, caiu de ' +
      pct(ano(2021).caixa_livre_rcl) + ' para ' + pct(ano(2025).caixa_livre_rcl) + '.';

    // Resultado primário
    var meta = serie('meta_resultado_primario', 2018, 2025), real = serie('resultado_primario', 2018, 2025);
    var folgas = H.filter(function (q) { return q.ano >= 2021; }).map(function (q) { return q.resultado_primario - q.meta_resultado_primario; });
    $('leg-primario').textContent = 'Barra clara: meta fixada na lei de diretrizes. Barra escura: resultado realizado. Em R$ bilhões; a partir de 2023 o demonstrativo exclui as fontes do regime próprio de previdência.';
    var gp = $('graf-primario'); limpar(gp);
    gp.appendChild(barras({ rotulos: anos, fmt: function (v) { return num(v, 1); }, altura: 250,
      series: [{ valores: meta, classe: 'barra-meta' }, { valores: real, classe: 'barra-real', rotular: true }],
      aria: 'Meta de resultado primário e resultado realizado de 2018 a 2025, em R$ bilhões.' }));
    function saldo(x) { return (x >= 0 ? 'um superávit de ' : 'um déficit de ') + bi(Math.abs(x)); }
    $('nota-primario').textContent = 'A meta foi de déficit em todos os anos, e o resultado realizado ficou ' + bi(soma(folgas) / folgas.length) +
      ' acima dela, em média, de 2021 a 2025. Em 2026 a meta é de déficit de ' + bi(-p26.meta_resultado_primario) + ' e o resultado até agosto é ' + saldo(p26.resultado_primario_ate_agosto) +
      '. Em 2025 o resultado era ' + saldo(p26.resultado_primario_ate_agosto_2025) + ' em agosto e fechou o ano com ' + saldo(ano(2025).resultado_primario) +
      ', de modo que o dado de agosto não permite concluir sobre o ano inteiro.';

    // Tabela de premissas e evidências
    var linhas = TB.premissas(D);
    var cab = h('thead', {}, [h('tr', {}, [h('th', { text: 'Parâmetro' }), h('th', { text: 'Valor usado nas tabelas' }), h('th', { text: 'O que as fontes mostram' }),
      h('th', { text: 'Origem' }), h('th', { text: 'Situação' })])]);
    var corpo = h('tbody', {}, linhas.map(function (l) {
      var origem = l.fontes.map(function (f) {
        return f[1] ? h('div', {}, [h('a', { href: f[1], target: '_blank', rel: 'noopener noreferrer', text: f[0] })]) : h('div', { text: f[0] });
      });
      return h('tr', {}, [
        h('td', { 'class': 'nome', 'data-rotulo': 'Parâmetro', text: l.parametro }),
        h('td', { 'data-rotulo': 'Valor usado nas tabelas', text: l.valor }),
        h('td', { 'data-rotulo': 'O que as fontes mostram', text: l.evidencia }),
        h('td', { 'data-rotulo': 'Origem' }, origem),
        h('td', { 'data-rotulo': 'Situação' }, [h('span', { 'class': 'sit sit-' + l.classe, text: l.situacao })])
      ]);
    }));
    var alvo = $('tabela-evidencias'); limpar(alvo);
    alvo.appendChild(h('table', { 'class': 'evidencias' }, [cab, corpo]));
  }

  /* ---------- 2b. as contas, ano a ano ---------- */
  function desenharCenario(spec, alvo) {
    var nReal = spec.colunas.filter(function (c) { return c.tipo === 'real'; }).length;
    var nProj = spec.colunas.filter(function (c) { return c.tipo === 'projecao'; }).length;
    var faixa = h('tr', { 'class': 'faixa' }, [h('th', { 'class': 'rot' }), h('th', { colspan: nReal, 'class': 'f-real', text: 'Realizado' }),
      h('th', { 'class': 'f-est', text: 'Estimado' }), h('th', { colspan: nProj, 'class': 'f-proj', text: 'Projeção' })]);
    var anos = h('tr', {}, [h('th', { 'class': 'rot', text: '' })].concat(spec.colunas.map(function (c) {
      return h('th', { 'class': 'num' + (c.perde ? ' perde' : ''), text: c.rotulo + (c.reconstruida ? '*' : '') });
    })));
    var linhas = [];
    spec.grupos.forEach(function (g) {
      linhas.push(h('tr', { 'class': 'grupo' }, [h('th', { colspan: spec.colunas.length + 1, text: g.titulo })]));
      g.linhas.forEach(function (l) {
        linhas.push(h('tr', { 'class': l.destaque ? 'destaque' : '' }, [h('th', { 'class': 'rot', scope: 'row', text: l.rotulo })].concat(l.celulas.map(function (c, k) {
          var col = spec.colunas[k];
          return h('td', { 'class': 'num' + (col.perde ? ' perde' : '') + (col.tipo === 'real' ? ' real' : '') + (c.vazio ? ' vazio' : '') }, [c.t, c.nota ? selo(c.nota) : null]);
        }))));
      });
    });
    limpar(alvo);
    var conclusao;
    if (spec.primeiro) {
      var f = spec.primeiro;
      conclusao = 'Nesta tabela a nota deixa de ser A no exercício de ' + f.ano + ', pela ' + f.causa + ': o caixa livre fica em ' + bi(f.caixa) + ', ou ' + pct(f.lr) + ' da receita corrente líquida. ' +
        'Depois disso os números mostram a lacuna que restaria se nenhum ajuste fosse feito. A nota divulgada pelo Tesouro Nacional sobre o exercício de ' + f.ano + ' sai em ' + (f.ano + 1) + '.';
    } else {
      conclusao = 'Nesta tabela a nota A se mantém em todos os exercícios até ' + M.ULTIMO_ANO + '.';
    }
    anexar(alvo, [h('h3', { text: spec.id + '. ' + spec.titulo }), h('p', { 'class': 'legenda', text: spec.resumo }),
      h('div', { 'class': 'rolagem' }, [h('table', { 'class': 'anos', 'aria-label': spec.id + '. ' + spec.titulo }, [h('thead', {}, [faixa, anos]), h('tbody', {}, linhas)])]),
      h('p', { 'class': 'nota', text: conclusao })]);
  }

  function desenharSensibilidade(spec, alvo) {
    var cab = h('thead', {}, [h('tr', {}, [h('th', { text: 'Se a premissa mudar' })].concat(spec.colunas.map(function (c) { return h('th', { text: c }); })))]);
    var corpo = h('tbody', {}, spec.linhas.map(function (l) {
      return h('tr', {}, [h('th', { 'class': 'rot', scope: 'row', text: l.rotulo })].concat(l.celulas.map(function (c, k) {
        return h('td', { 'class': c.indexOf('mantém') === 0 ? 'ok' : 'cai', 'data-rotulo': spec.colunas[k], text: c });
      })));
    }));
    limpar(alvo);
    anexar(alvo, [h('h3', { text: 'Primeiro exercício em que a nota deixa de ser A' }),
      h('p', { 'class': 'legenda', text: 'Cada linha troca uma premissa e mantém as demais como nas tabelas. Sai do cenário central e mostra quanto o resultado depende de cada escolha.' }),
      h('div', { 'class': 'rolagem' }, [h('table', { 'class': 'sens', 'aria-label': 'Sensibilidade do primeiro exercício sem nota A' }, [cab, corpo])])]);
  }

  function montarVerificacao() {
    var cens = M.cenarios(D);
    cens.forEach(function (c) { desenharCenario(TB.cenario(D, c), $('verif-' + c.id.toLowerCase())); });
    desenharSensibilidade(TB.sensibilidade(D), $('verif-sens'));
  }

  /* ---------- medidor horizontal (faixas de nota com marcadores) ---------- */
  // o: min, max, reverso, cortes [{de, ate, nota, rotulo}], ticks [valores], fmtTick, base (opcional), ponto, aria
  function medidor(o) {
    var X0 = 16, X1 = W - 16, ALT = 28, Y = o.rotulosAcima ? 28 : 12;
    function px(v) {
      var t = (Math.min(o.max, Math.max(o.min, v)) - o.min) / (o.max - o.min);
      if (o.reverso) t = 1 - t;
      return X0 + t * (X1 - X0);
    }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + (Y + ALT + 28), role: 'img', 'aria-label': o.aria });
    o.cortes.forEach(function (c) {
      var xa = px(c.de), xb = px(c.ate), x = Math.min(xa, xb), w = Math.abs(xb - xa);
      svg.appendChild(s('rect', { x: x, y: Y, width: w, height: ALT, 'class': 'faixa-' + c.nota }));
      var rot = c.rotulo || c.nota;
      if (w > rot.length * 6.8 + 12) {
        if (o.rotulosAcima) svg.appendChild(texto('text', { x: x + w / 2, y: Y - 9, 'class': 'rotulo-acima' }, rot));
        else svg.appendChild(texto('text', { x: x + w / 2, y: Y + ALT / 2 + 4.5, 'class': 'letra-faixa' + (c.nota === 'B' ? ' sobre-b' : '') }, rot));
      }
    });
    function larg(v) { return o.fmtTick(v).length * 5.8 + 8; }
    o.ticks.forEach(function (v, i) {
      var x = px(v);
      svg.appendChild(s('line', { x1: x, y1: Y + ALT, x2: x, y2: Y + ALT + 5, 'class': 'tique' }));
      var extremo = i === 0 || i === o.ticks.length - 1, esconde = false;
      if (extremo) {
        o.ticks.forEach(function (w, k) {
          if (k !== 0 && k !== o.ticks.length - 1 && Math.abs(px(w) - x) < (larg(v) + larg(w)) / 2) esconde = true;
        });
      }
      if (!esconde) svg.appendChild(texto('text', { x: x, y: Y + ALT + 18, 'class': 'tique-rotulo' + (x < 44 ? ' ini' : x > W - 44 ? ' fim' : '') }, o.fmtTick(v)));
    });
    var cy = Y + ALT / 2;
    if (o.base !== undefined && Math.abs(px(o.base) - px(o.ponto)) > 1) {
      svg.appendChild(s('line', { x1: px(o.base), y1: cy, x2: px(o.ponto), y2: cy, 'class': 'liga' }));
    }
    if (o.base !== undefined) svg.appendChild(s('circle', { cx: px(o.base), cy: cy, r: 8, 'class': 'marcador-base' }));
    var xp = px(o.ponto);
    svg.appendChild(s('polygon', { points: xp + ',' + (cy - 8) + ' ' + (xp + 7.5) + ',' + (cy + 6) + ' ' + (xp - 7.5) + ',' + (cy + 6), 'class': 'marcador-ano' }));
    return svg;
  }

  /* ---------- 5. os três ponteiros no ano escolhido ---------- */
  function minimoLiquidez(linhas) {
    var m = Math.min.apply(null, linhas.map(function (q) { return q.lr; }));
    return Math.max(-0.30, Math.min(-0.10, Math.floor(m / 0.05) * 0.05));
  }

  function configMedidores(ymin) {
    return [
      { chave: 'dc_rcl', nota: 'nDC', titulo: 'Endividamento', sub: 'Dívida consolidada em relação à receita corrente líquida',
        min: 0, max: 1.2, ticks: [0, 0.6, 1, 1.2],
        cortes: [{ de: 0, ate: 0.6, nota: 'A' }, { de: 0.6, ate: 1, nota: 'B' }, { de: 1, ate: 1.2, nota: 'C' }],
        regra: 'A nota A exige menos de 60%.' },
      { chave: 'pc', nota: 'nPC', titulo: 'Poupança corrente', sub: 'Despesa corrente em relação à receita corrente, média ponderada de três anos',
        min: 0.5, max: 1.1, ticks: [0.5, 0.85, 0.95, 1.1],
        cortes: [{ de: 0.5, ate: 0.85, nota: 'A' }, { de: 0.85, ate: 0.95, nota: 'B' }, { de: 0.95, ate: 1.1, nota: 'C' }],
        regra: 'Abaixo de 85% é nota A. Entre 85% e 95% a nota final continua A somente se a liquidez ficar em 5% ou mais.' },
      { chave: 'lr', nota: 'nLR', titulo: 'Liquidez relativa', sub: 'Caixa livre em relação à receita corrente líquida (escala invertida: mais caixa fica à esquerda)',
        min: ymin, max: 0.15, reverso: true, ticks: [ymin, 0, 0.05, 0.15],
        cortes: [{ de: ymin, ate: 0, nota: 'C' }, { de: 0, ate: 0.05, nota: 'B' }, { de: 0.05, ate: 0.15, nota: 'A' }],
        regra: 'Com 5% ou mais é nota A. Entre zero e 5% a nota final continua A somente se a poupança corrente ficar abaixo de 85%.' }
    ];
  }

  function montarMedidores(linhas, anoSel) {
    var base = linhas[0], l = linhas[anoSel - D.ano_base];
    var alvo = $('termometros'); limpar(alvo);
    configMedidores(minimoLiquidez(linhas)).forEach(function (m) {
      var aria = m.titulo + ': ' + pct(base[m.chave]) + ' em ' + D.ano_base + ' e ' + pct(l[m.chave]) + ' em ' + anoSel + '.';
      var svg = medidor({ min: m.min, max: m.max, reverso: m.reverso, cortes: m.cortes, ticks: m.ticks,
        fmtTick: function (v) { return pct(v, 0); }, base: base[m.chave], ponto: l[m.chave], aria: aria });
      alvo.appendChild(h('div', { 'class': 'termometro' }, [
        h('h3', { text: m.titulo }),
        h('p', { 'class': 'legenda', text: m.sub }),
        svg,
        h('p', { 'class': 'valores' }, [
          'Hoje (' + D.ano_base + '): ', h('strong', { text: pct(base[m.chave]) }), selo(base[m.nota]),
          '   Em ' + anoSel + ': ', h('strong', { text: pct(l[m.chave]) }), selo(l[m.nota])]),
        h('p', { 'class': 'nota', text: m.regra })
      ]));
    });
  }

  /* ---------- 6. mapa da nota final ---------- */
  function montarMapa(linhas, anoSel) {
    var alvo = $('mapa'); limpar(alvo);
    var estreito = W === ESTREITO;
    var H = estreito ? 400 : 420, L = estreito ? 50 : 64, R = W - 12, T = 12, B = H - 54;
    var X0 = 0.60, X1 = 1.05, Y0 = minimoLiquidez(linhas), Y1 = 0.15;
    function cl(v, a, b) { return Math.min(b, Math.max(a, v)); }
    function px(v) { return L + (cl(v, X0, X1) - X0) / (X1 - X0) * (R - L); }
    function py(v) { return B - (cl(v, Y0, Y1) - Y0) / (Y1 - Y0) * (B - T); }
    var l = linhas[anoSel - D.ano_base];
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Mapa da nota final por poupança corrente e liquidez. Em ' + anoSel + ' o Estado está em poupança ' + pct(l.pc) + ' e liquidez ' + pct(l.lr) + ', nota ' + l.final + '.' });
    var xs = [X0, 0.85, 0.95, X1], ys = [Y0, 0, 0.05, Y1];
    // Cada célula usa a própria tabela da portaria, com a dívida na faixa A.
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        var nota = M.notaFinal('A', M.notaPC((xs[i] + xs[i + 1]) / 2), M.notaLR((ys[j] + ys[j + 1]) / 2));
        var x = px(xs[i]), y = py(ys[j + 1]);
        svg.appendChild(s('rect', { x: x, y: y, width: px(xs[i + 1]) - x, height: py(ys[j]) - y, 'class': 'faixa-' + nota }));
        svg.appendChild(texto('text', { x: x + 20, y: y + 28, 'class': 'mapa-letra' + (nota === 'B' ? ' sobre-b' : '') }, nota));
      }
    }
    svg.appendChild(s('line', { x1: L, y1: B, x2: R, y2: B, 'class': 'mapa-eixo' }));
    svg.appendChild(s('line', { x1: L, y1: T, x2: L, y2: B, 'class': 'mapa-eixo' }));
    xs.forEach(function (v) { var x = px(v); svg.appendChild(texto('text', { x: x, y: B + 16, 'class': 'tique-rotulo' + (x > W - 24 ? ' fim' : '') }, pct(v, 0))); });
    ys.forEach(function (v) { svg.appendChild(texto('text', { x: L - 8, y: py(v) + 4, 'class': 'tique-rotulo eixo-y' }, pct(v, 0))); });
    svg.appendChild(texto('text', { x: (L + R) / 2, y: H - 22, 'class': 'mapa-titulo' }, estreito ? 'Poupança corrente (despesa corrente ÷ receita)' : 'Poupança corrente (despesa corrente em relação à receita corrente)'));
    svg.appendChild(texto('text', { x: (L + R) / 2, y: H - 6, 'class': 'mapa-titulo' }, estreito ? 'Mais à direita, mais comprometida' : 'Quanto mais à direita, mais comprometida a receita'));
    svg.appendChild(texto('text', { x: 12, y: (T + B) / 2, transform: 'rotate(-90 12 ' + ((T + B) / 2) + ')', 'class': 'mapa-titulo' }, estreito ? 'Liquidez (caixa livre)' : 'Liquidez relativa (caixa livre)'));

    // Trajetória ano a ano.
    svg.appendChild(s('polyline', { points: linhas.map(function (q) { return px(q.pc) + ',' + py(q.lr); }).join(' '), 'class': 'mapa-linha' }));
    linhas.forEach(function (q, k) {
      var sel = q.ano === anoSel;
      var ponto = s('circle', { cx: px(q.pc), cy: py(q.lr), r: sel ? 6.5 : 4, 'class': sel ? 'mapa-ponto-ano' : 'mapa-ponto' });
      ponto.appendChild(texto('title', {}, q.ano + ': poupança ' + pct(q.pc) + ', liquidez ' + pct(q.lr) + ', nota ' + q.final));
      svg.appendChild(ponto);
      var xr = px(q.pc), esquerda = k === 0 || xr > R - 40;
      svg.appendChild(texto('text', { x: xr + (esquerda ? -10 : 10), y: py(q.lr) + 4, 'class': 'mapa-rotulo', 'text-anchor': esquerda ? 'end' : 'start' }, String(q.ano)));
    });
    alvo.appendChild(svg);

    var fora = linhas.filter(function (q) { return q.nDC !== 'A'; })[0];
    $('aviso-mapa').textContent = (fora
      ? 'Atenção: a partir de ' + fora.ano + ' o endividamento passa de 60% da receita, o que por si só tira a nota A, e o mapa não mostra essa condição. '
      : 'Em todos os anos da simulação a dívida fica abaixo de 60% da receita, de modo que o mapa vale integralmente. ') +
      'O círculo cheio marca o ano escolhido (' + anoSel + ').';
  }

  /* ---------- 4. quanto cada válvula aguenta ---------- */
  function bissec(ok, bom, ruim) {
    for (var i = 0; i < 40; i++) { var m = (bom + ruim) / 2; if (ok(m)) bom = m; else ruim = m; }
    return bom;
  }

  function calcularValvulas(p) {
    function copia(mud) {
      var q = {};
      Object.keys(p).forEach(function (k) { q[k] = p[k]; });
      Object.keys(mud).forEach(function (k) { q[k] = mud[k]; });
      return q;
    }
    function mantem(q) { return M.primeiroAnoSemA(M.simular(D, q)) === null; }
    var liquido = Math.max(0, p.emenda + p.poderes - p.ajuste);
    var ate = ' até ' + M.ULTIMO_ANO;
    var lista = [];

    // 1. Gasto novo permanente líquido
    var em = M.espacoMaximo(D, p);
    var v1 = { titulo: 'Gasto novo permanente líquido', sub: 'Emendas e despesas dos Poderes a mais, descontada a compensação (R$ mi por ano em ' + M.ANO_INICIO_GASTO + ', crescendo com a receita)',
      melhor: 'menor', atual: liquido, min: 0, fmt: mi };
    if (em.valor === 0 && em.limite) {
      v1.estado = 'nunca';
      v1.frase = 'Mesmo sem nenhum gasto novo, as demais premissas fazem a nota deixar de ser A em ' + em.limite.ano + '.';
    } else if (em.limite === null) {
      v1.estado = 'sempre';
      v1.frase = 'Nestas condições, nenhum gasto novo dentro da escala derruba a nota A' + ate + '.';
    } else {
      v1.estado = 'normal'; v1.limite = em.valor;
      v1.frase = 'No cenário, o gasto novo líquido é de ' + mi(liquido) + ' por ano. O limite que preserva a nota A' + ate + ' é de ' + mi(em.valor) + ' por ano. ' +
        (liquido <= em.valor ? 'Sobra uma folga de ' + mi(em.valor - liquido) + '.' : 'O excesso é de ' + mi(liquido - em.valor) + '.');
    }
    v1.max = arredondar(Math.max(1000, (v1.limite || 0) * 1.4, liquido * 1.15), 250);
    lista.push(v1);

    // 2. Perda de receita com a reforma tributária, em fração da trajetória da nota técnica
    var ok2 = function (x) { return mantem(copia({ reforma: x })); };
    var fmt2 = function (x) { return num(x * 100, 0) + '% da nota técnica'; };
    var v2 = { titulo: 'Perda de receita com a reforma tributária', sub: 'Fração da perda estimada na nota técnica do autor (100% é a trajetória da nota, de 2029 a 2033)',
      melhor: 'menor', atual: p.reforma, min: 0, fmt: fmt2 };
    if (!ok2(0)) {
      v2.estado = 'nunca';
      var semGasto = function (x) { return mantem(copia({ reforma: x, emenda: 0, poderes: 0, ajuste: 0 })); };
      v2.frase = 'Com o gasto novo dos controles, a nota A já se perde mesmo sem nenhuma perda de receita.' +
        (!semGasto(0) ? '' : semGasto(3) ? ' Sem nenhum gasto novo, nem três vezes a perda da nota técnica derrubaria a nota A' + ate + '.'
          : ' Sem nenhum gasto novo, o limite seria de ' + num(bissec(semGasto, 0, 3) * 100, 0) + '% da perda da nota técnica, já que a perda sai do caixa livre e o caixa de hoje cobre pouco.');
    } else if (ok2(3)) {
      v2.estado = 'sempre';
      v2.frase = 'Nestas condições, nem três vezes a perda da nota técnica derruba a nota A' + ate + '.';
    } else {
      v2.estado = 'normal'; v2.limite = bissec(ok2, 0, 3);
      v2.frase = 'No cenário, a perda é de ' + num(p.reforma * 100, 0) + '% da trajetória da nota técnica. O limite que preserva a nota A' + ate + ' é de ' + num(v2.limite * 100, 0) + '%. ' +
        (p.reforma <= v2.limite ? 'Sobra uma folga de ' + num((v2.limite - p.reforma) * 100, 0) + ' pontos percentuais.' : 'O excesso é de ' + num((p.reforma - v2.limite) * 100, 0) + ' pontos percentuais.');
    }
    v2.max = Math.max(1.5, Math.ceil(Math.max((v2.limite || 0) * 1.5, p.reforma * 1.2) * 4) / 4);
    lista.push(v2);

    // 3. Formação de caixa livre (o que o histórico mostra que o Estado deixou de fazer desde 2022)
    var ok3 = function (x) { return mantem(copia({ deriva: x })); };
    var v3 = { titulo: 'Formação de caixa livre', sub: 'Variação anual do caixa livre sem contar o gasto novo (R$ mi por ano, valores correntes)',
      melhor: 'maior', atual: p.deriva, min: -500, fmt: sinal };
    var referencia = ' Entre 2018 e 2021 o caixa livre cresceu ' + mi(DERIVA_18_21) + ' por ano, em média, e entre 2021 e 2025 variou ' + sinal(DERIVA_MEDIA) + ' por ano.';
    if (ok3(-500)) {
      v3.estado = 'sempre';
      v3.frase = 'Nestas condições, a nota A' + ate + ' resiste mesmo com o caixa livre encolhendo R$ 500 mi por ano.';
    } else if (!ok3(5000)) {
      v3.estado = 'nunca';
      v3.frase = 'Nestas condições, nem um caixa livre crescendo R$ 5 bi por ano preserva a nota A' + ate + '.';
    } else {
      v3.estado = 'normal'; v3.limite = bissec(ok3, 5000, -500);
      v3.frase = 'No cenário, o caixa livre varia ' + sinal(p.deriva) + ' por ano. Para preservar a nota A' + ate + ', ele precisaria crescer ao menos ' + mi(v3.limite) + ' por ano, além de cobrir o gasto novo.' +
        (p.deriva >= v3.limite ? ' A conta fecha.' : ' Faltam ' + mi(v3.limite - p.deriva) + ' por ano.') + referencia;
    }
    v3.max = arredondar(Math.max(1000, (v3.limite || 0) * 1.3, p.deriva * 1.2), 250);
    lista.push(v3);

    // 4. Compensação necessária
    var total = p.emenda + p.poderes;
    var v4 = { titulo: 'Compensação necessária', sub: 'Corte de outras despesas, receita nova ou deslocamento de gasto, por ano (R$ mi em ' + M.ANO_INICIO_GASTO + ')',
      melhor: 'maior', atual: p.ajuste, min: 0, fmt: mi };
    if (v1.estado === 'nunca') {
      v4.estado = 'nunca';
      v4.frase = 'Compensar o gasto novo não basta: mesmo sem nenhum gasto novo, as demais premissas fazem a nota deixar de ser A em ' + em.limite.ano + '.';
    } else if (v1.estado === 'sempre' || total <= em.valor) {
      v4.estado = 'sempre';
      v4.frase = 'O gasto novo informado (' + mi(total) + ' por ano) cabe no espaço disponível, sem compensação.';
    } else {
      v4.estado = 'normal'; v4.limite = total - em.valor;
      v4.frase = 'Para preservar a nota A' + ate + ', é preciso compensar ao menos ' + mi(v4.limite) + ' por ano do gasto novo de ' + mi(total) + '. No cenário, a compensação é de ' + mi(p.ajuste) + '. ' +
        (p.ajuste >= v4.limite ? 'A conta fecha.' : 'Faltam ' + mi(v4.limite - p.ajuste) + '.');
    }
    v4.max = arredondar(Math.max(500, total, (v4.limite || 0) * 1.2), 250);
    lista.push(v4);
    return lista;
  }

  function montarValvulas(p) {
    var alvo = $('valvulas'); limpar(alvo);
    calcularValvulas(p).forEach(function (v) {
      var c;
      if (v.estado === 'sempre') c = [{ de: v.min, ate: v.max, nota: 'A', rotulo: 'mantém a nota A em toda a escala' }];
      else if (v.estado === 'nunca') c = [{ de: v.min, ate: v.max, nota: 'C', rotulo: 'a nota A já se perde' }];
      else if (v.melhor === 'menor') c = [{ de: v.min, ate: v.limite, nota: 'A', rotulo: 'mantém a nota A' }, { de: v.limite, ate: v.max, nota: 'C', rotulo: 'perde a nota A' }];
      else c = [{ de: v.min, ate: v.limite, nota: 'C', rotulo: 'perde a nota A' }, { de: v.limite, ate: v.max, nota: 'A', rotulo: 'mantém a nota A' }];
      var ticks = v.estado === 'normal' ? [v.min, v.limite, v.max] : [v.min, v.max];
      var svg = medidor({ min: v.min, max: v.max, cortes: c, ticks: ticks,
        fmtTick: function (x) { return v.fmt(x).replace(' por ano', '').replace(' ao ano', ''); },
        ponto: v.atual, rotulosAcima: true, aria: v.titulo + '. ' + v.frase });
      alvo.appendChild(h('div', { 'class': 'termometro valvula' }, [
        h('h3', { text: v.titulo }), h('p', { 'class': 'legenda', text: v.sub }), svg, h('p', { 'class': 'valores', text: v.frase })]));
    });
  }

  /* ---------- 7. ano a ano ---------- */
  function montarBalde(linhas) {
    var alvo = $('graf-balde'); limpar(alvo);
    alvo.appendChild(barras({ rotulos: linhas.map(function (q) { return q.ano; }), rotulos2: linhas.map(function (q) { return pct(q.lr, 1); }),
      fmt: function (v) { return num(v, 2); }, altura: 240,
      series: [{ valores: linhas.map(function (q) { return q.caixa; }), classe: 'faixa-A', rotular: true }],
      classeDe: function (i) { return 'faixa-' + linhas[i].nLR; },
      aria: 'Caixa livre projetado de ' + linhas[0].ano + ' a ' + linhas[linhas.length - 1].ano + ', em R$ bilhões, colorido pela faixa da liquidez.' }));
  }

  function montarTabelaAnos(linhas, anoSel) {
    function celula(valor, nota) { return h('td', { 'class': 'num' }, [valor, nota ? selo(nota) : null]); }
    var cab = h('thead', {}, [h('tr', {}, [
      h('th', { text: 'Ano' }), h('th', { 'class': 'num', text: 'Gasto novo no ano' }), h('th', { 'class': 'num', text: 'Perda de receita no ano' }),
      h('th', { 'class': 'num', text: 'Endividamento' }), h('th', { 'class': 'num', text: 'Poupança corrente' }),
      h('th', { 'class': 'num', text: 'Liquidez' }), h('th', { text: 'Nota final' })])]);
    var linhasHtml = [];
    D.historico.filter(function (q) { return q.ano < D.ano_base; }).forEach(function (q) {
      linhasHtml.push(h('tr', { 'class': 'real' }, [
        h('td', { text: q.ano + ' (realizado)' }), h('td', { 'class': 'num', text: '' }), h('td', { 'class': 'num', text: '' }),
        celula(pct(q.dc_rcl), M.notaDC(q.dc_rcl)), celula(pct(q.pc), M.notaPC(q.pc)),
        celula(q.lr === null ? 'n/d' : pct(q.lr), q.lr === null ? null : M.notaLR(q.lr)), h('td', {}, [selo(q.nota)])]));
    });
    linhas.forEach(function (q) {
      var classe = (q.final !== 'A' ? 'perde ' : '') + (q.ano === anoSel ? 'atual' : '');
      linhasHtml.push(h('tr', { 'class': classe.trim() }, [
        h('td', { text: q.ano === D.ano_base ? q.ano + ' (estimado)' : q.ano + ' (projeção)' }),
        h('td', { 'class': 'num', text: mi(q.extra * 1000) }), h('td', { 'class': 'num', text: mi(q.perda * 1000) }),
        celula(pct(q.dc_rcl), q.nDC), celula(pct(q.pc), q.nPC), celula(pct(q.lr), q.nLR), h('td', {}, [selo(q.final)])]));
    });
    var alvo = $('tabela-anos'); limpar(alvo);
    alvo.appendChild(h('table', { 'aria-label': 'Indicadores e nota final por ano' }, [cab, h('tbody', {}, linhasHtml)]));
  }

  /* ---------- 3. controles e conclusão ---------- */
  var HIST = D.historico_caixa;
  var DERIVA_MEDIA = (ano(2025).caixa_livre - ano(2021).caixa_livre) / 4 * 1000;
  var DERIVA_18_21 = (ano(2021).caixa_livre - ano(2018).caixa_livre) / 3 * 1000;
  // Valores iniciais: as premissas centrais das tabelas T1 e T3 (reforma em 100%, a trajetória da nota técnica).
  var PADRAO = { receita_pp: 0, pressao: 0, emenda: D.extras_padrao.emenda, poderes: D.extras_padrao.poderes, poderes_rcl: 1, ajuste: 0, reforma: 100, deriva: 0 };
  function sinal(v) { return (v < 0 ? '-' : v > 0 ? '+' : '') + mi(Math.abs(v)); }
  var CONTROLES = [
    { id: 'receita_pp', rotulo: 'Crescimento da receita em relação ao estudo do autor', min: -3, max: 3, passo: 0.25,
      fmt: function (v) { return (v > 0 ? '+' : '') + num(v, 2) + ' ponto percentual por ano'; },
      ajuda: 'Zero usa o PIB real mais o IPCA do Focus e da IFI (5,3% a 5,9% ao ano). A receita corrente ajustada cresceu 7,9% ao ano de 2019 a 2025. Neste modelo, crescer mais não folga a nota, porque a despesa acompanha a receita e o caixa livre não cresceu junto com ela em 2021 a 2025.' },
    { id: 'pressao', rotulo: 'Despesa que já existe crescendo acima da receita', min: 0, max: 3, passo: 0.25,
      fmt: function (v) { return '+' + num(v, 2) + ' ponto percentual por ano'; },
      ajuda: 'Zero faz a despesa existente crescer com a receita, como de 2019 a 2025 (7,9% ao ano as duas). Um valor positivo supõe que a despesa foge da receita, o que consome o caixa livre e sobe a poupança corrente.' },
    { id: 'emenda', rotulo: 'Emendas parlamentares impositivas a mais', min: 0, max: 1000, passo: 1, fmt: function (v) { return mi(v) + ' por ano'; },
      ajuda: 'Conferido na imprensa: teto de 1,55% da receita corrente líquida, R$ 435 mi em 2027 contra R$ 90 mi antes. O valor inicial desconta o crescimento que os R$ 90 mi teriam de qualquer forma, e o acréscimo cresce com a receita.' },
    { id: 'poderes', rotulo: 'Despesas dos Poderes e órgãos a mais, em 2027', min: 0, max: 1500, passo: 1, fmt: function (v) { return mi(v) + ' por ano'; },
      ajuda: 'Tabela do autor: limites de R$ 2.989 mi na LDO 2026 e de R$ 3.505 mi na LDO 2027. Pela regra antiga o limite de 2026 seria corrigido pelo IPCA e chegaria a R$ 3.116 mi; o valor inicial é o que excede isso. O cenário T2 usa R$ 100 mi.' },
    { id: 'poderes_rcl', rotulo: 'Percentuais da RCL dos Poderes seguem valendo depois de 2027', tipo: 'caixa',
      ajuda: 'Marcado, o limite dos Poderes continua um percentual da receita e por isso se afasta, ano a ano, do que o IPCA daria (é o que acontece nos cenários T1 e T3). Desmarcado, o acréscimo é só o valor de 2027 corrigido com a receita.' },
    { id: 'ajuste', rotulo: 'Compensação por corte, receita nova ou deslocamento', min: 0, max: 1500, passo: 10, fmt: function (v) { return mi(v) + ' por ano'; },
      ajuda: 'Parte do gasto novo coberta por corte de outras despesas, por receita nova ou por deslocamento de gasto que seria executado de qualquer forma, já que a emenda deve indicar a despesa anulada. Começa em zero.' },
    { id: 'reforma', rotulo: 'Perda de receita com a reforma tributária', min: 0, max: 200, passo: 5, escala: 0.01, fmt: function (v) { return num(v, 0) + '% da nota técnica'; },
      ajuda: 'A nota técnica do autor estima perdas de R$ 217 mi em 2029 a R$ 1,5 bi em 2033, a preços de 2025 (R$ 3,57 bi no total). Cem por cento é essa trajetória, levada a valores correntes. O botão de 63% supõe que as vinculações de saúde e educação absorvam 37% da perda.',
      botoes: [['Sem reforma', 0], ['Nota técnica', 100], ['Vinculações absorvem 37%', 63]] },
    { id: 'deriva', rotulo: 'Variação anual do caixa livre sem o gasto novo', min: -500, max: 1000, passo: 10, fmt: function (v) { return sinal(v) + ' por ano'; },
      ajuda: 'Zero mantém o caixa constante em valor, como entre 2021 e 2025. A variação média desse período foi de ' + sinal(DERIVA_MEDIA) + ' por ano, com anos de menos R$ 540 mi e de mais R$ 200 mi.' }
  ];
  var anoSel = 2029, anoTocado = false;

  function lerControles() {
    var p = {};
    CONTROLES.forEach(function (c) {
      var el = $('c-' + c.id);
      if (c.tipo === 'caixa') { p[c.id] = el.checked ? 1 : 0; $('o-' + c.id).textContent = el.checked ? 'sim' : 'não'; return; }
      var v = parseFloat(el.value);
      $('o-' + c.id).textContent = c.fmt(v);
      p[c.id] = v * (c.escala || 1);
    });
    return p;
  }

  function colocar(c, valor) {
    var el = $('c-' + c.id);
    if (c.tipo === 'caixa') el.checked = !!valor; else el.value = valor;
  }

  function montarControles() {
    var alvo = $('controles'); limpar(alvo);
    CONTROLES.forEach(function (c) {
      var inp = c.tipo === 'caixa' ? h('input', { type: 'checkbox', id: 'c-' + c.id }) : h('input', { type: 'range', id: 'c-' + c.id, min: c.min, max: c.max, step: c.passo });
      if (c.tipo === 'caixa') inp.checked = !!PADRAO[c.id]; else inp.value = PADRAO[c.id];
      inp.addEventListener(c.tipo === 'caixa' ? 'change' : 'input', render);
      var botoes = null;
      if (c.botoes) {
        botoes = h('div', { 'class': 'presets' }, c.botoes.map(function (b) {
          var bt = h('button', { type: 'button', text: b[0] });
          bt.addEventListener('click', function () { inp.value = b[1]; render(); });
          return bt;
        }));
      }
      alvo.appendChild(h('div', { 'class': 'controle' }, [
        h('div', { 'class': 'topo' }, [h('label', { 'for': 'c-' + c.id, text: c.rotulo }), h('output', { id: 'o-' + c.id, 'for': 'c-' + c.id })]),
        inp, botoes, h('p', { 'class': 'ajuda', text: c.ajuda })]));
    });
  }

  function motivo(l) {
    if (l.causa === 'liquidez') return 'O primeiro ponteiro a ceder é a liquidez relativa, que chega a ' + pct(l.lr) + ' da receita. Isso significa que as obrigações passam a superar o caixa livre, e a portaria dá nota C à liquidez igual ou inferior a zero.';
    if (l.causa === 'poupança corrente') return 'O primeiro ponteiro a ceder é a poupança corrente, que sobe para ' + pct(l.pc) + ', acima do limite de 95%.';
    if (l.causa === 'endividamento') return 'O primeiro ponteiro a ceder é o endividamento, que chega a ' + pct(l.dc_rcl) + ' da receita, acima do limite de 60%.';
    return 'A poupança corrente (' + pct(l.pc) + ') passou de 85% e a liquidez (' + pct(l.lr) + ') ficou abaixo de 5%. A portaria aceita uma das duas folgas curtas, mas não as duas ao mesmo tempo.';
  }

  function montarConclusao(p, linhas) {
    var perde = M.primeiroAnoSemA(linhas);
    var caixa = $('conclusao'); limpar(caixa);
    caixa.className = 'conclusao' + (perde ? ' alerta' : '');
    var liquido = Math.max(0, p.emenda + p.poderes - p.ajuste);
    var em = M.espacoMaximo(D, p);
    var t1 = perde
      ? 'Com estas premissas, a nota deixa de ser A em ' + perde.ano + ' e passa a ser ' + perde.final + '. ' + motivo(perde)
      : 'Com estas premissas, a nota A se mantém em todos os anos até ' + M.ULTIMO_ANO + '.';
    var t2;
    if (em.valor === 0 && em.limite) t2 = 'Mesmo sem nenhum gasto novo, as demais premissas (perda de receita, crescimento e variação do caixa) fazem a nota deixar de ser A em ' + em.limite.ano + '.';
    else if (em.limite === null) t2 = 'Com este crescimento e esta perda de receita, o espaço para gasto novo permanente é superior a ' + mi(em.valor) + ' por ano.';
    else t2 = 'Com este crescimento e esta perda de receita, o gasto novo permanente líquido não pode passar de ' + mi(em.valor) + ' por ano, em valores de ' + M.ANO_INICIO_GASTO + ', para a nota A durar até ' + M.ULTIMO_ANO +
      '. No cenário ele é de ' + mi(liquido) + (liquido > em.valor ? ', ou seja, ' + mi(liquido - em.valor) + ' acima do limite.' : ', o que deixa uma folga de ' + mi(em.valor - liquido) + '.');
    anexar(caixa, [h('p', { text: t1 }), h('p', { text: t2 })]);
    return perde;
  }

  function render() {
    W = medirLargura();
    var p = lerControles();
    var linhas = M.simular(D, p);
    var perde = montarConclusao(p, linhas);
    var seletor = $('ano');
    if (!anoTocado) anoSel = perde ? perde.ano : M.ULTIMO_ANO;
    seletor.value = anoSel;
    $('ano-valor').textContent = anoSel;
    montarValvulas(p);
    montarMedidores(linhas, anoSel);
    montarMapa(linhas, anoSel);
    montarBalde(linhas);
    montarTabelaAnos(linhas, anoSel);
    montarEvidencias();
    montarVerificacao();
  }

  /* ---------- partida ---------- */
  function iniciar() {
    var seletor = $('ano');
    seletor.min = D.ano_base + 1; seletor.max = M.ULTIMO_ANO;
    seletor.addEventListener('input', function () { anoSel = parseInt(seletor.value, 10); anoTocado = true; render(); });
    $('restaurar').addEventListener('click', function () {
      CONTROLES.forEach(function (c) { colocar(c, PADRAO[c.id]); });
      anoTocado = false; render();
    });
    montarTabelaEspaco();
    montarControles();
    render();
    window.addEventListener('resize', function () { if (medirLargura() !== W) render(); });
  }
  iniciar();
})();
