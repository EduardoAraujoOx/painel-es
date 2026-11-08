(() => {
  'use strict';
  // Módulo "Outros estados": transições de governo em curso nos 13 estados que trocaram de governador nas eleições de 2026 (fora o ES), para ver o que as
  // equipes estão fazendo (corte de gastos, diagnóstico das contas, revisão de contratos, estrutura administrativa, propostas fiscais) e o que pode ser
  // aproveitado aqui. Notícias do Google Notícias triadas pelo título (pipeline/transicoes/coletar.py); o painel guarda só título, veículo, data e link.
  const { el, nInt, norm } = PF;

  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  let sintese = null; // edição escrita (data/transicoes/sintese.json); pode não existir
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

  // ---------- relatório em PDF (impressão do navegador) ----------
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
  const lnk = (u, txt) => (linkSeguro(u) ? `<a href="${esc(u)}">${esc(txt)}</a>` : esc(txt));
  // Documento completo (HTML autônomo, pronto para imprimir em A4): síntese comparada, síntese por estado e anexo com as manchetes de medidas.
  function relatorioHTML(d, sint) {
    const estado = (uf) => d.estados.find((e) => e.uf === uf);
    const medidas = (uf) => d.itens.filter((i) => i.categoria === 'medida' && i.ufs.includes(uf));
    const blocoEstado = (e) => {
      const s = sint && sint.estados && sint.estados[e.uf];
      return `<section class="estado"><h3>${esc(e.nome)} (${esc(e.uf)}) <small>${esc(e.eleito)}, ${esc(e.partido)}</small></h3>`
        + (s ? `<p>${esc(s.texto)}</p>` + (s.fontes && s.fontes.length ? `<p class="fontes"><b>Fontes:</b> ${s.fontes.map((f) => lnk(f.url, `${f.veiculo}: ${f.titulo}`)).join(' · ')}</p>` : '') : '<p>Sem síntese escrita para este estado.</p>')
        + `</section>`;
    };
    const anexo = d.estados.map((e) => {
      const l = medidas(e.uf);
      if (!l.length) return '';
      return `<section class="anexo-estado"><h3>${esc(e.nome)} (${esc(e.uf)}) <small>${l.length} manchetes</small></h3><ul>${l.map((i) => `<li><span class="d">${dBR(i.data)}</span> ${lnk(i.url, i.titulo)} <span class="v">${esc(i.veiculo)}</span></li>`).join('')}</ul></section>`;
    }).join('');
    const ed = sint ? dBR(sint.edicao) : null;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Transições em outros estados · Painel Fiscal ES</title>
<style>
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.45 "Helvetica Neue", Arial, sans-serif; color: #1b1b1b; margin: 0; }
h1 { font-size: 19pt; line-height: 1.15; margin: 0 0 3pt; }
h2 { font-size: 13pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #0b7d8c; color: #0b6572; }
h3 { font-size: 10.8pt; margin: 11pt 0 3pt; } h3 small { font-weight: normal; color: #555; font-size: 9pt; margin-left: 4pt; }
p { margin: 0 0 6pt; text-align: justify; hyphens: auto; }
.sub { color: #555; font-size: 9.5pt; margin-bottom: 8pt; }
.nota { border: 0.75pt solid #b8c9cc; background: #eef5f6; padding: 6pt 8pt; font-size: 9pt; color: #333; text-align: left; }
.estado, .anexo-estado h3 { break-inside: avoid; }
.fontes { font-size: 8.3pt; color: #444; text-align: left; }
.fontes a { color: #0b6572; }
ul { margin: 0; padding: 0; list-style: none; } li { font-size: 8.8pt; padding: 1.5pt 0; border-bottom: 0.4pt solid #ddd; break-inside: avoid; }
li .d { color: #666; font-variant-numeric: tabular-nums; margin-right: 3pt; } li .v { color: #777; font-size: 8pt; margin-left: 3pt; }
a { color: inherit; text-decoration: none; }
.quebra { break-before: page; }
footer { margin-top: 14pt; font-size: 8pt; color: #666; }
</style></head><body>
<h1>Transições em outros estados</h1>
<p class="sub">O que as equipes dos 13 estados que trocaram de governador em 2026 estão anunciando e fazendo · ${ed ? `síntese de ${ed} · ` : ''}manchetes até ${dBR(d.ref)} · Painel Fiscal ES</p>
${sint ? `<p class="nota">${esc(sint.nota)}</p>` : `<p class="nota">Documento gerado a partir das manchetes guardadas no painel (título, veículo, data e link). A triagem é pelo título e pode errar; leia as matérias antes de citar.</p>`}
${sint ? `<h2>Leitura comparada</h2>${sint.transversal.map((t) => `<h3>${esc(t.titulo)}</h3><p>${esc(t.texto)}</p>`).join('')}<h2 class="quebra">Estado a estado</h2>${d.estados.map(blocoEstado).join('')}` : ''}
<h2 class="${sint ? 'quebra' : ''}">Anexo: manchetes de medidas e diagnósticos, por estado</h2>
<p class="sub">Notícias cujo título trata de gastos, contas, contratos, estrutura administrativa, economia ou pessoal, em ordem de data (mais recente primeiro). O tema vem de palavras do título.</p>
${anexo}
<footer>Fonte das manchetes: Google Notícias (títulos, veículos, datas e links; o painel não guarda o texto das matérias). Estados em transição conforme os resultados do TSE de 25/10/2026. Gerado em ${dBR(new Date().toISOString())}.</footer>
</body></html>`;
  }
  PF.relatorioTransicoes = relatorioHTML;
  function baixarPDF() {
    const w = window.open('', '_blank');
    if (!w) { alert('O navegador bloqueou a janela. Permita pop-ups para este endereço e tente de novo.'); return; }
    w.document.open(); w.document.write(relatorioHTML(dados, sintese)); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* o usuário imprime pelo menu */ } }, 500);
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
    const sUf = filtros.uf && sintese && sintese.estados && sintese.estados[filtros.uf];
    const eUf = filtros.uf && estado(filtros.uf);
    $('#sint-uf').replaceChildren(...(sUf ? [el('div', { class: 'aviso solto' }, el('b', {}, `${eUf.nome}: `), sUf.texto,
      sUf.fontes && sUf.fontes.length ? el('div', { class: 'noticia-meta' }, el('span', {}, 'Fontes:'), ...sUf.fontes.filter((f) => linkSeguro(f.url)).map((f) => el('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, `${f.veiculo}: ${f.titulo.length > 70 ? f.titulo.slice(0, 68) + '…' : f.titulo}`))) : null)] : []));
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
        <div class="ferramentas"><span id="mesref" class="mesref"></span><button type="button" id="pdf" class="botao" title="Abre a versão para impressão; escolha &quot;Salvar como PDF&quot;">Baixar PDF</button></div>
      </div>
      <div id="kpis" class="kpis"></div>
      <details id="sintese" class="cartao noticias-metodo" hidden><summary id="sintese-resumo">Síntese</summary><div id="sintese-corpo"></div></details>
      <div class="cartao">
        <div class="filtros"><label class="busca">Buscar por palavra do título, estado ou governador<input id="busca" type="search" maxlength="80" placeholder="Ex.: secretarias, auditoria, Zucco, déficit…"></label></div>
        <div id="chips-cat" class="chips" role="group" aria-label="Filtrar por tipo de notícia"></div>
        <div id="chips-uf" class="chips" role="group" aria-label="Filtrar por estado"></div>
        <div id="chips-tema" class="chips" role="group" aria-label="Filtrar por tema"></div>
        <div id="sint-uf"></div>
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
    try { sintese = await contexto.api('sintese'); } catch (e) { sintese = null; } // a síntese é uma edição escrita à parte: sem ela, a tela funciona do mesmo jeito
    if (sintese && sintese.transversal) {
      $('#sintese').hidden = false;
      $('#sintese-resumo').textContent = `Síntese das medidas (edição de ${dataBR(sintese.edicao)}): leitura comparada dos 13 estados`;
      $('#sintese-corpo').replaceChildren(el('p', { class: 'mesref' }, sintese.nota), ...sintese.transversal.flatMap((t) => [el('h3', {}, t.titulo), el('p', {}, t.texto)]));
    }
    $('#pdf').addEventListener('click', baixarPDF);
    $('#quem').replaceChildren(el('ul', { class: 'noticias' }, ...dados.estados.map((e) => el('li', { class: 'noticia' }, el('div', { class: 'noticia-titulo' }, `${e.nome} (${e.uf})`), el('div', { class: 'noticia-meta' }, el('span', {}, `Governador eleito: ${e.eleito}`), el('span', {}, e.partido))))));
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; sintese = null; visiveis = POR_VEZ; filtros.categoria = 'medida'; filtros.uf = ''; filtros.tema = ''; filtros.busca = ''; }
  PF.registrar({ id: 'transicoes', titulo: 'Transições em outros estados', montar, aoNavegar, desmontar });
})();
