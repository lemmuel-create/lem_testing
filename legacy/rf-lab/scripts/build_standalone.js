#!/usr/bin/env node
/*
 * Build single-file copies of every live and in-review tool: dist/<id>.html with the shared CSS/JS inlined.
 * Use these to email a tool or hand it to someone without the rest of RF Lab. Rebuild after any change.
 * Usage: node scripts/build_standalone.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'dist');
const manifest = require('../manifest.js');
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const t of manifest.tools.filter((x) => ['live', 'review'].includes(x.status))) {
  const file = path.join(ROOT, t.path), dir = path.dirname(file);
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${fs.readFileSync(path.resolve(dir, href), 'utf8')}\n</style>`);
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${fs.readFileSync(path.resolve(dir, src), 'utf8').replace(/<\/script>/gi, '<\\/script>')}\n</script>`);
  // the breadcrumb link back to the hub doesn't exist in a standalone copy
  html = html.replace('</body>', `<script>document.querySelectorAll('.rl-crumb a').forEach(a=>a.removeAttribute('href'));</script>\n</body>`);
  fs.writeFileSync(path.join(OUT, `${t.id}.html`), html); n++;
  console.log(`dist/${t.id}.html`);
}
console.log(`${n} standalone file(s) built.`);
