'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { abrirBanco } = require('./src/db');
const { criarApp } = require('./src/app');

const MODO_TESTE = process.argv.includes('--teste') || process.env.MODO_TESTE === '1';
const PORTA = Number(process.env.PORT) || 3000;
const BANCO = process.env.DB_PATH || path.join(__dirname, 'dados', MODO_TESTE ? 'teste.db' : 'claviculario.db');

fs.mkdirSync(path.dirname(BANCO), { recursive: true });
const db = abrirBanco(BANCO);
if (MODO_TESTE && require('./src/exemplo').popularExemplo(db)) console.log('Dados de exemplo carregados.');

const servidor = criarApp(db);
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nA porta ${PORTA} já está em uso. O sistema provavelmente já está aberto em outra janela.\n`);
  else console.error(e);
  process.exit(1);
});
servidor.listen(PORTA, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('');
  console.log('==============================================');
  console.log(`  CLAVICULARIO DIGITAL ${MODO_TESTE ? '(MODO TESTE)' : ''}`);
  console.log('==============================================');
  console.log(`  Neste computador:  http://localhost:${PORTA}`);
  for (const ip of ips) console.log(`  Outros na rede:    http://${ip}:${PORTA}`);
  console.log(`  Monitor:           http://localhost:${PORTA}/monitor`);
  console.log(`  Banco de dados:    ${BANCO}`);
  if (MODO_TESTE) console.log('  Login: admin / admin123   (ou sgtdia / sgtdia123)');
  console.log('');
  console.log('  NAO FECHE ESTA JANELA enquanto estiver usando o sistema.');
  console.log('==============================================');
});
