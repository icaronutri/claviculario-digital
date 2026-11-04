'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','operador')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pessoas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  identificacao TEXT NOT NULL UNIQUE,   -- matrícula / SARAM / CPF
  posto TEXT,                           -- posto/graduação ou cargo
  setor TEXT,
  telefone TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,          -- número no quadro
  descricao TEXT NOT NULL,              -- ex.: Sala 12 - Almoxarifado
  local TEXT,                           -- prédio / bloco
  restrita INTEGER NOT NULL DEFAULT 0,  -- 1 = só pessoas autorizadas
  ativa INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS autorizacoes (
  chave_id INTEGER NOT NULL REFERENCES chaves(id) ON DELETE CASCADE,
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  PRIMARY KEY (chave_id, pessoa_id)
);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave_id INTEGER NOT NULL REFERENCES chaves(id),
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id),
  retirada_em TEXT NOT NULL,
  previsao_devolucao TEXT,
  operador_retirada_id INTEGER NOT NULL REFERENCES usuarios(id),
  obs_retirada TEXT,
  assinatura_retirada TEXT,             -- PNG (data URL) assinado com o dedo
  devolvida_em TEXT,
  devolvida_por_id INTEGER REFERENCES pessoas(id),
  operador_devolucao_id INTEGER REFERENCES usuarios(id),
  obs_devolucao TEXT,
  assinatura_devolucao TEXT
);

-- Garante no banco que uma chave só pode ter uma retirada em aberto
CREATE UNIQUE INDEX IF NOT EXISTS ux_mov_aberta
  ON movimentacoes(chave_id) WHERE devolvida_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_mov_retirada ON movimentacoes(retirada_em);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  detalhe TEXT,
  em TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(senha), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function conferirSenha(senha, armazenado) {
  const [alg, saltHex, hashHex] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calc = crypto.scryptSync(String(senha), Buffer.from(saltHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, calc);
}

function abrirBanco(caminho) {
  const db = new DatabaseSync(caminho);
  db.exec(SCHEMA);
  const temUsuario = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (!temUsuario) {
    const senha = process.env.ADMIN_SENHA || 'admin123';
    db.prepare('INSERT INTO usuarios (login, nome, senha_hash, perfil) VALUES (?,?,?,?)')
      .run('admin', 'Administrador', hashSenha(senha), 'admin');
    if (!process.env.ADMIN_SENHA && caminho !== ':memory:') {
      console.warn('[claviculário] Usuário inicial criado: admin / admin123 — troque a senha no primeiro acesso.');
    }
  }
  return db;
}

module.exports = { abrirBanco, hashSenha, conferirSenha };
