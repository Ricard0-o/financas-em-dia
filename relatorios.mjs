import { contaDoUsuario, contasComSaldo, listarLancamentos } from './movimentacoes.mjs';
import { listarPeriodos } from './periodos.mjs';
import { gastosPrevistos, pendencias } from './compromissos.mjs';
import { data, exigir, hoje, somarDias } from './validacao.mjs';

const despesasDoIntervalo = `
  WITH despesas AS (
    SELECT usuario,categoria,valor,data,descricao,NULL AS fatura FROM lancamentos
    WHERE usuario=? AND data BETWEEN ? AND ? AND tipo IN ('despesa','parcela','recorrencia')
    UNION ALL
    SELECT l.usuario,i.categoria,i.valor,l.data,i.descricao,l.descricao AS fatura FROM lancamentos l
    JOIN itens_cartao i ON i.usuario=l.usuario AND i.fatura=l.referencia
    WHERE l.usuario=? AND l.data BETWEEN ? AND ? AND l.tipo='fatura'
  )
`;

function resumir(banco, usuario, inicio, fim) {
  const entradas = banco.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total FROM lancamentos
    WHERE usuario=? AND data BETWEEN ? AND ? AND tipo IN ('renda','salario')
  `).get(usuario, inicio, fim).total;
  const categorias = banco.prepare(`${despesasDoIntervalo}
    SELECT c.id,c.nome, SUM(d.valor) AS valor FROM despesas d JOIN categorias c ON c.id=d.categoria AND c.usuario=d.usuario
    GROUP BY c.id ORDER BY valor DESC,c.nome
  `).all(usuario, inicio, fim, usuario, inicio, fim);
  return { entradas, saidas: categorias.reduce((soma, categoria) => soma + categoria.valor, 0), categorias };
}

function somarConta(contas, tipo) {
  return contas.reduce((total, conta) => total + (conta.tipo === tipo ? conta.saldo : 0), 0);
}

function previsaoAtual(banco, usuario, periodo, dia) {
  const inicio = periodo.id === 'inicial' ? dia : periodo.inicio;
  const fim = somarDias(inicio, 30);
  return { inicio, fim, ...gastosPrevistos(banco, usuario, inicio, fim, dia) };
}

function evolucao(banco, usuario, inicio, fim) {
  const inicial = somarConta(contasComSaldo(banco, usuario, somarDias(inicio, -1)), 'conta');
  const alteracoes = banco.prepare(`${despesasDoIntervalo},
    movimentos AS (
      SELECT l.data,a.tipo AS tipo_destino,b.tipo AS tipo_origem,l.valor FROM lancamentos l
      LEFT JOIN contas a ON a.usuario=l.usuario AND a.id=l.destino
      LEFT JOIN contas b ON b.usuario=l.usuario AND b.id=l.origem
      WHERE l.usuario=? AND l.data BETWEEN ? AND ?
    ), variacoes AS (
      SELECT data, CASE WHEN tipo_destino='conta' THEN valor ELSE 0 END
        - CASE WHEN tipo_origem='conta' THEN valor ELSE 0 END AS valor, 0 AS saida FROM movimentos
      UNION ALL
      SELECT inicio,saldo_inicial,0 FROM contas WHERE usuario=? AND inicio BETWEEN ? AND ? AND tipo='conta'
      UNION ALL
      SELECT d.data,0,d.valor FROM despesas d JOIN categorias c ON c.id=d.categoria AND c.usuario=d.usuario
    )
    SELECT data,SUM(valor) AS valor,SUM(saida) AS saida FROM variacoes GROUP BY data ORDER BY data
  `).all(usuario, inicio, fim, usuario, inicio, fim, usuario, inicio, fim, usuario, inicio, fim);
  const serie = [];
  let saldo = inicial;
  let saidas_acumuladas = 0;
  if (alteracoes[0]?.data !== inicio) serie.push({ data: inicio, saldo, saidas_acumuladas });
  for (const alteracao of alteracoes) {
    saldo += alteracao.valor;
    saidas_acumuladas += alteracao.saida;
    serie.push({ data: alteracao.data, saldo, saidas_acumuladas });
  }
  if (serie.at(-1).data !== fim) serie.push({ data: fim, saldo, saidas_acumuladas });
  return { inicial, serie, saldo_final: saldo };
}

function saidasDetalhadas(banco, usuario, inicio, fim) {
  return banco.prepare(`${despesasDoIntervalo}
    SELECT d.data,d.descricao,d.valor,d.fatura,c.id AS categoria_id,c.nome AS categoria
    FROM despesas d JOIN categorias c ON c.id=d.categoria AND c.usuario=d.usuario
    ORDER BY d.data,d.descricao`).all(usuario, inicio, fim, usuario, inicio, fim);
}

const quantidadeDias = (inicio, fim) => Math.round((Date.parse(fim) - Date.parse(inicio)) / 86_400_000) + 1;

function ritmoGastos(banco, usuario, inicio, fim) {
  const dias = banco.prepare(`${despesasDoIntervalo} SELECT data,SUM(valor) AS valor FROM despesas GROUP BY data ORDER BY data`)
    .all(usuario, inicio, fim, usuario, inicio, fim);
  const serie = [{ dia: 0, data: somarDias(inicio, -1), valor: 0 }];
  let total = 0;
  for (const item of dias) {
    total += item.valor;
    serie.push({ dia: quantidadeDias(inicio, item.data), data: item.data, valor: total });
  }
  const duracao = quantidadeDias(inicio, fim);
  if (serie.at(-1).dia !== duracao) serie.push({ dia: duracao, data: fim, valor: total });
  return { inicio, fim, dias: duracao, saidas: total, serie };
}

function compararRitmo(banco, usuario, ciclos, selecionado, inicio, fim) {
  const atual = ritmoGastos(banco, usuario, inicio, fim);
  const resposta = { atual, anterior: null, motivo: 'Selecione um ciclo salarial para comparar com o anterior.' };
  if (!selecionado || ['inicial','anterior'].includes(selecionado.id)) return resposta;
  const indice = ciclos.findIndex(ciclo => ciclo.id === selecionado.id);
  const anterior = ciclos[indice - 1];
  if (!anterior || ['inicial','anterior'].includes(anterior.id)) return { ...resposta, motivo: 'Ainda não há um ciclo salarial anterior para comparação.' };
  const diasAnteriores = quantidadeDias(anterior.inicio, anterior.fim);
  if (!selecionado.fim && atual.dias > diasAnteriores) return { ...resposta,
    motivo: 'O ciclo atual já tem mais dias que o anterior. A comparação foi omitida para não usar durações diferentes.' };
  const fimAnterior = selecionado.fim ? anterior.fim : somarDias(anterior.inicio, atual.dias - 1);
  const referencia = ritmoGastos(banco, usuario, anterior.inicio, fimAnterior);
  const diferenca = atual.saidas - referencia.saidas;
  return { atual, anterior: referencia, motivo: null,
    tipo: selecionado.fim ? 'ciclos-completos' : 'mesma-quantidade-de-dias', diferenca,
    variacao: referencia.saidas > 0 ? diferenca / referencia.saidas : null };
}

function movimentosPatrimoniais(banco, usuario, inicio, fim) {
  const movimentos = banco.prepare(`SELECT l.data,l.descricao,l.valor,a.tipo AS origem,b.tipo AS destino
    FROM lancamentos l JOIN contas a ON a.usuario=l.usuario AND a.id=l.origem
    JOIN contas b ON b.usuario=l.usuario AND b.id=l.destino
    WHERE l.usuario=? AND l.tipo='transferencia' AND l.data BETWEEN ? AND ? ORDER BY l.data,l.id`).all(usuario, inicio, fim);
  const aportes = movimentos.filter(item => item.origem === 'conta' && item.destino !== 'conta');
  const resgates = movimentos.filter(item => item.origem !== 'conta' && item.destino === 'conta');
  const internas = movimentos.filter(item => !aportes.includes(item) && !resgates.includes(item));
  const somar = itens => itens.reduce((soma, item) => soma + item.valor, 0);
  return { aportes: somar(aportes), resgates: somar(resgates), internas: somar(internas), movimentos };
}

function relatorioAnalitico(banco, usuario, filtros, ciclos, dia) {
  const atual = ciclos.at(-1);
  const id = filtros.get('periodo');
  const escolhido = id ? ciclos.find(ciclo => ciclo.id === id) : null;
  exigir(!id || escolhido, 'Período salarial não encontrado.', 404);
  const inicio = filtros.get('inicio') ? data(filtros.get('inicio')) : escolhido?.inicio ?? atual.inicio;
  const fim = filtros.get('fim') ? data(filtros.get('fim')) : escolhido?.fim ?? dia;
  exigir(inicio <= fim && fim <= dia, 'Informe um intervalo válido até hoje.');
  if (escolhido) exigir(inicio === escolhido.inicio && fim === (escolhido.fim ?? dia), 'O intervalo não corresponde ao ciclo selecionado. Use Personalizado para outras datas.');
  const selecionado = escolhido ?? ciclos.find(ciclo => ciclo.inicio === inicio && (ciclo.fim ?? dia) === fim) ?? null;
  const cicloAtual = inicio === atual.inicio && fim === dia;
  const janela = cicloAtual ? { inicio: atual.id === 'inicial' ? dia : atual.inicio,
    fim: somarDias(atual.id === 'inicial' ? dia : atual.inicio, 30), sem_salario: atual.id === 'inicial' } : null;
  const previsao = janela && dia <= janela.fim ? { ...janela, ...gastosPrevistos(banco, usuario, janela.inicio, janela.fim, dia) } : null;
  const resumo = resumir(banco, usuario, inicio, fim);
  const previsto = previsao?.valor ?? 0;
  const comprometido = resumo.saidas + previsto;
  const saidas = saidasDetalhadas(banco, usuario, inicio, fim);
  const atrasados = cicloAtual ? pendencias(banco, usuario, dia).filter(item => item.atrasado)
    .map(item => ({ ...item, incluido_na_previsao: Boolean(previsao && item.vencimento >= previsao.inicio && item.vencimento <= previsao.fim) })) : [];
  return { inicio, fim, periodo_id: selecionado?.id ?? '', ciclo_atual: cicloAtual, ...resumo,
    ...evolucao(banco, usuario, inicio, fim), previsao, janela_previsao: janela,
    motivo_sem_previsao: previsao ? null : janela ? 'A janela de 30 dias após o salário já terminou. Nenhuma previsão futura foi somada.' : 'Intervalo histórico ou personalizado: somente pagamentos realizados são analisados.',
    entradas_detalhadas: banco.prepare("SELECT data,descricao,tipo,valor FROM lancamentos WHERE usuario=? AND data BETWEEN ? AND ? AND tipo IN ('salario','renda') ORDER BY data,id").all(usuario, inicio, fim),
    saidas_detalhadas: saidas,
    orcamento: { comprometido, previsto, restante: resumo.entradas - comprometido,
      excedente: Math.max(0, comprometido - resumo.entradas), proporcao: resumo.entradas > 0 ? comprometido / resumo.entradas : null },
    ritmo: compararRitmo(banco, usuario, ciclos, selecionado, inicio, fim),
    patrimonio: movimentosPatrimoniais(banco, usuario, inicio, fim), atrasados,
    atrasados_fora_previsao: atrasados.filter(item => !item.incluido_na_previsao).reduce((soma, item) => soma + item.valor, 0),
    proximos: previsao ? previsao.itens.filter(item => item.vencimento >= dia) : [],
    maiores_despesas: [...saidas].sort((a, b) => b.valor - a.valor || a.data.localeCompare(b.data)).slice(0, 5)
  };
}

export function relatorios(banco, usuario, metodo, caminho, filtros, dados) {
  const chaveDestaque = `painel.conta:${usuario}`;
  if (metodo === 'POST' && caminho === '/api/painel/conta-destaque') {
    const conta = contaDoUsuario(banco, usuario, dados.conta, 'conta');
    banco.prepare(`
      INSERT INTO configuracao(chave,valor) VALUES (?,?)
      ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor
    `).run(chaveDestaque, String(conta.id));
    return { conta_destaque: conta.id };
  }
  if (metodo !== 'GET') return undefined;
  if (caminho !== '/api/painel' && caminho !== '/api/relatorios') return undefined;
  const dia = hoje();
  const ciclos = listarPeriodos(banco, usuario);
  const atual = ciclos.at(-1);
  if (caminho === '/api/painel') {
    const contas = contasComSaldo(banco, usuario, dia);
    const escolhida = banco.prepare('SELECT valor FROM configuracao WHERE chave=?').get(chaveDestaque);
    return {
      periodo: atual, ...resumir(banco, usuario, atual.inicio, dia),
      saidas_detalhadas: banco.prepare(`${despesasDoIntervalo}
        SELECT d.data,d.descricao,d.valor,d.fatura,c.nome AS categoria
        FROM despesas d JOIN categorias c ON c.id=d.categoria AND c.usuario=d.usuario
        ORDER BY d.data DESC,d.descricao
      `).all(usuario, atual.inicio, dia, usuario, atual.inicio, dia),
      conta_destaque: escolhida ? Number(escolhida.valor) : null,
      disponivel: somarConta(contas, 'conta'), reserva: somarConta(contas, 'reserva'),
      investimentos: somarConta(contas, 'investimento'), pendencias: pendencias(banco, usuario, dia),
      previsao: previsaoAtual(banco, usuario, atual, dia),
      recentes: listarLancamentos(banco, usuario, new URLSearchParams()).slice(0, 5)
    };
  }
  return relatorioAnalitico(banco, usuario, filtros, ciclos, dia);
}
