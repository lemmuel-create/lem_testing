#!/usr/bin/env node
/*
 * RF Lab test runner. For every live, review and template tool in manifest.js:
 *   - loads the page in headless Chromium (file://, same as a double-click)
 *   - fails on any JavaScript error or console error
 *   - checks the header and footer rendered from the manifest
 *   - runs the tool's known-answer tests (RF.test.add)
 * Also loads the hub. Usage:  node tests/run_tests.js [--screens]   (screenshots go to tests/screens/)
 * Setup once:  npm install   (installs Playwright)   then   npx playwright install chromium
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const manifest = require('../manifest.js');

const ROOT = path.resolve(__dirname, '..');
const SCREENS = process.argv.includes('--screens');
const url = (p) => 'file://' + path.join(ROOT, p);

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  const log = (ok, msg) => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`); if (!ok) failures++; };
  if (SCREENS) fs.mkdirSync(path.join(__dirname, 'screens'), { recursive: true });

  const pages = [{ id: 'hub', path: 'index.html' }, ...manifest.tools.filter((t) => ['live', 'review', 'template'].includes(t.status))];
  for (const t of pages) {
    console.log(`\n${t.id}  (${t.path})`);
    if (!fs.existsSync(path.join(ROOT, t.path))) { log(false, 'file missing'); continue; }
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url(t.path));
    await page.waitForTimeout(300);
    if (t.id === 'hub') {
      const n = await page.locator('.tool').count();
      log(n === manifest.tools.filter((x) => x.level > 0).length, `hub lists ${n} tools`);
    } else {
      log((await page.locator('#rl-header h1').count()) === 1, 'header rendered from manifest');
      log(((await page.textContent('#rl-footer')) || '').includes('Limits v'), 'footer shows limits version');
      log((await page.evaluate((id) => (RF.ex.registered[id] || []).length, t.id)) >= 3, 'has at least 3 exercises (registered)');
      log((await page.locator('#rl-regs table.regs tbody tr').count()) >= 1, 'relevant regulations listed');
      const results = await page.evaluate(() => RF.test.runAll());
      if (!results.length) log(false, 'no known-answer tests registered');
      results.forEach((r) => log(r.ok, `${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`));
    }
    log(errors.length === 0, errors.length ? 'JS errors: ' + errors.join(' | ') : 'no JS errors');
    if (SCREENS) {
      await page.screenshot({ path: path.join(__dirname, 'screens', `${t.id}-light.png`), fullPage: true });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: path.join(__dirname, 'screens', `${t.id}-dark.png`), fullPage: true });
    }
    await page.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();
