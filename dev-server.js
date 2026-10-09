// Servidor local para testes: serve public/ e roteia /api/* para as mesmas funções usadas no Vercel.
// Uso: PAINEL_SENHA=... PAINEL_SEGREDO=... [DADOS_DIR=data_teste] node dev-server.js [porta]
const http = require('http');
const fs = require('fs');
const path = require('path');

const porta = Number(process.argv[2]) || 3000;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const nome = url.pathname.slice(5).replace(/[^a-z_]/g, '');
    try {
      return await require(path.join(__dirname, 'api', nome + '.js'))(req, res);
    } catch (e) {
      res.statusCode = 500;
      return res.end(String(e.message));
    }
  }
  const arquivo = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!arquivo.startsWith(path.join(__dirname, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(arquivo, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('não encontrado'); }
    res.setHeader('Content-Type', tipos[path.extname(arquivo)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(porta, () => console.log('http://localhost:' + porta));
