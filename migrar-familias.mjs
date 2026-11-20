import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { abrirBanco, transacao } from './banco.mjs';
import { exigir } from './validacao.mjs';

export const tabelasFinanceiras = ['contas','categorias','lancamentos','operacoes','viradas','cartoes','cartoes_arquivados',
  'faturas','compromissos','compromissos_arquivados','ocorrencias','ajustes_ocorrencias','itens_cartao'];
export function resumoFinanceiro(banco) {
  return Object.fromEntries(tabelasFinanceiras.map(tabela => {
    const linhas = banco.prepare(`SELECT * FROM ${tabela} ORDER BY rowid`).all();
    return [tabela, { registros: linhas.length, sha256: createHash('sha256').update(JSON.stringify(linhas)).digest('hex') }];
  }));
}

export function migrarFamilias(banco, aplicar = false) {
  const chave = 'migracao.familias.2026-11-19';
  if (banco.prepare('SELECT 1 FROM configuracao WHERE chave=?').get(chave)) return { ja_aplicada: true };
  const esperados = [[2,'texte'],[3,'ricardonelber'],[4,'isabellamacedo'],[5,'ricardonascimento']];
  for (const [id, login] of esperados) exigir(banco.prepare('SELECT login FROM usuarios WHERE id=? AND admin=0').get(id)?.login === login,
    `Migração interrompida: confirme manualmente o perfil ${id}.`, 409);
  exigir(!banco.prepare('SELECT 1 FROM membros').get(), 'Já existem vínculos. Não sobrescrever famílias existentes.', 409);
  const planos = [
    { nome: 'Nelber Macedo', responsavel: 3, integrantes: [3,4] },
    { nome: 'Nascimento', responsavel: 5, integrantes: [5] },
    { nome: 'teste', responsavel: 2, integrantes: banco.prepare('SELECT id FROM usuarios WHERE admin=0 AND id NOT IN (3,4,5)').all().map(u => u.id) }
  ];
  const antes = resumoFinanceiro(banco);
  if (!aplicar) return { simulacao: true, planos, financeiro: antes };
  return transacao(banco, () => {
    for (const plano of planos) {
      const id = banco.prepare('INSERT INTO familias(nome,responsavel,codigo,criada_em) VALUES (?,?,?,?)')
        .run(plano.nome, plano.responsavel, randomBytes(16).toString('hex'), Date.now()).lastInsertRowid;
      for (const usuario of plano.integrantes) banco.prepare('INSERT INTO membros(usuario,familia,entrada_em) VALUES (?,?,?)').run(usuario, id, Date.now());
    }
    banco.prepare("UPDATE usuarios SET nome='Conta Teste',ativo=1 WHERE id=2").run();
    exigir(JSON.stringify(antes) === JSON.stringify(resumoFinanceiro(banco)), 'A migração alterou dados financeiros.', 409);
    banco.prepare('INSERT INTO configuracao(chave,valor) VALUES (?,?)').run(chave, JSON.stringify({ aplicada_em: Date.now() }));
    return { aplicada: true, planos, financeiro_preservado: true, financeiro: antes };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const banco = abrirBanco();
  try { console.log(JSON.stringify(migrarFamilias(banco, process.argv.includes('--aplicar')), null, 2)); }
  finally { banco.close(); }
}
