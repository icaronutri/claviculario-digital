'use strict';
/*
 * "Servidor" que roda dentro do navegador: guarda tudo no IndexedDB e
 * responde às mesmas rotas /api/... da versão com Node.js, com as mesmas regras.
 */
const BancoLocal = (() => {
  const NOME = 'claviculario-digital';
  let conexao;
  function abrir() {
    if (conexao) return conexao;
    conexao = new Promise((ok, erro) => {
      const r = indexedDB.open(NOME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('assinaturas'); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
    });
    return conexao;
  }
  async function op(loja, modo, fn) {
    const db = await abrir();
    return new Promise((ok, erro) => {
      const tx = db.transaction(loja, modo);
      const req = fn(tx.objectStore(loja));
      tx.oncomplete = () => ok(req?.result);
      tx.onerror = () => erro(tx.error);
      tx.onabort = () => erro(tx.error || new Error('Não foi possível gravar os dados'));
    });
  }
  return {
    ler: (k) => op('kv', 'readonly', (s) => s.get(k)),
    gravar: (k, v) => op('kv', 'readwrite', (s) => s.put(v, k)),
    lerAssinatura: (id) => op('assinaturas', 'readonly', (s) => s.get(id)),
    gravarAssinatura: (id, v) => op('assinaturas', 'readwrite', (s) => s.put(v, id)),
    todasAssinaturas: async () => {
      const db = await abrir();
      return new Promise((ok, erro) => {
        const out = {}, tx = db.transaction('assinaturas', 'readonly');
        tx.objectStore('assinaturas').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out[c.key] = c.value; c.continue(); } };
        tx.oncomplete = () => ok(out); tx.onerror = () => erro(tx.error);
      });
    },
    limparTudo: async () => { await op('kv', 'readwrite', (s) => s.clear()); await op('assinaturas', 'readwrite', (s) => s.clear()); },
  };
})();

const Local = (() => {
  const EXIGIR_ASSINATURA = true;
  let E = null; // estado em memória

  const novoEstado = () => ({
    versao: 1, criado_em: new Date().toISOString(), total_posicoes: 30,
    seq: {}, pessoas: [], viaturas: [], servicos: [], cautelas: [], temporarias: [], auditoria: [],
  });

  class ErroRegra extends Error {}
  const falha = (msg) => { throw new ErroRegra(msg); };
  const agora = () => new Date().toISOString();
  const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const nulo = (v) => texto(v) || null;
  const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
  const placaNorm = (v) => texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const novoId = (tipo) => (E.seq[tipo] = (E.seq[tipo] || 0) + 1);
  const nomeMil = (p) => (p ? [p.posto, p.nome].filter(Boolean).join(' ') : '');
  function inteiro(v, campo) {
    if (!texto(v)) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) falha(`${campo} inválido`);
    return n;
  }
  function exigir(obj, campos) { for (const [c, nome] of Object.entries(campos)) if (!texto(obj[c])) falha(`Informe: ${nome}`); }
  function validarAssinatura(v, obrigatoria = EXIGIR_ASSINATURA) {
    if (!v) { if (obrigatoria) falha('A assinatura é obrigatória'); return null; }
    if (typeof v !== 'string' || !v.startsWith('data:image/')) falha('Assinatura inválida');
    return v;
  }

  // ---------- consultas ----------
  const pessoa = (id) => E.pessoas.find((p) => p.id === Number(id));
  const viatura = (id) => E.viaturas.find((v) => v.id === Number(id)) || falha('Viatura não encontrada');
  const servicoAtual = () => {
    const s = E.servicos.find((x) => !x.fim);
    if (!s) return null;
    const sg = pessoa(s.sargento_id);
    return { ...s, sargento_nome: sg?.nome, sargento_posto: sg?.posto };
  };
  const exigirServico = () => servicoAtual() || falha('Nenhum Sgt de Dia de serviço. Assuma o serviço antes de registrar movimentações.');
  const cautelaAberta = (vid) => E.cautelas.find((c) => c.viatura_id === vid && !c.retorno_em);
  const pessoaAtiva = (id, papel) => { const p = pessoa(id); if (!p || !p.ativo) falha(`${papel} não encontrado ou inativo`); return p; };
  function posicaoLivre(numero, ignorar = 0) {
    const n = Number(numero);
    if (!Number.isInteger(n) || n < 1 || n > E.total_posicoes) falha(`Posição ${numero} não existe no claviculário`);
    const ocup = E.viaturas.find((v) => v.posicao === n && v.id !== ignorar);
    if (ocup) falha(`Posição ${n} já está ocupada (${ocup.prefixo || ocup.placa})`);
    return n;
  }
  function auditar(acao, detalhe) {
    const s = servicoAtual();
    E.auditoria.unshift({ id: novoId('auditoria'), acao, detalhe: detalhe ? JSON.stringify(detalhe) : null, em: agora(), servico_id: s?.id ?? null });
    if (E.auditoria.length > 3000) E.auditoria.length = 3000;
  }

  function painel() {
    const posicoes = [];
    for (let n = 1; n <= E.total_posicoes; n++) {
      const v = E.viaturas.find((x) => x.posicao === n);
      const c = v && cautelaAberta(v.id);
      const m = c && pessoa(c.motorista_saida_id);
      posicoes.push({
        numero: n,
        viatura_id: v?.id ?? null, prefixo: v?.prefixo, modelo: v?.modelo, placa: v?.placa, setor_origem: v?.setor_origem, tipo: v?.tipo,
        manutencao: v?.manutencao ? 1 : 0, manutencao_motivo: v?.manutencao_motivo, manutencao_desde: v?.manutencao_desde,
        cautela_id: c?.id ?? null, missao: c?.missao, destino: c?.destino, saida_em: c?.saida_em, km_saida: c?.km_saida ?? null,
        motorista_id: m?.id, motorista_nome: m?.nome, motorista_posto: m?.posto, motorista_telefone: m?.telefone,
        status: !v ? 'vaga' : c ? 'em_uso' : v.manutencao ? 'manutencao' : 'disponivel',
      });
    }
    const conta = (s) => posicoes.filter((p) => p.status === s).length;
    return {
      gerado_em: agora(), servico: servicoAtual(),
      totais: { posicoes: posicoes.length, disponiveis: conta('disponivel'), em_uso: conta('em_uso'), manutencao: conta('manutencao'), vagas: conta('vaga') },
      posicoes,
    };
  }

  function linhaCautela(c) {
    const ms = pessoa(c.motorista_saida_id), mr = pessoa(c.motorista_retorno_id);
    const ss = E.servicos.find((s) => s.id === c.servico_saida_id), sr = E.servicos.find((s) => s.id === c.servico_retorno_id);
    return {
      id: c.id, posicao: c.posicao, vtr_prefixo: c.vtr_prefixo, vtr_modelo: c.vtr_modelo, vtr_placa: c.vtr_placa, missao: c.missao, destino: c.destino,
      saida_em: c.saida_em, km_saida: c.km_saida, retorno_em: c.retorno_em, km_retorno: c.km_retorno, encerramento: c.encerramento,
      obs_saida: c.obs_saida, obs_retorno: c.obs_retorno,
      motorista_saida: ms?.nome, motorista_saida_posto: ms?.posto, motorista_saida_ident: ms?.identificacao,
      motorista_retorno: mr?.nome, motorista_retorno_posto: mr?.posto,
      sgt_saida: nomeMil(ss && pessoa(ss.sargento_id)), sgt_retorno: nomeMil(sr && pessoa(sr.sargento_id)) || null,
      assinada_saida: c.ass_saida ? 1 : 0, assinada_retorno: c.ass_retorno ? 1 : 0,
    };
  }
  function listarCautelas(prm) {
    const dia = (d, fim) => new Date(`${d}T${fim ? '23:59:59.999' : '00:00:00'}`).toISOString();
    const de = prm.get('de') && dia(prm.get('de')), ate = prm.get('ate') && dia(prm.get('ate'), true);
    const vid = Number(prm.get('viatura_id')) || 0, sid = Number(prm.get('servico_id')) || 0;
    return E.cautelas.filter((c) => (!de || c.saida_em >= de) && (!ate || c.saida_em <= ate) && (!vid || c.viatura_id === vid)
      && (!sid || c.servico_saida_id === sid || c.servico_retorno_id === sid) && (prm.get('abertas') !== '1' || !c.retorno_em))
      .sort((a, b) => (a.saida_em < b.saida_em ? 1 : -1)).slice(0, 5000).map(linhaCautela);
  }

  // ---------- rotas ----------
  const rotas = [];
  const rota = (metodo, padrao, fn) => {
    const re = new RegExp('^' + padrao.replace(/:id/g, '(\\d+)') + '$');
    rotas.push({ metodo, re, fn });
  };
  const assinaturasPendentes = [];
  const guardarAssinatura = (v) => { if (!v) return null; const id = `a${novoId('assinatura')}`; assinaturasPendentes.push([id, v]); return id; };

  rota('GET', '/api/painel', () => painel());
  rota('GET', '/api/servico/atual', () => {
    const s = servicoAtual();
    return s ? { servico: s, cautelas_abertas: listarCautelas(new URLSearchParams('abertas=1')) } : { servico: null };
  });
  rota('POST', '/api/servico/assumir', (b) => {
    const sgt = pessoaAtiva(b.sargento_id, 'Sargento');
    const ant = E.servicos.find((s) => !s.fim);
    const t = agora();
    if (ant) { ant.fim = t; ant.obs_passagem = nulo(b.obs_passagem); }
    const s = { id: novoId('servico'), sargento_id: sgt.id, inicio: t, fim: null, obs_assuncao: nulo(b.obs_assuncao), obs_passagem: null };
    E.servicos.push(s);
    auditar('servico_assumido', { sargento: nomeMil(sgt), anterior: ant?.id ?? null });
    return { id: s.id, anterior_id: ant?.id ?? null };
  });
  rota('GET', '/api/servicos', () => [...E.servicos].sort((a, b) => (a.inicio < b.inicio ? 1 : -1)).map((s) => ({
    ...s, sargento: nomeMil(pessoa(s.sargento_id)),
    saidas: E.cautelas.filter((c) => c.servico_saida_id === s.id).length, retornos: E.cautelas.filter((c) => c.servico_retorno_id === s.id).length,
  })));

  // Militares
  const ordenaNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  rota('GET', '/api/pessoas', (b, prm) => E.pessoas.filter((p) => prm.get('todas') === '1' || p.ativo).sort(ordenaNome));
  rota('POST', '/api/pessoas', (b) => {
    exigir(b, { nome: 'o nome', identificacao: 'o SARAM/identificação' });
    if (E.pessoas.some((p) => p.identificacao === texto(b.identificacao))) falha('Já existe militar com essa identificação');
    const p = { id: novoId('pessoa'), nome: texto(b.nome), posto: nulo(b.posto), identificacao: texto(b.identificacao), setor: nulo(b.setor), telefone: nulo(b.telefone), ativo: 1 };
    E.pessoas.push(p); auditar('pessoa_criada', { nome: p.nome });
    return p;
  });
  rota('PUT', '/api/pessoas/:id', (b, prm, id) => {
    const p = pessoa(id) || falha('Militar não encontrado');
    exigir(b, { nome: 'o nome', identificacao: 'o SARAM/identificação' });
    if (E.pessoas.some((x) => x.identificacao === texto(b.identificacao) && x.id !== p.id)) falha('Já existe militar com essa identificação');
    Object.assign(p, { nome: texto(b.nome), posto: nulo(b.posto), identificacao: texto(b.identificacao), setor: nulo(b.setor), telefone: nulo(b.telefone), ativo: b.ativo === undefined ? p.ativo : (bool(b.ativo) ? 1 : 0) });
    auditar('pessoa_editada', { id: p.id });
    return p;
  });

  // Posições e viaturas
  rota('PUT', '/api/posicoes', (b) => {
    const total = Number(b.total);
    if (!Number.isInteger(total) || total < 1 || total > 500) falha('Quantidade de posições inválida (1 a 500)');
    const maior = Math.max(0, ...E.viaturas.map((v) => v.posicao || 0));
    if (total < maior) falha(`A posição ${maior} está ocupada; não é possível reduzir para ${total}`);
    E.total_posicoes = total; auditar('posicoes_alteradas', { total });
    return { total };
  });
  rota('GET', '/api/viaturas', (b, prm) => E.viaturas.filter((v) => prm.get('todas') === '1' || (v.ativa && v.no_claviculario))
    .sort((a, b2) => (a.tipo === b2.tipo ? (a.posicao ?? 999) - (b2.posicao ?? 999) : a.tipo === 'fixa' ? -1 : 1)));
  rota('POST', '/api/viaturas', (b) => {
    exigir(b, { modelo: 'o modelo', placa: 'a placa', posicao: 'a posição no claviculário' });
    const placa = placaNorm(b.placa);
    if (E.viaturas.some((v) => v.placa === placa)) falha('Já existe viatura com essa placa');
    const v = { id: novoId('viatura'), prefixo: nulo(b.prefixo), modelo: texto(b.modelo), placa, setor_origem: texto(b.setor_origem) || 'STS', tipo: 'fixa',
      posicao: posicaoLivre(b.posicao), no_claviculario: 1, manutencao: 0, manutencao_motivo: null, manutencao_desde: null, ativa: 1 };
    E.viaturas.push(v); auditar('viatura_fixa_criada', { placa, posicao: v.posicao });
    return v;
  });
  rota('PUT', '/api/viaturas/:id', (b, prm, id) => {
    const v = viatura(id);
    exigir(b, { modelo: 'o modelo', placa: 'a placa' });
    const placa = placaNorm(b.placa);
    if (E.viaturas.some((x) => x.placa === placa && x.id !== v.id)) falha('Já existe viatura com essa placa');
    const ativa = b.ativa === undefined ? v.ativa : (bool(b.ativa) ? 1 : 0);
    let pos = v.posicao;
    if (v.tipo === 'fixa') {
      if (!ativa) { if (cautelaAberta(v.id)) falha('A chave desta viatura está cautelada'); pos = null; }
      else { if (!texto(b.posicao)) falha('Informe a posição no claviculário'); pos = posicaoLivre(b.posicao, v.id); }
    }
    Object.assign(v, { prefixo: nulo(b.prefixo), modelo: texto(b.modelo), placa, setor_origem: texto(b.setor_origem) || v.setor_origem, posicao: pos, ativa });
    auditar('viatura_editada', { id: v.id, placa });
    return v;
  });
  rota('POST', '/api/viaturas/:id/manutencao', (b, prm, id) => {
    exigirServico();
    const v = viatura(id), em = bool(b.em_manutencao);
    if (em) {
      if (cautelaAberta(v.id)) falha('Registre a devolução da chave antes de colocar a viatura em manutenção');
      exigir(b, { motivo: 'o motivo da manutenção' });
      Object.assign(v, { manutencao: 1, manutencao_motivo: texto(b.motivo), manutencao_desde: agora() });
    } else Object.assign(v, { manutencao: 0, manutencao_motivo: null, manutencao_desde: null });
    auditar(em ? 'manutencao_inicio' : 'manutencao_fim', { viatura: v.prefixo || v.placa, motivo: nulo(b.motivo) });
    return v;
  });

  // Temporárias
  rota('POST', '/api/temporarias/entrada', (b) => {
    const s = exigirServico();
    exigir(b, { modelo: 'o modelo', placa: 'a placa', setor_origem: 'o setor de origem', posicao: 'a posição', entregue_por: 'quem entregou a chave' });
    const placa = placaNorm(b.placa);
    let v = E.viaturas.find((x) => x.placa === placa);
    if (v && v.no_claviculario && v.ativa) falha(`Viatura ${placa} já está no claviculário (posição ${v.posicao})`);
    if (v && v.tipo === 'fixa') falha(`A placa ${placa} é de uma viatura fixa desativada; reative-a no cadastro`);
    const pos = posicaoLivre(b.posicao);
    const ass = validarAssinatura(b.assinatura, false);
    if (v) Object.assign(v, { prefixo: nulo(b.prefixo), modelo: texto(b.modelo), setor_origem: texto(b.setor_origem), posicao: pos, no_claviculario: 1, ativa: 1, manutencao: 0, manutencao_motivo: null, manutencao_desde: null });
    else E.viaturas.push(v = { id: novoId('viatura'), prefixo: nulo(b.prefixo), modelo: texto(b.modelo), placa, setor_origem: texto(b.setor_origem), tipo: 'temporaria', posicao: pos, no_claviculario: 1, manutencao: 0, manutencao_motivo: null, manutencao_desde: null, ativa: 1 });
    E.temporarias.push({ id: novoId('temporaria'), viatura_id: v.id, tipo: 'entrada', posicao: pos, pessoa_nome: texto(b.entregue_por), ass: guardarAssinatura(ass), obs: nulo(b.obs), em: agora(), servico_id: s.id });
    auditar('temporaria_entrada', { placa, setor: texto(b.setor_origem), posicao: pos });
    return v;
  });
  rota('POST', '/api/temporarias/:id/saida', (b, prm, id) => {
    const s = exigirServico(), v = viatura(id);
    if (v.tipo !== 'temporaria' || !v.no_claviculario) falha('Esta viatura não é uma temporária no claviculário');
    if (cautelaAberta(v.id)) falha('A chave está cautelada; registre o retorno (ou "não retornou") primeiro');
    exigir(b, { recebido_por: 'quem recebeu a chave' });
    const ass = validarAssinatura(b.assinatura);
    E.temporarias.push({ id: novoId('temporaria'), viatura_id: v.id, tipo: 'saida', posicao: v.posicao, pessoa_nome: texto(b.recebido_por), ass: guardarAssinatura(ass), obs: nulo(b.obs), em: agora(), servico_id: s.id });
    auditar('temporaria_saida', { viatura: v.prefixo || v.placa, posicao: v.posicao });
    Object.assign(v, { posicao: null, no_claviculario: 0, manutencao: 0 });
    return { ok: true };
  });
  rota('GET', '/api/temporarias/registros', () => [...E.temporarias].sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, 500).map((r) => {
    const v = viatura(r.viatura_id), s = E.servicos.find((x) => x.id === r.servico_id);
    return { id: r.id, tipo: r.tipo, posicao: r.posicao, pessoa_nome: r.pessoa_nome, obs: r.obs, em: r.em, assinado: r.ass ? 1 : 0,
      prefixo: v.prefixo, modelo: v.modelo, placa: v.placa, setor_origem: v.setor_origem, sargento: nomeMil(s && pessoa(s.sargento_id)) };
  }));
  rota('GET', '/api/temporarias/registros/:id', async (b, prm, id) => {
    const r = E.temporarias.find((x) => x.id === id) || falha('Registro não encontrado');
    return { ...r, assinatura: r.ass ? await BancoLocal.lerAssinatura(r.ass) : null };
  });

  // Cautelas
  rota('POST', '/api/cautelas/saida', (b) => {
    const s = exigirServico(), v = viatura(b.viatura_id);
    if (!v.ativa || !v.no_claviculario || !v.posicao) falha('Esta viatura não está no claviculário');
    if (v.manutencao) falha(`Viatura ${v.prefixo || v.placa} está em manutenção`);
    if (cautelaAberta(v.id)) falha(`A chave da viatura ${v.prefixo || v.placa} já está cautelada`);
    const mot = pessoaAtiva(b.motorista_id, 'Motorista');
    exigir(b, { missao: 'a missão' });
    const ass = validarAssinatura(b.assinatura), km = inteiro(b.km_saida, 'Odômetro de saída');
    const c = { id: novoId('cautela'), viatura_id: v.id, posicao: v.posicao, vtr_prefixo: v.prefixo, vtr_modelo: v.modelo, vtr_placa: v.placa,
      missao: texto(b.missao), destino: nulo(b.destino), saida_em: agora(), km_saida: km, motorista_saida_id: mot.id, ass_saida: guardarAssinatura(ass),
      obs_saida: nulo(b.obs), servico_saida_id: s.id, retorno_em: null, encerramento: null, km_retorno: null, motorista_retorno_id: null,
      ass_retorno: null, obs_retorno: null, servico_retorno_id: null };
    E.cautelas.push(c);
    auditar('saida_viatura', { viatura: v.prefixo || v.placa, motorista: mot.nome, missao: c.missao });
    return { id: c.id };
  });
  rota('POST', '/api/cautelas/retorno', (b) => {
    const s = exigirServico(), v = viatura(b.viatura_id), c = cautelaAberta(v.id);
    if (!c) falha(`A chave da viatura ${v.prefixo || v.placa} não está cautelada`);
    if (bool(b.nao_retornou)) {
      if (v.tipo !== 'temporaria') falha('Só viaturas temporárias podem ser encerradas sem retorno à STS');
      const t = agora();
      Object.assign(c, { retorno_em: t, encerramento: 'nao_retornou', obs_retorno: nulo(b.obs) || 'Viatura seguiu direto para o setor de origem', servico_retorno_id: s.id });
      E.temporarias.push({ id: novoId('temporaria'), viatura_id: v.id, tipo: 'nao_retornou', posicao: v.posicao, pessoa_nome: nulo(b.informado_por), ass: null, obs: nulo(b.obs), em: t, servico_id: s.id });
      auditar('temporaria_nao_retornou', { viatura: v.prefixo || v.placa, posicao: v.posicao });
      Object.assign(v, { posicao: null, no_claviculario: 0 });
      return { id: c.id, encerramento: c.encerramento };
    }
    const mot = pessoaAtiva(b.motorista_id || c.motorista_saida_id, 'Motorista');
    const ass = validarAssinatura(b.assinatura), km = inteiro(b.km_retorno, 'Odômetro de retorno');
    if (km !== null && c.km_saida !== null && km < c.km_saida) falha(`Odômetro de retorno (${km}) menor que o de saída (${c.km_saida})`);
    Object.assign(c, { retorno_em: agora(), encerramento: 'devolvida', km_retorno: km, motorista_retorno_id: mot.id, ass_retorno: guardarAssinatura(ass), obs_retorno: nulo(b.obs), servico_retorno_id: s.id });
    auditar('retorno_viatura', { viatura: v.prefixo || v.placa, motorista: mot.nome });
    return { id: c.id, encerramento: c.encerramento };
  });
  rota('GET', '/api/cautelas', (b, prm) => listarCautelas(prm));
  rota('GET', '/api/cautelas/:id', async (b, prm, id) => {
    const c = E.cautelas.find((x) => x.id === id) || falha('Cautela não encontrada');
    return { ...c, motorista_saida: nomeMil(pessoa(c.motorista_saida_id)), motorista_retorno: nomeMil(pessoa(c.motorista_retorno_id)),
      assinatura_saida: c.ass_saida ? await BancoLocal.lerAssinatura(c.ass_saida) : null,
      assinatura_retorno: c.ass_retorno ? await BancoLocal.lerAssinatura(c.ass_retorno) : null };
  });
  rota('GET', '/api/auditoria', () => E.auditoria.slice(0, 500).map((a) => {
    const s = E.servicos.find((x) => x.id === a.servico_id);
    return { ...a, sargento: nomeMil(s && pessoa(s.sargento_id)) };
  }));

  // ---------- execução ----------
  let fila = Promise.resolve();
  async function carregar() { E = (await BancoLocal.ler('estado')) || novoEstado(); return E; }

  // Executa uma rota. Escritas são feitas em fila; se der erro, nada é gravado.
  function chamar(metodo, url, corpo) {
    const tarefa = fila.then(async () => {
      await carregar(); // sempre parte do que está gravado (outra janela pode ter alterado)
      const u = new URL(url, 'http://local');
      const r = rotas.find((x) => x.metodo === metodo && x.re.test(u.pathname));
      if (!r) throw new Error('Função não encontrada');
      const id = Number((u.pathname.match(r.re) || [])[1]) || 0;
      if (metodo === 'GET') return r.fn(corpo || {}, u.searchParams, id);
      const copia = JSON.stringify(E);
      assinaturasPendentes.length = 0;
      try {
        const out = await r.fn(corpo || {}, u.searchParams, id);
        for (const [aid, png] of assinaturasPendentes) await BancoLocal.gravarAssinatura(aid, png);
        await BancoLocal.gravar('estado', E);
        Local.aoMudar?.();
        return out;
      } catch (e) { E = JSON.parse(copia); throw e; }
    });
    fila = tarefa.catch(() => {});
    return tarefa;
  }

  async function exportar() {
    await carregar();
    return { formato: 'claviculario-digital-backup', versao: 1, gerado_em: agora(), estado: E, assinaturas: await BancoLocal.todasAssinaturas() };
  }
  async function importar(dados) {
    if (!dados || dados.formato !== 'claviculario-digital-backup' || !dados.estado) throw new Error('Este arquivo não é um backup do Claviculário Digital');
    await BancoLocal.limparTudo();
    for (const [id, png] of Object.entries(dados.assinaturas || {})) await BancoLocal.gravarAssinatura(id, png);
    await BancoLocal.gravar('estado', dados.estado);
    await carregar(); Local.aoMudar?.();
  }
  async function apagarTudo() { await BancoLocal.limparTudo(); await carregar(); Local.aoMudar?.(); }

  return { chamar, carregar, exportar, importar, apagarTudo, aoMudar: null, estado: () => E };
})();
