export function prepararGrupos(banco) {
  banco.exec(`
    CREATE TABLE IF NOT EXISTS familias (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL,
      responsavel INTEGER NOT NULL UNIQUE REFERENCES usuarios(id),
      codigo TEXT NOT NULL UNIQUE, criada_em INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS membros (
      usuario INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
      familia INTEGER NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
      consulta_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      entrada_em INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS membros_familia ON membros(familia);
    CREATE TABLE IF NOT EXISTS pedidos_entrada (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      familia INTEGER NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
      responsavel INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      estado TEXT NOT NULL CHECK(estado IN ('pendente','aprovado','recusado','cancelado')),
      criada_em INTEGER NOT NULL, expira INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS entrada_pendente ON pedidos_entrada(usuario) WHERE estado='pendente';
    CREATE TABLE IF NOT EXISTS acessos_financeiros (
      id INTEGER PRIMARY KEY, titular INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      solicitante INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      justificativa TEXT NOT NULL,
      estado TEXT NOT NULL CHECK(estado IN ('pendente','aprovado','recusado','revogado')),
      criada_em INTEGER NOT NULL, expira INTEGER NOT NULL,
      CHECK(titular<>solicitante)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS acesso_pendente ON acessos_financeiros(titular,solicitante) WHERE estado='pendente';
    CREATE TABLE IF NOT EXISTS recuperacoes (
      id INTEGER PRIMARY KEY, usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      estado TEXT NOT NULL CHECK(estado IN ('pendente','liberada','recusada','concluida','cancelada')),
      criada_em INTEGER NOT NULL, canal TEXT, verificada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      token_hash TEXT UNIQUE, expira INTEGER, contato_hash TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS eventos_seguranca (
      id INTEGER PRIMARY KEY, ator INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      alvo INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      evento TEXT NOT NULL, criada_em INTEGER NOT NULL
    ) STRICT;
  `);
  if (!banco.prepare('PRAGMA table_info(recuperacoes)').all().some(c => c.name === 'contato_hash')) {
    banco.exec('ALTER TABLE recuperacoes ADD COLUMN contato_hash TEXT');
  }
}
