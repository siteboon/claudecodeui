/**
 * Project Stats plugin — module entry point.
 *
 * api shape:
 *   api.context                          — current PluginContext snapshot
 *   api.onContextChange(cb) → unsubscribe — called on theme/project/session changes
 *   api.rpc(method, path, body?) → Promise — proxied to this plugin's server subprocess
 */

const PALETTE = [
  '#6366f1','#22d3ee','#f59e0b','#10b981',
  '#f43f5e','#a78bfa','#fb923c','#34d399',
  '#60a5fa','#e879f9','#facc15','#4ade80',
];

function ensureAssets() {
  if (document.getElementById('ps-font')) return;
  const link = document.createElement('link');
  link.id = 'ps-font';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap';
  document.head.appendChild(link);

  const s = document.createElement('style');
  s.id = 'ps-styles';
  s.textContent = `
    @keyframes ps-grow   { from { width: 0 } }
    @keyframes ps-fadeup { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
    @keyframes ps-pulse  { 0%,100% { opacity:.3 } 50% { opacity:.6 } }
    .ps-bar   { animation: ps-grow   0.75s cubic-bezier(.16,1,.3,1) both }
    .ps-up    { animation: ps-fadeup 0.4s  ease both }
    .ps-skel  { animation: ps-pulse  1.6s  ease infinite }
  `;
  document.head.appendChild(s);
}

const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

function fmt(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

function ago(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function countUp(el, target, formatFn, duration = 900) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - (1 - p) ** 3;
    el.textContent = formatFn(Math.round(target * ease));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function v(dark) {
  return dark ? {
    bg:      '#08080f',
    surface: '#0e0e1a',
    border:  '#1a1a2c',
    text:    '#e2e0f0',
    muted:   '#52507a',
    accent:  '#fbbf24',
    dim:     'rgba(251,191,36,0.1)',
  } : {
    bg:      '#fafaf9',
    surface: '#ffffff',
    border:  '#e8e6f0',
    text:    '#0f0e1a',
    muted:   '#9490b0',
    accent:  '#d97706',
    dim:     'rgba(217,119,6,0.08)',
  };
}

function skeletonRows(c, widths) {
  return widths.map((w, i) => `
    <div class="ps-skel" style="
      height:10px;width:${w}%;background:${c.muted};border-radius:2px;
      margin-bottom:8px;animation-delay:${i * 0.1}s
    "></div>`).join('');
}

export function mount(container, api) {
  ensureAssets();
  let cache = null;

  const root = document.createElement('div');
  Object.assign(root.style, {
    height: '100%', overflowY: 'auto', boxSizing: 'border-box',
    padding: '24px', fontFamily: MONO,
  });
  container.appendChild(root);

  function render(ctx, stats) {
    const c = v(ctx.theme === 'dark');
    root.style.background = c.bg;
    root.style.color = c.text;

    if (!ctx.project) {
      root.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50%;gap:14px">
          <pre style="font-size:0.75rem;color:${c.muted};opacity:0.5;line-height:1.6;text-align:center">~/.projects/
└── (none selected)</pre>
          <div style="font-size:0.72rem;color:${c.muted};letter-spacing:0.1em;text-transform:uppercase">select a project</div>
        </div>`;
      return;
    }

    if (!stats) {
      root.innerHTML = `
        <div style="margin-bottom:24px">
          <div style="font-size:1.3rem;font-weight:700">${ctx.project.name}<span style="color:${c.accent}">▌</span></div>
          <div style="font-size:0.7rem;color:${c.muted};margin-top:4px">${ctx.project.path}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
          ${[0, 1, 2].map(i => `
            <div style="background:${c.surface};border:1px solid ${c.border};border-radius:3px;padding:18px">
              ${skeletonRows(c, [65])}
              ${skeletonRows(c, [40])}
            </div>`).join('')}
        </div>
        <div style="background:${c.surface};border:1px solid ${c.border};border-radius:3px;padding:18px;margin-bottom:12px">
          ${[75, 55, 38, 22, 14].map((w, i) => `
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:7px">
              <div class="ps-skel" style="width:44px;height:8px;background:${c.muted};border-radius:2px;animation-delay:${i*0.08}s"></div>
              <div class="ps-skel" style="width:${w}%;height:4px;background:${c.muted};border-radius:1px;animation-delay:${i*0.08}s"></div>
            </div>`).join('')}
        </div>`;
      return;
    }

    const maxCount = stats.byExtension[0]?.[1] || 1;

    root.innerHTML = `
      <div class="ps-up" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
        <div style="min-width:0;flex:1">
          <div style="font-size:1.3rem;font-weight:700;letter-spacing:-0.02em;word-break:break-all">
            ${ctx.project.name}<span style="color:${c.accent}">▌</span>
          </div>
          <div style="font-size:0.7rem;color:${c.muted};margin-top:4px;word-break:break-all">${ctx.project.path}</div>
        </div>
        <button id="ps-refresh" style="
          flex-shrink:0;margin-left:16px;padding:5px 12px;
          background:transparent;border:1px solid ${c.border};
          color:${c.muted};font-family:${MONO};font-size:0.7rem;
          border-radius:3px;cursor:pointer;letter-spacing:0.05em;
          transition:all 0.15s;
        " onmouseover="this.style.borderColor='${c.accent}';this.style.color='${c.accent}'"
           onmouseout="this.style.borderColor='${c.border}';this.style.color='${c.muted}'">
          ↻ refresh
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        ${[
          ['files',      stats.totalFiles, n => n.toLocaleString()],
          ['lines',      stats.totalLines, n => n.toLocaleString()],
          ['total size', stats.totalSize,  fmt],
        ].map(([label, val, fmt], i) => `
          <div class="ps-up" style="
            background:${c.surface};border:1px solid ${c.border};
            border-radius:3px;padding:18px;animation-delay:${i*0.06}s
          ">
            <div id="ps-m-${i}" style="
              font-size:1.9rem;font-weight:700;letter-spacing:-0.04em;
              line-height:1;color:${c.text};
            ">0</div>
            <div style="font-size:0.65rem;color:${c.muted};margin-top:6px;letter-spacing:0.1em;text-transform:uppercase">${label}</div>
          </div>`).join('')}
      </div>

      <div class="ps-up" style="
        background:${c.surface};border:1px solid ${c.border};
        border-radius:3px;padding:18px;margin-bottom:12px;animation-delay:0.12s
      ">
        <div style="font-size:0.62rem;color:${c.muted};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:14px">file types</div>
        ${stats.byExtension.map(([ext, count], i) => `
          <div class="ps-up" style="display:flex;align-items:center;gap:10px;margin-bottom:7px;animation-delay:${0.15+i*0.035}s">
            <div style="width:50px;font-size:0.68rem;text-align:right;color:${c.muted};flex-shrink:0">${ext}</div>
            <div style="flex:1;height:4px;background:${c.border};border-radius:1px;overflow:hidden">
              <div class="ps-bar" style="
                height:100%;width:${Math.round((count/maxCount)*100)}%;
                background:${PALETTE[i % PALETTE.length]};
                animation-delay:${0.18+i*0.035}s;border-radius:1px;
              "></div>
            </div>
            <div style="width:30px;font-size:0.68rem;color:${c.muted};text-align:right;flex-shrink:0">${count}</div>
          </div>`).join('')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[
          ['largest files',      stats.largest.map(f => [f.name, fmt(f.size)])],
          ['recently modified',  stats.recent.map(f => [f.name, ago(f.mtime)])],
        ].map(([title, rows], ci) => `
          <div class="ps-up" style="
            background:${c.surface};border:1px solid ${c.border};
            border-radius:3px;padding:18px;animation-delay:${0.18+ci*0.05}s
          ">
            <div style="font-size:0.62rem;color:${c.muted};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:12px">${title}</div>
            ${rows.map(([name, val], ri) => `
              <div class="ps-up" style="
                display:flex;justify-content:space-between;align-items:baseline;
                padding:4px 0;border-bottom:1px solid ${c.border};font-size:0.7rem;
                animation-delay:${0.2+ci*0.05+ri*0.03}s;gap:8px;
              ">
                <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;opacity:0.75" title="${name}">${name}</div>
                <div style="color:${c.accent};flex-shrink:0;opacity:0.9">${val}</div>
              </div>`).join('')}
          </div>`).join('')}
      </div>
    `;

    // Count-up animations for metric cards
    [
      [0, stats.totalFiles, n => n.toLocaleString()],
      [1, stats.totalLines, n => n.toLocaleString()],
      [2, stats.totalSize,  fmt],
    ].forEach(([i, val, formatFn]) => {
      const el = root.querySelector(`#ps-m-${i}`);
      if (el) countUp(el, val, formatFn);
    });

    root.querySelector('#ps-refresh')?.addEventListener('click', () => {
      cache = null;
      load(api.context);
    });
  }

  async function load(ctx) {
    if (!ctx.project) { cache = null; render(ctx, null); return; }
    render(ctx, null);
    try {
      const stats = await api.rpc('GET', `stats?path=${encodeURIComponent(ctx.project.path)}`);
      cache = { projectPath: ctx.project.path, stats };
      render(ctx, stats);
    } catch (err) {
      const c = v(ctx.theme === 'dark');
      root.style.background = c.bg;
      root.innerHTML = `
        <div style="padding:24px;font-size:0.78rem;color:${c.accent};opacity:0.8;font-family:${MONO}">
          ✗ ${err.message}
        </div>`;
    }
  }

  load(api.context);

  const unsubscribe = api.onContextChange(ctx => {
    if (ctx.project?.path === cache?.projectPath) render(ctx, cache?.stats ?? null);
    else load(ctx);
  });

  container._psUnsubscribe = unsubscribe;
}

export function unmount(container) {
  if (typeof container._psUnsubscribe === 'function') {
    container._psUnsubscribe();
    delete container._psUnsubscribe;
  }
  container.innerHTML = '';
}
