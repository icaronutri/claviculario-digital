'use strict';
// Testa js/regras.js (o mesmo arquivo usado no navegador) com um armazenamento em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function carregarRegras() {
  const kv = new Map(), ass = new Map();
  const ctx = vm.createContext({
    URL, URLSearchParams, Date, JSON, Math, Number, String, Object, Array, Promise, Error, RegExp, Map, Set,
    BancoLocal: {
      ler: async (k) => structuredClone(kv.get(k)),
      gravar: async (k, v) => { kv.set(k, structuredClone(v)); },
      lerAssinatura: async (id) => ass.get(id),
      gravarAssinatura: async (id, v) => { ass.set(id, v); },
      todasAssinaturas: async () => Object.fromEntries(ass),
      limparTudo: async () => { kv.clear(); ass.clear(); },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'regras.js'), 'utf8'), ctx);
  return vm.runInContext('Local', ctx);
}

const ASS = 'data:image/png;base64,iVBORw0KGgo=';
const L = carregarRegras();
const ok = (m, u, b) => L.chamar(m, u, b);
async function erro(m, u, b) {
  try { await L.chamar(m, u, b); } catch (e) { return e.message; }
  assert.fail(`deveria dar erro: ${m} ${u}`);
}
const pos = async (n) => (await ok('GET', '/api/painel')).posicoes.find((p) => p.numero === n);
const ids = {};

test('começa com 30 posições vagas e sem Sgt de Dia', async () => {
  const p = await ok('GET', '/api/painel');
  assert.equal(p.totais.posicoes, 30);
  assert.equal(p.totais.vagas, 30);
  assert.equal(p.servico, null);
});

test('cadastros: militares e viatura fixa', async () => {
  for (const [k, posto, nome, id] of [['sgt1', '2S', 'Silva', '111'], ['sgt2', '1S', 'Costa', '222'], ['mot1', 'CB', 'Souza', '333'], ['mot2', 'S1', 'Lima', '444']])
    ids[k] = (await ok('POST', '/api/pessoas', { posto, nome, identificacao: id })).id;
  assert.match(await erro('POST', '/api/pessoas', { nome: 'X', identificacao: '111' }), /já existe/i);
  const v = await ok('POST', '/api/viaturas', { prefixo: 'VTR-01', modelo: 'Hilux', placa: 'abc-1d23', posicao: 1 });
  assert.equal(v.placa, 'ABC1D23');
  ids.vtr1 = v.id;
  assert.match(await erro('POST', '/api/viaturas', { modelo: 'X', placa: 'ZZZ9999', posicao: 1 }), /ocupada/);
  assert.equal((await pos(1)).status, 'disponivel');
});

test('sem Sgt de Dia de serviço não registra saída', async () => {
  assert.match(await erro('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'X', assinatura: ASS }), /Sgt de Dia/);
  await ok('POST', '/api/servico/assumir', { sargento_id: ids.sgt1 });
  assert.equal((await ok('GET', '/api/painel')).servico.sargento_nome, 'Silva');
});

test('saída (amarelo), passagem de serviço e devolução por outro motorista', async () => {
  assert.match(await erro('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'HFA' }), /assinatura/i);
  assert.match(await erro('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: ' ', assinatura: ASS }), /missão/);
  await ok('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'Transporte ao HFA', km_saida: 1000, assinatura: ASS });
  const p1 = await pos(1);
  assert.equal(p1.status, 'em_uso');
  assert.equal(p1.motorista_nome, 'Souza');
  assert.match(await erro('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot2, missao: 'Y', assinatura: ASS }), /já está cautelada/);

  await ok('POST', '/api/servico/assumir', { sargento_id: ids.sgt2, obs_passagem: 'VTR-01 em missão' });
  const atual = await ok('GET', '/api/servico/atual');
  assert.equal(atual.servico.sargento_nome, 'Costa');
  assert.equal(atual.cautelas_abertas.length, 1);

  assert.match(await erro('POST', '/api/cautelas/retorno', { viatura_id: ids.vtr1, motorista_id: ids.mot2, km_retorno: 900, assinatura: ASS }), /menor/);
  await ok('POST', '/api/cautelas/retorno', { viatura_id: ids.vtr1, motorista_id: ids.mot2, km_retorno: 1080, assinatura: ASS });
  assert.equal((await pos(1)).status, 'disponivel');

  const [c] = await ok('GET', '/api/cautelas');
  assert.equal(c.motorista_saida, 'Souza');
  assert.equal(c.motorista_retorno, 'Lima');
  assert.equal(c.sgt_saida, '2S Silva');
  assert.equal(c.sgt_retorno, '1S Costa');
  const det = await ok('GET', `/api/cautelas/${c.id}`);
  assert.equal(det.assinatura_saida, ASS);
  assert.equal(det.assinatura_retorno, ASS);
});

test('erro não grava nada pela metade', async () => {
  const antes = (await ok('GET', '/api/cautelas')).length;
  await erro('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: 9999, missao: 'X', assinatura: ASS });
  assert.equal((await ok('GET', '/api/cautelas')).length, antes);
});

test('manutenção deixa vermelho e impede a saída', async () => {
  await ok('POST', `/api/viaturas/${ids.vtr1}/manutencao`, { em_manutencao: true, motivo: 'Pneu' });
  assert.equal((await pos(1)).status, 'manutencao');
  assert.match(await erro('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'X', assinatura: ASS }), /manutenção/);
  await ok('POST', `/api/viaturas/${ids.vtr1}/manutencao`, { em_manutencao: false });
  assert.equal((await pos(1)).status, 'disponivel');
});

test('temporária do Rancho: posição vaga, não retornou e devolução ao setor', async () => {
  assert.match(await erro('POST', '/api/temporarias/entrada', { modelo: 'Sprinter', placa: 'RAN0001', setor_origem: 'Rancho', posicao: 1, entregue_por: 'Sd Pereira' }), /ocupada/);
  const t = await ok('POST', '/api/temporarias/entrada', { prefixo: 'RAN-03', modelo: 'Sprinter', placa: 'RAN0001', setor_origem: 'Rancho', posicao: 20, entregue_por: 'Sd Pereira' });
  assert.equal((await pos(20)).tipo, 'temporaria');

  await ok('POST', '/api/cautelas/saida', { viatura_id: t.id, motorista_id: ids.mot1, missao: 'Gêneros', assinatura: ASS });
  assert.match(await erro('POST', '/api/cautelas/retorno', { viatura_id: ids.vtr1, nao_retornou: true }), /não está cautelada/);
  const r = await ok('POST', '/api/cautelas/retorno', { viatura_id: t.id, nao_retornou: true });
  assert.equal(r.encerramento, 'nao_retornou');
  assert.equal((await pos(20)).status, 'vaga');

  const t2 = await ok('POST', '/api/temporarias/entrada', { modelo: 'Sprinter', placa: 'RAN-0001', setor_origem: 'Rancho', posicao: 22, entregue_por: 'Sd Pereira' });
  assert.equal(t2.id, t.id, 'reaproveita o cadastro da mesma placa');
  await ok('POST', `/api/temporarias/${t.id}/saida`, { recebido_por: 'CB Rocha', assinatura: ASS });
  assert.equal((await pos(22)).status, 'vaga');
  assert.deepEqual(Array.from(await ok('GET', '/api/temporarias/registros'), (x) => x.tipo).sort(), ['entrada', 'entrada', 'nao_retornou', 'saida']);
});

test('posições: aumenta e não reduz abaixo de uma ocupada', async () => {
  assert.match(await erro('PUT', '/api/posicoes', { total: 0 }), /inválida/);
  await ok('PUT', '/api/posicoes', { total: 40 });
  assert.equal((await ok('GET', '/api/painel')).totais.posicoes, 40);
});

test('backup: exporta e restaura tudo, inclusive assinaturas', async () => {
  const bk = await L.exportar();
  assert.equal(bk.formato, 'claviculario-digital-backup');
  assert.ok(Object.keys(bk.assinaturas).length >= 4);
  await L.apagarTudo();
  assert.equal((await ok('GET', '/api/cautelas')).length, 0);
  await L.importar(JSON.parse(JSON.stringify(bk)));
  assert.equal((await ok('GET', '/api/cautelas')).length, bk.estado.cautelas.length);
  await assert.rejects(L.importar({ qualquer: 1 }), /não é um backup/);
});
