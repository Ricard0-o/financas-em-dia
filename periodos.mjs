import { createHash } from 'node:crypto';
import { data, exigir, hoje, inteiro, somarDias, texto } from './validacao.mjs';
import { contaDoUsuario, inserirLancamento, operacaoUnica } from './movimentacoes.mjs';

export function listarPeriodos(banco, usuario) {
  const viradas = banco.prepare('SELECT inicio,salario FROM viradas WHERE usuario=? ORDER BY inicio').all(usuario);
  const primeiro = banco.prepare('SELECT MIN(data) AS inicio FROM lancamentos WHERE usuario=?').get(usuario).inicio;
  if (!viradas.length) return [{ id: 'inicial', inicio: primeiro ?? hoje(), fim: null, nome: 'Período inicial' }];
  const periodos = viradas.map((virada, indice) => ({
    id: virada.inicio,
    inicio: virada.inicio,
    fim: viradas[indice + 1] ? somarDias(viradas[indice + 1].inicio, -1) : null,
    nome: 'Período salarial'
  }));
  if (primeiro < viradas[0].inicio) {
    periodos.unshift({ id: 'anterior', inicio: primeiro, fim: somarDias(viradas[0].inicio, -1), nome: 'Antes do primeiro salário' });
  }
  return periodos;
}

function dadosSalario(banco, usuario, dados) {
  const dia = data(dados.data);
  const conta = contaDoUsuario(banco, usuario, dados.destino, 'conta');
  exigir(dia >= conta.inicio && dia <= hoje(), 'Use uma data entre a abertura da conta e hoje.');
  return { data: dia, destino: conta.id, descricao: texto(dados.descricao || 'Salário', 'descrição', 240), valor: inteiro(dados.valor, 'valor') };
}

function previaSalario(banco, usuario, salario) {
  const viradas = banco.prepare('SELECT inicio FROM viradas WHERE usuario=? ORDER BY inicio').all(usuario);
  const mesmaData = viradas.some(virada => virada.inicio === salario.data);
  const anterior = viradas.findLast(virada => virada.inicio < salario.data)?.inicio ?? null;
  const proxima = viradas.find(virada => virada.inicio > salario.data)?.inicio ?? null;
  const jaRegistrados = banco.prepare("SELECT COUNT(*) AS total FROM lancamentos WHERE usuario=? AND tipo='salario' AND data=?")
    .get(usuario, salario.data).total;
  const maisAntigo = banco.prepare('SELECT MIN(data) AS inicio FROM lancamentos WHERE usuario=? AND data<?')
    .get(usuario, salario.data).inicio;
  const previa = {
    mesma_data: mesmaData, ja_registrados: jaRegistrados,
    anterior_inicio: anterior ?? maisAntigo,
    anterior_fim: !mesmaData && (anterior || maisAntigo) ? somarDias(salario.data, -1) : null,
    novo_inicio: salario.data, novo_fim: proxima ? somarDias(proxima, -1) : null
  };
  const revisao = createHash('sha256').update(JSON.stringify([usuario, salario, previa])).digest('hex');
  return { ...previa, revisao };
}

export function periodos(banco, usuario, metodo, caminho, dados) {
  if (metodo === 'GET' && caminho === '/api/periodos') return listarPeriodos(banco, usuario);
  if (metodo !== 'POST') return undefined;
  if (caminho === '/api/salarios/previa') {
    return previaSalario(banco, usuario, dadosSalario(banco, usuario, dados));
  }
  if (caminho === '/api/salarios') {
    return operacaoUnica(banco, usuario, caminho, dados, () => {
      const salario = dadosSalario(banco, usuario, dados);
      const previa = previaSalario(banco, usuario, salario);
      exigir(dados.revisao === previa.revisao, 'A virada mudou. Confira uma nova prévia.', 409);
      exigir(!previa.ja_registrados || dados.confirmar_segundo === true, 'Confirme o salário adicional para essa data.', 409);
      const id = inserirLancamento(banco, usuario, { ...salario, tipo: 'salario' });
      if (!previa.mesma_data) banco.prepare('INSERT INTO viradas VALUES (?,?,?)').run(usuario, salario.data, id);
      return { id };
    });
  }
  const rota = caminho.match(/^\/api\/salarios\/(\d+)$/);
  if (!rota) return undefined;
  const id = inteiro(Number(rota[1]), 'salário');
  return operacaoUnica(banco, usuario, caminho, dados, () => {
    const existente = banco.prepare(`
      SELECT l.data, v.inicio AS virada FROM lancamentos l
      LEFT JOIN viradas v ON v.usuario=l.usuario AND v.salario=l.id
      WHERE l.usuario=? AND l.id=? AND l.tipo='salario'
    `).get(usuario, id);
    exigir(existente, 'Salário não encontrado.', 404);
    const salario = dadosSalario(banco, usuario, dados);
    exigir(!existente.virada || salario.data === existente.data, 'A data desse salário é vinculada à abertura do período.');
    banco.prepare('UPDATE lancamentos SET data=?,destino=?,descricao=?,valor=? WHERE usuario=? AND id=?')
      .run(salario.data, salario.destino, salario.descricao, salario.valor, usuario, id);
    return { id };
  });
}
