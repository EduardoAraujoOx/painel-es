(() => {
  'use strict';
  // Módulo "Outros estados": transições de governo em curso nos 13 estados que trocaram de governador nas eleições de 2026 (fora o ES), para ver o que as
  // equipes estão fazendo (corte de gastos, diagnóstico das contas, revisão de contratos, estrutura administrativa, propostas fiscais) e o que pode ser
  // aproveitado aqui. Notícias do Google Notícias triadas pelo título (pipeline/transicoes/coletar.py); o painel guarda só título, veículo, data e link.
  const { el, nInt, norm } = PF;

  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  const filtros = { categoria: 'medida', uf: '', tema: '', busca: '' };
  const POR_VEZ = 50;
  let visiveis = POR_VEZ;
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
  const linkSeguro = (u) => (/^https?:\/\//.test(u || '') ? u : '');
  const kpi = (rotulo, valor, nota) => el('div', { class: 'kpi' }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const diaRotulo = (iso) => { const t = new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); };
  const estado = (uf) => dados.estados.find((e) => e.uf === uf);

  function filtrar(ignorar) {
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    return dados.itens.filter((i) => {
      if (ignorar !== 'categoria' && filtros.categoria && i.categoria !== filtros.categoria) return false;
      if (ignorar !== 'uf' && filtros.uf && !i.ufs.includes(filtros.uf)) return false;
      if (ignorar !== 'tema' && filtros.tema && !(i.temas || []).includes(filtros.tema)) return false;
      if (termos.length) {
        const t = norm([i.titulo, i.veiculo, ...i.ufs.map((u) => { const e = estado(u); return e ? `${e.nome} ${e.eleito}` : u; }), ...(i.temas || []).map((x) => dados.temas[x] || x)].join(' '));
        if (!termos.every((x) => t.includes(x))) return false;
      }
      return true;
    });
  }

  function linha(i, limiteNovo) {
    const href = linkSeguro(i.url);
    return el('li', { class: 'noticia' },
      el('div', { class: 'noticia-titulo' }, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, i.titulo) : i.titulo),
      el('div', { class: 'noticia-meta' },
        ...i.ufs.map((u) => el('span', { class: 'selo n-a', title: estado(u) ? `${estado(u).nome}: ${estado(u).eleito} (${estado(u).partido})` : u }, el('b', {}, u))),
        i.coletado_em >= limiteNovo ? el('span', { class: 'selo n-a' }, el('b', {}, 'novo')) : null,
        ...(i.temas || []).filter((t) => dados.temas[t]).map((t) => el('span', {}, dados.temas[t])),
        el('span', {}, i.veiculo || '—')));
  }

  function porDia(itens, todos, limiteNovo) {
    const conta = {};
    for (const i of todos) { const d = i.data.slice(0, 10); conta[d] = (conta[d] || 0) + 1; }
    const blocos = [];
    let dia = null, ul = null;
    for (const i of itens) {
      const d = i.data.slice(0, 10);
      if (d !== dia) {
        dia = d;
        ul = el('ul', { class: 'noticias' });
        blocos.push(el('section', { class: 'noticias-dia' }, el('h3', {}, `${diaRotulo(d)} · ${nInt.format(conta[d])} ${conta[d] === 1 ? 'notícia' : 'notícias'}`), ul));
      }
      ul.append(linha(i, limiteNovo));
    }
    return blocos;
  }

  function render() {
    if (!raiz || !dados) return;
    const c = dados.contagem;
    const limiteNovo = new Date(new Date(dados.gerado_em).getTime() - 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    const comMedida = new Set(dados.itens.filter((i) => i.categoria === 'medida').flatMap((i) => i.ufs));
    $('#kpis').replaceChildren(
      kpi('Estados em transição', nInt.format(dados.estados.length), 'governador eleito é um novo nome (fora o ES)'),
      kpi('Medidas e diagnósticos', nInt.format(c.medidas), `notícias de ${nInt.format(comMedida.size)} estados`),
      kpi('Equipe e protocolo', nInt.format(c.equipe), 'nomes, reuniões, entrega de documentos'),
      kpi('Desde', dataBR(dados.desde), 'primeiro turno das eleições'));
    const botao = (rotulo, n, ativo, fn, titulo) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(ativo), title: titulo || null, onclick: () => { fn(); visiveis = POR_VEZ; render(); } }, rotulo, n == null ? null : el('small', {}, nInt.format(n)));
    const nCat = (k) => dados.itens.filter((i) => (!k || i.categoria === k)).length;
    $('#chips-cat').replaceChildren(
      botao('Medidas e diagnósticos', nCat('medida'), filtros.categoria === 'medida', () => { filtros.categoria = 'medida'; }),
      botao('Equipe e protocolo', nCat('equipe'), filtros.categoria === 'equipe', () => { filtros.categoria = 'equipe'; }),
      botao('Tudo', nCat(''), filtros.categoria === '', () => { filtros.categoria = ''; }));
    const baseUf = filtrar('uf');
    $('#chips-uf').replaceChildren(
      botao('Todos os estados', baseUf.length, !filtros.uf, () => { filtros.uf = ''; }),
      ...dados.estados.map((e) => botao(e.uf, baseUf.filter((i) => i.ufs.includes(e.uf)).length, filtros.uf === e.uf, () => { filtros.uf = filtros.uf === e.uf ? '' : e.uf; }, `${e.nome}: ${e.eleito} (${e.partido})`)));
    const baseTema = filtrar('tema');
    $('#chips-tema').replaceChildren(
      botao('Todos os temas', baseTema.length, !filtros.tema, () => { filtros.tema = ''; }),
      ...Object.entries(dados.temas).map(([k, r]) => botao(r, baseTema.filter((i) => (i.temas || []).includes(k)).length, filtros.tema === k, () => { filtros.tema = filtros.tema === k ? '' : k; })));
    const lista = filtrar();
    $('#resumo').textContent = `${nInt.format(lista.length)} ${lista.length === 1 ? 'notícia' : 'notícias'}, agrupadas pela data, da mais recente para a mais antiga`;
    const pedaco = lista.slice(0, visiveis);
    $('#lista').replaceChildren(
      ...(lista.length ? porDia(pedaco, lista, limiteNovo) : [el('p', { class: 'vazio' }, 'Nenhuma notícia corresponde ao filtro.')]),
      lista.length > visiveis ? el('div', { class: 'ferramentas' }, el('button', { type: 'button', class: 'botao', onclick: () => { visiveis += POR_VEZ; render(); } }, `Mostrar mais (${nInt.format(lista.length - visiveis)} restantes)`)) : null);
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Transições em outros estados</h2>
          <p class="sub">O que as equipes de transição dos estados que trocaram de governador em 2026 estão anunciando e fazendo: corte de gastos, diagnóstico das contas, revisão de contratos, estrutura administrativa, propostas fiscais e pessoal. Serve de repertório para o que pode ser aproveitado no Espírito Santo.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <div id="kpis" class="kpis"></div>
      <div class="cartao">
        <div class="filtros"><label class="busca">Buscar por palavra do título, estado ou governador<input id="busca" type="search" maxlength="80" placeholder="Ex.: secretarias, auditoria, Zucco, déficit…"></label></div>
        <div id="chips-cat" class="chips" role="group" aria-label="Filtrar por tipo de notícia"></div>
        <div id="chips-uf" class="chips" role="group" aria-label="Filtrar por estado"></div>
        <div id="chips-tema" class="chips" role="group" aria-label="Filtrar por tema"></div>
        <p id="resumo" class="mesref"></p>
        <div id="lista"></div>
      </div>
      <details class="cartao noticias-metodo"><summary>Quem assume em cada estado</summary>
        <div id="quem"></div>
      </details>
      <details class="cartao noticias-metodo"><summary>Fonte e método</summary>
        <p>Google Notícias, com buscas por estado (o governador eleito e o nome do estado, junto com termos de transição, medidas e contas) e algumas buscas gerais, a cada coleta. Entra a notícia cujo <b>título</b> cita um dos 13 estados em transição (pelo nome do estado, do governador eleito ou do que sai) e trata de transição de governo; a que cita só o governador eleito entra se trouxer também alguma medida. Ficam de fora o ES, os estados em que o governador foi reeleito ou segue o mesmo grupo no cargo e as notícias de outros assuntos que usam a palavra "transição".</p>
        <p><b>Medidas e diagnósticos</b> são as notícias que tratam de gastos, contas, contratos, estrutura administrativa, economia ou pessoal; <b>Equipe e protocolo</b>, as de nomes, reuniões e entrega de documentos. Os temas são atribuídos por palavras do título, e uma notícia pode ter mais de um.</p>
        <p>Limites: o painel guarda só o título, o veículo, a data e o link, e não lê a matéria. A triagem pelo título erra nos dois sentidos (deixa passar o que o título não descreve e inclui o que só cita a palavra), e o tema não diz se a medida é boa, viável ou aplicável ao ES: é um indicador de onde olhar. Os estados em transição vêm dos resultados do TSE de 25/10/2026, conforme Jovem Pan e O Povo.</p>
      </details>
    </section>`;

  async function montar(contexto) {
    raiz = contexto.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await contexto.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Ainda não há levantamento das transições em outros estados.'));
      return false;
    }
    $('#mesref').textContent = 'Levantamento: ' + dataBR(dados.ref);
    $('#quem').replaceChildren(el('ul', { class: 'noticias' }, ...dados.estados.map((e) => el('li', { class: 'noticia' }, el('div', { class: 'noticia-titulo' }, `${e.nome} (${e.uf})`), el('div', { class: 'noticia-meta' }, el('span', {}, `Governador eleito: ${e.eleito}`), el('span', {}, e.partido))))));
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; visiveis = POR_VEZ; filtros.categoria = 'medida'; filtros.uf = ''; filtros.tema = ''; filtros.busca = ''; }
  PF.registrar({ id: 'transicoes', titulo: 'Transições em outros estados', montar, aoNavegar, desmontar });
})();
