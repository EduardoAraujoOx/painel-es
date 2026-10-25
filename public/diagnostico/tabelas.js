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
  function colunas(D, cen) {
    var sim = M.simular(D, cen.p), cols = [];
    var rcl20 = D.historico_caixa.filter(function (q) { return q.ano === 2020; })[0].rcl;
    var anterior = rcl20;
    D.tabela_historica.forEach(function (h) {
      var lr = h.lr, nDC = M.notaDC(h.dc_rcl), nPC = M.notaPC(h.pc), nLR = M.notaLR(lr);
      cols.push({ ano: h.ano, tipo: 'real', rotulo: String(h.ano), g: h.rcl / anterior - 1, divida: h.divida, rcl: h.rcl, dc_rcl: h.dc_rcl, despesa: h.despesa, rca: h.rca,
        razao: h.razao, pc: h.pc, caixa: h.caixa, lr: lr, nDC: nDC, nPC: nPC, nLR: nLR, final: M.notaFinal(nDC, nPC, nLR), extra: null, perda: null,
        reconstruida: h.nota_final === null });
      anterior = h.rcl;
    });
    sim.forEach(function (l, i) {
      var cresc = i === 0 ? D.base.crescimento_ano.rcl : l.rcl / anterior - 1; // crescimento da RCL já líquido da perda de receita
      anterior = l.rcl;
      var c = { ano: l.ano, tipo: i === 0 ? 'estimado' : 'projecao', rotulo: i === 0 ? l.ano + 'e' : String(l.ano), g: cresc,
        divida: l.divida, rcl: l.rcl, dc_rcl: l.dc_rcl, despesa: l.despesa, rca: l.rca, razao: l.razao, pc: l.pc, caixa: l.caixa, lr: l.lr,
        nDC: l.nDC, nPC: l.nPC, nLR: l.nLR, final: l.final, extra: i === 0 ? null : l.extra, perda: i === 0 ? null : l.perda };
      cols.push(c);
    });
    return cols;
  }

  // Estrutura de uma tabela de cenário. Cada linha tem rotulo e celulas [{t, nota, vazio}]; cada coluna pode ser marcada como perda de nota A.
  function cenario(D, cen) {
    var cols = colunas(D, cen), semReforma = !cen.p.reforma;
    function linha(rotulo, f, opt) {
      opt = opt || {};
      return { rotulo: rotulo, destaque: !!opt.destaque, dica: opt.dica || '', celulas: cols.map(function (c) {
        var v = f(c);
        if (v === null || v === undefined) return { t: TRACO, vazio: true };
        return typeof v === 'string' ? { t: v } : { t: v.t, nota: v.nota || null };
      }) };
    }
    var grupos = [
      { titulo: 'O que muda de ano para ano', linhas: [
        linha('Crescimento nominal da RCL (%)', function (c) { return pct(c.g, 1); }),
        linha('Gasto novo: emendas e Poderes (R$ mi)', function (c) { return c.extra === null ? null : mi(c.extra * 1000); }),
        linha('Perda de receita da reforma (R$ mi)', function (c) { return c.perda === null || semReforma ? null : mi(c.perda * 1000); })
      ] },
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
    return { id: cen.id, titulo: cen.titulo, resumo: cen.resumo, colunas: cols.map(function (c) { return { ano: c.ano, rotulo: c.rotulo, tipo: c.tipo, perde: c.final !== 'A' && c.tipo !== 'real', reconstruida: !!c.reconstruida }; }),
      grupos: grupos, primeiro: primeiro ? { ano: primeiro.ano, causa: M.causa(primeiro.nDC, primeiro.nPC, primeiro.nLR), lr: primeiro.lr, caixa: primeiro.caixa } : null,
      final2033: cols[cols.length - 1] };
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
      { rotulo: 'Receita e despesa que já existe crescem juntas 1 ponto percentual a mais por ano', f: function (p) { return copia(p, { receita_pp: 1 }); } },
      { rotulo: 'Compensação de R$ 200 mi por ano (corte ou receita nova)', f: function (p) { return copia(p, { ajuste: 200 }); } },
      { rotulo: 'Caixa livre cresce R$ 100 mi por ano além do gasto novo', f: function (p) { return copia(p, { deriva: 100 }); } },
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
        evidencia: 'PIB real mais IPCA dos estudos do autor sobre o IBS (Focus até 2030, IFI depois), com a receita de referência crescendo com o PIB. É menos que a média de ' + pct(CH.receita) + ' ao ano da receita corrente ajustada de ' + CH.de + ' a ' + CH.ate + '.',
        situacao: 'Estudo do autor', classe: 'autor', fontes: [[MA.fonte, '']] },
      { parametro: 'Crescimento da despesa que já existe',
        valor: 'Igual ao da receita (pressão de zero ponto percentual).',
        evidencia: 'De ' + CH.de + ' a ' + CH.ate + ' a receita corrente ajustada cresceu ' + pct(CH.receita, 2) + ' ao ano e a despesa corrente ajustada ' + pct(CH.despesa, 2) + ' ao ano. A razão entre as duas oscilou de ' +
          pct(Math.min.apply(null, razoes), 0) + ' a ' + pct(Math.max.apply(null, razoes), 0) + ' sem tendência e foi de ' + pct(CH.razoes['2025']) + ' em 2025. Educação, saúde, Poderes e emendas são percentuais da receita. A matriz de sensibilidade testa uma despesa 1 ponto percentual acima.',
        situacao: 'Siconfi', classe: 'oficial', fontes: [['Siconfi, RREO anexo 01 e DCA anexo I-D; cálculo próprio', '']] },
      { parametro: 'Caixa livre sem fato novo',
        valor: 'Constante em valor, R$ ' + bi(B.caixa) + ' bi.',
        evidencia: 'Ficou entre R$ ' + bi(Math.min.apply(null, caixas)) + ' bi e R$ ' + bi(Math.max.apply(null, caixas)) + ' bi de 2021 a 2025, enquanto a RCL cresceu ' + pct(ano(2025).rcl / ano(2021).rcl - 1, 0) + '. Em 2026, até agosto, o resultado primário é de R$ ' + bi(D.parcial_2026.resultado_primario_ate_agosto) + ' bi, abaixo dos R$ ' + bi(D.parcial_2026.resultado_primario_ate_agosto_2025) + ' bi de agosto de 2025: o que sugere que a receita extra de 2026 não está sendo acumulada em caixa.',
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

  raiz.Tabelas = { cenario: cenario, sensibilidade: sensibilidade, premissas: premissas, num: num, pct: pct };
})(typeof window !== 'undefined' ? window : module.exports, typeof window !== 'undefined' ? window.Modelo : require('./modelo.js').Modelo);
