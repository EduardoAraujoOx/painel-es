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
  let datas = {}; // data de cada instrumento, quando alguma fonte a tem (pipeline/cruzamento/datas.py): o cadastro (SIGA) não informa
  const filtros = { cat: '', busca: '', novos: false, comData: false };
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
      if (filtros.comData && !datas[i.id]) return false;
      if (termos.length) { const t = norm([i.orgao, i.fornecedor, i.objeto, i.documento, i.tipo].join(' ')); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    }).sort((a, b) => ((datas[b.id] && datas[b.id].data) || '').localeCompare((datas[a.id] && datas[a.id].data) || '')); // mais recentes primeiro; sem data no fim (ordenação estável)
  }

  function linha(i, ehNovo) {
    const d = datas[i.id];
    return el('li', { class: 'noticia' },
      el('div', { class: 'noticia-titulo' }, `${i.fornecedor || 'Fornecedor não informado'} · ${i.orgao}`),
      el('div', { class: 'susp-obj' }, i.objeto || '(sem objeto no cadastro)'),
      el('div', { class: 'noticia-meta' },
        el('span', { class: 'selo ' + (i.categoria === 'suspenso' ? 'n-a' : 'n-m') }, el('b', {}, CATS[i.categoria].replace(/s$/, ''))),
        ehNovo ? el('span', { class: 'selo n-a' }, el('b', {}, `novo em ${dataBR(i.visto_em)}`)) : null,
        d ? el('span', { class: 'selo n-m' }, el('b', {}, dataBR(d.data))) : null,
        d ? (d.url ? el('a', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, d.texto) : el('span', {}, d.texto)) : null,
        el('span', {}, i.tipo || 'Instrumento'), el('span', {}, valorDe(i) ? brlCompacto(valorDe(i)) : 'valor não informado'),
        el('span', {}, `celebrado em ${dataBR(i.celebracao)}`), i.fim ? el('span', {}, `vigência até ${dataBR(i.fim)}`) : null,
        el('span', { title: i.situacao }, `situação: ${i.situacao}`)));
  }

  // Lista agrupada pela melhor data disponível (Diário, Portal de Obras ou primeira detecção pelo painel), da mais recente à mais antiga; o que o cadastro
  // não data fica no fim, em bloco próprio.
  const diaRotulo = (iso) => { const t = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); };
  function porDia(itens, todos, novos) {
    const dia = (i) => (datas[i.id] && datas[i.id].data) || '';
    const conta = {};
    for (const i of todos) conta[dia(i)] = (conta[dia(i)] || 0) + 1;
    const blocos = [];
    let atual = null, ul = null;
    for (const i of itens) {
      if (atual === null || dia(i) !== atual) {
        atual = dia(i);
        ul = el('ul', { class: 'noticias' });
        const n = conta[atual];
        blocos.push(el('section', { class: 'noticias-dia' }, el('h3', {}, `${atual ? diaRotulo(atual) : 'Sem data no cadastro'} · ${nInt.format(n)} ${n === 1 ? 'instrumento' : 'instrumentos'}`), ul));
      }
      ul.append(linha(i, novos.has(i.id) && i.visto_em));
    }
    return blocos;
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
    el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.novos), onclick: () => { filtros.novos = !filtros.novos; filtros.cat = ''; visiveis = POR_VEZ; render(); } }, 'Só os novos', el('small', {}, nInt.format(dados.novos.length))),
    el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.comData), onclick: () => { filtros.comData = !filtros.comData; visiveis = POR_VEZ; render(); } }, 'Só com data', el('small', {}, nInt.format(dados.itens.filter((i) => datas[i.id]).length))));
    const lista = filtrar();
    $('#resumo').textContent = `${nInt.format(lista.length)} ${lista.length === 1 ? 'instrumento' : 'instrumentos'}`;
    const pedaco = lista.slice(0, visiveis);
    $('#lista').replaceChildren(
      ...(lista.length ? porDia(pedaco, lista, novos) : [el('p', { class: 'vazio' }, 'Nenhum instrumento corresponde ao filtro.')]),
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
      <p class="aviso solto">Este cadastro <b>confirma</b> a decisão depois que o órgão a registra; não a antecipa, e <b>não informa a data</b> da suspensão ou da rescisão. Onde outra fonte traz a data, a tela a mostra e agrupa por ela: o <b>Diário Oficial</b> (data do ato) ou o <b>Portal de Obras</b> (data em que a obra foi paralisada ou rescindida); o que o painel só viu depois, leva a data em que o detectou. O restante fica em "Sem data no cadastro". Uma suspensão pode aparecer antes na imprensa (painel Notícias, tema "Restrições e cortes") e só depois aqui.</p>
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
        <p>Datas: o SIGA não informa a data da suspensão ou da rescisão. A tela usa, nesta ordem, a data de publicação de um ato do Diário Oficial ligado ao mesmo contrato (só desde 04/10/2026), a data da situação da obra no Portal de Obras (mesmo número e ano de contrato e mesma empresa; só vale para obras) e, por último, a data em que o painel viu o instrumento nessa situação, que não é a da decisão. Os demais ficam sem data. A ligação é automática e pode falhar quando o número do contrato não aparece nas fontes.</p>
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
    try { datas = ((await ctx.api('datas')) || {}).itens || {}; } catch (e) { datas = {}; } // opcional: sem o arquivo, a lista segue sem datas
    $('#mesref').textContent = 'Levantamento: ' + dataBR(dados.ref);
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; datas = {}; visiveis = POR_VEZ; }
  PF.registrar({ id: 'suspensos', titulo: 'Contratos suspensos', montar, aoNavegar, desmontar });
})();
