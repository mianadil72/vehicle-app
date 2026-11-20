// Renders the PNG app icons in public/icons/ from public/app-icon.svg and public/app-icon-maskable.svg,
// using a headless Chromium browser (Microsoft Edge or Google Chrome).
// Usage: npm run icons   (set BROWSER_PATH to use a specific browser executable)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'public', 'icons');

const ICONS = [
  // iOS home screen: full-bleed (iOS rounds the corners itself; transparent corners would turn black).
  { file: 'icon-180.png', size: 180, svg: 'app-icon-maskable.svg' },
  { file: 'icon-192.png', size: 192, svg: 'app-icon.svg' },
  { file: 'icon-512.png', size: 512, svg: 'app-icon.svg' },
  { file: 'icon-maskable-512.png', size: 512, svg: 'app-icon-maskable.svg' },
];

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
].filter((p): p is string => Boolean(p));

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('No Edge or Chrome found. Set BROWSER_PATH to a Chromium-based browser executable.');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'app-icons-'));
try {
  for (const icon of ICONS) {
    const svg = readFileSync(join(root, 'public', icon.svg), 'utf8');
    const page = join(work, `${icon.size}-${icon.svg}.html`);
    writeFileSync(
      page,
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${icon.size}px;height:${icon.size}px}</style></head><body>${svg}</body></html>`,
    );
    const target = join(out, icon.file);
    execFileSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--user-data-dir=${join(work, 'profile')}`,
        `--window-size=${icon.size},${icon.size}`,
        `--screenshot=${target}`,
        pathToFileURL(page).href,
      ],
      { stdio: 'ignore', timeout: 60_000 },
    );
    if (!existsSync(target) || statSync(target).size === 0) throw new Error(`The browser did not write ${icon.file}`);
    console.log(`Wrote public/icons/${icon.file} (${icon.size}×${icon.size})`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
