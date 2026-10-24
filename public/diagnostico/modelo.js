// Regras da Capacidade de Pagamento (CAPAG) e simulador de cenários. Sem dependência de tela, para poder ser testado no Node.
// Regras: Portaria Normativa MF 1.583/2023, arts. 2º a 4º. Valores monetários em R$ bilhões; razões em fração (0,77 = 77%).
(function (raiz) {
  var PESOS = [0.5, 0.3, 0.2]; // poupança corrente: último, penúltimo e antepenúltimo exercício
  var TABELA = { AAA: 'A', ABA: 'A', AAB: 'A', BAA: 'B', CAA: 'B', BBA: 'B', CBA: 'B', BAB: 'B', CAB: 'B', ABB: 'B', BBB: 'B', CBB: 'B', CCC: 'D' };
  var ULTIMO_ANO = 2032;

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

  // Parâmetros p: crescimento (% ao ano da receita e da despesa-base), emenda e poderes (R$ mi por ano, a partir de 2027),
  // ajuste (R$ mi por ano de compensação) e perda (% da receita corrente ao fim da transição, escalonada de 2029 a 2032).
  function simular(D, p) {
    var linhas = [{ ano: D.ano_base, dc_rcl: D.dc_rcl, pc: D.pc, lr: D.lr, extra: 0, perda: 0,
      nDC: notaDC(D.dc_rcl), nPC: notaPC(D.pc), nLR: notaLR(D.lr) }];
    linhas[0].final = notaFinal(linhas[0].nDC, linhas[0].nPC, linhas[0].nLR);
    linhas[0].causa = causa(linhas[0].nDC, linhas[0].nPC, linhas[0].nLR);
    var razao = {};
    Object.keys(D.razoes).forEach(function (k) { razao[k] = D.razoes[k]; });
    var acumulado = 0;
    for (var n = 1; D.ano_base + n <= ULTIMO_ANO; n++) {
      var ano = D.ano_base + n;
      var f = Math.pow(1 + p.crescimento / 100, n);
      var rcaBase = D.rca * f, despBase = D.despesa * f, rclBase = D.rcl * f;
      var rampa = ano < 2029 ? 0 : Math.min(1, (ano - 2028) / 4);
      var perda = (p.perda / 100) * rampa * rcaBase;
      var extra = ano >= 2027 ? Math.max(0, p.emenda + p.poderes - p.ajuste) / 1000 : 0;
      var rca = rcaBase - perda;
      var r = (despBase + extra) / rca;
      razao[ano] = r;
      var pc = PESOS[0] * r + PESOS[1] * razao[ano - 1] + PESOS[2] * razao[ano - 2];
      acumulado += extra + perda; // o que falta sai do caixa livre
      var rcl = rclBase - perda * (D.rcl / D.rca);
      var lr = (D.lr * rclBase - acumulado) / rcl;
      var dcrcl = D.divida / rcl; // dívida constante: amortizações compensadas por crédito para investimento
      var a = notaDC(dcrcl), b = notaPC(pc), c = notaLR(lr);
      linhas.push({ ano: ano, dc_rcl: dcrcl, pc: pc, lr: lr, extra: extra, perda: perda, nDC: a, nPC: b, nLR: c,
        final: notaFinal(a, b, c), causa: causa(a, b, c) });
    }
    return linhas;
  }

  function primeiroAnoSemA(linhas) {
    for (var i = 0; i < linhas.length; i++) if (linhas[i].final !== 'A') return linhas[i];
    return null;
  }

  // Maior despesa permanente nova (R$ mi por ano, a partir de 2027) que mantém a nota A até 2032, com as demais premissas dadas.
  function espacoMaximo(D, p) {
    function mantem(e) {
      var q = { crescimento: p.crescimento, perda: p.perda, emenda: e, poderes: 0, ajuste: 0 };
      return primeiroAnoSemA(simular(D, q)) === null;
    }
    if (!mantem(0)) return { valor: 0, limite: primeiroAnoSemA(simular(D, { crescimento: p.crescimento, perda: p.perda, emenda: 0, poderes: 0, ajuste: 0 })) };
    var lo = 0, hi = 20000;
    if (mantem(hi)) return { valor: hi, limite: null };
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (mantem(mid)) lo = mid; else hi = mid;
    }
    var depois = primeiroAnoSemA(simular(D, { crescimento: p.crescimento, perda: p.perda, emenda: hi, poderes: 0, ajuste: 0 }));
    return { valor: lo, limite: depois };
  }

  // Espaço de cada indicador hoje, isoladamente, em R$ bilhões (receitas e caixa do ano-base).
  function espacosAtuais(D) {
    return {
      divida: 0.60 * D.rcl - D.divida,
      despesaAteB: (0.85 - D.pc) * D.rca,
      despesaAteC: (0.95 - D.pc) * D.rca,
      caixaAteB: (D.lr - 0.05) * D.rcl,
      caixaAteC: D.lr * D.rcl
    };
  }

  raiz.Modelo = { notaDC: notaDC, notaPC: notaPC, notaLR: notaLR, notaFinal: notaFinal, causa: causa, simular: simular,
    primeiroAnoSemA: primeiroAnoSemA, espacoMaximo: espacoMaximo, espacosAtuais: espacosAtuais, ULTIMO_ANO: ULTIMO_ANO };
})(typeof window !== 'undefined' ? window : module.exports);
