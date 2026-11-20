// Apenas fixtures fictícias; nenhum pedido /api sai do navegador.
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
