const asar = require('I:/goongrid/node_modules/@electron/asar');
const fs = require('fs');
const a = 'I:/goongrid/apps/desktop/release/win-unpacked/resources/app.asar';
const out = 'I:/goongrid/apps/desktop/release/asar-check';
fs.rmSync(out, { recursive: true, force: true });
asar.extractAll(a, out);
const cssDir = out + '/dist/assets';
const cssFile = fs.readdirSync(cssDir).find((f) => f.startsWith('index') && f.endsWith('.css'));
const css = fs.readFileSync(cssDir + '/' + cssFile, 'utf8');
console.log('has bg-glass-w5 rule:', css.includes('bg-glass-w5'));
console.log('panel-alpha calcs:', (css.match(/var\(--panel-alpha\)/g) || []).length);
const html = fs.readFileSync(out + '/dist/index.html', 'utf8');
console.log('index css link:', html.match(/assets\/[^" ]+\.css/g));
const mainjs = fs.readFileSync(out + '/electron/main.cjs', 'utf8');
console.log('main app:version:', mainjs.includes('app:version'), '| shell:open:', mainjs.includes('shell:open'));
const boot = fs.readFileSync(out + '/electron/preload.cjs', 'utf8');
console.log('preload appVersion:', boot.includes('appVersion'), '| openExternal:', boot.includes('openExternal'));
const jsEntry = html.match(/assets\/[^" ]+\.js/g) || [];
for (const j of jsEntry) {
  try {
    const s = fs.readFileSync(out + '/dist/' + j, 'utf8');
    if (s.includes('Play Cards')) console.log('Play Cards found in', j);
    if (s.includes('Check for update')) console.log('UpdateSection found in', j);
  } catch { /* chunk not an entry */ }
}
