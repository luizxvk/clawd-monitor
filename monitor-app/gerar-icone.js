// Gera clawd.ico (atalho da Area de Trabalho) a partir do mesmo desenho do app.
// node gerar-icone.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Clawd = require('../clawd.js');

function png(tam) {
  const bgra = Clawd.bitmap('feliz', 0, tam);
  const linhas = Buffer.alloc(tam * (tam * 4 + 1));
  for (let y = 0; y < tam; y++) {
    linhas[y * (tam * 4 + 1)] = 0;
    for (let x = 0; x < tam; x++) {
      const i = (y * tam + x) * 4, o = y * (tam * 4 + 1) + 1 + x * 4;
      linhas[o] = bgra[i + 2]; linhas[o + 1] = bgra[i + 1]; linhas[o + 2] = bgra[i]; linhas[o + 3] = bgra[i + 3];
    }
  }
  const bloco = (tipo, dados) => {
    const t = Buffer.concat([Buffer.from(tipo), dados]);
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(t));
    return Buffer.concat([len, t, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}

const tamanhos = [16, 32, 48, 256];
const imgs = tamanhos.map(png);
const cab = Buffer.alloc(6 + 16 * imgs.length);
cab.writeUInt16LE(1, 2); cab.writeUInt16LE(imgs.length, 4);
let off = cab.length;
imgs.forEach((img, i) => {
  const e = 6 + 16 * i, t = tamanhos[i] === 256 ? 0 : tamanhos[i];
  cab[e] = t; cab[e + 1] = t; cab.writeUInt16LE(1, e + 4); cab.writeUInt16LE(32, e + 6);
  cab.writeUInt32LE(img.length, e + 8); cab.writeUInt32LE(off, e + 12);
  off += img.length;
});
fs.writeFileSync(path.join(__dirname, 'clawd.ico'), Buffer.concat([cab, ...imgs]));
fs.writeFileSync(path.join(__dirname, 'clawd.png'), imgs[3]);
console.log('clawd.ico gerado');
