(() => {
  'use strict';
  // Módulo "Suspensos e rescindidos": contratos do Estado cuja situação no SIGA é de suspensão, rescisão ou anulação,
  // com o que há de novo desde o levantamento anterior (pipeline/contratos/suspensos.py). O cadastro confirma a decisão
  // depois que o órgão a registra; as notícias costumam vir antes.
  const { el, nInt, norm, brlCompacto } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  const filtros = { cat: '', busca: '', novos: false };
  const POR_VEZ = 50;
  let visiveis = POR_VEZ;
  const CATS = { suspenso: 'Suspensos', rescindido: 'Rescindidos', anulado: 'Anulados ou revogados' };
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
  const kpi = (rotulo, valor, nota, alerta) => el('div', { class: 'kpi' + (alerta ? ' alerta' : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const valorDe = (i) => i.valor_final || i.valor_inicial || 0;

  function filtrar() {
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    const novos = new Set(dados.novos);
    return dados.itens.filter((i) => {
      if (filtros.cat && i.categoria !== filtros.cat) return false;
      if (filtros.novos && !novos.has(i.id)) return false;
      if (termos.length) { const t = norm([i.orgao, i.fornecedor, i.objeto, i.documento, i.tipo].join(' ')); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function linha(i, ehNovo) {
    return el('li', { class: 'noticia' },
      el('div', { class: 'noticia-titulo' }, `${i.fornecedor || 'Fornecedor não informado'} · ${i.orgao}`),
      el('div', { class: 'susp-obj' }, i.objeto || '(sem objeto no cadastro)'),
      el('div', { class: 'noticia-meta' },
        el('span', { class: 'selo ' + (i.categoria === 'suspenso' ? 'n-a' : 'n-m') }, el('b', {}, CATS[i.categoria].replace(/s$/, ''))),
        ehNovo ? el('span', { class: 'selo n-a' }, el('b', {}, `novo em ${dataBR(i.visto_em)}`)) : null,
        el('span', {}, i.tipo || 'Instrumento'), el('span', {}, valorDe(i) ? brlCompacto(valorDe(i)) : 'valor não informado'),
        el('span', {}, `celebrado em ${dataBR(i.celebracao)}`), i.fim ? el('span', {}, `vigência até ${dataBR(i.fim)}`) : null,
        el('span', { title: i.situacao }, `situação: ${i.situacao}`)));
  }

  function render() {
    if (!raiz || !dados) return;
    const c = dados.contagem;
    const novos = new Set(dados.novos);
    $('#kpis').replaceChildren(
      kpi('Suspensos', nInt.format(c.suspenso), 'execução suspensa no cadastro', c.suspenso > 0),
      kpi('Rescindidos', nInt.format(c.rescindido), 'do mandato atual ou ainda em vigência'),
      kpi('Anulados ou revogados', nInt.format(c.anulado), 'do mandato atual ou ainda em vigência'),
      kpi('Novos desde o levantamento anterior', dados.baseline ? '—' : nInt.format(dados.novos.length),
        dados.baseline ? `primeiro levantamento, em ${dataBR(dados.primeiro_levantamento)}: a comparação começa no próximo` : `levantamento anterior até ${dataBR(dados.ref)}`, dados.novos.length > 0));
    $('#chips').replaceChildren(...[['', 'Todos', c.suspenso + c.rescindido + c.anulado], ...Object.entries(CATS).map(([k, r]) => [k, r, c[k]])].map(([v, r, n]) =>
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.cat === v && !filtros.novos), onclick: () => { filtros.cat = v; filtros.novos = false; visiveis = POR_VEZ; render(); } }, r, el('small', {}, nInt.format(n)))),
    el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.novos), onclick: () => { filtros.novos = !filtros.novos; filtros.cat = ''; visiveis = POR_VEZ; render(); } }, 'Só os novos', el('small', {}, nInt.format(dados.novos.length))));
    const lista = filtrar();
    $('#resumo').textContent = `${nInt.format(lista.length)} ${lista.length === 1 ? 'instrumento' : 'instrumentos'}`;
    const pedaco = lista.slice(0, visiveis);
    $('#lista').replaceChildren(
      lista.length ? el('ul', { class: 'noticias' }, pedaco.map((i) => linha(i, novos.has(i.id) && i.visto_em))) : el('p', { class: 'vazio' }, 'Nenhum instrumento corresponde ao filtro.'),
      lista.length > visiveis ? el('div', { class: 'ferramentas' }, el('button', { type: 'button', class: 'botao', onclick: () => { visiveis += POR_VEZ; render(); } }, `Mostrar mais (${nInt.format(lista.length - visiveis)} restantes)`)) : null);
    $('#agrup').replaceChildren(...dados.por_orgao.slice(0, 8).map((o) => el('li', {}, el('b', {}, o.orgao), ` · ${nInt.format(o.suspenso)} suspensos, ${nInt.format(o.rescindido)} rescindidos, ${nInt.format(o.anulado)} anulados`)));
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Contratos suspensos e rescindidos</h2>
          <p class="sub">Instrumentos do Estado cuja situação no cadastro de contratos (SIGA) é de suspensão, rescisão ou anulação, e o que mudou desde o levantamento anterior. Atualizado nos horários do resumo por e-mail.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <p class="aviso solto">Este cadastro <b>confirma</b> a decisão depois que o órgão a registra; não a antecipa. Uma suspensão pode aparecer antes na imprensa (veja o painel Notícias, tema "Restrições e cortes") e só depois aqui.</p>
      <div id="kpis" class="kpis"></div>
      <div class="cartao">
        <div class="filtros"><label class="busca">Buscar por órgão, fornecedor ou objeto<input id="busca" type="search" maxlength="80" placeholder="Ex.: Sejus, tecnologia, monitoramento…"></label></div>
        <div id="chips" class="chips" role="group" aria-label="Filtrar por situação"></div>
        <p id="resumo" class="mesref"></p>
        <div id="lista"></div>
      </div>
      <details class="cartao noticias-metodo"><summary>Órgãos com mais ocorrências</summary><ul id="agrup" class="noticias-fontes"></ul></details>
      <details class="cartao noticias-metodo"><summary>Fonte e método</summary>
        <p>Dados abertos do Portal da Transparência do ES (sistema SIGA), arquivos anuais de Contratos, lidos todo dia. A tela mostra os instrumentos com situação de suspensão (de qualquer ano, são poucos) e os rescindidos, anulados ou revogados celebrados desde 2023 ou com fim de vigência no ano corrente. "Novo" é o que não constava no levantamento anterior ou mudou de situação (por exemplo, de suspenso para rescindido); no primeiro levantamento nada é marcado como novo.</p>
        <p>Limites: o cadastro depende do registro do órgão e pode atrasar em relação à decisão; os instrumentos incluem contratos, ordens de fornecimento e autorizações de compra, de valores muito diferentes; a lista não avalia a regularidade de nenhuma suspensão.</p>
      </details>
    </section>`;

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Ainda não há levantamento de contratos suspensos.'));
      return false;
    }
    $('#mesref').textContent = 'Levantamento: ' + dataBR(dados.ref);
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; visiveis = POR_VEZ; }
  PF.registrar({ id: 'suspensos', titulo: 'Contratos suspensos', montar, aoNavegar, desmontar });
})();
