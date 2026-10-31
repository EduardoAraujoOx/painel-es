(() => {
  'use strict';
  // Módulo "Obras paralisadas": obras com situação Paralisada ou Contrato rescindido no Portal da Transparência do Poder Executivo, com a DATA da
  // situação registrada pelo órgão (pipeline/obras/coletar.py). É a fonte que a imprensa usa ("32 obras paralisadas"); o cadastro de contratos (SIGA) não
  // informa a data da suspensão. A lista é agrupada por ano da situação, da mais recente para a mais antiga.
  const { el, nInt, norm, brlCompacto } = PF;

  let ctx = null;
  let raiz = null;
  const $ = (s) => raiz.querySelector(s);
  let dados = null;
  const filtros = { tipo: 'paralisada', busca: '', novos: false };
  const POR_VEZ = 40;
  let visiveis = POR_VEZ;
  const TIPOS = { paralisada: 'Paralisadas', rescindida: 'Contrato rescindido' };
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
  const linkSeguro = (u) => (/^https:\/\/transparencia\.es\.gov\.br\//.test(u || '') ? u : '');
  const kpi = (rotulo, valor, nota, alerta) => el('div', { class: 'kpi' + (alerta ? ' alerta' : '') }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor), nota ? el('div', { class: 'nota' }, nota) : null);
  const anosDesde = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso.slice(0, 10) + 'T12:00:00').getTime()) / (365.25 * 86400000)));
  const haTempo = (iso) => { const a = anosDesde(iso); return a >= 1 ? `há ${a} ${a === 1 ? 'ano' : 'anos'}` : 'há menos de 1 ano'; };

  function filtrar() {
    const termos = norm(filtros.busca).split(/\s+/).filter(Boolean);
    const novos = new Set(dados.novos);
    return dados.itens.filter((i) => {
      if (filtros.novos) return novos.has(i.id) && (!termos.length || termos.every((x) => norm([i.objeto, i.orgao, i.municipio, i.empresa, i.contrato].join(' ')).includes(x)));
      if (filtros.tipo && i.tipo !== filtros.tipo) return false;
      if (termos.length) { const t = norm([i.objeto, i.descricao, i.orgao, i.municipio, i.empresa, i.contrato].join(' ')); if (!termos.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function linha(i, ehNovo) {
    const href = linkSeguro(i.url);
    const objeto = i.objeto.length > 230 ? i.objeto.slice(0, 230) + '…' : i.objeto;
    return el('li', { class: 'noticia' },
      el('div', { class: 'noticia-titulo' }, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, objeto) : objeto),
      el('div', { class: 'noticia-meta' },
        el('span', { class: 'selo ' + (i.tipo === 'paralisada' ? 'n-a' : 'n-m') }, el('b', {}, i.tipo === 'paralisada' ? 'Paralisada' : 'Contrato rescindido')),
        ehNovo ? el('span', { class: 'selo n-a' }, el('b', {}, 'nova')) : null,
        el('span', {}, `em ${dataBR(i.data_situacao)} (${haTempo(i.data_situacao)})`), el('span', {}, i.municipio), el('span', {}, i.orgao.split(' - ')[0]),
        el('span', {}, i.valor ? brlCompacto(i.valor) : 'valor não informado'), i.execucao != null ? el('span', {}, `${String(i.execucao).replace('.', ',')}% executado`) : null,
        el('span', { title: i.empresa }, i.empresa ? `empresa: ${i.empresa.length > 38 ? i.empresa.slice(0, 38) + '…' : i.empresa}` : '')));
  }

  // Grupos por ano da situação, do mais recente para o mais antigo (a lista já vem ordenada por data).
  function porAno(itens, novos) {
    const blocos = [];
    let ano = null, ul = null, grupo = null;
    const fecha = () => { if (grupo) grupo.titulo.textContent = `${grupo.ano} · ${nInt.format(grupo.n)} ${grupo.n === 1 ? 'obra' : 'obras'} · ${brlCompacto(grupo.valor)}`; };
    for (const i of itens) {
      const a = i.data_situacao.slice(0, 4);
      if (a !== ano) {
        fecha();
        ano = a; ul = el('ul', { class: 'noticias' });
        const h = el('h3', {}, '');
        grupo = { ano: a, n: 0, valor: 0, titulo: h };
        blocos.push(el('section', { class: 'noticias-dia' }, h, ul));
      }
      grupo.n += 1; grupo.valor += i.valor || 0;
      ul.append(linha(i, novos.has(i.id)));
    }
    fecha();
    return blocos;
  }

  function render() {
    if (!raiz || !dados) return;
    const c = dados.contagem, v = dados.valor, d = dados.desde_corte;
    const novos = new Set(dados.novos);
    const par = dados.itens.filter((i) => i.tipo === 'paralisada');
    const maisAntiga = par.length ? par[par.length - 1] : null;
    $('#kpis').replaceChildren(
      kpi('Obras paralisadas', nInt.format(c.paralisada), `${brlCompacto(v.paralisada)} contratados`, c.paralisada > 0),
      kpi('Paralisadas desde ' + dataBR(dados.desde), nInt.format(d.paralisada), d.paralisada ? 'registradas no portal depois do primeiro turno' : 'nenhuma registrada no portal desde então', d.paralisada > 0),
      kpi('Contrato rescindido', nInt.format(c.rescindida), `${d.rescindida ? nInt.format(d.rescindida) + ' desde ' + dataBR(dados.desde) : 'nenhuma desde ' + dataBR(dados.desde)}`),
      kpi('Paralisada há mais tempo', maisAntiga ? String(anosDesde(maisAntiga.data_situacao)) + ' anos' : '—', maisAntiga ? `desde ${dataBR(maisAntiga.data_situacao)}` : ''));
    $('#chips').replaceChildren(...Object.entries(TIPOS).map(([k, r]) =>
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.tipo === k && !filtros.novos), onclick: () => { filtros.tipo = k; filtros.novos = false; visiveis = POR_VEZ; render(); } }, r, el('small', {}, nInt.format(c[k])))),
    el('button', { type: 'button', class: 'chip', 'aria-pressed': String(filtros.novos), onclick: () => { filtros.novos = !filtros.novos; visiveis = POR_VEZ; render(); } }, 'Só as novas', el('small', {}, nInt.format(dados.novos.length))));
    const lista = filtrar();
    $('#resumo').textContent = `${nInt.format(lista.length)} ${lista.length === 1 ? 'obra' : 'obras'}, agrupadas pelo ano da situação, da mais recente para a mais antiga`;
    const pedaco = lista.slice(0, visiveis);
    $('#lista').replaceChildren(
      ...(lista.length ? porAno(pedaco, novos) : [el('p', { class: 'vazio' }, 'Nenhuma obra corresponde ao filtro.')]),
      lista.length > visiveis ? el('div', { class: 'ferramentas' }, el('button', { type: 'button', class: 'botao', onclick: () => { visiveis += POR_VEZ; render(); } }, `Mostrar mais (${nInt.format(lista.length - visiveis)} restantes)`)) : null);
  }

  const ESQUELETO = `
    <section>
      <div class="modulo-topo">
        <div>
          <h2 class="modulo-titulo">Obras paralisadas</h2>
          <p class="sub">Obras do Estado com situação "Paralisada" ou "Contrato rescindido" no Portal da Transparência, com a data da situação registrada pelo órgão. É a fonte das reportagens sobre obras paradas; o cadastro de contratos (SIGA) não informa essa data.</p>
        </div>
        <span id="mesref" class="mesref"></span>
      </div>
      <p class="aviso solto">Este é o <b>estoque</b> registrado no portal, não só o que é novo: a maior parte das obras paralisadas vem de anos anteriores. O portal depende do registro do órgão e pode atrasar em relação ao Diário Oficial; veja também a tela "Contratos recentes", que traz as ordens de paralisação e rescisões publicadas desde 04/10/2026.</p>
      <div id="kpis" class="kpis"></div>
      <div class="cartao">
        <div class="filtros"><label class="busca">Buscar por obra, município, órgão ou empresa<input id="busca" type="search" maxlength="80" placeholder="Ex.: escola, Guaçuí, DER, Cais das Artes…"></label></div>
        <div id="chips" class="chips" role="group" aria-label="Filtrar por situação"></div>
        <p id="resumo" class="mesref"></p>
        <div id="lista"></div>
      </div>
      <details class="cartao noticias-metodo"><summary>Fonte e método</summary>
        <p>Portal da Transparência do Poder Executivo (transparencia.es.gov.br/Obras), filtros de situação "Paralisada" e "Contrato rescindido". Para cada obra, lê-se a página de detalhe (data da situação, contrato, empresa, percentual de execução e valor contratado total). Atualizado nos horários do resumo por e-mail. "Nova" é a obra que entrou nessa situação depois do levantamento inicial.</p>
        <p>Limites: a data é a que o órgão registrou, não a da decisão; o percentual de execução é o informado no portal e pode passar de 100%; o valor é o contratado (com aditivos), não o que falta executar. O arquivo de dados abertos de obras (dados.es.gov.br) está desatualizado desde 05/2026, por isso a leitura é direto no portal.</p>
      </details>
    </section>`;

  async function montar(contexto) {
    ctx = contexto;
    raiz = ctx.container;
    raiz.innerHTML = ESQUELETO;
    try { dados = await ctx.api('index'); } catch (e) {
      if (e.sessao) { PF.mostrarLogin(); return false; }
      $('#lista').replaceChildren(el('p', { class: 'vazio' }, 'Ainda não há levantamento de obras.'));
      return false;
    }
    $('#mesref').textContent = 'Levantamento: ' + dataBR(dados.ref);
    let t = null;
    $('#busca').addEventListener('input', (ev) => { filtros.busca = ev.target.value; visiveis = POR_VEZ; clearTimeout(t); t = setTimeout(render, 150); });
    return true;
  }
  function aoNavegar() { if (dados) render(); }
  function desmontar() { dados = null; visiveis = POR_VEZ; }
  PF.registrar({ id: 'obras', titulo: 'Obras paralisadas', montar, aoNavegar, desmontar });
})();
