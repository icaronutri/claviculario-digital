'use strict';
// Dados de exemplo para testar o sistema (usado por INICIAR-TESTE.bat / npm run teste).
const { hashSenha } = require('./db');

function popularExemplo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM viaturas').get().n) return false;
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  db.exec('BEGIN');
  try {
    const viaturas = [
      ['VTR-01', 'Toyota Hilux', 'QWE1A23'], ['VTR-02', 'Toyota Hilux', 'QWE1A24'], ['VTR-03', 'Mitsubishi L200', 'RTY2B11'],
      ['VTR-04', 'Renault Master', 'UIO3C45'], ['VTR-05', 'Fiat Ducato', 'PAS4D67'], ['VTR-06', 'VW Gol', 'DFG5E89'],
      ['VTR-07', 'Chevrolet S10', 'HJK6F01'], ['VTR-08', 'Marcopolo Volare', 'LZX7G23'], ['VTR-09', 'Fiat Strada', 'CVB8H45'],
      ['VTR-10', 'Iveco Daily', 'NMQ9I67'], ['VTR-11', 'Ford Ranger', 'WER0J89'], ['VTR-12', 'Toyota Corolla', 'TYU1K01'],
    ];
    viaturas.forEach(([pref, mod, placa], i) =>
      run("INSERT INTO viaturas (prefixo, modelo, placa, setor_origem, tipo, posicao) VALUES (?,?,?,'STS','fixa',?)", pref, mod, placa, i + 1));
    const militares = [
      ['2S', 'Silva', '1001', 'STS', '(35) 99999-1001'], ['1S', 'Costa', '1002', 'STS', ''], ['3S', 'Alves', '1003', 'STS', ''],
      ['CB', 'Souza', '2001', 'STS', '(35) 99999-2001'], ['S1', 'Lima', '2002', 'STS', ''], ['S2', 'Ramos', '2003', 'STS', ''],
      ['CB', 'Rocha', '3001', 'Rancho', ''],
    ];
    for (const [posto, nome, id, setor, tel] of militares)
      run('INSERT INTO pessoas (posto, nome, identificacao, setor, telefone) VALUES (?,?,?,?,?)', posto, nome, id, setor, tel || null);
    const pid = (n) => db.prepare('SELECT id FROM pessoas WHERE nome = ?').get(n).id;
    const vid = (p) => db.prepare('SELECT id, posicao, prefixo, modelo, placa FROM viaturas WHERE prefixo = ?').get(p);
    const t = (minAtras) => new Date(Date.now() - minAtras * 60000).toISOString();

    // usuário do computador do Sgt de Dia
    run("INSERT OR IGNORE INTO usuarios (login, nome, senha_hash, perfil) VALUES ('sgtdia', 'Computador do Sgt de Dia', ?, 'operador')", hashSenha('sgtdia123'));
    const uid = db.prepare("SELECT id FROM usuarios WHERE login = 'admin'").get().id;

    // serviço de ontem (encerrado) e serviço atual
    const ontem = run('INSERT INTO servicos (sargento_id, usuario_id, inicio, fim, obs_passagem) VALUES (?,?,?,?,?)',
      pid('Costa'), uid, t(24 * 60 + 40), t(40), 'Sem alterações').lastInsertRowid;
    const hoje = run('INSERT INTO servicos (sargento_id, usuario_id, inicio) VALUES (?,?,?)', pid('Silva'), uid, t(40)).lastInsertRowid;

    // uma cautela já encerrada (histórico)
    const v6 = vid('VTR-06');
    run(`INSERT INTO cautelas (viatura_id, posicao, vtr_prefixo, vtr_modelo, vtr_placa, missao, saida_em, km_saida, motorista_saida_id,
         servico_saida_id, operador_saida_id, retorno_em, encerramento, km_retorno, motorista_retorno_id, servico_retorno_id, operador_retorno_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'devolvida',?,?,?,?)`,
      v6.id, v6.posicao, v6.prefixo, v6.modelo, v6.placa, 'Correio no centro', t(20 * 60), 30500, pid('Lima'), ontem, uid, t(18 * 60), 30542, pid('Lima'), ontem, uid);

    // viaturas em uso agora
    for (const [pref, mot, missao, min] of [['VTR-03', 'Souza', 'Transporte de material ao Hangar 2', 95], ['VTR-08', 'Ramos', 'Transporte de cadetes', 30]]) {
      const v = vid(pref);
      run(`INSERT INTO cautelas (viatura_id, posicao, vtr_prefixo, vtr_modelo, vtr_placa, missao, saida_em, motorista_saida_id, servico_saida_id, operador_saida_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`, v.id, v.posicao, v.prefixo, v.modelo, v.placa, missao, t(min), pid(mot), min > 40 ? ontem : hoje, uid);
    }
    // manutenção
    run("UPDATE viaturas SET manutencao = 1, manutencao_motivo = 'Revisão 50.000 km', manutencao_desde = ? WHERE prefixo = 'VTR-05'", t(3 * 60));
    // temporária do Rancho na posição 20
    const tmp = run("INSERT INTO viaturas (prefixo, modelo, placa, setor_origem, tipo, posicao) VALUES ('RAN-03','Fiat Fiorino','RAN3A33','Rancho','temporaria',20)").lastInsertRowid;
    run("INSERT INTO registros_temporarias (viatura_id, tipo, posicao, pessoa_nome, em, servico_id, operador_id) VALUES (?, 'entrada', 20, 'CB Rocha', ?, ?, ?)", tmp, t(25), hoje, uid);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

module.exports = { popularExemplo };
