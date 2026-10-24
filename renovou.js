#!/usr/bin/env node
// Roda quando o limite renova (tarefa agendada "Claude limite renovou - <k>").
// Avisa e, SO se o usuario ligou "Retomar o chat atual" no app (autorizacao dele),
// retoma o chat mostrado no app pelo CLI do Claude Code: claude --resume <id> -p ...
//
// Teste sem rodar o Claude: node renovou.js sessao --seco

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { lerConfig, toast } = require('./context-alert.js');

const NOMES = { sessao: 'sessão de 5 horas', semana: 'semana' };
const LOGS = path.join(__dirname, 'logs');
const PARADO_MS = 3 * 60 * 1000; // chat sem atividade ha 3 min = ninguem digitando nele agora

const PROMPT = [
  'O limite de uso da sessao renovou e o usuario autorizou (no Tanque do Claude) retomar este chat sozinho.',
  'Continue exatamente de onde parou: termine a tarefa que estava em andamento e siga as pendencias combinadas,',
  'respeitando as regras do usuario (memoria e Obsidian).',
  'Se nao houver nada pendente, nao faca nada e responda so "Nada pendente."',
].join(' ');

function claudeExe() {
  // a extensao do VS Code traz o CLI mais novo; senao, o instalado em ~/.local/bin
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const pastas = fs.readdirSync(ext).filter(d => d.startsWith('anthropic.claude-code-')).sort().reverse();
    for (const d of pastas) {
      const exe = path.join(ext, d, 'resources', 'native-binary', 'claude.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return path.join(os.homedir(), '.local', 'bin', 'claude.exe');
}

function vscodeAberto() {
  try { return /Code\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq Code.exe" /NH', { encoding: 'utf8', windowsHide: true })); }
  catch { return false; }
}

function main() {
  const k = process.argv[2] || 'sessao';
  const seco = process.argv.includes('--seco');
  const cfg = lerConfig();
  const alvo = cfg.retomar && cfg.continuar;

  if (k !== 'sessao' || !alvo) {
    toast(`Claude: limite da ${NOMES[k] || k} renovou`, 'Pode voltar a usar à vontade.');
    return;
  }
  if (!vscodeAberto()) {
    toast('Claude: limite da sessão renovou', `VS Code fechado, então não retomei "${alvo.assunto}".`);
    return;
  }
  let parado = true;
  try { parado = Date.now() - fs.statSync(alvo.transcript).mtimeMs > PARADO_MS; } catch {}
  if (!parado) {
    toast('Claude: limite da sessão renovou', `"${alvo.assunto}" já está em uso, então não retomei.`);
    return;
  }

  const exe = claudeExe();
  const args = ['--resume', alvo.sessionId, '-p', PROMPT, '--permission-mode', 'auto'];
  if (seco) { console.log('retomaria:', exe, args.slice(0, 2).join(' '), 'em', alvo.cwd, '-', alvo.assunto); return; }

  toast('Claude: limite renovou, retomando o chat', `"${alvo.assunto}" continua de onde parou.`);
  fs.mkdirSync(LOGS, { recursive: true });
  const log = fs.openSync(path.join(LOGS, `retomada-${new Date().toISOString().slice(0, 16).replace(/:/g, '')}.log`), 'a');
  const p = spawn(exe, args, { cwd: alvo.cwd, stdio: ['ignore', log, log], windowsHide: true });
  p.on('exit', codigo => {
    toast('Claude: retomada terminou', codigo === 0
      ? `"${alvo.assunto}". Reabra o chat pelo histórico pra ver o que ele fez.`
      : `"${alvo.assunto}" parou com erro (código ${codigo}). Veja .claude/hooks/logs.`);
  });
}

main();
