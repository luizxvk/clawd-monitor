// Primeiro uso do .exe: copia os hooks pra ~/.claude/hooks e registra no ~/.claude/settings.json.
// Rodando do codigo (sem empacotar) nao faz nada: os arquivos ja estao no lugar.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ARQUIVOS = ['context-alert.js', 'clawd.js', 'toast.ps1', 'renovou.js', 'renovou.ps1'];
const EVENTOS = ['Stop', 'PostToolUse', 'UserPromptSubmit'];

function instalar(origem) {
  const claude = path.join(os.homedir(), '.claude');
  const destino = path.join(claude, 'hooks');
  fs.mkdirSync(destino, { recursive: true });
  for (const f of ARQUIVOS) fs.writeFileSync(path.join(destino, f), fs.readFileSync(path.join(origem, f)));

  const arqSettings = path.join(claude, 'settings.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(arqSettings, 'utf8')); } catch {}
  const comando = `node "${path.join(destino, 'context-alert.js').replace(/\\/g, '/')}"`;
  s.hooks = s.hooks || {};
  let mudou = false;
  for (const ev of EVENTOS) {
    s.hooks[ev] = s.hooks[ev] || [];
    const ja = s.hooks[ev].some(g => (g.hooks || []).some(h => String(h.command || '').includes('context-alert.js')));
    if (!ja) { s.hooks[ev].push({ hooks: [{ type: 'command', command: comando, timeout: 10 }] }); mudou = true; }
  }
  if (mudou) fs.writeFileSync(arqSettings, JSON.stringify(s, null, 2));
  return { destino, registrouHooks: mudou };
}

module.exports = { instalar };
