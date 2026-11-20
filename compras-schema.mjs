// O vínculo é aditivo: valores, datas, categorias e faturas antigas não são alterados.
export function prepararCompras(banco) {
  banco.exec(`CREATE TABLE IF NOT EXISTS compras_cartao (
    id INTEGER PRIMARY KEY AUTOINCREMENT, usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    completa INTEGER NOT NULL CHECK(completa IN (0,1)), criada_em INTEGER NOT NULL,
    UNIQUE(usuario,id)
  ) STRICT;`);
  if (!banco.prepare('PRAGMA table_info(itens_cartao)').all().some(c => c.name === 'compra')) {
    banco.exec('ALTER TABLE itens_cartao ADD COLUMN compra INTEGER REFERENCES compras_cartao(id)');
  }
  banco.exec(`CREATE UNIQUE INDEX IF NOT EXISTS parcela_por_compra ON itens_cartao(usuario,compra,numero);
    CREATE TRIGGER IF NOT EXISTS dono_compra_inserir BEFORE INSERT ON itens_cartao WHEN NEW.compra IS NOT NULL
    BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compras_cartao WHERE id=NEW.compra AND usuario=NEW.usuario)
      THEN RAISE(ABORT,'Compra de outro perfil') END; END;
    CREATE TRIGGER IF NOT EXISTS dono_compra_atualizar BEFORE UPDATE OF usuario,compra ON itens_cartao WHEN NEW.compra IS NOT NULL
    BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compras_cartao WHERE id=NEW.compra AND usuario=NEW.usuario)
      THEN RAISE(ABORT,'Compra de outro perfil') END; END;`);
  const itens = banco.prepare(`SELECT i.*,f.cartao FROM itens_cartao i JOIN faturas f ON f.usuario=i.usuario AND f.id=i.fatura
    WHERE i.compra IS NULL AND i.ocorrencia IS NULL ORDER BY i.usuario,i.id`).all();
  if (!itens.length) return;
  banco.exec('BEGIN IMMEDIATE');
  try {
    for (let posicao = 0; posicao < itens.length;) {
      const primeiro = itens[posicao];
      const n = primeiro.parcelas;
      const conjunto = Number.isInteger(n) && n >= 1 && n <= 120 ? itens.slice(posicao, posicao + n) : [];
      const total = conjunto.reduce((soma, item) => soma + item.valor, 0);
      const completa = primeiro.numero === 1 && conjunto.length === n && new Set(conjunto.map(i => i.fatura)).size === n
        && conjunto.every((item, indice) => item.id === primeiro.id + indice && item.usuario === primeiro.usuario
          && item.cartao === primeiro.cartao && item.data === primeiro.data && item.descricao === primeiro.descricao
          && item.categoria === primeiro.categoria && item.parcelas === n && item.numero === indice + 1
          && item.valor === Math.floor(total / n) + Number(indice < total % n));
      // Sequência incompleta não é agrupada por semelhança de nome ou valor.
      const grupo = completa ? conjunto : [primeiro];
      const compra = banco.prepare('INSERT INTO compras_cartao(usuario,completa,criada_em) VALUES (?,?,?)')
        .run(primeiro.usuario, Number(completa), Date.now()).lastInsertRowid;
      for (const item of grupo) banco.prepare('UPDATE itens_cartao SET compra=? WHERE usuario=? AND id=? AND compra IS NULL')
        .run(compra, item.usuario, item.id);
      posicao += grupo.length;
    }
    banco.exec('COMMIT');
  } catch (erro) { banco.exec('ROLLBACK'); throw erro; }
}
