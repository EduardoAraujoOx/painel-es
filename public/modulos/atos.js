(() => {
  'use strict';
  // Módulo "Contratos recentes": atos de contrato publicados no Diário Oficial do ES desde o primeiro turno (04/10/2026) — paralisações, suspensões,
  // rescisões, cancelamentos e anulações/revogações — com data de publicação, órgão e link da matéria (pipeline/diario/coletar.py). O cadastro de
  // contratos (SIGA) não informa a data da suspensão; o Diário informa a data de publicação do ato.
  const { el, nInt, norm } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  const filtros = { tipo: '', busca: '', novos: false };
  const POR_VEZ = 50;
  let visiveis = POR_VEZ;
  const TIPOS = { paralisacao: 'Paralisações', suspensao: 'Suspensões', rescisao: 'Rescisões', cancelamento: 'Cancelamentos', anulacao: 'Anulações ou revogações' };
  const SELO = { paralisacao: 'Paralisação', suspensao: 'Suspensão', rescisao: 'Rescisão', cancelamento: 'Cancelamento', anulacao: 'Anulação ou revogação' };
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
  const linkSeguro = (u) => (/^https:\/\/ioes\.dio\.es\.gov\.br\//.test(u || '') ? u : '');
  const kpi = (rotulo, valor, nota, alerta) => el('div', { class: 'kpi' + (alerta ? ' alerta' : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);

  function filtrar() {
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    const novos = new Set(dados.novos);
    return dados.itens.filter((i) => {
      if (filtros.tipo && i.tipo !== filtros.tipo) return false;
      if (filtros.novos && !novos.has(i.id)) return false;
      if (termos.length) { const t = norm([i.titulo, i.orgao, i.setor, SELO[i.tipo]].join(' ')); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function linha(i, ehNovo) {
    const href = linkSeguro(i.url);
    return el('li', { class: 'noticia' },
      el('div', { class: 'noticia-titulo' }, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, i.titulo) : i.titulo),
      el('div', { class: 'noticia-meta' },
        el('span', { class: 'selo ' + (i.tipo === 'paralisacao' || i.tipo === 'suspensao' ? 'n-a' : 'n-m') }, el('b', {}, SELO[i.tipo] || i.tipo)),
        ehNovo ? el('span', { class: 'selo n-a' }, el('b', {}, 'novo')) : null,
        el('span', {}, `publicado em ${dataBR(i.data)}`), el('span', {}, i.orgao), i.setor && i.setor !== i.orgao ? el('span', {}, i.setor) : null,
        el('span', {}, i.alvo ? `alvo: ${i.alvo}` : '')));
  }

  // Lista agrupada pela data de publicação no Diário, da mais recente para a mais antiga (a lista já vem ordenada).
  const diaRotulo = (iso) => { const t = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); };
  function porDia(itens, todos, novos) {
    const conta = {};
    for (const i of todos) conta[i.data] = (conta[i.data] || 0) + 1;
    const blocos = [];
    let dia = null, ul = null;
    for (const i of itens) {
      if (i.data !== dia) {
        dia = i.data;
        ul = el('ul', { class: 'noticias' });
        blocos.push(el('section', { class: 'noticias-dia' }, el('h3', {}, `${diaRotulo(i.data)} · ${nInt.format(conta[i.data])} ${conta[i.data] === 1 ? 'ato' : 'atos'}`), ul));
      }
      ul.append(linha(i, novos.has(i.id)));
    }
    return blocos;
  }

  function render() {
    if (!raiz || !dados) return;
    const c = dados.contagem;
    const novos = new Set(dados.novos);
    const total = dados.itens.length;
    $('#kpis').replaceChildren(
      kpi('Atos desde ' + dataBR(dados.desde), nInt.format(total), 'publicados no Diário Oficial do Estado'),
      kpi('Paralisações e suspensões', nInt.format(c.paralisacao + c.suspensao), 'o que mais interessa à transição', c.paralisacao + c.suspensao > 0),
      kpi('Rescisões', nInt.format(c.rescisao), 'contratos e termos encerrados'),
      kpi('Cancelamentos, anulações e revogações', nInt.format(c.cancelamento + c.anulacao), 'atas, contratos e licitações'));
    $('#chips').replaceChildren(...[['', 'Todos', total], ...Object.entries(TIPOS).map(([k, r]) => [k, r, c[k]])].map(([v, r, n]) =>
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.tipo === v && !filtros.novos), onclick: () => { filtros.tipo = v; filtros.novos = false; visiveis = POR_VEZ; render(); } }, r, el('small', {}, nInt.format(n)))),
    el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.novos), onclick: () => { filtros.novos = !filtros.novos; filtros.tipo = ''; visiveis = POR_VEZ; render(); } }, 'Só os novos', el('small', {}, nInt.format(dados.novos.length))));
    const lista = filtrar();
    $('#resumo').textContent = `${nInt.format(lista.length)} ${lista.length === 1 ? 'ato' : 'atos'}, agrupados pela data de publicação, do mais recente para o mais antigo`;
    const pedaco = lista.slice(0, visiveis);
    $('#lista').replaceChildren(
      ...(lista.length ? porDia(pedaco, lista, novos) : [el('p', { class: 'vazio' }, 'Nenhum ato corresponde ao filtro.')]),
      lista.length > visiveis ? el('div', { class: 'ferramentas' }, el('button', { type: 'button', class: 'botao', onclick: () => { visiveis += POR_VEZ; render(); } }, `Mostrar mais (${nInt.format(lista.length - visiveis)} restantes)`)) : null);
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Contratos recentes</h2>
          <p class="sub">Atos de contrato publicados no Diário Oficial do Estado desde o primeiro turno (04/10/2026): paralisações, suspensões, rescisões, cancelamentos e anulações, com a data de publicação e o link da matéria. Atualizado a cada coleta.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <p class="aviso solto">O Diário traz a <b>data do ato</b>, que o cadastro de contratos (SIGA) não informa, e às vezes publica antes de o SIGA registrar. Mas <b>não publica tudo</b>: a suspensão de um contrato costuma ser ato interno e não sai no Diário. A tela "Suspensos e rescindidos" mostra o que o SIGA registra; as duas se complementam.</p>
      <div id="kpis" class="kpis"></div>
      <div class="cartao">
        <div class="filtros"><label class="busca">Buscar por órgão, contrato ou palavra do título<input id="busca" type="search" maxlength="80" placeholder="Ex.: Educação, paralisação, CT093…"></label></div>
        <div id="chips" class="chips" role="group" aria-label="Filtrar por tipo de ato"></div>
        <p id="resumo" class="mesref"></p>
        <div id="lista"></div>
      </div>
      <details class="cartao noticias-metodo"><summary>Fonte e método</summary>
        <p>Sumários das edições do Diário Oficial do Espírito Santo (ioes.dio.es.gov.br, endereços públicos), lidos a cada coleta. Entram as matérias do Poder Executivo cujo <b>título</b> trata de paralisação, suspensão, rescisão ou distrato, cancelamento de ata ou contrato, e anulação ou revogação de licitação ou contrato. Ficam de fora prefeituras, câmaras e publicações de terceiros, e os atos de pessoal (férias, portarias individuais, estágio, cessão de servidor).</p>
        <p>Limites: a triagem é pelo título, não pelo texto da matéria, e pode errar para os dois lados (incluir ato que não é de contrato ou deixar passar um cujo título não o descreve); "suspensão de penalidade" é tratada como alívio dado à empresa e não entra. "Novo" é o que a coleta viu pela primeira vez depois do levantamento inicial. A lista não avalia a regularidade de nenhum ato.</p>
      </details>
    </section>`;

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Ainda não há levantamento do Diário Oficial.'));
      return false;
    }
    $('#mesref').textContent = 'Levantamento: ' + dataBR(dados.ref);
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; visiveis = POR_VEZ; }
  PF.registrar({ id: 'atos', titulo: 'Contratos recentes', montar, aoNavegar, desmontar });
})();
