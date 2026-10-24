// Tanque do Claude: janela propria (Electron), sem localhost nem navegador.
// Os dados saem direto do context-alert.js pelo processo principal.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const { usoDoTranscript, usoDaConta, lerConfig, salvarConfig, agendarRenovacao, LIMITES, LIMITE_USO } = require('../context-alert.js');
const Clawd = require('../clawd.js');

const PROJETOS = path.join(os.homedir(), '.claude', 'projects');
const RECENTE_MS = 6 * 60 * 60 * 1000;

// assunto + total de tokens do chat: le o arquivo inteiro, entao guarda por mtime
const cacheResumo = new Map();
function resumoDoChat(arq, mtime) {
  const c = cacheResumo.get(arq);
  if (c && c.mtime === mtime) return c;
  let titulo = '', tituloIa = '', primeira = '', total = 0, cwd = '';
  const vistos = new Set(), skills = new Set();
  let obsidian = false, graphifyUsado = false;
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    if (!cwd && l.includes('"cwd"')) { try { cwd = JSON.parse(l).cwd || ''; } catch {} }
    if (l.includes('"custom-title"')) { try { titulo = JSON.parse(l).customTitle || titulo; } catch {} continue; }
    if (l.includes('"ai-title"')) { try { tituloIa = JSON.parse(l).aiTitle || tituloIa; } catch {} continue; }
    // skill chamada pelo usuario com /nome
    const cmd = l.match(/<command-name>\/?([\w:-]+)<\/command-name>/);
    if (cmd) skills.add(cmd[1]);
    if (!primeira && l.includes('"type":"user"')) {
      try {
        const j = JSON.parse(l);
        const t = typeof j.message.content === 'string' ? j.message.content
          : (j.message.content.find(b => b.type === 'text') || {}).text;
        if (t && !t.startsWith('<')) primeira = t.slice(0, 60);
      } catch {}
      continue;
    }
    if (!l.includes('"usage"')) continue;
    try {
      const m = JSON.parse(l).message;
      if (!m || !m.usage) continue;
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type !== 'tool_use') continue;
        if (b.name === 'Skill' && b.input && b.input.skill) skills.add(b.input.skill);
        const entrada = JSON.stringify(b.input || '');
        if (/ObsidianBrain|obsidian/i.test(entrada)) obsidian = true;
        if (/graphify (query|path|explain|update)/.test(entrada)) graphifyUsado = true;
      }
      if (vistos.has(m.id)) continue; // cada bloco da resposta repete o mesmo usage
      vistos.add(m.id);
      const u = m.usage;
      total += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
    } catch {}
  }
  const graphify = !!cwd && fs.existsSync(path.join(cwd, 'graphify-out', 'graph.json'));
  const r = { mtime, assunto: titulo || tituloIa || primeira || 'Chat sem título', total, cwd,
    skills: [...skills], obsidian, graphify, graphifyUsado };
  cacheResumo.set(arq, r);
  return r;
}

// ritmo da sessao de 5 h: no passo atual, o limite acaba antes de renovar?
function ritmoDaSessao(sessao) {
  if (!sessao) return null;
  const renova = Date.parse(sessao.renova), inicio = renova - 5 * 3600e3;
  const passou = Date.now() - inicio;
  if (passou < 10 * 60e3 || sessao.pct < 5) return { nivel: 'leve' };
  const projetado = sessao.pct * (5 * 3600e3 / passou);
  const acaba = inicio + passou * (100 / sessao.pct);
  return { nivel: projetado >= 100 ? 'avancado' : projetado >= 60 ? 'moderado' : 'leve', acaba, projetado: Math.round(projetado) };
}

function sessoes() {
  const lista = [];
  for (const proj of fs.readdirSync(PROJETOS, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const dir = path.join(PROJETOS, proj.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const arq = path.join(dir, f);
      const mtime = fs.statSync(arq).mtimeMs;
      if (Date.now() - mtime > RECENTE_MS) continue;
      const r = usoDoTranscript(arq);
      if (!r) continue;
      const nome = proj.name.replace(/^[a-zA-Z]--/, '').split('-').filter(Boolean).pop() || proj.name;
      lista.push({ id: f.slice(0, 8), sessionId: f.slice(0, -6), arquivo: arq, projeto: nome, mtime, ...r, ...resumoDoChat(arq, mtime) });
    }
  }
  return lista.sort((a, b) => b.mtime - a.mtime).slice(0, 6);
}

// icone animado da barra de tarefas: o Clawd com o humor do chat atual
let humorAtual = 'feliz', suandoAtual = false;
const quadrosIcone = {};
function iconeQuadro(estado, t) {
  const k = estado + (t % 8) + suandoAtual;
  if (!quadrosIcone[k]) quadrosIcone[k] = nativeImage.createFromBitmap(Clawd.bitmap(estado, t % 8, 64, suandoAtual), { width: 64, height: 64 });
  return quadrosIcone[k];
}

ipcMain.handle('dados', async () => {
  const corpo = { limites: LIMITES, limiteUso: LIMITE_USO, sessoes: [], uso: null, config: lerConfig() };
  try { corpo.sessoes = sessoes(); } catch {}
  try { corpo.uso = await usoDaConta(); } catch {}
  corpo.ritmo = ritmoDaSessao(corpo.uso && corpo.uso.sessao);
  suandoAtual = !!corpo.ritmo && corpo.ritmo.nivel === 'avancado';
  if (corpo.sessoes[0]) humorAtual = Clawd.humor(corpo.sessoes[0].pct);
  if (corpo.config.retomar) corpo.config = seguirChatAtual(corpo.config, corpo.sessoes[0], corpo.uso);
  return corpo;
});

ipcMain.handle('config', (_e, mudanca) => {
  const c = { ...lerConfig(), ...mudanca };
  if (mudanca.retomar === false) c.continuar = null;
  salvarConfig(c);
  return c;
});

// "Retomar o chat atual": o alvo e' SEMPRE o chat atual, e a tarefa agendada
// acompanha o horario de renovacao da sessao de 5 h.
let agendadoPara = null;
function seguirChatAtual(cfg, atual, uso) {
  if (atual && (!cfg.continuar || cfg.continuar.sessionId !== atual.sessionId || cfg.continuar.assunto !== atual.assunto)) {
    cfg = { ...cfg, continuar: { sessionId: atual.sessionId, assunto: atual.assunto, cwd: atual.cwd, transcript: atual.arquivo } };
    salvarConfig(cfg);
  }
  const renova = uso && uso.sessao && uso.sessao.renova;
  if (renova && agendadoPara !== Math.round(Date.parse(renova) / 600000)) {
    agendadoPara = Math.round(Date.parse(renova) / 600000);
    agendarRenovacao('sessao', renova);
  }
  return cfg;
}

// TANQUE_PRINT: so registra os dados (print invisivel do shot.js), sem janela
if (!process.env.TANQUE_PRINT && !app.requestSingleInstanceLock()) app.quit();

if (!process.env.TANQUE_PRINT) app.whenReady().then(() => {
  if (app.isPackaged) {
    try { require('./instalar.js').instalar(path.join(__dirname, '..')); } catch (e) { console.error('instalar:', e); }
  }
  const win = new BrowserWindow({
    width: 480, height: 840, minWidth: 340, minHeight: 480,
    title: 'Tanque do Claude', autoHideMenuBar: true,
    icon: iconeQuadro('feliz', 0),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, '..', 'context-monitor.html'));
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });

  let t = 0;
  setInterval(() => { if (!win.isDestroyed()) win.setIcon(iconeQuadro(humorAtual, t++)); }, 280);
});

if (!process.env.TANQUE_PRINT) app.on('window-all-closed', () => app.quit());
