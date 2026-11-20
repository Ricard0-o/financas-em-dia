export const bancos = [
  { id: 'nubank', nome: 'Nubank', icone: '/banco-nubank.png' },
  { id: 'santander', nome: 'Santander', icone: '/banco-santander.png' },
  { id: 'mercado-pago', nome: 'Mercado Pago', icone: '/banco-mercado-pago.png' },
  { id: 'outro', nome: 'Outro' }
];

const normalizarNome = nome => nome.toLowerCase().replace(/[^a-z]/g, '');

export function identificarBanco({ banco, nome = '' }) {
  return banco ?? bancos.find(item => item.icone && normalizarNome(item.nome) === normalizarNome(nome))?.id ?? 'outro';
}
