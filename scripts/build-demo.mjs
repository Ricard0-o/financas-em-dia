import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';

const root = resolve(import.meta.dirname,'..');
const temporary = mkdtempSync(join(tmpdir(),'financas-demo-'));
const output = join(root,'demo');
const password = randomBytes(20).toString('hex');
const server = spawn(process.execPath,[join(root,'servidor.mjs')], {
  cwd: root, stdio: ['ignore','pipe','pipe'],
  env: {...process.env, FINANCAS_BANCO: join(temporary,'ficticio.sqlite'), FINANCAS_HOST:'127.0.0.1',FINANCAS_PORTA:'0',FINANCAS_ORIGEM_PUBLICA:'',FINANCAS_PUSH_CONTATO:'',FINANCAS_TLS_CHAVE:'',FINANCAS_TLS_CERT:''}
});
let cookie = '';
try {
  const origin = await new Promise((res,rej) => {
    let stdout='', stderr='';
    const timer=setTimeout(()=>rej(new Error('Servidor de preparação não iniciou.')),15000);
    server.stdout.on('data',d=>{stdout+=d;const match=stdout.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);res(match[0]);}});
    server.stderr.on('data',d=>{stderr+=d;});
    server.once('exit',code=>{clearTimeout(timer);rej(new Error(`Servidor encerrou: ${code}; ${stderr}`));});
  });
  async function api(path,data) {
    const response=await fetch(origin+'/api'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify({chave:randomUUID(),...data})});
    if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
    const value=await response.json(); if(!response.ok) throw new Error(path+': '+JSON.stringify(value)); return value;
  }
  const {id}=await api('/perfis/inicializar',{login:'demo',nome:'Pessoa demonstrativa',senha:password});
  await api('/login',{perfil:id,senha:password});
  await api('/perfil/contatos',{email:'demo@example.test',telefone:'11900000001'});
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const start=today.slice(0,8)+'01';
  const cat={};
  for(const name of ['Alimentação','Transporte','Moradia','Lazer']) cat[name]=(await api('/categorias',{nome:name})).id;
  const account=(await api('/contas',{nome:'Conta demonstrativa',tipo:'conta',saldo_inicial:120000,inicio:start})).id;
  const reserve=(await api('/contas',{nome:'Reserva de emergência',tipo:'reserva',saldo_inicial:250000,inicio:start})).id;
  await api('/contas',{nome:'Investimentos demonstrativos',tipo:'investimento',saldo_inicial:180000,inicio:start});
  const salary={destino:account,data:start,valor:420000,descricao:'Salário fictício'};
  const preview=await api('/salarios/previa',salary);
  await api('/salarios',{...salary,revisao:preview.revisao,confirmar_segundo:false});
  for(const [description,amount,category] of [['Mercado fictício',36450,'Alimentação'],['Aluguel demonstrativo',110000,'Moradia'],['Transporte do mês',18500,'Transporte'],['Cinema demonstrativo',6400,'Lazer']])
    await api('/lancamentos',{tipo:'despesa',origem:account,data:today,valor:amount,descricao:description,categoria:cat[category]});
  await api('/lancamentos',{tipo:'renda',destino:account,data:today,valor:35000,descricao:'Projeto fictício'});
  await api('/lancamentos',{tipo:'transferencia',origem:account,destino:reserve,data:today,valor:30000,descricao:'Aporte demonstrativo'});
  const card=(await api('/cartoes',{nome:'Cartão demonstrativo',limite:300000,fechamento:25,vencimento:5})).id;
  const purchase=(await api('/compras',{cartao:card,data:today,valor:96000,parcelas:3,descricao:'Compra fictícia parcelada',categoria:cat.Lazer})).id;
  const paths=['/sessao','/perfis','/base','/periodos','/painel','/lancamentos','/cartoes','/compromissos','/relatorios','/notificacoes','/perfil/solicitacoes-senha','/grupo','/admin',`/contas/${account}`,`/contas/${reserve}`,`/compras/${purchase}`];
  const fixtures={};
  for(const path of paths) fixtures['/api'+path]=await api(path);
  fixtures['/api/sessao'].admin=false;
  fixtures['/api/notificacoes'].ativa=false;
  for(const item of fixtures['/api/cartoes'].faturas??[]) fixtures['/api/faturas/'+item.id]=await api('/faturas/'+item.id);
  mkdirSync(output,{recursive:true});
  cpSync(join(root,'publico'),output,{recursive:true});
  // Demos não publicam o service worker nem solicitam permissões ou dados pessoais.
  for(const filename of ['sw.js','manifesto.json']) rmSync(join(output,filename),{force:true});
  let html=readFileSync(join(output,'index.html'),'utf8').replace('<title>Finanças em Dia</title>','<title>Demonstração · Finanças em Dia</title>').replace(/\s*<link rel="manifest"[^>]*>/,'');
  html=html.replace('</head>','<script src="/demo-adapter.js"></script><link rel="stylesheet" href="/demo.css"></head>');
  html=html.replace('<body>','<body><aside class="demo-banner"><strong>Demonstração com dados fictícios</strong><span> Navegação e consulta; alterações não são salvas.</span> <a href="https://github.com/Ricard0-o/financas-em-dia">Código e instalação</a></aside>');
  writeFileSync(join(output,'index.html'),html);
  writeFileSync(join(output,'demo-data.json'),JSON.stringify(fixtures));
  writeFileSync(join(output,'demo.css'),'.demo-banner{position:relative;z-index:10;padding:.8rem 1rem;background:#123d30;color:#fff;font:15px/1.5 system-ui;text-align:center}.demo-banner a{color:#fff;text-decoration:underline;margin-left:.8rem}.demo-banner span{display:inline}');
  writeFileSync(join(output,'demo-adapter.js'),`// Apenas fixtures fictícias; nenhum pedido /api sai do navegador.
(() => {
const nativeFetch=window.fetch.bind(window);
const ready=nativeFetch('/demo-data.json').then(r=>{if(!r.ok)throw new Error('Dados demonstrativos indisponíveis');return r.json();});
let theme='claro';
window.fetch=async (input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(input,options);
  const data=await ready;
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const method=options.method??'GET';
  if(url.pathname==='/api/rede')return response({endereco:location.origin});
  if(url.pathname==='/api/tema'){theme=JSON.parse(options.body).tema;return response({tema:theme});}
  if(method!=='GET')return response({erro:'Demonstração somente para consulta. Instale o projeto para salvar alterações.'},403);
  if(url.pathname==='/api/sessao')return response({...data[url.pathname],tema:theme});
  if(Object.hasOwn(data,url.pathname))return response(data[url.pathname]);
  return response({erro:'Este recurso exige o servidor completo. Veja as instruções no GitHub.'},404);
};
})();
`);
  console.log(`Demonstração gerada: ${Object.keys(fixtures).length} respostas fictícias. Nenhum banco foi incluído.`);
} finally {
  if(server.exitCode===null){server.kill();await once(server,'exit');}
  rmSync(temporary,{recursive:true,force:true});
}
