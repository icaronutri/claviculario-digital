'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashSenha, conferirSenha } = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSAO_HORAS = 12;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
const falha = (status, msg) => { throw new ErroHttp(status, msg); };

const agora = () => new Date().toISOString();
const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

const EXIGIR_ASSINATURA = process.env.EXIGIR_ASSINATURA !== '0';
function validarAssinatura(v) {
  if (!v) {
    if (EXIGIR_ASSINATURA) falha(400, 'A assinatura é obrigatória');
    return null;
  }
  if (typeof v !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) falha(400, 'Assinatura inválida');
  if (v.length > 400000) falha(413, 'Assinatura muito grande');
  return v;
}

function exigir(obj, campos) {
  for (const c of campos) if (!texto(obj[c])) falha(400, `Campo obrigatório: ${c}`);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (c) => {
      dados += c;
      if (dados.length > 1e6) { reject(new ErroHttp(413, 'Corpo muito grande')); req.destroy(); }
    });
    req.on('end', () => {
      if (!dados) return resolve({});
      try { resolve(JSON.parse(dados)); } catch { reject(new ErroHttp(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function lerCookies(req) {
  const out = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function csv(linhas, colunas) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cab = colunas.map((c) => esc(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => esc(l[c.campo])).join(';'));
  return '﻿' + [cab, ...corpo].join('\r\n'); // BOM para o Excel abrir acentos
}

function criarApp(db) {
  const q = (sql) => db.prepare(sql);

  function auditar(usuarioId, acao, detalhe) {
    q('INSERT INTO auditoria (usuario_id, acao, detalhe, em) VALUES (?,?,?,?)')
      .run(usuarioId ?? null, acao, detalhe ? JSON.stringify(detalhe) : null, agora());
  }

  function usuarioDaSessao(req) {
    const token = lerCookies(req).sessao;
    if (!token) return null;
    const u = q(`SELECT u.id, u.login, u.nome, u.perfil, s.expira_em FROM sessoes s
                 JOIN usuarios u ON u.id = s.usuario_id
                 WHERE s.token = ? AND u.ativo = 1`).get(token);
    if (!u) return null;
    if (u.expira_em < agora()) { q('DELETE FROM sessoes WHERE token = ?').run(token); return null; }
    return { id: u.id, login: u.login, nome: u.nome, perfil: u.perfil, token };
  }

  // ---------- regras de negócio ----------
  function chaveAberta(chaveId) {
    return q(`SELECT m.*, p.nome AS pessoa_nome FROM movimentacoes m
              JOIN pessoas p ON p.id = m.pessoa_id
              WHERE m.chave_id = ? AND m.devolvida_em IS NULL`).get(chaveId);
  }

  const movPorId = (id) => q(`SELECT id, chave_id, pessoa_id, retirada_em, previsao_devolucao, devolvida_em,
      devolvida_por_id, obs_retirada, obs_devolucao,
      assinatura_retirada IS NOT NULL AS assinada_retirada,
      assinatura_devolucao IS NOT NULL AS assinada_devolucao
    FROM movimentacoes WHERE id = ?`).get(id);

  function retirar(usuario, b) {
    const chaveId = Number(b.chave_id), pessoaId = Number(b.pessoa_id);
    if (!chaveId || !pessoaId) falha(400, 'Informe a chave e a pessoa');
    const chave = q('SELECT * FROM chaves WHERE id = ?').get(chaveId);
    if (!chave || !chave.ativa) falha(404, 'Chave não encontrada ou inativa');
    const pessoa = q('SELECT * FROM pessoas WHERE id = ?').get(pessoaId);
    if (!pessoa || !pessoa.ativo) falha(404, 'Pessoa não encontrada ou inativa');
    const aberta = chaveAberta(chaveId);
    if (aberta) falha(409, `Chave ${chave.codigo} já está com ${aberta.pessoa_nome}`);
    if (chave.restrita) {
      const ok = q('SELECT 1 FROM autorizacoes WHERE chave_id = ? AND pessoa_id = ?').get(chaveId, pessoaId);
      if (!ok) falha(403, `${pessoa.nome} não está autorizado(a) a retirar a chave ${chave.codigo}`);
    }
    let previsao = null;
    if (texto(b.previsao_devolucao)) {
      const d = new Date(b.previsao_devolucao);
      if (isNaN(d)) falha(400, 'Previsão de devolução inválida');
      previsao = d.toISOString();
    }
    const assinatura = validarAssinatura(b.assinatura);
    const r = q(`INSERT INTO movimentacoes (chave_id, pessoa_id, retirada_em, previsao_devolucao,
                 operador_retirada_id, obs_retirada, assinatura_retirada) VALUES (?,?,?,?,?,?,?)`)
      .run(chaveId, pessoaId, agora(), previsao, usuario.id, texto(b.obs) || null, assinatura);
    auditar(usuario.id, 'retirada', { chave: chave.codigo, pessoa: pessoa.nome });
    return movPorId(r.lastInsertRowid);
  }

  function devolver(usuario, b) {
    const chaveId = Number(b.chave_id);
    const chave = q('SELECT * FROM chaves WHERE id = ?').get(chaveId);
    if (!chave) falha(404, 'Chave não encontrada');
    const aberta = chaveAberta(chaveId);
    if (!aberta) falha(409, `Chave ${chave.codigo} não está retirada`);
    const devolvidaPor = Number(b.devolvida_por_id) || aberta.pessoa_id;
    if (!q('SELECT 1 FROM pessoas WHERE id = ?').get(devolvidaPor)) falha(404, 'Pessoa que devolveu não encontrada');
    const assinatura = validarAssinatura(b.assinatura);
    q(`UPDATE movimentacoes SET devolvida_em = ?, devolvida_por_id = ?, operador_devolucao_id = ?,
       obs_devolucao = ?, assinatura_devolucao = ? WHERE id = ?`)
      .run(agora(), devolvidaPor, usuario.id, texto(b.obs) || null, assinatura, aberta.id);
    auditar(usuario.id, 'devolucao', { chave: chave.codigo, movimentacao: aberta.id });
    return movPorId(aberta.id);
  }

  function painel() {
    const t = agora();
    const chaves = q(`SELECT c.id, c.codigo, c.descricao, c.local, c.restrita,
                        m.id AS mov_id, m.retirada_em, m.previsao_devolucao,
                        p.id AS pessoa_id, p.nome AS pessoa_nome, p.posto AS pessoa_posto,
                        p.telefone AS pessoa_telefone
                      FROM chaves c
                      LEFT JOIN movimentacoes m ON m.chave_id = c.id AND m.devolvida_em IS NULL
                      LEFT JOIN pessoas p ON p.id = m.pessoa_id
                      WHERE c.ativa = 1
                      ORDER BY c.codigo COLLATE NOCASE`).all()
      .map((c) => ({
        ...c,
        status: !c.mov_id ? 'disponivel'
          : c.previsao_devolucao && c.previsao_devolucao < t ? 'atrasada' : 'retirada',
      }));
    const conta = (s) => chaves.filter((c) => c.status === s).length;
    return {
      gerado_em: t,
      totais: { chaves: chaves.length, disponiveis: conta('disponivel'), retiradas: conta('retirada'), atrasadas: conta('atrasada') },
      chaves,
    };
  }

  function movimentacoes(params) {
    const where = [], args = [];
    if (params.get('de')) { where.push('m.retirada_em >= ?'); args.push(new Date(params.get('de') + 'T00:00:00').toISOString()); }
    if (params.get('ate')) { where.push('m.retirada_em <= ?'); args.push(new Date(params.get('ate') + 'T23:59:59.999').toISOString()); }
    if (params.get('chave_id')) { where.push('m.chave_id = ?'); args.push(Number(params.get('chave_id'))); }
    if (params.get('pessoa_id')) { where.push('m.pessoa_id = ?'); args.push(Number(params.get('pessoa_id'))); }
    if (params.get('abertas') === '1') where.push('m.devolvida_em IS NULL');
    const limite = Math.min(Number(params.get('limite')) || 500, 5000);
    return q(`SELECT m.id, c.codigo AS chave_codigo, c.descricao AS chave_descricao,
                p.nome AS pessoa_nome, p.identificacao AS pessoa_identificacao, p.posto AS pessoa_posto, p.setor AS pessoa_setor,
                m.retirada_em, m.previsao_devolucao, m.devolvida_em,
                pd.nome AS devolvida_por_nome,
                ur.nome AS operador_retirada, ud.nome AS operador_devolucao,
                m.obs_retirada, m.obs_devolucao,
                m.assinatura_retirada IS NOT NULL AS assinada_retirada,
                m.assinatura_devolucao IS NOT NULL AS assinada_devolucao
              FROM movimentacoes m
              JOIN chaves c ON c.id = m.chave_id
              JOIN pessoas p ON p.id = m.pessoa_id
              LEFT JOIN pessoas pd ON pd.id = m.devolvida_por_id
              LEFT JOIN usuarios ur ON ur.id = m.operador_retirada_id
              LEFT JOIN usuarios ud ON ud.id = m.operador_devolucao_id
              ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
              ORDER BY m.retirada_em DESC LIMIT ${limite}`).all(...args);
  }

  // ---------- roteamento ----------
  const rotas = [];
  const rota = (metodo, padrao, opts, fn) => {
    const nomes = [];
    const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '(\\d+)'; }) + '$');
    rotas.push({ metodo, re, nomes, fn, ...opts });
  };
  const pub = { publica: true }, op = {}, adm = { admin: true };

  rota('POST', '/api/login', pub, async ({ body, res }) => {
    const u = q('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(texto(body.login));
    if (!u || !conferirSenha(body.senha || '', u.senha_hash)) {
      auditar(null, 'login_falhou', { login: texto(body.login) });
      falha(401, 'Usuário ou senha inválidos');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + SESSAO_HORAS * 3600e3).toISOString();
    q('DELETE FROM sessoes WHERE expira_em < ?').run(agora());
    q('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?,?,?)').run(token, u.id, expira);
    auditar(u.id, 'login');
    res.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_HORAS * 3600}`);
    return { id: u.id, login: u.login, nome: u.nome, perfil: u.perfil };
  });

  rota('POST', '/api/logout', op, ({ usuario, res }) => {
    q('DELETE FROM sessoes WHERE token = ?').run(usuario.token);
    res.setHeader('Set-Cookie', 'sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });

  rota('GET', '/api/me', op, ({ usuario }) => ({ id: usuario.id, login: usuario.login, nome: usuario.nome, perfil: usuario.perfil }));

  rota('POST', '/api/minha-senha', op, ({ usuario, body }) => {
    const u = q('SELECT * FROM usuarios WHERE id = ?').get(usuario.id);
    if (!conferirSenha(body.atual || '', u.senha_hash)) falha(400, 'Senha atual incorreta');
    if (texto(body.nova).length < 6) falha(400, 'A nova senha deve ter pelo menos 6 caracteres');
    q('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(body.nova), u.id);
    auditar(u.id, 'troca_senha');
    return { ok: true };
  });

  rota('GET', '/api/painel', op, () => painel());

  // Chaves
  rota('GET', '/api/chaves', op, ({ params }) =>
    q(`SELECT c.*, (SELECT COUNT(*) FROM autorizacoes a WHERE a.chave_id = c.id) AS n_autorizados
       FROM chaves c ${params.get('todas') === '1' ? '' : 'WHERE c.ativa = 1'}
       ORDER BY c.codigo COLLATE NOCASE`).all());

  rota('POST', '/api/chaves', adm, ({ usuario, body }) => {
    exigir(body, ['codigo', 'descricao']);
    if (q('SELECT 1 FROM chaves WHERE codigo = ?').get(texto(body.codigo))) falha(409, 'Já existe chave com esse código');
    const r = q('INSERT INTO chaves (codigo, descricao, local, restrita) VALUES (?,?,?,?)')
      .run(texto(body.codigo), texto(body.descricao), texto(body.local) || null, bool(body.restrita));
    auditar(usuario.id, 'chave_criada', { codigo: texto(body.codigo) });
    return q('SELECT * FROM chaves WHERE id = ?').get(r.lastInsertRowid);
  });

  rota('PUT', '/api/chaves/:id', adm, ({ usuario, body, p }) => {
    const c = q('SELECT * FROM chaves WHERE id = ?').get(p.id);
    if (!c) falha(404, 'Chave não encontrada');
    exigir(body, ['codigo', 'descricao']);
    const dup = q('SELECT id FROM chaves WHERE codigo = ? AND id <> ?').get(texto(body.codigo), p.id);
    if (dup) falha(409, 'Já existe chave com esse código');
    const ativa = body.ativa === undefined ? c.ativa : bool(body.ativa);
    if (!ativa && chaveAberta(p.id)) falha(409, 'Não é possível desativar uma chave que está retirada');
    q('UPDATE chaves SET codigo = ?, descricao = ?, local = ?, restrita = ?, ativa = ? WHERE id = ?')
      .run(texto(body.codigo), texto(body.descricao), texto(body.local) || null, bool(body.restrita), ativa, p.id);
    auditar(usuario.id, 'chave_editada', { id: p.id });
    return q('SELECT * FROM chaves WHERE id = ?').get(p.id);
  });

  rota('GET', '/api/chaves/:id/autorizados', op, ({ p }) =>
    q(`SELECT p.id, p.nome, p.posto, p.identificacao FROM autorizacoes a
       JOIN pessoas p ON p.id = a.pessoa_id WHERE a.chave_id = ? ORDER BY p.nome`).all(p.id));

  rota('PUT', '/api/chaves/:id/autorizados', adm, ({ usuario, body, p }) => {
    if (!q('SELECT 1 FROM chaves WHERE id = ?').get(p.id)) falha(404, 'Chave não encontrada');
    const ids = [...new Set((body.pessoa_ids || []).map(Number).filter(Boolean))];
    db.exec('BEGIN');
    try {
      q('DELETE FROM autorizacoes WHERE chave_id = ?').run(p.id);
      const ins = q('INSERT INTO autorizacoes (chave_id, pessoa_id) VALUES (?,?)');
      for (const id of ids) ins.run(p.id, id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    auditar(usuario.id, 'autorizacoes_alteradas', { chave_id: p.id, total: ids.length });
    return { ok: true, total: ids.length };
  });

  // Pessoas
  rota('GET', '/api/pessoas', op, ({ params }) => {
    const busca = texto(params.get('q'));
    const where = [params.get('todas') === '1' ? '1=1' : 'ativo = 1'];
    const args = [];
    if (busca) { where.push('(nome LIKE ? OR identificacao LIKE ? OR setor LIKE ?)'); args.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); }
    return q(`SELECT * FROM pessoas WHERE ${where.join(' AND ')} ORDER BY nome COLLATE NOCASE`).all(...args);
  });

  rota('POST', '/api/pessoas', op, ({ usuario, body }) => {
    exigir(body, ['nome', 'identificacao']);
    if (q('SELECT 1 FROM pessoas WHERE identificacao = ?').get(texto(body.identificacao))) falha(409, 'Já existe pessoa com essa identificação');
    const r = q('INSERT INTO pessoas (nome, identificacao, posto, setor, telefone) VALUES (?,?,?,?,?)')
      .run(texto(body.nome), texto(body.identificacao), texto(body.posto) || null, texto(body.setor) || null, texto(body.telefone) || null);
    auditar(usuario.id, 'pessoa_criada', { identificacao: texto(body.identificacao) });
    return q('SELECT * FROM pessoas WHERE id = ?').get(r.lastInsertRowid);
  });

  rota('PUT', '/api/pessoas/:id', op, ({ usuario, body, p }) => {
    const pe = q('SELECT * FROM pessoas WHERE id = ?').get(p.id);
    if (!pe) falha(404, 'Pessoa não encontrada');
    exigir(body, ['nome', 'identificacao']);
    if (q('SELECT 1 FROM pessoas WHERE identificacao = ? AND id <> ?').get(texto(body.identificacao), p.id)) falha(409, 'Já existe pessoa com essa identificação');
    const ativo = body.ativo === undefined ? pe.ativo : bool(body.ativo);
    q('UPDATE pessoas SET nome = ?, identificacao = ?, posto = ?, setor = ?, telefone = ?, ativo = ? WHERE id = ?')
      .run(texto(body.nome), texto(body.identificacao), texto(body.posto) || null, texto(body.setor) || null, texto(body.telefone) || null, ativo, p.id);
    auditar(usuario.id, 'pessoa_editada', { id: p.id });
    return q('SELECT * FROM pessoas WHERE id = ?').get(p.id);
  });

  // Movimentações
  rota('POST', '/api/retiradas', op, ({ usuario, body }) => retirar(usuario, body));
  rota('POST', '/api/devolucoes', op, ({ usuario, body }) => devolver(usuario, body));

  rota('GET', '/api/movimentacoes', op, ({ params, res }) => {
    const linhas = movimentacoes(params);
    if (params.get('formato') !== 'csv') return linhas;
    const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: process.env.TZ || 'America/Sao_Paulo' }) : '');
    const dados = linhas.map((l) => ({ ...l, retirada_em: fmt(l.retirada_em), previsao_devolucao: fmt(l.previsao_devolucao), devolvida_em: fmt(l.devolvida_em),
      ass_ret: l.assinada_retirada ? 'Sim' : 'Não', ass_dev: l.devolvida_em ? (l.assinada_devolucao ? 'Sim' : 'Não') : '' }));
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="movimentacoes-${agora().slice(0, 10)}.csv"`,
    });
    res.end(csv(dados, [
      { campo: 'id', titulo: 'Nº' }, { campo: 'chave_codigo', titulo: 'Chave' }, { campo: 'chave_descricao', titulo: 'Descrição' },
      { campo: 'pessoa_posto', titulo: 'Posto/Cargo' }, { campo: 'pessoa_nome', titulo: 'Retirada por' },
      { campo: 'pessoa_identificacao', titulo: 'Identificação' }, { campo: 'pessoa_setor', titulo: 'Setor' },
      { campo: 'retirada_em', titulo: 'Retirada em' }, { campo: 'previsao_devolucao', titulo: 'Previsão' },
      { campo: 'devolvida_em', titulo: 'Devolvida em' }, { campo: 'devolvida_por_nome', titulo: 'Devolvida por' },
      { campo: 'operador_retirada', titulo: 'Operador (retirada)' }, { campo: 'operador_devolucao', titulo: 'Operador (devolução)' },
      { campo: 'obs_retirada', titulo: 'Obs. retirada' }, { campo: 'obs_devolucao', titulo: 'Obs. devolução' },
      { campo: 'ass_ret', titulo: 'Assinou retirada' }, { campo: 'ass_dev', titulo: 'Assinou devolução' },
    ]));
    return undefined;
  });

  rota('GET', '/api/movimentacoes/:id', op, ({ p }) => {
    const m = q(`SELECT m.*, c.codigo AS chave_codigo, c.descricao AS chave_descricao,
                   p.nome AS pessoa_nome, p.posto AS pessoa_posto, p.identificacao AS pessoa_identificacao,
                   pd.nome AS devolvida_por_nome, ur.nome AS operador_retirada, ud.nome AS operador_devolucao
                 FROM movimentacoes m JOIN chaves c ON c.id = m.chave_id JOIN pessoas p ON p.id = m.pessoa_id
                 LEFT JOIN pessoas pd ON pd.id = m.devolvida_por_id
                 LEFT JOIN usuarios ur ON ur.id = m.operador_retirada_id
                 LEFT JOIN usuarios ud ON ud.id = m.operador_devolucao_id
                 WHERE m.id = ?`).get(p.id);
    if (!m) falha(404, 'Movimentação não encontrada');
    return m;
  });

  // Usuários (operadores do sistema)
  rota('GET', '/api/usuarios', adm, () => q('SELECT id, login, nome, perfil, ativo, criado_em FROM usuarios ORDER BY nome').all());

  rota('POST', '/api/usuarios', adm, ({ usuario, body }) => {
    exigir(body, ['login', 'nome', 'senha']);
    if (texto(body.senha).length < 6) falha(400, 'A senha deve ter pelo menos 6 caracteres');
    const perfil = body.perfil === 'admin' ? 'admin' : 'operador';
    if (q('SELECT 1 FROM usuarios WHERE login = ?').get(texto(body.login))) falha(409, 'Login já existe');
    const r = q('INSERT INTO usuarios (login, nome, senha_hash, perfil) VALUES (?,?,?,?)')
      .run(texto(body.login), texto(body.nome), hashSenha(body.senha), perfil);
    auditar(usuario.id, 'usuario_criado', { login: texto(body.login), perfil });
    return q('SELECT id, login, nome, perfil, ativo FROM usuarios WHERE id = ?').get(r.lastInsertRowid);
  });

  rota('PUT', '/api/usuarios/:id', adm, ({ usuario, body, p }) => {
    const u = q('SELECT * FROM usuarios WHERE id = ?').get(p.id);
    if (!u) falha(404, 'Usuário não encontrado');
    const perfil = body.perfil === undefined ? u.perfil : body.perfil === 'admin' ? 'admin' : 'operador';
    const ativo = body.ativo === undefined ? u.ativo : bool(body.ativo);
    if (u.id === usuario.id && (perfil !== 'admin' || !ativo)) falha(400, 'Você não pode remover seu próprio acesso de administrador');
    q('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?').run(texto(body.nome) || u.nome, perfil, ativo, p.id);
    if (texto(body.senha)) {
      if (texto(body.senha).length < 6) falha(400, 'A senha deve ter pelo menos 6 caracteres');
      q('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(body.senha), p.id);
    }
    if (!ativo) q('DELETE FROM sessoes WHERE usuario_id = ?').run(p.id);
    auditar(usuario.id, 'usuario_editado', { id: p.id });
    return q('SELECT id, login, nome, perfil, ativo FROM usuarios WHERE id = ?').get(p.id);
  });

  rota('GET', '/api/auditoria', adm, () =>
    q(`SELECT a.id, a.acao, a.detalhe, a.em, u.nome AS usuario FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 300`).all());

  // ---------- servidor ----------
  function servirEstatico(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const arq = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!arq.startsWith(PUBLIC_DIR) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!url.pathname.startsWith('/api/')) return servirEstatico(req, res, url.pathname);

    try {
      let achou = null, p = {};
      for (const r of rotas) {
        const m = url.pathname.match(r.re);
        if (m && r.metodo === req.method) { achou = r; r.nomes.forEach((n, i) => { p[n] = Number(m[i + 1]); }); break; }
      }
      if (!achou) falha(404, 'Rota não encontrada');
      const usuario = usuarioDaSessao(req);
      if (!achou.publica && !usuario) falha(401, 'Faça login');
      if (achou.admin && usuario.perfil !== 'admin') falha(403, 'Apenas administradores');
      const body = ['POST', 'PUT'].includes(req.method) ? await lerCorpo(req) : {};
      const out = await achou.fn({ req, res, body, params: url.searchParams, p, usuario });
      if (out !== undefined && !res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      }
    } catch (e) {
      const status = e instanceof ErroHttp ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ erro: status === 500 ? 'Erro interno' : e.message }));
      }
    }
  });
}

module.exports = { criarApp };
