(() => {
  'use strict';
  // Compartilhamento de listas: resumo em texto (WhatsApp, e-mail) e PDF gerado no próprio aparelho.
  // O PDF usa a biblioteca jsPDF (vendor/), baixada só na primeira vez que alguém a pede.
  // Uso: PF.barraCompartilhar(() => ({ titulo, filtros: [..], colunas: [{ t, w, n }], linhas: [[..]], texto: [..], arquivo, paisagem }))
  // A função é chamada no clique, para refletir os filtros que estão na tela naquele momento.
  const { el } = PF;
  const MAX_LINHAS_PDF = 600;
  let carga = null;
  function carregarPdf() {
    if (window.jspdf) return Promise.resolve();
    if (!carga) {
      carga = new Promise((ok, erro) => {
        const s = document.createElement('script');
        s.src = 'vendor/jspdf.umd.min.js';
        s.onload = ok;
        s.onerror = () => { carga = null; erro(new Error('Não foi possível carregar o gerador de PDF.')); };
        document.head.append(s);
      });
    }
    return carga;
  }
  // As fontes padrão do PDF cobrem o português (Latin-1), mas não setas e símbolos: troca por equivalentes simples.
  const limpar = (v) => String(v ?? '')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/→/g, '->').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x20-\x7E¡-ÿ]/g, '');

  const hoje = () => new Date().toLocaleDateString('pt-BR');

  function montarPdf(d) {
    const { jsPDF } = window.jspdf;
    const paisagem = d.paisagem !== false;
    const doc = new jsPDF({ orientation: paisagem ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const m = 12, util = W - 2 * m, passo = 3.7;
    let y = m;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    for (const l of doc.splitTextToSize(limpar(d.titulo), util)) { doc.text(l, m, y + 4); y += 6; }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    for (const f of d.filtros || []) for (const l of doc.splitTextToSize(limpar(f), util)) { doc.text(l, m, y + 3); y += 4; }
    y += 3;

    const soma = d.colunas.reduce((t, c) => t + c.w, 0);
    const larg = d.colunas.map((c) => (c.w / soma) * util);
    const x0 = larg.map((_, i) => m + larg.slice(0, i).reduce((t, v) => t + v, 0));
    const cabecalho = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.setFillColor(235, 235, 232); doc.rect(m, y, util, 6, 'F');
      d.colunas.forEach((c, i) => c.n ? doc.text(limpar(c.t), x0[i] + larg[i] - 1, y + 4, { align: 'right' }) : doc.text(limpar(c.t), x0[i] + 1, y + 4));
      y += 6.5;
      doc.setFont('helvetica', 'normal');
    };
    cabecalho();
    doc.setFontSize(8);
    const linhas = d.linhas.slice(0, MAX_LINHAS_PDF);
    for (const lin of linhas) {
      const celulas = lin.map((v, i) => doc.splitTextToSize(limpar(v), larg[i] - 2));
      const alt = Math.max(...celulas.map((c) => c.length)) * passo + 2;
      if (y + alt > H - 14) { doc.addPage(); y = m; cabecalho(); doc.setFontSize(8); }
      celulas.forEach((c, i) => c.forEach((t, k) => {
        const yy = y + 3.2 + k * passo;
        if (d.colunas[i].n) doc.text(t, x0[i] + larg[i] - 1, yy, { align: 'right' }); else doc.text(t, x0[i] + 1, yy);
      }));
      y += alt;
      doc.setDrawColor(210, 210, 205); doc.setLineWidth(0.1); doc.line(m, y, m + util, y);
    }
    if (d.linhas.length > linhas.length) { y += 4; doc.setFont('helvetica', 'italic'); doc.text(`Mostrando os primeiros ${linhas.length} de ${d.linhas.length} registros. Use os filtros ou o CSV para o restante.`, m, y); }
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
      doc.text(limpar(`Painel Fiscal ES - uso interno, fontes publicas - gerado em ${hoje()}`), m, H - 7);
      doc.text(`pagina ${p} de ${n}`, W - m, H - 7, { align: 'right' });
    }
    return doc;
  }

  const podeArquivo = () => {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; }
  };

  async function enviarPdf(d, aviso) {
    aviso('Gerando o PDF…');
    try { await carregarPdf(); } catch (e) { return aviso(e.message); }
    const doc = montarPdf(d);
    const nome = (d.arquivo || 'lista') + '.pdf';
    if (podeArquivo()) {
      const arq = new File([doc.output('blob')], nome, { type: 'application/pdf' });
      try { await navigator.share({ files: [arq], title: d.titulo }); aviso(''); return; } catch (e) { if (e && e.name === 'AbortError') return aviso(''); /* sem compartilhamento: baixa */ }
    }
    doc.save(nome);
    aviso('PDF gerado.');
  }

  async function enviarTexto(d, aviso) {
    const texto = [d.titulo, ...(d.filtros || []), '', ...(d.texto || []), '', `Painel Fiscal ES - uso interno, fontes públicas - ${hoje()}`].join('\n');
    if (navigator.share) {
      try { await navigator.share({ title: d.titulo, text: texto }); aviso(''); return; } catch (e) { if (e && e.name === 'AbortError') return aviso(''); }
    }
    try { await navigator.clipboard.writeText(texto); aviso('Resumo copiado. Cole no WhatsApp ou no e-mail.'); } catch (e) { window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener'); }
  }

  PF.barraCompartilhar = (obter) => {
    const msg = el('span', { class: 'compartilhar-msg', role: 'status' });
    const aviso = (t) => { msg.textContent = t; };
    const aquecer = () => { if (!(navigator.connection && navigator.connection.saveData)) carregarPdf().catch(() => {}); };
    (window.requestIdleCallback || ((f) => setTimeout(f, 2000)))(aquecer);
    return el('div', { class: 'compartilhar no-print' },
      el('span', { class: 'compartilhar-rotulo' }, 'Compartilhar esta lista'),
      el('button', { type: 'button', class: 'botao-primario', onclick: () => enviarPdf(obter(), aviso) }, podeArquivo() ? 'PDF (enviar)' : 'Baixar PDF'),
      el('button', { type: 'button', class: 'botao', onclick: () => enviarTexto(obter(), aviso) }, 'Resumo em texto'),
      msg);
  };
})();
