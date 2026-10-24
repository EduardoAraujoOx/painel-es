// Interface da página de diagnóstico fiscal. Depende de dados.js (window.DADOS) e de modelo.js (window.Modelo).
// Sem estilos nem scripts embutidos: a política de segurança do painel (vercel.json) só admite arquivos do próprio domínio.
(function () {
  'use strict';
  var D = window.DADOS, M = window.Modelo;
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
  function bi(x) { return 'R$ ' + num(x, 2) + ' bi'; }
  function mi(x) { return 'R$ ' + num(Math.round(x), 0) + ' mi'; }
  function pp(x) { return num(x, 1) + ' pontos percentuais'; }
  function arredondar(x, passo) { return Math.ceil(x / passo) * passo; }
  function selo(nota) { return h('span', { 'class': 'letra n' + nota, text: nota }); }

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
      h('th', { text: 'Ponteiro' }), h('th', { text: 'Hoje (' + D.ano_base + ')' }), h('th', { text: 'Limites da nota A' }),
      h('th', { text: 'Folga em reais' }), h('th', { text: 'O que consome a folga' })])]);
    var corpo = h('tbody', {}, linhas.map(function (l) {
      function bloco(itens) { return itens.map(function (t) { return h('div', { text: t }); }); }
      return h('tr', {}, [
        h('td', { 'class': 'nome', 'data-rotulo': 'Ponteiro', text: l.nome }),
        h('td', { 'data-rotulo': 'Hoje (' + D.ano_base + ')' }, [h('span', { 'class': 'destaque-num', text: l.hoje }), selo(l.nota)]),
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
    o.ticks.forEach(function (v) {
      var x = px(v);
      svg.appendChild(s('line', { x1: x, y1: Y + ALT, x2: x, y2: Y + ALT + 5, 'class': 'tique' }));
      svg.appendChild(texto('text', { x: x, y: Y + ALT + 18, 'class': 'tique-rotulo' + (x < 44 ? ' ini' : x > W - 44 ? ' fim' : '') }, o.fmtTick(v)));
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

  /* ---------- 4. os três ponteiros no ano escolhido ---------- */
  var MEDIDORES = [
    { chave: 'dc_rcl', nota: 'nDC', titulo: 'Endividamento', sub: 'Dívida consolidada em relação à receita corrente líquida',
      min: 0, max: 1.2, ticks: [0, 0.6, 1, 1.2],
      cortes: [{ de: 0, ate: 0.6, nota: 'A' }, { de: 0.6, ate: 1, nota: 'B' }, { de: 1, ate: 1.2, nota: 'C' }],
      regra: 'A nota A exige menos de 60%.' },
    { chave: 'pc', nota: 'nPC', titulo: 'Poupança corrente', sub: 'Despesa corrente em relação à receita corrente, média ponderada de três anos',
      min: 0.5, max: 1.1, ticks: [0.5, 0.85, 0.95, 1.1],
      cortes: [{ de: 0.5, ate: 0.85, nota: 'A' }, { de: 0.85, ate: 0.95, nota: 'B' }, { de: 0.95, ate: 1.1, nota: 'C' }],
      regra: 'Abaixo de 85% é nota A. Entre 85% e 95% a nota final continua A somente se a liquidez ficar em 5% ou mais.' },
    { chave: 'lr', nota: 'nLR', titulo: 'Liquidez relativa', sub: 'Caixa livre em relação à receita corrente líquida (escala invertida: mais caixa fica à esquerda)',
      min: -0.10, max: 0.15, reverso: true, ticks: [-0.10, 0, 0.05, 0.15],
      cortes: [{ de: -0.10, ate: 0, nota: 'C' }, { de: 0, ate: 0.05, nota: 'B' }, { de: 0.05, ate: 0.15, nota: 'A' }],
      regra: 'Com 5% ou mais é nota A. Entre zero e 5% a nota final continua A somente se a poupança corrente ficar abaixo de 85%.' }
  ];

  function montarMedidores(linhas, anoSel) {
    var base = linhas[0], l = linhas[anoSel - D.ano_base];
    var alvo = $('termometros'); limpar(alvo);
    MEDIDORES.forEach(function (m) {
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

  /* ---------- 5. mapa da nota final ---------- */
  function montarMapa(linhas, anoSel) {
    var alvo = $('mapa'); limpar(alvo);
    var estreito = W === ESTREITO;
    var H = estreito ? 400 : 420, L = estreito ? 50 : 64, R = W - 12, T = 12, B = H - 54;
    var X0 = 0.60, X1 = 1.05, Y0 = -0.10, Y1 = 0.15;
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

  /* ---------- 3. quanto cada válvula aguenta ---------- */
  function bissec(ok, bom, ruim) {
    for (var i = 0; i < 40; i++) { var m = (bom + ruim) / 2; if (ok(m)) bom = m; else ruim = m; }
    return bom;
  }

  function calcularValvulas(p) {
    function copia(mud) {
      var q = { crescimento: p.crescimento, emenda: p.emenda, poderes: p.poderes, ajuste: p.ajuste, perda: p.perda };
      Object.keys(mud).forEach(function (k) { q[k] = mud[k]; });
      return q;
    }
    function mantem(q) { return M.primeiroAnoSemA(M.simular(D, q)) === null; }
    var liquido = Math.max(0, p.emenda + p.poderes - p.ajuste);
    var ate = ' até ' + M.ULTIMO_ANO;
    var lista = [];

    // 1. Gasto novo permanente líquido
    var em = M.espacoMaximo(D, p);
    var v1 = { titulo: 'Gasto novo permanente líquido', sub: 'Emendas e despesas dos Poderes a mais, descontada a compensação (R$ mi por ano)',
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

    // 2. Perda de receita com a reforma tributária
    var ok2 = function (x) { return mantem(copia({ perda: x })); };
    var v2 = { titulo: 'Perda de receita com a reforma tributária', sub: 'Percentual da receita corrente perdido ao fim de ' + M.ULTIMO_ANO,
      melhor: 'menor', atual: p.perda, min: 0, fmt: function (x) { return num(x, 1) + '%'; } };
    if (!ok2(0)) {
      v2.estado = 'nunca';
      v2.frase = 'Com o gasto novo e o crescimento dos controles, a nota A já se perde mesmo sem nenhuma perda de receita.';
    } else if (ok2(30)) {
      v2.estado = 'sempre';
      v2.frase = 'Nestas condições, nem uma perda de 30% da receita derruba a nota A' + ate + '.';
    } else {
      v2.estado = 'normal'; v2.limite = bissec(ok2, 0, 30);
      v2.frase = 'No cenário, a perda chega a ' + num(p.perda, 1) + '% da receita corrente. O limite que preserva a nota A' + ate + ' é de ' + num(v2.limite, 1) + '%. ' +
        (p.perda <= v2.limite ? 'Sobra uma folga de ' + pp(v2.limite - p.perda) + '.' : 'O excesso é de ' + pp(p.perda - v2.limite) + '.');
    }
    v2.max = Math.max(6, Math.ceil(Math.max((v2.limite || 0) * 1.5, p.perda * 1.2)));
    lista.push(v2);

    // 3. Crescimento nominal da receita
    var ok3 = function (x) { return mantem(copia({ crescimento: x })); };
    var v3 = { titulo: 'Crescimento da receita', sub: 'Taxa nominal ao ano, igual para a receita e a despesa que já existem',
      melhor: 'maior', atual: p.crescimento, min: 0, max: 12, fmt: function (x) { return num(x, 1) + '% ao ano'; } };
    if (ok3(-5)) {
      v3.estado = 'sempre';
      v3.frase = 'Nestas condições, a nota A' + ate + ' resiste mesmo com a receita encolhendo.';
    } else if (!ok3(15)) {
      v3.estado = 'nunca';
      v3.frase = 'Nestas condições, nem um crescimento de 15% ao ano preserva a nota A' + ate + '.';
    } else {
      v3.estado = 'normal'; v3.limite = bissec(ok3, 15, -5);
      v3.frase = 'No cenário, a receita cresce ' + num(p.crescimento, 1) + '% ao ano. Para preservar a nota A' + ate + ' é preciso crescer ao menos ' + num(v3.limite, 1) + '% ao ano. ' +
        (p.crescimento >= v3.limite ? 'Sobra uma folga de ' + pp(p.crescimento - v3.limite) + '.' : 'Faltam ' + pp(v3.limite - p.crescimento) + '.') +
        (v3.limite > 10 ? ' Um ritmo acima de 10% ao ano dificilmente se sustenta por tantos anos, de modo que o crescimento sozinho não resolve.' : '');
      v3.max = Math.max(12, Math.ceil(v3.limite + 1));
    }
    lista.push(v3);

    // 4. Compensação necessária
    var total = p.emenda + p.poderes;
    var v4 = { titulo: 'Compensação necessária', sub: 'Corte de outras despesas ou receita nova, por ano (R$ mi)',
      melhor: 'maior', atual: p.ajuste, min: 0, fmt: mi };
    if (v1.estado === 'nunca') {
      v4.estado = 'nunca';
      v4.frase = 'Nenhuma compensação resolve, porque a nota já se perde sem gasto novo.';
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

  /* ---------- 6. tabela ano a ano ---------- */
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
        h('td', { text: q.ano === D.ano_base ? q.ano + ' (realizado)' : q.ano + ' (projeção)' }),
        h('td', { 'class': 'num', text: mi(q.extra * 1000) }), h('td', { 'class': 'num', text: mi(q.perda * 1000) }),
        celula(pct(q.dc_rcl), q.nDC), celula(pct(q.pc), q.nPC), celula(pct(q.lr), q.nLR), h('td', {}, [selo(q.final)])]));
    });
    var alvo = $('tabela-anos'); limpar(alvo);
    alvo.appendChild(h('table', { 'aria-label': 'Indicadores e nota final por ano' }, [cab, h('tbody', {}, linhasHtml)]));
  }

  /* ---------- 2. controles e conclusão ---------- */
  var PADRAO = { crescimento: 5, emenda: D.extras_padrao.emenda, poderes: D.extras_padrao.poderes, ajuste: 0, perda: 0 };
  var CONTROLES = [
    { id: 'crescimento', rotulo: 'Crescimento da receita e da despesa existentes', min: 0, max: 10, passo: 0.5,
      fmt: function (v) { return num(v, 1) + '% ao ano'; },
      ajuda: 'Taxa nominal, igual para a receita e para a despesa que já existem. Quanto maior, menor o peso relativo do gasto novo.' },
    { id: 'emenda', rotulo: 'Emendas parlamentares impositivas a mais', min: 0, max: 1000, passo: 5, fmt: function (v) { return mi(v) + ' por ano'; },
      ajuda: 'Valor informado: o limite passa de R$ 90 mi para R$ 435 mi, uma diferença de R$ 345 mi. A confirmar no texto da lei.' },
    { id: 'poderes', rotulo: 'Despesas dos Poderes e órgãos a mais', min: 0, max: 1500, passo: 10, fmt: function (v) { return mi(v) + ' por ano'; },
      ajuda: 'Valor informado: cerca de R$ 300 mi acima da proposta original e cerca de R$ 500 mi acima da lei do ano anterior. O valor inicial usa R$ 500 mi.' },
    { id: 'ajuste', rotulo: 'Compensação por corte ou receita nova', min: 0, max: 1500, passo: 10, fmt: function (v) { return mi(v) + ' por ano'; },
      ajuda: 'Parte do gasto novo que seria coberta por corte de outras despesas ou por receita nova. Começa em zero, que é o caso de nada ser feito.' },
    { id: 'perda', rotulo: 'Perda de receita com a reforma tributária', min: 0, max: 10, passo: 0.5, fmt: function (v) { return num(v, 1) + '% da receita'; },
      ajuda: 'Percentual da receita corrente perdido ao fim de ' + M.ULTIMO_ANO + ', em quatro etapas iguais de 2029 a 2032. Começa em zero para isolar o efeito da diretriz orçamentária.' }
  ];
  var anoSel = 2029, anoTocado = false;

  function lerControles() {
    var p = {};
    CONTROLES.forEach(function (c) {
      p[c.id] = parseFloat($('c-' + c.id).value);
      $('o-' + c.id).textContent = c.fmt(p[c.id]);
    });
    return p;
  }

  function montarControles() {
    var alvo = $('controles'); limpar(alvo);
    CONTROLES.forEach(function (c) {
      var inp = h('input', { type: 'range', id: 'c-' + c.id, min: c.min, max: c.max, step: c.passo, value: PADRAO[c.id] });
      inp.addEventListener('input', render);
      alvo.appendChild(h('div', { 'class': 'controle' }, [
        h('div', { 'class': 'topo' }, [h('label', { 'for': 'c-' + c.id, text: c.rotulo }), h('output', { id: 'o-' + c.id, 'for': 'c-' + c.id })]),
        inp, h('p', { 'class': 'ajuda', text: c.ajuda })]));
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
    if (em.valor === 0 && em.limite) t2 = 'Mesmo sem nenhum gasto novo, as demais premissas (crescimento e perda de receita) fazem a nota deixar de ser A em ' + em.limite.ano + '.';
    else if (em.limite === null) t2 = 'Com este crescimento e esta perda de receita, o espaço para gasto novo permanente é superior a ' + mi(em.valor) + ' por ano.';
    else t2 = 'Com este crescimento e esta perda de receita, o gasto novo permanente líquido não pode passar de ' + mi(em.valor) + ' por ano para a nota A durar até ' + M.ULTIMO_ANO +
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
    montarTabelaAnos(linhas, anoSel);
  }

  /* ---------- partida ---------- */
  function iniciar() {
    var seletor = $('ano');
    seletor.min = D.ano_base + 1; seletor.max = M.ULTIMO_ANO;
    seletor.addEventListener('input', function () { anoSel = parseInt(seletor.value, 10); anoTocado = true; render(); });
    $('restaurar').addEventListener('click', function () {
      CONTROLES.forEach(function (c) { $('c-' + c.id).value = PADRAO[c.id]; });
      anoTocado = false; render();
    });
    montarTabelaEspaco();
    montarControles();
    render();
    window.addEventListener('resize', function () { if (medirLargura() !== W) render(); });
  }
  iniciar();
})();
