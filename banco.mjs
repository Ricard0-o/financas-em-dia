import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepararCompras } from './compras-schema.mjs';
import { prepararGrupos } from './grupos-schema.mjs';

export const caminhoBanco = process.env.FINANCAS_BANCO || fileURLToPath(new URL('./dados/financas.sqlite', import.meta.url));

export function abrirBanco(caminho = caminhoBanco) {
  mkdirSync(dirname(caminho), { recursive: true });
  const banco = new DatabaseSync(caminho);
  banco.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA application_id = 1179209283;
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL, admin INTEGER NOT NULL CHECK(admin IN (0,1)),
      ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)),
      tema TEXT NOT NULL DEFAULT 'claro' CHECK(tema IN ('claro','escuro')),
      ultimo_acesso INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id),
      inicio INTEGER NOT NULL, acesso INTEGER NOT NULL, expira INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS solicitacoes_senha (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id),
      justificativa TEXT NOT NULL, senha_hash TEXT,
      estado TEXT NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','aprovada','recusada','cancelada')),
      criada_em INTEGER NOT NULL, decidida_em INTEGER, administrador INTEGER REFERENCES usuarios(id),
      CHECK((estado='pendente' AND senha_hash IS NOT NULL) OR (estado<>'pendente' AND senha_hash IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS solicitacao_senha_pendente ON solicitacoes_senha(usuario) WHERE estado='pendente';
    CREATE INDEX IF NOT EXISTS sessoes_usuario ON sessoes(usuario);
    CREATE TABLE IF NOT EXISTS tentativas (
      chave TEXT PRIMARY KEY, desde INTEGER NOT NULL, quantidade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS contas (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id),
      nome TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('conta','reserva','investimento')),
      saldo_inicial INTEGER NOT NULL DEFAULT 0, inicio TEXT NOT NULL,
      UNIQUE(usuario,id), UNIQUE(usuario,tipo,nome)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id), nome TEXT NOT NULL,
      UNIQUE(usuario,id), UNIQUE(usuario,nome)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS lancamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario INTEGER NOT NULL REFERENCES usuarios(id), data TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('despesa','renda','salario','transferencia','fatura','parcela','recorrencia')),
      descricao TEXT NOT NULL, valor INTEGER NOT NULL CHECK(valor > 0),
      origem INTEGER, destino INTEGER, categoria INTEGER, referencia INTEGER,
      UNIQUE(usuario,id), UNIQUE(usuario,tipo,referencia),
      FOREIGN KEY(usuario,origem) REFERENCES contas(usuario,id),
      FOREIGN KEY(usuario,destino) REFERENCES contas(usuario,id),
      FOREIGN KEY(usuario,categoria) REFERENCES categorias(usuario,id),
      CHECK(
        (tipo IN ('renda','salario') AND origem IS NULL AND destino IS NOT NULL AND categoria IS NULL) OR
        (tipo = 'transferencia' AND origem IS NOT NULL AND destino IS NOT NULL AND origem <> destino AND categoria IS NULL) OR
        (tipo IN ('despesa','fatura','parcela','recorrencia') AND origem IS NOT NULL AND destino IS NULL)
      )
    ) STRICT;
    CREATE INDEX IF NOT EXISTS lancamentos_data ON lancamentos(usuario,data);
    CREATE TABLE IF NOT EXISTS operacoes (
      usuario INTEGER NOT NULL REFERENCES usuarios(id), chave TEXT NOT NULL,
      entrada TEXT NOT NULL, resposta TEXT NOT NULL, PRIMARY KEY(usuario,chave)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS viradas (
      usuario INTEGER NOT NULL REFERENCES usuarios(id), inicio TEXT NOT NULL, salario INTEGER NOT NULL,
      PRIMARY KEY(usuario,inicio), UNIQUE(usuario,salario),
      FOREIGN KEY(usuario,salario) REFERENCES lancamentos(usuario,id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS cartoes (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id), nome TEXT NOT NULL,
      limite INTEGER NOT NULL CHECK(limite>0), fechamento INTEGER NOT NULL CHECK(fechamento BETWEEN 1 AND 31),
      vencimento INTEGER NOT NULL CHECK(vencimento BETWEEN 1 AND 31),
      UNIQUE(usuario,id), UNIQUE(usuario,nome)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS cartoes_arquivados (
      usuario INTEGER NOT NULL, cartao INTEGER NOT NULL,
      PRIMARY KEY(usuario,cartao),
      FOREIGN KEY(usuario,cartao) REFERENCES cartoes(usuario,id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS faturas (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL, cartao INTEGER NOT NULL, fechamento TEXT NOT NULL,
      vencimento TEXT NOT NULL, pagamento INTEGER, UNIQUE(usuario,id), UNIQUE(usuario,cartao,fechamento),
      FOREIGN KEY(usuario,cartao) REFERENCES cartoes(usuario,id),
      FOREIGN KEY(usuario,pagamento) REFERENCES lancamentos(usuario,id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS compromissos (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL, nome TEXT NOT NULL, categoria INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('mensal','parcelado')), inicio TEXT NOT NULL, valor INTEGER NOT NULL,
      quantidade INTEGER, conta INTEGER, cartao INTEGER, ultima_data TEXT, UNIQUE(usuario,id),
      FOREIGN KEY(usuario,categoria) REFERENCES categorias(usuario,id),
      FOREIGN KEY(usuario,conta) REFERENCES contas(usuario,id),
      FOREIGN KEY(usuario,cartao) REFERENCES cartoes(usuario,id),
      CHECK((conta IS NULL) <> (cartao IS NULL))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS compromissos_arquivados (
      usuario INTEGER NOT NULL, compromisso INTEGER NOT NULL,
      PRIMARY KEY(usuario,compromisso),
      FOREIGN KEY(usuario,compromisso) REFERENCES compromissos(usuario,id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS ocorrencias (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL, compromisso INTEGER NOT NULL,
      vencimento TEXT NOT NULL, previsto INTEGER NOT NULL CHECK(previsto>0), confirmado INTEGER,
      parcela INTEGER, pagamento INTEGER, UNIQUE(usuario,id), UNIQUE(usuario,compromisso,vencimento),
      FOREIGN KEY(usuario,compromisso) REFERENCES compromissos(usuario,id),
      FOREIGN KEY(usuario,pagamento) REFERENCES lancamentos(usuario,id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS ajustes_ocorrencias (
      usuario INTEGER NOT NULL, ocorrencia INTEGER NOT NULL,
      vencimento TEXT, excluida INTEGER NOT NULL DEFAULT 0 CHECK(excluida IN (0,1)),
      PRIMARY KEY(usuario,ocorrencia),
      FOREIGN KEY(usuario,ocorrencia) REFERENCES ocorrencias(usuario,id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS itens_cartao (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL, fatura INTEGER NOT NULL, data TEXT NOT NULL,
      descricao TEXT NOT NULL, valor INTEGER NOT NULL CHECK(valor>0), categoria INTEGER NOT NULL,
      numero INTEGER, parcelas INTEGER, ocorrencia INTEGER,
      UNIQUE(usuario,ocorrencia),
      FOREIGN KEY(usuario,fatura) REFERENCES faturas(usuario,id),
      FOREIGN KEY(usuario,categoria) REFERENCES categorias(usuario,id),
      FOREIGN KEY(usuario,ocorrencia) REFERENCES ocorrencias(usuario,id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS itens_por_fatura ON itens_cartao(usuario,fatura);
    CREATE TABLE IF NOT EXISTS configuracao (
      chave TEXT PRIMARY KEY, valor TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS dispositivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario INTEGER NOT NULL REFERENCES usuarios(id),
      endpoint TEXT NOT NULL UNIQUE, chave TEXT NOT NULL, auth TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notificacoes_enviadas (
      dispositivo INTEGER NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
      evento TEXT NOT NULL, PRIMARY KEY(dispositivo,evento)
    ) STRICT;
  `);
  transacao(banco, () => {
    const colunasUsuario = banco.prepare('PRAGMA table_info(usuarios)').all();
    for (const coluna of ['nome_exibicao', 'avatar', 'cor_perfil', 'foto_avatar', 'formato_avatar', 'tamanho_texto', 'espacamento']) {
      if (!colunasUsuario.some(item => item.name === coluna)) {
        banco.exec(`ALTER TABLE usuarios ADD COLUMN ${coluna} TEXT`);
      }
    }
    for (const coluna of ['email', 'telefone']) {
      if (!colunasUsuario.some(item => item.name === coluna)) {
        banco.exec(`ALTER TABLE usuarios ADD COLUMN ${coluna} TEXT`);
      }
    }
    for (const coluna of ['avisos_email', 'avisos_whatsapp', 'avisos_sms']) {
      if (!colunasUsuario.some(item => item.name === coluna)) {
        banco.exec(`ALTER TABLE usuarios ADD COLUMN ${coluna} INTEGER NOT NULL DEFAULT 0 CHECK(${coluna} IN (0,1))`);
      }
    }
    for (const tabela of ['contas', 'cartoes']) {
      if (!banco.prepare(`PRAGMA table_info(${tabela})`).all().some(coluna => coluna.name === 'banco')) {
        banco.exec(`ALTER TABLE ${tabela} ADD COLUMN banco TEXT`);
      }
    }
  });
  prepararGrupos(banco);
  prepararCompras(banco);
  return banco;
}

export function transacao(banco, executar) {
  banco.exec('BEGIN IMMEDIATE');
  try {
    const resultado = executar();
    banco.exec('COMMIT');
    return resultado;
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  }
}
