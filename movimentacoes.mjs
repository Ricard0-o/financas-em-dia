import { createHash } from 'node:crypto';
import { transacao } from './banco.mjs';
import { data, exigir, hoje, inteiro, texto, validarBanco } from './validacao.mjs';

export const tiposEditaveis = ['despesa', 'renda', 'transferencia'];
const tiposConta = ['conta', 'reserva', 'investimento'];
const limiteCentavos = 9_000_000_000_000;
const tabelasComCategoria = ['lancamentos', 'compromissos', 'itens_cartao'];
const categoriaEmUso = tabelasComCategoria.map(tabela =>
  `EXISTS(SELECT 1 FROM ${tabela} WHERE usuario=c.usuario AND categoria=c.id)`).join(' OR ');

export function contaDoUsuario(banco, usuario, id, tipo) {
  const conta = banco.prepare('SELECT id,tipo,nome,inicio FROM contas WHERE usuario=? AND id=?')
    .get(usuario, inteiro(id, 'conta'));
  exigir(conta, 'Conta não encontrada.', 404);
  exigir(!tipo || conta.tipo === tipo, 'Selecione uma conta disponível para esta operação.');
  return conta;
}

function dadosDaConta(banco, usuario, id) {
  const conta = banco.prepare(`
    SELECT c.id,c.nome,c.tipo,c.inicio,c.saldo_inicial,c.banco,
      (SELECT MIN(l.data) FROM lancamentos l
       WHERE l.usuario=c.usuario AND (l.origem=c.id OR l.destino=c.id)) AS primeira_movimentacao,
      EXISTS(SELECT 1 FROM compromissos p WHERE p.usuario=c.usuario AND p.conta=c.id) AS tem_compromissos
    FROM contas c WHERE c.usuario=? AND c.id=?
  `).get(usuario, id);
  exigir(conta, 'Conta não encontrada.', 404);
  return conta;
}

function salvarConta(banco, usuario, dados, id) {
  const atual = id ? dadosDaConta(banco, usuario, id) : null;
  const nome = texto(dados.nome, 'nome');
  const instituicao = validarBanco(dados.banco) ?? atual?.banco ?? null;
  const inicio = data(dados.inicio);
  const tipo = dados.tipo ?? atual?.tipo;
  exigir(inicio <= hoje(), 'Informe uma data de abertura até hoje.');
  exigir(tiposConta.includes(tipo), 'Tipo de conta inválido.');
  const saldo = inteiro(dados.saldo_inicial, 'saldo inicial', -limiteCentavos, limiteCentavos);
  if (atual) {
    exigir(tipo === atual.tipo || (!atual.primeira_movimentacao && !atual.tem_compromissos),
      'O tipo pode ser alterado apenas em contas sem movimentações ou compromissos vinculados.', 409);
    exigir(inicio === atual.inicio || !atual.primeira_movimentacao || inicio <= atual.primeira_movimentacao,
      'A data de abertura deve ser igual ou anterior à primeira movimentação da conta.');
  }
  exigir(!banco.prepare('SELECT 1 FROM contas WHERE usuario=? AND tipo=? AND nome=? AND id<>?')
    .get(usuario, tipo, nome, id ?? 0), 'Já existe um cadastro com esse nome para esse tipo de conta.', 409);
  if (atual) {
    banco.prepare('UPDATE contas SET nome=?,tipo=?,saldo_inicial=?,inicio=?,banco=? WHERE usuario=? AND id=?')
      .run(nome, tipo, saldo, inicio, instituicao, usuario, id);
    if (atual.tipo === 'conta' && tipo !== 'conta') {
      banco.prepare('DELETE FROM configuracao WHERE chave=? AND valor=?').run(`painel.conta:${usuario}`, String(id));
    }
    return { id };
  }
  return { id: banco.prepare('INSERT INTO contas(usuario,nome,tipo,saldo_inicial,inicio,banco) VALUES (?,?,?,?,?,?)')
    .run(usuario, nome, tipo, saldo, inicio, instituicao).lastInsertRowid };
}

export function categoriaDoUsuario(banco, usuario, id) {
  if (id == null) return null;
  const categoria = banco.prepare('SELECT id FROM categorias WHERE usuario=? AND id=?')
    .get(usuario, inteiro(id, 'categoria'));
  exigir(categoria, 'Categoria não encontrada.', 404);
  return categoria.id;
}

export function inserirLancamento(banco, usuario, movimento) {
  return banco.prepare(`
    INSERT INTO lancamentos(usuario,data,tipo,descricao,valor,origem,destino,categoria,referencia)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(usuario, movimento.data, movimento.tipo, movimento.descricao, movimento.valor, movimento.origem ?? null,
    movimento.destino ?? null, movimento.categoria ?? null, movimento.referencia ?? null).lastInsertRowid;
}

function validarMovimento(banco, usuario, dados) {
  const dia = data(dados.data);
  exigir(dia <= hoje(), 'Use uma data até hoje para uma movimentação realizada.');
  exigir(tiposEditaveis.includes(dados.tipo), 'Tipo de lançamento inválido.');
  const valor = inteiro(dados.valor, 'valor');
  const descricao = texto(dados.descricao, 'descrição', 240);
  const debito = dados.tipo !== 'renda';
  const credito = dados.tipo !== 'despesa';
  const tipoConta = dados.tipo === 'transferencia' ? undefined : 'conta';
  const origem = debito ? contaDoUsuario(banco, usuario, dados.origem, tipoConta) : null;
  const destino = credito ? contaDoUsuario(banco, usuario, dados.destino, tipoConta) : null;
  exigir(!origem || !destino || origem.id !== destino.id, 'Escolha duas contas diferentes.');
  exigir(!origem || dia >= origem.inicio, `A conta ${origem?.nome} precisa estar aberta nessa data.`);
  exigir(!destino || dia >= destino.inicio, `A conta ${destino?.nome} precisa estar aberta nessa data.`);
  const categoria = dados.tipo === 'despesa' ? categoriaDoUsuario(banco, usuario, inteiro(dados.categoria, 'categoria')) : null;
  return { data: dia, tipo: dados.tipo, descricao, valor, origem: origem?.id, destino: destino?.id, categoria };
}

export function operacaoUnica(banco, usuario, caminho, dados, executar) {
  const chave = texto(dados.chave, 'identificador da operação', 100);
  const entrada = createHash('sha256').update(JSON.stringify([caminho, dados])).digest('hex');
  return transacao(banco, () => {
    const existente = banco.prepare('SELECT entrada,resposta FROM operacoes WHERE usuario=? AND chave=?').get(usuario, chave);
    if (existente) {
      exigir(existente.entrada === entrada, 'Esta operação já foi registrada com outros dados.', 409);
      return JSON.parse(existente.resposta);
    }
    const resultado = executar();
    banco.prepare('INSERT INTO operacoes VALUES (?,?,?,?)').run(usuario, chave, entrada, JSON.stringify(resultado));
    return resultado;
  });
}

export function contasComSaldo(banco, usuario, ate = hoje()) {
  return banco.prepare(`
    WITH pontas AS (
      SELECT destino AS id, valor FROM lancamentos WHERE usuario=? AND data<=? AND destino IS NOT NULL
      UNION ALL
      SELECT origem AS id, -valor FROM lancamentos WHERE usuario=? AND data<=? AND origem IS NOT NULL
    ), saldos AS (
      SELECT id, SUM(valor) AS saldo FROM pontas GROUP BY id
    )
    SELECT c.id,c.nome,c.tipo,c.inicio,c.saldo_inicial,c.banco,
      CASE WHEN c.inicio<=? THEN c.saldo_inicial ELSE 0 END + COALESCE(s.saldo,0) AS saldo
    FROM contas c LEFT JOIN saldos s ON s.id=c.id
    WHERE c.usuario=? ORDER BY c.tipo,c.nome
  `).all(usuario, ate, usuario, ate, ate, usuario);
}

export function listarCategorias(banco, usuario) {
  return banco.prepare(`
    SELECT id,nome,(${categoriaEmUso}) AS em_uso FROM categorias c
    WHERE usuario=? ORDER BY nome COLLATE NOCASE
  `).all(usuario);
}

function nomeDisponivel(banco, usuario, nome, id = 0) {
  exigir(!banco.prepare('SELECT 1 FROM categorias WHERE usuario=? AND nome=? COLLATE NOCASE AND id<>?').get(usuario, nome, id),
    'Já existe uma categoria com esse nome.', 409);
}

function excluirCategoria(banco, usuario, id, substituta) {
  const { em_uso: emUso } = banco.prepare(`
    SELECT (${categoriaEmUso}) AS em_uso FROM categorias c WHERE usuario=? AND id=?
  `).get(usuario, id);
  if (emUso) {
    exigir(substituta != null && substituta !== id, 'Selecione outra categoria para receber os registros vinculados.', 409);
    const destino = categoriaDoUsuario(banco, usuario, substituta);
    for (const tabela of tabelasComCategoria) {
      banco.prepare(`UPDATE ${tabela} SET categoria=? WHERE usuario=? AND categoria=?`).run(destino, usuario, id);
    }
  }
  banco.prepare('DELETE FROM categorias WHERE usuario=? AND id=?').run(usuario, id);
}

export function listarLancamentos(banco, usuario, filtros) {
  const condicoes = ['l.usuario=?'];
  const argumentos = [usuario];
  for (const [chave, operador] of [['inicio', '>='], ['fim', '<=']]) {
    if (!filtros.get(chave)) continue;
    condicoes.push(`l.data${operador}?`);
    argumentos.push(data(filtros.get(chave)));
  }
  if (filtros.get('conta')) {
    const id = contaDoUsuario(banco, usuario, Number(filtros.get('conta'))).id;
    condicoes.push('(l.origem=? OR l.destino=?)');
    argumentos.push(id, id);
  }
  if (filtros.get('categoria')) {
    const id = categoriaDoUsuario(banco, usuario, Number(filtros.get('categoria')));
    condicoes.push(`(l.categoria=? OR (l.tipo='fatura' AND EXISTS (
      SELECT 1 FROM itens_cartao i WHERE i.usuario=l.usuario AND i.fatura=l.referencia AND i.categoria=?
    )))`);
    argumentos.push(id, id);
  }
  if (filtros.get('tipo')) {
    condicoes.push('l.tipo=?');
    argumentos.push(filtros.get('tipo'));
  }
  return banco.prepare(`
    SELECT l.id,l.data,l.tipo,l.descricao,l.valor,l.origem,l.destino,l.categoria,l.referencia,
      EXISTS(SELECT 1 FROM viradas v WHERE v.usuario=l.usuario AND v.salario=l.id) AS virada,
      EXISTS(SELECT 1 FROM ocorrencias oc JOIN compromissos p ON p.usuario=oc.usuario AND p.id=oc.compromisso
        WHERE oc.usuario=l.usuario AND oc.pagamento=l.id AND p.quantidade=1) AS avulso,
      o.nome AS nome_origem,d.nome AS nome_destino,c.nome AS nome_categoria
    FROM lancamentos l
    LEFT JOIN contas o ON o.id=l.origem AND o.usuario=l.usuario
    LEFT JOIN contas d ON d.id=l.destino AND d.usuario=l.usuario
    LEFT JOIN categorias c ON c.id=l.categoria AND c.usuario=l.usuario
    WHERE ${condicoes.join(' AND ')} ORDER BY l.data DESC,l.id DESC
  `).all(...argumentos);
}

export function movimentacoes(banco, usuario, metodo, caminho, dados, filtros) {
  if (metodo === 'GET' && caminho === '/api/base') {
    return { hoje: hoje(), contas: contasComSaldo(banco, usuario), categorias: listarCategorias(banco, usuario) };
  }
  if (metodo === 'GET' && caminho === '/api/lancamentos') {
    return listarLancamentos(banco, usuario, filtros);
  }
  const rotaConta = caminho.match(/^\/api\/contas\/(\d+)$/);
  if (rotaConta) {
    const id = inteiro(Number(rotaConta[1]), 'conta');
    if (metodo === 'GET') return dadosDaConta(banco, usuario, id);
    if (metodo === 'POST') return operacaoUnica(banco, usuario, caminho, dados, () => salvarConta(banco, usuario, dados, id));
  }
  if (metodo !== 'POST') return undefined;
  if (caminho === '/api/contas') {
    return operacaoUnica(banco, usuario, caminho, dados, () => salvarConta(banco, usuario, dados));
  }
  if (caminho === '/api/categorias') {
    const nome = texto(dados.nome, 'nome');
    return operacaoUnica(banco, usuario, caminho, dados, () => {
      nomeDisponivel(banco, usuario, nome);
      return { id: banco.prepare('INSERT INTO categorias(usuario,nome) VALUES (?,?)').run(usuario, nome).lastInsertRowid };
    });
  }
  const rotaCategoria = caminho.match(/^\/api\/categorias\/(\d+)(\/excluir)?$/);
  if (rotaCategoria) {
    return operacaoUnica(banco, usuario, caminho, dados, () => {
      const id = categoriaDoUsuario(banco, usuario, Number(rotaCategoria[1]));
      if (rotaCategoria[2]) {
        excluirCategoria(banco, usuario, id, dados.substituta);
      } else {
        const nome = texto(dados.nome, 'nome');
        nomeDisponivel(banco, usuario, nome, id);
        banco.prepare('UPDATE categorias SET nome=? WHERE usuario=? AND id=?').run(nome, usuario, id);
      }
      return { id };
    });
  }
  if (caminho === '/api/lancamentos') {
    return operacaoUnica(banco, usuario, caminho, dados, () => {
      const movimento = validarMovimento(banco, usuario, dados);
      return { id: inserirLancamento(banco, usuario, movimento) };
    });
  }
  const idNaRota = caminho.match(/^\/api\/lancamentos\/(\d+)(\/excluir)?$/);
  if (!idNaRota) return undefined;
  const id = inteiro(Number(idNaRota[1]), 'lançamento');
  return operacaoUnica(banco, usuario, caminho, dados, () => {
    const existente = banco.prepare('SELECT tipo FROM lancamentos WHERE usuario=? AND id=?').get(usuario, id);
    exigir(existente, 'Lançamento não encontrado.', 404);
    exigir(tiposEditaveis.includes(existente.tipo), 'Abra a tela de origem para corrigir este lançamento.', 409);
    if (idNaRota[2]) {
      banco.prepare('DELETE FROM lancamentos WHERE usuario=? AND id=?').run(usuario, id);
    } else {
      const movimento = validarMovimento(banco, usuario, { ...dados, tipo: existente.tipo });
      banco.prepare('UPDATE lancamentos SET data=?,descricao=?,valor=?,origem=?,destino=?,categoria=? WHERE usuario=? AND id=?')
        .run(movimento.data, movimento.descricao, movimento.valor, movimento.origem ?? null, movimento.destino ?? null,
          movimento.categoria, usuario, id);
    }
    return { id };
  });
}
