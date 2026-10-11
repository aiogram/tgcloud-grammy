#!/usr/bin/env node
// `npm create @aiogram/tgcloud-grammy <dir>`: a thin bootstrap, like @tgcloud/create-bot.
// It installs the tools, then delegates all scaffolding to `tgcloud-grammy init`
// (which itself runs the official `tgcloud init` first). Node built-ins only:
// it runs before anything is installed.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const args = process.argv.slice(2);
const noGit = args.includes('--no-git');
const tty = process.stdin.isTTY;
const target = args.find((a) => !a.startsWith('-'));
// Where to install @aiogram/tgcloud-grammy from; override to test an unpublished build (a .tgz path).
const packageSpec = process.env.TGCLOUD_GRAMMY_PACKAGE || '@aiogram/tgcloud-grammy';

if (!target) {
  console.error('Usage: npm create @aiogram/tgcloud-grammy <directory> [-- --no-git] [--github-actions]');
  process.exit(1);
}

/** Asks a yes/no question; `fallback` is the answer on Enter. */
async function ask(question, fallback) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim();
  rl.close();
  return answer ? /^y(es)?$/i.test(answer) : fallback;
}

// Asked before the slow install. Without a terminal, only the flag turns it on.
const githubActions = args.includes('--github-actions')
  || (tty && await ask('Add a GitHub Actions workflow that deploys the bot on every push to main?', true));

const dir = path.resolve(target);
const existed = fs.existsSync(dir);
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: path.basename(dir), private: true }, null, 2) + '\n');
}
const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'inherit' });

try {
  console.log('Installing @tgcloud/cli, @aiogram/tgcloud-grammy, typescript and grammy...');
  run(`npm install --save-dev @tgcloud/cli typescript ${JSON.stringify(packageSpec)}`);
  run('npm install grammy');
} catch {
  // Remove the folder only if this run created it.
  if (!existed) fs.rmSync(dir, { recursive: true, force: true });
  console.error('\nInstalling failed. Check the error above and try again.');
  process.exit(1);
}

try {
  run(`npx tgcloud-grammy init${githubActions ? ' --github-actions' : ''}`);
} catch {
  console.error('\nScaffolding failed. Fix the error above and run "npx tgcloud-grammy init" in the project.');
  process.exit(1);
}

if (!noGit && !fs.existsSync(path.join(dir, '.git'))) {
  try {
    execSync('git init -q && git add -A && git commit -qm "Initial commit"', { cwd: dir, stdio: 'ignore' });
    console.log('Initialized a git repository with an initial commit.');
  } catch {
    console.log('Skipped the initial git commit (is git installed and configured?).');
  }
}

let loggedIn = false;
if (tty) {
  if (await ask('\nLink your bot now? (BotFather → your bot → Serverless → CLI Access)', false)) {
    try {
      run('npx tgcloud login');
      loggedIn = true;
    } catch {
      console.log('Skipped: run "npx tgcloud login" later.');
    }
  }
}

console.log('\nNext steps:');
if (target !== '.') console.log(`  cd ${target}`);
if (!loggedIn) console.log('  npx tgcloud login   # link your bot');
console.log('  edit src/lib/bot.ts');
console.log('  npm run deploy      # typecheck, build and push');
if (githubActions) {
  console.log('\nTo deploy from GitHub on every push to main, add the bot\'s CLI token as a secret:');
  console.log('  gh secret set TGCLOUD_TOKEN   # BotFather → your bot → Serverless → CLI Access');
}
