import { existsSync, readFileSync, watchFile } from 'node:fs';
import { createServer as http } from 'node:http';
import { createServer as https } from 'node:https';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { abrirBanco, caminhoBanco } from './banco.mjs';
import { administracao, atualizarAparencia, atualizarMeuPerfil, autenticar, cadastrarContatos, confirmarSenha, cookieSessao, criarPrimeiroAdministrador, donoDosDados, encerrarSessao, lerSessao, listarPerfis, removerDadosDoPerfil, solicitacoesSenha } from './acesso.mjs';
import { movimentacoes } from './movimentacoes.mjs';
import { periodos } from './periodos.mjs';
import { atualizarRecorrencias, compromissos } from './compromissos.mjs';
import { relatorios } from './relatorios.mjs';
import { enderecoParaCelular, enderecosDaRede } from './rede.mjs';
import { cadastroAutorizado, rotasGrupos, dadosGrupo, notificacoesInternas, solicitarRecuperacao, concluirRecuperacao, liberarRecuperacao, limitarRequisicoes, eventoSeguranca } from './grupos.mjs';
import { iniciarNotificacoes } from './notificacoes.mjs';
import { ErroAplicacao, exigir, hoje, inteiro } from './validacao.mjs';
import { contextoDaRequisicao, validarOrigemDaRequisicao, validarOrigemPublica } from './origens.mjs';

const arquivoConfiguracao = new URL('./configuracao-local.json', import.meta.url);
const configuracao = existsSync(arquivoConfiguracao) ? JSON.parse(readFileSync(arquivoConfiguracao, 'utf8')) : {};
const origemPublica = validarOrigemPublica(process.env.FINANCAS_ORIGEM_PUBLICA ?? configuracao.origem_publica);

const porta = inteiro(Number(process.env.FINANCAS_PORTA ?? 8091), 'porta', 0, 65535);
const host = process.env.FINANCAS_HOST ?? '0.0.0.0';
const localTls = join(dirname(caminhoBanco), 'tls', 'servidor');
const usarLocal = !process.env.FINANCAS_TLS_CHAVE && !process.env.FINANCAS_TLS_CERT && existsSync(`${localTls}.crt`);
const chaveTls = usarLocal ? `${localTls}.key` : process.env.FINANCAS_TLS_CHAVE;
const certTls = usarLocal ? `${localTls}.crt` : process.env.FINANCAS_TLS_CERT;
exigir(Boolean(chaveTls) === Boolean(certTls), 'Informe a chave e o certificado TLS juntos.');
const seguro = Boolean(chaveTls);
const banco = abrirBanco();
const notificacoes = iniciarNotificacoes(banco, seguro || Boolean(origemPublica), {
  contato: process.env.FINANCAS_PUSH_CONTATO ?? configuracao.push_contato
});
const pastaPublica = process.env.FINANCAS_PUBLICO ? resolve(process.env.FINANCAS_PUBLICO) : fileURLToPath(new URL('./publico/', import.meta.url));
const arquivos = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/bancos.mjs', ['bancos.mjs', 'text/javascript; charset=utf-8']],
  ['/aparencia.mjs', ['aparencia.mjs', 'text/javascript; charset=utf-8']],
  ['/banco-nubank.png', ['banco-nubank.png', 'image/png']],
  ['/banco-santander.png', ['banco-santander.png', 'image/png']],
  ['/banco-mercado-pago.png', ['banco-mercado-pago.png', 'image/png']],
  ['/qrcode.mjs', ['qrcode.mjs', 'text/javascript; charset=utf-8']],
  ['/estilo.css', ['estilo.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifesto.json', ['manifesto.json', 'application/manifest+json']],
  ['/ilustracao-financeira-realista.png', ['ilustracao-financeira-realista.png', 'image/png']],
  ['/ilustracao-financeira.svg', ['ilustracao-financeira.svg', 'image/svg+xml; charset=utf-8']],
  ['/material-symbols.woff2', ['material-symbols.woff2', 'font/woff2']],
  ['/tutorial-financas.jpg', ['tutorial-financas.jpg', 'image/jpeg']],
  ['/icone-192.png', ['icone-192.png', 'image/png']],
  ['/icone-512.png', ['icone-512.png', 'image/png']]
]);

function enviar(resposta, status, dados) {
  resposta.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  resposta.end(JSON.stringify(dados));
}

async function entrada(requisicao, contexto) {
  exigir(/^application\/json(?:\s*;|$)/i.test(requisicao.headers['content-type'] ?? ''), 'Envie dados JSON.', 415);
  validarOrigemDaRequisicao(requisicao, contexto);
  let tamanho = 0;
  const partes = [];
  for await (const parte of requisicao.iterator({ destroyOnReturn: false })) {
    tamanho += parte.byteLength;
    exigir(tamanho <= 24_576, 'Dados excedem o tamanho permitido.', 413);
    partes.push(parte);
  }
  try {
    const valor = JSON.parse(Buffer.concat(partes));
    exigir(valor && typeof valor === 'object' && !Array.isArray(valor), 'Dados inválidos.', 400);
    return valor;
  } catch (erro) {
    if (erro instanceof ErroAplicacao) throw erro;
    throw new ErroAplicacao(400, 'Dados inválidos.');
  }
}

function acessoPeloNotebook(requisicao) {
  const endereco = requisicao.socket.remoteAddress;
  const hostLocal = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(requisicao.headers.host ?? '');
  return hostLocal && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(endereco);
}

async function atender(requisicao, resposta) {
  resposta.setHeader('Cache-Control', 'no-store');
  resposta.setHeader('X-Content-Type-Options', 'nosniff');
  resposta.setHeader('Referrer-Policy', 'no-referrer');
  resposta.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const contexto = contextoDaRequisicao(requisicao, seguro, origemPublica);
    const url = new URL(requisicao.url, 'http://local');
    const caminho = url.pathname;
    const metodo = requisicao.method;
    if (metodo === 'GET' && arquivos.has(caminho)) {
      const [nome, tipo] = arquivos.get(caminho);
      const conteudo = readFileSync(join(pastaPublica, nome));
      resposta.writeHead(200, { 'Content-Type': tipo }).end(conteudo);
      return;
    }
    exigir(caminho.startsWith('/api/'), 'Página não encontrada.', 404);
    exigir(metodo === 'GET' || metodo === 'POST', 'Método inválido.', 405);
    if (metodo === 'GET' && caminho === '/api/rede') {
      if (origemPublica) {
        enviar(resposta, 200, { endereco: { url: origemPublica.href, publico: true } });
        return;
      }
      const { localAddress, localPort } = requisicao.socket;
      const enderecos = enderecosDaRede(localPort, seguro ? 'https' : 'http', host);
      enviar(resposta, 200, { endereco: enderecoParaCelular(enderecos, localAddress) });
      return;
    }
    const dados = metodo === 'POST' ? await entrada(requisicao, contexto) : {};
    if (metodo === 'GET' && caminho === '/api/perfis') {
      enviar(resposta, 200, listarPerfis(banco, acessoPeloNotebook(requisicao), lerSessao(banco, requisicao.headers.cookie, contexto.cookie)));
      return;
    }
    if (metodo === 'POST' && caminho === '/api/perfis/inicializar') {
      exigir(acessoPeloNotebook(requisicao), 'Crie o primeiro administrador pelo endereço local do notebook.', 403);
      enviar(resposta, 201, criarPrimeiroAdministrador(banco, dados));
      return;
    }
    if (metodo === 'POST' && ['/api/cadastro','/api/recuperacao/solicitar','/api/recuperacao/concluir'].includes(caminho)) {
      limitarRequisicoes(banco, `${caminho}:${requisicao.socket.remoteAddress}`, 10);
      const resultado = caminho === '/api/cadastro' ? cadastroAutorizado(banco, dados)
        : caminho.endsWith('/solicitar') ? solicitarRecuperacao(banco, dados) : concluirRecuperacao(banco, dados);
      enviar(resposta, 200, resultado);
      return;
    }
    if (metodo === 'POST' && caminho === '/api/login') {
      limitarRequisicoes(banco, `login-ip:${requisicao.socket.remoteAddress}`, 120);
      const token = autenticar(banco, dados, requisicao.socket.remoteAddress);
      resposta.setHeader('Set-Cookie', cookieSessao(token, contexto.seguro, contexto.cookie));
      enviar(resposta, 200, {});
      return;
    }
    const sessao = lerSessao(banco, requisicao.headers.cookie, contexto.cookie);
    exigir(sessao, 'Entre para continuar.', 401);
    const usuario = sessao.usuario;
    const delegado = requisicao.headers['x-financas-perfil'];
    if (delegado !== undefined && delegado !== String(usuario.id)) {
      exigir(metodo === 'GET' && /^\/api\/(base|periodos|painel|contas|categorias|lancamentos|cartoes|compras|compromissos|faturas|ocorrencias|relatorios)(?:[/?]|$)/.test(caminho), 'A consulta de outro perfil não permite esta operação.', 403);
    }
    if (usuario.contatos_pendentes) {
      exigir(['/api/sessao', '/api/perfil/contatos', '/api/perfil/excluir-conta', '/api/sair'].includes(caminho),
        'Complete o cadastro com e-mail e telefone para continuar.', 428);
    }
    let resultado;
    if (caminho.startsWith('/api/grupo') || caminho.startsWith('/api/acessos')) {
      resultado = rotasGrupos(banco, sessao, metodo, caminho, dados);
    } else if (metodo === 'POST' && caminho === '/api/admin/recuperacoes/liberar') {
      resultado = liberarRecuperacao(banco, sessao, dados);
    } else if (metodo === 'GET' && caminho === '/api/sessao') {
      resultado = usuario;
    } else if (metodo === 'POST' && ['/api/perfil/limpar-dados', '/api/perfil/excluir-conta'].includes(caminho)) {
      exigir(requisicao.headers['x-financas-perfil'] === undefined, 'Volte ao seu próprio perfil antes de continuar.', 403);
      resultado = removerDadosDoPerfil(banco, sessao, caminho, dados);
      if (resultado.excluido) resposta.setHeader('Set-Cookie', cookieSessao('', contexto.seguro, contexto.cookie));
    } else if (metodo === 'POST' && caminho === '/api/perfil') {
      resultado = atualizarMeuPerfil(banco, sessao, dados);
    } else if (metodo === 'POST' && caminho === '/api/perfil/aparencia') {
      resultado = atualizarAparencia(banco, sessao, dados);
    } else if (metodo === 'POST' && caminho === '/api/perfil/contatos') {
      resultado = cadastrarContatos(banco, sessao, dados);
    } else if (caminho === '/api/perfil/solicitacoes-senha') {
      resultado = solicitacoesSenha(banco, sessao, metodo, dados);
    } else if (metodo === 'POST' && caminho === '/api/sair') {
      encerrarSessao(banco, sessao.hash);
      resposta.setHeader('Set-Cookie', cookieSessao('', contexto.seguro, contexto.cookie));
      resultado = {};
    } else if (metodo === 'POST' && caminho === '/api/tema') {
      exigir(['claro', 'escuro'].includes(dados.tema), 'Tema inválido.');
      banco.prepare('UPDATE usuarios SET tema=? WHERE id=?').run(dados.tema, usuario.id);
      resultado = { tema: dados.tema };
    } else if (caminho === '/api/admin' || caminho.startsWith('/api/admin/')) {
      resultado = administracao(banco, sessao, metodo, caminho, dados);
    } else if (caminho === '/api/notificacoes' || caminho.startsWith('/api/notificacoes/')) {
      resultado = await notificacoes(usuario.id, metodo, caminho, dados);
      if (metodo === 'GET' && caminho === '/api/notificacoes') resultado.internas = notificacoesInternas(banco, usuario.id);
    } else {
      const dono = donoDosDados(banco, sessao, requisicao.headers['x-financas-perfil'], metodo);
      if (metodo === 'POST' && /^\/api\/(cartoes|categorias|lancamentos|ocorrencias|compras)\/\d+\/excluir$/.test(caminho)) {
        confirmarSenha(banco, usuario.id, dados.senha);
        delete dados.senha;
      }
      if (dono === usuario.id && (['/api/painel', '/api/cartoes', '/api/compromissos'].includes(caminho) || caminho.startsWith('/api/faturas/')
        || (caminho === '/api/relatorios' && (!url.searchParams.get('fim') || url.searchParams.get('fim') === hoje())))) {
        atualizarRecorrencias(banco, dono);
      }
      resultado = movimentacoes(banco, dono, metodo, caminho, dados, url.searchParams)
        ?? periodos(banco, dono, metodo, caminho, dados)
        ?? compromissos(banco, dono, metodo, caminho, dados)
        ?? relatorios(banco, dono, metodo, caminho, url.searchParams, dados);
    }
    if (metodo === 'GET' && caminho === '/api/perfil/solicitacoes-senha') resultado.grupo = dadosGrupo(banco, sessao);
    exigir(resultado !== undefined, 'Página não encontrada.', 404);
    enviar(resposta, 200, resultado);
  } catch (erro) {
    if (!(erro instanceof ErroAplicacao)) console.error(erro);
    if (!resposta.destroyed) enviar(resposta, erro.status ?? 500, { erro: erro.status ? erro.message : 'Não foi possível completar a operação.' });
  }
}

const carregarTls = () => ({ key: readFileSync(chaveTls), cert: readFileSync(certTls) });
const servidor = seguro ? https(carregarTls(), atender) : http(atender);
if (seguro) {
  watchFile(certTls, { interval: 2000, persistent: false }, () => {
    try {
      servidor.setSecureContext(carregarTls());
      console.log('Certificado HTTPS atualizado.');
    } catch (erro) {
      console.error('Erro ao atualizar o certificado HTTPS:', erro.message);
    }
  });
}
servidor.requestTimeout = 30_000;
servidor.listen(porta, host, () => {
  const portaAtiva = servidor.address().port;
  const protocolo = seguro ? 'https' : 'http';
  console.log(`Neste notebook: ${protocolo}://${host === '0.0.0.0' ? '127.0.0.1' : host}:${portaAtiva}`);
  for (const endereco of enderecosDaRede(portaAtiva, protocolo, host)) {
    console.log(`${endereco.interface}: ${endereco.url}`);
  }
});
