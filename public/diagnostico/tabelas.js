// Tabelas de verificação da página: histórico e projeção da nota, com numerador, denominador, razão e distância do limite de cada ponteiro.
// Monta só os dados das tabelas (texto das células, notas, destaques); quem desenha é a página (DOM) ou o gerador de imagens (HTML).
// Depende de modelo.js. Valores monetários em R$ bilhões nas tabelas, salvo onde o rótulo disser R$ mi.
(function (raiz, M) {
  function num(x, c) {
    var s = Math.abs(x).toFixed(c), p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (x < 0 && Number(s) !== 0 ? '-' : '') + p.join(',');
  }
  function pct(x, c) { return num(x * 100, c === undefined ? 1 : c) + '%'; }
  function bi(x) { return num(x, 2); }
  function mi(x) { return num(Math.round(x), 0); }
  function pp(x) { return num(x, 1); }
  var TRACO = '-';

  // Linha de dados de cada coluna (ano) para um cenário: realizado (2021 a 2025), estimativa de 2026 e projeção.
  // Para o modo novo, traz também o histórico de emendas e de despesa dos Poderes (Sigefes, valor pago, R$ mi), a referência de 2026 corrigida
  // pela RCL, o acréscimo de despesa e a variação do caixa livre no ano.
  function colunas(D, cen) {
    var sim = M.simular(D, cen.p), cols = [], N = cen.p.novo, hist = D.sigefes && D.sigefes.historico ? D.sigefes.historico : null;
    var H0 = D.historico_caixa.filter(function (q) { return q.ano === 2020; })[0];
    var rcl20 = H0.rcl, anterior = rcl20, caixaAnt = H0.caixa_livre;
    function hist1(chave, ano) { return hist && hist[chave] && hist[chave][String(ano)] !== undefined ? hist[chave][String(ano)] : null; }
    D.tabela_historica.forEach(function (h) {
      var lr = h.lr, nDC = M.notaDC(h.dc_rcl), nPC = M.notaPC(h.pc), nLR = M.notaLR(lr);
      cols.push({ ano: h.ano, tipo: 'real', rotulo: String(h.ano), g: h.rcl / anterior - 1, divida: h.divida, rcl: h.rcl, dc_rcl: h.dc_rcl, despesa: h.despesa, rca: h.rca,
        razao: h.razao, pc: h.pc, caixa: h.caixa, lr: lr, nDC: nDC, nPC: nPC, nLR: nLR, final: M.notaFinal(nDC, nPC, nLR), extra: null, perda: null,
        reconstruida: h.nota_final === null, emBruta: null, podBruto: null, base: null, pressao: null,
        emMi: hist1('emendas_pago_mi', h.ano), podMi: hist1('poderes_pago_mi', h.ano), refMi: null, extraMi: null, pressMi: null, dCaixaMi: (h.caixa - caixaAnt) * 1000 });
      anterior = h.rcl; caixaAnt = h.caixa;
    });
    sim.forEach(function (l, i) {
      var cresc = i === 0 ? D.base.crescimento_ano.rcl : l.rcl / anterior - 1; // crescimento da RCL já líquido da perda de receita
      anterior = l.rcl;
      var c = { ano: l.ano, tipo: i === 0 ? 'estimado' : 'projecao', rotulo: i === 0 ? l.ano + 'e' : String(l.ano), g: cresc,
        divida: l.divida, rcl: l.rcl, dc_rcl: l.dc_rcl, despesa: l.despesa, rca: l.rca, razao: l.razao, pc: l.pc, caixa: l.caixa, lr: l.lr,
        nDC: l.nDC, nPC: l.nPC, nLR: l.nLR, final: l.final, extra: i === 0 ? null : l.extra, perda: i === 0 ? null : l.perda,
        emBruta: i === 0 ? null : l.emendaBruta, podBruto: i === 0 ? null : l.poderesBruto, base: i === 0 ? null : l.emendaBase + l.poderesBase, pressao: i === 0 ? null : l.pressao,
        emMi: null, podMi: null, refMi: null, extraMi: null, pressMi: null, dCaixaMi: (l.caixa - caixaAnt) * 1000 };
      caixaAnt = l.caixa;
      if (N && i === 0) { c.emMi = N.emenda_base_mi; c.podMi = N.poderes_base_2026_mi; c.refMi = N.emenda_base_mi + N.poderes_base_2026_mi; }
      if (N && i > 0) { c.emMi = l.emendaBruta * 1000; c.podMi = l.poderesBruto * 1000; c.refMi = (l.emendaBase + l.poderesBase) * 1000; c.extraMi = l.extra * 1000; c.pressMi = l.pressao * 1000; }
      cols.push(c);
    });
    return cols;
  }

  // Tabela de cenário do modo novo (gasto medido contra a execução de 2026): fatores de variação, três indicadores numerados com a mesma
  // estrutura (numerador, denominador, razão, nota do indicador, distância até o limite) e a nota final.
  // Cada linha traz tipo: 'dado', 'razao' (razão do indicador), 'nota' (nota do indicador), 'distancia', 'piso' (distância até o piso de 5%) ou 'final'.
  function cenarioNovo(D, cen, cols) {
    function linha(rotulo, f, tipo, opt) {
      opt = opt || {};
      return { rotulo: rotulo, tipo: tipo || 'dado', destaque: !!opt.destaque, celulas: cols.map(function (c) {
        var v = f(c);
        if (v === null || v === undefined) return { t: TRACO, vazio: true };
        return typeof v === 'string' ? { t: v } : { t: v.t, nota: v.nota || null };
      }) };
    }
    var nota = function (campo) { return function (c) { return c[campo]; }; };
    var grupos = [
      { titulo: 'Fatores de variação anual', linhas: [
        linha('Crescimento nominal da RCL (%)', function (c) { return pct(c.g, 1); }),
        linha('Emendas parlamentares impositivas (R$ mi)', function (c) { return c.emMi === null ? null : mi(c.emMi); }),
        linha('Despesa dos Poderes, recursos não vinculados (R$ mi)', function (c) { return c.podMi === null ? null : mi(c.podMi); }),
        linha('Referência: 2026 corrigido pela RCL (R$ mi)', function (c) { return c.refMi === null ? null : mi(c.refMi); }),
        linha('Acréscimo de despesa sobre a referência (R$ mi)', function (c) { return c.extraMi === null ? null : mi(c.extraMi); }, 'dado', { destaque: true }),
        linha('Demais despesas acima do ritmo da receita (R$ mi)', function (c) { return c.pressMi === null ? null : mi(c.pressMi); }),
        linha('Variação do caixa livre no ano (R$ mi)', function (c) { return mi(c.dCaixaMi); }, 'dado', { destaque: true })
      ] },
      { titulo: '1. Endividamento: dívida consolidada sobre a RCL (nota A com razão abaixo de 60%)', linhas: [
        linha('Dívida consolidada (numerador, R$ bi)', function (c) { return bi(c.divida); }),
        linha('Receita corrente líquida, RCL (denominador, R$ bi)', function (c) { return bi(c.rcl); }),
        linha('Dívida consolidada / RCL (%)', function (c) { return pct(c.dc_rcl); }, 'razao', { destaque: true }),
        linha('Nota do indicador', nota('nDC'), 'nota'),
        linha('Distância até o limite de 60% (p.p.)', function (c) { return pp((0.60 - c.dc_rcl) * 100); }, 'distancia')
      ] },
      { titulo: '2. Poupança corrente: despesa corrente sobre receita corrente, média ponderada de três anos (nota A abaixo de 85%)', linhas: [
        linha('Despesa corrente ajustada (numerador, R$ bi)', function (c) { return bi(c.despesa); }),
        linha('Receita corrente ajustada (denominador, R$ bi)', function (c) { return bi(c.rca); }),
        linha('Despesa / receita do ano (%)', function (c) { return pct(c.razao); }),
        linha('Poupança corrente: média de três anos (%)', function (c) { return pct(c.pc); }, 'razao', { destaque: true }),
        linha('Nota do indicador', nota('nPC'), 'nota'),
        linha('Distância até o limite de 85% (p.p.)', function (c) { return pp((0.85 - c.pc) * 100); }, 'distancia')
      ] },
      { titulo: '3. Liquidez relativa: caixa livre sobre a RCL (nota A com 5% ou mais; nota C com zero ou menos)', linhas: [
        linha('Caixa livre (numerador, R$ bi)', function (c) { return bi(c.caixa); }),
        linha('Receita corrente líquida, RCL (denominador, R$ bi)', function (c) { return bi(c.rcl); }),
        linha('Caixa livre / RCL (%)', function (c) { return pct(c.lr); }, 'razao', { destaque: true }),
        linha('Nota do indicador', nota('nLR'), 'nota'),
        linha('Distância até o piso de 5% (p.p.)', function (c) { return pp((c.lr - 0.05) * 100); }, 'piso', { destaque: true })
      ] },
      { titulo: null, linhas: [
        linha('Nota final', nota('final'), 'final', { destaque: true })
      ] }
    ];
    var primeiro = null;
    cols.forEach(function (c) { if (!primeiro && c.tipo !== 'real' && c.final !== 'A') primeiro = c; });
    return { id: cen.id, nome: cen.nome, novo: true, titulo: cen.titulo, resumo: cen.resumo,
      colunas: cols.map(function (c) { return { ano: c.ano, rotulo: c.rotulo, tipo: c.tipo, perde: c.final !== 'A' && c.tipo !== 'real', reconstruida: !!c.reconstruida }; }),
      grupos: grupos, primeiro: primeiro ? { ano: primeiro.ano, causa: M.causa(primeiro.nDC, primeiro.nPC, primeiro.nLR), lr: primeiro.lr, caixa: primeiro.caixa } : null,
      final2033: cols[cols.length - 1] };
  }

  // Estrutura de uma tabela de cenário. Cada linha tem rotulo e celulas [{t, nota, vazio}]; cada coluna pode ser marcada como perda de nota A.
  function cenario(D, cen) {
    var cols = colunas(D, cen), semReforma = !cen.p.reforma;
    if (cen.p.novo) return cenarioNovo(D, cen, cols);
    function linha(rotulo, f, opt) {
      opt = opt || {};
      return { rotulo: rotulo, destaque: !!opt.destaque, dica: opt.dica || '', celulas: cols.map(function (c) {
        var v = f(c);
        if (v === null || v === undefined) return { t: TRACO, vazio: true };
        return typeof v === 'string' ? { t: v } : { t: v.t, nota: v.nota || null };
      }) };
    }
    var primeiroGrupo = { titulo: 'O que muda de ano para ano', linhas: [
        linha('Crescimento nominal da RCL (%)', function (c) { return pct(c.g, 1); }),
        linha('Gasto novo: emendas e Poderes (R$ mi)', function (c) { return c.extra === null ? null : mi(c.extra * 1000); }),
        linha('Perda de receita da reforma (R$ mi)', function (c) { return c.perda === null || semReforma ? null : mi(c.perda * 1000); })
      ] };
    var grupos = [
      primeiroGrupo,
      { titulo: 'Endividamento: dívida consolidada sobre a RCL (nota A abaixo de 60%)', linhas: [
        linha('Numerador: dívida consolidada (R$ bi)', function (c) { return bi(c.divida); }),
        linha('Denominador: receita corrente líquida (R$ bi)', function (c) { return bi(c.rcl); }),
        linha('Razão', function (c) { return { t: pct(c.dc_rcl), nota: c.nDC }; }, { destaque: true }),
        linha('Folga até o limite de 60% (pontos percentuais)', function (c) { return pp((0.60 - c.dc_rcl) * 100); })
      ] },
      { titulo: 'Poupança corrente: despesa sobre receita correntes, média de 3 anos (nota A abaixo de 85%)', linhas: [
        linha('Numerador: despesa corrente ajustada (R$ bi)', function (c) { return bi(c.despesa); }),
        linha('Denominador: receita corrente ajustada (R$ bi)', function (c) { return bi(c.rca); }),
        linha('Razão do ano', function (c) { return pct(c.razao); }),
        linha('Poupança corrente: média ponderada 50%, 30% e 20%', function (c) { return { t: pct(c.pc), nota: c.nPC }; }, { destaque: true }),
        linha('Folga até o limite de 85% (pontos percentuais)', function (c) { return pp((0.85 - c.pc) * 100); })
      ] },
      { titulo: 'Liquidez relativa: caixa livre sobre a RCL (nota A com 5% ou mais; nota C com zero ou menos)', linhas: [
        linha('Numerador: caixa livre (R$ bi)', function (c) { return bi(c.caixa); }),
        linha('Denominador: receita corrente líquida (R$ bi)', function (c) { return bi(c.rcl); }),
        linha('Razão', function (c) { return { t: pct(c.lr), nota: c.nLR }; }, { destaque: true }),
        linha('Folga até 5% (pontos percentuais)', function (c) { return pp((c.lr - 0.05) * 100); }),
        linha('Caixa que sobra até a nota C, com razão igual a zero (R$ bi)', function (c) { return bi(c.caixa); })
      ] },
      { titulo: 'Resultado', linhas: [
        linha('Nota final', function (c) { return { t: '', nota: c.final }; }, { destaque: true })
      ] }
    ];
    var primeiro = null;
    cols.forEach(function (c) { if (!primeiro && c.tipo !== 'real' && c.final !== 'A') primeiro = c; });
    return { id: cen.id, nome: cen.nome, novo: !!cen.p.novo, titulo: cen.titulo, resumo: cen.resumo, colunas: cols.map(function (c) { return { ano: c.ano, rotulo: c.rotulo, tipo: c.tipo, perde: c.final !== 'A' && c.tipo !== 'real', reconstruida: !!c.reconstruida }; }),
      grupos: grupos, primeiro: primeiro ? { ano: primeiro.ano, causa: M.causa(primeiro.nDC, primeiro.nPC, primeiro.nLR), lr: primeiro.lr, caixa: primeiro.caixa } : null,
      final2033: cols[cols.length - 1] };
  }

  // Tabela única que compara as três trajetórias da receita (sem reforma) e as três hipóteses para os Poderes (as emendas impositivas são
  // certas e entram igual em todas): o que muda nas premissas, no gasto novo, na liquidez e na nota.
  // Cada linha tem rotulo, destaque e celulas [{t, sombra}] na ordem das trajetórias; sombra marca exercício sem nota A.
  function comparacao(D) {
    var cens = M.cenarios3(D), T3 = D.extras_padrao.trajetorias, N0 = D.extras_padrao.novo, anosLR = [2027, 2028, 2029, 2030, 2033];
    var fe = D.sigefes ? D.sigefes.poderes.fracao_do_limite_pago : null;
    var hips = [{ id: 'A', rotulo: 'limite novo integral', mud: {} }];
    if (fe) hips.push({ id: 'B', rotulo: 'limite novo, execução de ' + pct(fe, 0), mud: { poderes_exec_futura: fe } });
    hips.push({ id: 'C', rotulo: 'regra anterior (IPCA mais 1,5%)', mud: { poderes_regra: 'antiga', poderes_exec_futura: fe || 1 } });
    function sim(c, mud) {
      var q = {}; Object.keys(c.p).forEach(function (k) { q[k] = c.p[k]; });
      q.novo = {}; Object.keys(N0).forEach(function (k) { q.novo[k] = N0[k]; }); Object.keys(mud || {}).forEach(function (k) { q.novo[k] = mud[k]; });
      return { p: q, l: M.simular(D, q) };
    }
    var S = cens.map(function (c) { return hips.map(function (h) { return sim(c, h.mud); }); }); // S[trajetória][hipótese]
    function por(l, a) { return l.filter(function (x) { return x.ano === a; })[0]; }
    function linha(rotulo, f, opt) {
      opt = opt || {};
      return { rotulo: rotulo, destaque: !!opt.destaque, regra: opt.regra || '', celulas: cens.map(function (c, i) {
        var v = f(c, i);
        return v === null || v === undefined ? { t: TRACO, vazio: true } : typeof v === 'string' ? { t: v } : v;
      }) };
    }
    function sinal(x, c) { return (x > 0 ? '+' : x < 0 ? '-' : '') + num(Math.abs(x), c === undefined ? 1 : c); }
    var cresc = function (l) { return Math.pow(l[l.length - 1].rcl / l[0].rcl, 1 / (l.length - 1)) - 1; };
    var soma = function (l, campo) { return l.filter(function (x) { return x.ano >= 2027 && x.ano <= 2029; }).reduce(function (s2, x) { return s2 + x[campo]; }, 0); };
    var primeiro = function (l) { var q = M.primeiroAnoSemA(l); return q ? { t: String(q.ano), sombra: true } : { t: 'mantém' }; };
    var grupos = [
      { titulo: 'Premissas da trajetória da receita', linhas: [
        linha('Receita em relação ao PIB nominal (p.p. ao ano)', function (c) { return c.p.receita_pp === 0 ? '0,0' : sinal(c.p.receita_pp); }),
        linha('Parcela desse desvio que a despesa existente acompanha (%)', function (c) { return c.p.receita_pp === 0 ? null : num(T3.repasse * 100, 0); }),
        linha('Despesa existente em relação à receita (p.p. ao ano)', function (c) { return c.p.pressao === 0 ? '0,0' : sinal(c.p.pressao, 2); }),
        linha('Crescimento médio da RCL, 2026 a 2033 (% ao ano)', function (c, i) { return pct(cresc(S[i][0].l), 1); }),
        linha('RCL em 2033 (R$ bi)', function (c, i) { return bi(por(S[i][0].l, 2033).rcl); })
      ] },
      { titulo: 'Gasto novo, soma de 2027 a 2029 (R$ bi)', linhas: [
        linha('Emendas impositivas (iguais nas três hipóteses)', function (c, i) { return bi(soma(S[i][0].l, 'emenda')); })
      ].concat(hips.map(function (h, k) {
        return linha('Poderes: ' + h.rotulo, function (c, i) { return bi(soma(S[i][k].l, 'poderes')); });
      })) },
      { titulo: 'Liquidez relativa: caixa livre sobre a RCL (%), com o limite novo integral dos Poderes', linhas: anosLR.map(function (a) {
        return linha(String(a), function (c, i) { var x = por(S[i][0].l, a); return { t: num(x.lr * 100, 1), sombra: x.final !== 'A' }; }, { destaque: a === 2029 });
      }) },
      { titulo: 'Resultado: primeiro exercício sem nota A, conforme o que valer para os Poderes', linhas: hips.map(function (h, k) {
        return linha(h.id + '. ' + h.rotulo.charAt(0).toUpperCase() + h.rotulo.slice(1), function (c, i) { return primeiro(S[i][k].l); }, { destaque: true, regra: 'decisivo' });
      }) },
      { titulo: 'Esforço anual para manter o caixa livre acima de zero (R$ mi, valores de 2027 corrigidos pela receita)', linhas: [2029, 2033].reduce(function (acc, H) {
        return acc.concat(hips.map(function (h, k) {
          return linha('Até ' + H + ', hipótese ' + h.id, function (c, i) { return mi(M.esforcoIndexado(D, S[i][k].p, H, 0)); });
        }));
      }, []) }
    ];
    // as variações da base das emendas e da defasagem mudam algum exercício? Lista só o que muda.
    var mudancas = [];
    // bases alternativas das emendas de 2026: o pago até o corte, sem projetar para o ano, e o empenhado projetado para o ano
    var baixa = D.sigefes ? Math.round(D.sigefes.emendas.pago_ate_corte_mi) : 105, alta = D.sigefes ? Math.round(D.sigefes.historico.emendas_empenhado_mi[String(D.sigefes.ano)]) : 142;
    [{ rot: 'base de R$ ' + baixa + ' mi', mud: { emenda_base_mi: baixa } }, { rot: 'base de R$ ' + alta + ' mi', mud: { emenda_base_mi: alta } },
     { rot: 'defasagem de um ano', mud: { emenda_defasagem: 1 } }, { rot: 'sem defasagem', mud: { emenda_defasagem: 0 } }].forEach(function (v) {
      cens.forEach(function (c, i) { hips.forEach(function (h, k) {
        var m2 = {}; Object.keys(h.mud).forEach(function (kk) { m2[kk] = h.mud[kk]; }); Object.keys(v.mud).forEach(function (kk) { m2[kk] = v.mud[kk]; });
        var a2 = M.primeiroAnoSemA(S[i][k].l), b2 = M.primeiroAnoSemA(sim(c, m2).l);
        if ((a2 ? a2.ano : null) !== (b2 ? b2.ano : null)) mudancas.push({ trajetoria: c.nome, hipotese: h.id, variacao: v.rot, de: a2 ? a2.ano : null, para: b2 ? b2.ano : null });
      }); });
    });
    var caixa = function (i, k, a) { return por(S[i][k].l, a).caixa; };
    return { colunas: cens.map(function (c) { return { id: c.id, nome: c.nome }; }), grupos: grupos, hipoteses: hips.map(function (h) { return { id: h.id, rotulo: h.rotulo }; }),
      desvio_minimo: M.desvioMinimo(D, cens[0].p, 2033, T3.repasse), desvio_minimo_2029: M.desvioMinimo(D, cens[0].p, 2029, T3.repasse),
      emendas_mudancas: mudancas, caixa_central_2029: caixa(1, 0, 2029),
      resumo: cens.map(function (c, i) { return { id: c.id, nome: c.nome, por_hipotese: hips.map(function (h, k) { var q = M.primeiroAnoSemA(S[i][k].l); return { id: h.id, ano: q ? q.ano : null, causa: q ? q.causa : null }; }) }; }),
      esforco: cens.map(function (c, i) { return hips.map(function (h, k) { return { h2029: M.esforcoIndexado(D, S[i][k].p, 2029, 0), h2033: M.esforcoIndexado(D, S[i][k].p, 2033, 0) }; }); }) };
  }

  // Primeiro ano em que a nota deixa de ser A, em texto, para a matriz de sensibilidade.
  function primeiroAno(D, p) {
    var q = M.primeiroAnoSemA(M.simular(D, p));
    return q ? String(q.ano) : 'mantém até ' + M.ULTIMO_ANO;
  }

  function sensibilidade(D) {
    var cens = M.cenarios(D);
    function copia(base, mud) { var q = {}; Object.keys(base).forEach(function (k) { q[k] = base[k]; }); Object.keys(mud || {}).forEach(function (k) { q[k] = mud[k]; }); return q; }
    var t2r = copia(cens[1].p, { reforma: 1 });
    var colunasS = [{ rotulo: 'T1: sem reforma, medidas aprovadas', p: cens[0].p }, { rotulo: 'T2: sem reforma, Poderes +R$ ' + D.extras_padrao.poderes_menor + ' mi', p: cens[1].p },
      { rotulo: 'T3: com reforma, medidas aprovadas', p: cens[2].p }, { rotulo: 'T2 com reforma', p: t2r }];
    var casos = [
      { rotulo: 'Premissas centrais das tabelas', f: function (p) { return p; } },
      { rotulo: 'Receita cresce 1 ponto percentual acima da despesa que já existe (o excedente vira caixa)', f: function (p) { return copia(p, { pressao: -1 }); } },
      { rotulo: 'Despesa que já existe cresce 1 ponto percentual acima da receita', f: function (p) { return copia(p, { pressao: 1 }); } },
      { rotulo: 'Despesa que já existe cresce 0,7 ponto percentual acima da receita (média de 2021 a 2025)', f: function (p) { return copia(p, { pressao: 0.7 }); } },
      { rotulo: 'Receita cresce 2,2 pontos percentuais acima do PIB nominal (média de 2019 a 2025) e a despesa que já existe a acompanha', f: function (p) { return copia(p, { receita_pp: 2.2 }); } },
      { rotulo: 'Compensação de R$ 200 mi por ano (corte ou receita nova)', f: function (p) { return copia(p, { ajuste: 200 }); } },
      { rotulo: 'Caixa livre varia -R$ 80 mi por ano sem gasto novo (média de 2022 a 2025)', f: function (p) { return copia(p, { deriva: -80 }); } },
      { rotulo: 'Caixa livre varia +R$ 200 mi por ano sem gasto novo (média de 2019 a 2025)', f: function (p) { return copia(p, { deriva: 200 }); } },
      { rotulo: 'Vinculações de saúde e educação absorvem 37% da perda da reforma', f: function (p) { return copia(p, { reforma: p.reforma * 0.63 }); } },
      { rotulo: 'Sem nenhum gasto novo', f: function (p) { return copia(p, { emenda: 0, poderes: 0, ajuste: 0 }); } }
    ];
    return { colunas: colunasS.map(function (c) { return c.rotulo; }), linhas: casos.map(function (cs) {
      return { rotulo: cs.rotulo, celulas: colunasS.map(function (c) { return primeiroAno(D, cs.f(c.p)); }) };
    }) };
  }

  // Premissas e evidências: uma linha por parâmetro, com o valor usado, o que as fontes mostram e a situação.
  function premissas(D) {
    var X = D.externos, B = D.base, E = D.extras_padrao, CH = D.crescimento_historico, MA = D.macro;
    var H = D.historico_caixa, ano = function (a) { return H.filter(function (q) { return q.ano === a; })[0]; };
    var g = {}, i;
    for (i = 0; i < MA.anos.length; i++) g[MA.anos[i]] = (1 + MA.pib_real[i]) * (1 + MA.ipca[i]) - 1;
    var caixas = [2021, 2022, 2023, 2024, 2025].map(function (a) { return ano(a).caixa_livre; });
    var razoes = Object.keys(CH.razoes).map(function (k) { return CH.razoes[k]; });
    var ploa = X.ploa_2027, paf = X.paf, ref = D.reforma_nota;
    var perda33 = M.simular(D, M.cenarios(D)[2].p).slice(-1)[0].perda;
    var somaPod = Object.keys(ploa.poderes_mi).reduce(function (s, k) { return s + ploa.poderes_mi[k]; }, 0);
    var execPaga = [2021, 2022, 2023, 2024, 2025].map(function (a) { return ano(a).exec_paga; });
    function rs(x) { return (x < 0 ? '-' : '') + 'R$ ' + mi(Math.abs(x)); }
    var razoes2125 = [2021, 2022, 2023, 2024, 2025].map(function (a) { return CH.razoes[String(a)]; });
    function varCaixa(a, b) { var v = [], y; for (y = a; y <= b; y++) v.push(ano(y).caixa_livre - ano(y - 1).caixa_livre); return v; }
    function mediaVar(a, b) { var v = varCaixa(a, b); return v.reduce(function (s, x) { return s + x; }, 0) / v.length; }
    function dpVar(a, b) { var v = varCaixa(a, b), m = mediaVar(a, b); return Math.sqrt(v.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (v.length - 1)); }
    var folgas = H.filter(function (q) { return q.ano >= 2021 && q.ano <= 2025; }).map(function (q) { return q.resultado_primario - q.meta_resultado_primario; });
    var folgaMedia = folgas.reduce(function (a, b) { return a + b; }, 0) / folgas.length;
    return [
      { parametro: 'Ponto de partida: fechamento de 2026',
        valor: 'RCL R$ ' + bi(B.rcl) + ' bi; receita corrente ajustada R$ ' + bi(B.rca) + ' bi; despesa corrente ajustada R$ ' + bi(B.despesa) + ' bi; dívida R$ ' + bi(B.divida) + ' bi; caixa livre R$ ' + bi(B.caixa) + ' bi.',
        evidencia: 'De janeiro a agosto de 2026 a RCL já soma R$ ' + bi(D.parcial_2026.rcl_jan_ago_2026) + ' bi (' + pct(B.crescimento_ate_agosto.rcl) + ' sobre o mesmo período de 2025); setembro a dezembro de 2025 foram corrigidos em ' + pct(B.crescimento_receita_set_dez) +
          ' (PIB real mais IPCA de 2026 do Focus). Receita corrente no ano: ' + pct(B.crescimento_ano.receita_corrente) + '; despesa corrente: ' + pct(B.crescimento_ano.despesa_corrente) + '. Dívida do RGF de agosto de 2026. Caixa mantido no nível de 2025.',
        situacao: 'Siconfi e estimativa', classe: 'oficial', fontes: [['Siconfi, RREO anexos 01 e 03 e RGF anexo 02; cálculo próprio', '']] },
      { parametro: 'Crescimento da receita, 2027 a 2033',
        valor: [2027, 2028, 2029, 2030, 2031, 2032, 2033].map(function (a) { return a + ': ' + pct(g[a]); }).join('; ') + ' ao ano.',
        evidencia: 'PIB nominal = (1 + PIB real) x (1 + IPCA) - 1, com as medianas do Boletim Focus (Banco Central) de 2026 a 2030 e as projeções da Instituição Fiscal Independente (Relatório de Acompanhamento Fiscal nº 107, de 18 de dezembro de 2025) de 2031 a 2033. É menos que a média de ' + pct(CH.receita) + ' ao ano da receita corrente ajustada de ' + CH.de + ' a ' + CH.ate + '. Com o Focus de 16 de outubro de 2026 as taxas mudam em até 0,3 ponto percentual e o exercício da perda da nota não muda nos três cenários. Com o Focus de fim de ano, a RCL de 2025 teria sido subestimada em 11% a 18% a partir das bases de 2021 a 2023 (Tabela A2).',
        situacao: 'Focus e IFI', classe: 'oficial', fontes: [['Banco Central, Boletim Focus (mediana), 2026 a 2030; Instituição Fiscal Independente, RAF nº 107, 2031 a 2033', '']] },
      { parametro: 'Crescimento da despesa que já existe',
        valor: 'Igual ao da receita (pressão de zero ponto percentual).',
        evidencia: 'De ' + CH.de + ' a ' + CH.ate + ' a receita corrente ajustada cresceu ' + pct(CH.receita, 2) + ' ao ano e a despesa corrente ajustada ' + pct(CH.despesa, 2) + ' ao ano, igualdade que reflete a razão de ' + pct(CH.razoes['2019']) + ' em 2019 e de ' + pct(CH.razoes['2025']) + ' em 2025. De 2021 a 2025 a receita cresceu ' + pct(CH.receita_2021_2025, 2) + ' ao ano e a despesa ' + pct(CH.despesa_2021_2025, 2) + '. A razão entre as duas oscilou de ' +
          pct(Math.min.apply(null, razoes), 0) + ' a ' + pct(Math.max.apply(null, razoes), 0) + ' desde 2018 e, desde 2021, entre ' + pct(Math.min.apply(null, razoes2125), 0) + ' e ' + pct(Math.max.apply(null, razoes2125), 0) + ', sem tendência clara. Educação, saúde, Poderes e emendas são percentuais da receita. A data da perda da nota depende mais desta premissa do que de qualquer outra: a matriz de sensibilidade testa 0,7 e 1 ponto percentual por ano.',
        situacao: 'Siconfi', classe: 'oficial', fontes: [['Siconfi, RREO anexo 01 e DCA anexo I-D; cálculo próprio', '']] },
      { parametro: 'Caixa livre sem fato novo',
        valor: 'Constante em valor, R$ ' + bi(B.caixa) + ' bi.',
        evidencia: 'Ficou entre R$ ' + bi(Math.min.apply(null, caixas)) + ' bi e R$ ' + bi(Math.max.apply(null, caixas)) + ' bi de 2021 a 2025, enquanto a RCL cresceu ' + pct(ano(2025).rcl / ano(2021).rcl - 1, 0) + '. A variação anual foi, em média, de ' + rs(mediaVar(2022, 2025) * 1000) + ' mi de 2022 a 2025 e de ' + rs(mediaVar(2019, 2025) * 1000) + ' mi de 2019 a 2025, com desvios-padrão de R$ ' + bi(dpVar(2022, 2025)) + ' bi e R$ ' + bi(dpVar(2019, 2025)) + ' bi. Em 2026, até agosto, o resultado primário é de R$ ' + bi(D.parcial_2026.resultado_primario_ate_agosto) + ' bi, abaixo dos R$ ' + bi(D.parcial_2026.resultado_primario_ate_agosto_2025) + ' bi de agosto de 2025: o que sugere que a receita extra de 2026 não está sendo acumulada em caixa.',
        situacao: 'Siconfi', classe: 'oficial', fontes: [['Siconfi, RGF anexo 05 e RREO anexo 06; cálculo próprio', '']] },
      { parametro: 'Dívida consolidada',
        valor: 'Constante em valor, R$ ' + bi(B.divida) + ' bi, sem empréstimo novo.',
        evidencia: 'Ficou entre R$ 7,3 bi e R$ 8,7 bi de 2020 a 2026. O programa de ajuste fiscal do Estado com a União projeta dívida de ' + num(paf.dc_rcl_pct['2026'], 1) + '% da RCL em 2026 e ' + num(paf.dc_rcl_pct['2027'], 1) + '% em 2027 (conceito do programa, diferente do RGF).',
        situacao: 'Siconfi e programa de ajuste', classe: 'oficial', fontes: [['Siconfi, RGF anexo 02', '']].concat(paf.fontes) },
      { parametro: 'Orçamento de 2027 (proposta do Executivo)',
        valor: 'Contexto; não é usado como projeção da despesa.',
        evidencia: 'A proposta soma R$ ' + num(ploa.orcamento_fiscal_seguridade_bi, 1) + ' bi nos orçamentos fiscal e da seguridade, ' + pct(ploa.crescimento_nominal) + ' acima dos R$ ' + num(ploa.orcamento_2026_bi, 0) + ' bi de 2026, com R$ ' + num(ploa.executivo_bi, 0) + ' bi para o Executivo. Os Poderes somam R$ ' + bi(somaPod / 1000) + ' bi, ' + pct(somaPod / E.poderes_2027, 0) +
          ' do limite da LDO. A imprensa não registra corte compensatório. Dotação não é execução: o Estado pagou ' + pct(Math.min.apply(null, execPaga), 0) + ' a ' + pct(Math.max.apply(null, execPaga), 0) + ' da dotação atualizada de 2021 a 2025.',
        situacao: 'Imprensa', classe: 'imprensa', fontes: ploa.fontes.concat([['Siconfi, RREO anexo 06; cálculo próprio', '']]) },
      { parametro: 'Meta fiscal da LDO 2027',
        valor: 'Contexto; o modelo calcula o fluxo de caixa pelo gasto novo e não pela meta.',
        evidencia: 'Déficit primário de R$ ' + num(X.ldo_2027.deficit_primario_bi, 1) + ' bi em 2027 (meta de 2026: R$ ' + bi(-D.parcial_2026.meta_resultado_primario) + ' bi). A meta foi de déficit em todos os anos e o realizado superou a meta em R$ ' + bi(folgaMedia) + ' bi, em média, de 2021 a 2025. O programa de ajuste fiscal projeta arrecadação própria ' + pct(paf.receita_propria_mi['2026'] / paf.receita_propria_mi['2025'] - 1) + ' maior em 2026 e ' + pct(paf.receita_propria_mi['2027'] / paf.receita_propria_mi['2026'] - 1) + ' em 2027.',
        situacao: 'Imprensa e programa de ajuste', classe: 'imprensa', fontes: X.ldo_2027.fontes.concat(paf.fontes) },
      { parametro: 'Emendas impositivas',
        valor: 'R$ ' + mi(X.emendas.valor_2027_mi) + ' mi em 2027, dos quais R$ ' + mi(E.emenda) + ' mi são gasto novo; cresce com a receita.',
        evidencia: 'A PEC 04/2026 fixou o teto em ' + num(X.emendas.percentual_rcl, 2) + '% da RCL de 2025, contra R$ ' + mi(X.emendas.valor_antes_mi) + ' mi antes (R$ ' + num(X.emendas.por_deputado_mi, 1) + ' mi por deputado, contra R$ ' + num(X.emendas.por_deputado_antes_mi, 0) + ' mi). Os R$ ' + mi(X.emendas.valor_antes_mi) + ' mi já cresceriam com a receita e são descontados.',
        situacao: 'Imprensa', classe: 'imprensa', fontes: X.emendas.fontes },
      { parametro: 'Despesas dos Poderes',
        valor: 'T1 e T3: regra nova, percentuais da RCL mantidos (R$ ' + mi(E.poderes) + ' mi de gasto novo em 2027, e o limite se afasta do IPCA depois). T2: regra antiga e só R$ ' + E.poderes_menor + ' mi a mais.',
        evidencia: 'Limites de R$ ' + mi(E.poderes_2026) + ' mi na LDO 2026 e R$ ' + mi(E.poderes_2027) + ' mi na LDO 2027 (' + num(Object.keys(X.poderes.percentuais_rcl).reduce(function (s, k) { return s + X.poderes.percentuais_rcl[k]; }, 0), 3) + '% da RCL de julho de 2025 a junho de 2026, que reproduzem o valor). Pela regra antiga o limite de 2026 seria corrigido pelo IPCA e chegaria a R$ ' + mi(E.poderes_regra_antiga_2027) + ' mi em 2027; o que excede é gasto novo.',
        situacao: 'Tabela do autor, conferida', classe: 'autor', fontes: X.poderes.fontes },
      { parametro: 'Perda de receita com a reforma tributária',
        valor: 'T3: variação da nota técnica (' + ref.variacao_pct.map(function (v, k) { return ref.anos[k] + ': ' + num(v, 2) + '%'; }).join('; ') + ') sobre a receita de referência de R$ ' + num(ref.base_2025_bi, 2) + ' bi de 2025, levada a valores correntes pelo crescimento da receita.',
        evidencia: 'A nota técnica estima, a preços de 2025, perdas de ' + ref.diferenca_mi.map(function (v) { return mi(-v); }).join(', ') + ' mi de 2029 a 2033, acumulando R$ ' + num(ref.acumulado_bi, 2) + ' bi. Em valores correntes a perda de 2033 é de R$ ' + bi(perda33) + ' bi. A perda reduz a receita e o caixa livre na mesma quantia; a matriz mostra o efeito se as vinculações de saúde e educação absorverem 37%.',
        situacao: 'Estimativa do autor', classe: 'autor', fontes: X.reforma.fontes }
    ];
  }

  // Resultado primário mínimo por ano para manter a nota A até 2030 (os quatro anos seguintes), por cenário e por piso de liquidez.
  var PISOS = [{ f: 0, nome: 'liquidez acima de zero (nota final A no limite)' }, { f: 0.05, nome: 'liquidez de 5% ou mais (liquidez também em A)' }];
  function minimo(D, H) {
    H = H || 2030;
    var blocos = M.cenarios(D).map(function (c) {
      var linhas = [], plano = null;
      PISOS.forEach(function (pi, k) {
        var r = M.resultadoMinimo(D, c.p, H, pi.f, 0);
        if (k === 0) {
          plano = r.plano;
          linhas.push({ rotulo: 'Resultado primário sem ação', valores: r.plano.map(bi), soma: bi(sum(r.plano)), pct: null, destaque: false });
        }
        linhas.push({ rotulo: 'Resultado mínimo: ' + pi.nome, valores: r.minimo.map(bi), soma: bi(sum(r.minimo)), pct: pct(r.r, 2), destaque: true });
        linhas.push({ rotulo: 'Esforço necessário', valores: r.esforco.map(bi), soma: bi(r.total), pct: null, destaque: false });
      });
      return { id: c.id, titulo: c.titulo, linhas: linhas };
    });
    var anos = M.resultadoMinimo(D, M.cenarios(D)[0].p, H, 0, 0).anos;
    var P = D.ponte_caixa, neutro = function (de) { var v = P.filter(function (q) { return q.ano >= de; }).map(function (q) { return q.neutro / q.rcl; }); return sum(v) / v.length; };
    var cen1 = M.cenarios(D)[0].p;
    var sens = [{ rotulo: 'Resultado primário neutro de ' + pct(neutro(2023), 1) + ' da RCL (média de 2023 a 2025)', pn: neutro(2023) },
      { rotulo: 'Resultado primário neutro igual a zero (caso central)', pn: 0 },
      { rotulo: 'Resultado primário neutro de ' + pct(neutro(2019), 1) + ' da RCL (média de 2019 a 2025)', pn: neutro(2019) }].map(function (q) {
      var r = M.resultadoMinimo(D, cen1, H, 0, q.pn), r5 = M.resultadoMinimo(D, cen1, H, 0.05, q.pn);
      return { rotulo: q.rotulo, valores: r.minimo.map(bi), valores5: r5.minimo.map(bi) };
    });
    return { anos: anos, blocos: blocos, sens: sens, meta_ldo_2027: -D.externos.ldo_2027.deficit_primario_bi };
  }
  function sum(v) { return v.reduce(function (a, b) { return a + b; }, 0); }

  // Quanto o acréscimo dos Poderes precisaria ser reduzido, com as emendas como estão.
  function poderes(D) {
    var X = D.extras_padrao, cens = M.cenarios(D), saida = [];
    [2030, 2033].forEach(function (H) {
      [0, 2].forEach(function (i) {
        PISOS.forEach(function (pi) {
          var c = cens[i], pm = M.poderesMaximo(D, c.p, H, pi.f);
          var zero = {}; Object.keys(c.p).forEach(function (k) { zero[k] = c.p[k]; }); zero.poderes = 0; zero.poderes_rcl = 0;
          saida.push({ horizonte: H, cenario: c.id, piso: pi.nome, aprovado: c.p.poderes,
            maximo: pm.x, limite: pm.x === null ? null : X.poderes_regra_antiga_2027 + pm.x, corte: pm.x === null ? null : c.p.poderes - pm.x,
            extra_aprovado: c.p.poderes, adicional: pm.x === null ? M.esforcoIndexado(D, zero, H, pi.f) : null });
        });
      });
    });
    return { linhas: saida, limite_ldo: X.poderes_2027, regra_antiga: X.poderes_regra_antiga_2027 };
  }

  // Ponte histórica entre o resultado primário e a variação do caixa livre, e resultado primário neutro para o caixa.
  function ponte(D) {
    var P = D.ponte_caixa;
    function media(f, de) { var v = P.filter(function (q) { return q.ano >= de; }).map(f); return sum(v) / v.length; }
    var linhas = [
      { rotulo: 'Variação do caixa livre', f: function (q) { return q.variacao_caixa; } },
      { rotulo: 'Resultado primário', f: function (q) { return q.resultado_primario; } },
      { rotulo: 'Juros líquidos (receita financeira menos juros pagos)', f: function (q) { return q.juros_liquidos; } },
      { rotulo: 'Operações de crédito menos amortização', f: function (q) { return q.credito_liquido; } },
      { rotulo: 'Resíduo (fontes vinculadas, restos a pagar e outros)', f: function (q) { return q.residuo; } },
      { rotulo: 'Resultado primário neutro para o caixa', f: function (q) { return q.neutro; }, destaque: true },
      { rotulo: 'Resultado primário neutro (% da RCL)', f: function (q) { return q.neutro / q.rcl; }, pct: true }
    ];
    return { anos: P.map(function (q) { return q.ano; }), linhas: linhas.map(function (l) {
      var fmt = l.pct ? function (x) { return num(x * 100, 1); } : bi;
      return { rotulo: l.rotulo, destaque: !!l.destaque, valores: P.map(function (q) { return fmt(l.f(q)); }), m_todos: fmt(media(l.f, 0)), m_recentes: fmt(media(l.f, 2023)) };
    }) };
  }

  raiz.Tabelas = { cenario: cenario, comparacao: comparacao, sensibilidade: sensibilidade, premissas: premissas, minimo: minimo, poderes: poderes, ponte: ponte, num: num, pct: pct };
})(typeof window !== 'undefined' ? window : module.exports, typeof window !== 'undefined' ? window.Modelo : require('./modelo.js').Modelo);
