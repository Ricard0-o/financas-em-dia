import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { abrirBanco } from './banco.mjs';
import { prepararCompras } from './compras-schema.mjs';

const pasta = mkdtempSync(join(tmpdir(), 'financas-compras-'));
const arquivo = join(pasta, 'teste.sqlite');
const senha = 'compras de teste';
let servidor, url, cookie, outro, conta, categoria;
async function api(rota, dados, sessao = cookie, status = 200, headers = {}) {
  const resposta = await fetch(url + '/api' + rota, { method: dados === undefined ? 'GET' : 'POST',
    headers: { Cookie: sessao ?? '', 'Content-Type':'application/json', ...headers },
    body: dados === undefined ? undefined : JSON.stringify({ chave: randomUUID(), ...dados }) });
  const json = await resposta.json();
  assert.equal(resposta.status, status, rota + ': ' + JSON.stringify(json));
  return { dados: json, cookie: resposta.headers.get('set-cookie')?.split(';')[0] };
}
const get = async (rota, sessao = cookie) => (await api(rota, undefined, sessao)).dados;
const post = async (rota, dados, sessao = cookie, status = 200) => (await api(rota, dados, sessao, status)).dados;
async function cartao(nome, fechamento = 20, vencimento = 31) {
  return (await post('/cartoes',{nome,fechamento,vencimento,limite:100000})).id;
}
async function compra(cartao, extra = {}) {
  return (await post('/compras',{cartao,categoria,data:'2024-01-05',descricao:'Compra de teste',valor:10001,parcelas:3,...extra})).id;
}
async function salvar(id, dados) {
  const previa = await post(`/compras/${id}/previa`, dados);
  return post(`/compras/${id}`, {...dados,revisao:previa.revisao,confirmar:true});
}
const dadosEdicao = compra => ({cartao:compra.cartao,categoria:compra.categoria,data:compra.data,descricao:compra.descricao,valor:compra.valor_pendente,parcelas:compra.parcelas});
before(async () => {
  servidor = spawn(process.execPath,[fileURLToPath(new URL('./servidor.mjs',import.meta.url))],{windowsHide:true,
    env:{...process.env,FINANCAS_BANCO:arquivo,FINANCAS_PORTA:'0',FINANCAS_HOST:'127.0.0.1',FINANCAS_ORIGEM_PUBLICA:'',FINANCAS_PUSH_CONTATO:''},stdio:['ignore','pipe','inherit']});
  url = await new Promise((resolve,reject)=>{let texto='';servidor.stdout.on('data',b=>{texto+=b;const m=texto.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});servidor.once('error',reject);servidor.once('exit',c=>reject(Error('Servidor encerrou '+c)));});
  await post('/perfis/inicializar',{nome:'Titular',login:'titular',senha},'',201);
  cookie = (await api('/login',{login:'titular',senha},'')).cookie;
  await post('/perfil/contatos',{email:'titular@example.com',telefone:'11900000001'});
  await post('/admin/usuarios',{nome:'Outro',login:'outro',senha,senha_admin:senha});
  outro = (await api('/login',{login:'outro',senha},'')).cookie;
  await post('/perfil/contatos',{email:'outro@example.com',telefone:'11900000002'},outro);
  conta = (await post('/contas',{nome:'Conta',tipo:'conta',inicio:'2024-01-01',saldo_inicial:1000000})).id;
  categoria = (await post('/categorias',{nome:'Compras'})).id;
});
after(async () => {if(servidor&&servidor.exitCode===null){const saiu=once(servidor,'exit');servidor.kill();await saiu;}rmSync(pasta,{recursive:true,force:true});});

test('trocar cartão, data e parcelas redistribui centavos e atualiza faturas sem duplicar', async () => {
  const a=await cartao('Origem');const b=await cartao('Destino',10,15);
  const id=await compra(a);const original=await get(`/compras/${id}`);
  assert.equal(original.itens.length,3);assert.equal(original.valor,10001);
  const dados={...dadosEdicao(original),cartao:b,valor:12002,parcelas:4};
  const previa=await post(`/compras/${id}/previa`,dados);
  assert.deepEqual(previa.novos.map(i=>i.valor),[3001,3001,3000,3000]);
  assert.equal(previa.limites.find(c=>c.cartao===a).disponivel_depois,100000);
  assert.equal(previa.limites.find(c=>c.cartao===b).disponivel_depois,87998);
  assert.deepEqual(previa.novos.map(i=>i.vencimento),['2024-01-15','2024-02-15','2024-03-15','2024-04-15']);
  assert.ok(previa.impactos.filter(i=>i.cartao===a).every(i=>i.depois===0));
  const chave=randomUUID();const confirmacao={...dados,revisao:previa.revisao,confirmar:true,chave};
  await post(`/compras/${id}`,confirmacao);await post(`/compras/${id}`,confirmacao);
  const final=await get(`/compras/${id}`);
  assert.equal(final.itens.length,4);assert.equal(final.valor,12002);assert.ok(final.itens.every(i=>i.cartao===b));
  const cartoes=await get('/cartoes');
  assert.equal(cartoes.cartoes.find(c=>c.id===a).usado,0);assert.equal(cartoes.cartoes.find(c=>c.id===b).usado,12002);
  assert.ok(!(await get('/compromissos')).faturas.some(f=>f.cartao===a));
  await api(`/compras/${id}`,undefined,outro,404);
  await post(`/compras/${id}/previa`,dados,outro,404);
  await api(`/compras/${id}`,dados,outro,403,{'X-Financas-Perfil':'1'});
});

test('corrigir descrição e valor mantém faturas com datas próprias mesmo após alterar o cartão', async () => {
  const c=await cartao('Datas preservadas');const id=await compra(c);const antes=await get(`/compras/${id}`);
  await post(`/faturas/${antes.itens[0].fatura}/datas`,{fechamento:'2024-01-12',vencimento:'2024-01-22'});
  await post(`/cartoes/${c}`,{nome:'Datas preservadas',limite:100000,fechamento:25,vencimento:28});
  const atualizado=await get(`/compras/${id}`);
  await salvar(id,{...dadosEdicao(atualizado),descricao:'Descrição corrigida',valor:10004});
  const depois=await get(`/compras/${id}`);
  assert.deepEqual(depois.itens.map(i=>i.fatura),antes.itens.map(i=>i.fatura));
  assert.equal(depois.itens[0].fechamento,'2024-01-12');assert.equal(depois.itens[0].vencimento,'2024-01-22');
  assert.deepEqual(depois.itens.map(i=>i.valor),[3335,3335,3334]);
  assert.ok(depois.itens.every(i=>i.descricao==='Descrição corrigida'));
});

test('exclusão exige senha, confirmação e revisão atual; remove a compra inteira sem mexer no saldo', async () => {
  const c=await cartao('Excluir');const id=await compra(c,{parcelas:1,valor:900});
  const saldo=(await get('/base')).contas.find(c=>c.id===conta).saldo;
  let previa=await post(`/compras/${id}/previa-exclusao`,{});
  await post(`/compras/${id}/excluir`,{revisao:previa.revisao,confirmar:true,senha:'errada'},cookie,403);
  await post(`/compras/${id}/excluir`,{revisao:previa.revisao,confirmar:false,senha},cookie,422);
  await post(`/compras/${id}/excluir`,{revisao:previa.revisao,confirmar:true,senha},outro,404);
  const outra=await compra(c,{parcelas:1,valor:100,descricao:'Outra compra'});
  await post(`/compras/${id}/excluir`,{revisao:previa.revisao,confirmar:true,senha},cookie,409);
  previa=await post(`/compras/${id}/previa-exclusao`,{});
  const dados={revisao:previa.revisao,confirmar:true,senha,chave:randomUUID()};
  const resultado=await post(`/compras/${id}/excluir`,dados);
  assert.equal(resultado.parcelas_excluidas,1);assert.deepEqual(await post(`/compras/${id}/excluir`,dados),resultado);
  await api(`/compras/${id}`,undefined,cookie,404);
  assert.equal((await get(`/compras/${outra}`)).valor,100);
  assert.equal((await get('/cartoes')).cartoes.find(x=>x.id===c).usado,100);
  assert.equal((await get('/base')).contas.find(c=>c.id===conta).saldo,saldo);
});

test('parcelas pagas ficam intactas ao mover e depois excluir somente as pendentes', async () => {
  const a=await cartao('Parcial origem');const b=await cartao('Parcial destino',10,15);const id=await compra(a);
  const inicial=await get(`/compras/${id}`);const fatura=inicial.itens[0].fatura;
  await post(`/faturas/${fatura}`,{conta,data:'2024-01-21',valor:inicial.itens[0].valor});
  const parcial=await get(`/compras/${id}`);const paga=parcial.itens[0];
  const banco=abrirBanco(arquivo);const pagamento=banco.prepare('SELECT * FROM lancamentos WHERE id=?').get(paga.pagamento);banco.close();
  const saldo=(await get('/base')).contas.find(c=>c.id===conta).saldo;
  const dados={...dadosEdicao(parcial),cartao:b,valor:4001,descricao:'Pendentes corrigidas'};
  await post(`/compras/${id}/previa`,{...dados,parcelas:4},cookie,409);
  await post(`/compras/${id}/previa`,{...dados,data:'2024-01-06'},cookie,409);
  await salvar(id,dados);
  let depois=await get(`/compras/${id}`);
  assert.deepEqual(depois.itens[0],paga);
  assert.deepEqual(depois.itens.slice(1).map(i=>[i.cartao,i.numero,i.valor]),[[b,2,2001],[b,3,2000]]);
  const previa=await post(`/compras/${id}/previa-exclusao`,{});assert.equal(previa.escopo,'pendentes');
  const resultado=await post(`/compras/${id}/excluir`,{confirmar:true,revisao:previa.revisao,senha});
  assert.equal(resultado.parcelas_excluidas,2);assert.equal(resultado.parcelas_pagas_preservadas,1);
  depois=await get(`/compras/${id}`);assert.deepEqual(depois.itens,[paga]);
  const conferir=abrirBanco(arquivo);assert.deepEqual(conferir.prepare('SELECT * FROM lancamentos WHERE id=?').get(paga.pagamento),pagamento);conferir.close();
  assert.equal((await get('/base')).contas.find(c=>c.id===conta).saldo,saldo);
  await post(`/compras/${id}/previa-exclusao`,{},cookie,409);
});

test('pagamento concorrente invalida a confirmação e fatura de destino quitada não recebe compra', async () => {
  const a=await cartao('Concorrência origem');const b=await cartao('Concorrência destino',10,15);const id=await compra(a);
  const original=await get(`/compras/${id}`);const dados={...dadosEdicao(original),cartao:b};
  const previa=await post(`/compras/${id}/previa`,dados);
  await post(`/faturas/${original.itens[0].fatura}`,{conta,data:'2024-01-21',valor:original.itens[0].valor});
  await post(`/compras/${id}`,{...dados,revisao:previa.revisao,confirmar:true},cookie,409);
  const bloqueadora=await compra(b,{data:'2024-01-21',parcelas:1,valor:500});
  const fatura=(await get(`/compras/${bloqueadora}`)).itens[0];
  await post(`/faturas/${fatura.fatura}`,{conta,data:'2024-02-11',valor:500});
  const parcial=await get(`/compras/${id}`);
  await post(`/compras/${id}/previa`,{...dadosEdicao(parcial),cartao:b},cookie,409);
  assert.deepEqual((await get(`/compras/${id}`)).itens,parcial.itens);
});

test('falha na reinserção desfaz remoção, novas faturas e operação inteira', async () => {
  const a=await cartao('Rollback origem');const b=await cartao('Rollback destino',10,15);const id=await compra(a);
  const antes=await get(`/compras/${id}`);const dados={...dadosEdicao(antes),cartao:b,descricao:'Falha controlada'};
  const previa=await post(`/compras/${id}/previa`,dados);
  const banco=abrirBanco(arquivo);
  banco.exec("CREATE TRIGGER simular_falha_compra BEFORE INSERT ON itens_cartao WHEN NEW.descricao='Falha controlada' BEGIN SELECT RAISE(ABORT,'falha simulada'); END;");
  await post(`/compras/${id}`,{...dados,revisao:previa.revisao,confirmar:true},cookie,500);
  banco.exec('DROP TRIGGER simular_falha_compra');banco.close();
  assert.deepEqual(await get(`/compras/${id}`),antes);
  assert.equal((await get('/cartoes')).cartoes.find(c=>c.id===b).usado,0);
  await salvar(id,{...dados,descricao:'Correção após rollback'});
});

test('migração distingue compras antigas idênticas e isola parcela incompleta sem mudar os dados', () => {
  const banco=abrirBanco(join(pasta,'legado.sqlite'));
  try {
    banco.exec("INSERT INTO usuarios(id,nome,login,senha,admin) VALUES (1,'Legado','legado','hash',0); INSERT INTO categorias(id,usuario,nome) VALUES (1,1,'Categoria'); INSERT INTO cartoes(id,usuario,nome,limite,fechamento,vencimento) VALUES (1,1,'Cartão',100000,10,20);");
    for(let n=1;n<=3;n++)banco.prepare('INSERT INTO faturas(id,usuario,cartao,fechamento,vencimento) VALUES (?,1,1,?,?)').run(n,`2024-0${n}-10`,`2024-0${n}-20`);
    for(let compra=0;compra<2;compra++)for(let n=1;n<=3;n++)banco.prepare("INSERT INTO itens_cartao(usuario,fatura,data,descricao,valor,categoria,numero,parcelas) VALUES (1,?,'2024-01-01','Mesmo nome',?,1,?,3)").run(n,n===3?3333:3334,n);
    banco.exec("INSERT INTO itens_cartao(usuario,fatura,data,descricao,valor,categoria,numero,parcelas) VALUES (1,2,'2024-01-01','Incompleta',100,1,2,3)");
    const antes=banco.prepare('SELECT id,usuario,fatura,data,descricao,valor,categoria,numero,parcelas,ocorrencia FROM itens_cartao ORDER BY id').all();
    prepararCompras(banco);prepararCompras(banco);
    assert.deepEqual(banco.prepare('SELECT id,usuario,fatura,data,descricao,valor,categoria,numero,parcelas,ocorrencia FROM itens_cartao ORDER BY id').all(),antes);
    assert.equal(banco.prepare('SELECT COUNT(*) AS n FROM compras_cartao').get().n,3);
    assert.equal(banco.prepare('SELECT COUNT(*) AS n FROM compras_cartao WHERE completa=1').get().n,2);
    assert.deepEqual(banco.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { banco.close(); }
});
