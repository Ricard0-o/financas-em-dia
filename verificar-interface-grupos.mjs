// Executa somente contra banco e perfil Chrome temporários.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { hoje, somarDias } from './validacao.mjs';

const pasta = mkdtempSync(join(tmpdir(), 'financas-interface-grupos-'));
const pausa = ms => new Promise(r => setTimeout(r, ms));
function iniciou(processo, fluxo, regex) {
  return new Promise((resolve, reject) => {
    let texto = '';
    processo[fluxo].on('data', b => { texto += b; const m = texto.match(regex); if (m) resolve(m[1]); });
    processo.once('error', reject); processo.once('exit', c => reject(Error('Processo encerrou: ' + c)));
  });
}
const servidor = spawn(process.execPath, [fileURLToPath(new URL('./servidor.mjs', import.meta.url))], {
  windowsHide: true, env: { ...process.env, FINANCAS_BANCO: join(pasta, 'teste.sqlite'), FINANCAS_PORTA:'0', FINANCAS_HOST:'127.0.0.1',
    FINANCAS_ORIGEM_PUBLICA:'', FINANCAS_PUSH_CONTATO:'', FINANCAS_PUBLICO: process.env.FINANCAS_PUBLICO || fileURLToPath(new URL('./publico/', import.meta.url)) }
});
let chrome;
try {
  const url = await iniciou(servidor, 'stdout', /(http:\/\/127\.0\.0\.1:\d+)/);
  const senha = 'teste de interface';
  async function post(rota, dados, cookie = '') {
    const resposta = await fetch(url + '/api' + rota, { method:'POST', headers:{'Content-Type':'application/json',Origin:url,Cookie:cookie}, body:JSON.stringify(dados) });
    const json = await resposta.json(); assert.ok(resposta.ok, JSON.stringify(json));
    return { json, cookie:resposta.headers.get('set-cookie')?.split(';')[0] };
  }
  await post('/perfis/inicializar', { nome:'Admin de teste', login:'admin', senha });
  const admin = (await post('/login', { login:'admin', senha })).cookie;
  await post('/perfil/contatos', { email:'admin@example.com',telefone:'11900000001' }, admin);
  const donoId = (await post('/admin/usuarios', { nome:'Responsável',login:'dono',senha,senha_admin:senha }, admin)).json.id;
  const dono = (await post('/login',{login:'dono',senha})).cookie;
  await post('/perfil/contatos',{email:'dono@example.com',telefone:'11900000002'},dono);
  await post('/grupo/criar',{nome:'Família de teste <img src=x onerror=window.__xss=1>',admin_login:'admin',senha_admin:senha},dono);
  const familia = (await (await fetch(url+'/api/grupo',{headers:{Cookie:dono}})).json()).familia;

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new','--remote-debugging-port=0','--user-data-dir='+join(pasta,'chrome'),'--no-first-run','about:blank'], {windowsHide:true});
  const porta = await iniciou(chrome,'stderr',/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
  const [alvo] = await (await fetch('http://127.0.0.1:'+porta+'/json/list')).json();
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open',r,{once:true}));
  let id = 0; const pendentes = new Map(); const excecoes = [];
  ws.onmessage = e => { const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown') excecoes.push(m.params.exceptionDetails); if(m.id) { const p=pendentes.get(m.id); pendentes.delete(m.id); m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result); } };
  const enviar = (method,params={}) => new Promise((resolve,reject)=>{const n=++id;pendentes.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  async function avaliar(expression) { const r=await enviar('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value; }
  async function esperar(expression) { for(let i=0;i<140;i++){if(await avaliar(expression))return;await pausa(70);}throw Error('Tempo excedido: '+expression); }
  async function preencher(valores) { await esperar(`!!document.querySelector('dialog[open] form')`); await esperar(`Object.keys(${JSON.stringify(valores)}).every(nome => !!document.querySelector('dialog[open] form')?.elements[nome])`); await avaliar(`for(const [nome,valor] of Object.entries(${JSON.stringify(valores)})){ const campo=document.querySelector('dialog[open] form').elements[nome]; campo.value=valor; campo.dispatchEvent(new Event('input',{bubbles:true})); campo.dispatchEvent(new Event('change',{bubbles:true})); }`); }
  const clicar = async seletor => {
    const visivel = await avaliar(`!![...document.querySelectorAll(${JSON.stringify(seletor)})].find(e=>e.getClientRects().length)`);
    if (!visivel && await avaliar('!!document.querySelector(".barra-inferior") && getComputedStyle(document.querySelector(".barra-inferior")).display !== "none"')) {
      const acao = seletor.match(/\[data-acao=(?:["'])?(sair|tema|selecionar-familia|tutorial)(?:["'])?\]/)?.[1];
      if (acao) {
        if (!await avaliar('document.querySelector("#menu-movel").open')) await avaliar('document.querySelector(".barra-inferior [data-acao=menu-movel]").click()');
        await esperar(`document.querySelector('#menu-movel').open && !!document.querySelector('#menu-movel [data-acao="${acao}"]')`);
      }
    }
    await avaliar(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(seletor)})].find(e=>e.getClientRects().length);if(!e)throw Error('Controle invisível: '+${JSON.stringify(seletor)});e.click();})()`);
  };
  const enviarForm = () => avaliar('document.querySelector("dialog form").requestSubmit()');
  const capturar = async nome => {
    if (!process.env.FINANCAS_CAPTURAS) return;
    mkdirSync(process.env.FINANCAS_CAPTURAS,{recursive:true});
    const captura=await enviar('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(process.env.FINANCAS_CAPTURAS,nome+'.png'),Buffer.from(captura.data,'base64'));
  };
  await enviar('Runtime.enable');
  await enviar('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await enviar('Page.navigate',{url});
  await esperar('!!document.querySelector("[data-acao=cadastro-publico]")');
  assert.equal(await avaliar('document.querySelectorAll(".perfil-cartao[data-acao=escolher-perfil]").length'),0);
  assert.equal(await avaliar('document.querySelectorAll("[data-qr-rede],.qr-rede-imagem").length'),0);
  assert.ok(await avaliar('document.querySelector(".inicio-publico h1").textContent.includes("Sua paz em dia")'));
  assert.equal(await avaliar('document.querySelectorAll(".inicio-recursos article").length'),3);
  await esperar('document.querySelector(".inicio-acesso-ilustracao")?.complete && document.querySelector(".inicio-acesso-ilustracao").naturalWidth > 0');
  assert.equal(await avaliar('document.querySelectorAll(".inicio-acesso-icone").length'),0);
  await capturar('inicio-desktop');
  await enviar('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await avaliar('document.documentElement.scrollWidth <= innerWidth'),'Página inicial deve caber no celular');
  await capturar('inicio-celular');
  await enviar('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await clicar('[data-acao=cadastro-publico]');
  assert.equal(await avaliar('document.querySelectorAll("[name=codigo_familia]").length'),0);
  assert.ok(await avaliar('document.querySelector("#ajuda-login").textContent.includes("entrar")'));
  assert.equal(await avaliar('document.querySelectorAll("dialog [name=senha_admin]").length'),0);
  await preencher({nome:'Integrante de teste',login:'integrante',senha,confirmacao_senha:senha,modo:'depois'});
  assert.equal(await avaliar('getComputedStyle(document.querySelector("[name=familia_nome]").closest("label")).display'), 'none');
  await enviarForm();await esperar('!!document.querySelector("dialog [name=senha_admin]")');
  assert.ok(await avaliar('document.querySelector("dialog h2").textContent.includes("Confirmar cadastro")'));
  await clicar('[data-voltar-dados-cadastro]');
  assert.equal(await avaliar('document.querySelector("dialog [name=login]").value'),'integrante');
  await enviarForm();await esperar('!!document.querySelector("dialog [name=senha_admin]")');
  await preencher({admin_login:'admin',senha_admin:'senha incorreta'});await enviarForm();
  await esperar('document.querySelector("dialog .erro")?.textContent.includes("inválida")');
  assert.equal(await avaliar('document.querySelectorAll("dialog [name=senha_admin]").length'),1);
  await preencher({admin_login:'admin',senha_admin:senha});await enviarForm();
  await esperar('!!document.querySelector("dialog form [name=login]") && !document.querySelector("dialog form [name=nome]")');
  await preencher({login:'integrante',senha});await enviarForm();
  await esperar('!!document.querySelector(".cadastro-contatos")');
  await avaliar(`const form=document.querySelector('.cadastro-contatos');form.elements.email.value='integrante@example.com';form.elements.telefone.value='11900000003';form.requestSubmit()`);
  await esperar('!!document.querySelector(".layout")');
  await enviar('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await enviar('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  assert.equal(await avaliar('document.querySelectorAll(".barra-inferior > *").length'),5);
  assert.equal(await avaliar('getComputedStyle(document.querySelector(".menu")).display'),'none');
  assert.equal(await avaliar('getComputedStyle(document.querySelector(".acoes-topo")).display'),'none');
  assert.equal(await avaliar('getComputedStyle(document.querySelector(".barra-inferior")).position'),'fixed');
  assert.ok(await avaliar('parseFloat(getComputedStyle(document.querySelector(".area")).paddingBottom)>document.querySelector(".barra-inferior").getBoundingClientRect().height'));
  await clicar('[data-acao=menu-movel]');await esperar('document.querySelector("#menu-movel").open');
  assert.ok(await avaliar('document.querySelector("#menu-movel").matches(":modal")'));
  assert.equal(await avaliar(`!!document.querySelector('#menu-movel a[href="#admin"]')`),false);
  assert.ok(await avaliar(`!!document.querySelector('#menu-movel a[href="#notificacoes"][aria-current="page"]')`));
  assert.equal(await avaliar('getComputedStyle(document.body).overflow'),'hidden');
  await capturar('menu-mais-celular');
  await clicar('[data-fechar-menu-movel]');await esperar('!document.querySelector("#menu-movel").open');
  assert.equal(await avaliar('document.activeElement.dataset.acao'),'menu-movel');
  await clicar('[data-acao=menu-movel]');
  await enviar('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await enviar('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await esperar('!document.querySelector("#menu-movel").open');
  await clicar('[data-acao=menu-movel]');
  await enviar('Input.dispatchMouseEvent',{type:'mousePressed',x:8,y:5,button:'left',clickCount:1});
  await enviar('Input.dispatchMouseEvent',{type:'mouseReleased',x:8,y:5,button:'left',clickCount:1});
  await esperar('!document.querySelector("#menu-movel").open');
  await clicar('[data-acao=menu-movel]');await clicar('#menu-movel a[href="#historico"]');
  await esperar('location.hash==="#historico" && document.querySelector(".barra-inferior .ativo")?.getAttribute("aria-label").includes("Histórico")');
  assert.equal(await avaliar('document.querySelector("#menu-movel").open'),false);
  for(const destino of ['contas','cartoes','compromissos','inicio']){
    await clicar('.barra-inferior a[href="#'+destino+'"]');
    await esperar(`!!document.querySelector('.barra-inferior a[href="#${destino}"][aria-current="page"]')`);
  }
  await avaliar('history.back()');await esperar(`!!document.querySelector('.barra-inferior a[href="#compromissos"][aria-current="page"]')`);
  await avaliar('history.forward()');await esperar(`!!document.querySelector('.barra-inferior a[href="#inicio"][aria-current="page"]')`);
  await capturar('barra-inferior-celular');
  await clicar('.barra-inferior a[href="#contas"]');await esperar(`!!document.querySelector('.barra-inferior a[href="#contas"][aria-current="page"]')`);
  await clicar('[data-acao=conta][data-id=conta]');await esperar('!!document.querySelector("#janela[open] [name=nome]")');
  await avaliar('document.querySelector("#janela [name=nome]").focus()');
  assert.equal(await avaliar('getComputedStyle(document.querySelector(".barra-inferior")).display'),'none');
  assert.ok(await avaliar('document.querySelector("#janela").matches(":modal")'));
  await clicar('#janela .fechar');await esperar('getComputedStyle(document.querySelector(".barra-inferior")).display!=="none"');
  await clicar('.barra-inferior a[href="#inicio"]');await esperar(`!!document.querySelector('.barra-inferior a[href="#inicio"][aria-current="page"]')`);
  await avaliar('scrollTo(0,document.documentElement.scrollHeight)');
  assert.ok(await avaliar('document.querySelector(".pagina").lastElementChild.getBoundingClientRect().bottom <= document.querySelector(".barra-inferior").getBoundingClientRect().top + 1'),'A barra não pode cobrir o final do conteúdo');
  const sessaoPreferencias=(await post('/login',{login:'integrante',senha})).cookie;
  const preferencias={nome_exibicao:'',avatar:'iniciais',cor_perfil:'verde',foto_avatar:'',formato_avatar:'arredondado',tema:'claro',tamanho_texto:'grande',espacamento:'compacto'};
  await post('/perfil/aparencia',preferencias,sessaoPreferencias);
  await enviar('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
  await enviar('Page.reload');await esperar('!!document.querySelector(".barra-inferior")');
  assert.equal(await avaliar('getComputedStyle(document.documentElement).fontSize'),'18px');
  assert.ok(await avaliar('document.documentElement.scrollWidth<=innerWidth'),'Navegação a 320 px com texto grande');
  assert.ok(await avaliar('[...document.querySelectorAll(".atalho-inferior")].every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth;})'));
  assert.ok(await avaliar(`(()=>{const e=document.querySelector('.barra-inferior a[href="#compromissos"] > span:last-child');return e.scrollWidth<=e.parentElement.clientWidth;})()`),'Rótulo Compromissos deve caber na barra');
  await capturar('barra-320-texto-grande');
  await post('/perfil/aparencia',{...preferencias,tamanho_texto:'normal',espacamento:'normal'},sessaoPreferencias);
  await enviar('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await enviar('Page.reload');await esperar('!!document.querySelector(".barra-inferior")');


  await avaliar("location.hash='familia'");await esperar('!!document.querySelector("[data-acao=grupo-entrar]")');
  await clicar('[data-acao=grupo-entrar]');await preencher({codigo:familia.codigo});await enviarForm();
  await esperar('document.querySelector(".pagina")?.textContent.includes("Último pedido")');
  const pendente = (await (await fetch(url+'/api/grupo',{headers:{Cookie:dono}})).json()).entradas[0];
  await post('/grupo/entradas/'+pendente.id,{decisao:'aprovado',senha_atual:senha},dono);
  await enviar('Page.reload');await esperar('document.querySelector(".pagina")?.textContent.includes("Família de teste")');
  assert.equal(await avaliar('window.__xss'), undefined);
  assert.equal(await avaliar('document.querySelectorAll(".pagina h2 img").length'),0);
  await clicar('[data-acao=selecionar-familia]');
  await esperar('!!document.querySelector(".seletor-familia")');
  assert.equal(await avaliar('location.hash'),'#perfis-familia');
  assert.equal(await avaliar('!!document.querySelector("dialog[open]")'),false);
  assert.equal(await avaliar('!!document.querySelector(".layout")'),false);
  assert.equal(await avaliar('!!document.querySelector(".barra-inferior")'),false);
  assert.equal(await avaliar('document.querySelectorAll(".seletor-familia .perfil-cartao").length'),2);
  await enviar('Page.reload');await esperar('!!document.querySelector(".seletor-familia")');
  await enviar('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await avaliar('document.documentElement.scrollWidth <= innerWidth'),'Seletor familiar deve caber no celular');
  await capturar('familia-claro-celular');
  await post('/tema',{tema:'escuro'},sessaoPreferencias);
  await enviar('Page.reload');await esperar('!!document.querySelector(".seletor-familia") && document.documentElement.dataset.tema === "escuro"');
  assert.ok(await avaliar(`(()=>{
    const fundo=getComputedStyle(document.querySelector('.tela-perfis')).backgroundImage;
    const cores=[...fundo.matchAll(/rgba?\\(([^)]+)\\)/g)].map(m=>m[1].split(',').map(Number));
    if(!cores.length)return false;
    const luminancia=rgb=>rgb.slice(0,3).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
    return ['.seletor-familia h1','.seletor-familia > p','.seletor-familia > .marca'].every(seletor=>{
      const texto=getComputedStyle(document.querySelector(seletor)).color.match(/[\\d.]+/g).map(Number);
      return cores.every(cor=>{const alfa=cor[3]??1;const l1=luminancia(texto),l2=luminancia(cor.map((c,i)=>i<3?c*alfa+255*(1-alfa):c));return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)>=4.5;});
    });
  })()`),'Textos sobre a imagem devem manter contraste de pelo menos 4,5:1 mesmo sobre uma região branca');
  await capturar('familia-escuro-celular');
  await post('/tema',{tema:'claro'},sessaoPreferencias);
  await enviar('Page.reload');await esperar('!!document.querySelector(".seletor-familia") && document.documentElement.dataset.tema === "claro"');
  await enviar('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await clicar('.seletor-familia .perfil-cartao:not([data-id="'+donoId+'"])');
  await preencher({senha:'incorreta'});await enviarForm();
  await esperar('document.querySelector("dialog[open] .erro")?.textContent.includes("Senha incorreta")');
  assert.ok(await avaliar('!!document.querySelector(".seletor-familia")'));
  await preencher({senha});await enviarForm();
  await esperar('location.hash === "#inicio" && !!document.querySelector(".layout")');
  assert.equal(await avaliar('!!document.querySelector(".seletor-familia")'),false);
  assert.equal(await avaliar('document.querySelector("#menu-movel").children.length'),0);
  await avaliar("location.hash='perfil'");await esperar('!!document.querySelector("[data-acao=grupo-autorizar]")');
  await clicar('[data-acao=grupo-autorizar]');await preencher({senha_atual:senha});await enviarForm();
  await esperar('document.querySelector("[data-acao=grupo-autorizar]")?.textContent.includes("Revogar")');
  await clicar('[data-secao-perfil=aparencia]');
  const escolherFotoTeste = async () => avaliar(`(async () => {
    const fonte=document.createElement('canvas');fonte.width=300;fonte.height=100;
    const ctx=fonte.getContext('2d');for(const [i,cor] of ['red','green','blue'].entries()){ctx.fillStyle=cor;ctx.fillRect(i*100,0,100,100);}
    const blob=await new Promise(resolve=>fonte.toBlob(resolve,'image/png'));
    const transferencia=new DataTransfer();transferencia.items.add(new File([blob],'foto-teste.png',{type:'image/png'}));
    const entrada=document.querySelector('[data-foto-perfil]');entrada.files=transferencia.files;entrada.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await escolherFotoTeste();await esperar('!document.querySelector("[data-recorte-foto]").hidden');
  assert.equal(await avaliar('document.querySelector("[name=foto_avatar]").value'),'');
  await avaliar('document.querySelector(".editor-perfil form").requestSubmit()');
  await esperar('document.querySelector(".editor-perfil form > .erro")?.textContent.includes("recorte")');
  await avaliar(`const x=document.querySelector('[data-recorte-x]');x.value='100';x.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.ok(await avaliar(`document.querySelector('[data-previa-recorte]').getContext('2d').getImageData(160,160,1,1).data[2]>240`));
  await avaliar(`const z=document.querySelector('[data-recorte-zoom]');z.value='2';z.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await avaliar('document.querySelector("[data-recorte-y]").disabled'),false);
  await clicar('[data-usar-recorte]');
  await esperar('document.querySelector("[data-recorte-foto]").hidden');
  const fotoRecortada=await avaliar('document.querySelector("[name=foto_avatar]").value');
  assert.ok(fotoRecortada.startsWith('data:image/jpeg;base64,'));
  const pixelSalvo=await avaliar(`(async()=>{const img=new Image();img.src=document.querySelector('[name=foto_avatar]').value;await img.decode();const c=document.createElement('canvas');c.width=c.height=128;c.getContext('2d').drawImage(img,0,0);return {largura:img.naturalWidth,altura:img.naturalHeight,pixel:[...c.getContext('2d').getImageData(64,64,1,1).data]};})()`);
  assert.equal(pixelSalvo.largura,128);assert.equal(pixelSalvo.altura,128);assert.ok(pixelSalvo.pixel[2]>240 && pixelSalvo.pixel[0]<15);
  await escolherFotoTeste();await esperar('!document.querySelector("[data-recorte-foto]").hidden');
  await enviar('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await enviar('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await avaliar('document.querySelector("[data-previa-recorte]").scrollIntoView({block:"center"})');
  assert.notEqual(await avaliar('getComputedStyle(document.querySelector(".barra-inferior")).display'),'none');
  const ponto=await avaliar('(()=>{const r=document.querySelector("[data-previa-recorte]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  await enviar('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[ponto]});
  await enviar('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:ponto.x-60,y:ponto.y}]});
  await enviar('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await avaliar('Number(document.querySelector("[data-recorte-x]").value)>50'),'Arrastar no celular deve mudar o enquadramento');
  assert.ok(await avaliar('document.documentElement.scrollWidth<=innerWidth'),'Editor quadrado deve caber no celular');
  await clicar('[data-cancelar-recorte]');
  assert.equal(await avaliar('document.querySelector("[name=foto_avatar]").value'),fotoRecortada);
  await clicar('[name=formato_avatar][value=redondo]');
  await avaliar('document.querySelector(".editor-perfil form").requestSubmit()');await esperar('document.querySelector("[data-painel-perfil=aparencia]")?.hidden === true');
  assert.equal(await avaliar('(async()=>(await (await fetch("/api/sessao")).json()).foto_avatar)()'),fotoRecortada);
  await enviar('Page.reload');await esperar('!!document.querySelector(".editor-perfil form")');
  assert.equal(await avaliar('document.querySelector("[name=foto_avatar]").value'),fotoRecortada);
  // Uma solicitação administrativa deve aparecer em Notificações, mesmo sem push.
  const integrantes = await (await fetch(url+'/api/perfis',{headers:{Cookie:dono}})).json();
  const integranteId = integrantes.perfis.find(p=>p.id!==donoId).id;
  const acesso = (await post('/acessos/solicitar',{usuario:integranteId,justificativa:'Verificação visual',senha_atual:senha},admin)).json.id;
  await avaliar("location.hash='notificacoes'");await esperar('!!document.querySelector("[data-acao=acesso-aprovar]")');
  await clicar('[data-acao=acesso-aprovar]');await preencher({senha_atual:senha});await enviarForm();await esperar('!!document.querySelector("[data-acao=acesso-revogar]")');
  await clicar('[data-acao=acesso-revogar]');await preencher({senha_atual:senha});await enviarForm();await esperar('!document.querySelector("[data-acao=acesso-revogar]")');
  await enviar('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await avaliar("location.hash='familia'");await esperar('document.querySelector(".pagina")?.textContent.includes("Família de teste")');
  assert.ok(await avaliar('document.documentElement.scrollWidth <= innerWidth'),'Tela do celular não deve transbordar');
  await clicar('[data-acao=sair]');await esperar('!!document.querySelector("[data-acao=entrar-login]")');
  await clicar('[data-acao=recuperar-senha]');await preencher({login:'integrante'});await enviarForm();
  await esperar('!!document.querySelector("[data-acao=concluir-recuperacao]")');
  const pedidoRecuperacao = (await (await fetch(url+'/api/admin',{headers:{Cookie:admin}})).json()).recuperacoes[0];
  const recuperacao = (await post('/admin/recuperacoes/liberar',{id:pedidoRecuperacao.id,senha_atual:senha,canal:'email',identidade_confirmada:true},admin)).json;
  await clicar('[data-acao=concluir-recuperacao]');await preencher({token:recuperacao.token,senha:'outra frase segura',confirmacao_senha:'outra frase segura'});await enviarForm();
  await esperar('!document.querySelector("dialog[open]") && !!document.querySelector("[data-acao=entrar-login]")');
  const titular = (await post('/login',{login:'integrante',senha:'outra frase segura'})).cookie;
  await post('/grupo/consentimento',{permitir:true,senha_atual:'outra frase segura'},titular);
  await post('/contas',{nome:'Conta demonstrativa',tipo:'conta',saldo_inicial:20000,inicio:'2026-01-01',chave:'conta'},titular);
  await clicar('[data-acao=entrar-login]');await preencher({login:'dono',senha});await enviarForm();await esperar('!!document.querySelector(".layout")');
  await avaliar("location.hash='familia'");await esperar('!!document.querySelector("[data-acao=abrir-perfil]")');
  await clicar('[data-acao=abrir-perfil]');await esperar('!!document.querySelector(".perfil-aberto")');
  await clicar('[data-acao=menu-movel]');
  assert.equal(await avaliar(`document.querySelectorAll('#menu-movel a[href="#perfil"],#menu-movel a[href="#familia"],#menu-movel a[href="#admin"],#menu-movel a[href="#notificacoes"]').length`),0);
  assert.ok(await avaliar(`!!document.querySelector('#menu-movel a[href="#relatorios"]')`));
  await clicar('[data-fechar-menu-movel]');

  assert.equal(await avaliar('document.querySelectorAll("[data-acao=movimento],[data-acao=salario]").length'),0);
  await avaliar("location.hash='contas'");await esperar('document.querySelector(".pagina")?.textContent.includes("Conta demonstrativa")');
  assert.equal(await avaliar('document.querySelectorAll("[data-acao=editar-conta]").length'),0);
  assert.ok(await avaliar('document.documentElement.scrollWidth <= innerWidth'),'Consulta no celular');
  await clicar('[data-acao=sair]');await esperar('!!document.querySelector("[data-acao=entrar-login]")');
  await post('/recuperacao/solicitar',{login:'dono'});
  await clicar('[data-acao=entrar-login]');await preencher({login:'admin',senha});await enviarForm();await esperar('!!document.querySelector(".layout")');
  await avaliar("location.hash='admin'");await esperar('!!document.querySelector("[data-acao=recuperacao-liberar]")');
  await clicar('[data-acao=recuperacao-liberar]');await preencher({canal:'email',senha_atual:senha});
  await avaliar('document.querySelector("[name=identidade_confirmada]").checked=true');
  await enviarForm();await esperar('!!document.querySelector("dialog .codigo-recuperacao")');
  assert.ok(await avaliar('/^[a-f0-9]{64}$/.test(document.querySelector("dialog .codigo-recuperacao").textContent)'));
  await avaliar('document.querySelector("dialog .fechar").click()');
  const cartaoA=(await post('/cartoes',{nome:'Cartão incorreto',limite:50000,fechamento:20,vencimento:28,chave:'cartao-ui-a'},admin)).json.id;
  const cartaoB=(await post('/cartoes',{nome:'Cartão correto',limite:50000,fechamento:10,vencimento:15,chave:'cartao-ui-b'},admin)).json.id;
  const categoriaCompra=(await post('/categorias',{nome:'Categoria de compra',chave:'categoria-ui'},admin)).json.id;
  const compraTeste=(await post('/compras',{cartao:cartaoA,categoria:categoriaCompra,data:'2024-01-05',descricao:'Compra no cartão errado',valor:9000,parcelas:1,chave:'compra-ui'},admin)).json.id;
  const lerCompra=async()=> (await(await fetch(url+'/api/compras/'+compraTeste,{headers:{Cookie:admin}})).json());
  const compraAntes=await lerCompra();
  await avaliar("location.hash='cartoes'");await esperar(`!!document.querySelector('[data-acao=fatura][data-id="${compraAntes.itens[0].fatura}"]')`);
  await clicar('[data-acao=fatura][data-id="'+compraAntes.itens[0].fatura+'"]');
  await esperar('!!document.querySelector("dialog [data-acao=editar-compra]")');
  await clicar('dialog [data-acao=editar-compra]');
  await preencher({cartao:String(cartaoB),descricao:'Compra corrigida na interface',valor:'120,03',parcelas:'2'});
  await enviarForm();await esperar('document.querySelector("dialog h2")?.textContent.includes("Revisar alteração")');
  assert.equal((await lerCompra()).cartao,cartaoA,'Prévia não deve mover a compra');
  await enviarForm();await esperar('!document.querySelector("dialog[open]")');
  const compraCorrigida=await lerCompra();assert.equal(compraCorrigida.cartao,cartaoB);assert.equal(compraCorrigida.valor,12003);assert.equal(compraCorrigida.itens.length,2);
  await esperar(`!!document.querySelector('[data-acao=fatura][data-id="${compraCorrigida.itens[0].fatura}"]')`);
  await clicar('[data-acao=fatura][data-id="'+compraCorrigida.itens[0].fatura+'"]');await esperar('!!document.querySelector("dialog [data-acao=excluir-compra]")');
  await clicar('dialog [data-acao=excluir-compra]');await preencher({senha:'errada'});
  await avaliar('document.querySelector("dialog [name=confirmar]").checked=true');await enviarForm();
  await esperar('document.querySelector("dialog .erro")?.textContent.includes("senha correta")');
  assert.equal((await lerCompra()).valor,12003,'Senha incorreta não deve apagar a compra');
  await preencher({senha});await enviarForm();await esperar('!document.querySelector("dialog[open]")');
  assert.equal((await fetch(url+'/api/compras/'+compraTeste,{headers:{Cookie:admin}})).status,404);
  const cartoesDepois=await(await fetch(url+'/api/cartoes',{headers:{Cookie:admin}})).json();
  assert.equal(cartoesDepois.cartoes.find(c=>c.id===cartaoA).usado,0);assert.equal(cartoesDepois.cartoes.find(c=>c.id===cartaoB).usado,0);
  const diaRel=deslocamento=>somarDias(hoje(),deslocamento);
  const contaRel=(await post('/contas',{nome:'Conta do relatório',tipo:'conta',saldo_inicial:50000,inicio:'2024-01-01',chave:'conta-rel'},admin)).json.id;
  const reservaRel=(await post('/contas',{nome:'Reserva do relatório',tipo:'reserva',saldo_inicial:0,inicio:'2024-01-01',chave:'reserva-rel'},admin)).json.id;
  const categoriaRel=(await post('/categorias',{nome:'Transporte',chave:'categoria-rel'},admin)).json.id;
  for(const [i,deslocamento] of [-40,-10].entries()){
    const salario={data:diaRel(deslocamento),valor:200000,destino:contaRel};
    const previaSalario=(await post('/salarios/previa',salario,admin)).json;
    await post('/salarios',{...salario,revisao:previaSalario.revisao,chave:'salario-rel-'+i},admin);
  }
  for(const [i,item] of [{data:diaRel(-38),valor:50000,categoria:categoriaCompra},{data:diaRel(-8),valor:10000,categoria:categoriaCompra},{data:diaRel(-2),valor:5000,categoria:categoriaRel}].entries()){
    await post('/lancamentos',{...item,tipo:'despesa',origem:contaRel,descricao:'Despesa de relatório '+i,chave:'despesa-rel-'+i},admin);
  }
  await post('/lancamentos',{tipo:'renda',data:diaRel(-9),valor:10000,destino:contaRel,descricao:'Extra no ciclo',chave:'renda-rel'},admin);
  await post('/lancamentos',{tipo:'transferencia',data:diaRel(-3),valor:3000,origem:contaRel,destino:reservaRel,descricao:'Aporte separado',chave:'aporte-rel'},admin);
  await post('/compromissos',{nome:'Compromisso do ciclo',tipo:'avulso',inicio:diaRel(3),conta:contaRel,categoria:categoriaCompra,valor:30000,chave:'compromisso-rel'},admin);
  await avaliar("location.hash='relatorios'");await esperar('!!document.querySelector(".relatorio-frase")');
  const dadosRel=await(await fetch(url+'/api/relatorios',{headers:{Cookie:admin}})).json();
  assert.equal(dadosRel.entradas,210000);assert.equal(dadosRel.saidas,15000);assert.equal(dadosRel.previsao.valor,30000);
  assert.equal(dadosRel.ritmo.anterior.dias,11);assert.equal(dadosRel.patrimonio.aportes,3000);
  assert.equal(await avaliar('document.querySelectorAll(".relatorio-categoria").length'),2);
  await enviar('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  assert.equal(await avaliar('getComputedStyle(document.querySelector(".barra-inferior")).display'),'none');
  assert.notEqual(await avaliar('getComputedStyle(document.querySelector(".menu")).display'),'none');
  assert.notEqual(await avaliar('getComputedStyle(document.querySelector(".acoes-topo")).display'),'none');
  await avaliar('scrollTo(0,0)');await capturar('relatorios-desktop');
  await avaliar('document.querySelector("#grafico").scrollIntoView({block:"center"})');await capturar('relatorios-ritmo');
  await clicar('[data-acao=relatorio-detalhe][data-id=entradas]');await esperar('document.querySelector("dialog[open] h2")?.textContent.includes("Entradas")');
  assert.ok(await avaliar('document.querySelector("dialog").textContent.includes("Extra no ciclo")'));await clicar('dialog .fechar');
  await clicar('[data-acao=relatorio-detalhe][data-id=previstos]');await esperar('!!document.querySelector("dialog[open]")');
  assert.ok(await avaliar('document.querySelector("dialog").textContent.includes("Compromisso do ciclo")'));await clicar('dialog .fechar');
  await clicar('[data-acao=relatorio-categoria]');await esperar('document.querySelector("dialog[open] h2")?.textContent.includes("Saídas")');await clicar('dialog .fechar');
  await avaliar(`(()=>{const f=document.querySelector('form.filtros');f.elements.periodo.value='${diaRel(-40)}';f.elements.periodo.dispatchEvent(new Event('change'));f.requestSubmit();})()`);
  await esperar('document.querySelector(".relatorio-metricas")?.textContent.includes("Não se aplica")');
  assert.equal(await avaliar('document.querySelectorAll("[data-acao=relatorio-detalhe][data-id=previstos]").length'),0);
  await avaliar(`(()=>{const f=document.querySelector('form.filtros');f.elements.inicio.value='${diaRel(-5)}';f.elements.fim.value='${hoje()}';f.elements.inicio.dispatchEvent(new Event('change'));f.requestSubmit();})()`);
  await esperar('document.querySelector(".relatorio-frase")?.textContent.includes("Sem entradas") && !document.querySelector("[data-id=previstos]")');
  await avaliar(`(()=>{const f=document.querySelector('form.filtros');f.elements.periodo.value='${diaRel(-10)}';f.elements.periodo.dispatchEvent(new Event('change'));f.requestSubmit();})()`);
  await esperar('!!document.querySelector("[data-acao=relatorio-detalhe][data-id=previstos]")');
  await enviar('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await avaliar('document.documentElement.scrollWidth <= innerWidth'),'Relatórios devem caber no celular');
  await avaliar('window.__tituloAntesDoTema=document.querySelector("main h1")');
  await clicar('[data-acao=tema]');await esperar('document.documentElement.dataset.tema === "escuro"');
  assert.ok(await avaliar('window.__tituloAntesDoTema === document.querySelector("main h1")'),'Troca de tema deve preservar o conteúdo da página');
  assert.equal(await avaliar('document.querySelectorAll("[data-acao=tema]").length'),1,'Somente um controle de tema');
  assert.equal(await avaliar('document.querySelector(".interruptor-tema").getAttribute("aria-checked")'),'true');
  assert.ok(await avaliar('parseFloat(getComputedStyle(document.querySelector(".circulo-tema")).transitionDuration)>0'),'Interruptor deve ter transição');
  await esperar('!document.documentElement.classList.contains("trocando-tema")');
  await avaliar('scrollTo(0,0)');await capturar('relatorios-celular');
  await clicar('[data-acao=menu-movel]');
  assert.ok(await avaliar(`!!document.querySelector('#menu-movel a[href="#admin"]')`));
  assert.ok(await avaliar(`!!document.querySelector('#menu-movel a[href="#relatorios"][aria-current="page"]')`));
  await capturar('menu-mais-admin-escuro');
  await enviar('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  assert.notEqual(await avaliar('getComputedStyle(document.querySelector(".barra-inferior")).display'),'none');
  assert.ok(await avaliar('document.querySelector("#menu-movel").getBoundingClientRect().height <= innerHeight'));
  assert.ok(await avaliar('document.querySelector(".conteudo-mais").scrollHeight>document.querySelector(".conteudo-mais").clientHeight'));
  await enviar('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await esperar('!document.querySelector("#menu-movel").open');
  assert.equal(await avaliar('getComputedStyle(document.querySelector(".barra-inferior")).display'),'none');

  assert.equal(excecoes.length,0,JSON.stringify(excecoes));
  ws.close();
  console.log('Interface OK: seletor familiar em página completa, senha inválida e retorno após seleção, cadastro autorizado, login, contatos, pedido de entrada, consentimento, aparência, recorte quadrado/zoom/cancelamento/persistência, notificações de acesso, revogação, recuperação, edição/exclusão de compra com senha, relatórios, barra inferior, painel Mais/foco/permissões, 320 px com texto grande e orientação horizontal.');
} finally {
  chrome?.kill();servidor.kill();await pausa(800);
  rmSync(pasta,{recursive:true,force:true,maxRetries:5,retryDelay:400});
}
