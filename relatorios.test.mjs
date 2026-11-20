import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import { abrirBanco } from './banco.mjs';
import { relatorios } from './relatorios.mjs';
import { hoje, somarDias } from './validacao.mjs';

const pasta = mkdtempSync(join(tmpdir(), 'financas-relatorios-'));
let sequencia = 0;
after(() => rmSync(pasta, { recursive: true, force: true }));
function contexto(t) {
  const banco = abrirBanco(join(pasta, `${++sequencia}.sqlite`));t.after(() => banco.close());
  banco.exec(`INSERT INTO usuarios(id,nome,login,senha,admin) VALUES (1,'Pessoa','pessoa','hash',0),(2,'Outra','outra','hash',0);
    INSERT INTO contas(id,usuario,nome,tipo,saldo_inicial,inicio) VALUES
      (1,1,'Corrente','conta',100000,'2020-01-01'),(2,1,'Outra conta','conta',0,'2020-01-01'),
      (3,1,'Reserva','reserva',0,'2020-01-01'),(4,1,'Investimento','investimento',0,'2020-01-01'),(5,2,'Privada','conta',0,'2020-01-01');
    INSERT INTO categorias(id,usuario,nome) VALUES (1,1,'Alimentação'),(2,1,'Transporte'),(3,2,'Outra pessoa');
    INSERT INTO cartoes(id,usuario,nome,limite,fechamento,vencimento) VALUES (1,1,'Cartão',100000,10,20);`);
  const dia = deslocamento => somarDias(hoje(), deslocamento);
  const mov = (tipo, data, valor, extra = {}) => {
    const entrada = ['salario','renda'].includes(tipo), transferencia = tipo === 'transferencia';
    return Number(banco.prepare('INSERT INTO lancamentos(usuario,data,tipo,descricao,valor,origem,destino,categoria,referencia) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(extra.usuario ?? 1, data, tipo, extra.descricao ?? tipo, valor,
        extra.origem ?? (entrada ? null : 1), extra.destino ?? (entrada ? 1 : transferencia ? 3 : null),
        extra.categoria ?? (entrada || transferencia || tipo === 'fatura' ? null : 1), extra.referencia ?? null).lastInsertRowid);
  };
  const salario = (data, valor = 200000) => {
    const id = mov('salario', data, valor);banco.prepare('INSERT INTO viradas(usuario,inicio,salario) VALUES (1,?,?)').run(data,id);return id;
  };
  const pendente = (data, valor) => {
    const id=banco.prepare("INSERT INTO compromissos(usuario,nome,categoria,tipo,inicio,valor,conta) VALUES (1,'Pagamento',1,'mensal',?,?,1)").run(data,valor).lastInsertRowid;
    banco.prepare('INSERT INTO ocorrencias(usuario,compromisso,vencimento,previsto) VALUES (1,?,?,?)').run(id,data,valor);
  };
  const relatorio = parametros => relatorios(banco,1,'GET','/api/relatorios',new URLSearchParams(parametros),{});
  return { banco, dia, mov, salario, pendente, relatorio };
}

test('entradas, saídas, categorias, previsão e patrimônio conciliam sem duplicar cartão', t => {
  const {banco,dia,mov,salario,pendente,relatorio}=contexto(t);
  salario(dia(-40));salario(dia(-10));mov('renda',dia(-9),5000);mov('despesa',dia(-8),20000);mov('despesa',dia(-7),3000,{categoria:2});mov('despesa',dia(-38),50000);
  mov('transferencia',dia(-5),10000,{destino:3});mov('transferencia',dia(-4),2000,{origem:3,destino:1});mov('transferencia',dia(-3),5000,{destino:2});
  banco.prepare('INSERT INTO faturas(id,usuario,cartao,fechamento,vencimento) VALUES (1,1,1,?,?),(2,1,1,?,?)').run(dia(-5),dia(2),dia(2),dia(8));
  banco.prepare("INSERT INTO itens_cartao(usuario,fatura,data,descricao,valor,categoria,numero,parcelas) VALUES (1,1,?,'Compra paga',10000,1,1,1),(1,2,?,'Compra pendente',6000,2,1,1)").run(dia(-14),dia(-2));
  const pagamento=mov('fatura',dia(-2),10000,{referencia:1});banco.prepare('UPDATE faturas SET pagamento=? WHERE id=1').run(pagamento);
  pendente(dia(3),30000);
  mov('despesa',dia(-2),800000,{usuario:2,origem:5,categoria:3});
  const r=relatorio();
  assert.equal(r.entradas,205000);assert.equal(r.saidas,33000);assert.equal(r.previsao.valor,36000);
  assert.equal(r.orcamento.comprometido,69000);assert.equal(r.orcamento.restante,136000);assert.equal(r.orcamento.proporcao,69000/205000);
  assert.equal(r.entradas_detalhadas.reduce((s,i)=>s+i.valor,0),r.entradas);
  assert.equal(r.saidas_detalhadas.reduce((s,i)=>s+i.valor,0),r.saidas);
  assert.equal(r.categorias.reduce((s,i)=>s+i.valor,0),r.saidas);
  assert.deepEqual(r.categorias.map(c=>[c.nome,c.valor]),[['Alimentação',30000],['Transporte',3000]]);
  assert.equal(r.patrimonio.aportes,10000);assert.equal(r.patrimonio.resgates,2000);assert.equal(r.patrimonio.internas,5000);
  assert.equal(r.ritmo.atual.saidas,r.saidas);assert.equal(r.ritmo.atual.dias,11);assert.equal(r.ritmo.anterior.dias,11);assert.equal(r.ritmo.anterior.saidas,50000);
  assert.equal(r.ritmo.anterior.fim,dia(-30));assert.ok(!JSON.stringify(r).includes('Outra pessoa'));
  assert.equal(r.previsao.fim,dia(20));
});

test('filtros históricos e personalizados não recebem a previsão atual', t => {
  const {dia,mov,salario,pendente,relatorio}=contexto(t);salario(dia(-40));salario(dia(-10));pendente(dia(4),1234);mov('despesa',dia(-20),500);
  const historico=relatorio({periodo:dia(-40)});
  assert.equal(historico.inicio,dia(-40));assert.equal(historico.fim,dia(-11));assert.equal(historico.saidas,500);assert.equal(historico.previsao,null);assert.deepEqual(historico.atrasados,[]);
  const personalizado=relatorio({inicio:dia(-5),fim:hoje()});assert.equal(personalizado.previsao,null);assert.equal(personalizado.ciclo_atual,false);assert.equal(personalizado.ritmo.anterior,null);
  assert.throws(()=>relatorio({periodo:'inexistente'}),/Período salarial/);
  assert.throws(()=>relatorio({periodo:dia(-40),inicio:dia(-5),fim:hoje()}),/intervalo não corresponde/);
});

test('sem entradas não há percentual artificial e sem salário a previsão é explicitamente futura', t => {
  const {dia,mov,pendente,relatorio}=contexto(t);mov('despesa',dia(-2),500);pendente(dia(3),700);
  const r=relatorio();assert.equal(r.orcamento.proporcao,null);assert.equal(r.orcamento.comprometido,1200);assert.equal(r.orcamento.excedente,1200);
  assert.equal(r.previsao.sem_salario,true);assert.equal(r.previsao.inicio,hoje());assert.equal(r.previsao.fim,dia(30));
  assert.equal(r.ritmo.anterior,null);assert.ok(!JSON.stringify(r).includes('NaN'));
});

test('comprometimento acima de 100% não significa que o saldo bancário está negativo', t => {
  const {dia,mov,salario,pendente,relatorio}=contexto(t);salario(dia(-5),10000);mov('despesa',dia(-2),15000);pendente(dia(2),3000);
  const r=relatorio();assert.equal(r.orcamento.proporcao,1.8);assert.equal(r.orcamento.excedente,8000);assert.equal(r.orcamento.restante,-8000);assert.ok(r.saldo_final>0);
});

test('sem saídas anteriores não inventa crescimento percentual nem comparação com período inicial', t => {
  const {dia,mov,salario,relatorio}=contexto(t);salario(dia(-40));salario(dia(-10));mov('despesa',dia(-2),100);
  const r=relatorio();assert.equal(r.ritmo.variacao,null);assert.equal(r.ritmo.diferenca,100);assert.equal(r.ritmo.anterior.saidas,0);
  const antigo=relatorio({periodo:dia(-40)});assert.equal(antigo.ritmo.anterior,null);
});

test('ciclo em andamento maior que o anterior não compara durações incompatíveis', t => {
  const {dia,salario,relatorio}=contexto(t);salario(dia(-10));salario(dia(-8));
  const r=relatorio();assert.equal(r.ritmo.anterior,null);assert.match(r.ritmo.motivo,/mais dias/);
});

test('ciclos completos usam seus intervalos completos e informam a duração de cada um', t => {
  const {dia,mov,salario,relatorio}=contexto(t);salario(dia(-75));salario(dia(-40));salario(dia(-10));
  mov('despesa',dia(-42),500);mov('despesa',dia(-12),800);
  const r=relatorio({periodo:dia(-40)});assert.equal(r.ritmo.tipo,'ciclos-completos');assert.equal(r.ritmo.atual.dias,30);assert.equal(r.ritmo.anterior.dias,35);
  assert.equal(r.ritmo.atual.saidas,800);assert.equal(r.ritmo.anterior.saidas,500);assert.equal(r.ritmo.diferenca,300);
});

test('janela de previsão expirada e atrasados de ciclos anteriores não se misturam ao orçamento atual', t => {
  const {dia,salario,pendente,relatorio}=contexto(t);salario(dia(-90));salario(dia(-45));pendente(dia(-60),800);pendente(dia(2),900);
  const r=relatorio();assert.equal(r.previsao,null);assert.equal(r.janela_previsao.fim,dia(-15));assert.equal(r.orcamento.previsto,0);
  assert.equal(r.atrasados.length,1);assert.equal(r.atrasados[0].incluido_na_previsao,false);assert.match(r.motivo_sem_previsao,/já terminou/);
});

test('consultar o relatório não modifica dados, inclusive faturas, compromissos e pagamentos', t => {
  const {banco,dia,salario,pendente,relatorio}=contexto(t);salario(dia(-5));pendente(dia(2),500);
  const nomes=banco.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(i=>i.name);
  const ler=()=>nomes.map(nome=>[nome,banco.prepare('SELECT * FROM '+nome+' ORDER BY rowid').all()]);
  const antes=ler();relatorio();relatorio({inicio:dia(-4),fim:dia(-1)});assert.deepEqual(ler(),antes);
});
