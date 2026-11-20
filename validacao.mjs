import { bancos } from './publico/bancos.mjs';

export class ErroAplicacao extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function exigir(condicao, mensagem, status = 422) {
  if (!condicao) throw new ErroAplicacao(status, mensagem);
}

export function texto(valor, rotulo, maximo = 120) {
  exigir(typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= maximo, `Confira o campo ${rotulo}.`);
  return valor.trim();
}

export function inteiro(valor, rotulo, minimo = 1, maximo = 9_000_000_000_000) {
  exigir(Number.isSafeInteger(valor) && valor >= minimo && valor <= maximo, `Confira o campo ${rotulo}.`);
  return valor;
}

export function data(valor) {
  exigir(typeof valor === 'string' && /^(19\d\d|20\d\d|21\d\d)-\d\d-\d\d$/.test(valor), 'Informe uma data válida.');
  const instante = new Date(`${valor}T00:00:00Z`);
  exigir(Number.isFinite(instante.valueOf()) && instante.toISOString().slice(0, 10) === valor, 'Informe uma data válida.');
  return valor;
}

const calendario = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });
export const hoje = () => calendario.format(new Date());

export function somarDias(dia, quantidade) {
  const instante = new Date(`${dia}T00:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + quantidade);
  return instante.toISOString().slice(0, 10);
}

export function somarMeses(mes, quantidade) {
  const instante = new Date(`${mes}-01T00:00:00Z`);
  instante.setUTCMonth(instante.getUTCMonth() + quantidade);
  return instante.toISOString().slice(0, 7);
}

export function diaNoMes(mes, dia) {
  const ultimo = Number(somarDias(`${somarMeses(mes, 1)}-01`, -1).slice(8));
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}
export function validarBanco(valor) {
  if (valor === undefined) return null;
  exigir(bancos.some(banco => banco.id === valor), 'Selecione um banco ou a opção Outro.');
  return valor;
}

