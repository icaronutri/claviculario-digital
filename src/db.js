'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Quem opera o sistema (login). Ex.: um login para o computador do Sgt de Dia e logins de administradores.
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

-- Militares (motoristas, sargentos de dia, quem entrega/recebe viaturas)
CREATE TABLE IF NOT EXISTS pessoas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,                   -- nome de guerra ou completo
  posto TEXT,                           -- posto/graduação
  identificacao TEXT NOT NULL UNIQUE,   -- SARAM / matrícula
  setor TEXT,
  telefone TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Serviço do Sgt de Dia (turno ~08:00 às ~08:00 do dia seguinte)
CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sargento_id INTEGER NOT NULL REFERENCES pessoas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  inicio TEXT NOT NULL,
  fim TEXT,
  obs_assuncao TEXT,
  obs_passagem TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_servico_aberto ON servicos((1)) WHERE fim IS NULL;

-- Posições (números) do claviculário
CREATE TABLE IF NOT EXISTS posicoes (
  numero INTEGER PRIMARY KEY
);

-- Viaturas: fixas da STS ou temporárias (de outro setor, ocupando uma posição vaga)
CREATE TABLE IF NOT EXISTS viaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prefixo TEXT,
  modelo TEXT NOT NULL,
  placa TEXT NOT NULL UNIQUE,
  setor_origem TEXT NOT NULL DEFAULT 'STS',
  tipo TEXT NOT NULL CHECK (tipo IN ('fixa','temporaria')),
  posicao INTEGER UNIQUE REFERENCES posicoes(numero),
  no_claviculario INTEGER NOT NULL DEFAULT 1,  -- temporária que já foi embora = 0
  manutencao INTEGER NOT NULL DEFAULT 0,
  manutencao_motivo TEXT,
  manutencao_desde TEXT,
  ativa INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cautela da chave: saída para missão e devolução
CREATE TABLE IF NOT EXISTS cautelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viatura_id INTEGER NOT NULL REFERENCES viaturas(id),
  posicao INTEGER,
  vtr_prefixo TEXT, vtr_modelo TEXT, vtr_placa TEXT,     -- cópia dos dados no momento (como no livro)
  missao TEXT NOT NULL,
  destino TEXT,
  saida_em TEXT NOT NULL,
  km_saida INTEGER,
  motorista_saida_id INTEGER NOT NULL REFERENCES pessoas(id),
  assinatura_saida TEXT,
  obs_saida TEXT,
  servico_saida_id INTEGER NOT NULL REFERENCES servicos(id),
  operador_saida_id INTEGER NOT NULL REFERENCES usuarios(id),
  retorno_em TEXT,
  encerramento TEXT CHECK (encerramento IN ('devolvida','nao_retornou')),
  km_retorno INTEGER,
  motorista_retorno_id INTEGER REFERENCES pessoas(id),
  assinatura_retorno TEXT,
  obs_retorno TEXT,
  servico_retorno_id INTEGER REFERENCES servicos(id),
  operador_retorno_id INTEGER REFERENCES usuarios(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cautela_aberta ON cautelas(viatura_id) WHERE retorno_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_cautela_saida ON cautelas(saida_em);

-- Entrada/saída de viaturas temporárias no claviculário
CREATE TABLE IF NOT EXISTS registros_temporarias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viatura_id INTEGER NOT NULL REFERENCES viaturas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida','nao_retornou')),
  posicao INTEGER,
  pessoa_nome TEXT,          -- quem entregou / recebeu (pode ser de outro setor)
  assinatura TEXT,
  obs TEXT,
  em TEXT NOT NULL,
  servico_id INTEGER REFERENCES servicos(id),
  operador_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  servico_id INTEGER REFERENCES servicos(id),
  acao TEXT NOT NULL,
  detalhe TEXT,
  em TEXT NOT NULL
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
  if (!db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n) {
    const senha = process.env.ADMIN_SENHA || 'admin123';
    db.prepare('INSERT INTO usuarios (login, nome, senha_hash, perfil) VALUES (?,?,?,?)')
      .run('admin', 'Administrador', hashSenha(senha), 'admin');
    if (!process.env.ADMIN_SENHA && caminho !== ':memory:') {
      console.warn('[claviculário] Usuário inicial criado: admin / admin123 — troque a senha no primeiro acesso.');
    }
  }
  if (!db.prepare('SELECT COUNT(*) AS n FROM posicoes').get().n) {
    const total = Number(process.env.POSICOES_INICIAIS) || 30;
    const ins = db.prepare('INSERT INTO posicoes (numero) VALUES (?)');
    for (let i = 1; i <= total; i++) ins.run(i);
  }
  return db;
}

module.exports = { abrirBanco, hashSenha, conferirSenha };
