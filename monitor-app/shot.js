// print invisivel da tela (teste): electron shot.js <saida.png> [dark]
const { app, BrowserWindow, nativeTheme } = require('electron');
process.argv.includes('dark') && (nativeTheme.themeSource = 'dark');
process.env.TANQUE_PRINT = '1';
require('./main.js');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 480, height: 840, webPreferences: { preload: __dirname + '/preload.js', offscreen: true } });
  await w.loadFile(__dirname + '/../context-monitor.html');
  await new Promise(r => setTimeout(r, 4000));
  const forcar = process.argv.find(a => /^[0-9]+$/.test(a));
  if (forcar) { await w.webContents.executeJavaScript(`for (let i = 1; i < 99; i++) clearInterval(i); setInterval(() => { ctx.clearRect(0, 0, 110, 75); Clawd.desenhar(ctx, humor, tique++, 5, 2, 3.5); }, 280); humor = Clawd.humor(${forcar}); $('chat').className = 'principal perigo ' + humor; $('nivel').style.height = '${forcar}%'; posicionarClawd(${forcar}); $('pct').innerHTML = '${forcar}<small>%</small>';`); await new Promise(r => setTimeout(r, 1500)); }
  require('fs').writeFileSync(process.argv.find(a => a.endsWith('.png')), (await w.capturePage()).toPNG());
  app.quit();
});
