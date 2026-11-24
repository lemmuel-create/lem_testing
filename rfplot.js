/*
 * RF Lab analyzer-style plot on <canvas>. Usage:
 *   const plot = RF.plot.create(canvasEl, {readoutEl});
 *   plot.draw({ traces:[{f,a,color:'trace'}], rbw, hLines:[...], vLines:[...], shades:[...], markers:[...], spans:[...], header:'...' });
 * Overlays (x in MHz, y in dBm; color = CSS var name without "--", e.g. 'mark', 'limit', 'muted', 'trace2'):
 *   hLines:  {y, label, color, dash}
 *   vLines:  {x, label, color, dash, fromY}       fromY: start the line at this dBm level instead of the top
 *   shades:  {x0, x1, label, color, alpha}
 *   markers: {x, y, label}                         downward triangle marker
 *   spans:   {x0, x1, y, label}                    dimension line with centered label (y in dBm)
 *   segments:{x0, x1, y, label, color, dash}       limit line over a range; y may be [[x,y],...] for a piecewise mask
 */
(function (root) {
  'use strict';
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim();

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    let last = null, hoverX = null, geom = null;

    function draw(spec) {
      if (spec) last = spec;
      const s = last, wrap = canvas.parentElement;
      const dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = css('panel'); ctx.fillRect(0, 0, W, H);
      if (!s || !s.traces || !s.traces.length) { ctx.fillStyle = css('muted'); ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s && s.empty || 'No data', W / 2, H / 2); geom = null; return; }
      const t0 = s.traces[0], f = t0.f, N = f.length;
      let pk = -Infinity; s.traces.forEach((t) => { for (let i = 0; i < t.a.length; i++) if (t.a[i] > pk) pk = t.a[i]; });
      const top = s.refLevel ?? Math.ceil((pk + 5) / 10) * 10, div = s.dbPerDiv || 10, bot = top - div * 10;
      const L = 58, R = 18, T = 40, B = 46, pw = W - L - R, ph = H - T - B;
      const f0 = s.xMin ?? f[0], f1 = s.xMax ?? f[N - 1];
      const X = (v) => L + (v - f0) / (f1 - f0) * pw, Y = (d) => T + (top - Math.max(bot, Math.min(top, d))) / (top - bot) * ph;
      geom = { L, T, pw, ph, f0, f1, X, Y };
      ctx.strokeStyle = css('grid'); ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) { const x = L + pw * i / 10; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); const y = T + ph * i / 10; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); }
      ctx.strokeStyle = css('axis'); ctx.strokeRect(L, T, pw, ph);
      ctx.font = '11px sans-serif'; ctx.fillStyle = css('muted'); ctx.textAlign = 'right';
      for (let i = 0; i <= 10; i++) ctx.fillText((top - i * div).toFixed(0), L - 6, T + ph * i / 10 + 4);
      ctx.textAlign = 'center';
      for (let i = 0; i <= 10; i += 2) ctx.fillText((f0 + (f1 - f0) * i / 10).toFixed(3), L + pw * i / 10, T + ph + 16);
      ctx.fillText(s.xLabel || 'Frequency (MHz)', L + pw / 2, H - 8);
      ctx.save(); ctx.translate(14, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(s.yLabel || 'Amplitude (dBm in RBW)', 0, 0); ctx.restore();
      ctx.textAlign = 'left'; ctx.fillStyle = css('ink2');
      ctx.fillText(s.header ?? `${s.rbw ? 'RBW ' + RF.math.fmtHz(s.rbw) + '   ' : ''}Span ${RF.math.fmtHz((f1 - f0) * 1e6)}   Ref ${top} dBm   ${div} dB/div`, L, 24);

      (s.shades || []).forEach((sh) => {
        ctx.globalAlpha = sh.alpha ?? 0.08; ctx.fillStyle = css(sh.color || 'limit');
        ctx.fillRect(X(sh.x0), T, X(sh.x1) - X(sh.x0), ph); ctx.globalAlpha = 1;
        if (sh.label) { ctx.fillStyle = css(sh.color || 'limit'); ctx.textAlign = 'center'; ctx.fillText(sh.label, (X(sh.x0) + X(sh.x1)) / 2, T + ph - 8); }
      });
      s.traces.forEach((t) => {
        ctx.strokeStyle = css(t.color || 'trace'); ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.beginPath();
        const step = Math.max(1, Math.floor(t.f.length / (pw * 2)));
        for (let i = 0; i < t.f.length; i += step) { const x = X(t.f[i]), y = Y(t.a[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      });
      (s.hLines || []).forEach((h) => {
        ctx.strokeStyle = css(h.color || 'mark'); ctx.setLineDash(h.dash || [6, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(L, Y(h.y)); ctx.lineTo(L + pw, Y(h.y)); ctx.stroke(); ctx.setLineDash([]);
        if (h.label) { ctx.fillStyle = css('ink2'); ctx.textAlign = 'left'; ctx.fillText(h.label, L + 6, Y(h.y) + (h.labelBelow ? 14 : -6)); }
      });
      (s.vLines || []).forEach((v) => {
        if (v.x < f0 || v.x > f1) return;
        ctx.strokeStyle = css(v.color || 'mark'); ctx.setLineDash(v.dash || [6, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(X(v.x), v.fromY !== undefined ? Y(v.fromY) : T); ctx.lineTo(X(v.x), T + ph); ctx.stroke(); ctx.setLineDash([]);
        if (v.label) { ctx.fillStyle = css(v.color || 'mark'); ctx.textAlign = 'center'; ctx.fillText(v.label, X(v.x), T - 4); }
      });
      (s.segments || []).forEach((g) => {
        // limit lines over a frequency range; y may be a number or an array of [x, y] points (piecewise mask)
        const pts = Array.isArray(g.y) ? g.y : [[g.x0, g.y], [g.x1, g.y]];
        ctx.strokeStyle = css(g.color || 'limit'); ctx.setLineDash(g.dash || []); ctx.lineWidth = 1.5; ctx.beginPath();
        pts.forEach(([x, y], i) => { const xx = X(Math.max(f0, Math.min(f1, x))); i ? ctx.lineTo(xx, Y(y)) : ctx.moveTo(xx, Y(y)); });
        ctx.stroke(); ctx.setLineDash([]);
        if (g.label) { const [lx, ly] = pts[0]; ctx.fillStyle = css(g.color || 'limit'); ctx.textAlign = 'left'; ctx.fillText(g.label, X(Math.max(f0, Math.min(f1, lx))) + 4, Y(ly) - 5); }
      });
      (s.markers || []).forEach((m) => {
        const x = X(m.x), y = Y(m.y); ctx.fillStyle = css('mark');
        ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.lineTo(x - 6, y - 12); ctx.lineTo(x + 6, y - 12); ctx.closePath(); ctx.fill();
        if (m.label) { ctx.fillStyle = css('ink'); ctx.textAlign = 'center'; ctx.fillText(m.label, x, y - 16); }
      });
      (s.spans || []).forEach((sp) => {
        const y = Math.min(T + ph - 22, Y(sp.y)); ctx.strokeStyle = css('ink2'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(sp.x0), y); ctx.lineTo(X(sp.x1), y); ctx.stroke();
        ctx.fillStyle = css('ink'); ctx.textAlign = 'center'; ctx.fillText(sp.label, (X(sp.x0) + X(sp.x1)) / 2, y - 6);
      });
      if (hoverX !== null && hoverX >= L && hoverX <= L + pw) {
        const fv = f0 + (hoverX - L) / pw * (f1 - f0); let lo = 0, hi = N - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m] < fv) lo = m; else hi = m; }
        const i = Math.abs(f[lo] - fv) < Math.abs(f[hi] - fv) ? lo : hi;
        ctx.strokeStyle = css('axis'); ctx.beginPath(); ctx.moveTo(X(f[i]), T); ctx.lineTo(X(f[i]), T + ph); ctx.stroke();
        ctx.fillStyle = css(t0.color || 'trace'); ctx.beginPath(); ctx.arc(X(f[i]), Y(t0.a[i]), 3.5, 0, 6.283); ctx.fill();
        if (opts.readoutEl) opts.readoutEl.textContent = `${f[i].toFixed(4)} MHz   ${t0.a[i].toFixed(2)} dBm`;
      } else if (opts.readoutEl) opts.readoutEl.textContent = '';
    }

    canvas.addEventListener('mousemove', (e) => { hoverX = e.clientX - canvas.getBoundingClientRect().left; draw(); });
    canvas.addEventListener('mouseleave', () => { hoverX = null; draw(); });
    window.addEventListener('resize', () => draw());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw());

    /** Download the plot as PNG with an optional caption line underneath. */
    function exportPNG(filename, caption) {
      const h = hoverX; hoverX = null; draw();
      const s = window.devicePixelRatio || 1, out = document.createElement('canvas');
      out.width = canvas.width; out.height = canvas.height + 40 * s;
      const c = out.getContext('2d'); c.fillStyle = css('panel'); c.fillRect(0, 0, out.width, out.height); c.drawImage(canvas, 0, 0);
      if (caption) { c.fillStyle = css('ink2'); c.font = `${12 * s}px sans-serif`; c.fillText(caption, 10 * s, canvas.height + 24 * s); }
      RF.util.download(filename, out.toDataURL('image/png')); hoverX = h; draw();
    }
    return { draw, exportPNG, get geom() { return geom; } };
  }

  root.RF = root.RF || {}; root.RF.plot = { create };
})(window);
