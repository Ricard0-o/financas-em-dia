import { createHash } from 'node:crypto';
import { transacao } from './banco.mjs';
import { data, diaNoMes, exigir, hoje, inteiro, somarDias, somarMeses, texto, validarBanco } from './validacao.mjs';
import { categoriaDoUsuario, contaDoUsuario, inserirLancamento, operacaoUnica } from './movimentacoes.mjs';

function cartaoDoUsuario(banco, usuario, cartao, exigirAtivo = false) {
  const registro = banco.prepare(`
    SELECT c.*, EXISTS(SELECT 1 FROM cartoes_arquivados a WHERE a.usuario=c.usuario AND a.cartao=c.id) AS arquivado
    FROM cartoes c WHERE c.usuario=? AND c.id=?
  `).get(usuario, inteiro(cartao, 'cartão'));
  exigir(registro, 'Cartão não encontrado.', 404);
  exigir(!exigirAtivo || !registro.arquivado, 'Este cartão está arquivado.', 409);
  return registro;
}

function salvarCartao(banco, usuario, dados, id) {
  const atual = id ? cartaoDoUsuario(banco, usuario, id, true) : null;
  const nome = texto(dados.nome, 'nome');
  const instituicao = validarBanco(dados.banco) ?? atual?.banco ?? null;
  const limite = inteiro(dados.limite, 'limite');
  const fechamento = inteiro(dados.fechamento, 'dia do fechamento', 1, 31);
  const vencimento = inteiro(dados.vencimento, 'dia do vencimento', 1, 31);
  exigir(!banco.prepare('SELECT 1 FROM cartoes WHERE usuario=? AND nome=? AND id<>?').get(usuario, nome, id ?? 0),
    'Já existe um cartão cadastrado com esse nome.', 409);
  if (id) {
    banco.prepare('UPDATE cartoes SET nome=?,limite=?,fechamento=?,vencimento=?,banco=? WHERE usuario=? AND id=?')
      .run(nome, limite, fechamento, vencimento, instituicao, usuario, id);
    return { id };
  }
  return { id: banco.prepare('INSERT INTO cartoes(usuario,nome,limite,fechamento,vencimento,banco) VALUES (?,?,?,?,?,?)')
    .run(usuario, nome, limite, fechamento, vencimento, instituicao).lastInsertRowid };
}

function excluirCartao(banco, usuario, id) {
  cartaoDoUsuario(banco, usuario, id, true);
  exigir(!banco.prepare("SELECT 1 FROM compromissos WHERE usuario=? AND cartao=? AND tipo='mensal' AND ultima_data IS NULL")
    .get(usuario, id), 'Encerre as recorrências ativas deste cartão em Compromissos antes de removê-lo.', 409);
  const vinculos = banco.prepare(`
    SELECT EXISTS(SELECT 1 FROM faturas WHERE usuario=? AND cartao=?)
      OR EXISTS(SELECT 1 FROM compromissos WHERE usuario=? AND cartao=?) AS tem_vinculos
  `).get(usuario, id, usuario, id);
  if (vinculos.tem_vinculos) {
    banco.prepare('INSERT INTO cartoes_arquivados(usuario,cartao) VALUES (?,?)').run(usuario, id);
  } else {
    banco.prepare('DELETE FROM cartoes WHERE usuario=? AND id=?').run(usuario, id);
  }
  return { id, arquivado: Boolean(vinculos.tem_vinculos) };
}

function divisao(valor, total, indice) {
  return Math.floor(valor / total) + Number(indice < valor % total);
}

function fechamentoDaCompra(dia, cartao) {
  const mes = dia.slice(0, 7);
  return dia > diaNoMes(mes, cartao.fechamento) ? somarMeses(mes, 1) : mes;
}

function datasFatura(cartao, mes) {
  const fechamento = diaNoMes(mes, cartao.fechamento);
  const venceEsteMes = diaNoMes(mes, cartao.vencimento);
  const vencimento = venceEsteMes > fechamento ? venceEsteMes : diaNoMes(somarMeses(mes, 1), cartao.vencimento);
  return { fechamento, vencimento };
}

function criarItem(banco, usuario, cartao, mes, item) {
  const { fechamento, vencimento } = datasFatura(cartao, mes);
  banco.prepare('INSERT INTO faturas(usuario,cartao,fechamento,vencimento) VALUES (?,?,?,?) ON CONFLICT(usuario,cartao,fechamento) DO NOTHING')
    .run(usuario, cartao.id, fechamento, vencimento);
  const fatura = banco.prepare('SELECT id,pagamento FROM faturas WHERE usuario=? AND cartao=? AND fechamento=?')
    .get(usuario, cartao.id, fechamento);
  exigir(!fatura.pagamento, `A fatura com vencimento em ${vencimento} já foi quitada.`, 409);
  banco.prepare(`
    INSERT INTO itens_cartao(usuario,fatura,data,descricao,valor,categoria,numero,parcelas,ocorrencia,compra)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(usuario, fatura.id, item.data, item.descricao, item.valor, item.categoria, item.numero ?? null,
    item.parcelas ?? null, item.ocorrencia ?? null, item.compra ?? null);
}

function valorPlano(banco, usuario, plano, dia, valor, parcela = null) {
  const acrescentar = banco.prepare(`
    INSERT INTO ocorrencias(usuario,compromisso,vencimento,previsto,parcela) VALUES (?,?,?,?,?)
    ON CONFLICT(usuario,compromisso,vencimento) DO NOTHING
  `).run(usuario, plano.id, dia, valor, parcela);
  if (!acrescentar.changes || !plano.cartao) return;
  const cartao = cartaoDoUsuario(banco, usuario, plano.cartao);
  criarItem(banco, usuario, cartao, fechamentoDaCompra(dia, cartao), {
    data: dia, descricao: plano.nome, valor, categoria: plano.categoria, ocorrencia: acrescentar.lastInsertRowid
  });
}

function gerarMensal(banco, usuario, plano, limite) {
  const ultimo = banco.prepare('SELECT MAX(vencimento) AS data FROM ocorrencias WHERE usuario=? AND compromisso=?')
    .get(usuario, plano.id).data;
  const dia = Number(plano.inicio.slice(8));
  const fim = plano.ultima_data && plano.ultima_data < limite ? plano.ultima_data : limite;
  for (let mes = ultimo ? somarMeses(ultimo.slice(0, 7), 1) : plano.inicio.slice(0, 7); mes <= fim.slice(0, 7); mes = somarMeses(mes, 1)) {
    const vencimento = diaNoMes(mes, dia);
    if (vencimento <= fim) valorPlano(banco, usuario, plano, vencimento, plano.valor);
  }
}

export function atualizarRecorrencias(banco, usuario, dia = hoje()) {
  const planos = banco.prepare("SELECT * FROM compromissos WHERE usuario=? AND tipo='mensal'").all(usuario);
  if (!planos.length) return;
  transacao(banco, () => {
    for (const plano of planos) gerarMensal(banco, usuario, plano, somarDias(dia, plano.cartao ? 0 : 45));
  });
}

function totalFatura(banco, usuario, id) {
  return banco.prepare('SELECT COALESCE(SUM(valor),0) AS valor FROM itens_cartao WHERE usuario=? AND fatura=?').get(usuario, id).valor;
}

function listarCartoes(banco, usuario) {
  const cartoes = banco.prepare(`
    SELECT c.id,c.nome,c.limite,c.fechamento,c.vencimento,c.banco,COALESCE(SUM(i.valor),0) AS usado,
      EXISTS(SELECT 1 FROM cartoes_arquivados a WHERE a.usuario=c.usuario AND a.cartao=c.id) AS arquivado
    FROM cartoes c LEFT JOIN faturas f ON f.usuario=c.usuario AND f.cartao=c.id AND f.pagamento IS NULL
    LEFT JOIN itens_cartao i ON i.usuario=f.usuario AND i.fatura=f.id
    WHERE c.usuario=? GROUP BY c.id ORDER BY c.nome
  `).all(usuario);
  return { cartoes, faturas: listarFaturas(banco, usuario) };
}

function listarFaturas(banco, usuario, somentePendentes = false) {
  return banco.prepare(`
    SELECT f.id,f.cartao,f.fechamento,f.vencimento,f.pagamento,c.nome,c.banco,l.data AS pago_em,SUM(i.valor) AS valor
    FROM faturas f JOIN cartoes c ON c.usuario=f.usuario AND c.id=f.cartao
    JOIN itens_cartao i ON i.usuario=f.usuario AND i.fatura=f.id
    LEFT JOIN lancamentos l ON l.usuario=f.usuario AND l.id=f.pagamento
    WHERE f.usuario=? AND (?=0 OR f.pagamento IS NULL)
    GROUP BY f.id ORDER BY f.vencimento,f.id
  `).all(usuario, Number(somentePendentes));
}

function detalheFatura(banco, usuario, id) {
  const fatura = banco.prepare(`
    SELECT f.*, c.nome, l.data AS pago_em,l.origem,l.valor AS valor_pago
    FROM faturas f JOIN cartoes c ON c.usuario=f.usuario AND c.id=f.cartao
    LEFT JOIN lancamentos l ON l.usuario=f.usuario AND l.id=f.pagamento
    WHERE f.usuario=? AND f.id=?
  `).get(usuario, id);
  exigir(fatura, 'Fatura não encontrada.', 404);
  const itens = banco.prepare(`
    SELECT i.id,i.data,i.descricao,i.valor,i.numero,i.parcelas,i.ocorrencia,i.compra,c.nome AS categoria
    FROM itens_cartao i JOIN categorias c ON c.usuario=i.usuario AND c.id=i.categoria
    WHERE i.usuario=? AND i.fatura=? ORDER BY i.data,i.id
  `).all(usuario, id);
  return { ...fatura, valor: itens.reduce((total, item) => total + item.valor, 0), itens };
}

function listarPlanos(banco, usuario) {
  const planos = banco.prepare(`
    SELECT p.*,a.nome AS nome_conta,t.nome AS nome_cartao,c.nome AS nome_categoria,
      EXISTS(SELECT 1 FROM compromissos_arquivados ar WHERE ar.usuario=p.usuario AND ar.compromisso=p.id) AS arquivado
    FROM compromissos p
    JOIN categorias c ON c.usuario=p.usuario AND c.id=p.categoria
    LEFT JOIN contas a ON a.usuario=p.usuario AND a.id=p.conta
    LEFT JOIN cartoes t ON t.usuario=p.usuario AND t.id=p.cartao
    WHERE p.usuario=? ORDER BY p.nome
  `).all(usuario);
  const ocorrencias = banco.prepare(`
    SELECT o.id,o.compromisso,COALESCE(a.vencimento,o.vencimento) AS vencimento,o.previsto,o.confirmado,o.parcela,o.pagamento,
      p.nome,p.tipo,p.conta,p.cartao,p.quantidade,i.fatura,l.data AS pagamento_conta,l.origem AS conta_pagamento,
      f.pagamento AS pagamento_fatura,lf.data AS pagamento_cartao
    FROM ocorrencias o JOIN compromissos p ON p.usuario=o.usuario AND p.id=o.compromisso
    LEFT JOIN ajustes_ocorrencias a ON a.usuario=o.usuario AND a.ocorrencia=o.id
    LEFT JOIN itens_cartao i ON i.usuario=o.usuario AND i.ocorrencia=o.id
    LEFT JOIN faturas f ON f.usuario=o.usuario AND f.id=i.fatura
    LEFT JOIN lancamentos l ON l.usuario=o.usuario AND l.id=o.pagamento
    LEFT JOIN lancamentos lf ON lf.usuario=o.usuario AND lf.id=f.pagamento
    WHERE o.usuario=? AND COALESCE(a.excluida,0)=0 ORDER BY vencimento,o.id
  `).all(usuario);
  return { planos, ocorrencias, faturas: listarFaturas(banco, usuario, true) };
}

function listarPendencias(banco, usuario, inicio, fim) {
  return banco.prepare(`
    SELECT f.id,'fatura' AS tipo,'Fatura · '||c.nome AS nome,f.vencimento,SUM(i.valor) AS valor
    FROM faturas f JOIN cartoes c ON c.usuario=f.usuario AND c.id=f.cartao
    JOIN itens_cartao i ON i.usuario=f.usuario AND i.fatura=f.id
    WHERE f.usuario=? AND f.pagamento IS NULL AND f.vencimento BETWEEN ? AND ? GROUP BY f.id
    UNION ALL
    SELECT o.id,p.tipo,p.nome,COALESCE(a.vencimento,o.vencimento) AS vencimento,o.previsto AS valor
    FROM ocorrencias o JOIN compromissos p ON p.usuario=o.usuario AND p.id=o.compromisso
    LEFT JOIN ajustes_ocorrencias a ON a.usuario=o.usuario AND a.ocorrencia=o.id
    WHERE o.usuario=? AND p.conta IS NOT NULL AND o.pagamento IS NULL AND COALESCE(a.excluida,0)=0
      AND COALESCE(a.vencimento,o.vencimento) BETWEEN ? AND ?
    ORDER BY vencimento
  `).all(usuario, inicio, fim, usuario, inicio, fim);
}

export function pendencias(banco, usuario, dia = hoje()) {
  return listarPendencias(banco, usuario, '0001-01-01', somarDias(dia, 5))
    .map(item => ({ ...item, atrasado: item.vencimento < dia }));
}

export function gastosPrevistos(banco, usuario, inicio, fim, dia = hoje()) {
  const itens = listarPendencias(banco, usuario, inicio, fim);
  // Recorrências no cartão só entram na fatura na data da cobrança.
  const recorrencias = banco.prepare(`
    SELECT p.nome,c.nome AS cartao,p.inicio,p.ultima_data,p.valor,c.fechamento,c.vencimento,MAX(o.vencimento) AS ultima_cobranca
    FROM compromissos p JOIN cartoes c ON c.usuario=p.usuario AND c.id=p.cartao
    LEFT JOIN ocorrencias o ON o.usuario=p.usuario AND o.compromisso=p.id
    WHERE p.usuario=? AND p.tipo='mensal' AND p.inicio<=?
      AND (p.ultima_data IS NULL OR p.ultima_data>?)
    GROUP BY p.id
  `).all(usuario, fim, dia);
  const mesAtual = dia.slice(0, 7);
  for (const plano of recorrencias) {
    const primeiroMes = plano.ultima_cobranca
      ? somarMeses(plano.ultima_cobranca.slice(0, 7), 1) : plano.inicio.slice(0, 7);
    const limite = plano.ultima_data && plano.ultima_data < fim ? plano.ultima_data : fim;
    for (let mes = primeiroMes > mesAtual ? primeiroMes : mesAtual; mes <= limite.slice(0, 7); mes = somarMeses(mes, 1)) {
      const cobranca = diaNoMes(mes, Number(plano.inicio.slice(8)));
      if (cobranca <= dia || cobranca > limite) continue;
      const { vencimento } = datasFatura(plano, fechamentoDaCompra(cobranca, plano));
      if (vencimento >= inicio && vencimento <= fim) {
        itens.push({ nome: `${plano.nome} · ${plano.cartao}`, tipo: 'recorrencia-cartao', vencimento, valor: plano.valor });
      }
    }
  }
  itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return { itens, valor: itens.reduce((total, item) => total + item.valor, 0) };
}

function registrarCompra(banco, usuario, dados) {
  const cartao = cartaoDoUsuario(banco, usuario, dados.cartao, true);
  const dia = data(dados.data);
  exigir(dia <= hoje(), 'Use uma data até hoje para a compra.');
  const descricao = texto(dados.descricao, 'descrição', 240);
  const categoria = categoriaDoUsuario(banco, usuario, inteiro(dados.categoria, 'categoria'));
  const parcelas = inteiro(dados.parcelas, 'número de parcelas', 1, 120);
  const total = inteiro(dados.valor, 'valor', parcelas);
  const primeira = fechamentoDaCompra(dia, cartao);
  const compra = Number(banco.prepare('INSERT INTO compras_cartao(usuario,completa,criada_em) VALUES (?,1,?)').run(usuario, Date.now()).lastInsertRowid);
  for (let indice = 0; indice < parcelas; indice++) {
    criarItem(banco, usuario, cartao, somarMeses(primeira, indice), {
      data: dia, descricao, valor: divisao(total, parcelas, indice), categoria, numero: indice + 1, parcelas, compra
    });
  }
  return { id: compra };
}

function detalheCompra(banco, usuario, id) {
  const registro = banco.prepare('SELECT * FROM compras_cartao WHERE usuario=? AND id=?').get(usuario, id);
  exigir(registro, 'Compra não encontrada.', 404);
  const itens = banco.prepare(`SELECT i.*,f.cartao,f.fechamento,f.vencimento,f.pagamento,c.nome AS nome_cartao,k.nome AS nome_categoria
    FROM itens_cartao i JOIN faturas f ON f.usuario=i.usuario AND f.id=i.fatura
    JOIN cartoes c ON c.usuario=f.usuario AND c.id=f.cartao JOIN categorias k ON k.usuario=i.usuario AND k.id=i.categoria
    WHERE i.usuario=? AND i.compra=? ORDER BY i.numero,i.id`).all(usuario, id);
  exigir(itens.length, 'Compra sem parcelas disponíveis.', 404);
  const pendentes = itens.filter(item => !item.pagamento);
  const atual = pendentes[0] ?? itens[0];
  return { ...registro, cartao: atual.cartao, nome_cartao: atual.nome_cartao, data: atual.data,
    descricao: atual.descricao, categoria: atual.categoria, parcelas: atual.parcelas,
    valor: itens.reduce((soma, item) => soma + item.valor, 0),
    valor_pendente: pendentes.reduce((soma, item) => soma + item.valor, 0),
    pagas: itens.length - pendentes.length, pendentes: pendentes.length, itens };
}

const revisaoCompra = dados => createHash('sha256').update(JSON.stringify(dados)).digest('hex');

function impactosCompra(banco, usuario, removidos, adicionados) {
  const impactos = new Map();
  const incluir = (item, diferenca) => {
    const chave = item.fatura ? `id:${item.fatura}` : `nova:${item.cartao}:${item.fechamento}`;
    if (!impactos.has(chave)) impactos.set(chave, {
      fatura: item.fatura ?? null, cartao: item.cartao, nome_cartao: item.nome_cartao,
      fechamento: item.fechamento, vencimento: item.vencimento,
      antes: item.fatura ? totalFatura(banco, usuario, item.fatura) : 0, alteracao: 0
    });
    impactos.get(chave).alteracao += diferenca;
  };
  for (const item of removidos) incluir(item, -item.valor);
  for (const item of adicionados) incluir(item, item.valor);
  return [...impactos.values()].map(item => ({ ...item, depois: item.antes + item.alteracao }));
}

function limitesCompra(banco, usuario, impactos) {
  return [...new Set(impactos.map(item => item.cartao))].map(id => {
    const cartao = cartaoDoUsuario(banco, usuario, id);
    const usado = banco.prepare(`SELECT COALESCE(SUM(i.valor),0) AS valor FROM faturas f
      JOIN itens_cartao i ON i.usuario=f.usuario AND i.fatura=f.id WHERE f.usuario=? AND f.cartao=? AND f.pagamento IS NULL`).get(usuario, id).valor;
    const alteracao = impactos.filter(item => item.cartao === id).reduce((soma, item) => soma + item.alteracao, 0);
    return { cartao: id, nome_cartao: cartao.nome, limite: cartao.limite, usado_antes: usado, usado_depois: usado + alteracao,
      disponivel_antes: cartao.limite - usado, disponivel_depois: cartao.limite - usado - alteracao };
  });
}

function previaEdicaoCompra(banco, usuario, id, dados) {
  const compra = detalheCompra(banco, usuario, id);
  exigir(compra.completa, 'Este registro antigo tem parcelas incompletas. Não é seguro reagrupar ou mover a compra inteira.', 409);
  exigir(compra.pendentes, 'Esta compra está quitada. Os pagamentos e o histórico devem ser preservados.', 409);
  const cartao = cartaoDoUsuario(banco, usuario, dados.cartao, true);
  const dia = data(dados.data);
  exigir(dia <= hoje(), 'Use uma data até hoje para a compra.');
  const descricao = texto(dados.descricao, 'descrição', 240);
  const categoria = categoriaDoUsuario(banco, usuario, inteiro(dados.categoria, 'categoria'));
  const parcelas = inteiro(dados.parcelas, 'número de parcelas', 1, 120);
  if (compra.pagas) exigir(dia === compra.data && parcelas === compra.parcelas,
    'Há parcelas pagas. Preserve a data e a quantidade original; somente as parcelas pendentes podem ser corrigidas.', 409);
  const antigos = compra.itens.filter(item => !item.pagamento);
  const quantidade = compra.pagas ? antigos.length : parcelas;
  const valor = inteiro(dados.valor, compra.pagas ? 'valor das parcelas pendentes' : 'valor total', quantidade);
  const preservar = cartao.id === compra.cartao && dia === compra.data && parcelas === compra.parcelas;
  const primeira = fechamentoDaCompra(dia, cartao);
  const novos = Array.from({ length: quantidade }, (_, indice) => {
    const numero = compra.pagas ? antigos[indice].numero : indice + 1;
    const mes = somarMeses(primeira, numero - 1);
    let destino;
    if (preservar) destino = antigos[indice];
    else {
      const datas = datasFatura(cartao, mes);
      destino = banco.prepare('SELECT id AS fatura,fechamento,vencimento,pagamento FROM faturas WHERE usuario=? AND cartao=? AND fechamento=?')
        .get(usuario, cartao.id, datas.fechamento) ?? { ...datas, fatura: null };
    }
    exigir(!destino.pagamento, 'Uma fatura de destino já foi quitada. Escolha outro cartão ou revise as datas antes de corrigir.', 409);
    return { id: preservar ? antigos[indice].id : null, fatura: destino.fatura, cartao: cartao.id, nome_cartao: cartao.nome,
      fechamento: destino.fechamento, vencimento: destino.vencimento, mes, numero, parcelas,
      data: dia, descricao, categoria, valor: divisao(valor, quantidade, indice) };
  });
  const impactos = impactosCompra(banco, usuario, antigos, novos);
  const limites = limitesCompra(banco, usuario, impactos);
  const revisao = revisaoCompra({ compra, cartao, novos, impactos, limites });
  return { compra, preservar, novos, impactos, limites, revisao };
}

function editarCompra(banco, usuario, id, dados) {
  const previa = previaEdicaoCompra(banco, usuario, id, dados);
  exigir(dados.confirmar === true, 'Revise e confirme as alterações da compra.');
  exigir(dados.revisao === previa.revisao, 'A compra ou as faturas mudaram. Revise novamente antes de confirmar.', 409);
  if (previa.preservar) {
    for (const item of previa.novos) banco.prepare('UPDATE itens_cartao SET descricao=?,categoria=?,valor=? WHERE usuario=? AND id=? AND compra=?')
      .run(item.descricao, item.categoria, item.valor, usuario, item.id, id);
  } else {
    banco.prepare('DELETE FROM itens_cartao WHERE usuario=? AND compra=? AND fatura IN (SELECT id FROM faturas WHERE usuario=? AND pagamento IS NULL)')
      .run(usuario, id, usuario);
    const cartao = cartaoDoUsuario(banco, usuario, dados.cartao, true);
    for (const item of previa.novos) criarItem(banco, usuario, cartao, item.mes, { ...item, compra: id });
  }
  banco.prepare("INSERT INTO eventos_seguranca(ator,alvo,evento,criada_em) VALUES (?,?,'compra_corrigida',?)").run(usuario, usuario, Date.now());
  return { id, parcelas_corrigidas: previa.novos.length, parcelas_pagas_preservadas: previa.compra.pagas };
}

function previaExclusaoCompra(banco, usuario, id) {
  const compra = detalheCompra(banco, usuario, id);
  exigir(compra.pendentes, 'Esta compra já foi paga. Excluí-la não desfaz o pagamento; o histórico quitado será preservado.', 409);
  const removidos = compra.itens.filter(item => !item.pagamento);
  const impactos = impactosCompra(banco, usuario, removidos, []);
  const limites = limitesCompra(banco, usuario, impactos);
  return { compra, impactos, limites,
    revisao: revisaoCompra({ compra, impactos, limites }), escopo: compra.pagas ? 'pendentes' : compra.completa ? 'compra-inteira' : 'registro-antigo' };
}

function excluirCompra(banco, usuario, id, dados) {
  const previa = previaExclusaoCompra(banco, usuario, id);
  exigir(dados.confirmar === true, 'Confirme a exclusão e as parcelas afetadas.');
  exigir(dados.revisao === previa.revisao, 'A compra ou os pagamentos mudaram. Revise novamente antes de excluir.', 409);
  banco.prepare('DELETE FROM itens_cartao WHERE usuario=? AND compra=? AND fatura IN (SELECT id FROM faturas WHERE usuario=? AND pagamento IS NULL)')
    .run(usuario, id, usuario);
  if (!previa.compra.pagas) banco.prepare('DELETE FROM compras_cartao WHERE usuario=? AND id=?').run(usuario, id);
  banco.prepare("INSERT INTO eventos_seguranca(ator,alvo,evento,criada_em) VALUES (?,?,'compra_excluida_pendentes',?)").run(usuario, usuario, Date.now());
  return { id, parcelas_excluidas: previa.compra.pendentes, parcelas_pagas_preservadas: previa.compra.pagas };
}

function corrigirDatasFatura(banco, usuario, id, dados) {
  const fatura = detalheFatura(banco, usuario, id);
  exigir(!fatura.pagamento, 'A fatura já foi quitada.', 409);
  const fechamento = data(dados.fechamento);
  const vencimento = data(dados.vencimento);
  exigir(fechamento <= vencimento, 'O vencimento deve ser no dia do fechamento ou depois.');
  exigir(fatura.itens.every(item => item.data <= fechamento) || dados.confirmar_datas === true,
    'Há compras registradas após o fechamento informado. Confirme as datas da fatura para salvar.');
  exigir(!banco.prepare('SELECT 1 FROM faturas WHERE usuario=? AND cartao=? AND fechamento=? AND id<>?')
    .get(usuario, fatura.cartao, fechamento, id), 'Já existe uma fatura deste cartão com essa data de fechamento.', 409);
  banco.prepare('UPDATE faturas SET fechamento=?,vencimento=? WHERE usuario=? AND id=?')
    .run(fechamento, vencimento, usuario, id);
  return { id };
}

function pagarFatura(banco, usuario, id, dados, corrigir) {
  const fatura = detalheFatura(banco, usuario, id);
  exigir(Boolean(fatura.pagamento) === corrigir, corrigir ? 'Quite a fatura antes de corrigir o pagamento.' : 'Esta fatura já foi quitada.', 409);
  const dia = data(dados.data);
  const conta = contaDoUsuario(banco, usuario, dados.conta, 'conta');
  exigir(dia >= conta.inicio && dia <= hoje(), 'Use uma data entre a abertura da conta e hoje.');
  exigir(dia >= fatura.fechamento, 'Registre o pagamento a partir da data de fechamento da fatura.');
  exigir(fatura.valor > 0, 'Esta fatura está vazia.');
  exigir(inteiro(dados.valor, 'total da fatura') === fatura.valor, 'O valor da fatura mudou. Confira o total novamente.', 409);
  if (corrigir) {
    banco.prepare('UPDATE lancamentos SET data=?,origem=? WHERE usuario=? AND id=?')
      .run(dia, conta.id, usuario, fatura.pagamento);
    return { id: fatura.pagamento };
  }
  const pagamento = inserirLancamento(banco, usuario, {
    tipo: 'fatura', data: dia, valor: fatura.valor, origem: conta.id,
    descricao: `Fatura · ${fatura.nome}`, referencia: id
  });
  banco.prepare('UPDATE faturas SET pagamento=? WHERE usuario=? AND id=?').run(pagamento, usuario, id);
  return { id: pagamento };
}

function criarPlano(banco, usuario, dados) {
  const nome = texto(dados.nome, 'nome');
  const categoria = categoriaDoUsuario(banco, usuario, inteiro(dados.categoria, 'categoria'));
  const inicio = data(dados.inicio);
  exigir(['mensal', 'parcelado', 'avulso'].includes(dados.tipo), 'Tipo de compromisso inválido.');
  // Avulso usa o fluxo existente de pagamentos diretos, com um único vencimento.
  const quantidade = dados.tipo === 'avulso' ? 1
    : dados.tipo === 'parcelado' ? inteiro(dados.quantidade, 'número de parcelas', 2, 120) : null;
  const tipo = dados.tipo === 'avulso' ? 'parcelado' : dados.tipo;
  const valor = inteiro(dados.valor, 'valor', quantidade ?? 1);
  const cartao = dados.cartao ? cartaoDoUsuario(banco, usuario, dados.cartao, true).id : null;
  exigir(!cartao || (!quantidade && !dados.conta), 'Para agendar cobrança no cartão, use uma recorrência ou registre uma compra.');
  const conta = cartao ? null : contaDoUsuario(banco, usuario, dados.conta, 'conta').id;
  const id = banco.prepare(`
    INSERT INTO compromissos(usuario,nome,categoria,tipo,inicio,valor,quantidade,conta,cartao)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(usuario, nome, categoria, tipo, inicio, valor, quantidade, conta, cartao).lastInsertRowid;
  const plano = { id, nome, categoria, inicio, valor, conta, cartao };
  if (quantidade) {
    for (let indice = 0; indice < quantidade; indice++) {
      const dia = diaNoMes(somarMeses(inicio.slice(0, 7), indice), Number(inicio.slice(8)));
      valorPlano(banco, usuario, plano, dia, divisao(valor, quantidade, indice), indice + 1);
    }
  } else {
    gerarMensal(banco, usuario, plano, somarDias(hoje(), cartao ? 0 : 45));
  }
  return { id };
}

function ocorrenciaDoUsuario(banco, usuario, id) {
  const item = banco.prepare(`
    SELECT o.*,p.nome,p.tipo,p.categoria,p.conta,p.cartao,i.fatura,f.pagamento AS pagamento_fatura FROM ocorrencias o
    JOIN compromissos p ON p.usuario=o.usuario AND p.id=o.compromisso
    LEFT JOIN ajustes_ocorrencias a ON a.usuario=o.usuario AND a.ocorrencia=o.id
    LEFT JOIN itens_cartao i ON i.usuario=o.usuario AND i.ocorrencia=o.id
    LEFT JOIN faturas f ON f.usuario=i.usuario AND f.id=i.fatura
    WHERE o.usuario=? AND o.id=? AND COALESCE(a.excluida,0)=0
  `).get(usuario, id);
  exigir(item, 'Cobrança não encontrada.', 404);
  return item;
}

function confirmarOcorrencia(banco, usuario, id, dados, corrigir) {
  const item = ocorrenciaDoUsuario(banco, usuario, id);
  const valor = inteiro(dados.valor, 'valor pago');
  if (item.cartao) {
    exigir(!corrigir, 'A quitação desta cobrança é corrigida na tela da fatura.', 409);
    exigir(item.fatura && !item.pagamento_fatura, 'A fatura já foi quitada.', 409);
    banco.prepare('UPDATE itens_cartao SET valor=? WHERE usuario=? AND ocorrencia=?').run(valor, usuario, id);
    banco.prepare('UPDATE ocorrencias SET confirmado=? WHERE usuario=? AND id=?').run(valor, usuario, id);
    return { id };
  }
  exigir(Boolean(item.pagamento) === corrigir, corrigir ? 'Esta cobrança ainda não foi paga.' : 'Esta cobrança já foi paga.', 409);
  const conta = contaDoUsuario(banco, usuario, dados.conta ?? item.conta, 'conta');
  const dia = data(dados.data);
  exigir(dia >= conta.inicio && dia <= hoje(), 'Use uma data entre a abertura da conta e hoje.');
  if (corrigir) {
    banco.prepare('UPDATE lancamentos SET data=?,valor=?,origem=? WHERE usuario=? AND id=?')
      .run(dia, valor, conta.id, usuario, item.pagamento);
    banco.prepare('UPDATE ocorrencias SET confirmado=? WHERE usuario=? AND id=?').run(valor, usuario, id);
    return { id: item.pagamento };
  }
  const pagamento = inserirLancamento(banco, usuario, {
    tipo: item.tipo === 'mensal' ? 'recorrencia' : 'parcela', data: dia, valor,
    origem: conta.id, categoria: item.categoria, descricao: item.nome, referencia: id
  });
  banco.prepare('UPDATE ocorrencias SET pagamento=?,confirmado=? WHERE usuario=? AND id=?').run(pagamento, valor, usuario, id);
  return { id: pagamento };
}

function editarCobrancaPendente(banco, usuario, id, dados) {
  const item = ocorrenciaDoUsuario(banco, usuario, id);
  exigir(!item.cartao && !item.pagamento, 'Use os detalhes do pagamento para corrigir esta cobrança.', 409);
  const vencimento = data(dados.vencimento);
  const valor = inteiro(dados.valor, 'valor previsto');
  banco.prepare('UPDATE ocorrencias SET previsto=? WHERE usuario=? AND id=?').run(valor, usuario, id);
  banco.prepare(`
    INSERT INTO ajustes_ocorrencias(usuario,ocorrencia,vencimento) VALUES (?,?,?)
    ON CONFLICT(usuario,ocorrencia) DO UPDATE SET vencimento=excluded.vencimento
  `).run(usuario, id, vencimento);
  return { id };
}

function excluirCobranca(banco, usuario, id, dados) {
  const item = ocorrenciaDoUsuario(banco, usuario, id);
  exigir(!item.pagamento_fatura, 'Esta cobrança pertence a uma fatura quitada.', 409);
  exigir(!item.pagamento || dados.confirmar_pago === true, 'Confirme a remoção do pagamento registrado.', 409);
  if (item.pagamento) {
    banco.prepare('UPDATE ocorrencias SET pagamento=NULL,confirmado=NULL WHERE usuario=? AND id=?').run(usuario, id);
    banco.prepare('DELETE FROM lancamentos WHERE usuario=? AND id=?').run(usuario, item.pagamento);
  }
  if (item.cartao) banco.prepare('DELETE FROM itens_cartao WHERE usuario=? AND ocorrencia=?').run(usuario, id);
  banco.prepare(`
    INSERT INTO ajustes_ocorrencias(usuario,ocorrencia,excluida) VALUES (?,?,1)
    ON CONFLICT(usuario,ocorrencia) DO UPDATE SET excluida=1
  `).run(usuario, id);
  return { id };
}

function pararRecorrencia(banco, usuario, id) {
  const plano = banco.prepare("SELECT ultima_data FROM compromissos WHERE usuario=? AND id=? AND tipo='mensal'").get(usuario, id);
  exigir(plano, 'Recorrência não encontrada.', 404);
  banco.prepare(`
    INSERT INTO ajustes_ocorrencias(usuario,ocorrencia,excluida)
    SELECT o.usuario,o.id,1 FROM ocorrencias o
    LEFT JOIN ajustes_ocorrencias a ON a.usuario=o.usuario AND a.ocorrencia=o.id
    WHERE o.usuario=? AND o.compromisso=? AND COALESCE(a.vencimento,o.vencimento)>? AND o.pagamento IS NULL
    ON CONFLICT(usuario,ocorrencia) DO UPDATE SET excluida=1
  `).run(usuario, id, hoje());
  banco.prepare('UPDATE compromissos SET ultima_data=? WHERE usuario=? AND id=?').run(hoje(), usuario, id);
  return {};
}

function alterarArquivoRecorrencia(banco, usuario, id, arquivar) {
  const plano = banco.prepare("SELECT ultima_data FROM compromissos WHERE usuario=? AND id=? AND tipo='mensal'").get(usuario, id);
  exigir(plano, 'Recorrência não encontrada.', 404);
  exigir(plano.ultima_data, 'Encerre a recorrência antes de retirá-la da lista.', 409);
  if (arquivar) {
    banco.prepare('INSERT INTO compromissos_arquivados(usuario,compromisso) VALUES (?,?) ON CONFLICT DO NOTHING').run(usuario, id);
  } else {
    banco.prepare('DELETE FROM compromissos_arquivados WHERE usuario=? AND compromisso=?').run(usuario, id);
  }
  return { id };
}

export function compromissos(banco, usuario, metodo, caminho, dados) {
  if (metodo === 'GET' && caminho === '/api/cartoes') return listarCartoes(banco, usuario);
  if (metodo === 'GET' && caminho === '/api/compromissos') return listarPlanos(banco, usuario);
  const fatura = caminho.match(/^\/api\/faturas\/(\d+)(?:\/(corrigir|datas))?$/);
  if (fatura) {
    const id = inteiro(Number(fatura[1]), 'fatura');
    if (metodo === 'GET' && !fatura[2]) return detalheFatura(banco, usuario, id);
    if (metodo === 'POST') return operacaoUnica(banco, usuario, caminho, dados, () => fatura[2] === 'datas'
      ? corrigirDatasFatura(banco, usuario, id, dados)
      : pagarFatura(banco, usuario, id, dados, fatura[2] === 'corrigir'));
  }
  const compra = caminho.match(/^\/api\/compras\/(\d+)(?:\/(previa|previa-exclusao|excluir))?$/);
  if (compra) {
    const id = inteiro(Number(compra[1]), 'compra');
    if (metodo === 'GET' && !compra[2]) return detalheCompra(banco, usuario, id);
    if (metodo === 'POST') {
      if (compra[2] === 'previa') return previaEdicaoCompra(banco, usuario, id, dados);
      if (compra[2] === 'previa-exclusao') return previaExclusaoCompra(banco, usuario, id);
      return operacaoUnica(banco, usuario, caminho, dados, () => compra[2] === 'excluir' ? excluirCompra(banco, usuario, id, dados) : editarCompra(banco, usuario, id, dados));
    }
  }
  if (metodo !== 'POST') return undefined;
  if (caminho === '/api/cartoes') {
    return operacaoUnica(banco, usuario, caminho, dados, () => salvarCartao(banco, usuario, dados));
  }
  const rotaCartao = caminho.match(/^\/api\/cartoes\/(\d+)(?:\/(excluir|restaurar))?$/);
  if (rotaCartao) {
    const id = inteiro(Number(rotaCartao[1]), 'cartão');
    return operacaoUnica(banco, usuario, caminho, dados, () => {
      if (!rotaCartao[2]) return salvarCartao(banco, usuario, dados, id);
      if (rotaCartao[2] === 'excluir') return excluirCartao(banco, usuario, id);
      cartaoDoUsuario(banco, usuario, id);
      banco.prepare('DELETE FROM cartoes_arquivados WHERE usuario=? AND cartao=?').run(usuario, id);
      return { id };
    });
  }
  if (caminho === '/api/compras') return operacaoUnica(banco, usuario, caminho, dados, () => registrarCompra(banco, usuario, dados));
  if (caminho === '/api/compromissos') return operacaoUnica(banco, usuario, caminho, dados, () => criarPlano(banco, usuario, dados));
  const ocorrencia = caminho.match(/^\/api\/ocorrencias\/(\d+)(?:\/(corrigir|editar|excluir))?$/);
  if (ocorrencia) {
    const id = inteiro(Number(ocorrencia[1]), 'cobrança');
    return operacaoUnica(banco, usuario, caminho, dados, () => {
      if (ocorrencia[2] === 'editar') return editarCobrancaPendente(banco, usuario, id, dados);
      if (ocorrencia[2] === 'excluir') return excluirCobranca(banco, usuario, id, dados);
      return confirmarOcorrencia(banco, usuario, id, dados, ocorrencia[2] === 'corrigir');
    });
  }
  const plano = caminho.match(/^\/api\/compromissos\/(\d+)\/(encerrar|arquivar|restaurar)$/);
  if (plano) {
    const id = inteiro(Number(plano[1]), 'compromisso');
    return operacaoUnica(banco, usuario, caminho, dados, () => plano[2] === 'encerrar'
      ? pararRecorrencia(banco, usuario, id)
      : alterarArquivoRecorrencia(banco, usuario, id, plano[2] === 'arquivar'));
  }
  return undefined;
}
