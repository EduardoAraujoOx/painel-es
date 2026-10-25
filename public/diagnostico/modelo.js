// Regras da Capacidade de Pagamento (CAPAG) e projeção ano a ano. Sem dependência de tela, para poder ser testado no Node.
// Regras: Portaria Normativa MF 1.583/2023, arts. 2º a 4º. Valores monetários em R$ bilhões (gasto novo e deriva entram em R$ milhões
// nos parâmetros); razões em fração (0,77 = 77%).
//
// Premissas (cada uma com a evidência que a sustenta na página):
//  1. A receita cresce com o PIB nominal do estudo do autor: (1 + PIB real) x (1 + IPCA) - 1, ano a ano (Focus até 2030, IFI depois).
//  2. A despesa que já existe cresce no mesmo ritmo da receita (de 2019 a 2025 as duas cresceram 7,9% ao ano), mais uma pressão opcional.
//  3. Sem fato novo o caixa livre fica constante em valor (R$ 2,1 a 2,6 bi de 2021 a 2025), mais uma deriva anual opcional.
//  4. O gasto novo (emendas e Poderes) é regido por percentual da receita corrente líquida e por isso cresce com a receita. A regra
//     antiga dos Poderes (IPCA) é o contrafactual: só o que excede a ela é gasto novo.
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
    for (var ano = ANO_INICIO_GASTO; ano <= ULTIMO_ANO; ano++) {
      var g = T.g[ano];
      rcl0 *= 1 + g; rca0 *= 1 + g; desEq *= 1 + g; des0 *= 1 + g + pres; ref *= 1 + g;
      if (ano > ANO_INICIO_GASTO) { G *= 1 + g; I *= 1 + T.ip[ano]; }
      var emenda = p.emenda * G;
      var poderes = p.poderes * G + (p.poderes_rcl ? pod27 * (G - I) * (p.poderes / D.extras_padrao.poderes) : 0); // a divergência do IPCA cresce com a intensidade da nova regra
      var extra = Math.max(0, emenda + poderes - p.ajuste * G) / 1000;
      var i = D.reforma_nota.anos.indexOf(ano);
      var var_ = i >= 0 ? D.reforma_nota.variacao_pct[i] : (ano > D.reforma_nota.anos[D.reforma_nota.anos.length - 1] ? D.reforma_nota.variacao_pct[D.reforma_nota.variacao_pct.length - 1] : 0);
      var perda = -(p.reforma || 0) * var_ / 100 * ref;
      var pressao = des0 - desEq; // quanto a despesa existente excede o que teria com o ritmo da receita
      var rca = rca0 - perda, rcl = rcl0 - perda;
      var despesa = des0 + extra;
      var r = despesa / rca;
      razao[ano] = r;
      var pc = PESOS[0] * r + PESOS[1] * razao[ano - 1] + PESOS[2] * razao[ano - 2];
      caixa = caixa + deriva - extra - perda - pressao;
      var lr = caixa / rcl, dcrcl = B.divida / rcl;
      var a = notaDC(dcrcl), b = notaPC(pc), c = notaLR(lr);
      linhas.push({ ano: ano, estimado: true, g: g, rcl: rcl, rca: rca, despesa: despesa, divida: B.divida, caixa: caixa, razao: r, pc: pc, dc_rcl: dcrcl, lr: lr,
        extra: extra, emenda: emenda / 1000, poderes: poderes / 1000, perda: perda, pressao: pressao, nDC: a, nPC: b, nLR: c,
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

  raiz.Modelo = { notaDC: notaDC, notaPC: notaPC, notaLR: notaLR, notaFinal: notaFinal, causa: causa, simular: simular, cenarios: cenarios,
    primeiroAnoSemA: primeiroAnoSemA, espacoMaximo: espacoMaximo, espacosAtuais: espacosAtuais, trilha: trilha, ULTIMO_ANO: ULTIMO_ANO, ANO_INICIO_GASTO: ANO_INICIO_GASTO };
})(typeof window !== 'undefined' ? window : module.exports);
