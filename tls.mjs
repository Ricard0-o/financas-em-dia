import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { resolve, join, dirname } from 'node:path';
import { caminhoBanco } from './banco.mjs';
import { exigir } from './validacao.mjs';

try {
  const ips = process.argv.slice(2);
  exigir(ips.length && ips.every(isIPv4), 'Informe o IPv4 da rede: node tls.mjs 192.168.1.20');
  const gitOpenSsl = 'C:/Program Files/Git/usr/bin/openssl.exe';
  const openssl = process.env.FINANCAS_OPENSSL || (existsSync(gitOpenSsl) ? gitOpenSsl : 'openssl');
  const diretorio = resolve(dirname(caminhoBanco), 'tls');
  mkdirSync(diretorio, { recursive: true });
  const executar = (...argumentos) => execFileSync(openssl, argumentos, { cwd: diretorio, stdio: 'inherit' });
  const existe = arquivo => existsSync(join(diretorio, arquivo));
  exigir(existe('raiz.crt') === existe('raiz.key'), 'Recupere o par raiz.crt e raiz.key da sua autoridade local.');
  if (!existe('raiz.crt')) {
    executar('req', '-x509', '-newkey', 'rsa:3072', '-noenc', '-sha256', '-days', '1825', '-subj', '/CN=Financas Pessoais CA',
      '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
      '-keyout', 'raiz.key', '-out', 'raiz.crt');
  }
  const enderecos = [...new Set(['127.0.0.1', ...ips])].map(ip => `IP:${ip}`);
  writeFileSync(join(diretorio, 'extensoes.cnf'), [
    'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth', `subjectAltName=DNS:localhost,${enderecos.join(',')}`
  ].join('\n'));
  executar('req', '-new', '-newkey', 'rsa:2048', '-noenc', '-subj', '/CN=Financas Pessoais',
    '-keyout', 'servidor-novo.key', '-out', 'servidor.csr');
  executar('x509', '-req', '-in', 'servidor.csr', '-CA', 'raiz.crt', '-CAkey', 'raiz.key', '-CAcreateserial', '-sha256',
    '-days', '365', '-extfile', 'extensoes.cnf', '-out', 'servidor-novo.crt');
  renameSync(join(diretorio, 'servidor-novo.key'), join(diretorio, 'servidor.key'));
  renameSync(join(diretorio, 'servidor-novo.crt'), join(diretorio, 'servidor.crt'));
  executar('x509', '-in', 'raiz.crt', '-outform', 'DER', '-out', 'financas-raiz.cer');
  console.log(`Certificados gerados em ${diretorio}.`);
  console.log('Instale somente financas-raiz.cer nos dispositivos que devem confiar no aplicativo.');
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
