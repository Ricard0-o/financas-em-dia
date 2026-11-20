import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { request as requisicaoHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { abrirBanco } from './banco.mjs';
import { atualizarRecorrencias, pendencias } from './compromissos.mjs';
import { criptografar, iniciarNotificacoes } from './notificacoes.mjs';
import { enderecoParaCelular, enderecosDaRede } from './rede.mjs';
import { hoje, somarDias } from './validacao.mjs';
import { contextoDaRequisicao, validarOrigemPublica } from './origens.mjs';
import { lerSessao, removerDadosDoPerfil } from './acesso.mjs';

const senha = '01234567';
const pasta = mkdtempSync(join(tmpdir(), 'financas-aceite-'));
const caminho = join(pasta, 'aceite.sqlite');
const modulo = nome => fileURLToPath(new URL(nome, import.meta.url));
const env = { ...process.env, FINANCAS_BANCO: caminho, FINANCAS_HOST: '127.0.0.1', FINANCAS_PORTA: '0',
  FINANCAS_TLS_CHAVE: '', FINANCAS_TLS_CERT: '', FINANCAS_PUSH_CONTATO: '',
  FINANCAS_ORIGEM_PUBLICA: 'https://financeiro-teste.example' };
let servidor, endereco, alice, bruno, idAlice;
const origem = { categoria: 0, conta: 0, despesa: 0, fatura: 0 };

before(async () => {
  servidor = spawn(process.execPath, [modulo('servidor.mjs')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  endereco = await new Promise((resolver, rejeitar) => {
    let saida = '';
    servidor.stdout.setEncoding('utf8');
    servidor.stdout.on('data', trecho => {
      saida += trecho;
      const url = saida.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) resolver(url);
    });
    servidor.once('error', rejeitar);
    servidor.once('exit', codigo => rejeitar(new Error(`Servidor encerrou com código ${codigo}`)));
  });
  assert.deepEqual(await chamar('/perfis', undefined, ''), { perfis: [], inicializar: true });
  const cadastro = { login: 'alice', nome: 'Alice fictícia', senha };
  const statusHostExterno = await new Promise((resolver, rejeitar) => {
    const requisicao = requisicaoHttp(`${endereco}/api/perfis/inicializar`, {
      method: 'POST', headers: { Host: 'outro.invalid', 'Content-Type': 'application/json' }
    }, resposta => {
      resposta.resume();
      resolver(resposta.statusCode);
    });
    requisicao.on('error', rejeitar);
    requisicao.end(JSON.stringify(cadastro));
  });
  assert.equal(statusHostExterno, 403);
  idAlice = (await chamar('/perfis/inicializar', cadastro, '', 201)).id;
  await chamar('/perfis/inicializar', cadastro, '', 409);
  alice = await login({ perfil: idAlice, senha });
  await chamar('/perfil/contatos', { email: 'alice@example.com', telefone: '(11) 90000-0001' });
  const idBruno = (await chamar('/admin/usuarios', { login: 'bruno', nome: 'Bruno fictício', senha, senha_admin: senha })).id;
  bruno = await login({ perfil: idBruno, senha });
  await chamar('/perfil/contatos', { email: 'bruno@example.com', telefone: '(11) 90000-0002' }, bruno);
});

after(async () => {
  if (servidor && servidor.exitCode === null && servidor.signalCode === null) {
    const saiu = once(servidor, 'exit');
    servidor.kill();
    await saiu;
  }
  rmSync(pasta, { recursive: true, force: true });
});

async function login(credenciais, status = 200) {
  const dados = typeof credenciais === 'string' ? { login: credenciais, senha } : credenciais;
  const resposta = await fetch(`${endereco}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
  });
  assert.equal(resposta.status, status);
  return resposta.headers.get('set-cookie')?.split(';')[0];
}

async function chamar(rota, dados, cookie = alice, status = 200, cabecalhos = {}) {
  const resposta = await fetch(`${endereco}/api${rota}`, {
    method: dados === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...cabecalhos },
    body: dados === undefined ? undefined : JSON.stringify({ chave: randomUUID(), ...dados, ...(rota.startsWith('/admin/usuarios') || rota === '/admin/atividade' ? { senha_admin: senha } : {}) })
  });
  const json = await resposta.json();
  assert.equal(resposta.status, status, `${rota}: ${JSON.stringify(json)}`);
  return json;
}

test('origem pública mantém CSRF, cookie HTTPS e separação do acesso local', async () => {
  const publica = 'https://financeiro-teste.example';
  const credenciais = { perfil: idAlice, senha };
  const requisitar = (rota, dados, headers = {}) => new Promise((resolve, reject) => {
    const req = requisicaoHttp(endereco + '/api' + rota, {
      method: dados === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    }, res => {
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', parte => { corpo += parte; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, dados: JSON.parse(corpo) }));
    });
    req.on('error', reject);
    req.end(dados === undefined ? undefined : JSON.stringify(dados));
  });
  const hostPublico = { Host: 'financeiro-teste.example', Origin: publica };
  for (const origem of ['https://invasor.example', 'null', 'http://financeiro-teste.example', publica + '.invasor.example']) {
    assert.equal((await requisitar('/login', credenciais, { ...hostPublico, Origin: origem })).status, 403);
  }
  assert.equal((await requisitar('/login', credenciais, {
    ...hostPublico, 'Sec-Fetch-Site': 'cross-site'
  })).status, 403);
  assert.equal((await requisitar('/login', credenciais, {
    Origin: publica, 'X-Forwarded-Host': 'financeiro-teste.example', 'X-Forwarded-Proto': 'https'
  })).status, 403);
  const loginPublico = await requisitar('/login', credenciais, {
    ...hostPublico, 'X-Forwarded-Host': 'invasor.example', 'X-Forwarded-Proto': 'http'
  });
  assert.equal(loginPublico.status, 200);
  const setCookie = loginPublico.headers['set-cookie'][0];
  assert.match(setCookie, /^__Host-financas_sessao=/);
  for (const atributo of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(atributo));
  assert.ok(!setCookie.includes('Domain='));
  const Cookie = setCookie.split(';')[0];
  for (let i = 0; i < 2; i++) {
    const sessao = await requisitar('/sessao', undefined, { Host: hostPublico.Host, Cookie });
    assert.equal(sessao.status, 200);
    assert.equal(sessao.dados.id, idAlice);
  }
  assert.equal((await requisitar('/sessao', undefined, { Host: hostPublico.Host, Cookie: alice })).status, 401);
  assert.equal((await requisitar('/sair', {}, { ...hostPublico, Cookie, Origin: 'https://invasor.example' })).status, 403);
  assert.equal((await requisitar('/sessao', undefined, { Host: hostPublico.Host, Cookie })).status, 200);
  const logout = await requisitar('/sair', {}, { ...hostPublico, Cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0; Secure/);
  assert.equal((await requisitar('/sessao', undefined, { Host: hostPublico.Host, Cookie })).status, 401);
  const loginLocal = await requisitar('/login', credenciais, {
    Origin: endereco, 'X-Forwarded-Host': hostPublico.Host, 'X-Forwarded-Proto': 'https'
  });
  assert.equal(loginLocal.status, 200);
  assert.match(loginLocal.headers['set-cookie'][0], /^financas_sessao=/);
  assert.ok(!loginLocal.headers['set-cookie'][0].includes('Secure'));
  await requisitar('/sair', {}, { Origin: endereco, Cookie: loginLocal.headers['set-cookie'][0].split(';')[0] });
});

test('configuração exige origem HTTPS explícita e proxy público local', () => {
  for (const valor of ['*', 'null', 'http://banco.example', 'https://banco.example/caminho', 'https://user:senha@banco.example',
    'https://banco.example?teste=1', 'https://banco.example#fragmento']) {
    assert.throws(() => validarOrigemPublica(valor), { status: 422 });
  }
  assert.equal(validarOrigemPublica(''), null);
  const publica = validarOrigemPublica('https://banco.example/');
  assert.equal(publica.origin, 'https://banco.example');
  const req = { headers: { host: publica.host }, socket: { remoteAddress: '192.168.0.10' } };
  assert.throws(() => contextoDaRequisicao(req, false, publica), { status: 403 });
  assert.equal(contextoDaRequisicao(req, true, publica).seguro, true);
  req.headers.host = '192.168.0.20:8091';
  assert.equal(contextoDaRequisicao(req, false, publica).origem, 'http://192.168.0.20:8091');
});

test('perfil mantém a senha até aprovação administrativa de solicitação justificada', async () => {
  const id = (await chamar('/admin/usuarios', { nome: 'Perfil de teste', login: 'perfilteste', senha })).id;
  const atual = await login({ perfil: id, senha });
  const outra = await login({ perfil: id, senha });
  assert.equal((await chamar('/sessao', undefined, atual)).contatos_pendentes, true);
  await chamar('/painel', undefined, atual, 428);
  await chamar('/perfil/contatos', { email: 'invalido', telefone: '11900000003' }, atual, 422);
  await chamar('/perfil/contatos', { email: 'perfil@example.com', telefone: '123' }, atual, 422);
  await chamar('/perfil/contatos', {
    id: idAlice, email: 'perfil@example.com', telefone: '(11) 90000-0003', avisos_email: true, avisos_sms: 'on', avisos_whatsapp: true
  }, atual);
  const contato = await chamar('/sessao', undefined, atual);
  assert.equal(contato.email, 'perfil@example.com');
  assert.equal(contato.telefone, '+5511900000003');
  assert.equal(contato.contatos_pendentes, false);
  assert.equal(contato.avisos_whatsapp, 1);
  assert.equal((await chamar('/sessao')).email, 'alice@example.com');
  await chamar('/perfil/contatos', { email: 'novo@example.com', telefone: '11900000003' }, atual, 409);
  const dados = { nome: 'Perfil atualizado', login: 'perfilnovo', senha_atual: senha };
  await chamar('/perfil', { ...dados, senha_atual: 'errada' }, atual, 403);
  await chamar('/perfil', { ...dados, login: 'alice' }, atual, 409);
  await chamar('/perfil', { ...dados, id: idAlice, admin: true }, atual);
  await chamar('/perfil', { ...dados, email: 'alterado@example.com', telefone: '11900000004', avisos_sms: true }, atual);
  assert.equal((await chamar('/sessao', undefined, atual)).email, 'alterado@example.com');
  const sessao = await chamar('/sessao', undefined, atual);
  assert.equal(sessao.id, id);
  assert.equal(sessao.nome, dados.nome);
  assert.equal(sessao.login, dados.login);
  assert.equal(sessao.admin, 0);
  assert.equal((await chamar('/sessao', undefined, outra)).id, id);
  assert.equal((await chamar('/sessao')).login, 'alice');
  await chamar('/perfil', { ...dados, senha: 'nova1234' }, atual, 403);
  const rota = '/perfil/solicitacoes-senha';
  const pedido = { senha_atual: senha, senha: 'nova1234', confirmacao_senha: 'nova1234', justificativa: 'Troca de senha para minha conta.' };
  await chamar(rota, { ...pedido, confirmacao_senha: 'diferente' }, atual, 422);
  await chamar(rota, { ...pedido, confirmacao_senha: undefined }, atual, 422);
  await chamar(rota, { ...pedido, justificativa: '' }, atual, 422);
  await chamar(rota, { ...pedido, senha_atual: 'errada' }, atual, 403);
  await chamar(rota, { ...pedido, senha: '123' }, atual, 422);
  const recusada = (await chamar(rota, pedido, atual)).id;
  await chamar(rota, pedido, atual, 409);
  const decisao = `/admin/solicitacoes-senha/${recusada}`;
  await chamar(decisao, { decisao: 'aprovada', senha_atual: senha }, atual, 403);
  const meusPedidos = await chamar(rota, undefined, atual);
  assert.ok(!JSON.stringify(meusPedidos).includes('senha_hash'));
  assert.equal((await chamar(rota, undefined, bruno)).solicitacoes.length, 0);
  await chamar(decisao, { decisao: 'recusada', senha_atual: senha });
  assert.equal((await chamar('/sessao', undefined, atual)).id, id);
  const aprovada = (await chamar(rota, pedido, atual)).id;
  const painel = await chamar('/admin');
  assert.ok(painel.solicitacoes_senha.some(item => item.id === aprovada && item.justificativa === pedido.justificativa));
  assert.ok(!JSON.stringify(painel.solicitacoes_senha).includes('senha_hash'));
  const b = abrirBanco(caminho);
  assert.ok(!b.prepare('SELECT senha_hash FROM solicitacoes_senha WHERE id=?').get(aprovada).senha_hash.includes(pedido.senha));
  b.close();
  const rotaAprovar = `/admin/solicitacoes-senha/${aprovada}`;
  await chamar(rotaAprovar, { decisao: 'aprovada', senha_atual: 'errada' }, alice, 403);
  await chamar(rotaAprovar, { decisao: 'aprovada', senha_atual: senha });
  await chamar(rotaAprovar, { decisao: 'aprovada', senha_atual: senha });
  await chamar(rotaAprovar, { decisao: 'recusada', senha_atual: senha }, alice, 409);
  await chamar('/sessao', undefined, atual, 401);
  await chamar('/sessao', undefined, outra, 401);
  const nova = await login({ login: 'perfilnovo', senha: 'nova1234' });
  await login({ perfil: id, senha }, 401);
  assert.equal((await chamar(rota, undefined, nova)).solicitacoes[0].estado, 'aprovada');
  await chamar('/sair', {}, nova);
});

async function conta(nome, saldo, tipo = 'conta') {
  return (await chamar('/contas', { nome, saldo_inicial: saldo, tipo, inicio: '2024-01-01' })).id;
}

async function salario(dados) {
  const previa = await chamar('/salarios/previa', dados);
  return { ...dados, revisao: previa.revisao, chave: randomUUID() };
}

test('renda extra mantém o período e salário confirmado preserva saldos', async () => {
  const corrente = await conta('Corrente', 100_000);
  origem.conta = corrente;
  const categoria = (await chamar('/categorias', { nome: 'Mercado' })).id;
  origem.categoria = categoria;
  const despesa = { tipo: 'despesa', origem: corrente, categoria, descricao: 'Mercado', data: '2024-01-03', valor: 3_000 };
  origem.despesa = (await chamar('/lancamentos', despesa)).id;
  const antes = await chamar('/periodos');
  await chamar('/lancamentos', { tipo: 'renda', destino: corrente, valor: 10_000, descricao: 'Extra', data: '2024-01-04' });
  assert.deepEqual(await chamar('/periodos'), antes);
  const dados = { destino: corrente, data: '2024-01-05', valor: 200_000 };
  const pedido = await salario(dados);
  const resultado = await chamar('/salarios', pedido);
  assert.deepEqual(await chamar('/salarios', pedido), resultado);
  assert.equal((await chamar('/painel')).disponivel, 307_000);
  const periodos = await chamar('/periodos');
  assert.deepEqual(periodos.map(i => [i.inicio, i.fim]), [['2024-01-03', '2024-01-04'], ['2024-01-05', null]]);
  const adicional = await salario({ ...dados, valor: 15_000 });
  await chamar('/salarios', adicional, alice, 409);
  await chamar('/salarios', { ...adicional, confirmar_segundo: true });
  assert.deepEqual(await chamar('/periodos'), periodos);
  await chamar(`/salarios/${resultado.id}`, { ...dados, data: '2024-01-06' }, alice, 422);
  await chamar(`/salarios/${resultado.id}`, { ...dados, valor: 210_000 });
  const novo = await salario({ ...dados, data: '2024-02-05', valor: 220_000 });
  await chamar('/salarios', novo);
  assert.equal((await chamar('/painel')).disponivel, 552_000);
  assert.equal((await chamar('/periodos'))[1].fim, '2024-02-04');
});

test('retroativos, transferências, aportes e resgates reconciliam histórico e relatórios', async () => {
  const { categoria, conta: corrente, despesa } = origem;
  await chamar(`/lancamentos/${despesa}`, {
    origem: corrente, categoria, descricao: 'Mercado corrigido', data: '2024-01-02', valor: 3_500
  });
  const poupar = await conta('Reserva', 0, 'reserva');
  const investir = await conta('Investimento', 0, 'investimento');
  const outro = await conta('Outra conta', 0);
  for (const [origem, destino, valor] of [[corrente, outro, 10_000], [corrente, poupar, 50_000],
    [poupar, corrente, 5_000], [corrente, investir, 12_000], [investir, outro, 2_000]]) {
    await chamar('/lancamentos', { tipo: 'transferencia', origem, destino, valor, data: '2024-01-04', descricao: 'Movimentação interna' });
  }
  const antigo = await chamar('/relatorios?inicio=2024-01-02&fim=2024-01-04');
  assert.equal(antigo.entradas, 10_000);
  assert.equal(antigo.saidas, 3_500);
  assert.equal(antigo.saldo_final, 51_500);
  assert.equal((await chamar('/periodos'))[0].inicio, '2024-01-02');
  const painel = await chamar('/painel');
  assert.equal(painel.disponivel, 496_500);
  assert.equal(painel.reserva, 45_000);
  assert.equal(painel.investimentos, 10_000);
  const historico = await chamar(`/lancamentos?inicio=2024-01-02&fim=2024-01-04&conta=${corrente}&categoria=${categoria}&tipo=despesa`);
  assert.deepEqual(historico.map(item => [item.descricao, item.valor]), [['Mercado corrigido', 3_500]]);
});

test('a conta em destaque é salva por perfil e o total continua somando as contas bancárias', async () => {
  const { contas } = await chamar('/base');
  const outra = contas.find(item => item.tipo === 'conta' && item.id !== origem.conta);
  const reserva = contas.find(item => item.tipo === 'reserva');
  const anterior = await chamar('/painel');
  assert.equal(anterior.conta_destaque, null);
  await chamar('/painel/conta-destaque', { conta: reserva.id }, alice, 422);
  await chamar('/painel/conta-destaque', { conta: outra.id }, bruno, 404);
  await chamar('/painel/conta-destaque', { conta: outra.id });
  const atualizado = await chamar('/painel');
  assert.equal(atualizado.conta_destaque, outra.id);
  assert.equal(atualizado.disponivel, anterior.disponivel);
  assert.equal((await chamar('/painel', undefined, bruno)).conta_destaque, null);
});

test('parcelamento cruza fechamento, soma centavos e debita fatura uma vez', async () => {
  const cartao = (await chamar('/cartoes', { nome: 'Cartão teste', limite: 300_000, fechamento: 20, vencimento: 31 })).id;
  await chamar('/compras', { cartao, categoria: origem.categoria, parcelas: 3, data: '2024-01-21', descricao: 'Notebook', valor: 10_001 });
  const dados = await chamar('/cartoes');
  assert.equal(dados.cartoes[0].usado, 10_001);
  assert.deepEqual(dados.faturas.map(item => [item.vencimento, item.valor]), [
    ['2024-02-29', 3334], ['2024-03-31', 3334], ['2024-04-30', 3333]
  ]);
  assert.deepEqual((await chamar('/compromissos')).faturas, dados.faturas);
  assert.deepEqual((await chamar('/compromissos', undefined, bruno)).faturas, []);
  const fatura = dados.faturas[0];
  origem.fatura = fatura.id;
  const rotaDatas = `/faturas/${fatura.id}/datas`;
  const datas = { fechamento: '2024-02-15', vencimento: '2024-02-25' };
  await chamar(rotaDatas, datas, bruno, 404);
  await chamar(rotaDatas, { ...datas, fechamento: '2024-01-20' }, alice, 422);
  await chamar(rotaDatas, { ...datas, fechamento: '2024-01-20', confirmar_datas: true });
  const antecipada = await chamar(`/faturas/${fatura.id}`);
  assert.equal(antecipada.fechamento, '2024-01-20');
  assert.equal(antecipada.itens[0].data, '2024-01-21');
  await chamar(rotaDatas, datas);
  const ajustada = (await chamar('/compromissos')).faturas.find(item => item.id === fatura.id);
  assert.equal(ajustada.fechamento, datas.fechamento);
  assert.equal(ajustada.vencimento, datas.vencimento);
  assert.equal(ajustada.valor, fatura.valor);
  const pedido = { conta: origem.conta, data: '2024-03-01', valor: fatura.valor, chave: randomUUID() };
  await chamar(`/faturas/${fatura.id}`, pedido);
  await chamar(rotaDatas, datas, alice, 409);
  await chamar(`/faturas/${fatura.id}`, pedido);
  await chamar(`/faturas/${fatura.id}`, { ...pedido, chave: randomUUID() }, alice, 409);
  assert.equal((await chamar('/painel')).disponivel, 493_166);
  const antesDePagar = await chamar('/relatorios?inicio=2024-02-05&fim=2024-02-29');
  assert.equal(antesDePagar.saidas, 0);
  assert.ok(antesDePagar.serie.every(ponto => ponto.saidas_acumuladas === 0));
  const relatorio = await chamar('/relatorios?inicio=2024-03-01&fim=2024-03-01');
  assert.deepEqual(relatorio.categorias.map(item => [item.nome, item.valor]), [['Mercado', 3334]]);
  assert.equal(relatorio.serie.at(-1).saidas_acumuladas, 3334);
  assert.equal((await chamar('/cartoes')).cartoes[0].usado, 6667);
  assert.deepEqual((await chamar('/compromissos')).faturas, dados.faturas.slice(1));
});

test('editar e excluir cartão exige autorização e preserva faturas vinculadas', async () => {
  const dados = { nome: 'Cartão para editar', limite: 20000, fechamento: 10, vencimento: 20 };
  const { id } = await chamar('/cartoes', dados);
  const rota = `/cartoes/${id}`;
  const compra = { cartao: id, data: '2024-03-01', parcelas: 1, categoria: origem.categoria, descricao: 'Compra', valor: 1000 };
  await chamar('/compras', compra);
  const fatura = (await chamar('/compromissos')).faturas.find(item => item.cartao === id);
  const novosDados = { nome: 'Cartão atualizado', limite: 30000, fechamento: 15, vencimento: 25 };
  await chamar(rota, novosDados, bruno, 404);
  await chamar(rota, novosDados);
  const cartao = async () => (await chamar('/cartoes')).cartoes.find(item => item.id === id);
  for (const [chave, valor] of Object.entries(novosDados)) assert.equal((await cartao())[chave], valor);
  assert.equal((await chamar(`/faturas/${fatura.id}`)).vencimento, fatura.vencimento);
  await chamar(rota + '/excluir', {}, alice, 403);
  await chamar(rota + '/excluir', { senha: 'incorreta' }, alice, 403);
  await chamar(rota + '/excluir', { senha }, bruno, 404);
  assert.equal((await cartao()).arquivado, 0);
  assert.equal((await chamar(rota + '/excluir', { senha })).arquivado, true);
  assert.equal((await cartao()).arquivado, 1);
  assert.ok((await chamar('/compromissos')).faturas.some(item => item.id === fatura.id));
  await chamar('/compras', compra, alice, 409);
  await chamar(rota + '/restaurar', {});
  assert.equal((await cartao()).arquivado, 0);
  const vazio = (await chamar('/cartoes', { ...dados, nome: 'Cartão sem compras' })).id;
  assert.equal((await chamar(`/cartoes/${vazio}/excluir`, { senha })).arquivado, false);
  assert.ok(!(await chamar('/cartoes')).cartoes.some(item => item.id === vazio));
  await chamar(`/lancamentos/${origem.despesa}/excluir`, {}, alice, 403);
});

test('recorrências, parcela direta, alertas e pagamento no valor efetivo', async () => {
  const alvo = somarDias(hoje(), 5);
  const plano = await chamar('/compromissos', { tipo: 'mensal', categoria: origem.categoria, nome: 'Internet', inicio: alvo, conta: origem.conta, valor: 12990 });
  await chamar('/compromissos');
  const dados = await chamar('/compromissos');
  assert.equal(dados.ocorrencias.filter(item => item.compromisso === plano.id && item.vencimento === alvo).length, 1);
  const ocorrencia = dados.ocorrencias.find(item => item.compromisso === plano.id && item.vencimento === alvo);
  const banco = abrirBanco(caminho);
  try {
    assert.ok(!pendencias(banco, idAlice, somarDias(alvo, -6)).some(item => item.nome === 'Internet'));
    assert.equal(pendencias(banco, idAlice, somarDias(alvo, -5)).find(item => item.nome === 'Internet').atrasado, false);
    assert.equal(pendencias(banco, idAlice, somarDias(alvo, 1)).find(item => item.nome === 'Internet').atrasado, true);
    await chamar(`/ocorrencias/${ocorrencia.id}`, { valor: 13590, data: hoje() });
    assert.ok(!pendencias(banco, idAlice, alvo).some(item => item.id === ocorrencia.id && item.tipo === 'mensal'));
    await chamar(`/ocorrencias/${ocorrencia.id}/corrigir`, { valor: 13690, data: hoje() });
    const direto = await chamar('/compromissos', { tipo: 'parcelado', categoria: origem.categoria, nome: 'Parcelado',
      inicio: '2024-01-31', conta: origem.conta, valor: 501, quantidade: 2 });
    const parcelas = (await chamar('/compromissos')).ocorrencias.filter(item => item.compromisso === direto.id);
    assert.deepEqual(parcelas.map(item => [item.vencimento, item.previsto]), [['2024-01-31', 251], ['2024-02-29', 250]]);

    const cartao = (await chamar('/cartoes', { nome: 'Recorrências', limite: 100_000, fechamento: 20, vencimento: 25 })).id;
    const assinatura = await chamar('/compromissos', { tipo: 'mensal', categoria: origem.categoria, nome: 'Assinatura',
      inicio: '2024-10-13', cartao, valor: 5000 });
    atualizarRecorrencias(banco, idAlice);
    const cobranca = (await chamar('/compromissos')).ocorrencias.find(item => item.compromisso === assinatura.id);
    await chamar(`/ocorrencias/${cobranca.id}`, { valor: 5200 });
    const daAssinatura = await chamar(`/faturas/${cobranca.fatura}`);
    assert.equal(daAssinatura.valor, 5200);
    assert.equal(daAssinatura.itens.length, 1);
    assert.ok(!pendencias(banco, idAlice, hoje()).some(item => item.nome === 'Assinatura'));
    await chamar(`/faturas/${daAssinatura.id}`, { valor: 5200, conta: origem.conta, data: '2024-10-25' });
    const quitada = (await chamar('/compromissos')).ocorrencias.find(item => item.id === cobranca.id);
    assert.equal(quitada.pagamento_cartao, '2024-10-25');
    await chamar(`/ocorrencias/${cobranca.id}/excluir`, { senha }, alice, 409);
  } finally {
    banco.close();
  }
});

test('um pagamento avulso vence uma vez e só afeta o saldo quando confirmado', async () => {
  const vencimento = somarDias(hoje(), 4);
  const saldo = (await chamar('/painel')).disponivel;
  const plano = await chamar('/compromissos', { tipo: 'avulso', categoria: origem.categoria,
    nome: 'Taxa avulsa', inicio: vencimento, conta: origem.conta, valor: 1599 });
  const listar = async () => (await chamar('/compromissos')).ocorrencias.filter(item => item.compromisso === plano.id);
  const [item] = await listar();
  assert.equal(item.vencimento, vencimento);
  assert.equal(item.quantidade, 1);
  assert.equal((await listar()).length, 1);
  const painel = await chamar('/painel');
  assert.equal(painel.disponivel, saldo);
  assert.ok(painel.pendencias.some(p => p.nome === 'Taxa avulsa' && p.vencimento === vencimento));
  await chamar(`/ocorrencias/${item.id}`, { data: hoje(), valor: 1599 });
  assert.equal((await chamar('/painel')).disponivel, saldo - 1599);
  assert.equal((await chamar('/lancamentos')).find(l => l.descricao === 'Taxa avulsa').avulso, 1);
  await chamar(`/ocorrencias/${item.id}/excluir`, { confirmar_pago: true, senha });
  assert.equal((await chamar('/painel')).disponivel, saldo);
});

test('editar ou excluir uma cobrança mensal afeta só a linha escolhida e o pagamento vinculado', async () => {
  const inicio = somarDias(hoje(), 5);
  const plano = await chamar('/compromissos', { tipo: 'mensal', categoria: origem.categoria,
    nome: 'Mensalidade de teste', inicio, conta: origem.conta, valor: 999 });
  const listar = async () => (await chamar('/compromissos')).ocorrencias.filter(item => item.compromisso === plano.id);
  const [primeira, seguinte] = await listar();
  assert.ok(seguinte);
  const saldoInicial = (await chamar('/painel')).disponivel;
  const novoVencimento = somarDias(inicio, -2);
  await chamar(`/ocorrencias/${primeira.id}/editar`, { vencimento: novoVencimento, valor: 1099 });
  assert.deepEqual((await listar()).map(item => [item.vencimento, item.previsto]), [
    [novoVencimento, 1099], [seguinte.vencimento, 999]
  ]);
  await chamar(`/ocorrencias/${primeira.id}`, { data: hoje(), valor: 1099 });
  assert.equal((await chamar('/painel')).disponivel, saldoInicial - 1099);
  await chamar(`/ocorrencias/${primeira.id}/excluir`, { confirmar_pago: true }, alice, 403);
  await chamar(`/ocorrencias/${primeira.id}/excluir`, { senha }, alice, 409);
  await chamar(`/ocorrencias/${primeira.id}/excluir`, { confirmar_pago: true, senha });
  assert.equal((await chamar('/painel')).disponivel, saldoInicial);
  assert.deepEqual((await listar()).map(item => item.id), [seguinte.id]);
  await chamar(`/ocorrencias/${seguinte.id}/excluir`, { senha });
  assert.deepEqual(await listar(), []);
  assert.deepEqual(await listar(), []);
});

test('arquivar uma recorrência encerrada preserva o pagamento e permite restaurar a entrada na lista', async () => {
  const mensal = await chamar('/compromissos', { tipo: 'mensal', categoria: origem.categoria,
    nome: 'Compromisso para arquivar', inicio: hoje(), conta: origem.conta, valor: 1250 });
  const caminho = `/compromissos/${mensal.id}`;
  await chamar(`${caminho}/arquivar`, {}, alice, 409);
  const cobranca = (await chamar('/compromissos')).ocorrencias.find(item => item.compromisso === mensal.id);
  await chamar(`/ocorrencias/${cobranca.id}`, { data: hoje(), valor: 1250 });
  const saldo = (await chamar('/painel')).disponivel;
  await chamar(`${caminho}/encerrar`, {});
  await chamar(`${caminho}/arquivar`, {}, bruno, 404);
  await chamar(`${caminho}/arquivar`, {});
  const dados = await chamar('/compromissos');
  assert.equal(dados.planos.find(plano => plano.id === mensal.id).arquivado, 1);
  assert.ok(dados.ocorrencias.some(item => item.id === cobranca.id && item.pagamento));
  assert.equal((await chamar('/painel')).disponivel, saldo);
  await chamar(`${caminho}/restaurar`, {});
  assert.equal((await chamar('/compromissos')).planos.find(plano => plano.id === mensal.id).arquivado, 0);
});

test('editar e excluir categorias preserva os registros vinculados', async () => {
  const id = origem.categoria;
  const destino = (await chamar('/categorias', { nome: 'Despesas gerais' })).id;
  const caminho = `/categorias/${id}`;
  await chamar(caminho, { nome: 'despesas gerais' }, alice, 409);
  await chamar(caminho, { nome: 'Supermercado' }, bruno, 404);
  await chamar(caminho, { nome: 'Supermercado' });
  const registros = await chamar(`/lancamentos?categoria=${id}&tipo=despesa`);
  assert.equal(registros[0].nome_categoria, 'Supermercado');
  assert.equal((await chamar('/base')).categorias.find(item => item.id === id).em_uso, 1);
  await chamar(`${caminho}/excluir`, { senha }, alice, 409);
  await chamar(`${caminho}/excluir`, { substituta: destino, senha });
  assert.ok(!(await chamar('/base')).categorias.some(item => item.id === id));
  assert.equal((await chamar(`/lancamentos?categoria=${destino}&tipo=despesa`))[0].id, registros[0].id);
  assert.equal((await chamar(`/faturas/${origem.fatura}`)).itens[0].categoria, 'Despesas gerais');
  assert.ok((await chamar('/compromissos')).planos.some(item => item.nome_categoria === 'Despesas gerais'));
  const vazia = (await chamar('/categorias', { nome: 'Categoria sem uso' })).id;
  await chamar(`/categorias/${vazia}/excluir`, { senha });
  assert.ok(!(await chamar('/base')).categorias.some(item => item.id === vazia));
});

test('admin exige consentimento para consulta e recuperação verificada para redefinir senha alheia', async () => {
  assert.deepEqual((await chamar('/base', undefined, bruno)).contas, []);
  assert.deepEqual(await chamar('/lancamentos', undefined, bruno), []);
  await chamar(`/lancamentos/${origem.despesa}`, { descricao: 'Alteração' }, bruno, 404);
  await chamar(`/faturas/${origem.fatura}`, undefined, bruno, 404);
  await chamar('/lancamentos', { tipo: 'renda', data: hoje(), valor: 50, destino: origem.conta, descricao: 'Invasão' }, bruno, 404);
  const brunoConta = (await chamar('/contas', { nome: 'Conta privada de Bruno', saldo_inicial: 0, inicio: hoje(), tipo: 'conta' }, bruno)).id;
  await chamar(`/lancamentos?conta=${brunoConta}`, undefined, alice, 404);
  await chamar('/admin', undefined, bruno, 403);
  const admin = await chamar('/admin');
  assert.ok(!JSON.stringify(admin).includes('Conta privada de Bruno'));
  const pessoa = admin.usuarios.find(item => item.login === 'bruno');
  const perfis = await chamar('/perfis', undefined, '');
  assert.equal(perfis.inicializar, false);
  assert.deepEqual(perfis.perfis, []);
  await chamar('/base', undefined, bruno, 403, { 'X-Financas-Perfil': String(idAlice) });
  const gerenciado = { 'X-Financas-Perfil': String(pessoa.id) };
  await chamar('/base', undefined, alice, 403, gerenciado);
  const pedidoAcesso = await chamar('/acessos/solicitar', { usuario: pessoa.id, justificativa: 'Suporte solicitado', senha_atual: senha });
  await chamar(`/acessos/${pedidoAcesso.id}`, { decisao: 'aprovado', senha_atual: senha }, bruno);
  const baseBruno = await chamar('/base', undefined, alice, 200, gerenciado);
  assert.deepEqual(baseBruno.contas.map(conta => conta.id), [brunoConta]);
  await chamar('/lancamentos', { tipo: 'renda', data: hoje(), valor: 50, destino: brunoConta, descricao: 'Tentativa indevida' }, alice, 403, gerenciado);
  assert.deepEqual(await chamar('/lancamentos', undefined, bruno), []);
  await chamar('/admin/usuarios', { login: 'intruso', nome: 'Intruso', senha }, bruno, 403);
  const novaSenha = '45678901';
  const alteracao = { id: pessoa.id, nome: 'Bruno atualizado', login: 'bruno', senha: novaSenha };
  await chamar('/admin/usuarios/editar', alteracao, bruno, 403);
  await chamar('/admin/sessoes/encerrar', { id: admin.sessoes.find(item => item.usuario === pessoa.id).id });
  await chamar('/base', undefined, bruno, 401);
  bruno = await login('bruno');
  await chamar('/admin/usuarios/editar', alteracao, alice, 403);
  await chamar('/admin/usuarios/editar', { ...alteracao, senha: '' });
  await chamar('/recuperacao/solicitar', { login: 'bruno' }, '');
  const pedidoRecuperacao = (await chamar('/admin')).recuperacoes.find(p => p.login === 'bruno');
  const liberacao = await chamar('/admin/recuperacoes/liberar', { id: pedidoRecuperacao.id, senha_atual: senha, identidade_confirmada: true, canal: 'email' });
  await chamar('/recuperacao/concluir', { token: liberacao.token, senha: novaSenha, confirmacao_senha: novaSenha }, '');
  await chamar('/base', undefined, bruno, 401);
  await login({ perfil: pessoa.id, senha }, 401);
  bruno = await login({ perfil: pessoa.id, senha: novaSenha });
  assert.equal((await chamar('/sessao', undefined, bruno)).nome, 'Bruno atualizado');
  await chamar('/admin/atividade', { id: pessoa.id, ativo: false });
  await chamar('/base', undefined, bruno, 401);
  assert.ok(!(await chamar('/perfis', undefined, '')).perfis.some(perfil => perfil.id === pessoa.id));
  await chamar('/base', undefined, '', 401);
  const csrf = await fetch(`${endereco}/api/tema`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: alice, Origin: 'https://outro.invalid' }, body: '{"tema":"escuro"}'
  });
  assert.equal(csrf.status, 403);
});

test('o endereço do QR acompanha a troca de IP e respeita a interface da conexão', async () => {
  const interfaces = ip => ({
    Ethernet: [{ address: '192.168.50.10', family: 'IPv4', internal: false }],
    'Wi-Fi': [{ address: ip, family: 'IPv4', internal: false }],
    Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
  });
  const anterior = enderecosDaRede(8091, 'http', '0.0.0.0', interfaces('192.168.18.96'));
  const atual = enderecosDaRede(8091, 'http', '0.0.0.0', interfaces('10.85.96.114'));
  assert.equal(enderecoParaCelular(anterior, '127.0.0.1').url, 'http://192.168.18.96:8091/');
  assert.equal(enderecoParaCelular(atual, '127.0.0.1').url, 'http://10.85.96.114:8091/');
  assert.equal(enderecoParaCelular(atual, '192.168.50.10').url, 'http://192.168.50.10:8091/');
  assert.deepEqual(await chamar('/rede', undefined, ''), {
    endereco: { url: 'https://financeiro-teste.example/', publico: true }
  });
});

test('arquivos públicos e restauração em banco separado', async () => {
  for (const arquivo of ['/', '/app.js', '/qrcode.mjs', '/estilo.css', '/manifesto.json', '/sw.js', '/icone-192.png']) {
    assert.equal((await fetch(endereco + arquivo)).status, 200, arquivo);
  }
  const backup = join(pasta, 'copia.sqlite');
  const anterior = join(pasta, 'restaurado.sqlite');
  const cli = (comando, arquivo, banco) => execFileSync(process.execPath, [modulo('manutencao.mjs'), comando, arquivo], {
    env: { ...env, FINANCAS_BANCO: banco }, encoding: 'utf8'
  });
  cli('backup', backup, caminho);
  const vazio = abrirBanco(anterior);
  vazio.close();
  cli('restaurar', backup, anterior);
  const recuperado = abrirBanco(anterior);
  try {
    assert.equal(recuperado.prepare('SELECT COUNT(*) AS quantidade FROM usuarios').get().quantidade, 3);
    assert.equal(recuperado.prepare('SELECT COUNT(*) AS quantidade FROM sessoes').get().quantidade, 0);
    assert.equal(recuperado.prepare('SELECT valor FROM lancamentos WHERE id=?').get(origem.despesa).valor, 3500);
  } finally {
    recuperado.close();
  }
});

test('aparência pertence ao perfil conectado e mantém dados financeiros, login e permissões', async () => {
  const antes = await chamar('/sessao');
  const saldos = (await chamar('/base')).contas;
  const aparencia = { nome_exibicao: 'Meu apelido', avatar: 'gato', cor_perfil: 'roxo', foto_avatar: '', formato_avatar: 'redondo', tamanho_texto: 'grande', espacamento: 'compacto', tema: 'escuro' };
  await chamar('/perfil/aparencia', { ...aparencia, avatar: 'invalido' }, alice, 422);
  await chamar('/perfil/aparencia', { ...aparencia, cor_perfil: 'url(invalida)' }, alice, 422);
  await chamar('/perfil/aparencia', { ...aparencia, foto_avatar: 'https://invasor.invalid/foto.png' }, alice, 422);
  await chamar('/perfil/aparencia', { ...aparencia, foto_avatar: 'data:image/svg+xml;base64,AAAA' }, alice, 422);
  await chamar('/perfil/aparencia', { ...aparencia, foto_avatar: 'data:image/jpeg;base64,' + 'A'.repeat(15000) }, alice, 422);
  await chamar('/perfil/aparencia', { ...aparencia, id: 2, admin: 0, login: 'outrologin' });
  for (const campo of ['formato_avatar', 'tamanho_texto', 'espacamento', 'tema']) {
    await chamar('/perfil/aparencia', { ...aparencia, [campo]: 'invalido' }, alice, 422);
  }
  const depois = await chamar('/sessao');
  for (const campo of ['formato_avatar', 'tamanho_texto', 'espacamento', 'tema']) assert.equal(depois[campo], aparencia[campo]);
  assert.equal(depois.id, antes.id);
  assert.equal(depois.login, antes.login);
  assert.equal(depois.admin, antes.admin);
  assert.equal(depois.nome_exibicao, aparencia.nome_exibicao);
  assert.deepEqual((await chamar('/base')).contas, saldos);
  const leitura = abrirBanco(caminho);
  try { assert.equal(leitura.prepare('SELECT nome_exibicao FROM usuarios WHERE id=2').get().nome_exibicao, null); }
  finally { leitura.close(); }
  const cookie = await login({ perfil: idAlice, senha });
  assert.equal((await chamar('/sessao', undefined, cookie)).cor_perfil, 'roxo');
  await chamar('/sair', {}, cookie);
  assert.deepEqual((await chamar('/perfis', undefined, '')).perfis, []);
  const publico = (await chamar('/perfis')).perfis.find(item => item.id === idAlice);
  assert.equal(publico.nome_exibicao, 'Meu apelido');
  assert.equal(publico.formato_avatar, 'redondo');
  assert.equal((await chamar('/sessao')).tamanho_texto, 'grande');
  assert.ok(!Object.hasOwn(publico, 'email'));
  await chamar('/perfil/aparencia', { nome_exibicao: '', avatar: 'iniciais', cor_perfil: 'verde', foto_avatar: '', formato_avatar: 'arredondado', tema: 'claro', tamanho_texto: 'normal', espacamento: 'normal' });
});

test('limpeza e exclusão exigem senha, respeitam vínculos e afetam somente o próprio perfil', async () => {
  const id = (await chamar('/admin/usuarios', { nome: 'Perfil removível', login: 'removivel', senha })).id;
  const cookie = await login({ perfil: id, senha });
  const outraSessao = await login({ perfil: id, senha });
  await chamar('/perfil/contatos', { email: 'removivel@example.com', telefone: '11900000009' }, cookie);
  const conta = (await chamar('/contas', { nome: 'Conta', tipo: 'conta', saldo_inicial: 10000, inicio: '2024-01-01' }, cookie)).id;
  const categoria = (await chamar('/categorias', { nome: 'Categoria' }, cookie)).id;
  await chamar('/lancamentos', { tipo: 'despesa', origem: conta, categoria, valor: 100, data: '2024-01-02', descricao: 'Despesa' }, cookie);
  const previa = await chamar('/salarios/previa', { data: '2024-01-03', destino: conta, valor: 1000 }, cookie);
  await chamar('/salarios', { data: '2024-01-03', destino: conta, valor: 1000, revisao: previa.revisao }, cookie);
  await chamar('/compromissos', { nome: 'Recorrência', tipo: 'mensal', inicio: hoje(), conta, categoria, valor: 100 }, cookie);
  const cartao = (await chamar('/cartoes', { nome: 'Cartão', limite: 100000, fechamento: 10, vencimento: 20 }, cookie)).id;
  await chamar('/compras', { cartao, categoria, data: '2024-01-01', descricao: 'Compra', parcelas: 1, valor: 500 }, cookie);
  const fatura = (await chamar('/cartoes', undefined, cookie)).faturas[0];
  await chamar(`/faturas/${fatura.id}`, { conta, data: '2024-01-11', valor: fatura.valor }, cookie);
  await chamar('/painel/conta-destaque', { conta }, cookie);
  const banco = abrirBanco(caminho);
  try {
    const dispositivo = banco.prepare("INSERT INTO dispositivos(usuario,endpoint,chave,auth) VALUES (?,'https://fcm.googleapis.com/teste-removivel','-','-')").run(id).lastInsertRowid;
    banco.prepare('INSERT INTO notificacoes_enviadas VALUES (?,?)').run(dispositivo,'aviso anterior');
  } finally { banco.close(); }
  const outros = (await chamar('/base')).contas;
  const base = await chamar('/base', undefined, cookie);
  const limpar = '/perfil/limpar-dados';
  await chamar(limpar, { senha, confirmar: false }, cookie, 422);
  await chamar(limpar, { senha: 'incorreta', confirmar: true }, cookie, 403);
  await chamar(limpar, { senha, confirmar: true }, alice, 403, { 'X-Financas-Perfil': String(id) });
  assert.deepEqual((await chamar('/base', undefined, cookie)).contas, base.contas);
  const falha = abrirBanco(caminho);
  try {
    falha.exec(`CREATE TRIGGER interromper_limpeza BEFORE DELETE ON contas WHEN OLD.usuario=${id}
      BEGIN SELECT RAISE(ABORT,'interrupcao de teste'); END`);
    assert.throws(() => removerDadosDoPerfil(falha, lerSessao(falha, cookie), '/api/perfil/limpar-dados',
      { senha, confirmar: true, chave: randomUUID() }), /interrupcao de teste/);
    assert.equal(falha.prepare('SELECT COUNT(*) AS n FROM dispositivos WHERE usuario=?').get(id).n, 1);
    assert.equal(falha.prepare('SELECT COUNT(*) AS n FROM faturas WHERE usuario=?').get(id).n, 1);
    assert.equal(falha.prepare('SELECT COUNT(*) AS n FROM contas WHERE usuario=?').get(id).n, 1);
  } finally {
    falha.exec('DROP TRIGGER IF EXISTS interromper_limpeza');
    falha.close();
  }
  const pedido = { senha, confirmar: true, chave: randomUUID(), id: idAlice };
  await chamar(limpar, pedido, cookie);
  assert.deepEqual((await chamar('/base', undefined, cookie)).contas, []);
  assert.deepEqual((await chamar('/compromissos', undefined, cookie)).ocorrencias, []);
  assert.deepEqual((await chamar('/cartoes', undefined, cookie)).faturas, []);
  assert.deepEqual(await chamar('/lancamentos', undefined, cookie), []);
  assert.equal((await chamar('/sessao', undefined, cookie)).email, 'removivel@example.com');
  await chamar('/sessao', undefined, outraSessao, 401);
  assert.deepEqual((await chamar('/base')).contas, outros);
  await chamar('/contas', { nome: 'Nova conta', tipo: 'conta', saldo_inicial: 0, inicio: hoje() }, cookie);
  await chamar(limpar, pedido, cookie);
  assert.equal((await chamar('/base', undefined, cookie)).contas.length, 1);
  await chamar('/perfil/excluir-conta', { senha, confirmar: true }, alice, 409);
  assert.deepEqual((await chamar('/base')).contas, outros);
  await chamar('/perfil/excluir-conta', { senha: 'incorreta', confirmar: true }, cookie, 403);
  await chamar('/perfil/excluir-conta', { senha, confirmar: true, id: idAlice }, cookie);
  await chamar('/sessao', undefined, cookie, 401);
  assert.ok(!(await chamar('/perfis', undefined, '')).perfis.some(perfil => perfil.id === id));
  assert.deepEqual((await chamar('/base')).contas, outros);
  const verificar = abrirBanco(caminho);
  try {
    assert.deepEqual(verificar.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(verificar.prepare('SELECT COUNT(*) AS n FROM dispositivos WHERE usuario=?').get(id).n, 0);
    assert.equal(verificar.prepare('SELECT COUNT(*) AS n FROM operacoes WHERE usuario=?').get(id).n, 0);
  } finally { verificar.close(); }
});

test('push em HTTPS público registra, isola, envia e remove inscrições expiradas com histórico', async t => {
  const b = abrirBanco(':memory:');
  b.exec("INSERT INTO usuarios(id,nome,login,senha,admin) VALUES(1,'Um','um','-',0),(2,'Dois','dois','-',0)");
  const cliente = createECDH('prime256v1');
  const p256dh = cliente.generateKeys().toString('base64url');
  const inscricao = { endpoint: 'https://fcm.googleapis.com/fcm/send/teste-ficticio',
    keys: { p256dh, auth: randomBytes(16).toString('base64url') } };
  const avisos = iniciarNotificacoes(b, true, { contato: 'mailto:teste@example.com' });
  let status = 201;
  const envios = [];
  t.mock.method(globalThis, 'fetch', async (url, dados) => {
    envios.push({ url: url.href, dados });
    return new Response('', { status });
  });
  try {
    assert.equal((await avisos(1,'GET','/api/notificacoes')).ativa, true);
    await assert.rejects(avisos(1,'POST','/api/notificacoes/ativar', {
      ...inscricao, endpoint: 'https://invasor.invalid/dispositivo'
    }), { status: 422 });
    await avisos(1,'POST','/api/notificacoes/ativar', inscricao);
    assert.equal((await avisos(1,'POST','/api/notificacoes/consultar', inscricao)).registrado, true);
    assert.equal((await avisos(2,'POST','/api/notificacoes/consultar', inscricao)).registrado, false);
    await assert.rejects(avisos(2,'POST','/api/notificacoes/testar', inscricao), { status: 404 });
    await avisos(1,'POST','/api/notificacoes/testar', inscricao);
    assert.equal(envios[0].url, inscricao.endpoint);
    assert.match(envios[0].dados.headers.Authorization, /^vapid t=/);
    assert.equal(envios[0].dados.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(Buffer.isBuffer(envios[0].dados.body));
    const id = b.prepare('SELECT id FROM dispositivos').get().id;
    b.prepare('INSERT INTO notificacoes_enviadas VALUES (?,?)').run(id, 'evento anterior');
    status = 410;
    await assert.rejects(avisos(1,'POST','/api/notificacoes/testar', inscricao), { status: 502 });
    assert.equal(b.prepare('SELECT COUNT(*) AS n FROM dispositivos').get().n, 0);
    assert.equal(b.prepare('SELECT COUNT(*) AS n FROM notificacoes_enviadas').get().n, 0);
    status = 201;
    await avisos(1,'POST','/api/notificacoes/ativar', inscricao);
    const novoId = b.prepare('SELECT id FROM dispositivos').get().id;
    b.prepare('INSERT INTO notificacoes_enviadas VALUES (?,?)').run(novoId,'evento anterior');
    await avisos(2,'POST','/api/notificacoes/ativar', inscricao);
    assert.equal((await avisos(1,'POST','/api/notificacoes/consultar', inscricao)).registrado, false);
    await avisos(2,'POST','/api/notificacoes/desativar', inscricao);
    assert.equal(b.prepare('SELECT COUNT(*) AS n FROM dispositivos').get().n, 0);
    await new Promise(resolve => setImmediate(resolve));
  } finally { b.close(); }
});

test('conteúdo da notificação é recuperável apenas com a chave do dispositivo', () => {
  const cliente = createECDH('prime256v1');
  const publica = cliente.generateKeys();
  const auth = randomBytes(16);
  const mensagem = Buffer.from('Confira seus vencimentos.');
  const pacote = criptografar(mensagem, publica.toString('base64url'), auth.toString('base64url'));
  const sal = pacote.subarray(0, 16);
  const chaveServidor = pacote.subarray(21, 21 + pacote[20]);
  const segredo = cliente.computeSecret(chaveServidor);
  const material = hkdfSync('sha256', segredo, auth, Buffer.concat([Buffer.from('WebPush: info\0'), publica, chaveServidor]), 32);
  const chave = hkdfSync('sha256', material, sal, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdfSync('sha256', material, sal, 'Content-Encoding: nonce\0', 12);
  const decifrar = createDecipheriv('aes-128-gcm', chave, nonce);
  decifrar.setAuthTag(pacote.subarray(-16));
  const conteudo = Buffer.concat([decifrar.update(pacote.subarray(21 + pacote[20], -16)), decifrar.final()]);
  assert.deepEqual(conteudo, Buffer.concat([mensagem, Buffer.from([2])]));
});
