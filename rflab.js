/*
 * RF Lab page framework: header/footer from manifest, exercises, per-browser progress, known-answer test registry.
 * Load order on a tool page: theme.css, ../../manifest.js, rfmath.js, limits.js, rfplot.js, rflab.js, then the tool script.
 */
(function (root) {
  'use strict';
  const RF = root.RF = root.RF || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  RF.util = {
    $, esc,
    stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; },
    download(name, href) { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); },
    downloadText(name, text, type = 'text/csv') { RF.util.download(name, URL.createObjectURL(new Blob([text], { type }))); },
    async copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { window.prompt('Copy:', text); return false; } }
  };

  /* ---------- progress (per browser; storage may be unavailable, so every call is guarded) ---------- */
  const KEY = 'rflab.progress.v1';
  RF.progress = {
    all() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } },
    save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode etc. */ } },
    mark(toolId, exId, total) {
      const p = RF.progress.all(); const t = p[toolId] = p[toolId] || { ex: {} };
      t.ex[exId] = true; t.total = total; t.updated = new Date().toISOString(); RF.progress.save(p);
    },
    tool(toolId) { const t = RF.progress.all()[toolId]; if (!t) return { done: 0, total: 0 }; const done = Object.keys(t.ex || {}).length; return { done, total: t.total || done }; },
    reset(toolId) { const p = RF.progress.all(); if (toolId) delete p[toolId]; else Object.keys(p).forEach((k) => delete p[k]); RF.progress.save(p); }
  };

  /* ---------- page chrome ---------- */
  RF.page = {
    entry: null,
    init({ id, root: base = '../../' }) {
      const m = RF.manifest, e = m && m.tools.find((t) => t.id === id);
      if (!e) { console.error('RF Lab: tool id not found in manifest.js:', id); return null; }
      RF.page.entry = e;
      const lvl = m.levels.find((l) => l.n === e.level) || { title: '' };
      document.title = `${e.title} · RF Lab`;
      const hd = $('rl-header');
      const tr = (m.tracks || []).find((x) => x.id === e.track), trTitle = tr ? tr.title : 'All tracks';
      const review = e.status === 'review' ? `<div class="banner">In RF review: the limits on this page were checked against the CFR text (${esc((RF.limits && RF.limits.verifiedAgainst) || '')}). The simulation models and wording are awaiting sign-off by an RF engineer.</div>` : '';
      if (hd) hd.innerHTML = `<div class="rl-crumb"><a href="${base}index.html${tr ? '#' + tr.id : ''}">RF Lab</a> / ${esc(trTitle)} / Level ${e.level}: ${esc(lvl.title)}</div>
        <h1>${esc(e.title)}</h1><div class="rl-sub">${esc(e.summary)}</div>
        <div class="rl-tags">${(e.refs || []).map((r) => `<span class="tag">${esc(r)}</span>`).join('')}<span class="tag">v${esc(e.version || '0.0.0')}</span>${e.status === 'review' ? '<span class="tag review">In RF review</span>' : ''}</div>${review}`;
      RF.page.renderRegs(e);
      const ft = $('rl-footer'), L = RF.limits;
      if (ft) ft.innerHTML = `${esc(e.title)} v${esc(e.version || '0.0.0')} · Owner: ${esc(e.owner || 'unassigned')} · Limits ${L ? 'v' + esc(L.version) + ', verified ' + esc(L.verified) : 'not loaded'} · RF Lab v${esc(m.labVersion)}<br>Training reference, not legal advice. Confirm against current eCFR text and KDB procedures before certification decisions.`;
      return e;
    },
    /** Fill <div id="rl-regs"> from the manifest entry's `regulations` [{cite, req, use}] and `guidance` [string]. */
    renderRegs(e) {
      const el = $('rl-regs'); if (!el) return;
      const regs = e.regulations || [];
      if (!regs.length) { el.classList.add('hidden'); return; }
      const link = (c) => { const m = /§\s*(\d+)\.(\d+)/.exec(c); return m ? `https://www.ecfr.gov/current/title-47/section-${m[1]}.${m[2]}` : null; };
      el.innerHTML = `<h2>Relevant FCC regulations</h2>
        <div class="hint" style="margin:0 0 8px">Title 47 CFR unless noted. Requirements are paraphrased for training; follow the links to the current eCFR text before relying on them.</div>
        <table class="regs"><thead><tr><th style="width:16%">Rule</th><th style="width:44%">Requirement</th><th>How it relates to this tool</th></tr></thead><tbody>
        ${regs.map((r) => { const u = link(r.cite); return `<tr><td>${u ? `<a href="${u}" target="_blank" rel="noopener">${esc(r.cite)}</a>` : esc(r.cite)}</td><td>${esc(r.req)}</td><td>${esc(r.use)}</td></tr>`; }).join('')}
        </tbody></table>
        ${(e.guidance || []).length ? `<h3 style="margin-top:14px">Measurement guidance and related standards</h3><ul class="notes">${e.guidance.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}`;
    }
  };

  /* ---------- exercises ----------
   * {id, type:'choice', prompt, options:[...], answer:index, explain, hint}
   * {id, type:'number', prompt, answer:number|fn, tol, unit, explain, hint}
   * {id, type:'state', prompt, check:()=>({ok, msg}), explain, hint}   // user sets up the tool, then presses Check
   */
  RF.ex = {
    registered: {},
    /** Registers a tool's exercises and renders them only when manifest.showExercises is true. */
    mount(container, toolId, list) {
      RF.ex.registered[toolId] = list;
      const el = typeof container === 'string' ? $(container) : container;
      if (!(RF.manifest && RF.manifest.showExercises)) { if (el) el.classList.add('hidden'); return; }
      const done = (RF.progress.all()[toolId] || { ex: {} }).ex || {};
      el.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="flex:0 0 auto;margin:0">Try this</h2><span class="hint" id="ex-count" style="flex:0 0 auto;margin:0"></span></div>
        <div class="progress"><div id="ex-bar" style="width:0"></div></div>`;
      const count = () => { const n = list.filter((x) => (RF.progress.all()[toolId] || { ex: {} }).ex[x.id]).length; $('ex-count').textContent = `${n} of ${list.length} complete`; $('ex-bar').style.width = (100 * n / list.length) + '%'; };
      list.forEach((x, i) => {
        const box = document.createElement('div'); box.className = 'ex' + (done[x.id] ? ' done' : ''); box.dataset.ex = x.id;
        let body = '';
        if (x.type === 'choice') body = `<div class="ex-opts">${x.options.map((o, k) => `<label><input type="radio" name="ex-${x.id}" value="${k}"> <span>${esc(o)}</span></label>`).join('')}</div>`;
        else if (x.type === 'number') body = `<div class="row" style="max-width:260px"><input type="number" step="any" class="ex-in" aria-label="Answer"><span class="val" style="min-width:40px;text-align:left">${esc(x.unit || '')}</span></div>`;
        box.innerHTML = `<div class="ex-h"><span class="ex-n">${i + 1}</span><span>${esc(x.title || 'Exercise ' + (i + 1))}</span></div>
          <div class="ex-p">${x.prompt}</div>${body}
          <div class="toolbar" style="margin-top:8px"><button class="ex-check">Check</button>${x.hint ? '<button class="ex-hintbtn">Hint</button>' : ''}</div>
          <div class="ex-hint hidden">${x.hint ? esc(x.hint) : ''}</div><div class="ex-fb"></div>`;
        const fb = box.querySelector('.ex-fb');
        const ok = (msg) => { fb.className = 'ex-fb pass'; fb.innerHTML = '✓ ' + (msg ? esc(msg) + ' ' : '') + (x.explain ? esc(x.explain) : ''); box.classList.add('done'); RF.progress.mark(toolId, x.id, list.length); count(); };
        const no = (msg) => { fb.className = 'ex-fb fail'; fb.textContent = msg; };
        box.querySelector('.ex-check').onclick = () => {
          if (x.type === 'choice') {
            const sel = box.querySelector('input[type=radio]:checked'); if (!sel) return no('Pick an answer first.');
            return +sel.value === x.answer ? ok('Correct.') : no('Not quite. Try again, or open the hint.');
          }
          if (x.type === 'number') {
            const raw = box.querySelector('.ex-in').value.trim(); if (raw === '') return no('Enter a number first.');
            const v = Number(raw); if (!Number.isFinite(v)) return no('That is not a number.');
            const ans = typeof x.answer === 'function' ? x.answer() : x.answer, tol = x.tol ?? Math.abs(ans) * 0.02;
            return Math.abs(v - ans) <= tol ? ok(`Correct (${ans.toFixed(2)} ${x.unit || ''}).`) : no('Not quite. Check your units and try again.');
          }
          const r = x.check(); return r.ok ? ok(r.msg || 'Done.') : no(r.msg || 'Not yet. Adjust the tool and check again.');
        };
        const hb = box.querySelector('.ex-hintbtn'); if (hb) hb.onclick = () => box.querySelector('.ex-hint').classList.toggle('hidden');
        box.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => { if (fb.classList.contains('fail')) { fb.textContent = ''; fb.className = 'ex-fb'; } }));
        el.appendChild(box);
      });
      count();
    }
  };

  /* ---------- known-answer tests: tools push {name, run:()=>({ok, detail})}; tests/run_tests.js executes them ---------- */
  RF.tests = RF.tests || [];
  RF.test = {
    add(name, run) { RF.tests.push({ name, run }); },
    near(got, exp, tol) { return { ok: Number.isFinite(got) && Math.abs(got - exp) <= tol, detail: `got ${Number(got).toFixed(3)}, expected ${exp} ± ${tol}` }; },
    async runAll() { const out = []; for (const t of RF.tests) { try { const r = await t.run(); out.push({ name: t.name, ...r }); } catch (e) { out.push({ name: t.name, ok: false, detail: String(e) }); } } return out; }
  };
})(window);
