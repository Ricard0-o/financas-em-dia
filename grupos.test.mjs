import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { abrirBanco } from './banco.mjs';
import { migrarFamilias, resumoFinanceiro } from './migrar-familias.mjs';

const pasta = mkdtempSync(join(tmpdir(), 'financas-grupos-'));
const arquivo = join(pasta, 'teste.sqlite');
const senha = 'uma frase segura';
let servidor, url, admin, dono, membro, outro, grupo, grupoB, pedido, conta;
const identidades = {};
async function api(rota, dados, cookie = admin, status = 200, headers = {}) {
  const resposta = await fetch(url + '/api' + rota, { method: dados === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie ?? '', 'Content-Type': 'application/json', ...headers }, body: dados === undefined ? undefined : JSON.stringify(dados) });
  const json = await resposta.json();
  assert.equal(resposta.status, status, rota + ': ' + JSON.stringify(json));
  return { json, cookie: resposta.headers.get('set-cookie')?.split(';')[0] };
}
async function entrar(login, valor = senha) { return (await api('/login', { login, senha: valor }, '')).cookie; }
async function criar(login) {
  const { json } = await api('/admin/usuarios', { nome: login, login, senha, senha_admin: senha });
  identidades[login] = json.id;
  const cookie = await entrar(login);
  await api('/perfil/contatos', { email: login + '@example.com', telefone: '11900000001' }, cookie);
  return cookie;
}
before(async () => {
  servidor = spawn(process.execPath, [fileURLToPath(new URL('./servidor.mjs', import.meta.url))], {
    windowsHide: true, env: { ...process.env, FINANCAS_BANCO: arquivo, FINANCAS_PORTA: '0', FINANCAS_HOST: '127.0.0.1', FINANCAS_ORIGEM_PUBLICA: 'https://financas-teste.example', FINANCAS_PUSH_CONTATO: 'mailto:teste@example.com' }, stdio: ['ignore','pipe','inherit']
  });
  url = await new Promise((resolve, reject) => {
    let saida = '';
    servidor.stdout.on('data', b => { saida += b; const m = saida.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); });
    servidor.once('error', reject); servidor.once('exit', c => reject(Error('Servidor saiu: ' + c)));
  });
  await api('/perfis/inicializar', { nome: 'Admin', login: 'admin', senha }, '', 201);
  admin = await entrar('admin');
  await api('/perfil/contatos', { email: 'admin@example.com', telefone: '11900000002' });
  dono = await criar('dono'); membro = await criar('membro'); outro = await criar('outro');
});
after(async () => {
  if (servidor && servidor.exitCode === null) { const saiu = once(servidor, 'exit'); servidor.kill(); await saiu; }
  rmSync(pasta, { recursive: true, force: true });
});

test('cadastro requer autorização global, mínimo de oito caracteres e não troca a sessão', async () => {
  const dados = { nome: 'Novo', login: 'novo', senha, confirmacao_senha: senha, modo: 'criar', familia_nome: 'Nova', admin_login: 'admin', senha_admin: 'errada' };
  await api('/cadastro', dados, '', 403);
  await api('/cadastro', { ...dados, senha_admin: senha, senha: '1234', confirmacao_senha: '1234' }, '', 422);
  await api('/cadastro', { ...dados, senha_admin: senha }, '');
  assert.equal((await api('/sessao', undefined, dono)).json.login, 'dono');
  const nova = await entrar('novo');
  await api('/perfil/contatos', { email: 'novo@example.com', telefone: '11900000003' }, nova);
  assert.equal((await api('/grupo', undefined, nova)).json.familia.nome, 'Nova');
});

test('cadastro permite adiar a família sem código nem vínculo automático', async () => {
  const dados = { nome:'Acesso sem grupo',login:'semgrupo',senha,confirmacao_senha:senha,modo:'depois',admin_login:'admin',senha_admin:senha };
  await api('/cadastro',dados,'');
  const cookie = await entrar('semgrupo');
  await api('/perfil/contatos',{email:'semgrupo@example.com',telefone:'11900000004'},cookie);
  const grupo = (await api('/grupo',undefined,cookie)).json;
  assert.equal(grupo.familia,null);
  assert.equal(grupo.pedido,null);
  assert.equal((await api('/perfis',undefined,cookie)).json.perfis.length,1);
});

test('grupos e pedidos exigem vínculo e decisão do responsável correto', async () => {
  await api('/grupo/criar', { nome: 'A', admin_login: 'admin', senha_admin: senha }, dono);
  await api('/grupo/criar', { nome: 'B', admin_login: 'admin', senha_admin: senha }, outro);
  grupo = (await api('/grupo', undefined, dono)).json.familia;
  grupoB = (await api('/grupo', undefined, outro)).json.familia;
  pedido = (await api('/grupo/entrada', { codigo: grupo.codigo }, membro)).json.id;
  await api(`/grupo/entradas/${pedido}`, { decisao: 'aprovado', senha_atual: senha }, outro, 404);
  await api(`/grupo/entradas/${pedido}`, { decisao: 'aprovado', senha_atual: senha }, membro, 404);
  await api(`/grupo/entradas/${pedido}`, { decisao: 'aprovado', senha_atual: senha }, dono);
  await api(`/grupo/entradas/${pedido}`, { decisao: 'aprovado', senha_atual: senha }, dono, 409);
  assert.equal((await api('/grupo', undefined, membro)).json.familia.id, grupo.id);
  assert.deepEqual((await api('/perfis', undefined, '')).json.perfis, []);
  const perfis = (await api('/perfis', undefined, membro)).json.perfis;
  assert.deepEqual(perfis.map(p => p.id).sort(), [identidades.dono, identidades.membro].sort());
  assert.ok(!JSON.stringify(perfis).includes('example.com'));
});

test('responsável consulta só com consentimento, não escreve e perde acesso após revogação', async () => {
  conta = (await api('/contas', { nome: 'Privada', tipo: 'conta', saldo_inicial: 12345, inicio: '2026-01-01', chave: 'conta' }, membro)).json.id;
  const cabecalho = { 'X-Financas-Perfil': String(identidades.membro) };
  await api('/base', undefined, dono, 403, cabecalho);
  await api('/grupo/consentimento', { permitir: true, senha_atual: senha }, membro);
  const banco = abrirBanco(arquivo);
  const antes = resumoFinanceiro(banco);
  for (const rota of ['/base','/painel','/cartoes','/compromissos','/relatorios','/periodos',`/contas/${conta}`]) await api(rota, undefined, dono, 200, cabecalho);
  assert.deepEqual(resumoFinanceiro(banco), antes, 'consulta não altera tabelas financeiras');
  banco.close();
  for (const rota of ['/contas','/lancamentos','/compras','/salarios','/categorias','/painel/conta-destaque','/grupo/consentimento','/perfil/aparencia','/admin/usuarios']) {
    await api(rota, { nome: 'invasão' }, dono, 403, cabecalho);
  }
  await api('/base', undefined, outro, 403, cabecalho);
  await api('/grupo/consentimento', { permitir: false, senha_atual: senha }, membro);
  await api('/base', undefined, dono, 403, cabecalho);
  assert.equal((await api('/base', undefined, membro)).json.contas[0].saldo, 12345);
});

test('admin depende de pedido aprovado pelo titular, por 24h, somente leitura e revogável', async () => {
  const cabecalho = { 'X-Financas-Perfil': String(identidades.membro) };
  await api('/base', undefined, admin, 403, cabecalho);
  const id = (await api('/acessos/solicitar', { usuario: identidades.membro, justificativa: 'Suporte', senha_atual: senha })).json.id;
  assert.equal((await api('/notificacoes', undefined, membro)).json.internas.acessos[0].id, id);
  await api('/base', undefined, admin, 403, cabecalho);
  await api(`/acessos/${id}`, { decisao: 'aprovado', senha_atual: senha }, admin, 404);
  await api(`/acessos/${id}`, { decisao: 'aprovado', senha_atual: senha }, outro, 404);
  const antes = Date.now();
  await api(`/acessos/${id}`, { decisao: 'aprovado', senha_atual: senha }, membro);
  const concessao = (await api('/notificacoes', undefined, membro)).json.internas.acessos[0];
  assert.ok(concessao.expira >= antes + 86_400_000 && concessao.expira <= Date.now() + 86_400_000);
  await api('/base', undefined, admin, 200, cabecalho);
  await api('/lancamentos', {}, admin, 403, cabecalho);
  await api(`/acessos/${id}`, { decisao: 'revogado', senha_atual: senha }, membro);
  await api('/base', undefined, admin, 403, cabecalho);
  const novo = (await api('/acessos/solicitar', { usuario: identidades.membro, justificativa: 'Outro suporte', senha_atual: senha })).json.id;
  await api(`/acessos/${novo}`, { decisao: 'aprovado', senha_atual: senha }, membro);
  const db = abrirBanco(arquivo); db.prepare('UPDATE acessos_financeiros SET expira=? WHERE id=?').run(Date.now()-1, novo); db.close();
  await api('/base', undefined, admin, 403, cabecalho);
});

test('transferir responsabilidade invalida consentimentos e pedidos; sair preserva finanças', async () => {
  await api('/grupo/consentimento', { permitir: true, senha_atual: senha }, membro);
  await api('/grupo/transferir', { usuario: identidades.membro, senha_atual: senha }, dono);
  const depois = (await api('/grupo', undefined, membro)).json;
  assert.equal(depois.familia.responsavel, identidades.membro);
  assert.notEqual(depois.familia.codigo, grupo.codigo);
  await api('/base', undefined, dono, 403, { 'X-Financas-Perfil': String(identidades.membro) });
  await api('/grupo/transferir', { usuario: identidades.dono, senha_atual: senha }, membro);
  await api('/grupo/sair', { senha_atual: senha }, membro);
  assert.equal((await api('/grupo', undefined, membro)).json.familia, null);
  assert.equal((await api('/base', undefined, membro)).json.contas[0].saldo, 12345);
});

test('recuperação não enumera contas, exige verificação externa e código expira e só funciona uma vez', async () => {
  const resposta = (await api('/recuperacao/solicitar', { login: 'naoexiste' }, '')).json;
  assert.deepEqual((await api('/recuperacao/solicitar', { login: 'membro' }, '')).json, resposta);
  const id = (await api('/admin')).json.recuperacoes.find(p => p.login === 'membro').id;
  await api('/admin/recuperacoes/liberar', { id, senha_atual: senha, identidade_confirmada: false, canal: 'email' }, admin, 422);
  await api('/admin/recuperacoes/liberar', { id, senha_atual: senha, identidade_confirmada: true, canal: 'email' }, dono, 403);
  const contato = abrirBanco(arquivo);
  contato.prepare('UPDATE usuarios SET email=? WHERE id=?').run('alterado@example.com',identidades.membro);
  await api('/admin/recuperacoes/liberar',{id,senha_atual:senha,identidade_confirmada:true,canal:'email'},admin,409);
  contato.prepare('UPDATE usuarios SET email=? WHERE id=?').run('membro@example.com',identidades.membro);contato.close();
  const liberacao = (await api('/admin/recuperacoes/liberar', { id, senha_atual: senha, identidade_confirmada: true, canal: 'email' })).json;
  const nova = 'minha nova frase';
  await api('/recuperacao/concluir', { token: liberacao.token, senha: nova, confirmacao_senha: 'outra' }, '', 422);
  await api('/recuperacao/concluir', { token: liberacao.token, senha: nova, confirmacao_senha: nova }, '');
  await api('/recuperacao/concluir', { token: liberacao.token, senha: nova, confirmacao_senha: nova }, '', 403);
  await api('/sessao', undefined, membro, 401);
  membro = await entrar('membro', nova);
  const db = abrirBanco(arquivo);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM eventos_seguranca').all()).includes(liberacao.token));
  assert.equal(db.prepare('SELECT token_hash FROM recuperacoes WHERE id=?').get(id).token_hash, null);
  db.close();
});

test('arquivos internos, SQL injection, origem externa e destinos SSRF são rejeitados', async () => {
  for (const caminho of ['/dados/financas.sqlite','/configuracao-local.json','/.backup-grupos.json','/../acesso.mjs']) assert.equal((await fetch(url+caminho)).status, 404);
  await api('/login', { login: "x' OR '1'='1", senha }, '', 422);
  await api('/tema', { tema: 'escuro' }, dono, 403, { Origin: 'https://invasor.example' });
  await api('/notificacoes/ativar', { endpoint: 'http://127.0.0.1:8091', keys: { p256dh: '-', auth: '-' } }, dono, 422);
});

test('expiração e recusa de pedidos não concedem acesso; bloqueio de tentativas e recuperação expirada', async () => {
  const id = (await api('/acessos/solicitar', { usuario: identidades.dono, justificativa: 'Teste de recusa', senha_atual: senha })).json.id;
  await api(`/acessos/${id}`, { decisao: 'recusado', senha_atual: senha }, dono);
  await api('/base', undefined, admin, 403, { 'X-Financas-Perfil': String(identidades.dono) });
  const entrada = (await api('/grupo/entrada', { codigo: grupoB.codigo }, membro)).json.id;
  const db = abrirBanco(arquivo);
  db.prepare('UPDATE pedidos_entrada SET expira=? WHERE id=?').run(Date.now()-1, entrada);
  await api(`/grupo/entradas/${entrada}`, { decisao: 'aprovado', senha_atual: senha }, outro, 409);
  assert.equal((await api('/grupo', undefined, membro)).json.familia, null);
  // Simular a passagem do prazo sem aguardar 15 minutos no teste.
  db.prepare('UPDATE recuperacoes SET criada_em=? WHERE usuario=?').run(Date.now()-900_001, identidades.membro);
  await api('/recuperacao/solicitar', { login: 'membro' }, '');
  const recuperacao = (await api('/admin')).json.recuperacoes.find(p=>p.login==='membro');
  const codigo = (await api('/admin/recuperacoes/liberar', { id:recuperacao.id, senha_atual:senha, identidade_confirmada:true, canal:'telefone' })).json.token;
  db.prepare('UPDATE recuperacoes SET expira=? WHERE id=?').run(Date.now()-1,recuperacao.id);
  await api('/recuperacao/concluir', { token:codigo,senha:'uma outra senha',confirmacao_senha:'uma outra senha' }, '',403);
  for(let i=0;i<15;i++) await api('/login',{login:'dono',senha:'errada'},'',401);
  await api('/login',{login:'dono',senha},'',429);
  db.close();
});

test('sessões têm prazo absoluto de 7 dias e senhas antigas de quatro caracteres ainda autenticam', async () => {
  const db = abrirBanco(arquivo);
  const sal = randomBytes(16).toString('hex');
  const legado = scryptSync('1234', Buffer.from(sal,'hex'), 64, { N:32768,r:8,p:1,maxmem:64*1024*1024 }).toString('hex');
  db.prepare('UPDATE usuarios SET senha=? WHERE id=?').run(sal+':'+legado, identidades.outro);
  const cookie = await entrar('outro','1234');
  const sessao = db.prepare('SELECT inicio,expira FROM sessoes WHERE usuario=? ORDER BY inicio DESC LIMIT 1').get(identidades.outro);
  assert.equal(sessao.expira-sessao.inicio,7*86_400_000);
  db.prepare('UPDATE sessoes SET expira=? WHERE usuario=?').run(Date.now()-1, identidades.outro); db.close();
  await api('/sessao', undefined, cookie, 401);
});

test('migração realista é idempotente e preserva dados financeiros, senhas e logins', () => {
  const db = abrirBanco(join(pasta, 'migracao.sqlite'));
  try {
    for (const [id,login,admin] of [[1,'admin',1],[2,'texte',0],[3,'ricardonelber',0],[4,'isabellamacedo',0],[5,'ricardonascimento',0],[6,'lais',0],[7,'silveira',0]]) {
      db.prepare('INSERT INTO usuarios(id,nome,login,senha,admin,ativo) VALUES (?,?,?,?,?,?)').run(id,login,login,'hash-legado',admin,id===2?0:1);
    }
    db.prepare("INSERT INTO contas(usuario,nome,tipo,saldo_inicial,inicio) VALUES (3,'Conta','conta',1234,'2026-01-01')").run();
    const antes = resumoFinanceiro(db);
    assert.equal(migrarFamilias(db).simulacao, true);
    assert.equal(migrarFamilias(db,true).financeiro_preservado,true);
    assert.deepEqual(resumoFinanceiro(db),antes);
    assert.deepEqual({ ...db.prepare('SELECT nome,login,senha,ativo FROM usuarios WHERE id=2').get() }, { nome:'Conta Teste',login:'texte',senha:'hash-legado',ativo:1 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM familias').get().n,3);
    assert.equal(migrarFamilias(db,true).ja_aplicada,true);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});
