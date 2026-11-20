import { createHash, randomBytes } from 'node:crypto';
import { transacao } from './banco.mjs';
import { confirmarSenha, criarUsuario, protegerSenha } from './acesso.mjs';
import { exigir, inteiro, texto } from './validacao.mjs';

const dia = 86_400_000;
const hash = valor => createHash('sha256').update(valor).digest('hex');
const hashContato = pessoa => hash(JSON.stringify([pessoa.email ?? null, pessoa.telefone ?? null]));
export function eventoSeguranca(banco, ator, alvo, evento) {
  banco.prepare('INSERT INTO eventos_seguranca(ator,alvo,evento,criada_em) VALUES (?,?,?,?)')
    .run(ator, alvo, evento, Date.now());
}

export function limitarRequisicoes(banco, chave, limite = 30, intervalo = 900_000) {
  const id = hash(chave);
  const agora = Date.now();
  banco.prepare('DELETE FROM tentativas WHERE chave=? AND desde<=?').run(id, agora - intervalo);
  exigir((banco.prepare('SELECT quantidade FROM tentativas WHERE chave=?').get(id)?.quantidade ?? 0) < limite,
    'Muitas tentativas. Aguarde alguns minutos e tente novamente.', 429);
  banco.prepare('INSERT INTO tentativas VALUES (?,?,1) ON CONFLICT(chave) DO UPDATE SET quantidade=quantidade+1').run(id, agora);
}

function autorizarAdministrador(banco, dados) {
  const admin = banco.prepare('SELECT id FROM usuarios WHERE login=? AND admin=1 AND ativo=1')
    .get(String(dados.admin_login ?? '').toLowerCase());
  confirmarSenha(banco, admin?.id ?? 0, dados.senha_admin, 'Autorização administrativa inválida.');
  exigir(admin, 'Autorização administrativa inválida.', 403);
  return admin.id;
}

const vinculo = (banco, usuario) => banco.prepare(`SELECT f.*,m.consulta_por FROM membros m JOIN familias f ON f.id=m.familia WHERE m.usuario=?`).get(usuario);
function criarFamilia(banco, usuario, nome) {
  exigir(!vinculo(banco, usuario), 'Saia da família atual antes de criar outra.', 409);
  const id = Number(banco.prepare('INSERT INTO familias(nome,responsavel,codigo,criada_em) VALUES (?,?,?,?)')
    .run(texto(nome, 'nome da família', 80), usuario, randomBytes(16).toString('hex'), Date.now()).lastInsertRowid);
  banco.prepare('INSERT INTO membros(usuario,familia,entrada_em) VALUES (?,?,?)').run(usuario, id, Date.now());
  banco.prepare("UPDATE pedidos_entrada SET estado='cancelado' WHERE usuario=? AND estado='pendente'").run(usuario);
  return id;
}

function pedirEntrada(banco, usuario, codigo) {
  exigir(!vinculo(banco, usuario), 'Saia da família atual antes de solicitar outra.', 409);
  exigir(typeof codigo === 'string' && /^[a-f0-9]{32}$/.test(codigo), 'Código de família inválido.');
  const familia = banco.prepare(`SELECT f.* FROM familias f JOIN usuarios u ON u.id=f.responsavel WHERE f.codigo=? AND u.ativo=1`).get(codigo);
  exigir(familia, 'Código de família inválido.', 404);
  banco.prepare("UPDATE pedidos_entrada SET estado='cancelado' WHERE usuario=? AND estado='pendente' AND expira<=?").run(usuario, Date.now());
  exigir(!banco.prepare("SELECT 1 FROM pedidos_entrada WHERE usuario=? AND estado='pendente'").get(usuario), 'Já existe um pedido pendente.', 409);
  return Number(banco.prepare(`INSERT INTO pedidos_entrada(usuario,familia,responsavel,estado,criada_em,expira) VALUES (?,?,?,'pendente',?,?)`)
    .run(usuario, familia.id, familia.responsavel, Date.now(), Date.now() + 7 * dia).lastInsertRowid);
}

export function cadastroAutorizado(banco, dados) {
  const admin = autorizarAdministrador(banco, dados);
  exigir(['criar','entrar','depois'].includes(dados.modo), 'Escolha criar família ou solicitar entrada.');
  exigir(dados.senha === dados.confirmacao_senha, 'As senhas não coincidem.');
  return transacao(banco, () => {
    const id = Number(criarUsuario(banco, dados));
    if (dados.modo === 'criar') criarFamilia(banco, id, dados.familia_nome);
    else if (dados.modo === 'entrar') pedirEntrada(banco, id, dados.codigo_familia);
    eventoSeguranca(banco, admin, id, 'cadastro_autorizado');
    return { id };
  });
}

export function notificacoesInternas(banco, usuario) {
  return {
    acessos: banco.prepare(`SELECT a.id,a.justificativa,a.estado,a.criada_em,a.expira,u.nome AS solicitante
      FROM acessos_financeiros a JOIN usuarios u ON u.id=a.solicitante WHERE a.titular=? ORDER BY a.id DESC LIMIT 100`).all(usuario),
    entradas: banco.prepare(`SELECT p.id,p.estado,p.criada_em,p.expira,u.nome,u.login,f.nome AS familia
      FROM pedidos_entrada p JOIN familias f ON f.id=p.familia JOIN usuarios u ON u.id=p.usuario
      WHERE p.responsavel=? AND f.responsavel=? ORDER BY p.id DESC LIMIT 100`).all(usuario, usuario)
  };
}

export function dadosGrupo(banco, sessao) {
  const usuario = sessao.usuario.id;
  const familia = vinculo(banco, usuario) ?? null;
  const membros = familia ? banco.prepare(`SELECT u.id,u.nome,u.nome_exibicao,u.login,u.ativo,
      m.consulta_por=? AS autorizou_consulta FROM membros m JOIN usuarios u ON u.id=m.usuario
      WHERE m.familia=? ORDER BY u.nome`).all(usuario, familia.id) : [];
  // Somente o próprio usuário e o responsável veem o consentimento individual.
  for (const membro of membros) if (familia.responsavel !== usuario && membro.id !== usuario) delete membro.autorizou_consulta;
  const pedido = banco.prepare(`SELECT p.id,p.estado,p.expira,f.nome AS familia FROM pedidos_entrada p JOIN familias f ON f.id=p.familia
    WHERE p.usuario=? ORDER BY p.id DESC LIMIT 1`).get(usuario) ?? null;
  if (familia && familia.responsavel !== usuario) delete familia.codigo;
  return { familia, membros, pedido, ...notificacoesInternas(banco, usuario) };
}

export function rotasGrupos(banco, sessao, metodo, caminho, dados) {
  const usuario = sessao.usuario.id;
  if (metodo === 'GET' && caminho === '/api/grupo') return dadosGrupo(banco, sessao);
  if (metodo !== 'POST') return undefined;
  if (caminho === '/api/grupo/criar') {
    const admin = autorizarAdministrador(banco, dados);
    return transacao(banco, () => {
      const id = criarFamilia(banco, usuario, dados.nome);
      eventoSeguranca(banco, admin, usuario, 'familia_criada');
      return { id };
    });
  }
  if (caminho === '/api/grupo/entrada') return transacao(banco, () => ({ id: pedirEntrada(banco, usuario, dados.codigo) }));
  if (caminho === '/api/grupo/entrada/cancelar') {
    banco.prepare("UPDATE pedidos_entrada SET estado='cancelado' WHERE usuario=? AND estado='pendente'").run(usuario);
    return {};
  }
  if (caminho === '/api/grupo/consentimento') {
    exigir(typeof dados.permitir === 'boolean', 'Informe a autorização.');
    confirmarSenha(banco, usuario, dados.senha_atual, 'Confirme sua senha para alterar a autorização.');
    return transacao(banco, () => {
      const familia = vinculo(banco, usuario);
      exigir(familia && familia.responsavel !== usuario, 'Não há outro responsável para autorizar.', 409);
      banco.prepare('UPDATE membros SET consulta_por=? WHERE usuario=?').run(dados.permitir ? familia.responsavel : null, usuario);
      eventoSeguranca(banco, usuario, familia.responsavel, dados.permitir ? 'consulta_responsavel_autorizada' : 'consulta_responsavel_revogada');
      return {};
    });
  }
  const decisaoEntrada = caminho.match(/^\/api\/grupo\/entradas\/(\d+)$/);
  if (decisaoEntrada) {
    exigir(['aprovado','recusado'].includes(dados.decisao), 'Escolha aprovar ou recusar.');
    confirmarSenha(banco, usuario, dados.senha_atual, 'Confirme sua senha para decidir.');
    return transacao(banco, () => {
      const pedido = banco.prepare(`SELECT p.* FROM pedidos_entrada p JOIN familias f ON f.id=p.familia
        WHERE p.id=? AND p.responsavel=? AND f.responsavel=?`).get(Number(decisaoEntrada[1]), usuario, usuario);
      exigir(pedido, 'Pedido não encontrado.', 404);
      exigir(pedido.estado === 'pendente' && pedido.expira > Date.now(), 'Pedido já analisado ou expirado.', 409);
      if (dados.decisao === 'aprovado') {
        exigir(!vinculo(banco, pedido.usuario), 'O solicitante já pertence a uma família.', 409);
        exigir(banco.prepare('SELECT ativo FROM usuarios WHERE id=?').get(pedido.usuario)?.ativo, 'Perfil desativado.', 409);
        banco.prepare('INSERT INTO membros(usuario,familia,entrada_em) VALUES (?,?,?)').run(pedido.usuario, pedido.familia, Date.now());
      }
      banco.prepare('UPDATE pedidos_entrada SET estado=? WHERE id=?').run(dados.decisao, pedido.id);
      eventoSeguranca(banco, usuario, pedido.usuario, 'entrada_' + dados.decisao);
      return {};
    });
  }
  if (['/api/grupo/sair','/api/grupo/remover','/api/grupo/transferir','/api/grupo/encerrar'].includes(caminho)) {
    confirmarSenha(banco, usuario, dados.senha_atual, 'Confirme sua senha para alterar a família.');
    return transacao(banco, () => {
      const familia = vinculo(banco, usuario);
      exigir(familia, 'Você não pertence a uma família.', 409);
      if (caminho === '/api/grupo/sair') {
        exigir(familia.responsavel !== usuario, 'Transfira a responsabilidade ou encerre a família antes de sair.', 409);
        banco.prepare('DELETE FROM membros WHERE usuario=?').run(usuario);
      } else {
        exigir(familia.responsavel === usuario, 'Somente o responsável pode realizar esta ação.', 403);
        if (caminho === '/api/grupo/encerrar') {
          exigir(dados.confirmar === true, 'Confirme o encerramento da família.');
          banco.prepare('DELETE FROM familias WHERE id=?').run(familia.id);
        } else {
          const alvo = inteiro(dados.usuario, 'integrante');
          exigir(alvo !== usuario && banco.prepare('SELECT 1 FROM membros WHERE usuario=? AND familia=?').get(alvo, familia.id), 'Integrante inválido.', 404);
          if (caminho === '/api/grupo/remover') banco.prepare('DELETE FROM membros WHERE usuario=?').run(alvo);
          else {
            exigir(banco.prepare('SELECT ativo FROM usuarios WHERE id=?').get(alvo)?.ativo, 'Escolha um integrante ativo.', 409);
            banco.prepare('UPDATE familias SET responsavel=?,codigo=? WHERE id=?').run(alvo, randomBytes(16).toString('hex'), familia.id);
            banco.prepare('UPDATE membros SET consulta_por=NULL WHERE familia=?').run(familia.id);
            banco.prepare("UPDATE pedidos_entrada SET estado='cancelado' WHERE familia=? AND estado='pendente'").run(familia.id);
          }
        }
      }
      eventoSeguranca(banco, usuario, null, caminho.split('/').at(-1) + '_familia');
      return {};
    });
  }
  if (caminho === '/api/acessos/solicitar') {
    exigir(sessao.usuario.admin, 'Acesso restrito à administração.', 403);
    confirmarSenha(banco, usuario, dados.senha_atual, 'Confirme sua senha de administrador.');
    const titular = inteiro(dados.usuario, 'usuário');
    exigir(titular !== usuario && banco.prepare('SELECT 1 FROM usuarios WHERE id=? AND ativo=1').get(titular), 'Usuário inválido.', 404);
    const justificativa = texto(dados.justificativa, 'justificativa', 500);
    return transacao(banco, () => {
      banco.prepare("UPDATE acessos_financeiros SET estado='revogado' WHERE titular=? AND solicitante=? AND expira<=?").run(titular, usuario, Date.now());
      exigir(!banco.prepare("SELECT 1 FROM acessos_financeiros WHERE titular=? AND solicitante=? AND estado IN ('pendente','aprovado') AND expira>?").get(titular, usuario, Date.now()), 'Já existe um pedido ou acesso ativo.', 409);
      const id = Number(banco.prepare(`INSERT INTO acessos_financeiros(titular,solicitante,justificativa,estado,criada_em,expira) VALUES (?,?,?,'pendente',?,?)`)
        .run(titular, usuario, justificativa, Date.now(), Date.now() + 7 * dia).lastInsertRowid);
      eventoSeguranca(banco, usuario, titular, 'consulta_admin_solicitada');
      return { id };
    });
  }
  const decidirAcesso = caminho.match(/^\/api\/acessos\/(\d+)$/);
  if (decidirAcesso) {
    exigir(['aprovado','recusado','revogado'].includes(dados.decisao), 'Decisão inválida.');
    confirmarSenha(banco, usuario, dados.senha_atual, 'Confirme sua senha para decidir.');
    return transacao(banco, () => {
      const pedido = banco.prepare('SELECT * FROM acessos_financeiros WHERE id=? AND titular=?').get(Number(decidirAcesso[1]), usuario);
      exigir(pedido, 'Pedido não encontrado.', 404);
      exigir(pedido.expira > Date.now() && (dados.decisao === 'revogado' ? pedido.estado === 'aprovado' : pedido.estado === 'pendente'), 'Pedido já analisado ou expirado.', 409);
      banco.prepare('UPDATE acessos_financeiros SET estado=?,expira=? WHERE id=?').run(dados.decisao, dados.decisao === 'aprovado' ? Date.now() + dia : Date.now(), pedido.id);
      eventoSeguranca(banco, usuario, pedido.solicitante, 'consulta_admin_' + dados.decisao);
      return {};
    });
  }
  return undefined;
}

export function solicitarRecuperacao(banco, dados) {
  const resposta = { mensagem: 'Se o usuário estiver disponível, a solicitação será analisada. O administrador fará contato por um canal já cadastrado.' };
  const pessoa = banco.prepare('SELECT id,email,telefone FROM usuarios WHERE login=? AND ativo=1').get(String(dados.login ?? '').toLowerCase());
  if (!pessoa || (!pessoa.email && !pessoa.telefone)) return resposta;
  if (banco.prepare('SELECT 1 FROM recuperacoes WHERE usuario=? AND criada_em>?').get(pessoa.id, Date.now() - 900_000)) return resposta;
  transacao(banco, () => {
    banco.prepare("UPDATE recuperacoes SET estado='cancelada',token_hash=NULL WHERE usuario=? AND estado IN ('pendente','liberada')").run(pessoa.id);
    banco.prepare("INSERT INTO recuperacoes(usuario,estado,criada_em,contato_hash) VALUES (?,'pendente',?,?)").run(pessoa.id, Date.now(), hashContato(pessoa));
  });
  return resposta;
}

export function liberarRecuperacao(banco, sessao, dados) {
  exigir(sessao.usuario.admin, 'Acesso restrito à administração.', 403);
  confirmarSenha(banco, sessao.usuario.id, dados.senha_atual, 'Confirme sua senha de administrador.');
  exigir(dados.identidade_confirmada === true && ['email','telefone'].includes(dados.canal), 'Confirme a identidade fora do aplicativo por um canal já cadastrado.');
  return transacao(banco, () => {
    const pedido = banco.prepare(`SELECT r.*,u.email,u.telefone,u.ativo FROM recuperacoes r JOIN usuarios u ON u.id=r.usuario WHERE r.id=?`).get(inteiro(dados.id, 'pedido'));
    exigir(pedido && pedido.estado === 'pendente' && pedido.criada_em > Date.now() - dia && pedido.ativo, 'Pedido indisponível ou expirado.', 409);
    exigir(pedido.contato_hash === hashContato(pedido), 'Os contatos foram alterados após o pedido. É necessária uma nova solicitação.', 409);
    exigir(pedido[dados.canal], 'O usuário não possui esse canal cadastrado.', 409);
    const token = randomBytes(32).toString('hex');
    banco.prepare("UPDATE recuperacoes SET estado='liberada',canal=?,verificada_por=?,token_hash=?,expira=? WHERE id=?")
      .run(dados.canal, sessao.usuario.id, hash(token), Date.now() + 900_000, pedido.id);
    eventoSeguranca(banco, sessao.usuario.id, pedido.usuario, 'recuperacao_liberada');
    return { token, validade_minutos: 15 };
  });
}

export function concluirRecuperacao(banco, dados) {
  exigir(typeof dados.token === 'string' && /^[a-f0-9]{64}$/.test(dados.token), 'Código inválido ou expirado.', 403);
  exigir(dados.senha === dados.confirmacao_senha, 'As senhas não coincidem.');
  return transacao(banco, () => {
    const pedido = banco.prepare(`SELECT r.*,u.email,u.telefone FROM recuperacoes r JOIN usuarios u ON u.id=r.usuario WHERE r.token_hash=? AND r.estado='liberada' AND r.expira>? AND u.ativo=1`).get(hash(dados.token), Date.now());
    exigir(pedido, 'Código inválido ou expirado.', 403);
    exigir(pedido.contato_hash === hashContato(pedido), 'Os contatos foram alterados após o pedido. É necessária uma nova solicitação.', 409);
    const senha = protegerSenha(dados.senha);
    banco.prepare('UPDATE usuarios SET senha=? WHERE id=?').run(senha, pedido.usuario);
    banco.prepare('DELETE FROM sessoes WHERE usuario=?').run(pedido.usuario);
    banco.prepare("UPDATE recuperacoes SET estado='concluida',token_hash=NULL WHERE id=?").run(pedido.id);
    banco.prepare("UPDATE solicitacoes_senha SET estado='cancelada',senha_hash=NULL WHERE usuario=? AND estado='pendente'").run(pedido.usuario);
    banco.prepare("UPDATE acessos_financeiros SET estado='revogado' WHERE titular=? OR solicitante=?").run(pedido.usuario, pedido.usuario);
    banco.prepare('UPDATE membros SET consulta_por=NULL WHERE usuario=? OR consulta_por=?').run(pedido.usuario, pedido.usuario);
    eventoSeguranca(banco, pedido.usuario, pedido.usuario, 'senha_recuperada');
    return { redefinida: true };
  });
}
