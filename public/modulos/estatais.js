(() => {
  'use strict';
  // Módulo "Empresas estatais": contratos de Banestes (e empresas do Sistema Financeiro), Bandes, Cesan, Ceturb-GV, ES Gás e Ceasa, com o que foi pago.
  // Essas empresas não são órgãos do SIGA nem pagadoras no SIGEFES; os dados vêm do CidadES (TCE-ES) e são declaratórios (pipeline/estatais/cidades.py).
  const { el, nInt, nBRL, norm, brlCompacto } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null; // index.json: resumo por empresa
  let atual = null; // id da empresa aberta ('' = visão geral)
  const cache = {}; // arquivos por empresa, carregados ao abrir
  const filtros = { busca: '', escopo: 'todos', ano: '' };
  const POR_VEZ = 40;
  let visiveis = POR_VEZ;
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
  const cnpjFmt = (c) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c || '');
  const kpi = (rotulo, valor, nota) => el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const anosPagos = () => [...new Set(dados.empresas.flatMap((e) => Object.keys(e.pagoAno)))].sort().slice(-3);

  function visaoGeral() {
    const anos = anosPagos();
    const tot = (f) => dados.empresas.reduce((s, e) => s + f(e), 0);
    $('#kpis').replaceChildren(
      kpi('Empresas', nInt.format(dados.empresas.length), 'com contratos no CidadES'),
      kpi('Instrumentos', nInt.format(tot((e) => e.instrumentos)), 'contratos, ordens e autorizações, 2021 a 2026'),
      kpi('Valor declarado', brlCompacto(tot((e) => e.valorAtual)), 'valor atual dos instrumentos'),
      kpi('Pago (medições)', brlCompacto(tot((e) => e.pago)), 'soma dos pagamentos informados'),
      kpi('Publicidade', brlCompacto(tot((e) => e.publicidade.pago)), `${nInt.format(tot((e) => e.publicidade.instrumentos))} instrumentos`));
    $('#chips').replaceChildren();
    $('#filtros').hidden = true;
    $('#lista').replaceChildren(el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Empresa', 'Instrumentos', 'Fornecedores', 'Valor declarado', 'Pago no total', ...anos.map((a) => `Pago ${a}`), 'Publicidade (pago)'].map((t, n) => el('th', { class: n > 0 ? 'num' : '' }, t)))),
      el('tbody', {}, dados.empresas.map((e) => el('tr', {},
        el('td', { class: 'objeto' }, el('strong', {}, el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); ctx.irPara(e.id); } }, e.nome))),
        el('td', { class: 'num' }, nInt.format(e.instrumentos)), el('td', { class: 'num' }, nInt.format(e.fornecedores)),
        el('td', { class: 'num' }, brlCompacto(e.valorAtual)), el('td', { class: 'num' }, brlCompacto(e.pago)),
        ...anos.map((a) => el('td', { class: 'num' }, e.pagoAno[a] ? brlCompacto(e.pagoAno[a]) : '—')),
        el('td', { class: 'num' }, e.publicidade.instrumentos ? `${brlCompacto(e.publicidade.pago)} (${e.publicidade.instrumentos})` : '—')))))));
    $('#resumo').textContent = 'Escolha uma empresa para ver os contratos, fornecedores e pagamentos.';
  }

  function filtrar(lista) {
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    return lista.filter((c) => {
      if (filtros.escopo === 'publicidade' && !c.publicidade) return false;
      if (filtros.escopo === 'pagos' && !c.pago) return false;
      if (filtros.ano && c.assinatura.slice(0, 4) !== filtros.ano) return false;
      if (termos.length) { const t = norm([c.forn, c.cnpj, c.objeto, c.numero, c.modalidade].join(' ')); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function linha(c) {
    const anos = Object.entries(c.pagoAno).map(([a, v]) => `${a}: ${brlCompacto(v)}`).join(' · ');
    return el('tr', {},
      el('td', { class: 'objeto' }, el('strong', {}, c.forn || '—'), el('small', {}, cnpjFmt(c.cnpj))),
      el('td', { class: 'objeto' }, c.objeto || '—', c.alteracoes.length ? el('small', { title: c.alteracoes.map((a) => `${a[0]} (${dataBR(a[1])}): ${a[2]}`).join('\n') }, `${nInt.format(c.nAlteracoes)} termo(s) de alteração`) : null),
      el('td', {}, c.url ? el('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, `nº ${c.numero}/${c.ano}`) : `nº ${c.numero}/${c.ano}`, el('small', {}, [c.tipo, c.modalidade].filter(Boolean).join(' · ')), el('small', {}, 'assinado em ' + dataBR(c.assinatura))),
      el('td', {}, `${dataBR(c.ini)} a ${dataBR(c.fim)}`, el('small', {}, c.situacao)),
      el('td', { class: 'num' }, brlCompacto(c.valorAtual), c.valorInicial && c.valorInicial !== c.valorAtual ? el('small', {}, 'inicial ' + brlCompacto(c.valorInicial)) : null),
      el('td', { class: 'num' }, c.pago ? brlCompacto(c.pago) : '—', c.pago ? el('small', {}, `${anos}; ${nInt.format(c.medicoes)} medições`) : el('small', {}, 'sem pagamento informado')));
  }

  function empresa(info, arq) {
    const lista = filtrar(arq.instrumentos);
    const anos = anosPagos();
    $('#kpis').replaceChildren(
      kpi('Instrumentos', nInt.format(info.instrumentos), `${nInt.format(info.fornecedores)} fornecedores`),
      kpi('Valor declarado', brlCompacto(info.valorAtual), 'valor atual dos instrumentos'),
      kpi('Pago no total', brlCompacto(info.pago), 'soma dos pagamentos das medições'),
      ...anos.map((a) => kpi(`Pago em ${a}`, info.pagoAno[a] ? brlCompacto(info.pagoAno[a]) : '—', a === anos[anos.length - 1] ? 'até a última remessa' : '')),
      kpi('Publicidade', brlCompacto(info.publicidade.pago), `${nInt.format(info.publicidade.instrumentos)} instrumentos`));
    const botao = (rotulo, ativo, fn) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(ativo), onclick: () => { fn(); visiveis = POR_VEZ; render(); } }, rotulo);
    const nPub = arq.instrumentos.filter((c) => c.publicidade).length;
    $('#chips').replaceChildren(botao('Todos', filtros.escopo === 'todos', () => { filtros.escopo = 'todos'; }), botao(`Publicidade (${nPub})`, filtros.escopo === 'publicidade', () => { filtros.escopo = 'publicidade'; }),
      botao('Com pagamento informado', filtros.escopo === 'pagos', () => { filtros.escopo = 'pagos'; }), botao('Voltar à visão geral', false, () => { ctx.irPara(''); }));
    $('#filtros').hidden = false;
    const anosAss = [...new Set(arq.instrumentos.map((c) => c.assinatura.slice(0, 4)).filter(Boolean))].sort();
    $('#ano').replaceChildren(el('option', { value: '' }, 'Todos os anos de assinatura'), ...anosAss.map((a) => el('option', { value: a, selected: a === filtros.ano }, a)));
    $('#resumo').textContent = `${info.nome}: ${nInt.format(lista.length)} instrumento(s), em ordem do mais pago; pago nesta seleção: ${brlCompacto(lista.reduce((s, c) => s + c.pago, 0))}.`;
    const pedaco = lista.slice(0, visiveis);
    $('#lista').replaceChildren(pedaco.length ? el('div', { class: 'rolagem' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Fornecedor', 'Objeto', 'Instrumento', 'Vigência registrada', 'Valor atual', 'Pago'].map((t, n) => el('th', { class: n >= 4 ? 'num' : '' }, t)))),
      el('tbody', {}, pedaco.map(linha)))) : el('p', { class: 'vazio' }, 'Nenhum instrumento corresponde ao filtro.'),
      lista.length > visiveis ? el('div', { class: 'ferramentas' }, el('button', { type: 'button', class: 'botao', onclick: () => { visiveis += POR_VEZ; render(); } }, `Mostrar mais (${nInt.format(lista.length - visiveis)} restantes)`)) : null);
  }

  async function render() {
    if (!atual) { visiveis = POR_VEZ; return visaoGeral(); }
    const info = dados.empresas.find((e) => e.id === atual);
    if (!info) { atual = ''; return visaoGeral(); }
    if (!cache[atual]) {
      try { cache[atual] = await ctx.api(info.arquivo); } catch (e) {
        if (e.sessao) { PF.mostrarLogin(); return; }
        $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Não foi possível carregar os contratos desta empresa.'));
        return;
      }
    }
    empresa(info, cache[atual]);
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Empresas estatais</h2>
          <p class="sub">Contratos das empresas estatais do Espírito Santo (Banestes e empresas do Sistema Financeiro Banestes, Bandes, Cesan, Ceturb-GV, ES Gás e Ceasa) e o que foi pago, segundo o <b>CidadES</b>, do Tribunal de Contas. Elas não são órgãos do SIGA nem pagam pelo SIGEFES; por isso não aparecem nas demais telas de contratos.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <p class="aviso solto">Dados <b>declaratórios</b>: as próprias empresas remetem ao CidadES. A vigência e a situação podem não refletir termos posteriores, e o pago é a soma dos pagamentos informados nas medições de cada contrato.</p>
      <div id="kpis" class="kpis"></div>
      <div class="cartao">
        <div id="filtros" class="filtros" hidden>
          <label class="busca">Buscar por fornecedor, CNPJ, objeto ou número<input id="busca" type="search" maxlength="80" placeholder="Ex.: publicidade, 11.145.893, vigilância…"></label>
          <label>Ano de assinatura<select id="ano"></select></label>
        </div>
        <div id="chips" class="chips" role="group" aria-label="Filtrar instrumentos"></div>
        <p id="resumo" class="mesref"></p>
        <div id="lista"></div>
      </div>
      <details class="cartao noticias-metodo"><summary>Fonte e método</summary>
        <p>Fonte: TCE-ES, CidadES, dados abertos "Contratações - Controle Externo" (portal dados.es.gov.br), arquivo de instrumentos contratuais com medições e alterações, lido uma vez por semana. A tela traz os instrumentos (contratos, ordens de fornecimento e autorizações de compra) de 2021 a 2026 das empresas estatais.</p>
        <p>O valor atual é o valor do instrumento após as alterações informadas; o pago é a soma de <code>ValorPagamento</code> das medições, por ano de pagamento, sem duplicar medições repetidas. Contratos sem medição informada aparecem sem pagamento, o que pode ser falta de remessa e não ausência de pagamento.</p>
        <p>Limites: dados declaratórios; fornecedores não têm ficha completa nesta tela (cadastro, sócios e bases externas estão nas telas de contratos para quem também contrata com os órgãos do SIGA); a publicidade é identificada pelo texto do objeto (publicidade, propaganda, agência de publicidade).</p>
      </details>
    </section>`;

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Ainda não há levantamento das empresas estatais.'));
      return false;
    }
    $('#mesref').textContent = 'Levantamento: ' + dataBR(dados.geradoEm);
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    $('#ano').addEventListener('change', (ev) => { filtros.ano = ev.target.value; visiveis = POR_VEZ; render(); });
    return true; // o núcleo chama aoNavegar(resto) em seguida e a tela se desenha
  }
  function aoNavegar(resto) { if (dados) { atual = resto || ''; filtros.escopo = 'todos'; filtros.ano = ''; filtros.busca = ''; const b = $('#busca'); if (b) b.value = ''; visiveis = POR_VEZ; render(); } }
  function desmontar() { dados = null; atual = null; visiveis = POR_VEZ; }
  PF.registrar({ id: 'estatais', titulo: 'Empresas estatais', montar, aoNavegar, desmontar });
})();
