import { existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { resolve, dirname } from 'node:path';
import { Writable } from 'node:stream';
import { backup, DatabaseSync } from 'node:sqlite';
import { abrirBanco, caminhoBanco, transacao } from './banco.mjs';
import { criarUsuario } from './acesso.mjs';
import { exigir } from './validacao.mjs';

const [comando, argumento] = process.argv.slice(2);

async function primeiroAdmin() {
  exigir(process.stdin.isTTY, 'Execute o cadastro em um terminal interativo.');
  const banco = abrirBanco();
  const verificar = () => exigir(!banco.prepare('SELECT 1 FROM usuarios LIMIT 1').get(), 'Este banco já possui usuários.');
  let ocultar = false;
  const saida = new Writable({
    write(parte, codificacao, concluir) {
      if (!ocultar) process.stdout.write(parte, codificacao);
      concluir();
    }
  });
  const terminal = createInterface({ input: process.stdin, output: saida, terminal: true, historySize: 0 });
  terminal.on('SIGINT', () => process.exit(130));
  async function senhaOculta(rotulo) {
    process.stdout.write(rotulo);
    ocultar = true;
    try {
      return await terminal.question('');
    } finally {
      ocultar = false;
      process.stdout.write('\n');
    }
  }
  try {
    verificar();
    const nome = await terminal.question('Nome: ');
    const login = await terminal.question('Usuário: ');
    const senha = await senhaOculta('Senha: ');
    const confirmacao = await senhaOculta('Repita a senha: ');
    exigir(senha === confirmacao, 'As senhas precisam ser iguais.');
    transacao(banco, () => {
      verificar();
      criarUsuario(banco, { nome, login, senha }, true);
    });
    console.log('Administrador criado.');
  } finally {
    terminal.close();
    banco.close();
  }
}

function verificarBackup(banco) {
  exigir(banco.prepare('PRAGMA application_id').get().application_id === 1179209283, 'Arquivo de outro aplicativo.');
  exigir(banco.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'O banco apresenta erros de integridade.');
  exigir(!banco.prepare('PRAGMA foreign_key_check').get(), 'O banco contém registros com referências inválidas.');
}

async function copiarBanco(restaurar) {
  exigir(argumento, 'Informe o caminho de um arquivo de backup.');
  const arquivo = resolve(argumento);
  const destino = resolve(caminhoBanco);
  exigir(arquivo.toLowerCase() !== destino.toLowerCase(), 'Informe um arquivo diferente do banco em uso.');
  if (restaurar) {
    exigir(existsSync(arquivo), 'Backup não encontrado.');
    const origem = new DatabaseSync(arquivo, { readOnly: true });
    try {
      verificarBackup(origem);
      mkdirSync(dirname(destino), { recursive: true });
      if (existsSync(destino)) {
        const anterior = new DatabaseSync(destino, { readOnly: true });
        try {
          const copia = `${destino}.antes-de-restaurar-${Date.now()}.sqlite`;
          await backup(anterior, copia);
          console.log(`Cópia do banco anterior: ${copia}`);
        } finally {
          anterior.close();
        }
      }
      await backup(origem, destino);
    } finally {
      origem.close();
    }
    const recuperado = abrirBanco();
    try {
      recuperado.exec('DELETE FROM sessoes; DELETE FROM tentativas;');
    } finally {
      recuperado.close();
    }
    console.log('Backup restaurado. Entre novamente no aplicativo.');
  } else {
    exigir(existsSync(destino), 'Banco não encontrado. Crie o administrador primeiro.');
    exigir(!existsSync(arquivo), 'Já existe um arquivo nesse caminho. Escolha outro nome.');
    mkdirSync(dirname(arquivo), { recursive: true });
    const origem = new DatabaseSync(destino, { readOnly: true });
    try {
      verificarBackup(origem);
      await backup(origem, arquivo);
    } finally {
      origem.close();
    }
    console.log(`Backup salvo em ${arquivo}`);
  }
}

try {
  if (comando === 'admin') await primeiroAdmin();
  else if (comando === 'backup') await copiarBanco(false);
  else if (comando === 'restaurar') await copiarBanco(true);
  else console.log('Uso: node manutencao.mjs admin | backup <arquivo> | restaurar <arquivo>');
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
