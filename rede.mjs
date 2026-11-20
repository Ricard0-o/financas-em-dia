import { networkInterfaces } from 'node:os';

export function enderecosDaRede(porta, protocolo, host, interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([interfaceRede, enderecos]) =>
    enderecos.filter(endereco => endereco.family === 'IPv4' && !endereco.internal
      && !endereco.address.startsWith('169.254.') && (host === '0.0.0.0' || host === endereco.address))
      .map(({ address }) => ({
        interface: interfaceRede,
        ip: address,
        url: `${protocolo}://${address}:${porta}/`
      })));
}

export function enderecoParaCelular(enderecos, ipLocal) {
  return enderecos.find(item => item.ip === ipLocal)
    ?? enderecos.find(item => /wi-?fi|wlan|wireless|sem fio/i.test(item.interface))
    ?? enderecos[0]
    ?? null;
}
