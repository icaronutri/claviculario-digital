'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { abrirBanco } = require('./src/db');
const { criarApp } = require('./src/app');

const PORTA = Number(process.env.PORT) || 3000;
const BANCO = process.env.DB_PATH || path.join(__dirname, 'dados', 'claviculario.db');

fs.mkdirSync(path.dirname(BANCO), { recursive: true });
const db = abrirBanco(BANCO);
criarApp(db).listen(PORTA, () => {
  console.log(`Claviculário Digital rodando em http://localhost:${PORTA}`);
  console.log(`Banco de dados: ${BANCO}`);
});
