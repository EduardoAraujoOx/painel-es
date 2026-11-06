(() => {
  'use strict';
  // Módulo "Decretos e normas": atos normativos e fiscais do Poder Executivo estadual publicados no Diário Oficial desde o primeiro turno (04/10/2026):
  // decretos regulamentares (série R: encerramento de exercício, tributos, estrutura de cargos), atos da transição de governo e atos de gestão fiscal
  // (pipeline/normas/coletar.py). A triagem é pelo título e a ementa ("Dispõe sobre...") vem do texto do decreto.
  const { el, nInt, norm } = PF;

  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  const filtros = { tipo: '', tema: '', busca: '', novos: false };
  const POR_VEZ = 50;
  let visiveis = POR_VEZ;
  const TIPOS = { decreto: 'Decretos regulamentares', transicao: 'Transição de governo', fiscal: 'Gestão fiscal' };
  const SELO = { decreto: 'Decreto', transicao: 'Transição', fiscal: 'Gestão fiscal' };
  const TEMAS = { encerramento: 'Encerramento do exercício', tributario: 'Tributos', cargos: 'Cargos e estrutura', orcamento: 'Orçamento e despesa', transicao: 'Transição', outro: 'Outros' };
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
  const linkSeguro = (u) => (/^https:\/\/ioes\.dio\.es\.gov\.br\//.test(u || '') ? u : '');
  const kpi = (rotulo, valor, nota, alerta) => el('div', { class: 'kpi' + (alerta ? ' alerta' : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const diaRotulo = (iso) => { const t = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); };

  function filtrar() {
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    const novos = new Set(dados.novos);
    return dados.itens.filter((i) => {
      if (filtros.tipo && i.tipo !== filtros.tipo) return false;
      if (filtros.tema && !(i.temas || []).includes(filtros.tema)) return false;
      if (filtros.novos && !novos.has(i.id)) return false;
      if (termos.length) { const t = norm([i.titulo, i.ementa, i.orgao, SELO[i.tipo], ...(i.temas || []).map((x) => TEMAS[x] || x)].join(' ')); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function linha(i, ehNovo) {
    const href = linkSeguro(i.url);
    return el('li', { class: 'noticia' },
      el('div', { class: 'noticia-titulo' }, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, i.titulo) : i.titulo),
      i.ementa ? el('div', { class: 'susp-obj' }, i.ementa) : null,
      el('div', { class: 'noticia-meta' },
        el('span', { class: 'selo ' + (i.tipo === 'fiscal' || i.tipo === 'transicao' ? 'n-a' : 'n-m') }, el('b', {}, SELO[i.tipo] || i.tipo)),
        ehNovo ? el('span', { class: 'selo n-a' }, el('b', {}, 'novo')) : null,
        ...(i.temas || []).filter((t) => t !== 'outro').map((t) => el('span', {}, TEMAS[t] || t)),
        el('span', {}, `publicado em ${dataBR(i.data)}`), el('span', {}, i.orgao)));
  }

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
    const porTema = (t) => dados.itens.filter((i) => (i.temas || []).includes(t)).length;
    $('#kpis').replaceChildren(
      kpi('Atos desde ' + dataBR(dados.desde), nInt.format(total), 'normativos e fiscais, no Diário Oficial'),
      kpi('Decretos regulamentares', nInt.format(c.decreto), 'série R do Governador'),
      kpi('Transição de governo', nInt.format(c.transicao), 'atos que tratam da transição', c.transicao > 0),
      kpi('Gestão fiscal', nInt.format(c.fiscal), 'contingenciamento, crédito, restos a pagar...', c.fiscal > 0));
    const botao = (rotulo, n, ativo, fn) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(ativo), onclick: () => { fn(); visiveis = POR_VEZ; render(); } }, rotulo, el('small', {}, nInt.format(n)));
    $('#chips').replaceChildren(
      botao('Todos', total, !filtros.tipo && !filtros.tema && !filtros.novos, () => { filtros.tipo = ''; filtros.tema = ''; filtros.novos = false; }),
      ...Object.entries(TIPOS).map(([k, r]) => botao(r, c[k], filtros.tipo === k, () => { filtros.tipo = filtros.tipo === k ? '' : k; filtros.novos = false; })),
      ...Object.entries(TEMAS).filter(([k]) => porTema(k) > 0).map(([k, r]) => botao(r, porTema(k), filtros.tema === k, () => { filtros.tema = filtros.tema === k ? '' : k; filtros.novos = false; })),
      botao('Só os novos', dados.novos.length, filtros.novos, () => { filtros.novos = !filtros.novos; }));
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
          <h2 class="modulo-titulo">Decretos e normas</h2>
          <p class="sub">Atos normativos e fiscais do Poder Executivo publicados no Diário Oficial do Estado desde o primeiro turno (04/10/2026): decretos regulamentares, atos da transição de governo e gestão fiscal (encerramento do exercício, contingenciamento, créditos, restos a pagar). Atualizado a cada coleta.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <p class="aviso solto">É onde aparecem as regras que o governo que sai fixa para o fim do mandato, como o <b>decreto de encerramento do exercício</b>, os de estrutura de cargos e os tributários. A triagem é pelo <b>título</b> e a ementa vem do texto do decreto; leis não entram (o Diário as publica em PDF, com o número como título).</p>
      <div id="kpis" class="kpis"></div>
      <div class="cartao">
        <div class="filtros"><label class="busca">Buscar por palavra do título ou da ementa<input id="busca" type="search" maxlength="80" placeholder="Ex.: encerramento, ICMS, cargos…"></label></div>
        <div id="chips" class="chips" role="group" aria-label="Filtrar por tipo e tema"></div>
        <p id="resumo" class="mesref"></p>
        <div id="lista"></div>
      </div>
      <details class="cartao noticias-metodo"><summary>Fonte e método</summary>
        <p>Sumários das edições do Diário Oficial do Espírito Santo (ioes.dio.es.gov.br, endereços públicos), lidos a cada coleta. Entram as matérias do <b>Poder Executivo estadual</b> que são (1) decreto regulamentar do Governador (série R); (2) ato que trata de transição de governo, como o decreto que criou a Equipe de Transição; ou (3) ato de gestão fiscal pelo título: encerramento de exercício, contingenciamento, limitação de empenho, crédito adicional, restos a pagar, programação financeira, cota, LDO e LOA. Os decretos de pessoa (série S: nomeação, designação, reversão), a descentralização orçamentária, os aditivos e os extratos são rotina e ficam de fora, como prefeituras e câmaras.</p>
        <p>Limites: a triagem é pelo título e pode errar nos dois sentidos (deixar passar ato cujo título não o descreve, ou incluir um que não é relevante). A lista não avalia o conteúdo nem a regularidade de nenhum ato; para isso, abra a matéria. "Novo" é o que a coleta viu pela primeira vez depois do levantamento inicial.</p>
      </details>
    </section>`;

  async function montar(contexto) {
    raiz = contexto.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await contexto.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Ainda não há levantamento de decretos e normas.'));
      return false;
    }
    $('#mesref').textContent = 'Levantamento: ' + dataBR(dados.ref);
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; visiveis = POR_VEZ; }
  PF.registrar({ id: 'normas', titulo: 'Decretos e normas', montar, aoNavegar, desmontar });
})();
