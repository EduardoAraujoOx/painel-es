(() => {
  'use strict';
  // Ficha de uma pessoa que ocupa cargo em comissão ou função gratificada: a composição da folha do mês (vantagens e descontos
  // por rubrica, com as que entram no valor do cargo em destaque), o que o cargo representa na remuneração, uma estimativa do
  // efeito de retirá-lo (com o abate do teto constitucional) e, quando há, o que a pessoa recebe de fundos fora da folha.
  // Usada pelas telas de cargos e de vínculos políticos: PF.fichaPessoa({ sigla, id }) ou PF.fichaPessoa({ sigla, ocupante }).
  const { el, nBRL, titulo, norm, soma, rotuloMes } = PF;
  const brl = (v) => nBRL.format(v);
  const pct = (x) => (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + '%';

  // ---------- classificação das rubricas ----------
  const NAO_CORRENTE = /(\b13\b|DECIMO|FERIAS|RESCISAO|INSUFICIENCIA|DEVOLUCAO|DEBITO EXERC|INDENIZACAO FERIAS)/;
  const GRUPOS = ['Cargo ou função de confiança', 'Remuneração da carreira', 'Desempenho e produtividade', 'Gratificações e adicionais', 'Auxílios e indenizações', '13º, férias e rescisão', 'Outras vantagens'];
  function grupoDe(r, c) {
    if (c) return GRUPOS[0];
    if (NAO_CORRENTE.test(r)) return GRUPOS[5];
    if (/^(SUBSIDIO|SALARIO BASE|VENCIMENTO|SOLDO|PISO NACIONAL|SALARIO MATERNIDADE)/.test(r)) return GRUPOS[1];
    if (/(BONIF|DESEMP|PRODUTIV)/.test(r)) return GRUPOS[2];
    if (/(GRAT|FUNCAO|EXTENSAO|EXT\. |SUBSTITUICAO|ADICIONAL|ABONO PERMANENCIA|GDASE|GFPM)/.test(r)) return GRUPOS[3];
    if (/(AUX|AJUDA|INDEN|ABONO)/.test(r)) return GRUPOS[4];
    return GRUPOS[6];
  }
  const ROTULOS = {
    SUBSIDIO: 'Subsídio', 'OPCAO CARGO COMISSIONADO': 'Opção pelo cargo comissionado', 'VENC CARGO COMISSIONADO': 'Vencimento do cargo comissionado', 'VENC CARGO COMISS EFET': 'Vencimento do cargo comissionado (servidor efetivo)',
    'FUNCAO GRATIFICADA': 'Função gratificada', 'BONIFICACAO DESEMPENHO': 'Bonificação por desempenho', 'AUXILIO ALIMENTACAO LIQUIDO': 'Auxílio-alimentação', 'GRATIF PRODUTIVIDADE C.COMISS': 'Gratificação de produtividade (comissionado)',
    IR: 'Imposto de renda', 'DESCONTO INSS': 'INSS', 'FP/IPAJM MENSAL LEI 282/2004': 'Previdência (Fundo Previdenciário, IPAJM)', 'FF/IPAJM MENSAL': 'Previdência (Fundo Financeiro, IPAJM)',
    'CONTRIBUICAO MENSAL FPS': 'Contribuição ao Fundo de Proteção Social dos Militares', 'ABATE TETO EC 41': 'Abate do teto constitucional', 'GRATIF TEMPO DE SERVICO': 'Gratificação por tempo de serviço',
    'AD 13 SALARIO LIQ': 'Adiantamento do 13º salário', 'AD AUX ALIM 13 SAL LIQUIDO': 'Auxílio-alimentação do 13º', 'ABONO FERIAS': 'Abono de férias', 'DESC AD LIQ AB FER': 'Desconto do adiantamento (abono de férias)',
    'ABONO PERMANENCIA': 'Abono de permanência', 'EXTENSAO DE CARGA HORARIA': 'Extensão de carga horária', 'GRATIFICACAO APOIO LICITACAO': 'Gratificação de apoio a licitação', 'GRATIF RISCO DE VIDA': 'Gratificação de risco de vida',
    'GRATIF DE ASSIDUIDADE': 'Gratificação de assiduidade', 'FUNCAO GRAT CHEF MILIT': 'Função gratificada (chefia militar)', 'FUNCAO GRATIFICADA DIRETOR': 'Função gratificada de diretor', 'FUNCAO GRATIFICADA CHEFIA': 'Função gratificada de chefia',
    'GRAT AREA EXAME': 'Gratificação de área de exame', 'SALARIO BASE': 'Salário base', VENCIMENTO: 'Vencimento', 'IR SOBRE FERIAS': 'Imposto de renda sobre férias', 'IR SOBRE 13 SALARIO': 'Imposto de renda sobre o 13º',
  };
  const ACENTOS = { ACAO: 'ação', ICAO: 'ição', ENCIA: 'ência', ARIO: 'ário', 'AUXILIO': 'auxílio', 'FERIAS': 'férias', 'SALARIO': 'salário', 'PERMANENCIA': 'permanência', 'GRATIFICACAO': 'gratificação', 'SUBSTITUICAO': 'substituição', 'INSALUBRIDADE': 'insalubridade' };
  const rotuloRubrica = (r) => {
    if (ROTULOS[r]) return ROTULOS[r];
    const t = titulo(r.replace(/\bGRATIF\b/, 'gratificação').replace(/\bGRAT\b/, 'gratificação').replace(/\bC\.COMISS\b/, 'comissionado'));
    return t.replace(/\b(\w+)\b/g, (m) => { const u = m.toUpperCase(); return ACENTOS[u] ? (m[0] === m[0].toUpperCase() ? ACENTOS[u][0].toUpperCase() + ACENTOS[u].slice(1) : ACENTOS[u]) : m; });
  };

  // Análise da folha do mês: vantagens (positivas) e descontos (negativos) por grupo, totais e efeito de retirar o cargo.
  function analisar(o) {
    const rub = (o.rub || []).map(([r, v, c]) => ({ r, v, c: !!c }));
    const vant = rub.filter((x) => x.v > 0), desc = rub.filter((x) => x.v < 0);
    const ordem = [...GRUPOS.filter((g) => g !== GRUPOS[2]), GRUPOS[2]];                    // desempenho e produtividade nas últimas linhas das vantagens
    const grupos = ordem.map((g) => ({ g, itens: vant.filter((x) => grupoDe(x.r, x.c) === g) })).filter((x) => x.itens.length);
    const bruto = soma(vant, (x) => x.v), descontos = soma(desc, (x) => -x.v);
    const corrente = soma(vant.filter((x) => !NAO_CORRENTE.test(x.r)), (x) => x.v);        // sem 13º, férias, rescisão e resíduos
    const cargo = soma(rub.filter((x) => x.c), (x) => x.v);
    const abate = -soma(rub.filter((x) => /ABATE TETO/.test(x.r)), (x) => Math.min(x.v, 0));
    // Retirando o cargo, a remuneração sujeita ao teto cai; o abate do teto encolhe primeiro. O efeito líquido é o valor do cargo
    // menos o que o teto já descontava e deixa de descontar. Estimativa: o teto incide sobre a remuneração corrente do mês.
    const novoAbate = Math.max(0, abate - cargo);
    const efeito = cargo - (abate - novoAbate);
    return { rub, vant, desc, grupos, bruto, descontos, liquido: bruto - descontos, corrente, cargo, abate, efeito };
  }

  // ---------- localização do ocupante ----------
  let indiceCargos = null;
  async function ocupanteDe(sigla, id) {
    if (!indiceCargos) indiceCargos = await PF.api('cargos', 'index');
    const org = indiceCargos.orgs.find((o) => o.sigla === sigla);
    if (!org) return { org: null, ocupantes: [] };
    const det = await PF.api('cargos', 'org/' + org.arquivo);
    return { org, mes: det.mes, ocupantes: det.ocupantes.filter((o) => o.id === id) };
  }
  PF.ocupanteDe = ocupanteDe;

  // pagamentos de fundos fora da folha (opcional)
  let fundosPessoas = null;
  async function pagamentosDe(sigla, nome) {
    if (fundosPessoas === null) {
      try { fundosPessoas = await PF.api('pessoalfundos', 'pessoas', { silencioso: true }); } catch (e) { fundosPessoas = false; }
    }
    if (!fundosPessoas) return [];
    const n = norm(nome).toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();   // mesma normalização de pipeline/pessoalfundos/montar.py
    return fundosPessoas.pessoas.filter((p) => p.n === n && (p.sigla === sigla || (p.folha && p.folha.org === sigla))).map((p) => ({ ...p, fundo: fundosPessoas.fundos[p.fundo] }));
  }

  // ---------- interface ----------
  function tabelaGrupos(a, pags) {
    const linhas = [];
    for (const { g, itens } of a.grupos) {
      linhas.push(el('tr', { class: 'ficha-grupo' + (g === GRUPOS[0] ? ' cargo' : '') }, el('td', {}, g), el('td', { class: 'num' }, brl(soma(itens, (x) => x.v)))));
      for (const x of itens) linhas.push(el('tr', { class: 'ficha-item' + (x.c ? ' cargo' : '') }, el('td', {}, rotuloRubrica(x.r)), el('td', { class: 'num' }, brl(x.v))));
    }
    linhas.push(el('tr', { class: 'ficha-total' }, el('td', {}, 'Total de vantagens'), el('td', { class: 'num' }, brl(a.bruto))));
    if (a.desc.length) {
      linhas.push(el('tr', { class: 'ficha-grupo' }, el('td', {}, 'Descontos'), el('td', { class: 'num' }, brl(-a.descontos))));
      for (const x of a.desc) linhas.push(el('tr', { class: 'ficha-item' }, el('td', {}, rotuloRubrica(x.r)), el('td', { class: 'num' }, brl(x.v))));
    }
    linhas.push(el('tr', { class: 'ficha-total' }, el('td', {}, 'Líquido do mês'), el('td', { class: 'num' }, brl(a.liquido))));
    if (pags.length) {
      linhas.push(el('tr', { class: 'ficha-grupo' }, el('td', {}, 'Pagos por fundo, fora da folha'), el('td', { class: 'num' }, brl(soma(pags, (p) => p.media)))));
      for (const p of pags) linhas.push(el('tr', { class: 'ficha-item' }, el('td', {}, `${p.fundo.titulo} (${p.fundo.fundo}), média mensal dos últimos 12 meses`), el('td', { class: 'num' }, brl(p.media))));
      linhas.push(el('tr', { class: 'ficha-total' }, el('td', {}, 'Líquido do mês mais pagamentos de fundo'), el('td', { class: 'num' }, brl(a.liquido + soma(pags, (p) => p.media)))));
    }
    if (a.cargo) linhas.push(el('tr', { class: 'ficha-item ficha-efeito' }, el('td', {}, 'Redução estimada da remuneração ao retirar o cargo' + (a.abate > 0 ? ' (já considerando o abate do teto)' : '')), el('td', { class: 'num' }, brl(a.abate > 0 ? a.efeito : a.cargo))));
    return el('div', { class: 'rolagem' }, el('table', { class: 'ficha-tabela' }, el('tbody', {}, linhas)));
  }

  async function abrir({ sigla, id, ocupante, alternativa, mes: mesDado, nomeOrg }) {
    let dlg = document.querySelector('dialog.ficha');
    if (dlg) dlg.remove();
    dlg = el('dialog', { class: 'ficha', 'aria-label': 'Ficha da pessoa' });
    const corpo = el('div', { class: 'ficha-corpo' }, el('p', { class: 'vazio', role: 'status' }, 'Carregando a ficha…'));
    const fechar = () => { dlg.close(); dlg.remove(); };
    dlg.append(el('button', { type: 'button', class: 'ficha-fechar', 'aria-label': 'Fechar', onclick: fechar }, '×'), corpo);
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) fechar(); });
    dlg.addEventListener('cancel', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    let lista = ocupante ? [ocupante] : [], mes = mesDado, org = nomeOrg ? { nome: nomeOrg } : null;
    if (!ocupante) {
      try { const r = await ocupanteDe(sigla, id); lista = r.ocupantes; mes = r.mes; org = r.org; } catch (e) {
        if (!alternativa) { corpo.replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar a ficha.')); return; }
      }
      if (!lista.length && alternativa) { lista = [alternativa]; mes = mesDado; org = nomeOrg ? { nome: nomeOrg } : null; }   // quem não tem cargo de confiança: a folha vem de quem chamou
    }
    if (!lista.length) { corpo.replaceChildren(el('p', { class: 'vazio' }, 'Esta pessoa não consta mais entre os ocupantes do último mês.')); return; }
    const o0 = lista[0];
    const pags = await pagamentosDe(sigla, o0.nome);
    const blocos = lista.map((o) => {
      const a = analisar(o);
      return el('section', { class: 'ficha-vinculo' },
        lista.length > 1 ? el('h3', {}, titulo(o.funcao) + (o.tipo === 'FG' ? ' (função gratificada)' : '')) : null,
        el('div', { class: 'kpis kpis-ficha' },
          el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Vantagens do mês'), el('div', { class: 'valor' }, brl(a.bruto)), el('div', { class: 'nota' }, `corrente: ${brl(a.corrente)}`)),
          el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Valor do cargo'), el('div', { class: 'valor' }, brl(o.valor)), el('div', { class: 'nota' }, a.cargo ? `${pct(a.cargo / Math.max(1, a.corrente))} da remuneração corrente` : 'sem rubrica de cargo no mês')),
          el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, 'Líquido do mês'), el('div', { class: 'valor' }, brl(a.liquido)), el('div', { class: 'nota' }, `descontos de ${brl(a.descontos)}`))),
        tabelaGrupos(a, pags));
    });
    corpo.replaceChildren(
      el('div', { class: 'ficha-topo' }, el('h2', {}, titulo(o0.nome)),
        el('p', {}, [titulo(o0.funcao), o0.unidade ? titulo(o0.unidade) : '', org ? `${sigla}` : sigla].filter(Boolean).join(' · ')),
        el('p', { class: 'ficha-sub' }, [o0.prov, o0.cargoEfetivo ? 'cargo efetivo: ' + titulo(o0.cargoEfetivo) : '', o0.vinculo ? 'vínculo: ' + titulo(o0.vinculo) : ''].filter(Boolean).join(' · '))),
      ...blocos,
      el('p', { class: 'fm-nota' }, `Folha de ${mes ? rotuloMes(mes, true) : ''}, competência corrente, conforme o Portal da Transparência (uma linha por rubrica). O que entra no valor do cargo está em destaque. A folha não traz CPF: se a pessoa tiver outro vínculo, a soma não aparece aqui.`),
      PF.barraCompartilhar(() => compartilhar(o0, lista, pags, mes, sigla)));
  }

  function compartilhar(o, lista, pags, mes, sigla) {
    const linhas = [];
    for (const ocup of lista) {
      const a = analisar(ocup);
      linhas.push([titulo(ocup.funcao), '', '']);
      for (const { g, itens } of a.grupos) for (const x of itens) linhas.push(['', `${g}: ${rotuloRubrica(x.r)}${x.c ? ' (cargo)' : ''}`, brl(x.v)]);
      linhas.push(['', 'Total de vantagens', brl(a.bruto)]);
      for (const x of a.desc) linhas.push(['', 'Desconto: ' + rotuloRubrica(x.r), brl(x.v)]);
      linhas.push(['', 'Liquido do mes', brl(a.liquido)]);
      if (a.cargo) linhas.push(['', 'Efeito estimado de retirar o cargo', brl(a.abate > 0 ? a.efeito : a.cargo)]);
    }
    for (const p of pags) linhas.push(['Fundo', `${p.fundo.titulo} (media mensal, 12 meses)`, brl(p.media)]);
    if (pags.length) linhas.push(['', 'Liquido do mes mais pagamentos de fundo', brl(soma(lista.slice(0, 1), (ocup) => analisar(ocup).liquido) + soma(pags, (p) => p.media))]);
    return { titulo: `Folha de ${titulo(o.nome)}`, paisagem: false, arquivo: `ficha-${sigla}-${o.id}`,
      filtros: [`${titulo(o.nome)}, ${titulo(o.funcao)}, ${sigla}; folha de ${mes ? rotuloMes(mes, true) : ''}, competencia corrente`, 'Dado pessoal de agente publico, de fonte publica (Portal da Transparencia): uso restrito a equipe de transicao.'],
      colunas: [{ t: 'Funcao', w: 2.2 }, { t: 'Item', w: 5 }, { t: 'Valor', w: 1.6, n: 1 }], linhas, texto: [`${titulo(o.nome)} (${sigla}): ${titulo(o.funcao)}`] };
  }

  PF.fichaPessoa = abrir;
})();
