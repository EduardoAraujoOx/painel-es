(() => {
  'use strict';
  // Gráficos reutilizáveis: linhas, barras agrupadas e mapa de blocos.
  const { el, svg, nInt, rotuloMes, soma, mostrarDica, esconderDica, dicaLinha, dicaNoElemento, observar } = PF;

  // ---------- gráficos ----------
  function passoNice(max, alvo) {
    if (max <= 0) return 1;
    const bruto = max / alvo;
    const exp = Math.pow(10, Math.floor(Math.log10(bruto)));
    const f = bruto / exp;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  }
  function moldura(W, H, meses, maxVal, fmtTick) {
    const ml = 46, mr = 16, mt = 14, mb = 26;
    const iw = W - ml - mr, ih = H - mt - mb;
    const passo = passoNice(maxVal, 4);
    const topo = Math.max(passo, Math.ceil(maxVal / passo) * passo);
    const y = (v) => mt + ih - (v / topo) * ih;
    const n = meses.length;
    const raiz = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    for (let v = 0; v <= topo + 1e-9; v += passo) {
      raiz.append(svg('line', { class: v === 0 ? 'eixo' : 'grade', x1: ml, x2: W - mr, y1: y(v), y2: y(v) }));
      const t = svg('text', { x: ml - 8, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = fmtTick(v);
      raiz.append(t);
    }
    const cada = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
    meses.forEach((m, i) => {
      if ((n - 1 - i) % cada !== 0) return;
      const t = svg('text', { x: ml + (n === 1 ? iw / 2 : (i * iw) / (n - 1)), y: H - 6, 'text-anchor': 'middle' });
      t.textContent = rotuloMes(m);
      raiz.append(t);
    });
    return { raiz, ml, mr, mt, mb, iw, ih, y, topo, n };
  }
  function legenda(series) {
    if (series.length < 2) return null;
    return el('div', { class: 'legenda' }, series.map((s) => el('span', {},
      el('i', { class: s.barra ? 'chave-caixa' : 'chave-linha', style: `background:${s.cor}` }), s.nome)));
  }

  function graficoLinhas(container, { meses, series, fmt }) {
    const caixa = el('div', { class: 'grafico', tabindex: '0', role: 'img',
      'aria-label': 'Gráfico de linhas: ' + series.map((s) => s.nome).join(', ') });
    container.append(...[legenda(series), caixa].filter(Boolean));
    let idxAtivo = meses.length - 1;
    function desenhar(W) {
      const H = 220;
      const maxVal = Math.max(1, ...series.flatMap((s) => s.vals));
      const m = moldura(W, H, meses, maxVal, (v) => nInt.format(v));
      const px = (i) => m.ml + (m.n === 1 ? m.iw / 2 : (i * m.iw) / (m.n - 1));
      const rotulados = [];
      for (const s of series) {
        const d = s.vals.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${m.y(v).toFixed(1)}`).join('');
        m.raiz.append(svg('path', { d, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round',
          'stroke-linecap': 'round', style: `stroke:${s.cor}` }));
        const ux = px(m.n - 1), uy = m.y(s.vals[m.n - 1]);
        m.raiz.append(svg('circle', { cx: ux, cy: uy, r: 4, style: `fill:${s.cor};stroke:var(--superficie);stroke-width:2` }));
        if (rotulados.every((y) => Math.abs(y - uy) > 15)) {
          rotulados.push(uy);
          const t = svg('text', { class: 'rotulo-final', x: ux - 6, y: uy - 9, 'text-anchor': 'end' });
          t.textContent = fmt(s.vals[m.n - 1]);
          m.raiz.append(t);
        }
      }
      const cursor = svg('line', { class: 'cursor', y1: m.mt, y2: m.mt + m.ih, visibility: 'hidden' });
      const pontos = series.map((s) => svg('circle', { r: 4, visibility: 'hidden',
        style: `fill:${s.cor};stroke:var(--superficie);stroke-width:2` }));
      m.raiz.append(cursor, ...pontos);
      const sobre = svg('rect', { x: m.ml, y: m.mt, width: m.iw, height: m.ih, fill: 'transparent' });
      m.raiz.append(sobre);

      function mostrar(i, cx, cy) {
        idxAtivo = i;
        cursor.setAttribute('x1', px(i)); cursor.setAttribute('x2', px(i)); cursor.setAttribute('visibility', 'visible');
        pontos.forEach((p, k) => {
          p.setAttribute('cx', px(i)); p.setAttribute('cy', m.y(series[k].vals[i])); p.setAttribute('visibility', 'visible');
        });
        mostrarDica([el('div', { class: 'tit' }, rotuloMes(meses[i], true)),
          ...series.map((s) => dicaLinha(s.cor, fmt(s.vals[i]), s.nome))], cx, cy);
      }
      function esconder() {
        cursor.setAttribute('visibility', 'hidden');
        pontos.forEach((p) => p.setAttribute('visibility', 'hidden'));
        esconderDica();
      }
      const indiceDe = (ev) => {
        const r = sobre.getBoundingClientRect();
        const f = (ev.clientX - r.left) / r.width;
        return Math.min(m.n - 1, Math.max(0, Math.round(f * (m.n - 1))));
      };
      sobre.addEventListener('pointermove', (ev) => mostrar(indiceDe(ev), ev.clientX, ev.clientY));
      sobre.addEventListener('pointerleave', esconder);
      caixa.onkeydown = (ev) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        const i = Math.min(m.n - 1, Math.max(0, idxAtivo + (ev.key === 'ArrowRight' ? 1 : -1)));
        const r = caixa.getBoundingClientRect();
        mostrar(i, r.left + px(i), r.top + 40);
      };
      caixa.onblur = esconder;
      caixa.replaceChildren(m.raiz);
    }
    observar(caixa, desenhar);
  }

  function graficoBarras(container, { meses, series, fmt }) {
    const caixa = el('div', { class: 'grafico', role: 'img',
      'aria-label': 'Gráfico de barras: ' + series.map((s) => s.nome).join(', ') });
    container.append(...[legenda(series), caixa].filter(Boolean));
    function desenhar(W) {
      const H = 200;
      const maxVal = Math.max(1, ...series.flatMap((s) => s.vals));
      const m = moldura(W, H, meses, maxVal, (v) => nInt.format(v));
      const banda = m.iw / m.n;
      const larg = Math.max(2, Math.min(24, (banda - 6) / series.length - 2));
      const grupoW = series.length * larg + (series.length - 1) * 2;
      const y0 = m.y(0);
      const grupos = meses.map((mes, i) => {
        const x0 = m.ml + i * banda + (banda - grupoW) / 2;
        const g = svg('g', {});
        series.forEach((s, k) => {
          const v = s.vals[i];
          if (v <= 0) return;
          const x = x0 + k * (larg + 2), yt = m.y(v), r = Math.min(4, larg / 2, y0 - yt);
          g.append(svg('path', {
            d: `M${x},${y0}L${x},${yt + r}Q${x},${yt} ${x + r},${yt}L${x + larg - r},${yt}Q${x + larg},${yt} ${x + larg},${yt + r}L${x + larg},${y0}Z`,
            style: `fill:${s.cor}`,
          }));
        });
        m.raiz.append(g);
        return g;
      });
      meses.forEach((mes, i) => {
        const hit = svg('rect', { x: m.ml + i * banda, y: m.mt, width: banda, height: m.ih, fill: 'transparent', tabindex: '0',
          'aria-label': `${rotuloMes(mes, true)}: ` + series.map((s) => `${s.nome} ${fmt(s.vals[i])}`).join(', ') });
        const nos = () => [el('div', { class: 'tit' }, rotuloMes(mes, true)),
          ...series.map((s) => dicaLinha(s.cor, fmt(s.vals[i]), s.nome))];
        const realce = (on) => grupos[i].setAttribute('style', on ? 'filter:brightness(1.18)' : '');
        hit.addEventListener('pointermove', (ev) => { realce(true); mostrarDica(nos(), ev.clientX, ev.clientY); });
        hit.addEventListener('pointerleave', () => { realce(false); esconderDica(); });
        hit.addEventListener('focus', () => { realce(true); dicaNoElemento(hit, nos); });
        hit.addEventListener('blur', () => { realce(false); esconderDica(); });
        m.raiz.append(hit);
      });
      caixa.replaceChildren(m.raiz);
    }
    observar(caixa, desenhar);
  }

  // mapa de blocos (algoritmo "squarified")
  function mapaDeBlocos(itens, W, H) {
    const total = soma(itens, (i) => i.v);
    const nos = itens.filter((i) => i.v > 0).sort((a, b) => b.v - a.v)
      .map((i) => ({ ...i, a: (i.v / total) * W * H }));
    const saida = [];
    let x = 0, y = 0, w = W, h = H, linha = [];
    const pior = (l, lado) => {
      const s = soma(l, (n) => n.a);
      const mx = Math.max(...l.map((n) => n.a)), mn = Math.min(...l.map((n) => n.a));
      return Math.max((lado * lado * mx) / (s * s), (s * s) / (lado * lado * mn));
    };
    const fechar = (l) => {
      const s = soma(l, (n) => n.a);
      if (w >= h) {
        const lw = s / h; let yy = y;
        for (const n of l) { const hh = n.a / lw; saida.push({ ...n, x, y: yy, w: lw, h: hh }); yy += hh; }
        x += lw; w -= lw;
      } else {
        const lh = s / w; let xx = x;
        for (const n of l) { const ww = n.a / lh; saida.push({ ...n, x: xx, y, w: ww, h: lh }); xx += ww; }
        y += lh; h -= lh;
      }
    };
    let i = 0;
    while (i < nos.length) {
      const lado = Math.min(w, h), tentativa = linha.concat([nos[i]]);
      if (!linha.length || pior(tentativa, lado) <= pior(linha, lado)) { linha = tentativa; i++; } else { fechar(linha); linha = []; }
    }
    if (linha.length) fechar(linha);
    return saida;
  }

  PF.graficoLinhas = graficoLinhas;
  PF.graficoBarras = graficoBarras;
  PF.mapaDeBlocos = mapaDeBlocos;
})();
