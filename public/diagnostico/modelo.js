// Regras da Capacidade de Pagamento (CAPAG) e projeção ano a ano. Sem dependência de tela, para poder ser testado no Node.
// Regras: Portaria Normativa MF 1.583/2023, arts. 2º a 4º. Valores monetários em R$ bilhões (gasto novo e deriva entram em R$ milhões
// nos parâmetros); razões em fração (0,77 = 77%).
//
// Premissas (cada uma com a evidência que a sustenta na página):
//  1. A receita cresce com o PIB nominal do estudo do autor: (1 + PIB real) x (1 + IPCA) - 1, ano a ano (Focus até 2030, IFI depois).
//  2. A despesa que já existe cresce no mesmo ritmo da receita (de 2019 a 2025 as duas cresceram 7,9% ao ano), mais uma pressão opcional.
//  3. Sem fato novo o caixa livre fica constante em valor (R$ 2,1 a 2,6 bi de 2021 a 2025), mais uma deriva anual opcional.
//  4. O gasto novo (emendas e Poderes) é regido por percentual da receita corrente líquida e por isso cresce com a receita. Duas medidas:
//     (a) modo antigo (p.emenda, p.poderes): o que excede a regra antiga dos Poderes (IPCA) e os R$ 90 mi de emendas;
//     (b) modo novo (p.novo): o que se passa a gastar em cada ano menos a despesa executada em 2026 levada pela receita. Emendas: 1,55% da RCL
//         de dois anos antes (PEC 04/2026, execução obrigatória). Poderes: a fração poderes_exec_futura do limite, que é 11,635% da RCL dos 12
//         meses até junho do ano anterior (LDO 2027) ou, na regra anterior, o limite do ano anterior corrigido pelo IPCA mais 1,5%.
//  5. Gasto novo líquido de compensação, perda de receita e pressão da despesa saem do caixa livre, sem outra fonte.
//  6. A perda de receita da reforma é a trajetória anual da nota técnica do autor (variação percentual da receita estadual de referência
//     contra o cenário sem reforma), aplicada à receita de referência em valores correntes e reduzindo receita e caixa na mesma quantia.
//  7. A dívida fica constante em valor (R$ 7,3 a 8,7 bi desde 2020; operações de crédito e amortizações quase se anulam).
(function (raiz) {
  var PESOS = [0.5, 0.3, 0.2]; // poupança corrente: último, penúltimo e antepenúltimo exercício
  var TABELA = { AAA: 'A', ABA: 'A', AAB: 'A', BAA: 'B', CAA: 'B', BBA: 'B', CBA: 'B', BAB: 'B', CAB: 'B', ABB: 'B', BBB: 'B', CBB: 'B', CCC: 'D' };
  var ULTIMO_ANO = 2033;
  var ANO_INICIO_GASTO = 2027;

  function notaDC(x) { return x < 0.60 ? 'A' : x < 1.00 ? 'B' : 'C'; }
  function notaPC(x) { return x < 0.85 ? 'A' : x < 0.95 ? 'B' : 'C'; }
  function notaLR(x) { return x >= 0.05 ? 'A' : x > 0 ? 'B' : 'C'; }
  function notaFinal(a, b, c) { return TABELA[a + b + c] || 'C'; }

  // O que derruba a nota final de A, em palavras, na ordem de gravidade.
  function causa(nDC, nPC, nLR) {
    if (notaFinal(nDC, nPC, nLR) === 'A') return '';
    if (nLR === 'C') return 'liquidez';
    if (nPC === 'C') return 'poupança corrente';
    if (nDC !== 'A') return 'endividamento';
    return 'poupança corrente e liquidez juntas';
  }

  // Crescimento nominal da receita por ano, com o deslocamento opcional receita_pp (pontos percentuais por ano), e o IPCA.
  function trilha(D, p) {
    var g = {}, ip = {};
    D.macro.anos.forEach(function (a, i) {
      g[a] = (1 + D.macro.pib_real[i]) * (1 + D.macro.ipca[i]) - 1 + (a >= ANO_INICIO_GASTO ? (p.receita_pp || 0) / 100 : 0);
      ip[a] = D.macro.ipca[i];
    });
    return { g: g, ip: ip };
  }

  // Parâmetros p:
  //   emenda   gasto novo das emendas em 2027, R$ mi acima do que já existia (indexado à receita);
  //   poderes  gasto novo dos Poderes em 2027, R$ mi acima da regra antiga (IPCA);
  //   poderes_rcl 1 se a nova regra (percentual da RCL) segue valendo, o que faz o limite se afastar do IPCA ano a ano; 0 se não;
  //   ajuste   compensação em R$ mi por ano (indexada à receita);
  //   reforma  fração da perda da nota técnica (1 = a trajetória do autor; 0 = sem reforma);
  //   receita_pp / pressao  pontos percentuais por ano a mais na receita / na despesa que já existe;
  //   deriva   variação anual do caixa livre sem fato novo, R$ mi (0 = caixa constante em valor).
  function simular(D, p) {
    var B = D.base, T = trilha(D, p), pres = (p.pressao || 0) / 100, deriva = (p.deriva || 0) / 1000;
    var razao = {};
    Object.keys(B.razoes).forEach(function (k) { razao[k] = B.razoes[k]; });
    var l0 = { ano: B.ano, estimado: true, rcl: B.rcl, rca: B.rca, despesa: B.despesa, divida: B.divida, caixa: B.caixa, razao: razao[B.ano],
      pc: B.pc, dc_rcl: B.dc_rcl, lr: B.lr, extra: 0, emenda: 0, poderes: 0, perda: 0, pressao: 0, g: null };
    l0.nDC = notaDC(l0.dc_rcl); l0.nPC = notaPC(l0.pc); l0.nLR = notaLR(l0.lr);
    l0.final = notaFinal(l0.nDC, l0.nPC, l0.nLR); l0.causa = causa(l0.nDC, l0.nPC, l0.nLR);
    var linhas = [l0];
    var rcl0 = B.rcl, rca0 = B.rca, des0 = B.despesa, desEq = B.despesa, caixa = B.caixa;
    var ref = D.reforma_nota.base_2025_bi * (1 + T.g[B.ano]); // receita de referência da nota técnica, em valores correntes
    var G = 1, I = 1;
    var pod27 = D.extras_padrao.poderes_regra_antiga_2027;
    var N = p.novo, rclAno = {}; // RCL de cada exercício (R$ bi), para as regras defasadas do modo novo
    D.historico_caixa.forEach(function (h) { if (h.rcl !== null && h.rcl !== undefined) rclAno[h.ano] = h.rcl; });
    rclAno[B.ano] = B.rcl;
    // A RCL dos 12 meses até junho de 2026 (base do limite de 2027) é calibrada pela média dos exercícios de 2025 e 2026; a mesma razão vale nos anos seguintes.
    var limAntiga = N ? N.poderes_limite_2026_mi : 0;
    var kRcl = N ? D.parcial_2026.rcl_12m_junho / ((rclAno[B.ano - 1] + rclAno[B.ano]) / 2) : 0;
    for (var ano = ANO_INICIO_GASTO; ano <= ULTIMO_ANO; ano++) {
      var g = T.g[ano];
      rcl0 *= 1 + g; rca0 *= 1 + g; desEq *= 1 + g; des0 *= 1 + g + pres; ref *= 1 + g;
      if (ano > ANO_INICIO_GASTO) { G *= 1 + g; I *= 1 + T.ip[ano]; }
      var i = D.reforma_nota.anos.indexOf(ano);
      var var_ = i >= 0 ? D.reforma_nota.variacao_pct[i] : (ano > D.reforma_nota.anos[D.reforma_nota.anos.length - 1] ? D.reforma_nota.variacao_pct[D.reforma_nota.variacao_pct.length - 1] : 0);
      var perda = -(p.reforma || 0) * var_ / 100 * ref;
      var pressao = des0 - desEq; // quanto a despesa existente excede o que teria com o ritmo da receita
      var rca = rca0 - perda, rcl = rcl0 - perda;
      rclAno[ano] = rcl;
      var emenda, poderes, emBruta = 0, emBase = 0, podBruto = 0, podBase = 0;
      if (N) { // modo novo: o que a regra autoriza no ano menos a execução de 2026 corrigida pela receita (R$ mi)
        emBruta = N.emenda_pct_rcl * rclAno[ano - N.emenda_defasagem] * 1000;
        emBase = N.emenda_base_mi * rcl / B.rcl;
        var limite;
        if (N.poderes_regra === 'antiga') { // regra anterior da LDO 2026: o limite do ano anterior corrigido pelo IPCA de julho a junho mais 1,5%
          limAntiga *= 1 + (ano === ANO_INICIO_GASTO ? N.poderes_antiga_ipca_2027 : (T.ip[ano - 2] + T.ip[ano - 1]) / 2) + N.poderes_antiga_acrescimo;
          limite = limAntiga;
        } else limite = N.poderes_pct_rcl * kRcl * (rclAno[ano - 1] + rclAno[ano - 2]) / 2 * 1000;
        podBruto = N.poderes_exec_futura * limite; // despesa dos Poderes: a fração do limite que eles executam
        podBase = N.poderes_base_2026_mi * rcl / B.rcl; // despesa de 2026 (executada) levada pela receita
        emenda = emBruta - emBase; poderes = podBruto - podBase;
      } else {
        emenda = p.emenda * G;
        poderes = p.poderes * G + (p.poderes_rcl ? pod27 * (G - I) * (p.poderes / D.extras_padrao.poderes) : 0); // a divergência do IPCA cresce com a intensidade da nova regra
      }
      var extra = Math.max(0, emenda + poderes - p.ajuste * G) / 1000;
      var despesa = des0 + extra;
      var r = despesa / rca;
      razao[ano] = r;
      var pc = PESOS[0] * r + PESOS[1] * razao[ano - 1] + PESOS[2] * razao[ano - 2];
      caixa = caixa + deriva - extra - perda - pressao;
      var lr = caixa / rcl, dcrcl = B.divida / rcl;
      var a = notaDC(dcrcl), b = notaPC(pc), c = notaLR(lr);
      linhas.push({ ano: ano, estimado: true, g: g, rcl: rcl, rca: rca, despesa: despesa, divida: B.divida, caixa: caixa, razao: r, pc: pc, dc_rcl: dcrcl, lr: lr,
        extra: extra, emenda: emenda / 1000, poderes: poderes / 1000, emendaBruta: emBruta / 1000, emendaBase: emBase / 1000, poderesBruto: podBruto / 1000, poderesBase: podBase / 1000,
        perda: perda, pressao: pressao, nDC: a, nPC: b, nLR: c,
        final: notaFinal(a, b, c), causa: causa(a, b, c) });
    }
    return linhas;
  }

  function primeiroAnoSemA(linhas) {
    for (var i = 0; i < linhas.length; i++) if (linhas[i].final !== 'A') return linhas[i];
    return null;
  }

  // Maior gasto novo líquido permanente (R$ mi por ano em 2027) que mantém a nota A até o último ano, com as demais premissas dadas e a mesma
  // proporção entre emendas e Poderes do cenário. O líquido é o bruto menos a compensação.
  function espacoMaximo(D, p) {
    var total = p.emenda + p.poderes, se = total > 0 ? p.emenda / total : 1, aj = p.ajuste || 0;
    function com(x) {
      var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; });
      q.emenda = (x + aj) * se; q.poderes = (x + aj) * (1 - se);
      return q;
    }
    function mantem(x) { return primeiroAnoSemA(simular(D, com(x))) === null; }
    if (!mantem(0)) return { valor: 0, limite: primeiroAnoSemA(simular(D, com(0))) };
    var lo = 0, hi = 20000;
    if (mantem(hi)) return { valor: hi, limite: null };
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (mantem(mid)) lo = mid; else hi = mid;
    }
    return { valor: lo, limite: primeiroAnoSemA(simular(D, com(hi))) };
  }

  // Espaço de cada indicador no ano-base (estimativa de fechamento de 2026), isoladamente, em R$ bilhões.
  function espacosAtuais(D) {
    return {
      divida: 0.60 * D.rcl - D.divida,
      despesaAteB: (0.85 - D.pc) * D.rca,
      despesaAteC: (0.95 - D.pc) * D.rca,
      caixaAteB: (D.lr - 0.05) * D.rcl,
      caixaAteC: D.lr * D.rcl
    };
  }

  // Os três cenários das tabelas de verificação. T1 e T3 mantêm as duas medidas aprovadas; T2 limita o acréscimo dos Poderes.
  function cenarios(D) {
    var X = D.extras_padrao;
    var pleno = { receita_pp: 0, pressao: 0, deriva: 0, ajuste: 0, emenda: X.emenda, poderes: X.poderes, poderes_rcl: 1, reforma: 0 };
    function copia(m) { var q = {}; Object.keys(pleno).forEach(function (k) { q[k] = pleno[k]; }); Object.keys(m).forEach(function (k) { q[k] = m[k]; }); return q; }
    return [
      { id: 'T1', titulo: 'Sem reforma, só as medidas já aprovadas', resumo: 'Emendas impositivas de R$ 435 mi e novos limites dos Poderes (percentuais da RCL).', p: copia({}) },
      { id: 'T2', titulo: 'Sem reforma, emendas aprovadas e acréscimo menor dos Poderes', resumo: 'Emendas impositivas de R$ 435 mi; os Poderes seguem a regra antiga (IPCA) e recebem só R$ ' + X.poderes_menor + ' mi a mais.', p: copia({ poderes: X.poderes_menor, poderes_rcl: 0 }) },
      { id: 'T3', titulo: 'Com a reforma tributária (nota técnica do autor)', resumo: 'As mesmas medidas aprovadas do T1, mais a perda de receita estimada na nota técnica, de 2029 a 2033.', p: copia({ reforma: 1 }) }
    ];
  }

  // Três trajetórias da receita, sem reforma, com o gasto novo medido contra a execução de 2026 (p.novo).
  // A receita se desvia do PIB nominal em +/- dif_pp pontos percentuais por ano (a média de 2019 a 2025 foi +2,2) e a despesa que já existe
  // acompanha só uma fração `repasse` desse desvio (de 0,34 a 0,45 na série); o resto é pressão (sinal oposto) sobre o caixa livre.
  function cenarios3(D) {
    var X = D.extras_padrao, T = X.trajetorias;
    function traj(dif, repasse) { return { receita_pp: dif, pressao: -(1 - repasse) * dif, deriva: 0, ajuste: 0, emenda: 0, poderes: 0, poderes_rcl: 0, reforma: 0, novo: X.novo }; }
    return [
      { id: 'CON', nome: 'Conservador', titulo: 'Trajetória conservadora', p: traj(-T.dif_pp, T.repasse),
        resumo: 'A receita cresce ' + String(T.dif_pp).replace('.', ',') + ' pontos percentuais por ano abaixo do PIB nominal e a despesa que já existe acompanha ' + Math.round(T.repasse * 100) + '% dessa diferença.' },
      { id: 'CEN', nome: 'Central', titulo: 'Trajetória central', p: traj(0, 1),
        resumo: 'A receita cresce com o PIB nominal do Focus e do IFI e a despesa que já existe cresce com a receita.' },
      { id: 'HIS', nome: 'Histórico', titulo: 'Trajetória histórica', p: traj(T.dif_pp, T.repasse),
        resumo: 'A receita cresce ' + String(T.dif_pp).replace('.', ',') + ' pontos percentuais por ano acima do PIB nominal, como de 2019 a 2025, e a despesa que já existe acompanha ' + Math.round(T.repasse * 100) + '% dessa diferença.' }
    ];
  }

  // Desvio mínimo da receita em relação ao PIB nominal (pontos percentuais por ano) que mantém a nota A até H, dado o repasse à despesa.
  // Devolve null quando nenhum desvio até 10 pontos basta (com repasse de 100% a receita acima do PIB não gera caixa).
  function desvioMinimo(D, p, H, repasse) {
    function mantem(x) {
      var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; }); q.receita_pp = x; q.pressao = -(1 - repasse) * x;
      return simular(D, q).filter(function (l) { return l.ano <= H; }).every(function (l) { return l.final === 'A'; });
    }
    if (mantem(-10)) return -10;
    if (!mantem(10)) return null;
    var lo = -10, hi = 10;
    for (var i = 0; i < 50; i++) { var m = (lo + hi) / 2; if (mantem(m)) hi = m; else lo = m; }
    return hi;
  }

  // Maior pressão (pontos percentuais por ano a mais na despesa que já existe) que ainda mantém a nota A até H; negativa quando a despesa
  // existente precisa crescer menos que a receita. Devolve null quando nem com -5 pontos a nota se mantém.
  function pressaoMaxima(D, p, H) {
    function mantem(x) {
      var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; }); q.pressao = x;
      return simular(D, q).filter(function (l) { return l.ano <= H; }).every(function (l) { return l.final === 'A'; });
    }
    if (!mantem(-5)) return null;
    if (mantem(5)) return 5;
    var lo = -5, hi = 5;
    for (var i = 0; i < 50; i++) { var m = (lo + hi) / 2; if (mantem(m)) lo = m; else hi = m; }
    return lo;
  }

  // ---- Problema inverso: o que é preciso entregar para a nota A ficar de pé até o ano H ----
  // O piso de liquidez f é a razão mínima entre o caixa livre e a RCL em todo ano de 2027 a H (0 = o mínimo para a nota final A, com
  // endividamento e poupança corrente em A; 0,05 = liquidez também em A). O caixa varia com o resultado primário menos o resultado
  // primário neutro para o caixa (pn, em fração da RCL; 0 = equilíbrio primário). Com o resultado primário mínimo constante em fração
  // da RCL (r), o caixa de cada ano é o caixa de 2026 mais a soma de (r - pn) x RCL, e r é o menor valor que respeita o piso em todos
  // os anos. O esforço de cada ano é a diferença entre esse resultado mínimo e o resultado primário sem ação (pn x RCL menos o gasto
  // novo e a perda da reforma); a soma do esforço independe de pn, e só a tradução em meta de resultado primário depende dele.
  function resultadoMinimo(D, p, H, f, pn) {
    pn = pn || 0;
    var linhas = simular(D, p).filter(function (l) { return l.ano >= ANO_INICIO_GASTO && l.ano <= H; });
    var caixa0 = D.base.caixa, soma = 0, r = -Infinity, anoRestritivo = null;
    linhas.forEach(function (l) {
      soma += l.rcl;
      var v = pn + (f * l.rcl - caixa0) / soma;
      if (v > r) { r = v; anoRestritivo = l.ano; }
    });
    var minimo = linhas.map(function (l) { return r * l.rcl; });
    var plano = linhas.map(function (l) { return pn * l.rcl - l.extra - l.perda; });
    var esforco = minimo.map(function (m, i) { return m - plano[i]; });
    return { r: r, anoRestritivo: anoRestritivo, anos: linhas.map(function (l) { return l.ano; }), rcl: linhas.map(function (l) { return l.rcl; }),
      minimo: minimo, plano: plano, esforco: esforco, total: esforco.reduce(function (a, b) { return a + b; }, 0) };
  }

  // Esforço anual constante em valores de 2027, corrigido pelo crescimento da receita (R$ mi), que mantém o piso até H.
  function esforcoIndexado(D, p, H, f) {
    var linhas = simular(D, p).filter(function (l) { return l.ano >= ANO_INICIO_GASTO && l.ano <= H; });
    var G = 1, S = 0, a = 0;
    linhas.forEach(function (l, i) {
      if (i > 0) G *= 1 + l.g;
      S += G;
      a = Math.max(a, Math.max(0, f * l.rcl - l.caixa) / S);
    });
    return a * 1000;
  }

  // Maior gasto novo dos Poderes em 2027 (R$ mi acima da regra antiga) que mantém o piso até H, com as emendas como estão.
  // Devolve x = null quando nem a regra antiga basta.
  function poderesMaximo(D, p, H, f) {
    function com(x) { var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; }); q.poderes = x; return q; }
    function mantem(x) {
      return simular(D, com(x)).filter(function (l) { return l.ano >= ANO_INICIO_GASTO && l.ano <= H; })
        .every(function (l) { return l.lr >= f - 1e-12 && l.final === 'A'; });
    }
    if (!mantem(0)) return { x: null };
    if (mantem(p.poderes)) return { x: p.poderes, cheio: true };
    var lo = 0, hi = p.poderes;
    for (var i = 0; i < 50; i++) { var m = (lo + hi) / 2; if (mantem(m)) lo = m; else hi = m; }
    return { x: lo, cheio: false };
  }

  raiz.Modelo = { resultadoMinimo: resultadoMinimo, esforcoIndexado: esforcoIndexado, poderesMaximo: poderesMaximo, notaDC: notaDC, notaPC: notaPC, notaLR: notaLR, notaFinal: notaFinal, causa: causa, simular: simular, cenarios: cenarios, cenarios3: cenarios3, desvioMinimo: desvioMinimo, pressaoMaxima: pressaoMaxima,
    primeiroAnoSemA: primeiroAnoSemA, espacoMaximo: espacoMaximo, espacosAtuais: espacosAtuais, trilha: trilha, ULTIMO_ANO: ULTIMO_ANO, ANO_INICIO_GASTO: ANO_INICIO_GASTO };
})(typeof window !== 'undefined' ? window : module.exports);
