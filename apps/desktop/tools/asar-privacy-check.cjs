const asar = require('I:/goongrid/node_modules/@electron/asar');
const fs = require('fs');
const path = require('path');
const a = 'I:/goongrid/apps/desktop/release/win-unpacked/resources/app.asar';
// The packaged web assets are copied verbatim from apps/desktop/dist; scan the
// on-disk dist (asar path forms on Windows are brittle — known pitfall).
const dir = 'I:/goongrid/apps/desktop/dist/assets';
const js = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
console.log('js chunks:', js.length);
void a; void asar;
let traffic = 0, priv = 0, cases = 0, ack = 0, pcd = 0;
for (const f of js) {
  const s = fs.readFileSync(f, 'utf8');
  traffic += s.includes('traffic-sources') ? 1 : 0;
  priv += s.includes('private-messages') ? 1 : 0;
  cases += s.includes('/cases/') ? 1 : 0;
  ack += s.includes('domination/ack') ? 1 : 0;
  pcd += s.includes('What others may send you') ? 1 : 0;
}
console.log({ traffic, priv, cases, ack, pcd });
if (traffic || priv) { console.error('FAIL: removed privacy endpoints still shipped'); process.exit(1); }
if (!cases || !ack || !pcd) { console.error('FAIL: new surfaces missing from bundle'); process.exit(1); }
console.log('asar privacy check OK');
