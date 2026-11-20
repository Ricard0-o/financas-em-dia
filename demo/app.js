import qrcode from './qrcode.mjs';
import { bancos, identificarBanco } from './bancos.mjs';
import { avataresPerfil, coresPerfil, opcoesPreferencias } from './aparencia.mjs';

const app = document.querySelector('#app');
const janela = document.querySelector('#janela');
const menuMovel = document.createElement('dialog');
menuMovel.id = 'menu-movel';
menuMovel.className = 'painel-mais-movel';
menuMovel.setAttribute('aria-labelledby', 'titulo-menu-movel');
document.body.append(menuMovel);
let restaurarFocoMais = true, focarPaginaAposMenu = false;
const aviso = document.querySelector('#aviso');
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percentual = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const dinheiro = centavos => moeda.format(centavos / 100);
const dataBr = dia => dia ? dia.split('-').reverse().join('/') : '—';
const calendarioPainel = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });
const horaBr = instante => instante ? new Date(instante).toLocaleString('pt-BR') : '—';
const h = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const chave = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');

const rotulos = {
  despesa: 'Despesa', renda: 'Renda extra', salario: 'Salário', transferencia: 'Transferência',
  fatura: 'Fatura', parcela: 'Parcela direta', recorrencia: 'Recorrência',
  conta: 'Conta disponível', reserva: 'Reserva', investimento: 'Investimento', mensal: 'Mensal', parcelado: 'Parcelado'
};
const rotuloMovimento = item => item.avulso ? 'Pagamento avulso' : rotulos[item.tipo];
const classeMovimento = tipo => ['salario', 'renda'].includes(tipo) ? 'entrada'
  : tipo === 'transferencia' ? 'transferencia' : 'saida';
const paginas = { inicio: 'Visão geral', contas: 'Contas', historico: 'Histórico', cartoes: 'Cartões',
  compromissos: 'Compromissos', relatorios: 'Relatórios', notificacoes: 'Notificações', perfil: 'Meu perfil', familia: 'Minha família', admin: 'Administração' };
const iconesPaginas = {
  inicio: 'dashboard', contas: 'account_balance', historico: 'history', cartoes: 'credit_card',
  compromissos: 'calendar_month', relatorios: 'bar_chart', notificacoes: 'notifications', perfil: 'person', familia: 'group', admin: 'admin_panel_settings'
};
const iconesMovimentos = {
  despesa: 'arrow_upward', renda: 'arrow_downward', salario: 'payments', transferencia: 'swap_horiz',
  fatura: 'receipt_long', parcela: 'calendar_month', recorrencia: 'sync_alt'
};
const iconesContas = { conta: 'account_balance', reserva: 'savings', investimento: 'trending_up' };
const iconeBanco = (id, generico = 'account_balance') => {
  const imagem = bancos.find(banco => banco.id === id)?.icone;
  return imagem ? `<img class="icone-banco" src="${imagem}" alt="" width="24" height="24">` : icone(generico);
};
function nomeComBanco(item, generico = iconesContas[item.tipo] ?? 'account_balance') {
  const banco = identificarBanco(item);
  const tipoPatrimonio = item.tipo === 'reserva' || item.tipo === 'investimento';
  const simbolos = tipoPatrimonio
    ? icone(generico) + (banco !== 'outro' ? iconeBanco(banco) : '')
    : iconeBanco(banco, generico);
  return `<span class="com-icone">${simbolos}${h(item.nome)}</span>`;
}
const iconesAcoes = {
  salario: 'payments', compra: 'credit_card', cartao: 'credit_card', categoria: 'add', plano: 'calendar_month',
  editar: 'edit', 'editar-conta': 'edit', 'editar-categoria': 'edit', 'editar-cobranca': 'edit', 'editar-perfil': 'edit', 'editar-cartao': 'edit',
  excluir: 'delete', 'excluir-categoria': 'delete', 'excluir-cobranca': 'delete', 'excluir-cartao': 'delete',
  fatura: 'receipt_long', usuario: 'person', sair: 'swap_horiz'
};
const dicasAcoes = {
  salario: 'Registre o salário e abra um período na data do crédito.',
  compra: 'Registre uma compra para incluir o valor na fatura do cartão.',
  cartao: 'Cadastre o limite, o fechamento e o vencimento de um cartão.',
  categoria: 'Crie uma categoria para classificar os gastos.',
  conta: 'Cadastre um saldo inicial e a data em que ele valia.',
  movimento: 'Abra o formulário para registrar a movimentação.',
  patrimonio: 'Registre a transferência entre uma conta e a reserva ou investimento.',
  plano: 'Cadastre um pagamento previsto e acompanhe o vencimento.',
  editar: 'Corrija os dados do lançamento registrado.',
  'editar-categoria': 'Altere o nome da categoria dos registros vinculados.',
  'editar-cobranca': 'Altere os dados desta cobrança ou do pagamento registrado.',
  'editar-perfil': 'Altere o nome, o usuário ou a senha deste perfil.',
  'editar-compra': 'Corrija a compra e revise as parcelas e as faturas antes de confirmar.',
  'excluir-compra': 'Revise as parcelas afetadas e confirme com sua senha. Pagamentos quitados serão preservados.',
  'editar-cartao': 'Altere o nome, o limite, o fechamento ou o vencimento do cartão.',
  excluir: 'Abra a confirmação para remover o lançamento e recalcular o saldo.',
  'excluir-categoria': 'Abra a confirmação para remover a categoria.',
  'excluir-cobranca': 'Abra a confirmação para remover esta cobrança.',
  'excluir-cartao': 'Revise o que será preservado e confirme com sua senha.',
  'restaurar-cartao': 'Volte a usar este cartão para novas compras.',
  'encerrar-plano': 'Cancele as cobranças futuras desta recorrência.',
  'arquivar-plano': 'Retire esta recorrência encerrada da lista de cadastrados.',
  'restaurar-plano': 'Mostre a recorrência encerrada novamente na lista.',
  ocorrencia: 'Consulte os detalhes da cobrança ou o pagamento registrado.',
  'ocorrencia-corrigir': 'Corrija o valor, a conta ou a data do pagamento.',
  fatura: 'Veja os itens da fatura e registre o pagamento quando disponível.',
  'fatura-corrigir': 'Corrija a conta ou a data do pagamento da fatura.',
  'fatura-datas': 'Informe as datas desta fatura como aparecem no aplicativo do cartão.',
  usuario: 'Cadastre um novo perfil com senha própria.',
  'abrir-perfil': 'Abra os dados financeiros deste perfil como administrador.',
  atividade: 'Altere se este perfil pode entrar no aplicativo.',
  'sessao-encerrar': 'Encerre a sessão para exigir que o usuário entre de novo.',
  'sair-perfil-aberto': 'Feche as finanças abertas e retorne à lista de perfis.',
  sair: 'Saia da sessão e retorne à escolha de perfil.',
  tema: 'Alterne entre os temas claro e escuro.',
  'push-ativar': 'Ative os avisos de vencimento neste aparelho.',
  'push-testar': 'Envie uma notificação de teste a este aparelho.',
  'push-desativar': 'Desative os avisos neste aparelho.',
  'recarregar-perfis': 'Busque novamente os perfis cadastrados.'
};

let usuario, base, periodos, dadosPagina, navegacao = 0, temporizador;
let perfis = [];
let podeInicializar = false;
let perfilAberto;
const filtros = { historico: {}, relatorios: {} };
let aba = 'inicio';
let registroPush;
let consultandoRede = false;

async function api(caminho, dados, signal) {
  const headers = {};
  if (perfilAberto && /^\/api\/(base|periodos|painel|contas|categorias|lancamentos|cartoes|compras|compromissos|faturas|ocorrencias|relatorios)(?:[/?]|$)/.test(caminho)) headers['X-Financas-Perfil'] = String(perfilAberto.id);
  if (dados !== undefined) headers['Content-Type'] = 'application/json';
  const resposta = await fetch(caminho, {
    headers, signal, method: dados === undefined ? 'GET' : 'POST',
    body: dados === undefined ? undefined : JSON.stringify(dados)
  });
  const json = await resposta.json();
  if (!resposta.ok) {
    const erro = new Error(json.erro);
    erro.status = resposta.status;
    throw erro;
  }
  return json;
}

function mostrarAviso(mensagem) {
  aviso.textContent = mensagem;
  aviso.hidden = false;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { aviso.hidden = true; }, 4900);
}

const marca = () => '<div class="marca"><img class="marca-simbolo" src="./icone-192.png" alt=""> Finanças em Dia</div>';
const icone = nome => `<span class="icone" aria-hidden="true">${nome}</span>`;
const comIcone = (nome, conteudo) => nome ? `<span class="com-icone">${icone(nome)}<span>${conteudo}</span></span>` : conteudo;
const vazio = mensagem => `<p class="vazio">${h(mensagem)}</p>`;
const painel = (titulo, conteudo, acoes = '', simbolo) => `<section class="painel"><div class="linha"><h2>${comIcone(simbolo, h(titulo))}</h2>${acoes}</div>${conteudo}</section>`;
const acoesConsulta = new Set(['fatura','ocorrencia','detalhar-previsao','detalhar-saidas','detalhar-patrimonio','sair-perfil-aberto','tema','sair','tutorial','qr-rede','copiar-endereco','relatorio-detalhe','relatorio-categoria','menu-movel']);
function botao(titulo, acao, id = '', classe = '') {
  if (perfilAberto && !acoesConsulta.has(acao)) return '';
  let simbolo = iconesAcoes[acao];
  if (acao === 'movimento') simbolo = iconesMovimentos[id];
  if (acao === 'conta') simbolo = iconesContas[id];
  if (acao === 'patrimonio') simbolo = id === 'aporte' ? 'arrow_downward' : 'arrow_upward';
  if (acao === 'tema') simbolo = usuario.tema === 'claro' ? 'dark_mode' : 'light_mode';
  const dica = acao === 'ocorrencia' && titulo === 'Registrar pagamento'
    ? 'Abre o registro do pagamento. Ao salvar, o valor é debitado da conta escolhida.'
    : dicasAcoes[acao];
  return `<button type="button" class="botao ${classe}" data-acao="${acao}" data-id="${h(id)}"${dica ? ` title="${h(dica)}"` : ''}>${comIcone(simbolo, h(titulo))}</button>`;
}
const link = (titulo, destino) => `<a class="botao" href="#${destino}">${comIcone(iconesPaginas[destino], h(titulo))}</a>`;
const lista = (html, mensagem) => html.length ? `<ul class="lista">${html.join('')}</ul>` : vazio(mensagem);
const linha = (esquerda, direita) => `<li class="linha"><div>${esquerda}</div><div class="acoes">${direita}</div></li>`;
const metrica = (rotulo, valor, classe = '', simbolo) => `<div class="metrica ${classe}"><small>${comIcone(simbolo, h(rotulo))}</small><strong class="valor">${dinheiro(valor)}</strong></div>`;
const metricaComDetalhes = (rotulo, valor, simbolo, acao, id = '', classe = '') =>
  `<button type="button" class="metrica metrica-interativa ${classe}" data-acao="${acao}" data-id="${id}"
    aria-haspopup="dialog" title="Ver detalhes de ${h(rotulo)}.">
    <small>${comIcone(simbolo, h(rotulo))}</small><strong class="valor">${dinheiro(valor)}</strong>
  </button>`;
const valorColorido = (valor, classe, sinal = '') => `<span class="valor sinal ${classe}">${sinal}${dinheiro(valor)}</span>`;
function valorMovimento(item) {
  const classe = classeMovimento(item.tipo);
  const sinal = classe === 'entrada' ? '+ ' : classe === 'saida' ? '− ' : '';
  return valorColorido(item.valor, classe, sinal);
}
const seloSituacao = (rotulo, classe) => `<span class="situacao sinal ${classe}">${h(rotulo)}</span>`;
const subtitulo = texto => `<small>${h(texto)}</small>`;
const tabela = (colunas, linhas, mensagem) => linhas.length
  ? `<div class="rolagem"><table class="tabela"><thead><tr>${colunas.map(titulo => `<th scope="col">${h(titulo)}</th>`).join('')}</tr></thead><tbody>
      ${linhas.map(celulas => `<tr>${celulas.map(celula => `<td>${celula}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : vazio(mensagem);

function tabelaComCartoes(colunas, linhas, mensagem, titulo, valor) {
  if (!linhas.length) return vazio(mensagem);
  const cartoes = linhas.map(celulas => `<li>
    <div class="linha"><strong>${celulas[titulo]}</strong><strong>${celulas[valor]}</strong></div>
    <dl>${colunas.map((rotulo, indice) => [titulo, valor, colunas.length - 1].includes(indice)
      ? '' : `<div><dt>${h(rotulo)}</dt><dd>${celulas[indice]}</dd></div>`).join('')}</dl>
    <div class="acoes">${celulas.at(-1)}</div>
  </li>`).join('');
  return `<div class="apenas-tabela">${tabela(colunas, linhas, mensagem)}</div>
    <ul class="cartoes-de-tabela">${cartoes}</ul>`;
}

const rotular = (nome, campo) => `<label class="campo"><span>${h(nome)}</span>${campo}</label>`;
function campo(nome, rotulo, valor = '', tipo = 'text', atributos = '') {
  return rotular(rotulo, `<input name="${nome}" type="${tipo}" value="${h(valor)}" ${atributos}>`);
}
function valorCampo(nome, rotulo, valor) {
  return campo(nome, rotulo, valor === undefined ? '' : (valor / 100).toFixed(2).replace('.', ','), 'text',
    'inputmode="decimal" placeholder="0,00" data-formato="dinheiro" required');
}
const textoCampo = (nome, rotulo, valor = '', maximo = 120) => campo(nome, rotulo, valor, 'text', `required maxlength="${maximo}"`);
const diaCampo = (nome, rotulo, dia = base.hoje, maximo = base.hoje, extra = '') =>
  campo(nome, rotulo, dia, 'date', `required ${maximo ? `max="${maximo}"` : ''} ${extra}`);
const numeroCampo = (nome, rotulo, valor, min, max) =>
  campo(nome, rotulo, valor, 'number', `data-formato="numero" min="${min}" max="${max}" required`);

function escolha(nome, rotulo, opcoes, valor = '', { opcional = false, numeros = true, vazio = 'Selecione', comBanco = false } = {}) {
  const selecionado = item => String(item.id) === String(valor);
  const select = `<select name="${nome}" ${numeros ? 'data-formato="numero"' : ''} ${opcional ? '' : 'required'}>
    <option value="">${h(vazio)}</option>${opcoes.map(item => `<option value="${h(item.id)}"
      ${comBanco ? `data-banco="${h(identificarBanco(item))}" data-icone="${iconesContas[item.tipo] ?? 'credit_card'}"` : ''}
      ${selecionado(item) ? 'selected' : ''}>${h(item.nome)}</option>`).join('')}</select>`;
  if (!comBanco) return rotular(rotulo, select);
  const item = opcoes.find(selecionado);
  const simbolo = item ? iconeBanco(identificarBanco(item), iconesContas[item.tipo] ?? 'credit_card') : icone('account_balance');
  return rotular(rotulo, `<span class="seletor-com-banco"><span data-icone-banco aria-hidden="true">${simbolo}</span>${select}</span>`);
}

const contasBancarias = () => base.contas.filter(conta => conta.tipo === 'conta');
const contaCampo = (nome, rotulo, valor, contas = contasBancarias()) =>
  escolha(nome, rotulo, contas, valor ?? contas[0]?.id, { comBanco: true });
const categoriaCampo = valor => escolha('categoria', 'Categoria', base.categorias, valor ?? base.categorias[0]?.id);

function camposBanco(rotuloNome, item) {
  const selecionado = item && identificarBanco(item);
  const opcoes = bancos.map(banco => `<label class="opcao-banco">
    <input type="radio" name="banco" value="${banco.id}" ${selecionado === banco.id ? 'checked' : ''} required>
    <span>${iconeBanco(banco.id)}${banco.nome}</span>
  </label>`).join('');
  return `<fieldset class="escolher-banco"><legend>Banco ou instituição</legend>
    <div class="opcoes-bancos">${opcoes}</div></fieldset>` + textoCampo('nome', rotuloNome, item?.nome);
}

function preencherNomeDoBanco(formulario) {
  formulario.addEventListener('change', evento => {
    if (evento.target.name !== 'banco') return;
    const banco = bancos.find(item => item.id === evento.target.value);
    const nome = formulario.elements.nome;
    nome.value = banco.icone ? banco.nome : '';
    if (!banco.icone) nome.focus();
  });
}

function centavos(valor) {
  const limpo = valor.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  let normalizado;
  if (/^-?\d+(?:[,.]\d{1,2})?$/.test(limpo)) normalizado = limpo.replace(',', '.');
  else if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(limpo)) normalizado = limpo.replaceAll('.', '').replace(',', '.');
  else throw new Error('Informe o valor em reais, por exemplo 150,75.');
  const [reais, fracao = ''] = normalizado.replace(/^-/, '').split('.');
  const numero = Number(reais) * 100 + Number(fracao.padEnd(2, '0'));
  if (!Number.isSafeInteger(numero) || numero > 9_000_000_000_000) throw new Error('Valor fora do intervalo permitido.');
  return normalizado.startsWith('-') ? -numero : numero;
}

function lerFormulario(formulario) {
  const campos = new FormData(formulario);
  return Object.fromEntries([...campos.entries()].map(([nome, valor]) => {
    const formato = formulario.elements[nome].dataset?.formato;
    if (formato === 'dinheiro') return [nome, centavos(valor)];
    if (formato === 'numero') return [nome, valor === '' ? null : Number(valor)];
    return [nome, valor];
  }));
}

const rascunhos = new Map();
const guardarRascunho = new WeakMap();

function prepararRascunho(formulario, id) {
  const campos = Array.from(formulario.querySelectorAll('input[name]:not([type=password]), select[name], textarea[name]'))
    .filter(campo => !campo.readOnly && !campo.disabled && !['checkbox', 'radio', 'hidden'].includes(campo.type));
  const valores = () => Object.fromEntries(campos.map(campo => [campo.name, campo.value]));
  const inicial = JSON.stringify(valores());
  const rascunho = rascunhos.get(id);
  if (rascunho) {
    rascunhos.delete(id);
    for (const campo of campos) {
      if (!Object.hasOwn(rascunho, campo.name)) continue;
      campo.value = rascunho[campo.name];
      if (campo.tagName === 'SELECT') campo.dispatchEvent(new Event('change', { bubbles: true }));
    }
    formulario.insertAdjacentHTML('afterbegin', '<p class="suave" role="status">Rascunho recuperado. Confira os dados antes de salvar.</p>');
  }
  guardarRascunho.set(formulario, () => {
    const atual = valores();
    if (JSON.stringify(atual) !== inicial) rascunhos.set(id, atual);
  });
}

function abrirComRascunho(id, titulo, campos, aoSalvar, rotulo) {
  abrir(titulo, campos, aoSalvar, rotulo, undefined, id);
}

function abrir(titulo, conteudo, aoSalvar, rotulo = 'Salvar', vincular, idRascunho, destino = janela) {
  fecharMenuMovel(false);
  const modal = destino === janela;
  const dica = rotulo === 'Registrar pagamento' || rotulo === 'Quitar fatura'
    ? 'Registra o pagamento e debita o valor da conta escolhida.'
    : 'Confirma a operação com os dados exibidos.';
  destino.innerHTML = `${modal ? `<h2 id="titulo-janela">${h(titulo)}</h2>` : ''}<form>
    ${conteudo}<p class="erro" role="alert"></p><footer><button type="button" class="botao fechar" title="${modal ? 'Fecha esta janela.' : 'Recupera os dados salvos do perfil.'}">${modal ? aoSalvar ? 'Cancelar' : 'Fechar' : 'Descartar alterações'}</button>
    ${aoSalvar ? `<button type="submit" class="botao principal" title="${dica}">${h(rotulo)}</button>` : ''}</footer></form>`;
  const formulario = destino.querySelector('form');
  const fechar = formulario.querySelector('.fechar');
  fechar.onclick = () => modal ? janela.close() : carregar();
  if (modal) janela.oncancel = evento => {
    if (formulario.dataset.enviando) evento.preventDefault();
  };
  let anterior, identificador;
  formulario.onsubmit = async evento => {
    evento.preventDefault();
    if (!aoSalvar || formulario.dataset.enviando) return;
    const enviar = formulario.querySelector('[type=submit]');
    const erro = formulario.querySelector('.erro');
    try {
      formulario.dataset.enviando = '1';
      enviar.disabled = fechar.disabled = true;
      erro.textContent = '';
      const dados = lerFormulario(formulario);
      const assinatura = JSON.stringify(dados);
      if (assinatura !== anterior) {
        identificador = chave();
        anterior = assinatura;
      }
      await aoSalvar({ ...dados, chave: identificador }, formulario);
    } catch (falha) {
      erro.textContent = falha.message;
      if (falha.status === 401) mostrarLogin();
    } finally {
      enviar.disabled = fechar.disabled = false;
      delete formulario.dataset.enviando;
    }
  };
  if (modal && !janela.open) janela.showModal();
  vincular?.(formulario);
  if (idRascunho && aoSalvar) prepararRascunho(formulario, idRascunho);
}

function gravar(caminho, mensagem, fixos = {}) {
  return async dados => {
    await api(caminho, { ...dados, ...fixos });
    janela.close();
    mostrarAviso(mensagem);
    await carregar();
  };
}

function confirmar(titulo, mensagem, caminho, dados, sucesso, rotulo = 'Confirmar') {
  abrir(titulo, `<p>${h(mensagem)}</p>`, gravar(caminho, sucesso, dados), rotulo);
}

const senhaParaExcluir = () => campo('senha', 'Senha do perfil conectado', '', 'password', 'required autocomplete="current-password"');

function confirmarExclusao(titulo, mensagem, caminho, dados, sucesso) {
  abrir(titulo, `<p class="sinal saida">${h(mensagem)}</p>` + senhaParaExcluir(),
    gravar(caminho, sucesso, dados), 'Excluir');
}

function abrirTutorial() {
  abrir('Tutorial', `<div class="tutorial">
    <img class="tutorial-capa" src="./tutorial-financas.jpg" width="900" height="300" alt="">
    <section>
      <h3>Dica para manter o saldo atualizado</h3>
      <p>Faça pagamentos e transferências pelo aplicativo do seu banco. Assim que a operação for concluída ou um valor cair na sua conta, registre a movimentação aqui no site.</p>
    </section>
    <section>
      <h3>1. Cadastre suas contas e categorias</h3>
      <p>Em <strong>Contas</strong>, clique em <strong>Nova conta</strong> e informe o saldo na data escolhida. Crie, edite ou exclua categorias na seção <strong>Categorias</strong>. Ao excluir uma categoria em uso, escolha outra para receber os registros vinculados.</p>
    </section>
    <section>
      <h3>2. Registre o dinheiro que entra e sai</h3>
      <p>Em <strong>Visão geral</strong>, use <strong>Adicionar salário</strong>, <strong>Adicionar renda extra</strong> ou <strong>Adicionar despesa</strong>. Informe a conta, a data e o valor. O primeiro salário de uma data inicia um novo período. Um salário adicional na mesma data entra nesse período. Para mover dinheiro entre suas contas, use <strong>Transferir</strong>.</p>
    </section>
    <section>
      <h3>3. Acompanhe compras, faturas e cobranças</h3>
      <p>Em <strong>Cartões</strong>, cadastre o cartão com limite, dia de fechamento e vencimento. Em <strong>Registrar compra</strong>, informe o valor total e a quantidade de parcelas. Após o fechamento, abra os detalhes da fatura e use <strong>Quitar fatura</strong> para registrar o pagamento já feito.</p>
      <p>Em <strong>Compromissos</strong>, use <strong>Novo pagamento avulso</strong> para uma cobrança única, <strong>Nova recorrência</strong> para cobranças mensais ou <strong>Parcelar pela conta</strong> para pagamentos em parcelas. Use <strong>Registrar pagamento</strong> depois de pagar pelo banco. Cobranças recorrentes no cartão entram na fatura.</p>
    </section>
    <section>
      <h3>4. Separe sua reserva e seus investimentos</h3>
      <p>Em <strong>Contas</strong>, crie uma reserva ou um investimento. Use <strong>Aportar</strong> para enviar dinheiro e <strong>Resgatar</strong> para devolvê-lo à conta.</p>
    </section>
    <section>
      <h3>5. Confira os vencimentos e revise o período</h3>
      <p>A <strong>Visão geral</strong> mostra cobranças vencidas e as que vencem nos próximos cinco dias. Use <strong>Histórico</strong> para localizar e corrigir lançamentos e <strong>Relatórios</strong> para ver entradas, saídas e gastos por categoria.</p>
    </section>
  </div>`);
  const titulo = janela.querySelector('h2');
  titulo.tabIndex = -1;
  titulo.focus();
  janela.scrollTop = 0;
}

const blocoQrRede = () => '<div class="acesso-rede" data-qr-rede><p class="suave" role="status">Buscando o endereço de acesso…</p></div>';

async function atualizarQrRede() {
  if (consultandoRede || !document.querySelector('[data-qr-rede]')) return;
  consultandoRede = true;
  let endereco;
  let mensagem = 'Conecte o notebook à rede para gerar o QR code.';
  try {
    ({ endereco } = await api('/api/rede', undefined, AbortSignal.timeout(4000)));
  } catch {
    mensagem = 'Não foi possível consultar o endereço. Verifique a conexão e tente novamente.';
  } finally {
    consultandoRede = false;
  }
  const chaveQr = endereco?.url ?? mensagem;
  for (const bloco of document.querySelectorAll('[data-qr-rede]')) {
    if (bloco.dataset.exibido === chaveQr) continue;
    bloco.dataset.exibido = chaveQr;
    if (!endereco) {
      bloco.innerHTML = `<p class="suave" role="status">${h(mensagem)}</p>`;
      continue;
    }
    const codigo = qrcode(0, 'M');
    codigo.addData(endereco.url);
    codigo.make();
    bloco.innerHTML = `<img class="qr-rede-imagem" src="${codigo.createDataURL(5)}" alt="QR code de acesso ao Finanças em Dia">
      <div><p>${endereco.publico ? 'Escaneie no celular para acessar pela internet.' : 'Escaneie no celular conectado à mesma rede.'}</p>
        <button type="button" class="copiar-endereco" data-acao="copiar-endereco" data-id="${h(endereco.url)}"
          title="Copie o endereço para compartilhar.">
          ${comIcone('content_copy', h(endereco.url))}
        </button>
      </div>`;
  }
}

function abrirQrRede() {
  abrir('Acessar Finanças em Dia', blocoQrRede());
  atualizarQrRede();
}

async function copiarEndereco(endereco) {
  try {
    await navigator.clipboard.writeText(endereco);
  } catch {
    const foco = document.activeElement;
    const campo = document.createElement('textarea');
    campo.value = endereco;
    campo.readOnly = true;
    campo.className = 'campo-copia';
    (janela.open ? janela : document.body).append(campo);
    try {
      campo.select();
      if (!document.execCommand('copy')) throw new Error('Não foi possível copiar. Selecione o endereço e copie manualmente.');
    } finally {
      campo.remove();
      foco?.focus();
    }
  }
  mostrarAviso('Link copiado para a área de transferência.');
}

function limparTelaFinanceira() {
  base = periodos = dadosPagina = undefined;
  rascunhos.clear();
  filtros.historico = {};
  filtros.relatorios = {};
}

const iniciais = nome => nome.split(/\s+/).slice(0, 2).map(parte => [...parte][0]).join('').toLocaleUpperCase('pt-BR');
const nomeExibicao = perfil => perfil.nome_exibicao || perfil.nome;

function aplicarPreferencias(perfil, elemento = document.documentElement) {
  elemento.dataset.tema = perfil.tema || 'claro';
  elemento.dataset.cor = perfil.cor_perfil || 'verde';
  elemento.dataset.texto = perfil.tamanho_texto || 'normal';
  elemento.dataset.espacamento = perfil.espacamento || 'normal';
}

function avatarPerfil(perfil, compacto = false) {
  const cor = coresPerfil.some(item => item.id === perfil.cor_perfil) ? perfil.cor_perfil : 'verde';
  const avatar = avataresPerfil.find(item => item.id === perfil.avatar)?.simbolo || iniciais(nomeExibicao(perfil));
  return `<span class="perfil-avatar cor-perfil-${cor}${perfil.formato_avatar === 'redondo' ? ' redondo' : ''}${compacto ? ' compacto' : ''}" aria-hidden="true">
    ${perfil.foto_avatar ? `<img src="${h(perfil.foto_avatar)}" alt="">` : h(avatar)}
  </span>`;
}

function cartaoPerfil(perfil) {
  return `<button type="button" class="perfil-cartao" data-acao="escolher-perfil" data-id="${perfil.id}" title="Abra o campo de senha deste perfil.">
    ${avatarPerfil(perfil)}
    <strong>${h(nomeExibicao(perfil))}</strong>${perfil.admin ? '<small>Administrador</small>' : ''}
  </button>`;
}

function exibirPerfis() {
  app.innerHTML = `<main class="inicio-publico tela-perfis">
    <div class="inicio-conteudo">
      <header class="inicio-topo">${marca()}<nav class="acoes inicio-topo-acoes" aria-label="Acesso ao sistema">${botao('Entrar', 'entrar-login')}${podeInicializar ? botao('Criar administrador', 'adicionar-perfil', '', 'principal') : botao('Cadastrar', 'cadastro-publico', '', 'principal')}</nav></header>
      <div class="inicio-apresentacao">
        <section class="inicio-mensagem" aria-labelledby="titulo-inicio-publico">
          <span class="inicio-etiqueta">Organização para o seu dia a dia</span>
          <h1 id="titulo-inicio-publico">Finanças em Dia.<br><span>Sua paz em dia.</span></h1>
          <p>Acompanhe o que entrou, o que já saiu e as contas que ainda vão vencer. Mais clareza para planejar seus próximos dias.</p>
          <div class="inicio-destaques" aria-label="Recursos do aplicativo">
            <span>${comIcone('account_balance', 'Contas e cartões')}</span>
            <span>${comIcone('calendar_month', 'Vencimentos')}</span>
            <span>${comIcone('bar_chart', 'Relatórios')}</span>
          </div>
        </section>
        <section class="inicio-acesso" aria-labelledby="titulo-acesso">
          <img class="inicio-acesso-ilustracao" src="./ilustracao-financeira-realista.png" width="144" height="96" alt="">
          <h2 id="titulo-acesso">Seu espaço para organizar as finanças</h2>
          <p>Entre no seu perfil para continuar de onde parou.</p>
          ${botao('Entrar com usuário e senha', 'entrar-login', '', 'principal')}
          <div class="inicio-divisor"><span>Primeira vez por aqui?</span></div>
          ${podeInicializar ? botao('Criar administrador', 'adicionar-perfil') : botao('Cadastrar', 'cadastro-publico')}
          ${botao('Esqueci minha senha', 'recuperar-senha', '', 'inicio-recuperar')}
          <small>${podeInicializar ? 'Configure o primeiro administrador neste notebook.' : 'Durante o desenvolvimento, novos cadastros precisam da confirmação do administrador.'}</small>
        </section>
      </div>
      <section class="inicio-recursos" aria-label="Como o Finanças em Dia ajuda você">
        <article>${icone('account_balance')}<h2>Entenda seu saldo</h2><p>Veja suas entradas, saídas e quanto já está comprometido com os próximos pagamentos.</p></article>
        <article>${icone('calendar_month')}<h2>Antecipe os vencimentos</h2><p>Acompanhe compromissos e faturas para organizar os pagamentos do seu período.</p></article>
        <article>${icone('person')}<h2>Deixe com a sua cara</h2><p>Escolha sua foto, avatar, cores e aparência para tornar o perfil mais seu.</p></article>
      </section>
      <footer class="inicio-privacidade">${icone('person')}<p>Famílias e grupos organizam os integrantes. Cada pessoa mantém seu próprio perfil e controla as autorizações de consulta às suas finanças.</p></footer>
    </div>
  </main>`;
}

async function mostrarLogin() {
  focarPaginaAposMenu = false;
  fecharMenuMovel(false);
  menuMovel.replaceChildren();
  usuario = perfilAberto = undefined;
  const passagem = ++navegacao;
  limparTelaFinanceira();
  if (janela.open) janela.close();
  aplicarPreferencias({});
  app.innerHTML = '<p class="carregando">Carregando perfis…</p>';
  try {
    const dados = await api('/api/perfis');
    if (passagem !== navegacao) return;
    perfis = dados.perfis;
    podeInicializar = dados.inicializar;
    exibirPerfis();
  } catch (erro) {
    if (passagem !== navegacao) return;
    app.innerHTML = `<main class="tela-login"><section class="login">${marca()}
      <p class="erro" role="alert">${h(erro.message)}</p>${botao('Tentar novamente', 'recarregar-perfis')}</section></main>`;
  }
}

function pedirSenhaPerfil(perfil, cadastrar = false) {
  const titulo = cadastrar ? 'Autorizar novo perfil' : `Entrar como ${nomeExibicao(perfil)}`;
  const campos = (cadastrar ? `<p>Informe a senha do administrador ${h(perfil.nome)} para cadastrar um perfil.</p>` : '')
    + campo('senha', 'Senha', '', 'password', 'autocomplete="current-password" required autofocus');
  abrir(titulo, campos, async ({ senha }) => {
    try {
      await api('/api/login', { perfil: perfil.id, senha });
    } catch (erro) {
      if (erro.status === 401) throw new Error('Senha incorreta ou perfil indisponível.');
      throw erro;
    }
    usuario = await api('/api/sessao');
    perfilAberto = undefined; limparTelaFinanceira();
    janela.close();
    history.replaceState(null, '', cadastrar ? '#admin' : '#inicio');
    await carregar();
    if (cadastrar && !usuario.contatos_pendentes) formularioUsuario();
  }, cadastrar ? 'Continuar' : 'Entrar');
}

function senhaAtual(nome = 'senha_atual') {
  return campo(nome, nome === 'senha_admin' ? 'Senha do administrador global' : 'Sua senha atual', '', 'password', 'required autocomplete="current-password"');
}

function entrarComLogin() {
  abrir('Entrar', campo('login', 'Usuário', '', 'text', 'required autocomplete="username" maxlength="64"') + senhaAtual('senha'), async dados => {
    await api('/api/login', dados);
    usuario = await api('/api/sessao');
    janela.close(); history.replaceState(null, '', '#inicio'); await carregar();
  }, 'Entrar');
}

function cadastrarAcesso() {
  mostrarDadosCadastro({});
}

function mostrarDadosCadastro(dadosIniciais) {
  const comAjuda = (nome, rotulo, ajuda, maximo) => rotular(rotulo,
    `<input name="${nome}" type="text" required maxlength="${maximo}" aria-describedby="ajuda-${nome}"><small id="ajuda-${nome}">${ajuda}</small>`);
  const campos = comAjuda('nome', 'Nome', 'É o nome que será exibido no seu perfil.', 120)
    + comAjuda('login', 'Usuário', 'Será usado para entrar no sistema.', 64)
    + campo('senha', 'Senha pessoal', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"')
    + '<small>Use pelo menos 8 caracteres. Você pode usar uma frase.</small>'
    + campo('confirmacao_senha', 'Confirme sua senha pessoal', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"')
    + escolha('modo', 'Sua família', [{ id: 'criar', nome: 'Criar minha família' }, { id: 'depois', nome: 'Entrar em uma família depois' }], 'criar', { numeros: false })
    + comAjuda('familia_nome', 'Nome da família', 'É o nome do seu grupo.', 80)
    + '<p class="ajuda-cadastro" data-ajuda-familia hidden>Após entrar, vá a Minha família para informar o código e solicitar entrada no grupo.</p>'
    + '<small>Na próxima etapa, o administrador global confirmará o cadastro com a própria senha.</small>';
  abrir('Criar acesso individual', campos, async dados => {
    if (dados.senha !== dados.confirmacao_senha) throw new Error('As senhas não coincidem.');
    confirmarCadastro(dados);
  }, 'Continuar cadastro', form => {
    for (const nome of ['nome','login','senha','confirmacao_senha','modo','familia_nome']) {
      if (dadosIniciais[nome] !== undefined) form.elements[nome].value = dadosIniciais[nome];
    }
    const atualizar = () => {
      const criar = form.elements.modo.value === 'criar';
      const nomeFamilia = form.elements.familia_nome;
      nomeFamilia.disabled = !criar;
      nomeFamilia.required = criar;
      nomeFamilia.closest('label').hidden = !criar;
      form.querySelector('[data-ajuda-familia]').hidden = criar;
    };
    form.elements.modo.onchange = atualizar; atualizar();
  });
}

function confirmarCadastro(dadosCadastro) {
  const resumo = `<p>Confira os dados antes de concluir:</p><dl class="resumo-cadastro"><div><dt>Nome</dt><dd>${h(dadosCadastro.nome)}</dd></div>
    <div><dt>Usuário</dt><dd>${h(dadosCadastro.login)}</dd></div>
    <div><dt>Família</dt><dd>${dadosCadastro.modo === 'criar' ? h(dadosCadastro.familia_nome) : 'Escolher após entrar'}</dd></div></dl>`;
  abrir('Confirmar cadastro', resumo + '<p>Para concluir, o administrador global deve informar seu usuário e sua senha. O cadastro só será criado após essa autorização.</p>'
    + campo('admin_login', 'Usuário do administrador global', usuario?.admin ? usuario.login : '', 'text', 'required autocomplete="off"')
    + senhaAtual('senha_admin')
    + '<button type="button" class="botao" data-voltar-dados-cadastro>Voltar aos dados</button>', async autorizacao => {
      await api('/api/cadastro', { ...dadosCadastro, ...autorizacao });
      janela.close();
      mostrarAviso('Cadastro criado. Entre com seu usuário e senha pessoal.');
      if (!usuario) entrarComLogin(); else await carregar();
    }, 'Confirmar cadastro', form => {
      form.querySelector('[data-voltar-dados-cadastro]').onclick = () => {
        if (!form.dataset.enviando) mostrarDadosCadastro(dadosCadastro);
      };
    });
}

function pedirRecuperacao() {
  abrir('Recuperar acesso', '<p>O administrador verificará sua identidade fora do aplicativo, usando um contato já cadastrado.</p>' + textoCampo('login', 'Usuário', '', 64), async dados => {
    const resultado = await api('/api/recuperacao/solicitar', dados); janela.close();
    abrir('Solicitação registrada', `<p>${h(resultado.mensagem)}</p>${botao('Já recebi meu código', 'concluir-recuperacao')}`);
  }, 'Solicitar verificação');
}

function concluirRecuperacaoUI() {
  abrir('Definir nova senha', textoCampo('token', 'Código recebido após a verificação', '', 64)
    + campo('senha', 'Nova senha', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"')
    + campo('confirmacao_senha', 'Confirme a nova senha', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"'), async dados => {
      await api('/api/recuperacao/concluir', dados); janela.close(); await mostrarLogin(); mostrarAviso('Senha redefinida. Entre novamente.');
    }, 'Redefinir senha');
}

function liberarRecuperacaoUI(id) {
  const pedido = dadosPagina.recuperacoes.find(p => p.id === id);
  abrir('Verificar recuperação', `<p>Faça contato por um dos canais que já estavam cadastrados de ${h(pedido.nome)}. Confirme a identidade antes de continuar.</p>
    <p>${h(pedido.email)} · ${h(pedido.telefone)}</p>`
    + escolha('canal', 'Canal usado na verificação externa', [
      ...(pedido.email ? [{ id: 'email', nome: 'E-mail cadastrado' }] : []),
      ...(pedido.telefone ? [{ id: 'telefone', nome: 'Telefone cadastrado' }] : [])
    ], '', { numeros: false })
    + '<label class="confirmar-datas"><input name="identidade_confirmada" type="checkbox" required> Confirmei a identidade fora do aplicativo pelo canal já cadastrado.</label>'
    + senhaAtual(), async dados => {
      const resultado = await api('/api/admin/recuperacoes/liberar', { ...dados, id, identidade_confirmada: dados.identidade_confirmada === 'on' });
      // O código é mostrado uma vez e não vai para URL, armazenamento local ou logs.
      abrir('Código de recuperação', `<p>Entregue este código somente pelo canal verificado. Expira em 15 minutos e permite uma única redefinição.</p><p class="codigo-recuperacao">${h(resultado.token)}</p>`);
    }, 'Liberar código');
}

function painelConsentimento(grupo) {
  if (!grupo?.familia || grupo.familia.responsavel === usuario.id) return painel('Privacidade', '<p>Suas finanças são individuais. Solicitações de consulta do administrador aparecem em Notificações.</p>');
  return painel('Privacidade financeira', `<p>Acesso do responsável: <strong>${grupo.familia.consulta_por ? 'Somente consulta autorizada' : 'Desativado'}</strong>.</p>
    <p>Autorizar não permite pagamentos, alterações ou exclusões. Você pode revogar a consulta quando quiser.</p>`
    + botao(grupo.familia.consulta_por ? 'Revogar consulta do responsável' : 'Permitir consulta do responsável', 'grupo-autorizar'));
}

async function alterarConsentimento() {
  const grupo = await api('/api/grupo');
  const permitir = !grupo.familia?.consulta_por;
  abrir(permitir ? 'Permitir consulta' : 'Revogar consulta', '<p>Esta autorização vale somente para o responsável atual da sua família.</p>' + senhaAtual(),
    gravar('/api/grupo/consentimento', permitir ? 'Consulta autorizada.' : 'Consulta revogada.', { permitir }));
}

function notificacoesDeAcesso(dados) {
  if (!dados) return '';
  const agora = Date.now();
  const acessos = dados.acessos.filter(p => p.expira > agora && ['pendente','aprovado'].includes(p.estado));
  const entradas = dados.entradas.filter(p => p.estado === 'pendente' && p.expira > agora);
  return painel('Pedidos e autorizações', lista([
    ...acessos.map(p => linha(`<strong>${h(p.solicitante)}</strong><p>${h(p.justificativa)}</p><small>${p.estado === 'pendente' ? 'Solicita somente consulta por 24 horas após sua aprovação.' : 'Consulta autorizada até ' + horaBr(p.expira)}</small>`,
      p.estado === 'pendente' ? botao('Aceitar consulta', 'acesso-aprovar', p.id) + botao('Recusar', 'acesso-recusar', p.id) : botao('Revogar acesso', 'acesso-revogar', p.id))),
    ...entradas.map(p => linha(`<strong>${h(p.nome)}</strong><p>Solicita entrada em ${h(p.familia)}. Isso não compartilha finanças.</p>`, botao('Aprovar entrada', 'entrada-aprovar', p.id) + botao('Recusar', 'entrada-recusar', p.id)))
  ], 'Nenhum pedido ou autorização ativa.'));
}

function verFamilia(dados) {
  const familia = dados.familia;
  if (!familia) return painel('Sua família', `<p>Você ainda não pertence a uma família.</p>
    ${dados.pedido ? `<p>Último pedido: ${h(dados.pedido.familia)} · ${h(dados.pedido.estado)}${dados.pedido.expira <= Date.now() ? ' · expirado' : ''}</p>` : ''}
    <div class="acoes">${botao('Criar família', 'grupo-criar')}${botao('Solicitar entrada', 'grupo-entrar')}${dados.pedido?.estado === 'pendente' ? botao('Cancelar pedido', 'grupo-cancelar') : ''}</div>`);
  const responsavel = familia.responsavel === usuario.id;
  return painel(familia.nome, `<p>Os dados financeiros continuam individuais. Gerenciar integrantes não permite acessar suas finanças.</p>
    <p>Responsável: ${h(dados.membros.find(m => m.id === familia.responsavel)?.nome)}</p>
    ${responsavel ? `<p>Código para solicitar entrada:</p><p class="codigo-recuperacao">${h(familia.codigo)}</p>` : ''}
    ${tabela(['Integrante','Situação','Ações'], dados.membros.map(m => [h(m.nome_exibicao || m.nome), m.ativo ? 'Ativo' : 'Desativado', m.id === usuario.id ? 'Seu perfil' :
      (responsavel ? (m.autorizou_consulta && m.ativo ? botao('Consultar finanças', 'abrir-perfil', m.id) : 'Consulta não autorizada') + botao('Remover do grupo', 'familia-remover', m.id) + (m.ativo ? botao('Tornar responsável', 'familia-transferir', m.id) : '') : '')]), '')}
    <div class="acoes">${responsavel ? botao('Encerrar família', 'familia-encerrar', '', 'perigo') : botao('Sair da família', 'familia-sair')}</div>
    ${link('Gerenciar minha privacidade', 'perfil')}`) + notificacoesDeAcesso(dados);
}

function criarFamiliaUI() {
  abrir('Criar família', textoCampo('nome', 'Nome da família', '', 80) + textoCampo('admin_login', 'Usuário do administrador global', usuario.admin ? usuario.login : '', 64) + senhaAtual('senha_admin'),
    gravar('/api/grupo/criar', 'Família criada.'));
}
function solicitarEntradaUI() {
  abrir('Solicitar entrada', '<p>Peça o código ao responsável. Ele deverá aprovar seu pedido na própria conta.</p>' + textoCampo('codigo', 'Código da família', '', 32), gravar('/api/grupo/entrada', 'Pedido enviado ao responsável.'));
}
function decidirEntradaUI(id, decisao) {
  abrir(decisao === 'aprovado' ? 'Aprovar entrada' : 'Recusar entrada', '<p>Essa decisão trata somente da participação no grupo.</p>' + senhaAtual(), gravar(`/api/grupo/entradas/${id}`, 'Pedido analisado.', { decisao }));
}
function solicitarAcessoUI(id) {
  abrir('Solicitar consulta financeira', '<p>O usuário receberá um pedido. Somente após aceitar você terá consulta por 24 horas.</p>' + textoCampo('justificativa', 'Por que precisa consultar?', '', 500) + senhaAtual(), gravar('/api/acessos/solicitar', 'Solicitação enviada.', { usuario: id }));
}
function decidirAcessoUI(id, decisao) {
  abrir(decisao === 'aprovado' ? 'Autorizar consulta por 24 horas' : decisao === 'revogado' ? 'Revogar consulta' : 'Recusar consulta', '<p>A consulta não permite alterações. Você pode revogá-la antes do prazo.</p>' + senhaAtual(), gravar(`/api/acessos/${id}`, 'Permissão atualizada.', { decisao }));
}
function alterarFamiliaUI(acao, id) {
  const mensagens = {
    sair: 'Você sairá do grupo, mantendo sua conta e todos os seus dados financeiros.',
    remover: 'O integrante sairá do grupo. A conta e as finanças dele serão preservadas.',
    transferir: 'A responsabilidade será transferida. Consentimentos serão revogados, pedidos pendentes cancelados e o código da família será trocado.',
    encerrar: 'O grupo será encerrado. Todas as contas individuais e seus dados financeiros serão preservados.'
  };
  abrir('Alterar família', `<p>${mensagens[acao]}</p>` + senhaAtual(), gravar('/api/grupo/' + acao, 'Família atualizada.', { usuario: id, confirmar: true }));
}
async function selecionarFamiliaUI() {
  if (janela.open) janela.close();
  if (location.hash === '#perfis-familia') await carregar();
  else location.hash = 'perfis-familia';
}

async function exibirPaginaPerfisFamilia(passagem) {
  if (janela.open) janela.close();
  perfilAberto = undefined;
  limparTelaFinanceira();
  app.innerHTML = '<p class="carregando" role="status">Carregando os perfis da sua família…</p>';
  try {
    const dados = await api('/api/perfis');
    if (passagem !== navegacao) return;
    perfis = dados.perfis;
    aplicarPreferencias(usuario);
    app.innerHTML = `<main class="tela-login tela-perfis"><section class="seletor-perfis seletor-familia">
      ${marca()}<h1 tabindex="-1">Perfis da sua família</h1>
      <p>Escolha um perfil para entrar. Cada integrante usa a própria senha.</p>
      <div class="perfis-grade">${perfis.map(cartaoPerfil).join('')}</div>
      <div class="acoes"><a class="botao" href="#inicio">Voltar ao meu perfil</a>${botao('Sair', 'sair')}</div>
    </section></main>`;
    app.querySelector('h1').focus({ preventScroll: true });
  } catch (erro) {
    if (passagem !== navegacao) return;
    if (erro.status === 401) { await mostrarLogin(); return; }
    app.innerHTML = `<main class="tela-login"><section class="login">${marca()}<h1>Perfis da sua família</h1>
      <p class="erro" role="alert">${h(erro.message)}</p>
      ${botao('Tentar novamente', 'selecionar-familia')}<a class="botao" href="#inicio">Voltar ao meu perfil</a>
    </section></main>`;
  }
}

const estadosSenha = { pendente: 'Aguardando aprovação', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada por redefinição administrativa' };

function camposContatos() {
  const canais = [['avisos_email','E-mail'],['avisos_whatsapp','WhatsApp'],['avisos_sms','SMS']];
  return campo('email', 'E-mail', usuario.email ?? '', 'email', 'required maxlength="254" autocomplete="email"')
    + campo('telefone', 'Telefone com DDD', usuario.telefone ?? '', 'tel', 'required maxlength="40" autocomplete="tel" placeholder="(11) 99999-9999"')
    + `<fieldset class="canais-contato"><legend>Quero receber avisos por</legend>
      ${canais.map(([id, nome]) => `<label><input type="checkbox" name="${id}" ${usuario[id] ? 'checked' : ''}>${nome}</label>`).join('')}
      <small>E-mail, WhatsApp e SMS aguardam a configuração dos serviços de envio. As opções acima registram sua preferência.</small>
    </fieldset>`;
}

function completarCadastro() {
  if (janela.open) janela.close();
  app.innerHTML = `<main class="tela-login"><section class="login">
    ${marca()}<h1>Complete seu cadastro</h1>
    <p>Informe seu e-mail e telefone para cadastrar os contatos e escolher como deseja receber avisos sobre contas e vencimentos.</p>
    <form class="cadastro-contatos">${camposContatos()}<p class="erro" role="alert"></p>
      <button type="submit" class="botao principal">Salvar e continuar</button>
      ${botao('Trocar perfil', 'sair')}
    </form>
  </section></main>`;
  const formulario = app.querySelector('form');
  formulario.onsubmit = async evento => {
    evento.preventDefault();
    if (formulario.dataset.enviando) return;
    const enviar = formulario.querySelector('[type=submit]');
    try {
      formulario.dataset.enviando = '1';
      enviar.disabled = true;
      formulario.querySelector('.erro').textContent = '';
      await api('/api/perfil/contatos', lerFormulario(formulario));
      usuario = await api('/api/sessao');
      history.replaceState(null, '', '#notificacoes');
      mostrarAviso('Contatos cadastrados. Ative as notificações neste dispositivo.');
      await carregar();
    } catch (erro) {
      if (erro.status === 401) await mostrarLogin();
      else formulario.querySelector('.erro').textContent = erro.message;
    } finally {
      enviar.disabled = false;
      delete formulario.dataset.enviando;
    }
  };
}

function montarMeuPerfil({ solicitacoes }, destino) {
  let pendente = solicitacoes.some(item => item.estado === 'pendente');
  let secao = 'dados';
  const historico = solicitacoes.length ? `<details><summary>Minhas solicitações de senha</summary>
    ${solicitacoes.map(item => `<p>${h(estadosSenha[item.estado])} · ${horaBr(item.criada_em)}</p>`).join('')}</details>` : '';
  const dadosPerfil = textoCampo('nome', 'Nome do perfil', usuario.nome)
    + textoCampo('login', 'Usuário', usuario.login, 64)
    + '<small>Use de 3 a 64 caracteres no usuário, com letras sem acento, números, ponto, hífen ou sublinhado.</small>'
    + camposContatos()
    + campo('senha_atual', 'Senha atual', '', 'password', 'required autocomplete="current-password"')
    + '<button type="button" class="botao" data-secao-perfil="senha">Solicitar troca de senha</button>';
  const trocaSenha = campo('senha_atual', 'Senha atual', '', 'password', 'required autocomplete="current-password"')
    + campo('senha', 'Nova senha', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"')
    + campo('confirmacao_senha', 'Confirmar nova senha', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"')
    + rotular('Justificativa', '<textarea name="justificativa" required maxlength="1000" rows="3"></textarea>')
    + '<p class="suave">Sua senha atual continua válida até a aprovação. Ao aprovar, o administrador encerra suas sessões e você entra com a nova senha.</p>';
  const escolhas = (campo, titulo) => `<fieldset class="opcoes-aparencia"><legend>${titulo}</legend>${opcoesPreferencias[campo].map(item => `<label><input type="radio" name="${campo}" value="${item.id}" ${(usuario[campo] || opcoesPreferencias[campo][0].id) === item.id ? 'checked' : ''}><span>${item.nome}</span></label>`).join('')}</fieldset>`;
  const aparencia = `<div class="previa-perfil" data-previa-perfil>${avatarPerfil(usuario)}<strong>${h(nomeExibicao(usuario))}</strong><small>Prévia das suas escolhas</small><button type="button" class="botao primaria" disabled>Botão de exemplo</button></div>
    ${campo('nome_exibicao', 'Nome de exibição (opcional)', usuario.nome_exibicao ?? '', 'text', 'maxlength="60"')}
    <small>Seu nome de exibição e sua imagem aparecem na seleção de perfis.</small>
    ${[...new Set(avataresPerfil.map(item => item.grupo))].map(grupo => `<fieldset class="opcoes-aparencia"><legend>${grupo}</legend>
      ${avataresPerfil.filter(item => item.grupo === grupo).map(item => `<label><input type="radio" name="avatar" value="${item.id}" ${(usuario.avatar || 'iniciais') === item.id ? 'checked' : ''}><span>${item.simbolo || h(iniciais(nomeExibicao(usuario)))}<small>${item.nome}</small></span></label>`).join('')}</fieldset>`).join('')}
    ${escolhas('formato_avatar', 'Formato do avatar')}
    ${campo('tema', '', usuario.tema, 'hidden')}
    ${escolhas('tamanho_texto', 'Tamanho do texto')}
    ${escolhas('espacamento', 'Espaçamento')}
    <fieldset class="opcoes-aparencia"><legend>Tema de cores</legend>
      ${coresPerfil.map(item => `<label><input type="radio" name="cor_perfil" value="${item.id}" ${(usuario.cor_perfil || 'verde') === item.id ? 'checked' : ''}>
        <span><span class="amostra-cor cor-perfil-${item.id}" aria-hidden="true"></span><small>${item.nome}</small></span></label>`).join('')}
    </fieldset>
    ${rotular('Foto (opcional)', '<input type="file" accept="image/jpeg,image/png,image/webp" data-foto-perfil>')}
    <section class="editor-recorte" data-recorte-foto hidden aria-label="Enquadrar foto do perfil">
      <p id="instrucao-recorte">Arraste a foto dentro do quadrado ou ajuste os controles para escolher a parte que aparecerá no perfil.</p>
      <canvas width="320" height="320" data-previa-recorte role="img" aria-label="Prévia do recorte quadrado" aria-describedby="instrucao-recorte"></canvas>
      <label class="campo">Zoom<input type="range" min="1" max="4" step="0.01" value="1" data-recorte-zoom></label>
      <label class="campo">Posição horizontal<input type="range" min="0" max="100" step="1" value="50" data-recorte-x></label>
      <label class="campo">Posição vertical<input type="range" min="0" max="100" step="1" value="50" data-recorte-y></label>
      <div class="acoes"><button type="button" class="botao principal" data-usar-recorte>Usar este recorte</button><button type="button" class="botao" data-cancelar-recorte>Cancelar ajuste</button></div>
    </section>
    ${campo('foto_avatar', '', usuario.foto_avatar ?? '', 'hidden')}
    <small>Escolha JPEG, PNG ou WebP de até 8 MB e ajuste o recorte quadrado. Depois, salve a aparência para confirmar.</small>
    <div class="acoes"><button type="button" class="botao" data-remover-foto>Remover foto</button>
      <button type="button" class="botao" data-restaurar-aparencia>Restaurar aparência padrão</button></div>
    <p class="erro-foto" role="alert" data-erro-foto></p>`;
  const campos = `<nav class="navegacao-perfil" aria-label="Configurações do perfil">
      <button type="button" class="botao" data-secao-perfil="dados" aria-pressed="true">Dados do perfil</button>
      <button type="button" class="botao" data-secao-perfil="aparencia" aria-pressed="false">Aparência</button>
      <button type="button" class="botao" data-secao-perfil="senha" aria-pressed="false">Troca de senha</button>
    </nav>
    <fieldset class="secao-perfil" data-painel-perfil="dados"><legend>Dados e contatos</legend>${dadosPerfil}</fieldset>
    <fieldset class="secao-perfil" data-painel-perfil="aparencia" hidden disabled><legend>Sua identidade no app</legend>${aparencia}</fieldset>
    <fieldset class="secao-perfil" data-painel-perfil="senha" hidden disabled><legend>Solicitação ao administrador</legend>
      ${pendente ? '<p class="suave">Sua solicitação está aguardando a análise do administrador.</p>' : trocaSenha}
      ${historico}
    </fieldset>`;
  abrir('Meu perfil', campos, async (dados, formulario) => {
    if (secao === 'senha') {
      if (pendente) return;
      if (dados.senha !== dados.confirmacao_senha) {
        throw new Error('As senhas não coincidem. Digite a mesma nova senha nos dois campos.');
      }
      await api('/api/perfil/solicitacoes-senha', dados);
      pendente = true;
      formulario.querySelector('[data-painel-perfil="senha"]').innerHTML =
        '<legend>Solicitação ao administrador</legend><p role="status">Solicitação enviada. Aguarde a aprovação do administrador.</p>';
      formulario.querySelector('[type=submit]').hidden = true;
      mostrarAviso('Solicitação enviada ao administrador.');
      return;
    }
    if (secao === 'aparencia') {
      if (formulario.dataset.processandoFoto) throw new Error(formulario.dataset.processandoFoto === 'recorte' ? 'Use o recorte escolhido ou cancele o ajuste antes de salvar.' : 'Aguarde o processamento da foto.');
      await api('/api/perfil/aparencia', dados);
      usuario = await api('/api/sessao');
      janela.close();
      mostrarAviso('Aparência atualizada.');
      await carregar();
      return;
    }
    await api('/api/perfil', dados);
    usuario = await api('/api/sessao');
    janela.close();
    mostrarAviso('Perfil atualizado.');
    await carregar();
  }, 'Salvar dados', formulario => {
    vincularAparencia(formulario);
    const enviar = formulario.querySelector('[type=submit]');
    for (const botaoSecao of formulario.querySelectorAll('[data-secao-perfil]')) {
      botaoSecao.addEventListener('click', () => {
        if (formulario.dataset.enviando) return;
        secao = botaoSecao.dataset.secaoPerfil;
        for (const painel of formulario.querySelectorAll('[data-painel-perfil]')) {
          painel.hidden = painel.disabled = painel.dataset.painelPerfil !== secao;
        }
        for (const botao of formulario.querySelectorAll('.navegacao-perfil button')) {
          botao.setAttribute('aria-pressed', String(botao.dataset.secaoPerfil === secao));
        }
        enviar.textContent = secao === 'senha' ? 'Enviar solicitação' : secao === 'aparencia' ? 'Salvar aparência' : 'Salvar dados';
        enviar.hidden = secao === 'senha' && pendente;
        enviar.title = secao === 'senha' ? 'Envia a troca de senha para análise do administrador.' : 'Salva as alterações desta seção.';
        formulario.querySelector('footer').previousElementSibling.textContent = '';
        formulario.querySelector(`[data-painel-perfil="${secao}"] input`)?.focus();
      });
    }
  }, undefined, destino);
}

function verMeuPerfil(dados) {
  return `<section class="painel editor-perfil" data-editor-perfil></section>
    ${painelConsentimento(dados.grupo)}
    <section class="painel acoes-definitivas">
      <h2>Dados e conta</h2>
      <div><h3>Limpar dados financeiros</h3>
        <p>Apaga contas financeiras, reservas, investimentos, categorias, lançamentos, períodos, cartões, faturas e compromissos deste perfil. As inscrições de notificações também serão removidas.</p>
        <p>Seu acesso, contatos e aparência serão mantidos.</p>
        ${botao('Limpar dados financeiros', 'limpar-meus-dados', '', 'perigo')}
      </div>
      <div><h3>Excluir minha conta</h3>
        <p>Apaga os dados financeiros, os dados pessoais, as solicitações de senha e o perfil. O acesso e as notificações deste perfil serão encerrados.</p>
        ${botao('Excluir minha conta', 'excluir-minha-conta', '', 'perigo')}
      </div>
    </section>`;
}

function confirmarRemocaoPerfil(excluirConta) {
  const titulo = excluirConta ? 'Excluir minha conta' : 'Limpar dados financeiros';
  const explicacao = excluirConta
    ? 'Seu perfil, dados pessoais e todos os registros financeiros serão apagados. Você será desconectado e o perfil sairá da seleção de usuários.'
    : 'Todas as contas financeiras, categorias, lançamentos, períodos, cartões, faturas e compromissos serão apagados. Você precisará cadastrar os saldos iniciais e ativar as notificações novamente.';
  const campos = `<p><strong>${h(nomeExibicao(usuario))}</strong></p>
    <p class="sinal saida">${explicacao}</p>
    <p>Esta ação é definitiva.</p>
    ${campo('senha', 'Senha atual', '', 'password', 'required autocomplete="current-password"')}
    <label class="confirmar-datas"><input type="checkbox" name="confirmar" required>
      Entendi quais dados do meu perfil serão apagados e quero continuar.
    </label>`;
  abrir(titulo, campos, async dados => {
    await api(excluirConta ? '/api/perfil/excluir-conta' : '/api/perfil/limpar-dados', {
      ...dados, confirmar: dados.confirmar === 'on'
    });
    janela.close();
    limparTelaFinanceira();
    if (excluirConta) {
      await mostrarLogin();
      mostrarAviso('Conta excluída.');
    } else {
      usuario = await api('/api/sessao');
      mostrarAviso('Dados financeiros apagados. Seu perfil foi mantido.');
      await carregar();
    }
  }, titulo);
}

function vincularAparencia(formulario) {
  const painel = formulario.querySelector('[data-painel-perfil="aparencia"]');
  const foto = formulario.elements.foto_avatar;
  const arquivo = painel.querySelector('[data-foto-perfil]');
  const erro = painel.querySelector('[data-erro-foto]');
  const previa = () => {
    const perfil = { ...usuario, nome_exibicao: formulario.elements.nome_exibicao.value.trim(),
      avatar: formulario.elements.avatar.value, cor_perfil: formulario.elements.cor_perfil.value, foto_avatar: foto.value, ...Object.fromEntries(Object.keys(opcoesPreferencias).map(campo => [campo, formulario.elements[campo].value])) };
    const amostra = painel.querySelector('[data-previa-perfil]');
    aplicarPreferencias(perfil, amostra);
    amostra.innerHTML = avatarPerfil(perfil) + `<strong>${h(nomeExibicao(perfil))}</strong><small>Prévia das suas escolhas</small><span class="botao primaria">Botão de exemplo</span>`;
    painel.querySelector('[data-remover-foto]').disabled = !foto.value;
  };
  let alteracao = 0;
  let bitmapAtual;
  let arraste;
  const editor = painel.querySelector('[data-recorte-foto]');
  const canvasPrevia = editor.querySelector('[data-previa-recorte]');
  const zoom = editor.querySelector('[data-recorte-zoom]');
  const eixoX = editor.querySelector('[data-recorte-x]');
  const eixoY = editor.querySelector('[data-recorte-y]');
  const limites = () => {
    const lado = Math.min(bitmapAtual.width, bitmapAtual.height) / Number(zoom.value);
    return { lado, x: (bitmapAtual.width - lado) * Number(eixoX.value) / 100,
      y: (bitmapAtual.height - lado) * Number(eixoY.value) / 100 };
  };
  const desenhar = (canvas, tamanho) => {
    const { lado, x, y } = limites();
    const contexto = canvas.getContext('2d');
    contexto.fillStyle = '#ffffff';
    contexto.fillRect(0, 0, tamanho, tamanho);
    contexto.drawImage(bitmapAtual, x, y, lado, lado, 0, 0, tamanho, tamanho);
  };
  const atualizarRecorte = () => {
    if (!bitmapAtual) return;
    desenhar(canvasPrevia, canvasPrevia.width);
    const { lado } = limites();
    eixoX.disabled = bitmapAtual.width - lado < .01;
    eixoY.disabled = bitmapAtual.height - lado < .01;
  };
  const fecharRecorte = () => {
    ++alteracao;
    arraste = undefined;
    bitmapAtual?.close();
    bitmapAtual = undefined;
    editor.hidden = true;
    arquivo.value = '';
    delete formulario.dataset.processandoFoto;
  };
  const descarte = new MutationObserver(() => {
    if (!formulario.isConnected) { fecharRecorte(); descarte.disconnect(); }
  });
  descarte.observe(document.body, { childList: true, subtree: true });
  for (const controle of [zoom, eixoX, eixoY]) controle.addEventListener('input', atualizarRecorte);
  canvasPrevia.addEventListener('pointerdown', evento => {
    if (!bitmapAtual || (evento.pointerType === 'mouse' && evento.button !== 0)) return;
    arraste = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, horizontal: Number(eixoX.value), vertical: Number(eixoY.value) };
    canvasPrevia.setPointerCapture(evento.pointerId);
  });
  canvasPrevia.addEventListener('pointermove', evento => {
    if (!bitmapAtual || arraste?.id !== evento.pointerId) return;
    const { lado } = limites();
    const escala = lado / canvasPrevia.getBoundingClientRect().width;
    const mover = (controle, origem, diferenca, tamanho) => {
      if (tamanho > .01) controle.value = Math.min(100, Math.max(0, origem - diferenca * escala / tamanho * 100));
    };
    mover(eixoX, arraste.horizontal, evento.clientX - arraste.x, bitmapAtual.width - lado);
    mover(eixoY, arraste.vertical, evento.clientY - arraste.y, bitmapAtual.height - lado);
    atualizarRecorte();
  });
  for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) canvasPrevia.addEventListener(tipo, () => { arraste = undefined; });
  editor.querySelector('[data-cancelar-recorte]').onclick = () => { fecharRecorte(); erro.textContent = ''; };
  editor.querySelector('[data-usar-recorte]').onclick = () => {
    if (!bitmapAtual) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      desenhar(canvas, 128);
      let miniatura;
      for (const qualidade of [.85, .65, .45, .25]) {
        miniatura = canvas.toDataURL('image/jpeg', qualidade);
        if (miniatura.length <= 13680) break;
      }
      if (miniatura.length > 13680) throw new Error('Escolha um recorte com menos detalhes para gerar o avatar.');
      foto.value = miniatura;
      fecharRecorte();
      erro.textContent = '';
      previa();
    } catch (falha) { erro.textContent = falha.message || 'Não foi possível recortar essa foto.'; }
  };
  painel.addEventListener('input', evento => {
    if (evento.target.name === 'avatar') { fecharRecorte(); foto.value = ''; }
    previa();
  });
  painel.querySelector('[data-remover-foto]').onclick = () => {
    fecharRecorte(); foto.value = ''; erro.textContent = ''; previa();
  };
  painel.querySelector('[data-restaurar-aparencia]').onclick = () => {
    fecharRecorte();
    foto.value = formulario.elements.nome_exibicao.value = '';
    formulario.elements.avatar.value = 'iniciais';
    formulario.elements.cor_perfil.value = 'verde';
    for (const [campo, opcoes] of Object.entries(opcoesPreferencias)) formulario.elements[campo].value = opcoes[0].id;
    erro.textContent = ''; previa();
  };
  arquivo.onchange = async () => {
    const imagem = arquivo.files[0];
    if (!imagem) return;
    fecharRecorte();
    const numero = alteracao;
    formulario.dataset.processandoFoto = 'carregando';
    erro.textContent = '';
    try {
      if (!['image/jpeg','image/png','image/webp'].includes(imagem.type) || imagem.size > 8 * 1024 * 1024) {
        throw new Error('Escolha uma imagem JPEG, PNG ou WebP de até 8 MB.');
      }
      const bitmap = await createImageBitmap(imagem);
      if (numero !== alteracao || !formulario.isConnected) { bitmap.close(); return; }
      bitmapAtual = bitmap;
      zoom.value = '1'; eixoX.value = eixoY.value = '50';
      editor.hidden = false;
      formulario.dataset.processandoFoto = 'recorte';
      atualizarRecorte();
      editor.scrollIntoView({ block: 'nearest' });
      zoom.focus({ preventScroll: true });
    } catch (falha) {
      if (numero === alteracao) { fecharRecorte(); erro.textContent = falha.message || 'Não foi possível abrir essa imagem.'; }
    }
  };
  previa();
}

function analisarSenha(id, decisao) {
  const pedido = dadosPagina.solicitacoes_senha.find(item => item.id === id);
  const titulo = decisao === 'aprovada' ? 'Aprovar troca de senha' : 'Recusar troca de senha';
  abrir(titulo, `<p><strong>${h(pedido.nome)} · ${h(pedido.login)}</strong></p>
    <p class="justificativa-senha">${h(pedido.justificativa)}</p>
    <p>${decisao === 'aprovada' ? 'A nova senha será aplicada e as sessões desse usuário serão encerradas.' : 'A solicitação será encerrada e o usuário poderá enviar outra.'}</p>`
    + campo('senha_atual', 'Sua senha de administrador', '', 'password', 'required autocomplete="current-password"'),
    gravar(`/api/admin/solicitacoes-senha/${id}`, 'Solicitação analisada.', { decisao }), titulo);
}

function formularioUsuario(item, primeiro = false) {
  const titulo = primeiro ? 'Criar administrador' : item ? `Editar ${item.nome}` : 'Adicionar perfil';
  const obrigatoria = item ? '' : 'required';
  let campos = textoCampo('nome', 'Nome do perfil', item?.nome)
    + textoCampo('login', 'Usuário', item?.login, 64)
    + (item && item.id !== usuario.id ? '' : campo('senha', item ? 'Nova senha (opcional)' : 'Senha', '', 'password',
      `minlength="8" maxlength="128" autocomplete="new-password" ${obrigatoria}`))
    + (item && item.id !== usuario.id ? '<small>Para recuperar a senha deste perfil, use a verificação de identidade no painel de recuperação.</small>' : item ? '<small>Deixe a nova senha vazia para manter a senha atual e salvar as demais alterações. Ao redefinir a senha, as outras sessões desse perfil serão encerradas.</small>'
      : '<small>Use pelo menos 8 caracteres na senha.</small>');
  if (!primeiro) campos += senhaAtual('senha_admin');
  if (primeiro) {
    abrir(titulo, campos, async dados => {
      await api('/api/perfis/inicializar', dados);
      await mostrarLogin();
      mostrarAviso('Administrador criado. Selecione seu perfil para entrar.');
    }, 'Criar administrador');
  } else {
    const rota = item ? '/api/admin/usuarios/editar' : '/api/admin/usuarios';
    abrir(titulo, campos, async dados => {
      await api(rota, { ...dados, id: item?.id });
      if (item?.id === usuario.id) usuario = await api('/api/sessao');
      janela.close();
      mostrarAviso(item ? 'Perfil atualizado.' : 'Perfil cadastrado.');
      await carregar();
    });
  }
}

function filtroPeriodos() {
  return escolha('periodo', 'Período salarial', periodos.map(periodo => ({
    id: periodo.id, nome: `${dataBr(periodo.inicio)} a ${periodo.fim ? dataBr(periodo.fim) : 'hoje'}`
  })), filtros[aba].periodo, { opcional: true, numeros: false, vazio: 'Personalizado' });
}

function intervalo() {
  return `${filtroPeriodos()}${campo('inicio', 'De', filtros[aba].inicio, 'date')}
    ${campo('fim', 'Até', filtros[aba].fim, 'date')}`;
}

function avisoVencimento(item) {
  const dias = (Date.parse(item.vencimento) - Date.parse(base.hoje)) / 86_400_000;
  const preenchidos = Math.min(5, Math.max(0, 6 - dias));
  let cor = dias > 3 ? 'entrada' : 'pendente';
  let situacao = dias === 1 ? 'Falta 1 dia' : `Faltam ${dias} dias`;
  if (dias === 0) {
    cor = 'transferencia';
    situacao = 'Vence hoje';
  } else if (dias < 0) {
    cor = 'saida';
    situacao = dias === -1 ? 'Atrasado há 1 dia' : `Atrasado há ${-dias} dias`;
  }
  const quadrados = Array.from({ length: 5 }, (_, indice) =>
    `<span class="prazo-dia${indice < preenchidos ? ' preenchido' : ''}"></span>`).join('');
  return linha(
    `<strong>${comIcone(item.tipo === 'fatura' ? 'credit_card' : 'calendar_month', h(item.nome))}</strong>
    <div class="aviso-prazo">
      <span class="prazo-dias sinal ${cor}" aria-hidden="true">${quadrados}</span>
      ${seloSituacao(`${situacao} · ${dataBr(item.vencimento)}`, cor)}
    </div>`,
    `${valorColorido(item.valor, cor)}${botao('Abrir', item.tipo === 'fatura' ? 'fatura' : 'ocorrencia', item.id)}`
  );
}

function orcamentoDoPeriodo({ entradas, saidas, previsao }) {
  const comprometido = saidas + previsao.valor;
  const restante = entradas - comprometido;
  const rotulo = restante < 0 ? 'Falta para cobrir os gastos' : 'Saldo não comprometido';
  const resumo = entradas > 0
    ? `${percentual.format(comprometido / entradas)} de ${dinheiro(entradas)} em entradas comprometidas`
    : 'Nenhuma entrada registrada no período';
  return `<section class="painel orcamento" aria-labelledby="orcamento-titulo">
    <div class="linha orcamento-cabecalho">
      <div>
        <h2 id="orcamento-titulo">${rotulo}</h2>
        <strong class="orcamento-valor valor sinal ${restante < 0 ? 'saida' : 'entrada'}">${dinheiro(Math.abs(restante))}</strong>
      </div>
      <div class="orcamento-resumo">
        <small>${restante < 0 ? 'Saídas e gastos previstos acima das entradas.' : 'Entradas menos saídas e gastos previstos.'}</small>
        <small>${resumo}</small>
      </div>
    </div>
    <div class="orcamento-soma">
      <button type="button" class="botao sinal pendente" data-acao="detalhar-previsao" aria-haspopup="dialog"
        title="Veja quais cobranças compõem o valor previsto.">
        ${comIcone('calendar_month', 'Gastos previstos do período')} <strong class="valor">${dinheiro(previsao.valor)}</strong>
      </button>
      <span class="orcamento-parcela">+
        <button type="button" class="botao sinal saida" data-acao="detalhar-saidas" aria-haspopup="dialog"
          title="Veja quais lançamentos compõem as saídas do período.">
          ${comIcone('arrow_upward', 'Saídas do período')} <strong class="valor">${dinheiro(saidas)}</strong>
        </button>
      </span>
      <span class="orcamento-parcela">=
        <span class="orcamento-total">Total comprometido <strong class="valor">${dinheiro(comprometido)}</strong></span>
      </span>
    </div>
    <div class="orcamento-barra${entradas === 0 ? ' sem-entradas' : ''}" aria-hidden="true">
      <progress class="orcamento-pago" value="${Math.min(comprometido, entradas)}" max="${Math.max(entradas, 1)}"></progress>
      <progress class="orcamento-previsto" value="${Math.min(previsao.valor, entradas)}" max="${Math.max(entradas, 1)}"></progress>
    </div>
    <small>Previsão de ${dataBr(previsao.inicio)} a ${dataBr(previsao.fim)}.</small>
  </section>`;
}

function verPainel(dados) {
  const periodo = `Período atual desde ${dataBr(dados.periodo.inicio)}`;
  const contas = contasBancarias();
  const destaque = contas.find(conta => conta.id === dados.conta_destaque) ?? contas[0];
  const saldos = `<div class="saldo-painel">
    <div class="metrica destaque">
      <div class="linha">
        <small class="com-icone">${destaque ? iconeBanco(identificarBanco(destaque)) : icone('account_balance')}
          Saldo disponível${destaque ? ` · ${h(destaque.nome)}` : ''}</small>
        ${!perfilAberto && contas.length > 1 ? '<button type="button" class="trocar-destaque" data-acao="conta-destaque" title="Escolha qual saldo aparece em destaque.">Trocar conta</button>' : ''}
      </div>
      ${destaque ? `<strong class="valor">${dinheiro(destaque.saldo)}</strong>` : '<small>Cadastre uma conta para ver o saldo.</small>'}
    </div>
    <div class="total-contas linha"><small>Total das contas</small><strong class="valor">${dinheiro(dados.disponivel)}</strong></div>
  </div>`;
  const alertas = dados.pendencias.length ? lista(dados.pendencias.map(avisoVencimento), '')
    : `<p class="vazio">${comIcone('check_circle', 'Nenhum pagamento vencido ou a vencer nos próximos cinco dias.')}</p>`;
  const recentes = lista(dados.recentes.map(item => linha(
    `<strong>${comIcone(iconesMovimentos[item.tipo], h(item.descricao))}</strong>${subtitulo(`${dataBr(item.data)} · ${rotuloMovimento(item)}`)}`,
    valorMovimento(item)
  )), 'Os lançamentos aparecerão aqui.');
  return `<header class="cabecalho cabecalho-inicio"><div><h1>Visão geral</h1><p class="suave">${periodo}</p></div>
      ${botao('Adicionar despesa', 'movimento', 'despesa', 'sinal saida')}</header>
    <div class="resumo-financeiro">${saldos}${orcamentoDoPeriodo(dados)}</div>
    ${painel('Vencimentos e atrasos', alertas, link('Compromissos', 'compromissos'), 'calendar_month')}
    <div class="acoes">${botao('Adicionar salário', 'salario', '', 'sinal entrada')}${botao('Adicionar renda extra', 'movimento', 'renda', 'sinal entrada')}
      ${botao('Transferir', 'movimento', 'transferencia', 'sinal transferencia')}${botao('Compra no cartão', 'compra', '', 'sinal saida')}</div>
    <div class="colunas">
      ${metrica('Entradas do período', dados.entradas, 'sinal entrada', 'arrow_downward')}
      ${metricaComDetalhes('Saídas do período', dados.saidas, 'arrow_upward', 'detalhar-saidas', '', 'sinal saida')}
    </div>
    <div class="colunas">
      <div class="patrimonio-painel">
        ${metricaComDetalhes('Reserva', dados.reserva, 'savings', 'detalhar-patrimonio', 'reserva')}
        ${metricaComDetalhes('Investimentos', dados.investimentos, 'trending_up', 'detalhar-patrimonio', 'investimento')}
        <div class="total-contas linha"><small>Total de reservas e investimentos</small><strong class="valor">${dinheiro(dados.reserva + dados.investimentos)}</strong></div>
      </div>
      ${painel('Movimentações recentes', recentes, link('Histórico', 'historico'), 'history')}
    </div>`;
}

function detalharPrevisao() {
  const { inicio, fim, itens, valor } = dadosPagina.previsao;
  const linhas = itens.map(item => [
    dataBr(item.vencimento),
    `${h(item.nome)}${item.tipo === 'recorrencia-cartao' ? '<br><small>Prevista no cartão</small>' : ''}`,
    valorColorido(item.valor, 'pendente')
  ]);
  abrir('Gastos previstos do período', `
    <p class="suave">De ${dataBr(inicio)} a ${dataBr(fim)}</p>
    ${tabela(['Vencimento', 'Cobrança', 'Valor'], linhas, 'Nenhuma cobrança a pagar neste período.')}
    <div class="linha"><strong>Total previsto</strong><strong class="valor">${dinheiro(valor)}</strong></div>`);
}

function detalharSaidas() {
  const linhas = dadosPagina.saidas_detalhadas.map(item => [
    dataBr(item.data),
    `${h(item.descricao)}<br>${subtitulo(item.fatura ? `${item.categoria} · ${item.fatura}` : item.categoria)}`,
    valorColorido(item.valor, 'saida')
  ]);
  abrir('Saídas do período', `
    <p class="suave">De ${dataBr(dadosPagina.periodo.inicio)} a ${dataBr(base.hoje)}</p>
    ${tabela(['Data do pagamento', 'Lançamento', 'Valor'], linhas, 'Nenhuma saída registrada neste período.')}
    <div class="linha"><strong>Total das saídas</strong><strong class="valor">${dinheiro(dadosPagina.saidas)}</strong></div>`);
}

function detalharPatrimonio(tipo) {
  const titulo = tipo === 'reserva' ? 'Reserva' : 'Investimentos';
  const contas = base.contas.filter(conta => conta.tipo === tipo);
  const linhas = contas.map(conta => [nomeComBanco(conta), `<strong class="valor">${dinheiro(conta.saldo)}</strong>`]);
  const total = contas.reduce((soma, conta) => soma + conta.saldo, 0);
  const mensagem = tipo === 'reserva' ? 'Nenhuma reserva cadastrada.' : 'Nenhum investimento cadastrado.';
  abrir(titulo, `
    ${tabela(['Conta', 'Saldo'], linhas, mensagem)}
    <div class="linha"><strong>Total</strong><strong class="valor">${dinheiro(total)}</strong></div>`);
}

function verContas() {
  const contas = base.contas.map(item => `<li class="linha conta-na-lista">
    <div>
      <button type="button" class="editar-conta" data-acao="editar-conta" data-id="${item.id}" aria-haspopup="dialog"
      title="Editar ${h(item.nome)}">
        ${nomeComBanco(item)}
      </button>
      ${subtitulo(`${rotulos[item.tipo]} · abertura em ${dataBr(item.inicio)}`)}
    </div>
    <strong class="valor">${dinheiro(item.saldo)}</strong>
  </li>`);
  const categorias = base.categorias.map(item => linha(h(item.nome),
    botao('Editar', 'editar-categoria', item.id) + botao('Excluir', 'excluir-categoria', item.id, 'perigo')));
  return `<div class="acoes">${botao('Nova conta', 'conta', 'conta', 'principal')}${botao('Nova reserva', 'conta', 'reserva')}
    ${botao('Novo investimento', 'conta', 'investimento')}${botao('Aportar', 'patrimonio', 'aporte')}${botao('Resgatar', 'patrimonio', 'resgate')}</div>
    ${painel('Saldos por conta', lista(contas, 'Cadastre uma conta para começar.'))}
    ${painel('Categorias', lista(categorias, 'Cadastre uma categoria para classificar seus gastos.'), botao('Nova categoria', 'categoria'))}`;
}

function formularioCategoria(item) {
  const caminho = item ? `/api/categorias/${item.id}` : '/api/categorias';
  abrir(item ? 'Editar categoria' : 'Nova categoria', textoCampo('nome', 'Nome', item?.nome),
    gravar(caminho, item ? 'Categoria atualizada.' : 'Categoria cadastrada.'));
}

function confirmarExclusaoCategoria(id) {
  const item = base.categorias.find(categoria => categoria.id === id);
  const opcoes = base.categorias.filter(categoria => categoria.id !== id);
  if (item.em_uso && !opcoes.length) {
    abrir('Excluir categoria', '<p>Crie outra categoria para receber os registros vinculados antes de excluir esta.</p>');
    return;
  }
  const campos = item.em_uso
    ? `<p>Escolha uma categoria para receber os registros de <strong>${h(item.nome)}</strong>.</p>`
      + escolha('substituta', 'Categoria de destino', opcoes)
    : `<p>Excluir a categoria <strong>${h(item.nome)}</strong>?</p>`;
  abrir('Excluir categoria', campos + senhaParaExcluir(), async dados => {
    await api(`/api/categorias/${id}/excluir`, dados);
    if (filtros.historico.categoria === id) filtros.historico.categoria = null;
    janela.close();
    mostrarAviso('Categoria excluída.');
    await carregar();
  }, 'Excluir');
}

function verHistorico(dados) {
  const atuais = filtros.historico;
  const opcoes = ['despesa', 'renda', 'salario', 'transferencia', 'fatura', 'parcela', 'recorrencia']
    .map(id => ({ id, nome: id === 'parcela' ? 'Parcela ou pagamento avulso' : rotulos[id] }));
  const filtrosHtml = `<form class="filtros">${intervalo()}
    ${escolha('conta', 'Conta', base.contas, atuais.conta, { opcional: true, vazio: 'Todas', comBanco: true })}
    ${escolha('categoria', 'Categoria', base.categorias, atuais.categoria, { opcional: true, vazio: 'Todas' })}
    ${escolha('tipo', 'Tipo', opcoes, atuais.tipo, { opcional: true, numeros: false, vazio: 'Todos' })}
    <button class="botao" title="Mostre apenas os lançamentos que correspondem aos filtros.">Filtrar</button></form>`;
  const linhas = dados.map(item => {
    let acoes = '';
    if (item.tipo === 'fatura') acoes = botao('Ver fatura', 'fatura', item.referencia);
    else if (['recorrencia', 'parcela'].includes(item.tipo)) acoes = botao('Ver pagamento', 'ocorrencia', item.referencia);
    else acoes = botao('Editar', 'editar', item.id);
    return [dataBr(item.data), `<strong>${h(item.descricao)}</strong><br><small>${comIcone(iconesMovimentos[item.tipo], rotuloMovimento(item))}</small>`,
      h([item.nome_origem, item.nome_destino].filter(Boolean).join(' → ')), h(item.nome_categoria || '—'), valorMovimento(item), acoes];
  });
  return `${painel('Filtros', filtrosHtml)}
    ${painel('Lançamentos', tabela(['Data', 'Lançamento', 'Conta', 'Categoria', 'Valor', 'Ações'], linhas, 'Nenhum lançamento encontrado.'))}`;
}

function verCartoes(dados) {
  const ativos = dados.cartoes.filter(cartao => !cartao.arquivado);
  const arquivados = dados.cartoes.filter(cartao => cartao.arquivado);
  const { limiteTotal, limiteUsado } = ativos.reduce((totais, cartao) => ({
    limiteTotal: totais.limiteTotal + cartao.limite,
    limiteUsado: totais.limiteUsado + cartao.usado
  }), { limiteTotal: 0, limiteUsado: 0 });
  const cartoes = ativos.map(cartao => `<article class="metrica">
    <div class="linha cartao-cabecalho">
      <h3>${nomeComBanco(cartao, 'credit_card')}</h3>
      <details class="menu-cartao" name="opcoes-cartao">
        <summary class="botao" title="Opções do cartão" aria-label="Opções do cartão ${h(cartao.nome)}"><span aria-hidden="true">⚙︎</span></summary>
        <div class="menu-cartao-acoes">
          ${botao('Editar', 'editar-cartao', cartao.id)}${botao('Excluir', 'excluir-cartao', cartao.id, 'perigo')}
        </div>
      </details>
    </div>
    <strong class="valor">${dinheiro(cartao.limite - cartao.usado)}</strong><small>Limite disponível</small>
    <small>${valorColorido(cartao.usado, 'saida')} usados de ${dinheiro(cartao.limite)}</small>
    <small>Fechamento dia ${cartao.fechamento} · vencimento dia ${cartao.vencimento}</small></article>`);
  const arquivo = arquivados.length ? `<details class="painel"><summary>Cartões arquivados</summary>
    <ul class="lista">${arquivados.map(cartao => linha(nomeComBanco(cartao, 'credit_card'), botao('Restaurar', 'restaurar-cartao', cartao.id))).join('')}</ul>
  </details>` : '';
  const faturas = dados.faturas.map(fatura => [nomeComBanco(fatura, 'credit_card'), dataBr(fatura.fechamento), dataBr(fatura.vencimento),
    valorColorido(fatura.valor, 'saida'), situacaoFatura(fatura),
    botao('Detalhes', 'fatura', fatura.id)]);
  return `<div class="acoes">${botao('Novo cartão', 'cartao', '', 'principal')}${botao('Registrar compra', 'compra')}</div>
    ${cartoes.length ? `<div class="metricas">${cartoes.join('')}</div>
      <div class="colunas">
        ${metrica('Limite total dos cartões', limiteTotal)}
        ${metrica('Limite disponível nos cartões', limiteTotal - limiteUsado)}
      </div>` : vazio('Cadastre um cartão para organizar suas faturas.')}
    ${painel('Faturas', tabelaComCartoes(['Cartão', 'Fechamento', 'Vencimento', 'Valor', 'Situação', 'Ações'], faturas, 'Nenhuma fatura registrada.', 0, 3))}
    ${arquivo}`;
}

function situacaoFatura(fatura) {
  if (fatura.pagamento) return seloSituacao(`Paga em ${dataBr(fatura.pago_em)}`, 'entrada');
  if (fatura.vencimento < base.hoje) return seloSituacao('Vencida', 'saida');
  if (fatura.fechamento > base.hoje) return seloSituacao('Aberta', 'transferencia');
  return seloSituacao('Fechada', 'pendente');
}

function situacao(item) {
  const pagamento = item.pagamento_conta || item.pagamento_cartao;
  if (pagamento) return seloSituacao(`Paga em ${dataBr(pagamento)}`, 'entrada');
  if (item.cartao) return seloSituacao('Na fatura', 'transferencia');
  if (item.vencimento < base.hoje) return seloSituacao('Vencida', 'saida');
  return seloSituacao(item.vencimento > base.hoje ? 'Futura' : 'Pendente', 'pendente');
}

function verCompromissos(dados) {
  const faturas = dados.faturas.map(fatura => [
    nomeComBanco(fatura, 'credit_card'), dataBr(fatura.fechamento), dataBr(fatura.vencimento),
    valorColorido(fatura.valor, 'saida'), situacaoFatura(fatura),
    botao(fatura.fechamento <= base.hoje ? 'Pagar fatura' : 'Detalhes', 'fatura', fatura.id)
  ]);
  const planosVisiveis = dados.planos.filter(plano => !plano.arquivado
    && (plano.quantidade !== 1 || dados.ocorrencias.some(item => item.compromisso === plano.id)));
  const linhaPlano = plano => {
    const frequencia = plano.quantidade === 1 ? 'Avulso' : plano.tipo === 'parcelado' ? `${plano.quantidade} parcelas` : 'Mensal';
    const detalhes = `${frequencia} · ${plano.nome_cartao || plano.nome_conta}${plano.ultima_data ? ' · Encerrado' : ''}`;
    let acao = '';
    if (plano.arquivado) acao = botao('Restaurar na lista', 'restaurar-plano', plano.id);
    else if (plano.ultima_data) acao = botao('Retirar da lista', 'arquivar-plano', plano.id);
    else if (plano.tipo === 'mensal') acao = botao('Encerrar', 'encerrar-plano', plano.id);
    return linha(`<strong>${comIcone(plano.tipo === 'mensal' ? 'sync_alt' : 'calendar_month', h(plano.nome))}</strong>${subtitulo(detalhes)}`, acao);
  };
  const planos = lista(planosVisiveis.map(linhaPlano), 'Nenhum compromisso cadastrado.');
  const arquivados = dados.planos.filter(plano => plano.arquivado).map(linhaPlano);
  const arquivo = arquivados.length ? `<details><summary>Recorrências arquivadas</summary><ul class="lista">${arquivados.join('')}</ul></details>` : '';
  const proximos = dados.ocorrencias.filter(item => !item.pagamento && !item.pagamento_fatura);
  const pagos = dados.ocorrencias.filter(item => item.pagamento || item.pagamento_fatura).reverse();
  const listaOcorrencias = itens => itens.map(item => [dataBr(item.vencimento), h(item.nome),
    item.quantidade === 1 ? 'Avulso' : item.parcela ? `${item.parcela}/${item.quantidade}` : 'Mensal',
    valorColorido(item.confirmado ?? item.previsto, item.pagamento || item.pagamento_fatura ? 'saida' : 'pendente'), situacao(item),
    `<div class="acoes">
      ${botao(item.cartao ? 'Detalhes' : item.pagamento ? 'Ver pagamento' : 'Registrar pagamento', 'ocorrencia', item.id)}
      ${item.pagamento_fatura ? '' : botao('Editar', 'editar-cobranca', item.id) + botao('Excluir', 'excluir-cobranca', item.id, 'perigo')}
    </div>`]);
  const colunas = ['Vencimento', 'Compromisso', 'Frequência', 'Valor', 'Situação', 'Ações'];
  return `<div class="acoes">${botao('Novo pagamento avulso', 'plano', 'avulso', 'principal')}
    ${botao('Nova recorrência', 'plano', 'mensal')}${botao('Parcelar pela conta', 'plano', 'parcelado')}</div>
    ${painel('Faturas de cartão a pagar',
      tabelaComCartoes(['Cartão', 'Fechamento', 'Vencimento', 'Valor', 'Situação', 'Ações'], faturas, 'Nenhuma fatura pendente.', 0, 3))}
    ${painel('Cobranças pendentes e futuras', tabelaComCartoes(colunas, listaOcorrencias(proximos), 'Nenhuma cobrança pendente.', 1, 3))}
    ${painel('Compromissos cadastrados', planos + arquivo)}
    ${painel('Pagamentos anteriores', tabelaComCartoes(colunas, listaOcorrencias(pagos), 'Nenhum pagamento registrado.', 1, 3))}`;
}

function filtroRelatorios(dados) {
  return escolha('periodo', 'Ciclo salarial', periodos.map(item => ({ id: item.id,
    nome: `${dataBr(item.inicio)} a ${item.fim ? dataBr(item.fim) : 'hoje'}`
  })), dados.periodo_id, { opcional: true, numeros: false, vazio: 'Personalizado' })
    + campo('inicio', 'Pagamentos desde', dados.inicio, 'date', `required max="${base.hoje}"`)
    + campo('fim', 'Até', dados.fim, 'date', `required max="${base.hoje}"`);
}

function relatorioOrcamento(dados) {
  const { entradas, saidas, orcamento, previsao } = dados;
  const periodo = previsao ? 'saídas e pagamentos previstos' : 'saídas realizadas';
  const mensagem = entradas > 0 ? `${percentual.format(orcamento.proporcao)} das entradas ${previsao ? 'já estão comprometidas' : 'foram usadas em pagamentos'}.`
    : 'Sem entradas registradas para calcular o percentual.';
  const restante = orcamento.restante >= 0
    ? `${dinheiro(orcamento.restante)} ${previsao ? 'das entradas ainda não estão comprometidos' : 'de diferença entre entradas e saídas'}.`
    : `${periodo.charAt(0).toUpperCase() + periodo.slice(1)} superam as entradas em ${dinheiro(orcamento.excedente)}.`;
  const barra = entradas > 0 ? `<div class="orcamento-barra relatorio-barra" role="img" aria-label="${h(mensagem)} Previstos: ${dinheiro(orcamento.previsto)}. Saídas: ${dinheiro(saidas)}. ${h(restante)}">
    <progress class="orcamento-pago" value="${Math.min(orcamento.comprometido, entradas)}" max="${entradas}" aria-hidden="true"></progress>
    <progress class="orcamento-previsto" value="${Math.min(orcamento.previsto, entradas)}" max="${entradas}" aria-hidden="true"></progress>
  </div>` : '';
  return painel('Comprometimento das entradas', `<strong class="relatorio-frase">${h(mensagem)}</strong>
    <p class="${orcamento.excedente > 0 ? 'sinal saida' : 'suave'}">${h(restante)}</p>${barra}
    <div class="relatorio-legenda">
      ${previsao ? `<span class="sinal pendente">■ Previstos: ${dinheiro(orcamento.previsto)}</span>` : ''}
      <span class="sinal saida">■ Saídas pagas: ${dinheiro(saidas)}</span>
      ${orcamento.restante > 0 ? `<span class="suave">□ Não comprometido: ${dinheiro(orcamento.restante)}</span>` : ''}
    </div>
    ${orcamento.proporcao > 1 ? '<p>O percentual ultrapassou 100%. O excedente está informado acima; a barra representa até o valor das entradas.</p>' : ''}
    <small>Esta conta compara entradas e gastos do ciclo. O saldo bancário também pode conter dinheiro de períodos anteriores.</small>
    ${dados.atrasados_fora_previsao > 0 ? `<p class="sinal saida">Há também ${dinheiro(dados.atrasados_fora_previsao)} em pagamentos atrasados não incluídos nesse cálculo. Confira a lista abaixo.</p>` : ''}`);
}

function relatorioCategorias(dados) {
  const itens = dados.categorias;
  if (!itens.length) return painel('Maiores gastos por categoria', vazio('Nenhuma saída paga neste intervalo. Compras no cartão aparecem aqui quando a fatura é paga.'));
  const mostrar = item => `<button type="button" class="relatorio-categoria" data-acao="relatorio-categoria" data-id="${item.id}" title="Veja os pagamentos desta categoria.">
    <span class="linha"><strong>${h(item.nome)}</strong><span class="valor sinal saida">${dinheiro(item.valor)} · ${percentual.format(item.valor / dados.saidas)}</span></span>
    <meter min="0" max="${dados.saidas}" value="${item.valor}" aria-hidden="true"></meter>
  </button>`;
  return painel('Maiores gastos por categoria', `<p class="suave">Participação nas saídas pagas de ${dataBr(dados.inicio)} a ${dataBr(dados.fim)}. Clique para conferir os lançamentos.</p>
    <div class="relatorio-categorias">${itens.slice(0, 6).map(mostrar).join('')}</div>
    ${itens.length > 6 ? `<details><summary>Ver mais ${itens.length - 6} categorias</summary><div class="relatorio-categorias">${itens.slice(6).map(mostrar).join('')}</div></details>` : ''}`);
}

function valorRitmoNoDia(ritmo, dia) {
  if (!ritmo || dia > ritmo.dias) return null;
  let esquerda = 0, direita = ritmo.serie.length - 1;
  while (esquerda < direita) {
    const meio = Math.ceil((esquerda + direita) / 2);
    if (ritmo.serie[meio].dia <= dia) esquerda = meio; else direita = meio - 1;
  }
  return ritmo.serie[esquerda].valor;
}

function relatorioRitmo(dados) {
  const { atual, anterior } = dados.ritmo;
  const pontos = [...new Set([...atual.serie, ...(anterior?.serie ?? [])].map(p => p.dia))].sort((a, b) => a - b);
  let texto = dados.ritmo.motivo;
  if (anterior) {
    const diferenca = dados.ritmo.diferenca;
    texto = diferenca === 0 ? 'Os dois intervalos têm o mesmo total de saídas.'
      : `${dinheiro(Math.abs(diferenca))} ${diferenca > 0 ? 'a mais' : 'a menos'} em saídas${dados.ritmo.variacao === null ? ' (sem base anterior para um percentual)' : ` (${percentual.format(Math.abs(dados.ritmo.variacao))})`}.`;
  }
  const tabelaRitmo = tabela(['Dia', 'Data selecionada', 'Saídas acumuladas', ...(anterior ? ['Data anterior', 'Saídas anteriores'] : [])], pontos.map(dia => [
    dia === 0 ? 'Início' : String(dia), dia === 0 ? 'Antes do início' : dia <= atual.dias ? dataBr(somarDataRelatorio(atual.inicio, dia - 1)) : '—',
    valorRitmoNoDia(atual, dia) === null ? '—' : dinheiro(valorRitmoNoDia(atual, dia)),
    ...(anterior ? [dia === 0 ? 'Antes do início' : dia <= anterior.dias ? dataBr(somarDataRelatorio(anterior.inicio, dia - 1)) : '—',
      valorRitmoNoDia(anterior, dia) === null ? '—' : dinheiro(valorRitmoNoDia(anterior, dia))] : [])
  ]), 'Sem pagamentos.');
  const temGastos = atual.saidas > 0 || (anterior?.saidas ?? 0) > 0;
  return painel('Ritmo de gastos', `<p>${h(texto)}</p>
    <div class="relatorio-legenda"><span class="sinal saida">━ Selecionado: ${dataBr(atual.inicio)} a ${dataBr(atual.fim)} · ${atual.dias} dia(s) · ${dinheiro(atual.saidas)}</span>
      ${anterior ? `<span class="sinal transferencia">┄ Anterior: ${dataBr(anterior.inicio)} a ${dataBr(anterior.fim)} · ${anterior.dias} dia(s) · ${dinheiro(anterior.saidas)}</span>` : ''}</div>
    ${anterior ? `<small>${dados.ritmo.tipo === 'mesma-quantidade-de-dias' ? 'Comparação dos primeiros ' + atual.dias + ' dias de cada ciclo.' : 'Comparação entre ciclos completos. Confira a duração de cada um acima.'}</small>` : ''}
    ${temGastos ? '<canvas id="grafico" role="img" aria-label="Saídas pagas acumuladas por dia do ciclo. Linha contínua para o período selecionado e tracejada para o anterior, quando comparável."></canvas>' : vazio('Nenhuma saída registrada nos intervalos apresentados.')}
    <small>São pagamentos acumulados, sem saldo bancário ou previsão misturados à linha.</small>
    <details><summary>Conferir os valores do gráfico</summary>${tabelaRitmo}</details>`);
}

function somarDataRelatorio(data, quantidade) {
  const instante = new Date(data + 'T00:00:00Z'); instante.setUTCDate(instante.getUTCDate() + quantidade);
  return instante.toISOString().slice(0, 10);
}

function verRelatorios(dados) {
  const previstos = dados.previsao
    ? metricaComDetalhes('Gastos previstos', dados.previsao.valor, 'calendar_month', 'relatorio-detalhe', 'previstos', 'sinal pendente')
    : `<section class="metrica"><span>Gastos previstos</span><strong>${dados.janela_previsao ? 'Janela encerrada' : 'Não se aplica'}</strong><small>${h(dados.motivo_sem_previsao)}</small></section>`;
  const pendencias = (itens, atrasadas = false) => tabela(['Vencimento', 'Pagamento', 'Valor', ...(atrasadas ? ['No comprometimento acima?'] : [])], itens.map(item => [
    dataBr(item.vencimento), h(item.nome), valorColorido(item.valor, atrasadas ? 'saida' : 'pendente'),
    ...(atrasadas ? [item.incluido_na_previsao ? 'Sim' : dados.previsao ? 'Não · fora da janela' : 'Não · previsão inativa'] : [])
  ]), atrasadas ? 'Nenhum pagamento atrasado registrado.' : 'Nenhum pagamento previsto para as próximas datas desta janela.');
  const maiores = tabela(['Data do pagamento', 'Descrição', 'Categoria', 'Valor'], dados.maiores_despesas.map(item => [dataBr(item.data),h(item.descricao),h(item.categoria),dinheiro(item.valor)]), 'Nenhuma saída registrada.');
  return painel('Período analisado', `<form class="filtros">${filtroRelatorios(dados)}<button class="botao principal">Atualizar relatório</button></form>
      <p>Pagamentos realizados de <strong>${dataBr(dados.inicio)}</strong> a <strong>${dataBr(dados.fim)}</strong>.</p>
      ${dados.previsao ? `<p class="suave">Pendências consideradas de ${dataBr(dados.previsao.inicio)} a ${dataBr(dados.previsao.fim)}${dados.previsao.sem_salario ? '. Sem salário registrado: previsão dos próximos 30 dias' : ' — até 30 dias após o salário'}.</p>` : `<p class="suave">${h(dados.motivo_sem_previsao)}</p>`}`)
    + `<div class="metricas relatorio-metricas">
      ${metricaComDetalhes('Entradas do período', dados.entradas, 'arrow_downward', 'relatorio-detalhe', 'entradas', 'sinal entrada')}
      ${metricaComDetalhes('Saídas do período', dados.saidas, 'arrow_upward', 'relatorio-detalhe', 'saidas', 'sinal saida')}${previstos}</div>`
    + relatorioOrcamento(dados) + relatorioCategorias(dados) + relatorioRitmo(dados)
    + (dados.ciclo_atual ? `<div class="colunas">${painel('Próximos pagamentos', dados.previsao ? pendencias(dados.proximos) : vazio('Não há janela de previsão ativa para este intervalo.'))}${painel('Pagamentos atrasados', '<p class="suave">A coluna indica quais pendências foram incluídas no comprometimento acima.</p>' + pendencias(dados.atrasados, true))}</div>` : '')
    + painel('Maiores despesas do intervalo', maiores)
    + painel('Saldo e movimentações entre suas contas', `<p class="suave">Informações separadas dos gastos de consumo. Transferir dinheiro entre contas próprias não é uma despesa.</p>
      <div class="relatorio-patrimonio"><div><small>Saldo em contas no fim do intervalo (sem reservas e investimentos)</small><strong>${dinheiro(dados.saldo_final)}</strong></div>
      <div><small>Aportes em reservas e investimentos</small><strong>${dinheiro(dados.patrimonio.aportes)}</strong></div>
      <div><small>Resgates para contas</small><strong>${dinheiro(dados.patrimonio.resgates)}</strong></div>
      <div><small>Outras transferências internas</small><strong>${dinheiro(dados.patrimonio.internas)}</strong></div></div>`);
}

function detalharRelatorio(tipo, categoriaId) {
  if (tipo === 'previstos') { detalharPrevisao(); return; }
  const entradas = tipo === 'entradas';
  const itens = entradas ? dadosPagina.entradas_detalhadas : dadosPagina.saidas_detalhadas.filter(item => categoriaId === undefined || item.categoria_id === categoriaId);
  const categoria = categoriaId === undefined ? null : dadosPagina.categorias.find(item => item.id === categoriaId);
  const titulo = entradas ? 'Entradas do período' : categoria ? 'Saídas · ' + categoria.nome : 'Saídas do período';
  abrir(titulo, `<p>Pagamentos de ${dataBr(dadosPagina.inicio)} a ${dataBr(dadosPagina.fim)}.</p>`
    + tabela(['Data', 'Descrição', entradas ? 'Tipo' : 'Categoria', 'Valor'], itens.map(item => [dataBr(item.data),
      `${h(item.descricao)}${item.fatura ? `<br><small>${h(item.fatura)}</small>` : ''}`, h(entradas ? rotulos[item.tipo] : item.categoria), dinheiro(item.valor)]), 'Nenhum registro neste intervalo.')
    + `<div class="linha"><strong>Total</strong><strong>${dinheiro(itens.reduce((soma, item) => soma + item.valor, 0))}</strong></div>`);
}

function desenharGrafico(dados) {
  const canvas = document.querySelector('#grafico');
  if (!canvas || !dados?.ritmo) return;
  const { atual, anterior } = dados.ritmo;
  const escala = devicePixelRatio || 1, largura = canvas.clientWidth, altura = canvas.clientHeight;
  if (!largura) return;
  canvas.width = Math.round(largura * escala); canvas.height = Math.round(altura * escala);
  const ctx = canvas.getContext('2d'); ctx.scale(escala, escala);
  const estilos = getComputedStyle(canvas);
  const maximo = Math.max(atual.saidas, anterior?.saidas ?? 0, 1);
  const ideal = maximo / 4, ordem = 10 ** Math.floor(Math.log10(ideal));
  const passo = [1, 2, 2.5, 5, 10].map(fator => fator * ordem).find(valor => valor >= ideal);
  const superior = Math.ceil(maximo / passo) * passo;
  const duracao = Math.max(atual.dias, anterior?.dias ?? 0, 1);
  const esquerda = largura < 450 ? 75 : 95, direita = 16;
  const x = dia => esquerda + dia / duracao * (largura - esquerda - direita);
  const y = valor => 15 + (superior - valor) / superior * (altura - 49);
  ctx.font = '11px Segoe UI, sans-serif';ctx.fillStyle = estilos.getPropertyValue('--suave');ctx.strokeStyle = estilos.getPropertyValue('--borda');
  const compacta = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
  for (let valor = 0; valor <= superior + passo / 10; valor += passo) {
    const rotulo = dinheiro(valor);
    ctx.fillText(rotulo.length > 12 ? compacta.format(valor / 100) : rotulo, 0, y(valor) + 4, esquerda - 8);
    ctx.beginPath();ctx.moveTo(esquerda, y(valor));ctx.lineTo(largura - direita, y(valor));ctx.stroke();
  }
  const divisorias = largura < 450 ? 2 : 4;
  const ticks = [...new Set(Array.from({ length: divisorias + 1 }, (_, i) => Math.round(duracao * i / divisorias)))];
  for (const dia of ticks) { ctx.textAlign = dia === 0 ? 'left' : dia === duracao ? 'right' : 'center';ctx.fillText(dia === 0 ? 'Início' : 'Dia ' + dia, x(dia), altura - 7); }
  ctx.textAlign = 'left';
  const desenhar = (ritmo, cor, tracejado) => {
    ctx.strokeStyle = ctx.fillStyle = estilos.getPropertyValue(cor);ctx.lineWidth = 2.5;ctx.setLineDash(tracejado ? [6, 4] : []);
    ctx.beginPath();ritmo.serie.forEach((ponto, indice) => {
      if (!indice)ctx.moveTo(x(ponto.dia), y(ponto.valor));
      else {ctx.lineTo(x(ponto.dia), y(ritmo.serie[indice - 1].valor));ctx.lineTo(x(ponto.dia), y(ponto.valor));}
    });ctx.stroke();ctx.setLineDash([]);
    const ultimo = ritmo.serie.at(-1);ctx.beginPath();ctx.arc(x(ultimo.dia), y(ultimo.valor), 3.5, 0, Math.PI * 2);ctx.fill();
  };
  if (anterior) desenhar(anterior, '--transferencia', true);
  desenhar(atual, '--saida', false);
}

function verAdmin(dados) {
  const linhasSenha = itens => itens.map(item => [
    `${h(item.nome)}<br>${h(item.login)}`, horaBr(item.criada_em),
    `<span class="justificativa-senha">${h(item.justificativa)}</span>`,
    item.estado === 'pendente'
      ? `<div class="acoes">${botao('Aprovar', 'aprovar-senha', item.id)}${botao('Recusar', 'recusar-senha', item.id, 'perigo')}</div>`
      : `${h(estadosSenha[item.estado])}<br>${horaBr(item.decidida_em)}`
  ]);
  const pendentes = dados.solicitacoes_senha.filter(item => item.estado === 'pendente');
  const analisadas = dados.solicitacoes_senha.filter(item => item.estado !== 'pendente');
  const pedidosSenha = painel('Solicitações de troca de senha',
    tabela(['Usuário', 'Solicitada em', 'Justificativa', 'Ações'], linhasSenha(pendentes), 'Nenhuma solicitação pendente.')
    + (analisadas.length ? `<details><summary>Solicitações analisadas</summary>${tabela(['Usuário', 'Solicitada em', 'Justificativa', 'Resultado'], linhasSenha(analisadas), '')}</details>` : ''));
  const contas = dados.usuarios.map(item => [h(item.nome), h(item.login), item.ativo ? 'Ativo' : 'Desativado', horaBr(item.ultimo_acesso),
    `<div class="acoes">${botao('Editar perfil', 'editar-perfil', item.id)}
      ${item.id !== usuario.id ? (dados.acessos.some(a => a.titular === item.id && a.estado === 'aprovado' && a.expira > Date.now()) ? botao('Consultar finanças', 'abrir-perfil', item.id) : botao('Solicitar consulta', 'acesso-solicitar', item.id)) : ''}
      ${item.admin ? '' : botao(item.ativo ? 'Desativar' : 'Reativar', 'atividade', item.id)}</div>`]);
  const sessoes = dados.sessoes.map(item => [h(dados.usuarios.find(u => u.id === item.usuario)?.login), horaBr(item.inicio),
    horaBr(item.acesso), horaBr(item.expira), item.atual ? 'Sua sessão atual' : botao('Encerrar', 'sessao-encerrar', item.id)]);
  const recuperacoes = painel('Recuperação de acesso', tabela(['Perfil','Contatos já cadastrados','Ação'], dados.recuperacoes.map(p => [h(p.nome), `${h(p.email)}<br>${h(p.telefone)}`, botao('Verificar e liberar', 'recuperacao-liberar', p.id)]), 'Nenhuma recuperação pendente.'));
  const eventos = painel('Eventos de segurança', tabela(['Data','Evento','Ator','Alvo'], dados.eventos.map(e => [horaBr(e.criada_em),h(e.evento),h(e.ator),h(e.alvo)]), 'Nenhum evento.'));
  return `${recuperacoes}${pedidosSenha}${eventos}${painel('Perfis', tabela(['Nome', 'Usuário', 'Estado', 'Último login', 'Ações'], contas, 'Nenhum perfil.'), botao('Adicionar perfil', 'usuario', '', 'principal'))}
    ${painel('Sessões ativas', tabela(['Usuário', 'Início', 'Última atividade', 'Expira', 'Ações'], sessoes, 'Nenhuma sessão ativa.'))}`;
}

function navegadorComPush() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function verNotificacoes(dados) {
  return notificacoesDeAcesso(dados.internas) + avisosPush(dados);
}

function avisosPush(dados) {
  if (!dados.ativa) return painel('Avisos no celular', vazio('Configure o contato técnico de Web Push e o endereço HTTPS no servidor para ativar os avisos.'));
  if (!navegadorComPush()) return painel('Avisos no celular', vazio('Abra o endereço HTTPS no Chrome do Android. No iPhone, adicione o site à Tela de Início e abra pelo ícone para ativar os avisos.'));
  const bloqueado = Notification.permission === 'denied';
  const ativo = dados.inscrito && Notification.permission === 'granted';
  const status = bloqueado ? 'Notificações bloqueadas neste navegador' : ativo ? 'Notificações ativas neste dispositivo' : 'Notificações desativadas neste dispositivo';
  return painel('Avisos no celular', `
    <p role="status">${seloSituacao(status, ativo ? 'entrada' : bloqueado ? 'saida' : 'pendente')}</p>
    <p>Receba avisos de cobranças e faturas nos cinco dias anteriores ao vencimento, no dia do vencimento e ao entrar em atraso.</p>
    <p class="suave">O servidor confere os vencimentos a cada dez minutos. O notebook precisa estar ligado e conectado à internet. Você pode fechar o site depois de ativar os avisos.</p>
    ${bloqueado ? '<p>Nas configurações deste site no navegador, permita as notificações e volte a esta página.</p>' : ''}
    <details><summary>E-mail, WhatsApp e SMS</summary>
      <p>Esses canais aguardam a configuração dos serviços de envio pelo administrador.</p>
      <ul>${[['avisos_email','E-mail'],['avisos_whatsapp','WhatsApp'],['avisos_sms','SMS']]
        .map(([canal,nome]) => `<li>${nome} · ${usuario[canal] ? 'Preferência registrada' : 'Não solicitado'}</li>`).join('')}</ul>
      <p>Altere os contatos e suas preferências em Meu perfil.</p>
    </details>
    <div class="acoes">${ativo
      ? botao('Enviar teste', 'push-testar', '', 'principal') + botao('Desativar neste dispositivo', 'push-desativar')
      : bloqueado ? '' : botao('Ativar neste dispositivo', 'push-ativar', '', 'principal')}
    </div>`);
}

const telas = {
  inicio: ['painel', verPainel], contas: [null, verContas], historico: ['lancamentos', verHistorico],
  cartoes: ['cartoes', verCartoes], compromissos: ['compromissos', verCompromissos], relatorios: ['relatorios', verRelatorios],
  notificacoes: ['notificacoes', verNotificacoes], perfil: ['perfil/solicitacoes-senha', verMeuPerfil], familia: ['grupo', verFamilia], admin: ['admin', verAdmin]
};

const dispositivoMovel = matchMedia('(max-width: 800px), (max-width: 1100px) and (pointer: coarse)');
const pontosMais = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="4" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="20" cy="12" r="1.8" fill="currentColor"/></svg>';
const casaMovel = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10L12 3L21 10V21H15V14H9V21H3Z"/></svg>';

function simboloMenuMovel(id) {
  if (id === 'familia') return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21V18C3 14 15 14 15 18V21M16 4C20 4 20 10 16 10M18 14C21 14 22 16 22 18V21"/></svg>';
  if (id === 'admin') return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 3L4 6V12C4 17 8 20 12 22C16 20 20 17 20 12V6Z"/><path d="M8 12L11 15L16 9"/></svg>';
  return icone(iconesPaginas[id]);
}

function interruptorTema() {
  const escuro = usuario.tema === 'escuro';
  return `<button type="button" class="interruptor-tema" data-acao="tema" role="switch" aria-checked="${escuro}" aria-label="Modo escuro" title="${escuro ? 'Ativar modo claro' : 'Ativar modo escuro'}">
    <span class="trilho-tema" aria-hidden="true">
      <svg class="sol-tema" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
      <svg class="lua-tema" viewBox="0 0 24 24" fill="currentColor"><path d="M19.9 15.3A8.4 8.4 0 0 1 8.7 4.1a8.5 8.5 0 1 0 11.2 11.2Z"/><path d="m17 3 .6 1.5L19 5l-1.4.5L17 7l-.6-1.5L15 5l1.4-.5Z"/></svg>
      <span class="circulo-tema"></span>
    </span>
  </button>`;
}

function barraInferior(principais, visiveis) {
  const secundario = !principais.includes(aba);
  const destinos = principais.filter(id => visiveis.some(item => item[0] === id));
  return `<nav class="barra-inferior" aria-label="Navegação principal no celular">
    ${destinos.map(id => `<a class="atalho-inferior" href="#${id}" ${id === aba ? 'aria-current="page"' : ''}>
      <span class="simbolo-inferior">${id === 'inicio' ? casaMovel : icone(iconesPaginas[id])}</span><span>${id === 'inicio' ? 'Início' : h(paginas[id])}</span></a>`).join('')}
    <button type="button" class="atalho-inferior${secundario ? ' ativo' : ''}" data-acao="menu-movel" aria-haspopup="dialog" aria-controls="menu-movel" aria-expanded="false" aria-label="Mais${secundario ? ' — página atual: ' + h(paginas[aba]) : ''}">
      <span class="simbolo-inferior">${pontosMais}</span><span>Mais</span>
    </button></nav>`;
}

function fecharMenuMovel(restaurarFoco = true) {
  restaurarFocoMais = restaurarFoco;
  if (menuMovel.open) menuMovel.close();
  document.body.classList.remove('menu-movel-aberto');
  app.querySelector('[data-acao="menu-movel"]')?.setAttribute('aria-expanded', 'false');
}

function abrirMenuMovel() {
  if (!usuario || !dispositivoMovel.matches || !app.querySelector('.barra-inferior') || janela.open) return;
  const principais = ['inicio', 'contas', 'cartoes', 'compromissos'];
  const destinos = Object.entries(paginas).filter(([id]) => !principais.includes(id)
    && (id !== 'admin' || usuario.admin) && (!perfilAberto || !['admin','notificacoes','perfil','familia'].includes(id)));
  menuMovel.innerHTML = `<header class="cabecalho-mais"><h2 id="titulo-menu-movel">Mais</h2><button type="button" class="botao" data-fechar-menu-movel aria-label="Fechar menu">×</button></header>
    <div class="conteudo-mais"><nav aria-label="Outras páginas">${destinos.map(([id, nome]) => `<a href="#${id}" ${aba === id ? 'aria-current="page"' : ''}><span class="com-icone">${simboloMenuMovel(id)}<span>${h(nome)}</span></span>${aba === id ? '<small>Página atual</small>' : ''}</a>`).join('')}</nav>
      <div class="acoes-mais">${!perfilAberto ? `<button type="button" class="botao" data-acao="selecionar-familia">${comIcone('person', 'Perfis da família')}</button>` : ''}<button type="button" class="botao" data-acao="tutorial">${comIcone('menu_book', 'Tutorial')}</button></div>
      <div class="saida-mais">${botao('Sair', 'sair')}</div>
    </div>`;
  restaurarFocoMais = true;
  app.querySelector('[data-acao="menu-movel"]')?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-movel-aberto');
  menuMovel.showModal();
  menuMovel.querySelector('[data-fechar-menu-movel]').focus();
}

let pressionouForaDoMenu = false;
const foraDoMenu = evento => {
  const r = menuMovel.getBoundingClientRect();
  return evento.target === menuMovel && (evento.clientX < r.left || evento.clientX > r.right || evento.clientY < r.top || evento.clientY > r.bottom);
};
menuMovel.addEventListener('pointerdown', evento => { pressionouForaDoMenu = foraDoMenu(evento); });
menuMovel.addEventListener('pointercancel', () => { pressionouForaDoMenu = false; });
menuMovel.addEventListener('click', async evento => {
  const fora = pressionouForaDoMenu && foraDoMenu(evento); pressionouForaDoMenu = false;
  if (evento.target.closest('[data-fechar-menu-movel]') || fora) { fecharMenuMovel(); return; }
  const destino = evento.target.closest('a[href^="#"]');
  if (destino) {
    focarPaginaAposMenu = true; fecharMenuMovel(false);
    if (location.hash === destino.hash) { evento.preventDefault(); await carregar(); }
    return;
  }
  if (evento.target.closest('[data-acao]')) { fecharMenuMovel(false); await clicar(evento); }
});
menuMovel.addEventListener('cancel', () => { restaurarFocoMais = true; });
menuMovel.addEventListener('close', () => {
  document.body.classList.remove('menu-movel-aberto');
  const botaoMais = app.querySelector('[data-acao="menu-movel"]');
  botaoMais?.setAttribute('aria-expanded', 'false');
  if (restaurarFocoMais && dispositivoMovel.matches && botaoMais?.isConnected) botaoMais.focus({ preventScroll: true });
});
dispositivoMovel.addEventListener('change', () => { if (!dispositivoMovel.matches) fecharMenuMovel(false); });

function atualizarFocoDeCampo() {
  const elemento = document.activeElement;
  const editando = elemento?.matches('textarea,select,[contenteditable="true"],input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="hidden"])');
  document.body.classList.toggle('campo-em-edicao', Boolean(editando));
}
document.addEventListener('focusin', atualizarFocoDeCampo);
document.addEventListener('focusout', () => queueMicrotask(atualizarFocoDeCampo));

async function carregar() {
  fecharMenuMovel(false);
  menuMovel.replaceChildren();
  if (!usuario) return;
  if (usuario.contatos_pendentes) {
    ++navegacao;
    completarCadastro();
    return;
  }
  const passagem = ++navegacao;
  const solicitada = location.hash.slice(1);
  if (solicitada === 'perfis-familia') {
    await exibirPaginaPerfisFamilia(passagem);
    return;
  }
  const paginasVisiveis = Object.entries(paginas).filter(([id]) =>
    (!perfilAberto || !['admin', 'notificacoes', 'perfil', 'familia'].includes(id)) && (id !== 'admin' || usuario.admin));
  const pagina = paginasVisiveis.some(([id]) => id === solicitada) ? solicitada : 'inicio';
  const [rota, renderizar] = telas[pagina];
  const parametros = new URLSearchParams(Object.entries(filtros[pagina] ?? {}).filter(([nome, valor]) => (nome !== 'periodo' || pagina === 'relatorios') && valor));
  try {
    const resultados = await Promise.all([
      api('/api/base'), api('/api/periodos'), rota ? api(`/api/${rota}?${parametros}`) : undefined
    ]);
    if (passagem !== navegacao) return;
    if (pagina === 'notificacoes' && resultados[2].ativa && navegadorComPush()) {
      const registro = await navigator.serviceWorker.register('./sw.js');
      registroPush = registro.active ? registro : await navigator.serviceWorker.ready;
      const inscricao = await registroPush.pushManager.getSubscription();
      resultados[2].inscrito = inscricao
        ? (await api('/api/notificacoes/consultar', { endpoint: inscricao.endpoint })).registrado : false;
      if (passagem !== navegacao) return;
    }
    [base, periodos, dadosPagina] = resultados;
    aba = pagina;
    aplicarPreferencias(usuario);
    const principais = ['inicio', 'contas', 'cartoes', 'compromissos'];
    const linkMenu = ([id, nome], classe = '') =>
      `<a href="#${id}" class="${classe}" ${id === aba ? 'aria-current="page"' : ''}>${comIcone(iconesPaginas[id], h(nome))}</a>`;
    const links = paginasVisiveis.map(item => linkMenu(item, principais.includes(item[0]) ? '' : 'menu-secundario')).join('');
    const barra = barraInferior(principais, paginasVisiveis);
    const nomeUsuario = !perfilAberto
      ? `<a class="nome-perfil" href="#perfil" title="Abrir meu perfil">${avatarPerfil(usuario, true)}${h(nomeExibicao(usuario))}</a>`
      : `<span class="com-icone">${avatarPerfil(usuario, true)}${h(nomeExibicao(usuario))}</span>`;
    const topo = `<header class="topo"><div class="marca-movel">${marca()}</div>${nomeUsuario}${interruptorTema()}<div class="acoes acoes-topo">
      <button type="button" class="atalho-tutorial" data-acao="tutorial" title="Abra o guia de uso do aplicativo.">${comIcone('menu_book', 'Tutorial')}</button>
      <button type="button" class="atalho-qr" data-acao="qr-rede" aria-label="QR code de acesso ao Finanças em Dia" title="Abra o QR code de acesso ao Finanças em Dia.">${icone('qr_code_2')}</button>
      ${botao('Perfis da família', 'selecionar-familia')}${botao('Sair', 'sair')}</div></header>`;
    const identificacao = perfilAberto ? `<div class="perfil-aberto linha"><strong>Consulta autorizada · ${h(perfilAberto.nome)}</strong>
      ${botao('Voltar ao meu perfil', 'sair-perfil-aberto')}</div>` : '';
    const titulo = aba === 'inicio' ? '' : `<header class="cabecalho"><h1>${h(paginas[aba])}</h1></header>`;
    app.innerHTML = `<div class="layout"><aside class="menu">${marca()}<nav aria-label="Principal">${links}</nav></aside>
      <main class="area">${topo}<div class="pagina">${identificacao}${titulo}${renderizar(dadosPagina)}</div></main>${barra}</div>`;
    if (perfilAberto) {
      for (const controle of app.querySelectorAll('[data-acao]')) if (!acoesConsulta.has(controle.dataset.acao)) {
        if (controle.dataset.acao === 'editar-conta') controle.replaceWith(...controle.childNodes); else controle.remove();
      }
    }
    if (aba === 'perfil') montarMeuPerfil(dadosPagina, app.querySelector('[data-editor-perfil]'));
    const form = app.querySelector('form.filtros');
    if (form) {
      form.elements.periodo.onchange = () => {
        const periodo = periodos.find(p => p.id === form.elements.periodo.value);
        form.elements.inicio.value = periodo?.inicio ?? '';
        form.elements.fim.value = periodo ? periodo.fim ?? base.hoje : '';
      };
      for (const nome of ['inicio', 'fim']) form.elements[nome].onchange = () => { form.elements.periodo.value = ''; };
      form.onsubmit = evento => {
        evento.preventDefault();
        filtros[aba] = lerFormulario(form);
        carregar();
      };
    }
    if (aba === 'relatorios') desenharGrafico(dadosPagina);
    if (focarPaginaAposMenu) {
      focarPaginaAposMenu = false;
      const tituloPagina = app.querySelector('main h1');
      if (tituloPagina) { tituloPagina.tabIndex = -1; tituloPagina.focus({ preventScroll: true }); }
      scrollTo(0, 0);
    }
    atualizarFocoDeCampo();
  } catch (erro) {
    if (erro.status === 401) mostrarLogin();
    else if (erro.status === 428) {
      usuario = await api('/api/sessao');
      completarCadastro();
    } else if (perfilAberto && erro.status === 403) {
      perfilAberto = undefined; limparTelaFinanceira(); history.replaceState(null, '', '#familia');
      mostrarAviso('A consulta não está mais autorizada.'); await carregar();
    } else mostrarAviso(erro.message);
  }
}

function prepararCadastro(condicao, titulo, destino) {
  if (condicao) return true;
  abrir(titulo, `<p>Cadastre primeiro na página abaixo.</p>${link(destino === 'cartoes' ? 'Abrir cartões' : 'Abrir contas e categorias', destino)}`);
  return false;
}

function formularioMovimento(tipo, item) {
  const contas = tipo === 'transferencia' ? base.contas : contasBancarias();
  if (!prepararCadastro(contas.length >= (tipo === 'transferencia' ? 2 : 1), 'Cadastre as contas da movimentação', 'contas')) return;
  if (tipo === 'despesa' && !prepararCadastro(base.categorias.length, 'Cadastre uma categoria', 'contas')) return;
  let campos = diaCampo('data', 'Data', item?.data);
  if (tipo !== 'renda') campos += contaCampo('origem', tipo === 'despesa' ? 'Conta' : 'Conta de origem', item?.origem, contas);
  if (tipo !== 'despesa') campos += contaCampo('destino', tipo === 'renda' ? 'Conta' : 'Conta de destino', item?.destino ?? contas[1]?.id, contas);
  if (tipo === 'despesa') campos += categoriaCampo(item?.categoria);
  campos += textoCampo('descricao', 'Descrição', item?.descricao, 240) + valorCampo('valor', 'Valor em reais', item?.valor);
  if (item) campos += botao('Excluir lançamento', 'excluir', item.id, 'perigo');
  const caminho = item ? `/api/lancamentos/${item.id}` : '/api/lancamentos';
  const titulo = item ? `Editar ${rotulos[tipo].toLowerCase()}` : 'Adicionar ' + rotulos[tipo].toLowerCase();
  abrirComRascunho(`${caminho}:${tipo}`, titulo, campos, gravar(caminho, 'Lançamento salvo.', { tipo }));
}

function formularioSalario(item) {
  if (!prepararCadastro(contasBancarias().length, 'Cadastre uma conta para receber o salário', 'contas')) return;
  const editando = Boolean(item);
  const campos = diaCampo('data', 'Data do crédito', item?.data, base.hoje, item?.virada ? 'readonly' : '')
    + contaCampo('destino', 'Conta', item?.destino)
    + textoCampo('descricao', 'Descrição', item?.descricao ?? 'Salário', 240)
    + valorCampo('valor', 'Valor em reais', item?.valor);
  if (editando) {
    const rota = `/api/salarios/${item.id}`;
    abrirComRascunho(rota, 'Editar salário', campos, gravar(rota, 'Salário corrigido.'));
    return;
  }
  abrirComRascunho('/api/salarios', 'Adicionar salário', campos, async dados => {
    const { chave: ignorar, ...salario } = dados;
    const previa = await api('/api/salarios/previa', salario);
    const intervalo = (inicio, fim) => `${dataBr(inicio)} a ${fim ? dataBr(fim) : 'hoje'}`;
    const confirmacao = previa.mesma_data
      ? '<p>Já existe uma virada nessa data. Este salário será creditado no mesmo período.</p>'
      : `<p>Novo período de <strong>${intervalo(previa.novo_inicio, previa.novo_fim)}</strong>.</p>
        ${previa.anterior_fim ? `<p>Período anterior de <strong>${intervalo(previa.anterior_inicio, previa.anterior_fim)}</strong>.</p>` : ''}`;
    const conta = base.contas.find(conta => conta.id === dados.destino);
    const texto = `<p><strong>${dinheiro(dados.valor)}</strong> na conta ${h(conta.nome)}, em ${dataBr(dados.data)}.</p>`;
    abrir(previa.ja_registrados ? 'Confirmar salário adicional' : 'Confirmar virada', texto + confirmacao,
      gravar('/api/salarios', 'Salário registrado.', { ...salario, revisao: previa.revisao, confirmar_segundo: previa.ja_registrados > 0 }),
      previa.ja_registrados ? 'Registrar mais um salário' : 'Confirmar salário');
  }, 'Ver prévia');
}

function formularioConta(tipo) {
  const campos = camposBanco('Nome') + valorCampo('saldo_inicial', 'Saldo inicial em reais', 0)
    + diaCampo('inicio', 'Data do saldo inicial');
  const titulos = { conta: 'Nova conta', reserva: 'Nova reserva', investimento: 'Novo investimento' };
  abrir(titulos[tipo], campos, gravar('/api/contas', 'Cadastro salvo.', { tipo }), 'Salvar', preencherNomeDoBanco);
}

async function editarConta(id) {
  const conta = await api(`/api/contas/${id}`);
  const emUso = conta.primeira_movimentacao || conta.tem_compromissos;
  const tipos = ['conta', 'reserva', 'investimento'].map(tipo => ({ id: tipo, nome: rotulos[tipo] }));
  const campoTipo = emUso
    ? `<p class="suave">Tipo atual: ${h(rotulos[conta.tipo])}. Esta conta já tem movimentações ou compromissos vinculados.</p>`
    : escolha('tipo', 'Tipo', tipos, conta.tipo, { numeros: false });
  const limite = conta.primeira_movimentacao && conta.primeira_movimentacao >= conta.inicio
    ? conta.primeira_movimentacao : base.hoje;
  const aviso = conta.primeira_movimentacao
    ? `<p class="suave">A abertura deve ser igual ou anterior à primeira movimentação, de ${dataBr(conta.primeira_movimentacao)}.</p>`
    : '';
  const campos = camposBanco('Nome', conta) + campoTipo
    + diaCampo('inicio', 'Data de abertura', conta.inicio, limite) + aviso
    + valorCampo('saldo_inicial', 'Saldo inicial em reais', conta.saldo_inicial)
    + '<p class="suave">Alterar o saldo inicial recalcula os saldos a partir da data de abertura.</p>';
  abrir(`Editar · ${conta.nome}`, campos, gravar(`/api/contas/${id}`, 'Cadastro atualizado.'));
}

function formularioPatrimonio(acao) {
  const patrimonio = base.contas.filter(conta => conta.tipo !== 'conta');
  if (!prepararCadastro(contasBancarias().length && patrimonio.length, 'Cadastre uma conta e uma reserva ou investimento', 'contas')) return;
  const aporte = acao === 'aporte';
  const campos = diaCampo('data', 'Data') + contaCampo('origem', 'Origem', undefined, aporte ? contasBancarias() : patrimonio)
    + contaCampo('destino', 'Destino', undefined, aporte ? patrimonio : contasBancarias()) + valorCampo('valor', 'Valor em reais')
    + textoCampo('descricao', 'Descrição', aporte ? 'Aporte' : 'Resgate', 240);
  abrirComRascunho(`patrimonio:${acao}`, aporte ? 'Registrar aporte' : 'Registrar resgate', campos,
    gravar('/api/lancamentos', 'Transferência registrada.', { tipo: 'transferencia' }));
}

function formularioCartao(cartao) {
  const aviso = cartao ? '<p class="suave">As datas das faturas já geradas serão mantidas.</p>' : '';
  const campos = aviso + camposBanco('Nome do cartão', cartao)
    + valorCampo('limite', 'Limite em reais', cartao?.limite)
    + numeroCampo('fechamento', 'Dia do fechamento', cartao?.fechamento ?? 5, 1, 31)
    + numeroCampo('vencimento', 'Dia do vencimento', cartao?.vencimento ?? 15, 1, 31);
  const salvar = cartao
    ? gravar(`/api/cartoes/${cartao.id}`, 'Cartão atualizado.')
    : gravar('/api/cartoes', 'Cartão cadastrado.');
  abrir(cartao ? 'Editar cartão' : 'Novo cartão', campos, salvar, 'Salvar', preencherNomeDoBanco);
}

function confirmarExclusaoCartao(id) {
  const cartao = dadosPagina.cartoes.find(item => item.id === id);
  abrir('Excluir cartão', `<p class="sinal saida">Excluir <strong>${h(cartao.nome)}</strong>?</p>
    <p>Cartões com faturas ou compromissos vinculados serão arquivados para preservar o histórico e os pagamentos pendentes. Um cartão sem vínculos será excluído definitivamente.</p>`
    + senhaParaExcluir(), async dados => {
    const resultado = await api(`/api/cartoes/${id}/excluir`, dados);
    janela.close();
    mostrarAviso(resultado.arquivado ? 'Cartão arquivado.' : 'Cartão excluído.');
    await carregar();
  }, 'Excluir');
}

async function formularioCompra() {
  const dados = aba === 'cartoes' ? dadosPagina : await api('/api/cartoes');
  const cartoes = dados.cartoes.filter(cartao => !cartao.arquivado);
  if (!prepararCadastro(cartoes.length, 'Cadastre um cartão', 'cartoes')) return;
  if (!prepararCadastro(base.categorias.length, 'Cadastre uma categoria', 'contas')) return;
  const campos = escolha('cartao', 'Cartão', cartoes, cartoes[0].id, { comBanco: true }) + diaCampo('data', 'Data da compra')
    + textoCampo('descricao', 'Descrição', '', 240) + categoriaCampo() + valorCampo('valor', 'Valor total em reais')
    + numeroCampo('parcelas', 'Número de parcelas', 1, 1, 120);
  abrirComRascunho('/api/compras', 'Registrar compra no cartão', campos, gravar('/api/compras', 'Compra registrada.'));
}

function tabelaParcelasCompra(itens) {
  return tabela(['Parcela', 'Cartão', 'Vencimento', 'Valor', 'Situação'], itens.map(item => [
    `${item.numero ?? '—'}/${item.parcelas ?? '—'}`, h(item.nome_cartao), dataBr(item.vencimento), dinheiro(item.valor),
    item.pagamento ? 'Paga · preservada' : 'Pendente'
  ]), 'Nenhuma parcela.');
}

function tabelaImpactosCompra(impactos) {
  return tabela(['Cartão', 'Fechamento', 'Vencimento', 'Fatura antes', 'Fatura depois'], impactos.map(item => [
    h(item.nome_cartao), dataBr(item.fechamento), dataBr(item.vencimento), dinheiro(item.antes), dinheiro(item.depois)
  ]), 'Nenhuma fatura afetada.');
}

function tabelaLimitesCompra(limites) {
  return tabela(['Cartão', 'Limite disponível antes', 'Limite disponível depois'], limites.map(item => [
    h(item.nome_cartao), dinheiro(item.disponivel_antes), dinheiro(item.disponivel_depois)
  ]), 'Nenhum limite afetado.');
}

async function editarCompraCartao(id, preenchido) {
  const compra = await api(`/api/compras/${id}`);
  if (!compra.completa || !compra.pendentes) {
    abrir('Compra · ' + compra.descricao, `<p>${compra.pendentes ? 'Este registro antigo não tem uma sequência completa de parcelas. A edição da compra inteira está bloqueada para evitar associar registros incorretos.' : 'Esta compra está quitada. Seus pagamentos e o histórico serão preservados.'}</p>`
      + tabelaParcelasCompra(compra.itens) + (compra.pendentes ? botao('Excluir este registro pendente', 'excluir-compra', id, 'perigo') : ''));
    return;
  }
  const dados = preenchido ?? { cartao: compra.cartao, categoria: compra.categoria, data: compra.data,
    descricao: compra.descricao, parcelas: compra.parcelas, valor: compra.valor_pendente };
  const cartoes = (await api('/api/cartoes')).cartoes.filter(cartao => !cartao.arquivado);
  const parcial = compra.pagas > 0;
  const aviso = parcial ? `<p class="sinal pendente">${compra.pagas} parcela(s) paga(s) serão preservadas. Você está corrigindo somente as ${compra.pendentes} pendentes. A data e a quantidade original de parcelas não serão alteradas.</p>`
    : '<p>A alteração afeta a compra inteira e todas as suas parcelas ainda não pagas.</p>';
  const campos = aviso + tabelaParcelasCompra(compra.itens)
    + escolha('cartao', parcial ? 'Cartão das parcelas pendentes' : 'Cartão correto', cartoes, dados.cartao, { comBanco: true })
    + diaCampo('data', 'Data da compra', dados.data, base.hoje, parcial ? 'readonly' : '')
    + textoCampo('descricao', parcial ? 'Descrição das parcelas pendentes' : 'Descrição', dados.descricao, 240)
    + categoriaCampo(dados.categoria)
    + valorCampo('valor', parcial ? 'Valor total das parcelas pendentes' : 'Valor total da compra', dados.valor)
    + campo('parcelas', parcial ? 'Quantidade original de parcelas' : 'Número de parcelas', dados.parcelas, 'number', `data-formato="numero" required min="1" max="120" ${parcial ? 'readonly' : ''}`)
    + botao(parcial ? 'Excluir parcelas pendentes' : 'Excluir compra', 'excluir-compra', id, 'perigo');
  abrir('Editar compra', campos, async dadosNovos => {
    const previa = await api(`/api/compras/${id}/previa`, dadosNovos);
    abrir('Revisar alteração da compra', `<p><strong>${h(dadosNovos.descricao)}</strong></p>
      <p>${parcial ? 'Somente as parcelas pendentes serão corrigidas. As pagas continuam no cartão e nas faturas originais.' : 'Confira como a compra ficará distribuída e os novos totais das faturas.'}</p>`
      + tabelaParcelasCompra(previa.novos) + '<h3>Impacto nas faturas</h3>' + tabelaImpactosCompra(previa.impactos) + '<h3>Limites dos cartões</h3>' + tabelaLimitesCompra(previa.limites)
      + '<button type="button" class="botao" data-voltar-compra>Voltar aos dados</button>', async confirmacao => {
        await api(`/api/compras/${id}`, { ...dadosNovos, chave: confirmacao.chave, revisao: previa.revisao, confirmar: true });
        janela.close(); mostrarAviso('Compra corrigida. Faturas e limites atualizados.'); await carregar();
      }, 'Confirmar alterações', form => {
        form.querySelector('[data-voltar-compra]').onclick = () => {
          if (!form.dataset.enviando) editarCompraCartao(id, dadosNovos).catch(erro => mostrarAviso(erro.message));
        };
      });
  }, 'Revisar alterações');
}

async function excluirCompraCartao(id) {
  let previa;
  try { previa = await api(`/api/compras/${id}/previa-exclusao`, {}); }
  catch (erro) {
    if (erro.status !== 409) throw erro;
    abrir('Exclusão da compra', `<p>${h(erro.message)}</p>`); return;
  }
  const compra = previa.compra;
  const parcial = previa.escopo === 'pendentes';
  const titulo = parcial ? 'Excluir parcelas pendentes' : previa.escopo === 'registro-antigo' ? 'Excluir registro antigo' : 'Excluir compra';
  const aviso = parcial ? `${compra.pendentes} parcela(s) pendente(s) serão excluídas. As ${compra.pagas} pagas e seus pagamentos serão preservados.`
    : previa.escopo === 'registro-antigo' ? 'Apenas este registro antigo será excluído. Ele não foi associado com segurança às demais parcelas.'
    : `A compra inteira e suas ${compra.pendentes} parcela(s) pendente(s) serão excluídas.`;
  abrir(titulo, `<p><strong>${h(compra.descricao)}</strong> · ${h(compra.nome_cartao)}</p><p class="sinal saida">${h(aviso)}</p>`
    + tabelaParcelasCompra(compra.itens) + '<h3>Impacto nas faturas</h3>' + tabelaImpactosCompra(previa.impactos) + '<h3>Limites dos cartões</h3>' + tabelaLimitesCompra(previa.limites)
    + '<p>Esta ação remove registros do site. Não cancela nem estorna a compra no banco.</p>'
    + campo('senha', 'Sua senha atual', '', 'password', 'required autocomplete="current-password"')
    + '<label class="confirmar-datas"><input type="checkbox" name="confirmar" required> Entendi quais parcelas serão excluídas e quero continuar.</label>', async dados => {
      await api(`/api/compras/${id}/excluir`, { ...dados, confirmar: dados.confirmar === 'on', revisao: previa.revisao });
      janela.close(); mostrarAviso(parcial ? 'Parcelas pendentes excluídas. Pagamentos preservados.' : 'Compra excluída. Faturas e limites atualizados.'); await carregar();
    }, parcial ? 'Excluir pendentes' : 'Excluir compra');
}

async function verFatura(id, corrigir = false) {
  const fatura = await api(`/api/faturas/${id}`);
  const cabecalho = `<p>Fecha em ${dataBr(fatura.fechamento)} e vence em ${dataBr(fatura.vencimento)}.</p>`;
  const itens = lista(fatura.itens.map(item => linha(
    `<strong>${h(item.descricao)}${item.parcelas > 1 ? ` · ${item.numero}/${item.parcelas}` : ''}</strong>${subtitulo(`${dataBr(item.data)} · ${item.categoria}`)}`,
    `<span>${dinheiro(item.valor)}</span>${item.compra ? botao('Editar compra', 'editar-compra', item.compra) + botao('Excluir compra', 'excluir-compra', item.compra, 'perigo') : ''}${item.ocorrencia && !fatura.pagamento ? botao('Ajustar valor', 'ocorrencia', item.ocorrencia) : ''}`
  )), 'Nenhuma compra nesta fatura.');
  const total = `<p>Total da fatura <strong>${dinheiro(fatura.valor)}</strong></p>`;
  const fechado = fatura.fechamento <= base.hoje;
  const podePagar = !perfilAberto && Boolean(fatura.pagamento) === corrigir && fechado && contasBancarias().length && fatura.valor > 0;
  let campos = '';
  if (podePagar) campos = contaCampo('conta', 'Conta do pagamento', fatura.origem) + diaCampo('data', 'Data do pagamento', fatura.pago_em ?? base.hoje);
  else if (fatura.pagamento) campos = `<p>Quitada em ${dataBr(fatura.pago_em)}.</p>` + botao('Corrigir pagamento', 'fatura-corrigir', id);
  else if (!fechado) campos = '<p class="suave">A quitação fica disponível no fechamento.</p>';
  else if (!contasBancarias().length) campos = link('Cadastrar conta', 'contas');
  const ajustar = fatura.pagamento ? '' : `<div class="acoes">${botao('Corrigir datas da fatura', 'fatura-datas', id)}</div>`;
  const rota = `/api/faturas/${id}${corrigir ? '/corrigir' : ''}`;
  abrirComRascunho(rota, `Fatura · ${fatura.nome}`, cabecalho + ajustar + itens + total + campos,
    podePagar ? gravar(rota, corrigir ? 'Pagamento corrigido.' : 'Fatura quitada.', { valor: fatura.valor }) : undefined,
    corrigir ? 'Salvar correção' : 'Quitar fatura');
}

async function formularioDatasFatura(id) {
  const fatura = await api(`/api/faturas/${id}`);
  const ultimaCompra = fatura.itens.reduce((ultima, item) => item.data > ultima ? item.data : ultima, '');
  const campos = '<p>Confira as datas desta fatura no aplicativo do cartão.</p>'
    + diaCampo('fechamento', 'Data do fechamento', fatura.fechamento, null)
    + diaCampo('vencimento', 'Data do vencimento', fatura.vencimento, null)
    + `<div data-aviso-datas hidden>
      <p class="sinal saida">A última compra desta fatura foi registrada em ${dataBr(ultimaCompra)}, após o fechamento informado.</p>
      <label class="confirmar-datas"><input type="checkbox" name="confirmar_datas" disabled>
        Confirmei as datas no aplicativo do cartão.
      </label>
    </div>`;
  const salvar = gravar(`/api/faturas/${id}/datas`, 'Datas da fatura atualizadas.');
  abrir(`Corrigir datas · ${fatura.nome}`, campos,
    dados => salvar({ ...dados, confirmar_datas: dados.confirmar_datas === 'on' }), 'Salvar', formulario => {
      const fechamento = formulario.elements.fechamento;
      const confirmacao = formulario.elements.confirmar_datas;
      const aviso = formulario.querySelector('[data-aviso-datas]');
      const atualizarAviso = () => {
        const dataAnterior = Boolean(fechamento.value && fechamento.value < ultimaCompra);
        aviso.hidden = confirmacao.disabled = !dataAnterior;
        confirmacao.required = dataAnterior;
        confirmacao.checked = false;
      };
      fechamento.addEventListener('input', atualizarAviso);
      atualizarAviso();
    });
}

async function formularioPlano(tipo) {
  const mensal = tipo === 'mensal';
  const avulso = tipo === 'avulso';
  const cartoes = mensal ? (await api('/api/cartoes')).cartoes.filter(cartao => !cartao.arquivado) : [];
  const bancos = contasBancarias();
  if (!prepararCadastro(bancos.length || (tipo === 'mensal' && cartoes.length), 'Cadastre uma conta para o pagamento', 'contas')) return;
  if (!prepararCadastro(base.categorias.length, 'Cadastre uma categoria', 'contas')) return;
  const meios = bancos.map(conta => ({ ...conta, id: `conta:${conta.id}` }));
  if (mensal) meios.push(...cartoes.map(cartao => ({
    id: `cartao:${cartao.id}`, nome: `Cartão · ${cartao.nome}`, banco: identificarBanco(cartao)
  })));
  const campos = textoCampo('nome', 'Nome') + categoriaCampo() + valorCampo('valor', mensal ? 'Valor mensal previsto' : 'Valor total em reais')
    + diaCampo('inicio', avulso ? 'Vencimento' : 'Primeiro vencimento', base.hoje, null)
    + escolha('meio', 'Forma de pagamento', meios, meios[0].id, { numeros: false, comBanco: true })
    + (tipo === 'parcelado' ? numeroCampo('quantidade', 'Número de parcelas', 2, 2, 120) : '');
  const titulo = avulso ? 'Novo pagamento avulso' : mensal ? 'Nova recorrência' : 'Parcelar pela conta';
  abrirComRascunho(`/api/compromissos:${tipo}`, titulo, campos, async ({ meio, ...dados }) => {
    const [nome, id] = meio.split(':');
    await gravar('/api/compromissos', 'Compromisso salvo.', { tipo, [nome]: Number(id) })(dados);
  });
}

async function verOcorrencia(id, corrigir = false) {
  const dados = aba === 'compromissos' ? dadosPagina : await api('/api/compromissos');
  const item = dados.ocorrencias.find(item => item.id === id);
  if (!item) throw new Error('Cobrança não encontrada. Atualize a página.');
  const resumo = `<p>Vencimento em ${dataBr(item.vencimento)} · previsto ${dinheiro(item.previsto)}.</p>`;
  const pago = item.pagamento_conta || item.pagamento_cartao;
  if (perfilAberto) {
    abrir(item.nome, resumo + (pago ? `<p>Pago em ${dataBr(pago)} · ${dinheiro(item.confirmado ?? item.previsto)}.</p>` : '<p>Pagamento pendente. Consulta sem alterações.</p>'));
  } else if (pago && !corrigir) {
    abrir(item.nome, `${resumo}<p>Pago em ${dataBr(pago)} · ${dinheiro(item.confirmado ?? item.previsto)}.</p>
      ${item.fatura ? botao('Abrir fatura', 'fatura', item.fatura) : botao('Corrigir pagamento', 'ocorrencia-corrigir', id)}`);
  } else if (item.cartao) {
    abrir(item.nome, resumo + '<p>A quitação será feita na fatura do cartão.</p>'
      + botao('Abrir fatura', 'fatura', item.fatura) + valorCampo('valor', 'Valor cobrado', item.confirmado ?? item.previsto),
    gravar(`/api/ocorrencias/${id}`, 'Valor atualizado na fatura.'));
  } else {
    const rota = `/api/ocorrencias/${id}${corrigir ? '/corrigir' : ''}`;
    abrirComRascunho(rota, item.nome, resumo + contaCampo('conta', 'Conta', item.conta_pagamento ?? item.conta) + diaCampo('data', 'Data do pagamento', pago ?? base.hoje)
      + valorCampo('valor', 'Valor efetivamente pago', item.confirmado ?? item.previsto),
    gravar(rota, corrigir ? 'Pagamento corrigido.' : 'Pagamento registrado.'),
    corrigir ? 'Salvar correção' : 'Registrar pagamento');
  }
}

function editarCobranca(id) {
  const item = dadosPagina.ocorrencias.find(cobranca => cobranca.id === id);
  if (item.pagamento || item.cartao) return verOcorrencia(id, Boolean(item.pagamento));
  const campos = diaCampo('vencimento', 'Vencimento', item.vencimento, null)
    + valorCampo('valor', 'Valor previsto', item.previsto);
  abrir(`Editar cobrança · ${item.nome}`, campos, gravar(`/api/ocorrencias/${id}/editar`, 'Cobrança atualizada.'));
}

function confirmarExclusaoCobranca(id) {
  const item = dadosPagina.ocorrencias.find(cobranca => cobranca.id === id);
  const resumo = `Excluir a cobrança de ${item.nome} com vencimento em ${dataBr(item.vencimento)}?`;
  const aviso = item.pagamento ? ' O pagamento registrado será removido e o saldo e os relatórios serão recalculados.' : '';
  confirmarExclusao('Excluir cobrança', resumo + aviso, `/api/ocorrencias/${id}/excluir`,
    { confirmar_pago: Boolean(item.pagamento) }, 'Cobrança excluída.');
}

async function acaoPush(acao) {
  if (acao === 'ativar') {
    if (Notification.permission === 'denied') throw new Error('Permita as notificações nas configurações do navegador ou do celular.');
    const publica = dadosPagina.chave.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(dadosPagina.chave.length / 4) * 4, '=');
    const applicationServerKey = Uint8Array.from(atob(publica), byte => byte.charCodeAt(0));
    const inscricaoPush = await registroPush.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    await api('/api/notificacoes/ativar', inscricaoPush.toJSON());
    mostrarAviso('Avisos ativados neste dispositivo.');
    await carregar();
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration('/');
  const inscricao = await reg?.pushManager.getSubscription();
  if (!inscricao) throw new Error('Ative os avisos neste dispositivo primeiro.');
  try {
    await api(`/api/notificacoes/${acao}`, { endpoint: inscricao.endpoint });
  } catch (erro) {
    if (acao !== 'desativar' || erro.status !== 404) throw erro;
  }
  if (acao === 'desativar') await inscricao.unsubscribe();
  mostrarAviso(acao === 'testar' ? 'Aviso de teste enviado ao serviço do navegador.' : 'Avisos desativados.');
  if (acao === 'desativar') await carregar();
}

const acoes = {
  'menu-movel': abrirMenuMovel,
  'aprovar-senha': (_, id) => analisarSenha(id, 'aprovada'),
  'recusar-senha': (_, id) => analisarSenha(id, 'recusada'),
  'meu-perfil': () => { location.hash = 'perfil'; },
  'limpar-meus-dados': () => confirmarRemocaoPerfil(false),
  'excluir-minha-conta': () => confirmarRemocaoPerfil(true),
  'copiar-endereco': copiarEndereco,
  'qr-rede': abrirQrRede,
  'detalhar-previsao': detalharPrevisao,
  'detalhar-saidas': detalharSaidas,
  'relatorio-detalhe': tipo => detalharRelatorio(tipo),
  'relatorio-categoria': (_, id) => detalharRelatorio('saidas', id),
  'detalhar-patrimonio': detalharPatrimonio,
  'conta-destaque': () => {
    const contas = contasBancarias();
    const atual = contas.find(conta => conta.id === dadosPagina.conta_destaque) ?? contas[0];
    abrir('Conta em destaque', escolha('conta', 'Conta', contas, atual?.id, { comBanco: true }),
      gravar('/api/painel/conta-destaque', 'Conta em destaque atualizada.'));
  },
  tutorial: abrirTutorial,
  'recarregar-perfis': mostrarLogin,
  'escolher-perfil': (_, id) => pedirSenhaPerfil(perfis.find(perfil => perfil.id === id)),
  'entrar-login': entrarComLogin,
  'cadastro-publico': cadastrarAcesso,
  'recuperar-senha': pedirRecuperacao,
  'concluir-recuperacao': concluirRecuperacaoUI,
  'grupo-criar': criarFamiliaUI,
  'grupo-entrar': solicitarEntradaUI,
  'grupo-cancelar': () => gravar('/api/grupo/entrada/cancelar', 'Pedido cancelado.')({}),
  'grupo-autorizar': alterarConsentimento,
  'entrada-aprovar': (_, id) => decidirEntradaUI(id, 'aprovado'),
  'entrada-recusar': (_, id) => decidirEntradaUI(id, 'recusado'),
  'acesso-solicitar': (_, id) => solicitarAcessoUI(id),
  'acesso-aprovar': (_, id) => decidirAcessoUI(id, 'aprovado'),
  'acesso-recusar': (_, id) => decidirAcessoUI(id, 'recusado'),
  'acesso-revogar': (_, id) => decidirAcessoUI(id, 'revogado'),
  'recuperacao-liberar': (_, id) => liberarRecuperacaoUI(id),
  'familia-sair': () => alterarFamiliaUI('sair'),
  'familia-remover': (_, id) => alterarFamiliaUI('remover', id),
  'familia-transferir': (_, id) => alterarFamiliaUI('transferir', id),
  'familia-encerrar': () => alterarFamiliaUI('encerrar'),
  'selecionar-familia': selecionarFamiliaUI,
  'adicionar-perfil': () => {
    if (podeInicializar) formularioUsuario(undefined, true);
    else cadastrarAcesso();
  },
  tema: async () => {
    const dados = await api('/api/tema', { tema: usuario.tema === 'claro' ? 'escuro' : 'claro' });
    usuario.tema = dados.tema;
    // Mantém os elementos e o foco: a troca não precisa reconstruir a página.
    const raiz = document.documentElement;
    raiz.classList.add('trocando-tema');
    aplicarPreferencias(usuario);
    const interruptor = app.querySelector('.interruptor-tema');
    interruptor?.setAttribute('aria-checked', String(dados.tema === 'escuro'));
    if (interruptor) interruptor.title = dados.tema === 'escuro' ? 'Ativar modo claro' : 'Ativar modo escuro';
    const campoTema = document.querySelector('[data-painel-perfil="aparencia"] [name="tema"]');
    if (campoTema) campoTema.value = dados.tema;
    const previa = document.querySelector('[data-previa-perfil]');
    if (previa) previa.dataset.tema = dados.tema;
    clearTimeout(acoes.tema.fimTransicao);
    acoes.tema.fimTransicao = setTimeout(() => raiz.classList.remove('trocando-tema'), 550);
  },
  sair: async () => {
    await api('/api/sair', {});
    await mostrarLogin();
  },
  conta: formularioConta,
  'editar-conta': (_, id) => editarConta(id),
  categoria: () => formularioCategoria(),
  'editar-categoria': (_, id) => formularioCategoria(base.categorias.find(categoria => categoria.id === id)),
  'excluir-categoria': (_, id) => confirmarExclusaoCategoria(id),
  movimento: tipo => formularioMovimento(tipo),
  salario: () => formularioSalario(),
  patrimonio: formularioPatrimonio,
  editar: (_, id) => {
    const item = dadosPagina.find(item => item.id === id);
    if (item.tipo === 'salario') formularioSalario(item);
    else formularioMovimento(item.tipo, item);
  },
  excluir: (_, id) => confirmarExclusao('Excluir lançamento', 'O lançamento será removido e o saldo e os relatórios serão recalculados.',
    `/api/lancamentos/${id}/excluir`, {}, 'Lançamento excluído.'),
  cartao: () => formularioCartao(),
  'editar-cartao': (_, id) => formularioCartao(dadosPagina.cartoes.find(cartao => cartao.id === id)),
  'excluir-cartao': (_, id) => confirmarExclusaoCartao(id),
  'restaurar-cartao': (_, id) => gravar(`/api/cartoes/${id}/restaurar`, 'Cartão restaurado.')({ chave: chave() }),
  compra: formularioCompra,
  'editar-compra': (_, id) => editarCompraCartao(id),
  'excluir-compra': (_, id) => excluirCompraCartao(id),
  fatura: (_, id) => verFatura(id),
  'fatura-corrigir': (_, id) => verFatura(id, true),
  'fatura-datas': (_, id) => formularioDatasFatura(id),
  plano: formularioPlano,
  ocorrencia: (_, id) => verOcorrencia(id),
  'editar-cobranca': (_, id) => editarCobranca(id),
  'excluir-cobranca': (_, id) => confirmarExclusaoCobranca(id),
  'ocorrencia-corrigir': (_, id) => verOcorrencia(id, true),
  'encerrar-plano': (_, id) => confirmar('Encerrar recorrência', 'As próximas cobranças serão canceladas. O histórico de pagamentos será mantido.',
    `/api/compromissos/${id}/encerrar`, {}, 'Recorrência encerrada.'),
  'arquivar-plano': (_, id) => gravar(`/api/compromissos/${id}/arquivar`, 'Recorrência retirada da lista.')({ chave: chave() }),
  'restaurar-plano': (_, id) => gravar(`/api/compromissos/${id}/restaurar`, 'Recorrência restaurada na lista.')({ chave: chave() }),
  usuario: cadastrarAcesso,
  'editar-perfil': (_, id) => formularioUsuario(dadosPagina.usuarios.find(item => item.id === id)),
  'abrir-perfil': async (_, id) => {
    perfilAberto = (dadosPagina.usuarios ?? dadosPagina.membros).find(item => item.id === id);
    limparTelaFinanceira();
    app.innerHTML = '<p class="carregando">Abrindo perfil…</p>';
    history.replaceState(null, '', '#inicio');
    await carregar();
  },
  'sair-perfil-aberto': async () => {
    perfilAberto = undefined;
    limparTelaFinanceira();
    app.innerHTML = '<p class="carregando">Voltando à administração…</p>';
    history.replaceState(null, '', '#familia');
    await carregar();
  },
  atividade: (_, id) => {
    const item = dadosPagina.usuarios.find(item => item.id === id);
    const verbo = item.ativo ? 'Desativar' : 'Reativar';
    abrir(verbo + ' usuário', `<p>${verbo} o acesso de ${h(item.nome)}?</p>` + senhaAtual('senha_admin'), gravar('/api/admin/atividade', 'Situação atualizada.', { id, ativo: !item.ativo }));
  },
  'sessao-encerrar': id => confirmar('Encerrar sessão', 'O dispositivo precisará fazer login novamente.',
    '/api/admin/sessoes/encerrar', { id }, 'Sessão encerrada.'),
  'push-ativar': () => acaoPush('ativar'),
  'push-testar': () => acaoPush('testar'),
  'push-desativar': () => acaoPush('desativar')
};

async function clicar(evento) {
  const alvo = evento.target.closest('[data-acao]');
  if (!alvo) {
    if (janela.open && evento.target.closest('a[href^="#"]')) janela.close();
    return;
  }
  const acao = acoes[alvo.dataset.acao];
  if (!acao || alvo.disabled) return;
  const menuCartao = alvo.closest('.menu-cartao');
  if (menuCartao) {
    menuCartao.open = false;
    menuCartao.querySelector('summary').focus();
  }
  alvo.disabled = true;
  try {
    await acao(alvo.dataset.id, Number(alvo.dataset.id));
  } catch (erro) {
    if (erro.status === 401) mostrarLogin();
    else mostrarAviso(erro.message);
  } finally {
    alvo.disabled = false;
  }
}

app.addEventListener('click', clicar);
janela.addEventListener('click', clicar);
document.addEventListener('change', evento => {
  const seletor = evento.target.closest('.seletor-com-banco select');
  if (!seletor) return;
  const opcao = seletor.selectedOptions[0];
  seletor.parentElement.querySelector('[data-icone-banco]').innerHTML =
    iconeBanco(opcao?.dataset.banco, opcao?.dataset.icone);
});
document.addEventListener('click', evento => {
  for (const menu of app.querySelectorAll('.menu-cartao[open], .menu-mais[open]')) {
    if (!menu.contains(evento.target) || evento.target.closest('.menu-mais a')) menu.open = false;
  }
});
app.addEventListener('keydown', evento => {
  if (evento.key !== 'Escape') return;
  const menu = evento.target.closest('.menu-cartao[open], .menu-mais[open]');
  if (menu) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});

function clicouNoFundo(evento) {
  if (!janela.open || evento.target !== janela) return false;
  const { left, top, right, bottom } = janela.getBoundingClientRect();
  return evento.clientX < left || evento.clientX >= right || evento.clientY < top || evento.clientY >= bottom;
}

let pressionouForaDaJanela = false;
janela.addEventListener('pointerdown', evento => {
  pressionouForaDaJanela = clicouNoFundo(evento);
});
janela.addEventListener('pointercancel', () => {
  pressionouForaDaJanela = false;
});
janela.addEventListener('click', evento => {
  const clicouFora = pressionouForaDaJanela && clicouNoFundo(evento);
  pressionouForaDaJanela = false;
  const formulario = janela.querySelector('form');
  if (clicouFora && !formulario?.dataset.enviando) {
    guardarRascunho.get(formulario)?.();
    janela.close();
  }
});

addEventListener('hashchange', () => { fecharMenuMovel(false); carregar(); });
addEventListener('resize', () => { if (aba === 'relatorios' && usuario) desenharGrafico(dadosPagina); });
setInterval(atualizarQrRede, 5000);
function atualizarDiaDoPainel() {
  if (!document.hidden && usuario && aba === 'inicio' && !janela.open && base?.hoje
    && base.hoje !== calendarioPainel.format(new Date())) carregar();
}
setInterval(atualizarDiaDoPainel, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    atualizarQrRede();
    atualizarDiaDoPainel();
  }
});

try {
  usuario = await api('/api/sessao');
  await carregar();
} catch (erro) {
  await mostrarLogin();
  if (erro.status !== 401) mostrarAviso(erro.message);
}
