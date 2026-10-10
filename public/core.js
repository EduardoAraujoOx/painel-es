(() => {
  'use strict';
  // Núcleo do Painel Fiscal: utilidades, tema, dicas, acesso e roteador de módulos.
  // Cada módulo é um arquivo em modulos/ que se registra com PF.registrar({...}) e mantém
  // seus dados em data/<id>/ (servidos por /api/dados só a quem estiver autenticado).
  const PF = window.PF = { modulos: [], atual: null };
  const $ = (s) => document.querySelector(s);
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // ---------- utilidades ----------
  function el(tag, attrs, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat(Infinity)) {
      if (f == null || f === false) continue;
      e.append(f.nodeType ? f : document.createTextNode(String(f)));
    }
    return e;
  }
  function svg(tag, attrs, ...filhos) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
    for (const f of filhos.flat()) if (f) e.append(f);
    return e;
  }
  const nInt = new Intl.NumberFormat('pt-BR');
  const nBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function brlCompacto(v) {
    const a = Math.abs(v);
    const f = (x, d) => x.toLocaleString('pt-BR', { maximumFractionDigits: d });
    if (a >= 1e9) return 'R$ ' + f(v / 1e9, 2) + ' bi';
    if (a >= 1e6) return 'R$ ' + f(v / 1e6, 1) + ' mi';
    if (a >= 1e3) return 'R$ ' + f(v / 1e3, 0) + ' mil';
    return nBRL.format(v);
  }
  function rotuloMes(m, longo) {
    const [a, mm] = m.split('-');
    return `${MESES[+mm - 1]}/${longo ? a : a.slice(2)}`;
  }
  function mesesEntre(a, b) {
    return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5));
  }
  const PEQUENAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'a', 'o', 'no', 'na']);
  function titulo(s) {
    return String(s || '').toLowerCase().split(/(\s+)/).map((p, i) => {
      if (/^\s*$/.test(p)) return p;
      if (i > 0 && PEQUENAS.has(p)) return p;
      if (/\d/.test(p) || /^[ivx]+$/.test(p) || p.length <= 2) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join('');
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const soma = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  function mediana(v) {
    if (!v.length) return null;
    const o = [...v].sort((a, b) => a - b);
    const m = o.length >> 1;
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } }
  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  Object.assign(PF, { el, svg, nInt, nBRL, brlCompacto, rotuloMes, mesesEntre, titulo, norm, soma, mediana, guardar, ler });

  // ---------- tema ----------
  function aplicarTema(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  aplicarTema(ler('tema'));
  $('#tema').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-theme')
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const novo = atual === 'dark' ? 'light' : 'dark';
    aplicarTema(novo);
    guardar('tema', novo);
  });

  // ---------- tooltip ----------
  const dica = $('#dica');
  function mostrarDica(nos, x, y) {
    dica.replaceChildren(...nos);
    dica.hidden = false;
    const w = dica.offsetWidth, h = dica.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top + h > innerHeight - 8) top = y - h - 14;
    dica.style.left = Math.max(8, left) + 'px';
    dica.style.top = Math.max(8, top) + 'px';
  }
  const esconderDica = () => { dica.hidden = true; };
  const dicaLinha = (cor, valor, nome) => el('div', { class: 'lin' },
    cor ? el('i', { class: 'chave-linha', style: `background:${cor}` }) : null,
    el('strong', {}, valor), nome ? el('span', {}, nome) : null);
  function dicaNoElemento(e, nos) {
    const r = e.getBoundingClientRect();
    mostrarDica(nos(), r.left + r.width / 2, r.top + r.height / 2);
  }
  Object.assign(PF, { mostrarDica, esconderDica, dicaLinha, dicaNoElemento });

  // ---------- observação de tamanho (gráficos responsivos) ----------
  let observadores = [];
  PF.observar = (alvo, desenhar) => {
    let ultima = -1;
    const ro = new ResizeObserver(() => {
      const w = Math.round(alvo.clientWidth);
      if (w !== ultima && w > 0) { ultima = w; desenhar(w); }
    });
    ro.observe(alvo);
    observadores.push(ro);
  };
  PF.limparObservadores = () => {
    observadores.forEach((o) => o.disconnect());
    observadores = [];
  };

  // ---------- acesso ----------
  PF.api = async (modulo, arq) => {
    const r = await fetch(`/api/dados?mod=${encodeURIComponent(modulo)}&arq=${encodeURIComponent(arq)}`,
      { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) throw { sessao: true };
    if (!r.ok) throw new Error('Falha ao carregar dados (' + r.status + ')');
    return r.json();
  };
  PF.mostrarLogin = () => {
    PF.limparObservadores();
    esconderDica();
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#senha').focus();
  };
  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = $('#login-erro');
    erro.hidden = true;
    const r = await fetch('/api/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: $('#senha').value }),
    });
    if (r.ok) {
      $('#senha').value = '';
      iniciar();
    } else {
      erro.textContent = r.status === 401 ? 'Senha incorreta.' : 'Acesso indisponível no momento.';
      erro.hidden = false;
    }
  });
  $('#sair').addEventListener('click', async () => {
    await fetch('/api/sair', { method: 'POST', credentials: 'same-origin' });
    if (PF.atual && PF.atual.desmontar) PF.atual.desmontar();
    PF.atual = null;
    $('#modulo').replaceChildren();
    PF.mostrarLogin();
  });

  // ---------- módulos e rotas (#/<módulo>/<resto>) ----------
  PF.registrar = (m) => PF.modulos.push(m);

  function rotaAtual() {
    const h = decodeURIComponent(location.hash.slice(1)).replace(/^\//, '');
    const [primeiro, ...resto] = h.split('/');
    const mod = PF.modulos.find((m) => m.id === primeiro);
    return mod ? { mod, resto: resto.join('/') } : { mod: PF.modulos[0], resto: h }; // #SEFAZ antigo vale para o 1º módulo
  }
  function irPara(mod, resto) {
    const alvo = `#/${mod.id}${resto ? '/' + encodeURIComponent(resto) : ''}`;
    const vazio = !resto && (location.hash === '' || location.hash === '#' || location.hash === `#/${mod.id}`);
    if (location.hash === alvo || vazio) mod.aoNavegar(resto); else location.hash = alvo;
  }
  // Menu lateral: seções agrupadas por tema. Cada item aponta para um módulo e, se houver, para uma tela dele
  // (`sub`); `casa(resto)` diz quando o item está ativo. Para acrescentar um tópico, inclua um item aqui.
  const NAV = [
    { grupo: 'Pessoal', itens: [
      { mod: 'cargos', rotulo: 'Cargos em comissão' },
      { mod: 'organograma', rotulo: 'Organograma' }] },
    { grupo: 'Contratos', itens: [
      { mod: 'contratacoes', rotulo: 'Visão do governo', casa: (r) => !/^(diagnostico|revisao|relatorio)/.test(r) },
      { mod: 'contratacoes', sub: 'diagnostico', rotulo: 'Diagnóstico (classe A)', casa: (r) => /^diagnostico/.test(r) },
      { mod: 'contratacoes', sub: 'revisao', rotulo: 'Lista de revisão', selo: 'revisao', casa: (r) => /^(revisao|relatorio)/.test(r) }] },
    { grupo: 'Transição', itens: [
      { mod: 'lacunas', rotulo: 'Informações a solicitar' }] },
  ];
  PF.NAV = NAV;
  PF.selo = (chave, texto) => document.querySelectorAll(`[data-selo="${chave}"]`).forEach((e) => { e.textContent = texto ? String(texto) : ''; });
  function montarMenu() {
    const usados = new Set(NAV.flatMap((g) => g.itens.map((i) => i.mod)));
    const grupos = [...NAV, ...(PF.modulos.some((m) => !usados.has(m.id)) ? [{ grupo: 'Outros', itens: PF.modulos.filter((m) => !usados.has(m.id)).map((m) => ({ mod: m.id, rotulo: m.titulo })) }] : [])];
    $('#abas').replaceChildren(...grupos.map((g) => el('div', { class: 'menu-grupo' }, el('p', { class: 'menu-rotulo' }, g.grupo),
      g.itens.filter((i) => PF.modulos.some((m) => m.id === i.mod)).map((i) => el('a', { href: `#/${i.mod}${i.sub ? '/' + i.sub : ''}`, 'data-mod': i.mod, 'data-sub': i.sub || '' },
        el('span', {}, i.rotulo), i.selo ? el('span', { class: 'selo-menu', 'data-selo': i.selo }) : null)))));
  }
  function marcarAbas(resto) {
    const r = decodeURIComponent(resto || '');
    const itens = NAV.flatMap((g) => g.itens);
    for (const a of $('#abas').querySelectorAll('a')) {
      const i = itens.find((x) => x.mod === a.dataset.mod && (x.sub || '') === a.dataset.sub);
      const ativo = a.dataset.mod === (PF.atual && PF.atual.id) && (i && i.casa ? i.casa(r) : true);
      if (ativo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }
  async function rotear() {
    if ($('#app').hidden || !PF.modulos.length) return;
    const { mod, resto } = rotaAtual();
    if (PF.atual !== mod) {
      PF.limparObservadores();
      esconderDica();
      PF.atual = mod;
      const cont = $('#modulo');
      cont.replaceChildren(el('p', { class: 'vazio', role: 'status' }, 'Carregando…'));
      const ok = await mod.montar({ container: cont, api: (arq) => PF.api(mod.id, arq), irPara: (r) => irPara(mod, r) });
      if (PF.atual !== mod) return; // o usuário trocou de aba durante o carregamento
      if (ok === false) { PF.atual = null; return; }
    }
    mod.aoNavegar(resto);
    marcarAbas(resto);
  }
  window.addEventListener('hashchange', rotear);

  async function iniciar() {
    let r;
    try { r = await fetch('/api/sessao', { credentials: 'same-origin', cache: 'no-store' }); } catch (e) { r = null; }
    if (!r || !r.ok) return PF.mostrarLogin();
    let aberto = false;
    try { aberto = !!(await r.json()).aberto; } catch (e) { /* resposta sem corpo */ }
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#sair').hidden = aberto;                       // sem senha não há o que encerrar
    $('#aviso-aberto').hidden = !aberto;
    montarMenu();
    rotear();
  }
  document.addEventListener('DOMContentLoaded', iniciar);
})();
