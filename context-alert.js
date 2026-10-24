#!/usr/bin/env node
// Monitor de contexto do Claude Code: roda como hook (Stop / PostToolUse / UserPromptSubmit).
// - toast do Windows aos 65% e 80% de contexto, uma vez por limite em cada sessao
// - aos 65% manda uma instrucao pro Claude: parar, escrever handoff no Obsidian, seguir em chat novo
// - toast aos 75% do limite da sessao de 5 h / semana, e agenda outro pra quando o limite renovar
//
// Teste manual:  node context-alert.js --test
// Ver o %:       node context-alert.js --status <caminho-do-transcript.jsonl>

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const LIMITES = (process.env.CLAUDE_CTX_ALERTS || '65,80').split(',').map(Number).filter(Boolean);
const JANELA_FIXA = Number(process.env.CLAUDE_CTX_WINDOW) || 0; // 0 = automatico
const ESTADO_DIR = path.join(os.tmpdir(), 'claude-context-alert');
// os hooks moram em ~/.claude/hooks; dentro do .exe (app.asar) aponta pra la' tambem
const BASE = __dirname.includes('app.asar') ? path.join(os.homedir(), '.claude', 'hooks') : __dirname;
const CONFIG = path.join(BASE, 'tanque-config.json');
const TOAST_PS1 = path.join(BASE, 'toast.ps1');

function lerConfig() {
  try { return { avisarClaude: true, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) }; }
  catch { return { avisarClaude: true }; }
}
function salvarConfig(c) { fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2)); }

function usoDoTranscript(arquivo) {
  // le so o fim do arquivo: a ultima resposta da conversa principal tem o tamanho atual do contexto
  const fd = fs.openSync(arquivo, 'r');
  const tam = fs.fstatSync(fd).size;
  const ler = Math.min(tam, 2 * 1024 * 1024);
  const buf = Buffer.alloc(ler);
  fs.readSync(fd, buf, 0, ler, tam - ler);
  fs.closeSync(fd);

  const linhas = buf.toString('utf8').split('\n');
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i];
    if (!l.includes('"usage"') || !l.includes('"assistant"')) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    if (j.type !== 'assistant' || j.isSidechain || !j.message || !j.message.usage) continue;
    const u = j.message.usage;
    const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (!tokens) continue;
    const modelo = String(j.message.model || '');
    let janela = JANELA_FIXA;
    // Opus 5.x / Fable rodam com 1M (sessoes reais passaram de 600k); o resto com 200k
    if (!janela) janela = (/\[1m\]|opus-5|fable/i.test(modelo) || tokens > 200000) ? 1000000 : 200000;
    return { tokens, janela, pct: (tokens / janela) * 100, modelo };
  }
  return null;
}

// Limites de uso da conta (sessao de 5 h e semana), lidos do mesmo endpoint do /usage.
// Cache de 60 s para nao bater na API a cada ferramenta.
const LIMITE_USO = Number(process.env.CLAUDE_USAGE_ALERT) || 75;
const CACHE_USO = path.join(ESTADO_DIR, 'uso.json');

async function usoDaConta(maxIdadeMs = 60000) {
  let cache = null;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_USO, 'utf8'));
    if (Date.now() - cache.em < maxIdadeMs) return cache.dados;
  } catch {}
  let j;
  try {
    const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: 'Bearer ' + cred.claudeAiOauth.accessToken, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error('uso ' + r.status);
    j = await r.json();
  } catch (e) {
    // API recusou (429 etc.): fica com o ultimo valor bom em vez de sumir da tela
    if (cache) return cache.dados;
    throw e;
  }
  const dados = {
    sessao: j.five_hour && { pct: j.five_hour.utilization, renova: j.five_hour.resets_at },
    semana: j.seven_day && { pct: j.seven_day.utilization, renova: j.seven_day.resets_at },
  };
  fs.mkdirSync(ESTADO_DIR, { recursive: true });
  fs.writeFileSync(CACHE_USO, JSON.stringify({ em: Date.now(), dados }));
  return dados;
}

const NOMES = { sessao: 'sessão de 5 horas', semana: 'semana' };

async function avisarLimites() {
  const uso = await usoDaConta();
  const arq = path.join(ESTADO_DIR, 'uso-avisado.json');
  let avisado = {};
  try { avisado = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch {}
  for (const k of ['sessao', 'semana']) {
    const u = uso[k];
    // o resets_at oscila (23:50:00 / 23:49:59.9) a cada chamada: arredonda para 10 min
    if (!u) continue;
    const janela = Math.round(Date.parse(u.renova) / 600000);
    if (u.pct < LIMITE_USO || avisado[k] === janela) continue;
    const d = new Date(Math.round(Date.parse(u.renova) / 60000) * 60000);
    const hora = `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
    const dia = d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString('pt-BR', { weekday: 'long' }) + ' ';
    toast(`Claude: ${Math.round(u.pct)}% do limite da ${NOMES[k]}`, `Vai com calma. Renova ${dia}às ${hora}.`);
    agendarRenovacao(k, u.renova);
    avisado[k] = janela; // um aviso por janela de limite
  }
  fs.writeFileSync(arq, JSON.stringify(avisado));
}

// Tarefa agendada do Windows 1 min depois do reset, mesmo com tudo fechado: roda o renovou.js
// (aviso "limite renovou" e, se autorizado no app, retoma o chat atual).
function agendarRenovacao(k, renovaIso) {
  const quando = new Date(Date.parse(renovaIso) + 60000);
  const q = s => s.replace(/'/g, "''");
  const ps = `
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${q(path.join(BASE, 'renovou.ps1'))}" -K ${k}'
$t = New-ScheduledTaskTrigger -Once -At ([datetime]::Parse('${quando.toISOString()}').ToLocalTime())
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'Claude limite renovou - ${k}' -Action $a -Trigger $t -Settings $s -Force | Out-Null
`;
  // sincrono: solto em segundo plano o Register-ScheduledTask morria junto com o hook (roda 1x por janela)
  const enc = Buffer.from(ps, 'utf16le').toString('base64');
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { windowsHide: true, timeout: 8000 });
}

function toast(titulo, texto) {
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', TOAST_PS1, '-Titulo', titulo, '-Texto', texto], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

function instrucaoHandoff(r, cwd) {
  const hoje = new Date().toISOString().slice(0, 10);
  // vault do Obsidian vem do tanque-config.json ("vault"); sem vault, o handoff fica no projeto
  const vault = lerConfig().vault;
  const onde = vault
    ? [`2. Escreva o handoff no Obsidian: ${vault}/projetos/<projeto>/sessoes/${hoje}-handoff-<tema>.md`,
       '   (projeto = pasta do vault pelo que foi trabalhado; sem projeto claro use projetos/geral/sessoes/).']
    : [`2. Escreva o handoff em ${cwd || '<pasta do projeto>'}/docs/handoff/${hoje}-<tema>.md.`];
  return [
    `[Tanque do Claude] O contexto deste chat chegou a ${r.pct.toFixed(0)}% (${Math.round(r.tokens / 1000)}k de ${r.janela / 1000}k tokens).`,
    'Regra do usuario: aos 65% este chat PARA e o trabalho continua num chat novo.',
    'Agora, antes de qualquer outra coisa:',
    '1. Termine so o passo atomico em andamento (nao comece nada novo; nao deixe arquivo pela metade).',
    ...onde,
    '   Conteudo: o que foi feito, arquivos tocados, o que esta pela metade, pendencias em ordem de prioridade,',
    '   decisoes e regras novas do usuario, e o primeiro passo exato do proximo chat.',
    '3. Atualize as pendencias do projeto e a memoria (MEMORY.md) apontando pro handoff.',
    '4. Diga ao usuario, curto: "Contexto em X%. Handoff em <caminho>. Abra um chat novo e peca pra ler esse handoff."',
    `(cwd: ${cwd || '?'})`,
  ].join('\n');
}

function main(entrada) {
  const arg = process.argv[2];
  if (arg === '--test') {
    toast('Claude Code: contexto em 65%', 'Teste do monitor. Hora de fechar este chat e abrir um novo.');
    return null;
  }
  if (arg === '--status') {
    const r = usoDoTranscript(process.argv[3]);
    console.log(r ? `${r.pct.toFixed(1)}% (${r.tokens} / ${r.janela}) ${r.modelo}` : 'sem dados');
    return null;
  }

  let dados = {};
  try { dados = JSON.parse(entrada || '{}'); } catch { return null; }
  if (!dados.transcript_path || !fs.existsSync(dados.transcript_path)) return null;

  const r = usoDoTranscript(dados.transcript_path);
  if (!r) return null;

  const sessao = dados.session_id || path.basename(dados.transcript_path, '.jsonl');
  const estadoArq = path.join(ESTADO_DIR, sessao + '.json');
  let estado = { avisados: [], handoff: false };
  try {
    const e = JSON.parse(fs.readFileSync(estadoArq, 'utf8'));
    estado = Array.isArray(e) ? { avisados: e, handoff: false } : { ...estado, ...e };
  } catch {}

  // depois de um /compact o % cai: libera os avisos acima do valor atual
  estado.avisados = estado.avisados.filter(l => l <= r.pct);
  if (r.pct < LIMITES[0]) estado.handoff = false;

  const novo = LIMITES.filter(l => r.pct >= l && !estado.avisados.includes(l)).pop();
  if (novo !== undefined) {
    const projeto = path.basename(dados.cwd || '');
    toast(
      `Claude Code: contexto em ${Math.round(r.pct)}%`,
      `${projeto ? projeto + ' - ' : ''}${Math.round(r.tokens / 1000)}k de ${r.janela / 1000}k tokens. Feche este chat e comece um novo.`
    );
    estado.avisados.push(...LIMITES.filter(l => r.pct >= l && !estado.avisados.includes(l)));
  }

  // instrucao pro Claude: uma vez por sessao, no primeiro evento depois de passar dos 65%
  let saida = null;
  if (r.pct >= LIMITES[0] && !estado.handoff && lerConfig().avisarClaude) {
    const ev = dados.hook_event_name;
    const texto = instrucaoHandoff(r, dados.cwd);
    if (ev === 'Stop') {
      if (!dados.stop_hook_active) { saida = { decision: 'block', reason: texto }; estado.handoff = true; }
    } else if (ev === 'PostToolUse' || ev === 'UserPromptSubmit') {
      saida = { hookSpecificOutput: { hookEventName: ev, additionalContext: texto } };
      estado.handoff = true;
    }
  }

  fs.mkdirSync(ESTADO_DIR, { recursive: true });
  fs.writeFileSync(estadoArq, JSON.stringify(estado));
  return saida;
}

module.exports = { usoDoTranscript, usoDaConta, avisarLimites, agendarRenovacao, toast, lerConfig, salvarConfig, LIMITES, LIMITE_USO };

let entrada = '';
if (require.main !== module) {
  // importado pelo app (monitor-app/main.js)
} else if (process.stdin.isTTY || process.argv[2]) {
  main('');
} else {
  process.stdin.on('data', c => (entrada += c));
  process.stdin.on('end', async () => {
    let saida = null;
    try { saida = main(entrada); } catch {}
    try { await avisarLimites(); } catch {}
    if (saida) process.stdout.write(JSON.stringify(saida));
  });
}
