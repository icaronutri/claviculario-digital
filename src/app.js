'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashSenha, conferirSenha } = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSAO_HORAS = Number(process.env.SESSAO_HORAS) || 24; // renovada a cada uso
const EXIGIR_ASSINATURA = process.env.EXIGIR_ASSINATURA !== '0';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

class ErroHttp extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const falha = (status, msg) => { throw new ErroHttp(status, msg); };
const agora = () => new Date().toISOString();
const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());
const textoOuNulo = (v) => texto(v) || null;
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const placaNorm = (v) => texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
function inteiroOuNulo(v, campo) {
  if (!texto(v)) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) falha(400, `${campo} inválido`);
  return n;
}
function exigir(obj, campos) {
  for (const [c, nome] of Object.entries(campos)) if (!texto(obj[c])) falha(400, `Informe: ${nome}`);
}
function validarAssinatura(v, obrigatoria = EXIGIR_ASSINATURA) {
  if (!v) { if (obrigatoria) falha(400, 'A assinatura é obrigatória'); return null; }
  if (typeof v !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) falha(400, 'Assinatura inválida');
  if (v.length > 400000) falha(413, 'Assinatura muito grande');
  return v;
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (c) => { dados += c; if (dados.length > 2e6) { reject(new ErroHttp(413, 'Corpo muito grande')); req.destroy(); } });
    req.on('end', () => { if (!dados) return resolve({}); try { resolve(JSON.parse(dados)); } catch { reject(new ErroHttp(400, 'JSON inválido')); } });
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
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [colunas.map((c) => esc(c[1])).join(';'), ...linhas.map((l) => colunas.map((c) => esc(l[c[0]])).join(';'))].join('\r\n');
}

function criarApp(db) {
  const q = (sql) => db.prepare(sql);
  const transacao = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // ---------- tempo real (monitor) ----------
  const ouvintes = new Set();
  function avisarMudanca() {
    for (const res of ouvintes) res.write(`event: atualizar\ndata: ${Date.now()}\n\n`);
  }
  setInterval(() => { for (const res of ouvintes) res.write(': ping\n\n'); }, 25000).unref();

  // ---------- helpers ----------
  const servicoAtual = () => q(`SELECT s.*, p.nome AS sargento_nome, p.posto AS sargento_posto, u.nome AS usuario_nome
      FROM servicos s JOIN pessoas p ON p.id = s.sargento_id JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.fim IS NULL`).get() || null;
  function exigirServico() {
    const s = servicoAtual();
    if (!s) falha(409, 'Nenhum Sgt de Dia de serviço. Assuma o serviço antes de registrar movimentações.');
    return s;
  }
  function auditar(usuarioId, acao, detalhe) {
    const s = servicoAtual();
    q('INSERT INTO auditoria (usuario_id, servico_id, acao, detalhe, em) VALUES (?,?,?,?,?)')
      .run(usuarioId ?? null, s ? s.id : null, acao, detalhe ? JSON.stringify(detalhe) : null, agora());
  }
  function usuarioDaSessao(req) {
    const token = lerCookies(req).sessao;
    if (!token) return null;
    const u = q(`SELECT u.id, u.login, u.nome, u.perfil, s.expira_em FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                 WHERE s.token = ? AND u.ativo = 1`).get(token);
    if (!u) return null;
    if (u.expira_em < agora()) { q('DELETE FROM sessoes WHERE token = ?').run(token); return null; }
    // renovação deslizante: o PC do Sgt de Dia não é deslogado no meio do serviço
    const novo = new Date(Date.now() + SESSAO_HORAS * 3600e3).toISOString();
    if (novo.slice(0, 13) !== u.expira_em.slice(0, 13)) q('UPDATE sessoes SET expira_em = ? WHERE token = ?').run(novo, token);
    return { id: u.id, login: u.login, nome: u.nome, perfil: u.perfil, token };
  }
  const pessoaAtiva = (id, papel) => {
    const p = q('SELECT * FROM pessoas WHERE id = ?').get(Number(id));
    if (!p || !p.ativo) falha(404, `${papel} não encontrado ou inativo`);
    return p;
  };
  const viatura = (id) => {
    const v = q('SELECT * FROM viaturas WHERE id = ?').get(Number(id));
    if (!v) falha(404, 'Viatura não encontrada');
    return v;
  };
  const cautelaAberta = (viaturaId) => q('SELECT * FROM cautelas WHERE viatura_id = ? AND retorno_em IS NULL').get(viaturaId);
  function posicaoLivre(numero, ignorarViaturaId = 0) {
    const n = Number(numero);
    if (!q('SELECT 1 FROM posicoes WHERE numero = ?').get(n)) falha(400, `Posição ${numero} não existe no claviculário`);
    const ocup = q('SELECT prefixo, placa FROM viaturas WHERE posicao = ? AND id <> ?').get(n, ignorarViaturaId);
    if (ocup) falha(409, `Posição ${n} já está ocupada (${ocup.prefixo || ocup.placa})`);
    return n;
  }

  // ---------- painel ----------
  function painel() {
    const linhas = q(`SELECT po.numero, v.id AS viatura_id, v.prefixo, v.modelo, v.placa, v.setor_origem, v.tipo,
        v.manutencao, v.manutencao_motivo, v.manutencao_desde,
        c.id AS cautela_id, c.missao, c.destino, c.saida_em, c.km_saida,
        p.id AS motorista_id, p.nome AS motorista_nome, p.posto AS motorista_posto, p.telefone AS motorista_telefone
      FROM posicoes po
      LEFT JOIN viaturas v ON v.posicao = po.numero
      LEFT JOIN cautelas c ON c.viatura_id = v.id AND c.retorno_em IS NULL
      LEFT JOIN pessoas p ON p.id = c.motorista_saida_id
      ORDER BY po.numero`).all();
    const posicoes = linhas.map((l) => ({
      ...l,
      status: !l.viatura_id ? 'vaga' : l.cautela_id ? 'em_uso' : l.manutencao ? 'manutencao' : 'disponivel',
    }));
    const conta = (s) => posicoes.filter((p) => p.status === s).length;
    return {
      gerado_em: agora(),
      servico: servicoAtual(),
      totais: { posicoes: posicoes.length, disponiveis: conta('disponivel'), em_uso: conta('em_uso'), manutencao: conta('manutencao'), vagas: conta('vaga') },
      posicoes,
    };
  }

  // ---------- regras: serviço ----------
  function assumirServico(usuario, b) {
    const sgt = pessoaAtiva(b.sargento_id, 'Sargento');
    return transacao(() => {
      const anterior = servicoAtual();
      const t = agora();
      if (anterior) q('UPDATE servicos SET fim = ?, obs_passagem = ? WHERE id = ?').run(t, textoOuNulo(b.obs_passagem), anterior.id);
      const r = q('INSERT INTO servicos (sargento_id, usuario_id, inicio, obs_assuncao) VALUES (?,?,?,?)')
        .run(sgt.id, usuario.id, t, textoOuNulo(b.obs_assuncao));
      auditar(usuario.id, 'servico_assumido', { sargento: `${sgt.posto || ''} ${sgt.nome}`.trim(), anterior: anterior?.id ?? null });
      return { id: Number(r.lastInsertRowid), anterior_id: anterior?.id ?? null };
    });
  }

  // ---------- regras: cautela ----------
  function saida(usuario, b) {
    const s = exigirServico();
    const v = viatura(b.viatura_id);
    if (!v.ativa || !v.no_claviculario || !v.posicao) falha(409, 'Esta viatura não está no claviculário');
    if (v.manutencao) falha(409, `Viatura ${v.prefixo || v.placa} está em manutenção`);
    if (cautelaAberta(v.id)) falha(409, `A chave da viatura ${v.prefixo || v.placa} já está cautelada`);
    const mot = pessoaAtiva(b.motorista_id, 'Motorista');
    exigir(b, { missao: 'a missão' });
    const ass = validarAssinatura(b.assinatura);
    const r = q(`INSERT INTO cautelas (viatura_id, posicao, vtr_prefixo, vtr_modelo, vtr_placa, missao, destino, saida_em, km_saida,
        motorista_saida_id, assinatura_saida, obs_saida, servico_saida_id, operador_saida_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(v.id, v.posicao, v.prefixo, v.modelo, v.placa, texto(b.missao), textoOuNulo(b.destino), agora(),
        inteiroOuNulo(b.km_saida, 'Odômetro de saída'), mot.id, ass, textoOuNulo(b.obs), s.id, usuario.id);
    auditar(usuario.id, 'saida_viatura', { viatura: v.prefixo || v.placa, motorista: mot.nome, missao: texto(b.missao) });
    return cautelaResumo(r.lastInsertRowid);
  }

  function retorno(usuario, b) {
    const s = exigirServico();
    const v = viatura(b.viatura_id);
    const c = cautelaAberta(v.id);
    if (!c) falha(409, `A chave da viatura ${v.prefixo || v.placa} não está cautelada`);
    const naoRetornou = bool(b.nao_retornou);
    if (naoRetornou) {
      if (v.tipo !== 'temporaria') falha(400, 'Só viaturas temporárias podem ser encerradas sem retorno à STS');
      return transacao(() => {
        const t = agora();
        q(`UPDATE cautelas SET retorno_em = ?, encerramento = 'nao_retornou', obs_retorno = ?, servico_retorno_id = ?, operador_retorno_id = ?
           WHERE id = ?`).run(t, textoOuNulo(b.obs) || 'Viatura seguiu direto para o setor de origem', s.id, usuario.id, c.id);
        q(`INSERT INTO registros_temporarias (viatura_id, tipo, posicao, pessoa_nome, obs, em, servico_id, operador_id)
           VALUES (?,?,?,?,?,?,?,?)`).run(v.id, 'nao_retornou', v.posicao, textoOuNulo(b.informado_por), textoOuNulo(b.obs), t, s.id, usuario.id);
        q('UPDATE viaturas SET posicao = NULL, no_claviculario = 0 WHERE id = ?').run(v.id);
        auditar(usuario.id, 'temporaria_nao_retornou', { viatura: v.prefixo || v.placa, posicao: v.posicao });
        return cautelaResumo(c.id);
      });
    }
    const mot = pessoaAtiva(b.motorista_id || c.motorista_saida_id, 'Motorista');
    const ass = validarAssinatura(b.assinatura);
    const km = inteiroOuNulo(b.km_retorno, 'Odômetro de retorno');
    if (km !== null && c.km_saida !== null && km < c.km_saida) falha(400, `Odômetro de retorno (${km}) menor que o de saída (${c.km_saida})`);
    q(`UPDATE cautelas SET retorno_em = ?, encerramento = 'devolvida', km_retorno = ?, motorista_retorno_id = ?, assinatura_retorno = ?,
       obs_retorno = ?, servico_retorno_id = ?, operador_retorno_id = ? WHERE id = ?`)
      .run(agora(), km, mot.id, ass, textoOuNulo(b.obs), s.id, usuario.id, c.id);
    auditar(usuario.id, 'retorno_viatura', { viatura: v.prefixo || v.placa, motorista: mot.nome });
    return cautelaResumo(c.id);
  }

  const cautelaResumo = (id) => q(`SELECT id, viatura_id, posicao, missao, saida_em, retorno_em, encerramento,
      assinatura_saida IS NOT NULL AS assinada_saida, assinatura_retorno IS NOT NULL AS assinada_retorno
      FROM cautelas WHERE id = ?`).get(id);

  function listarCautelas(params) {
    const where = [], args = [];
    const dia = (d, fim) => new Date(`${d}T${fim ? '23:59:59.999' : '00:00:00'}`).toISOString();
    if (params.get('de')) { where.push('c.saida_em >= ?'); args.push(dia(params.get('de'))); }
    if (params.get('ate')) { where.push('c.saida_em <= ?'); args.push(dia(params.get('ate'), true)); }
    if (params.get('viatura_id')) { where.push('c.viatura_id = ?'); args.push(Number(params.get('viatura_id'))); }
    if (params.get('servico_id')) { where.push('(c.servico_saida_id = ? OR c.servico_retorno_id = ?)'); args.push(Number(params.get('servico_id')), Number(params.get('servico_id'))); }
    if (params.get('abertas') === '1') where.push('c.retorno_em IS NULL');
    const limite = Math.min(Number(params.get('limite')) || 500, 5000);
    return q(`SELECT c.id, c.posicao, c.vtr_prefixo, c.vtr_modelo, c.vtr_placa, c.missao, c.destino,
        c.saida_em, c.km_saida, c.retorno_em, c.km_retorno, c.encerramento, c.obs_saida, c.obs_retorno,
        ms.nome AS motorista_saida, ms.posto AS motorista_saida_posto, ms.identificacao AS motorista_saida_ident,
        mr.nome AS motorista_retorno, mr.posto AS motorista_retorno_posto,
        TRIM(COALESCE(ss.posto,'') || ' ' || ss.nome) AS sgt_saida, TRIM(COALESCE(sr.posto,'') || ' ' || sr.nome) AS sgt_retorno,
        c.assinatura_saida IS NOT NULL AS assinada_saida, c.assinatura_retorno IS NOT NULL AS assinada_retorno
      FROM cautelas c
      JOIN pessoas ms ON ms.id = c.motorista_saida_id
      LEFT JOIN pessoas mr ON mr.id = c.motorista_retorno_id
      JOIN servicos s1 ON s1.id = c.servico_saida_id JOIN pessoas ss ON ss.id = s1.sargento_id
      LEFT JOIN servicos s2 ON s2.id = c.servico_retorno_id LEFT JOIN pessoas sr ON sr.id = s2.sargento_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.saida_em DESC LIMIT ${limite}`).all(...args);
  }

  // ---------- roteamento ----------
  const rotas = [];
  const rota = (metodo, padrao, opts, fn) => {
    const nomes = [];
    const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '(\\d+)'; }) + '$');
    rotas.push({ metodo, re, nomes, fn, ...opts });
  };
  const pub = { publica: true }, op = {}, adm = { admin: true };

  // Autenticação
  rota('POST', '/api/login', pub, ({ body, res }) => {
    const u = q('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(texto(body.login));
    if (!u || !conferirSenha(body.senha || '', u.senha_hash)) { auditar(null, 'login_falhou', { login: texto(body.login) }); falha(401, 'Usuário ou senha inválidos'); }
    const token = crypto.randomBytes(32).toString('hex');
    q('DELETE FROM sessoes WHERE expira_em < ?').run(agora());
    q('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?,?,?)').run(token, u.id, new Date(Date.now() + SESSAO_HORAS * 3600e3).toISOString());
    auditar(u.id, 'login');
    res.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`);
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

  // Painel e tempo real
  rota('GET', '/api/painel', op, () => painel());
  rota('GET', '/api/eventos', op, ({ req, res }) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    ouvintes.add(res);
    req.on('close', () => ouvintes.delete(res));
    return undefined;
  });

  // Serviço do Sgt de Dia
  rota('GET', '/api/servico/atual', op, () => {
    const s = servicoAtual();
    if (!s) return { servico: null };
    const abertas = listarCautelas(new URLSearchParams('abertas=1'));
    return { servico: s, cautelas_abertas: abertas };
  });
  rota('POST', '/api/servico/assumir', op, ({ usuario, body }) => assumirServico(usuario, body));
  rota('GET', '/api/servicos', op, () => q(`SELECT s.id, s.inicio, s.fim, s.obs_assuncao, s.obs_passagem,
      TRIM(COALESCE(p.posto,'') || ' ' || p.nome) AS sargento,
      (SELECT COUNT(*) FROM cautelas c WHERE c.servico_saida_id = s.id) AS saidas,
      (SELECT COUNT(*) FROM cautelas c WHERE c.servico_retorno_id = s.id) AS retornos
    FROM servicos s JOIN pessoas p ON p.id = s.sargento_id ORDER BY s.inicio DESC LIMIT 200`).all());

  // Pessoas (militares)
  rota('GET', '/api/pessoas', op, ({ params }) =>
    q(`SELECT * FROM pessoas ${params.get('todas') === '1' ? '' : 'WHERE ativo = 1'} ORDER BY nome COLLATE NOCASE`).all());
  rota('POST', '/api/pessoas', op, ({ usuario, body }) => {
    exigir(body, { nome: 'o nome', identificacao: 'o SARAM/identificação' });
    if (q('SELECT 1 FROM pessoas WHERE identificacao = ?').get(texto(body.identificacao))) falha(409, 'Já existe militar com essa identificação');
    const r = q('INSERT INTO pessoas (nome, posto, identificacao, setor, telefone) VALUES (?,?,?,?,?)')
      .run(texto(body.nome), textoOuNulo(body.posto), texto(body.identificacao), textoOuNulo(body.setor), textoOuNulo(body.telefone));
    auditar(usuario.id, 'pessoa_criada', { nome: texto(body.nome) });
    return q('SELECT * FROM pessoas WHERE id = ?').get(r.lastInsertRowid);
  });
  rota('PUT', '/api/pessoas/:id', op, ({ usuario, body, p }) => {
    const pe = q('SELECT * FROM pessoas WHERE id = ?').get(p.id);
    if (!pe) falha(404, 'Militar não encontrado');
    exigir(body, { nome: 'o nome', identificacao: 'o SARAM/identificação' });
    if (q('SELECT 1 FROM pessoas WHERE identificacao = ? AND id <> ?').get(texto(body.identificacao), p.id)) falha(409, 'Já existe militar com essa identificação');
    q('UPDATE pessoas SET nome = ?, posto = ?, identificacao = ?, setor = ?, telefone = ?, ativo = ? WHERE id = ?')
      .run(texto(body.nome), textoOuNulo(body.posto), texto(body.identificacao), textoOuNulo(body.setor), textoOuNulo(body.telefone),
        body.ativo === undefined ? pe.ativo : bool(body.ativo), p.id);
    auditar(usuario.id, 'pessoa_editada', { id: p.id });
    return q('SELECT * FROM pessoas WHERE id = ?').get(p.id);
  });

  // Posições do claviculário
  rota('PUT', '/api/posicoes', adm, ({ usuario, body }) => {
    const total = Number(body.total);
    if (!Number.isInteger(total) || total < 1 || total > 500) falha(400, 'Quantidade de posições inválida (1 a 500)');
    const maiorOcupada = q('SELECT MAX(posicao) AS m FROM viaturas WHERE posicao IS NOT NULL').get().m || 0;
    if (total < maiorOcupada) falha(409, `A posição ${maiorOcupada} está ocupada; não é possível reduzir para ${total}`);
    transacao(() => {
      q('DELETE FROM posicoes WHERE numero > ?').run(total);
      const ins = q('INSERT OR IGNORE INTO posicoes (numero) VALUES (?)');
      for (let i = 1; i <= total; i++) ins.run(i);
    });
    auditar(usuario.id, 'posicoes_alteradas', { total });
    return { total };
  });

  // Viaturas
  rota('GET', '/api/viaturas', op, ({ params }) =>
    q(`SELECT * FROM viaturas ${params.get('todas') === '1' ? '' : 'WHERE ativa = 1 AND no_claviculario = 1'}
       ORDER BY tipo, posicao IS NULL, posicao, prefixo`).all());

  rota('POST', '/api/viaturas', adm, ({ usuario, body }) => {
    exigir(body, { modelo: 'o modelo', placa: 'a placa', posicao: 'a posição no claviculário' });
    const placa = placaNorm(body.placa);
    if (q('SELECT 1 FROM viaturas WHERE placa = ?').get(placa)) falha(409, 'Já existe viatura com essa placa');
    const pos = posicaoLivre(body.posicao);
    const r = q(`INSERT INTO viaturas (prefixo, modelo, placa, setor_origem, tipo, posicao) VALUES (?,?,?,?,'fixa',?)`)
      .run(textoOuNulo(body.prefixo), texto(body.modelo), placa, texto(body.setor_origem) || 'STS', pos);
    auditar(usuario.id, 'viatura_fixa_criada', { placa, posicao: pos });
    return q('SELECT * FROM viaturas WHERE id = ?').get(r.lastInsertRowid);
  });

  rota('PUT', '/api/viaturas/:id', adm, ({ usuario, body, p }) => {
    const v = viatura(p.id);
    exigir(body, { modelo: 'o modelo', placa: 'a placa' });
    const placa = placaNorm(body.placa);
    if (q('SELECT 1 FROM viaturas WHERE placa = ? AND id <> ?').get(placa, v.id)) falha(409, 'Já existe viatura com essa placa');
    let pos = v.posicao;
    const ativa = body.ativa === undefined ? v.ativa : bool(body.ativa);
    if (v.tipo === 'fixa') {
      if (!ativa) {
        if (cautelaAberta(v.id)) falha(409, 'A chave desta viatura está cautelada');
        pos = null;
      } else {
        if (!texto(body.posicao)) falha(400, 'Informe a posição no claviculário');
        pos = posicaoLivre(body.posicao, v.id);
      }
    }
    q('UPDATE viaturas SET prefixo = ?, modelo = ?, placa = ?, setor_origem = ?, posicao = ?, ativa = ? WHERE id = ?')
      .run(textoOuNulo(body.prefixo), texto(body.modelo), placa, texto(body.setor_origem) || v.setor_origem, pos, ativa, v.id);
    auditar(usuario.id, 'viatura_editada', { id: v.id, placa });
    return q('SELECT * FROM viaturas WHERE id = ?').get(v.id);
  });

  rota('POST', '/api/viaturas/:id/manutencao', op, ({ usuario, body, p }) => {
    exigirServico();
    const v = viatura(p.id);
    const em = bool(body.em_manutencao);
    if (em) {
      if (cautelaAberta(v.id)) falha(409, 'Registre a devolução da chave antes de colocar a viatura em manutenção');
      exigir(body, { motivo: 'o motivo da manutenção' });
      q('UPDATE viaturas SET manutencao = 1, manutencao_motivo = ?, manutencao_desde = ? WHERE id = ?').run(texto(body.motivo), agora(), v.id);
    } else {
      q('UPDATE viaturas SET manutencao = 0, manutencao_motivo = NULL, manutencao_desde = NULL WHERE id = ?').run(v.id);
    }
    auditar(usuario.id, em ? 'manutencao_inicio' : 'manutencao_fim', { viatura: v.prefixo || v.placa, motivo: textoOuNulo(body.motivo) });
    return q('SELECT * FROM viaturas WHERE id = ?').get(v.id);
  });

  // Viaturas temporárias (de outros setores, em posição vaga)
  rota('POST', '/api/temporarias/entrada', op, ({ usuario, body }) => {
    const s = exigirServico();
    exigir(body, { modelo: 'o modelo', placa: 'a placa', setor_origem: 'o setor de origem', posicao: 'a posição', entregue_por: 'quem entregou a chave' });
    const placa = placaNorm(body.placa);
    const existente = q('SELECT * FROM viaturas WHERE placa = ?').get(placa);
    if (existente && (existente.no_claviculario && existente.ativa)) falha(409, `Viatura ${placa} já está no claviculário (posição ${existente.posicao})`);
    if (existente && existente.tipo === 'fixa') falha(409, `A placa ${placa} é de uma viatura fixa desativada; reative-a no cadastro`);
    const pos = posicaoLivre(body.posicao);
    const ass = validarAssinatura(body.assinatura, false);
    return transacao(() => {
      let id;
      if (existente) {
        q(`UPDATE viaturas SET prefixo = ?, modelo = ?, setor_origem = ?, posicao = ?, no_claviculario = 1, ativa = 1,
           manutencao = 0, manutencao_motivo = NULL, manutencao_desde = NULL WHERE id = ?`)
          .run(textoOuNulo(body.prefixo), texto(body.modelo), texto(body.setor_origem), pos, existente.id);
        id = existente.id;
      } else {
        id = Number(q(`INSERT INTO viaturas (prefixo, modelo, placa, setor_origem, tipo, posicao) VALUES (?,?,?,?,'temporaria',?)`)
          .run(textoOuNulo(body.prefixo), texto(body.modelo), placa, texto(body.setor_origem), pos).lastInsertRowid);
      }
      q(`INSERT INTO registros_temporarias (viatura_id, tipo, posicao, pessoa_nome, assinatura, obs, em, servico_id, operador_id)
         VALUES (?,?,?,?,?,?,?,?,?)`).run(id, 'entrada', pos, texto(body.entregue_por), ass, textoOuNulo(body.obs), agora(), s.id, usuario.id);
      auditar(usuario.id, 'temporaria_entrada', { placa, setor: texto(body.setor_origem), posicao: pos });
      return q('SELECT * FROM viaturas WHERE id = ?').get(id);
    });
  });

  rota('POST', '/api/temporarias/:id/saida', op, ({ usuario, body, p }) => {
    const s = exigirServico();
    const v = viatura(p.id);
    if (v.tipo !== 'temporaria' || !v.no_claviculario) falha(409, 'Esta viatura não é uma temporária no claviculário');
    if (cautelaAberta(v.id)) falha(409, 'A chave está cautelada; registre o retorno (ou "não retornou") primeiro');
    exigir(body, { recebido_por: 'quem recebeu a chave' });
    const ass = validarAssinatura(body.assinatura);
    transacao(() => {
      q(`INSERT INTO registros_temporarias (viatura_id, tipo, posicao, pessoa_nome, assinatura, obs, em, servico_id, operador_id)
         VALUES (?,?,?,?,?,?,?,?,?)`).run(v.id, 'saida', v.posicao, texto(body.recebido_por), ass, textoOuNulo(body.obs), agora(), s.id, usuario.id);
      q('UPDATE viaturas SET posicao = NULL, no_claviculario = 0, manutencao = 0 WHERE id = ?').run(v.id);
    });
    auditar(usuario.id, 'temporaria_saida', { viatura: v.prefixo || v.placa, posicao: v.posicao });
    return { ok: true };
  });

  rota('GET', '/api/temporarias/registros', op, () => q(`SELECT r.id, r.tipo, r.posicao, r.pessoa_nome, r.obs, r.em,
      r.assinatura IS NOT NULL AS assinado, v.prefixo, v.modelo, v.placa, v.setor_origem,
      TRIM(COALESCE(p.posto,'') || ' ' || p.nome) AS sargento
    FROM registros_temporarias r JOIN viaturas v ON v.id = r.viatura_id
    LEFT JOIN servicos s ON s.id = r.servico_id LEFT JOIN pessoas p ON p.id = s.sargento_id
    ORDER BY r.em DESC LIMIT 300`).all());
  rota('GET', '/api/temporarias/registros/:id', op, ({ p }) => {
    const r = q('SELECT * FROM registros_temporarias WHERE id = ?').get(p.id);
    if (!r) falha(404, 'Registro não encontrado');
    return r;
  });

  // Cautelas
  rota('POST', '/api/cautelas/saida', op, ({ usuario, body }) => saida(usuario, body));
  rota('POST', '/api/cautelas/retorno', op, ({ usuario, body }) => retorno(usuario, body));
  rota('GET', '/api/cautelas', op, ({ params, res }) => {
    const linhas = listarCautelas(params);
    if (params.get('formato') !== 'csv') return linhas;
    const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: process.env.TZ || 'America/Sao_Paulo' }) : '');
    const nome = (posto, n) => [posto, n].filter(Boolean).join(' ');
    const dados = linhas.map((l) => ({
      ...l, saida_em: fmt(l.saida_em), retorno_em: fmt(l.retorno_em),
      ms: nome(l.motorista_saida_posto, l.motorista_saida), mr: nome(l.motorista_retorno_posto, l.motorista_retorno),
      situacao: !l.retorno_em ? 'Em uso' : l.encerramento === 'nao_retornou' ? 'Não retornou à STS' : 'Devolvida',
      rodado: l.km_retorno !== null && l.km_saida !== null ? l.km_retorno - l.km_saida : '',
    }));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cautelas-${agora().slice(0, 10)}.csv"` });
    res.end(csv(dados, [['id', 'Nº'], ['posicao', 'Posição'], ['vtr_prefixo', 'Prefixo'], ['vtr_modelo', 'Modelo'], ['vtr_placa', 'Placa'],
      ['missao', 'Missão'], ['destino', 'Destino'], ['ms', 'Motorista (saída)'], ['motorista_saida_ident', 'SARAM'], ['saida_em', 'Saída'],
      ['km_saida', 'Km saída'], ['sgt_saida', 'Sgt de Dia (saída)'], ['situacao', 'Situação'], ['mr', 'Motorista (devolução)'],
      ['retorno_em', 'Devolução'], ['km_retorno', 'Km retorno'], ['rodado', 'Km rodados'], ['sgt_retorno', 'Sgt de Dia (devolução)'],
      ['obs_saida', 'Obs. saída'], ['obs_retorno', 'Obs. devolução']]));
    return undefined;
  });
  rota('GET', '/api/cautelas/:id', op, ({ p }) => {
    const c = q(`SELECT c.*, TRIM(COALESCE(ms.posto,'') || ' ' || ms.nome) AS motorista_saida,
        TRIM(COALESCE(mr.posto,'') || ' ' || mr.nome) AS motorista_retorno
      FROM cautelas c JOIN pessoas ms ON ms.id = c.motorista_saida_id LEFT JOIN pessoas mr ON mr.id = c.motorista_retorno_id
      WHERE c.id = ?`).get(p.id);
    if (!c) falha(404, 'Cautela não encontrada');
    return c;
  });

  // Usuários
  rota('GET', '/api/usuarios', adm, () => q('SELECT id, login, nome, perfil, ativo, criado_em FROM usuarios ORDER BY nome').all());
  rota('POST', '/api/usuarios', adm, ({ usuario, body }) => {
    exigir(body, { login: 'o login', nome: 'o nome', senha: 'a senha' });
    if (texto(body.senha).length < 6) falha(400, 'A senha deve ter pelo menos 6 caracteres');
    if (q('SELECT 1 FROM usuarios WHERE login = ?').get(texto(body.login))) falha(409, 'Login já existe');
    const perfil = body.perfil === 'admin' ? 'admin' : 'operador';
    const r = q('INSERT INTO usuarios (login, nome, senha_hash, perfil) VALUES (?,?,?,?)').run(texto(body.login), texto(body.nome), hashSenha(body.senha), perfil);
    auditar(usuario.id, 'usuario_criado', { login: texto(body.login), perfil });
    return q('SELECT id, login, nome, perfil, ativo FROM usuarios WHERE id = ?').get(r.lastInsertRowid);
  });
  rota('PUT', '/api/usuarios/:id', adm, ({ usuario, body, p }) => {
    const u = q('SELECT * FROM usuarios WHERE id = ?').get(p.id);
    if (!u) falha(404, 'Usuário não encontrado');
    const perfil = body.perfil === undefined ? u.perfil : body.perfil === 'admin' ? 'admin' : 'operador';
    const ativo = body.ativo === undefined ? u.ativo : bool(body.ativo);
    if (u.id === usuario.id && (perfil !== 'admin' || !ativo)) falha(400, 'Você não pode remover seu próprio acesso de administrador');
    if (texto(body.senha) && texto(body.senha).length < 6) falha(400, 'A senha deve ter pelo menos 6 caracteres');
    q('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?').run(texto(body.nome) || u.nome, perfil, ativo, p.id);
    if (texto(body.senha)) q('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(body.senha), p.id);
    if (!ativo) q('DELETE FROM sessoes WHERE usuario_id = ?').run(p.id);
    auditar(usuario.id, 'usuario_editado', { id: p.id });
    return q('SELECT id, login, nome, perfil, ativo FROM usuarios WHERE id = ?').get(p.id);
  });
  rota('GET', '/api/auditoria', adm, () => q(`SELECT a.id, a.acao, a.detalhe, a.em, u.nome AS usuario,
      TRIM(COALESCE(p.posto,'') || ' ' || p.nome) AS sargento
    FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
    LEFT JOIN servicos s ON s.id = a.servico_id LEFT JOIN pessoas p ON p.id = s.sargento_id
    ORDER BY a.id DESC LIMIT 300`).all());

  // ---------- servidor ----------
  function servirEstatico(res, pathname) {
    let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (rel === 'monitor') rel = 'monitor.html';
    const arq = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!arq.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(arq).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!url.pathname.startsWith('/api/')) return servirEstatico(res, url.pathname);
    try {
      let achou = null; const p = {};
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
      if (req.method !== 'GET' && !url.pathname.startsWith('/api/log')) avisarMudanca();
    } catch (e) {
      const status = e instanceof ErroHttp ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ erro: status === 500 ? 'Erro interno' : e.message }));
      }
    }
  });
  server.on('close', () => { for (const r of ouvintes) r.end(); });
  return server;
}

module.exports = { criarApp };
