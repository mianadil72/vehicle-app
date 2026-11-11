// `npm run dev:api`: runs the API and restarts it when files in server/ or src/ change.
// (Used instead of `node --watch`, which on Windows also restarts whenever a dependency loads a
// file lazily for the first time, dropping in-flight requests.)
import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';

const ENTRY = 'server/index.ts';
const WATCHED = ['server', 'src'];
const RELEVANT = /\.(ts|tsx|sql|json)$/;

let child: ChildProcess | undefined;
let timer: NodeJS.Timeout | undefined;

function start() {
  child = spawn(process.execPath, [...process.execArgv, ENTRY], { stdio: 'inherit', env: process.env });
}

function restart(file: string) {
  clearTimeout(timer);
  // Debounce: editors often write a file several times in a row.
  timer = setTimeout(() => {
    console.log(`\n${file} changed, restarting API…`);
    if (!child || child.exitCode !== null) return start();
    child.once('exit', start);
    child.kill();
  }, 150);
}

for (const dir of WATCHED) {
  watch(dir, { recursive: true }, (_event, file) => {
    if (file && RELEVANT.test(file)) restart(`${dir}/${file.replaceAll('\\', '/')}`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    child?.kill();
    process.exit(0);
  });
}

start();
