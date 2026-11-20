import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { transacao } from './banco.mjs';
import { atualizarRecorrencias, pendencias } from './compromissos.mjs';
import { exigir, hoje, texto } from './validacao.mjs';

const destinos = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/, /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/
];

function endpointValido(endpoint) {
  const url = URL.parse(texto(endpoint, 'dispositivo', 2048));
  exigir(url?.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
    && destinos.some(destino => destino.test(url.hostname)), 'Serviço de notificações do navegador incompatível.');
  return url;
}

function chaveVapid(banco) {
  return transacao(banco, () => {
    const existente = banco.prepare("SELECT valor FROM configuracao WHERE chave='vapid'").get();
    if (existente) return JSON.parse(existente.valor);
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privada = privateKey.export({ format: 'jwk' });
    const publica = Buffer.concat([Buffer.from([4]), Buffer.from(privada.x, 'base64url'), Buffer.from(privada.y, 'base64url')]).toString('base64url');
    const chaves = { privada, publica };
    banco.prepare("INSERT INTO configuracao VALUES ('vapid',?)").run(JSON.stringify(chaves));
    return chaves;
  });
}

const codificar = valor => Buffer.from(JSON.stringify(valor)).toString('base64url');

function autorizacao(chaves, origem, contato) {
  const entrada = `${codificar({ typ: 'JWT', alg: 'ES256' })}.${codificar({
    aud: origem, exp: Math.floor(Date.now() / 1000) + 3_600, sub: contato
  })}`;
  const chave = createPrivateKey({ key: chaves.privada, format: 'jwk' });
  const assinatura = sign('sha256', Buffer.from(entrada), { key: chave, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${entrada}.${assinatura.toString('base64url')}, k=${chaves.publica}`;
}

// RFC 8291 e RFC 8188: chave efêmera, HKDF e um registro AES-128-GCM.
export function criptografar(mensagem, chave, auth) {
  const ecdh = createECDH('prime256v1');
  const publica = ecdh.generateKeys();
  const cliente = Buffer.from(chave, 'base64url');
  const sal = randomBytes(16);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), cliente, publica]);
  const derivar = (material, segredo, rotulo, tamanho) => hkdfSync('sha256', material, segredo, rotulo, tamanho);
  const material = derivar(ecdh.computeSecret(cliente), Buffer.from(auth, 'base64url'), info, 32);
  const chaveConteudo = derivar(material, sal, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = derivar(material, sal, 'Content-Encoding: nonce\0', 12);
  const cifra = createCipheriv('aes-128-gcm', chaveConteudo, nonce);
  const cabecalho = Buffer.alloc(5);
  cabecalho.writeUInt32BE(4096);
  cabecalho[4] = publica.length;
  return Buffer.concat([sal, cabecalho, publica, cifra.update(mensagem), cifra.update(Buffer.from([2])), cifra.final(), cifra.getAuthTag()]);
}

function removerDispositivo(banco, id) {
  transacao(banco, () => {
    banco.prepare('DELETE FROM notificacoes_enviadas WHERE dispositivo=?').run(id);
    banco.prepare('DELETE FROM dispositivos WHERE id=?').run(id);
  });
}

export function iniciarNotificacoes(banco, seguro, { contato: configurado = process.env.FINANCAS_PUSH_CONTATO } = {}) {
  const contato = configurado?.trim();
  const ativo = seguro && Boolean(contato);
  if (contato) exigir(/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contato), 'Use FINANCAS_PUSH_CONTATO no formato mailto:email.');
  const chaves = ativo ? chaveVapid(banco) : null;
  let executando = false;

  async function entregar(dispositivo, mensagem, ttl) {
    const url = endpointValido(dispositivo.endpoint);
    let resposta;
    try {
      resposta = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: {
          Authorization: autorizacao(chaves, url.origin, contato), TTL: String(ttl),
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream'
        },
        body: criptografar(Buffer.from(mensagem), dispositivo.chave, dispositivo.auth)
      });
    } catch {
      exigir(false, 'O serviço de notificações está indisponível.', 502);
    }
    if (resposta.status === 404 || resposta.status === 410) {
      removerDispositivo(banco, dispositivo.id);
    }
    await resposta.body?.cancel();
    exigir(resposta.ok, `O serviço de notificações retornou HTTP ${resposta.status}.`, 502);
  }

  async function executar() {
    if (executando) return;
    executando = true;
    try {
      const usuarios = banco.prepare('SELECT DISTINCT u.id FROM usuarios u JOIN dispositivos d ON d.usuario=u.id WHERE u.ativo=1').all();
      const enviado = banco.prepare('SELECT 1 FROM notificacoes_enviadas WHERE dispositivo=? AND evento=?');
      const dia = hoje();
      for (const usuario of usuarios) {
        atualizarRecorrencias(banco, usuario.id);
        const eventos = pendencias(banco, usuario.id).map(item =>
          `${item.tipo}:${item.id}:${item.vencimento}:${item.atrasado ? 'atrasado' : item.vencimento === dia ? 'hoje' : 'previsto'}`);
        if (!eventos.length) continue;
        const dispositivos = banco.prepare('SELECT * FROM dispositivos WHERE usuario=?').all(usuario.id);
        for (const dispositivo of dispositivos) {
          const novos = eventos.filter(evento => !enviado.get(dispositivo.id, evento));
          if (!novos.length) continue;
          try {
            await entregar(dispositivo, 'Você tem vencimentos para conferir no painel.', 4 * 3600);
            const registrar = banco.prepare(`
              INSERT OR IGNORE INTO notificacoes_enviadas
              SELECT id,? FROM dispositivos WHERE id=? AND usuario=?
            `);
            transacao(banco, () => {
              for (const evento of novos) registrar.run(evento, dispositivo.id, usuario.id);
            });
          } catch (erro) {
            console.warn(`Avisos do dispositivo ${dispositivo.id}: ${erro.message}`);
          }
        }
      }
    } catch (erro) {
      console.error('Não foi possível verificar os avisos em segundo plano.', erro);
    } finally {
      executando = false;
    }
  }

  if (ativo) {
    const timer = setInterval(executar, 10 * 60_000);
    timer.unref();
    setImmediate(executar);
  }

  return async (usuario, metodo, caminho, dados) => {
    if (metodo === 'GET' && caminho === '/api/notificacoes') return { ativa: ativo, chave: chaves?.publica };
    exigir(ativo, 'Configure HTTPS e FINANCAS_PUSH_CONTATO no notebook para ativar notificações.', 409);
    exigir(metodo === 'POST', 'Método inválido.', 405);
    const endpoint = endpointValido(dados.endpoint).href;
    if (caminho === '/api/notificacoes/consultar') {
      return { registrado: Boolean(banco.prepare('SELECT 1 FROM dispositivos WHERE usuario=? AND endpoint=?').get(usuario, endpoint)) };
    }
    if (caminho === '/api/notificacoes/ativar') {
      const chave = texto(dados.keys?.p256dh, 'chave de criptografia', 100);
      const auth = texto(dados.keys?.auth, 'chave de autenticação', 32);
      const ponto = Buffer.from(chave, 'base64url');
      exigir(ponto.length === 65 && ponto[0] === 4 && Buffer.from(auth, 'base64url').length === 16, 'Dispositivo inválido.');
      try {
        const ecdh = createECDH('prime256v1');
        ecdh.generateKeys();
        ecdh.computeSecret(ponto);
      } catch {
        exigir(false, 'Chave do dispositivo inválida.');
      }
      transacao(banco, () => {
        const outro = banco.prepare('SELECT id,usuario FROM dispositivos WHERE endpoint=?').get(endpoint);
        if (outro && outro.usuario !== usuario) {
          banco.prepare('DELETE FROM notificacoes_enviadas WHERE dispositivo=?').run(outro.id);
          banco.prepare('DELETE FROM dispositivos WHERE id=?').run(outro.id);
        }
        banco.prepare(`
          INSERT INTO dispositivos(usuario,endpoint,chave,auth) VALUES (?,?,?,?)
          ON CONFLICT(endpoint) DO UPDATE SET chave=excluded.chave,auth=excluded.auth
        `).run(usuario, endpoint, chave, auth);
      });
      setImmediate(executar);
      return {};
    }
    const dispositivo = banco.prepare('SELECT * FROM dispositivos WHERE usuario=? AND endpoint=?').get(usuario, endpoint);
    exigir(dispositivo, 'Ative os avisos neste dispositivo primeiro.', 404);
    if (caminho === '/api/notificacoes/desativar') {
      removerDispositivo(banco, dispositivo.id);
      return {};
    }
    if (caminho === '/api/notificacoes/testar') {
      await entregar(dispositivo, 'Os avisos deste dispositivo estão ativos.', 180);
      return {};
    }
    exigir(false, 'Página não encontrada.', 404);
  };
}
