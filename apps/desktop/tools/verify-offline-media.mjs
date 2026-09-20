import { chromium } from '@playwright/test';
import { generateIdentity } from '../src/identity.cjs';
import http from 'http';
import fs from 'fs';
import path from 'path';

const legalKey = fs.readFileSync('I:/goongrid/.legal-key.txt', 'utf8').trim();
const id = generateIdentity();
const save = { version: 3, gc: 50000, credited: 0, debited: 0, totalEarnedGc: 50000, xp: 0, clickCount: 0, critCount: 0, shards: 0, prestigeCount: 0, tags: [{ name: 'x', level: 1, selected: true, base: 10, income: 0, weight: 1 }], gallery: [], caps: [], capsUsed: [], achievements: [], collectedOfflineEarnings: true, ageAccepted: true, defeated: 0, backgroundUrl: null, viewMode: 'single', setupComplete: true, userExcludes: [], lastSeenAt: Date.now() };

const distDir = 'I:/goongrid/apps/desktop/dist';
const server = http.createServer((req, res) => {
  let file = path.join(distDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(file)) file = path.join(distDir, 'index.html');
  const ext = path.extname(file);
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(4178, resolve));

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.addInitScript(([i, sv, lk]) => {
  localStorage.setItem('orbit_identity', JSON.stringify(i));
  localStorage.setItem('goonMatch_age_verified', 'true');
  localStorage.setItem('orbit_legal_accepted', lk);
  localStorage.setItem('orbit_display_name', 'E2E Tester');
  localStorage.setItem(`gmatch.save.v1:${i.orbitId}`, JSON.stringify(sv));
  localStorage.setItem('gmatch.save.v1', JSON.stringify(sv));
  localStorage.setItem(`orbit_onboarding_v2:${i.orbitId}`, JSON.stringify({ version: 1, current: 'ready', completed: ['welcome','auth','profile','platform','feed','tune','cards','economy','games','ready'] }));
}, [id, save, legalKey]);

await page.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Click accept terms if modal is visible
const acceptBtn = page.getByRole('button', { name: /I Accept the Terms/i });
if (await acceptBtn.count() > 0) {
  await acceptBtn.click();
  await page.waitForTimeout(1000);
}

await page.evaluate(() => { window.location.hash = '#/feed'; });
await page.waitForTimeout(1500);

const shotPath = 'I:/goongrid/apps/desktop/tmp/feed-active-verify.png';
fs.mkdirSync(path.dirname(shotPath), { recursive: true });
await page.screenshot({ path: shotPath });
console.log('Saved screenshot to', shotPath);

const audit = await page.evaluate(() => {
  const images = [...document.querySelectorAll('img')];
  const brokenImgs = images.filter((img) => img.naturalWidth === 0 && img.src && !img.src.startsWith('data:image/svg'));
  const noPreviews = [...document.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === 'No preview'
  );
  return {
    totalImgs: images.length,
    brokenImgs: brokenImgs.length,
    noPreviews: noPreviews.length,
    bodyTextLength: document.body.innerText.length
  };
});

console.log('DOM media audit:', JSON.stringify(audit));

await browser.close();
server.close();
