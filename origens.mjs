import { exigir } from './validacao.mjs';

export function validarOrigemPublica(valor) {
  if (valor === undefined || valor === '') return null;
  let url;
  try {
    url = new URL(valor);
  } catch {
    exigir(false, 'FINANCAS_ORIGEM_PUBLICA deve ser uma origem HTTPS válida.');
  }
  exigir(url.protocol === 'https:' && !url.username && !url.password
    && url.pathname === '/' && !url.search && !url.hash,
  'FINANCAS_ORIGEM_PUBLICA deve conter somente https://dominio e a porta opcional.');
  return url;
}

export function contextoDaRequisicao(requisicao, tls, origemPublica) {
  const host = requisicao.headers.host?.toLowerCase();
  const publico = Boolean(origemPublica && (host === origemPublica.host
    || (!origemPublica.port && host === `${origemPublica.hostname}:443`)));
  if (publico && !tls) {
    exigir(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(requisicao.socket.remoteAddress),
      'O acesso público HTTP deve passar pelo proxy local.', 403);
  }
  return {
    origem: publico ? origemPublica.origin : `${tls ? 'https' : 'http'}://${host}`,
    seguro: tls || publico,
    cookie: publico ? '__Host-financas_sessao' : 'financas_sessao'
  };
}

export function validarOrigemDaRequisicao(requisicao, contexto) {
  const origem = requisicao.headers.origin;
  exigir((!origem || origem === contexto.origem) && requisicao.headers['sec-fetch-site'] !== 'cross-site',
    'Origem da requisição inválida.', 403);
}
