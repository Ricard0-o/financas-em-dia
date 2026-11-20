import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { transacao } from './banco.mjs';
import { exigir, inteiro, texto } from './validacao.mjs';
import { avataresPerfil, coresPerfil, opcoesPreferencias } from './publico/aparencia.mjs';
import { operacaoUnica } from './movimentacoes.mjs';

const janela = 15 * 60 * 1000;
const duracao = 7 * 24 * 60 * 60 * 1000;
const sha = valor => createHash('sha256').update(valor).digest('hex');
const salFicticio = randomBytes(16).toString('hex');
const hashFicticio = randomBytes(64);

function derivar(senha, sal) {
  return scryptSync(senha, Buffer.from(sal, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function loginNormalizado(valor) {
  const login = texto(valor, 'usuário', 64).toLowerCase();
  exigir(/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login), 'Use de 3 a 64 caracteres no usuário, com letras sem acento, números, ponto, hífen ou sublinhado.');
  return login;
}

export function protegerSenha(valor) {
  exigir(typeof valor === 'string' && [...valor].length >= 8 && [...valor].length <= 128, 'Use uma senha de 8 a 128 caracteres.');
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${derivar(valor, sal).toString('hex')}`;
}

export function criarUsuario(banco, dados, admin = false) {
  const nome = texto(dados.nome, 'nome');
  const login = loginNormalizado(dados.login);
  exigir(!banco.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(login), 'Este usuário já existe.', 409);
  const senha = protegerSenha(dados.senha);
  const id = banco.prepare('INSERT INTO usuarios(nome,login,senha,admin) VALUES (?,?,?,?)').run(nome, login, senha, Number(admin)).lastInsertRowid;
  banco.prepare("INSERT INTO eventos_seguranca(ator,alvo,evento,criada_em) VALUES (?,?,'usuario_criado',?)").run(null,id,Date.now());
  return id;
}

export function listarPerfis(banco, acessoLocal, sessao) {
  const inicializar = acessoLocal && !banco.prepare('SELECT 1 FROM usuarios LIMIT 1').get();
  if (!sessao) return { perfis: [], inicializar };
  const perfis = banco.prepare(`SELECT u.id,u.nome,u.admin,u.nome_exibicao,u.avatar,u.cor_perfil,u.foto_avatar,u.formato_avatar
    FROM usuarios u WHERE u.ativo=1 AND (u.id=? OR EXISTS (
      SELECT 1 FROM membros a JOIN membros b ON a.familia=b.familia WHERE a.usuario=? AND b.usuario=u.id)) ORDER BY u.nome,u.id`)
    .all(sessao.usuario.id, sessao.usuario.id);
  return { perfis, inicializar };
}

export function criarPrimeiroAdministrador(banco, dados) {
  return transacao(banco, () => {
    exigir(!banco.prepare('SELECT 1 FROM usuarios LIMIT 1').get(), 'O administrador já foi cadastrado.', 409);
    return { id: criarUsuario(banco, dados, true) };
  });
}

function verificarCredenciais(banco, usuario, senha, chave, mensagem, status) {
  exigir(typeof senha === 'string' && senha.length > 0 && senha.length <= 512, mensagem, status);
  const agora = Date.now();
  banco.prepare('DELETE FROM tentativas WHERE desde <= ?').run(agora - janela);
  const tentativa = banco.prepare('SELECT quantidade FROM tentativas WHERE chave = ?').get(chave);
  exigir((tentativa?.quantidade ?? 0) < 15, 'Muitas tentativas. Tente novamente em 15 minutos.', 429);
  const [sal, hash] = usuario?.senha.split(':') ?? [salFicticio, hashFicticio.toString('hex')];
  const valida = timingSafeEqual(derivar(senha, sal), Buffer.from(hash, 'hex'));
  if (!usuario?.ativo || !valida) {
    banco.prepare(`
      INSERT INTO tentativas VALUES (?, ?, 1) ON CONFLICT(chave) DO UPDATE SET quantidade = quantidade + 1
    `).run(chave, agora);
    exigir(false, mensagem, status);
  }
}

export function confirmarSenha(banco, id, senha, mensagem = 'Informe a senha correta do perfil conectado para excluir.') {
  const usuario = banco.prepare('SELECT senha,ativo FROM usuarios WHERE id=?').get(id);
  const chave = sha(`confirmacao:${id}`);
  verificarCredenciais(banco, usuario, senha, chave, mensagem, 403);
  banco.prepare('DELETE FROM tentativas WHERE chave=?').run(chave);
}

export function autenticar(banco, dados, ip) {
  exigir(typeof dados.senha === 'string', 'Credenciais inválidas.', 401);
  const usuario = dados.perfil === undefined
    ? banco.prepare('SELECT id,senha,ativo FROM usuarios WHERE login=?').get(loginNormalizado(dados.login))
    : banco.prepare('SELECT id,senha,ativo FROM usuarios WHERE id=?').get(inteiro(dados.perfil, 'perfil'));
  const identificador = usuario?.id ?? String(dados.login ?? dados.perfil).toLowerCase();
  verificarCredenciais(banco, usuario, dados.senha, sha(`login:${identificador}`), 'Credenciais inválidas.', 401);
  const agora = Date.now();
  const token = randomBytes(32).toString('hex');
  transacao(banco, () => {
    banco.prepare('DELETE FROM sessoes WHERE expira <= ?').run(agora);
    banco.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?').run(agora, usuario.id);
    banco.prepare('INSERT INTO sessoes VALUES (?,?,?,?,?)').run(sha(token), usuario.id, agora, agora, agora + duracao);
  });
  return token;
}

export function cookieSessao(token, seguro, nome = 'financas_sessao') {
  return `${nome}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? duracao / 1000 : 0}${seguro ? '; Secure' : ''}`;
}

export function lerSessao(banco, cookie = '', nome = 'financas_sessao') {
  const token = cookie.match(new RegExp(`(?:^|;\\s*)${nome}=([a-f0-9]{64})(?=;|$)`))?.[1];
  if (!token) return null;
  const hash = sha(token);
  const agora = Date.now();
  const usuario = banco.prepare(`
    SELECT u.id,u.nome,u.login,u.admin,u.tema,u.email,u.telefone,u.avisos_email,u.avisos_whatsapp,u.avisos_sms,
      u.nome_exibicao,u.avatar,u.cor_perfil,u.foto_avatar,u.formato_avatar,u.tamanho_texto,u.espacamento,s.acesso
    FROM sessoes s JOIN usuarios u ON s.usuario=u.id
    WHERE s.token=? AND s.expira>? AND u.ativo=1
  `).get(hash, agora);
  if (!usuario) return null;
  if (agora - usuario.acesso >= 60_000) {
    banco.prepare('UPDATE sessoes SET acesso=? WHERE token=?').run(agora, hash);
  }
  delete usuario.acesso;
  usuario.contatos_pendentes = !usuario.email || !usuario.telefone;
  return { usuario, hash };
}

export function encerrarSessao(banco, hash) {
  banco.prepare('DELETE FROM sessoes WHERE token=?').run(hash);
}

export function donoDosDados(banco, sessao, perfil, metodo = 'GET') {
  if (perfil === undefined) return sessao.usuario.id;
  exigir(typeof perfil === 'string' && /^\d+$/.test(perfil), 'Perfil inválido.');
  const id = inteiro(Number(perfil), 'perfil');
  if (id === sessao.usuario.id) return id;
  exigir(metodo === 'GET', 'O acesso autorizado a outro perfil é somente consulta.', 403);
  const permitido = sessao.usuario.admin
    ? banco.prepare(`SELECT 1 FROM acessos_financeiros WHERE titular=? AND solicitante=? AND estado='aprovado' AND expira>?`).get(id, sessao.usuario.id, Date.now())
    : banco.prepare(`SELECT 1 FROM membros m JOIN familias f ON f.id=m.familia
        JOIN membros r ON r.familia=f.id AND r.usuario=f.responsavel JOIN usuarios u ON u.id=f.responsavel
        WHERE m.usuario=? AND m.consulta_por=? AND f.responsavel=? AND u.ativo=1`)
        .get(id, sessao.usuario.id, sessao.usuario.id);
  exigir(permitido && banco.prepare('SELECT 1 FROM usuarios WHERE id=? AND ativo=1').get(id),
    'Este perfil não autorizou sua consulta ou a autorização expirou.', 403);
  return id;
}

function atualizarDadosUsuario(banco, sessao, id, dados, contatos) {
  const nome = texto(dados.nome, 'nome');
  const login = loginNormalizado(dados.login);
  return transacao(banco, () => {
    exigir(banco.prepare('SELECT 1 FROM usuarios WHERE id=?').get(id), 'Perfil não encontrado.', 404);
    exigir(!banco.prepare('SELECT 1 FROM usuarios WHERE login=? AND id<>?').get(login, id), 'Este usuário já existe.', 409);
    if (dados.senha !== undefined && dados.senha !== '') {
      exigir(id === sessao.usuario.id, 'Use a recuperação verificada ou a solicitação de troca do titular.', 403);
      const senha = protegerSenha(dados.senha);
      banco.prepare('UPDATE usuarios SET nome=?,login=?,senha=? WHERE id=?').run(nome, login, senha, id);
      banco.prepare('DELETE FROM sessoes WHERE usuario=? AND token<>?').run(id, sessao.hash);
      banco.prepare("UPDATE solicitacoes_senha SET estado='cancelada',senha_hash=NULL,decidida_em=?,administrador=? WHERE usuario=? AND estado='pendente'")
        .run(Date.now(), sessao.usuario.id, id);
    } else {
      banco.prepare('UPDATE usuarios SET nome=?,login=? WHERE id=?').run(nome, login, id);
    }
    if (contatos) salvarContatos(banco, id, contatos);
    banco.prepare("INSERT INTO eventos_seguranca(ator,alvo,evento,criada_em) VALUES (?,?,'perfil_atualizado',?)").run(sessao.usuario.id,id,Date.now());
    return { id };
  });
}

export function atualizarMeuPerfil(banco, sessao, dados) {
  exigir(!dados.senha, 'Use Solicitar troca de senha para enviar a alteração ao administrador.', 403);
  confirmarSenha(banco, sessao.usuario.id, dados.senha_atual, 'Informe sua senha atual corretamente para salvar o perfil.');
  const contatos = dados.email !== undefined || dados.telefone !== undefined ? validarContatos(dados) : null;
  return atualizarDadosUsuario(banco, sessao, sessao.usuario.id, dados, contatos);
}

function limparDadosFinanceiros(banco, usuario) {
  banco.prepare('DELETE FROM notificacoes_enviadas WHERE dispositivo IN (SELECT id FROM dispositivos WHERE usuario=?)').run(usuario);
  banco.prepare('DELETE FROM dispositivos WHERE usuario=?').run(usuario);
  const tabelas = ['ajustes_ocorrencias', 'itens_cartao', 'compras_cartao', 'ocorrencias', 'compromissos_arquivados',
    'compromissos', 'faturas', 'viradas', 'lancamentos', 'cartoes_arquivados', 'cartoes', 'contas', 'categorias', 'operacoes'];
  for (const tabela of tabelas) banco.prepare(`DELETE FROM ${tabela} WHERE usuario=?`).run(usuario);
  banco.prepare('DELETE FROM configuracao WHERE chave=?').run(`painel.conta:${usuario}`);
}

export function removerDadosDoPerfil(banco, sessao, caminho, dados) {
  exigir(dados.confirmar === true, 'Confirme que entendeu quais dados serão apagados.');
  confirmarSenha(banco, sessao.usuario.id, dados.senha, 'Informe sua senha atual corretamente para confirmar a exclusão.');
  const usuario = sessao.usuario.id;
  if (caminho === '/api/perfil/limpar-dados') {
    return operacaoUnica(banco, usuario, caminho, { chave: dados.chave, confirmar: true }, () => {
      limparDadosFinanceiros(banco, usuario);
      banco.prepare('DELETE FROM sessoes WHERE usuario=? AND token<>?').run(usuario, sessao.hash);
      return { limpo: true };
    });
  }
  return transacao(banco, () => {
    if (sessao.usuario.admin) {
      const outroAdmin = banco.prepare('SELECT 1 FROM usuarios WHERE id<>? AND ativo=1 AND admin=1').get(usuario);
      const outrosPerfis = banco.prepare('SELECT 1 FROM usuarios WHERE id<>?').get(usuario);
      exigir(outroAdmin || !outrosPerfis,
        'Este é o último administrador ativo. Outro administrador precisa estar ativo antes de excluir sua conta.', 409);
    }
    exigir(!banco.prepare('SELECT 1 FROM familias WHERE responsavel=?').get(usuario),
      'Transfira a responsabilidade ou encerre sua família antes de excluir a conta.', 409);
    limparDadosFinanceiros(banco, usuario);
    banco.prepare('DELETE FROM solicitacoes_senha WHERE usuario=?').run(usuario);
    banco.prepare('UPDATE solicitacoes_senha SET administrador=NULL WHERE administrador=?').run(usuario);
    banco.prepare('DELETE FROM sessoes WHERE usuario=?').run(usuario);
    banco.prepare('DELETE FROM usuarios WHERE id=?').run(usuario);
    banco.prepare('DELETE FROM tentativas WHERE chave=?').run(sha(`confirmacao:${usuario}`));
    return { excluido: true };
  });
}

function miniaturaJpegValida(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false;
  for (let posicao = 2; posicao + 8 < bytes.length;) {
    if (bytes[posicao] !== 255) return false;
    const marcador = bytes[posicao + 1];
    if (marcador === 255) { ++posicao; continue; }
    if (marcador === 218 || marcador === 217) return false;
    const tamanho = bytes.readUInt16BE(posicao + 2);
    if (tamanho < 2 || posicao + 2 + tamanho > bytes.length) return false;
    if ([192,193,194].includes(marcador)) {
      const altura = bytes.readUInt16BE(posicao + 5);
      const largura = bytes.readUInt16BE(posicao + 7);
      return tamanho >= 8 && altura > 0 && altura <= 128 && largura > 0 && largura <= 128;
    }
    posicao += tamanho + 2;
  }
  return false;
}

export function atualizarAparencia(banco, sessao, dados) {
  const nome = dados.nome_exibicao === '' ? null : texto(dados.nome_exibicao, 'nome de exibição', 60);
  exigir(avataresPerfil.some(item => item.id === dados.avatar), 'Escolha um avatar válido.');
  exigir(coresPerfil.some(item => item.id === dados.cor_perfil), 'Escolha uma cor de perfil válida.');
  const preferencias = {};
  for (const [campo, opcoes] of Object.entries(opcoesPreferencias)) {
    const valor = dados[campo] ?? sessao.usuario[campo] ?? opcoes[0].id;
    exigir(opcoes.some(item => item.id === valor), 'Escolha uma opção válida para ' + campo + '.');
    preferencias[campo] = valor;
  }
  const foto = dados.foto_avatar || null;
  if (foto) {
    exigir(typeof foto === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(foto) && foto.length <= 13680,
      'Escolha uma foto JPEG de até 10 KB.');
    const bytes = Buffer.from(foto.split(',')[1], 'base64');
    exigir(bytes.length <= 10240 && miniaturaJpegValida(bytes), 'Envie uma miniatura JPEG de até 128 × 128 pixels.');
  }
  banco.prepare('UPDATE usuarios SET nome_exibicao=?,avatar=?,cor_perfil=?,foto_avatar=?,formato_avatar=?,tema=?,tamanho_texto=?,espacamento=? WHERE id=?')
    .run(nome, dados.avatar, dados.cor_perfil, foto, preferencias.formato_avatar, preferencias.tema, preferencias.tamanho_texto, preferencias.espacamento, sessao.usuario.id);
  return { id: sessao.usuario.id };
}

function validarContatos(dados) {
  const email = texto(dados.email, 'e-mail', 254).toLowerCase();
  exigir(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Informe um e-mail válido.');
  const recebido = texto(dados.telefone, 'telefone', 40);
  exigir(/^\+?[\d\s().-]+$/.test(recebido), 'Informe um telefone válido com DDD.');
  const numeros = recebido.replace(/\D/g, '');
  const telefone = recebido.startsWith('+') || (numeros.startsWith('55') && [12,13].includes(numeros.length))
    ? `+${numeros}` : `+55${numeros}`;
  exigir(/^\+[1-9]\d{7,14}$/.test(telefone) && (recebido.startsWith('+')
    || [10,11].includes(numeros.length) || (numeros.startsWith('55') && [12,13].includes(numeros.length))),
  'Informe o telefone com DDD. Para outro país, comece pelo código internacional com +.');
  const preferencias = Object.fromEntries(['avisos_email','avisos_whatsapp','avisos_sms'].map(canal => {
    const valor = dados[canal];
    exigir(valor === undefined || [true,false,0,1,'on'].includes(valor), 'Confira os canais de notificação.');
    return [canal, Number([true,1,'on'].includes(valor))];
  }));
  return { email, telefone, ...preferencias };
}

function salvarContatos(banco, id, contatos) {
  banco.prepare('UPDATE usuarios SET email=?,telefone=?,avisos_email=?,avisos_whatsapp=?,avisos_sms=? WHERE id=?')
    .run(contatos.email, contatos.telefone, contatos.avisos_email, contatos.avisos_whatsapp, contatos.avisos_sms, id);
}

export function cadastrarContatos(banco, sessao, dados) {
  exigir(sessao.usuario.contatos_pendentes, 'Edite seus contatos em Meu perfil.', 409);
  salvarContatos(banco, sessao.usuario.id, validarContatos(dados));
  return { id: sessao.usuario.id };
}

export function solicitacoesSenha(banco, sessao, metodo, dados) {
  const usuario = sessao.usuario.id;
  if (metodo === 'GET') return {
    solicitacoes: banco.prepare('SELECT id,justificativa,estado,criada_em,decidida_em FROM solicitacoes_senha WHERE usuario=? ORDER BY id DESC').all(usuario)
  };
  confirmarSenha(banco, usuario, dados.senha_atual, 'Informe sua senha atual corretamente para solicitar a troca.');
  const justificativa = texto(dados.justificativa, 'justificativa', 1000);
  exigir(typeof dados.senha === 'string' && dados.senha === dados.confirmacao_senha,
    'As senhas não coincidem. Digite a mesma nova senha nos dois campos.');
  const senha = protegerSenha(dados.senha);
  return transacao(banco, () => {
    exigir(!banco.prepare("SELECT 1 FROM solicitacoes_senha WHERE usuario=? AND estado='pendente'").get(usuario),
      'Você já tem uma solicitação aguardando análise.', 409);
    return { id: banco.prepare('INSERT INTO solicitacoes_senha(usuario,justificativa,senha_hash,criada_em) VALUES (?,?,?,?)')
      .run(usuario, justificativa, senha, Date.now()).lastInsertRowid };
  });
}

function decidirSolicitacaoSenha(banco, sessao, id, dados) {
  exigir(['aprovada','recusada'].includes(dados.decisao), 'Selecione Aprovar ou Recusar.');
  confirmarSenha(banco, sessao.usuario.id, dados.senha_atual, 'Confirme sua senha de administrador para concluir.');
  return transacao(banco, () => {
    const pedido = banco.prepare('SELECT * FROM solicitacoes_senha WHERE id=?').get(id);
    exigir(pedido, 'Solicitação não encontrada.', 404);
    if (pedido.estado === dados.decisao && pedido.administrador === sessao.usuario.id) return { id };
    exigir(pedido.estado === 'pendente', 'Esta solicitação já foi analisada.', 409);
    if (dados.decisao === 'aprovada') {
      exigir(banco.prepare('SELECT ativo FROM usuarios WHERE id=?').get(pedido.usuario)?.ativo,
        'Reative o perfil antes de aprovar a troca.', 409);
      banco.prepare('UPDATE usuarios SET senha=? WHERE id=?').run(pedido.senha_hash, pedido.usuario);
      banco.prepare('DELETE FROM sessoes WHERE usuario=? AND token<>?').run(pedido.usuario, sessao.hash);
    }
    banco.prepare('UPDATE solicitacoes_senha SET estado=?,senha_hash=NULL,decidida_em=?,administrador=? WHERE id=?')
      .run(dados.decisao, Date.now(), sessao.usuario.id, id);
    return { id };
  });
}

export function administracao(banco, sessao, metodo, caminho, dados) {
  exigir(sessao.usuario.admin, 'Acesso restrito à administração.', 403);
  if (metodo === 'GET' && caminho === '/api/admin') {
    const usuarios = banco.prepare('SELECT id,nome,login,admin,ativo,ultimo_acesso FROM usuarios ORDER BY nome').all();
    const sessoes = banco.prepare(`
      SELECT substr(s.token,1,32) AS id,s.usuario,s.inicio,s.acesso,s.expira,s.token=? AS atual
      FROM sessoes s JOIN usuarios u ON s.usuario=u.id WHERE s.expira>? AND u.ativo=1 ORDER BY s.acesso DESC
    `).all(sessao.hash, Date.now());
    const solicitacoes_senha = banco.prepare(`
      SELECT p.id,p.usuario,p.justificativa,p.estado,p.criada_em,p.decidida_em,u.nome,u.login
      FROM solicitacoes_senha p JOIN usuarios u ON u.id=p.usuario
      ORDER BY (p.estado='pendente') DESC,p.id DESC
    `).all();
    const acessos = banco.prepare('SELECT id,titular,estado,expira FROM acessos_financeiros WHERE solicitante=? ORDER BY id DESC').all(sessao.usuario.id);
    const recuperacoes = banco.prepare("SELECT r.id,r.estado,r.criada_em,u.nome,u.login,u.email,u.telefone FROM recuperacoes r JOIN usuarios u ON u.id=r.usuario WHERE r.estado='pendente' AND r.criada_em>? ORDER BY r.id DESC LIMIT 100").all(Date.now()-86_400_000);
    const eventos = banco.prepare('SELECT id,ator,alvo,evento,criada_em FROM eventos_seguranca ORDER BY id DESC LIMIT 100').all();
    return { usuarios, sessoes, solicitacoes_senha, acessos, recuperacoes, eventos };
  }
  const solicitacao = caminho.match(/^\/api\/admin\/solicitacoes-senha\/(\d+)$/);
  if (metodo === 'POST' && solicitacao) {
    return decidirSolicitacaoSenha(banco, sessao, inteiro(Number(solicitacao[1]), 'solicitação'), dados);
  }
  if (metodo === 'POST' && caminho === '/api/admin/usuarios') {
    confirmarSenha(banco, sessao.usuario.id, dados.senha_admin, 'Confirme sua senha de administrador para criar um usuário.');
    return { id: transacao(banco, () => criarUsuario(banco, dados)) };
  }
  if (metodo === 'POST' && caminho === '/api/admin/usuarios/editar') {
    confirmarSenha(banco, sessao.usuario.id, dados.senha_admin, 'Confirme sua senha de administrador.');
    const id = inteiro(dados.id, 'perfil');
    return atualizarDadosUsuario(banco, sessao, id, dados);
  }
  if (metodo === 'POST' && caminho === '/api/admin/atividade') {
    const id = inteiro(dados.id, 'usuário');
    exigir(id !== sessao.usuario.id, 'O administrador da sessão atual deve permanecer ativo.');
    confirmarSenha(banco, sessao.usuario.id, dados.senha_admin, 'Confirme sua senha de administrador.');
    exigir(dados.ativo || !banco.prepare('SELECT 1 FROM familias WHERE responsavel=?').get(id), 'Transfira a responsabilidade antes de desativar o perfil.', 409);
    exigir(typeof dados.ativo === 'boolean', 'Informe a situação do usuário.');
    transacao(banco, () => {
      const alteracao = banco.prepare('UPDATE usuarios SET ativo=? WHERE id=? AND admin=0').run(Number(dados.ativo), id);
      exigir(alteracao.changes, 'Usuário não encontrado.', 404);
      if (!dados.ativo) {
        banco.prepare('DELETE FROM sessoes WHERE usuario=?').run(id);
        banco.prepare("UPDATE acessos_financeiros SET estado='revogado' WHERE titular=? OR solicitante=?").run(id,id);
        banco.prepare('UPDATE membros SET consulta_por=NULL WHERE usuario=? OR consulta_por=?').run(id,id);
        banco.prepare("UPDATE recuperacoes SET estado='cancelada',token_hash=NULL WHERE usuario=? AND estado IN ('pendente','liberada')").run(id);
        banco.prepare("UPDATE pedidos_entrada SET estado='cancelado' WHERE usuario=? AND estado='pendente'").run(id);
      }
      banco.prepare('INSERT INTO eventos_seguranca(ator,alvo,evento,criada_em) VALUES (?,?,?,?)').run(sessao.usuario.id,id,dados.ativo?'usuario_reativado':'usuario_desativado',Date.now());
    });
    return {};
  }
  if (metodo === 'POST' && caminho === '/api/admin/sessoes/encerrar') {
    const id = texto(dados.id, 'sessão', 32);
    exigir(/^[a-f0-9]{32}$/.test(id), 'Sessão inválida.');
    const sessaoAlvo = banco.prepare('SELECT token FROM sessoes WHERE substr(token,1,32)=? AND expira>?').get(id, Date.now());
    exigir(sessaoAlvo, 'Sessão não encontrada.', 404);
    exigir(sessaoAlvo.token !== sessao.hash, 'Use Trocar perfil para encerrar sua sessão atual.');
    encerrarSessao(banco, sessaoAlvo.token);
    return {};
  }
  exigir(false, 'Página não encontrada.', 404);
}
