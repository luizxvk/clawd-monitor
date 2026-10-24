// Clawd em pixel, tirado do desenho do terminal do Claude Code:
//    ▐▛███▜▌
//   ▝▜█████▛▘
//     ▘▘ ▝▝
// Cada meio-bloco vira um "pixel" de 1 x 2 unidades (o caractere do terminal e' alto).
// Usado pela tela (canvas) e pelo processo principal (icone animado da barra de tarefas).
(function (raiz) {
  const COR = { corpo: '#D77757', olho: '#141413', suor: '#6A9BCC' };

  // humor pelo % de contexto
  const humor = pct => (pct >= 65 ? 'sufocado' : pct >= 40 ? 'medio' : 'feliz');

  // retangulos [x, y, w, h, cor] em unidades; corpo ocupa x 0..18, y 0..10
  function quadro(estado, t, suando) {
    const r = [];
    const c = COR.corpo, o = COR.olho;
    let dx = 0, dy = 0;
    if (estado === 'feliz') dy = t % 2 ? -1 : 0;
    if (estado === 'sufocado') dx = t % 2 ? 0.5 : -0.5;

    // corpo
    r.push([3, 0, 12, 8, c]);
    // bracos
    if (estado === 'feliz') {
      r.push(t % 2 ? [1, 2, 2, 2, c] : [1, 4, 2, 2, c]);
      r.push(t % 2 ? [15, 4, 2, 2, c] : [15, 2, 2, 2, c]);
    } else if (estado === 'sufocado') {
      r.push([1, 2, 2, 2, c], [15, 2, 2, 2, c]); // bracos pra cima, empurrando a tampa
    } else {
      r.push([1, 4, 2, 2, c], [15, 4, 2, 2, c]);
    }
    // pernas (feliz: andando)
    const pernas = estado === 'feliz' && t % 2 ? [4, 6, 11, 13].map(x => x + (x < 9 ? -0.5 : 0.5)) : [4, 6, 11, 13];
    for (const x of pernas) r.push([x, 8, 1, 2, c]);

    // olhos
    if (estado === 'feliz') {
      for (const x of [4, 11]) r.push([x, 3, 1, 1, o], [x + 1, 2, 1, 1, o], [x + 2, 3, 1, 1, o]); // ^ ^
    } else if (estado === 'medio') {
      const pisca = t % 8 === 7;
      for (const x of [5, 12]) r.push(pisca ? [x - 0.5, 3.5, 2, 0.5, o] : [x, 3, 1, 1, o]); // meio fechado
    } else {
      for (const x of [4, 11]) r.push([x, 2, 1, 1, o], [x + 2, 2, 1, 1, o], [x + 1, 3, 1, 1, o], [x, 4, 1, 1, o], [x + 2, 4, 1, 1, o]); // x x
      r.push(t % 2 ? [8, 5.5, 2, 1.5, o] : [8, 6, 2, 0.5, o]); // boca puxando ar
    }
    // gota de suor: sufocado ou usuario num ritmo avancado
    if (estado === 'sufocado' || suando) r.push([17.5, (t % 4) - 1, 1, 1.5, COR.suor]);
    return r.map(([x, y, w, h, cor]) => [x + dx, y + dy, w, h, cor]);
  }

  // desenha num canvas 2D: escala em px por unidade, origem (ox, oy) em unidades
  function desenhar(ctx, estado, t, escala, ox, oy, suando) {
    for (const [x, y, w, h, cor] of quadro(estado, t, suando)) {
      ctx.fillStyle = cor;
      ctx.fillRect(Math.round((x + ox) * escala), Math.round((y + oy) * escala), Math.round(w * escala), Math.round(h * escala));
    }
  }

  // bitmap BGRA (para nativeImage.createFromBitmap do Electron)
  function bitmap(estado, t, tam, suando) {
    const buf = Buffer.alloc(tam * tam * 4);
    const escala = tam / 22;
    const ox = (22 - 18) / 2, oy = (22 - 10) / 2 + 1;
    for (const [x, y, w, h, cor] of quadro(estado, t, suando)) {
      const [R, G, B] = [1, 3, 5].map(i => parseInt(cor.slice(i, i + 2), 16));
      const x0 = Math.round((x + ox) * escala), y0 = Math.round((y + oy) * escala);
      const x1 = Math.round((x + w + ox) * escala), y1 = Math.round((y + h + oy) * escala);
      for (let py = Math.max(0, y0); py < Math.min(tam, y1); py++)
        for (let px = Math.max(0, x0); px < Math.min(tam, x1); px++) {
          const i = (py * tam + px) * 4;
          buf[i] = B; buf[i + 1] = G; buf[i + 2] = R; buf[i + 3] = 255;
        }
    }
    return buf;
  }

  const api = { COR, humor, quadro, desenhar, bitmap };
  if (typeof module !== 'undefined') module.exports = api;
  else raiz.Clawd = api;
})(this);
