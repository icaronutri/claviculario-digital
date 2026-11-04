'use strict';
// Servidor simples para abrir a versão HTML numa porta local (padrão 8080).
// Uso: node ferramentas/servir-html.js [porta]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
let porta = Number(process.argv[2] || process.env.PORT) || 8080;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const servidor = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'claviculario.html';
  const arq = path.normalize(path.join(raiz, rel));
  if (!arq.startsWith(raiz + path.sep) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado');
  }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(arq).pipe(res);
});
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && porta < 8090) { porta++; servidor.listen(porta, '127.0.0.1'); } else { console.error(e.message); process.exit(1); }
});
servidor.on('listening', () => {
  const url = `http://localhost:${porta}/`;
  console.log('\n==============================================');
  console.log('  CLAVICULARIO DIGITAL (versao HTML)');
  console.log(`  Abra: ${url}`);
  console.log(`  Monitor: ${url}claviculario.html#monitor`);
  console.log('  NAO FECHE ESTA JANELA enquanto estiver usando.');
  console.log('==============================================\n');
  if (process.argv.includes('--abrir')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    require('node:child_process').exec(cmd);
  }
});
servidor.listen(porta, '127.0.0.1');
