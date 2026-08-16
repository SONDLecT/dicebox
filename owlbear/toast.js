// Fills the toast from its query string: a text row always, and — when the roll
// carried dice — a replay of the throw on the panel's own renderer, tumbling in
// and settling on the real values, painted by the same shared stamping the tray
// uses (system colours, Genesys symbols, V5 glyphs, percentile labels). The
// background owns opening and closing; this page only displays and, on click,
// asks for its own close.
import { Die, Surface, separate, beginFrame } from '/render.js';
import { stampTrayDie } from '/tray-faces.js';

const params = new URLSearchParams(location.search);
const put = (id, key) => {
  const el = document.getElementById(id);
  if (el) el.textContent = (params.get(key) || '').slice(0, 80);
};
put('who', 'who');
put('head', 'head');
put('sub', 'sub');

document.getElementById('toast')?.addEventListener('click', () => {
  import('/obr-sdk.js')
    .then(m => m.default.popover.close('cc.dicebox/toast'))
    .catch(() => { /* the timed close still lands */ });
});

// The roll rides in as JSON: its system, the summary fields the tints read, and
// the tray's own flattened paint list. Anything malformed just leaves the text
// row to do the talking.
let roll = null;
try {
  const parsed = JSON.parse(params.get('r') || 'null');
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.flat)) {
    roll = {
      system: typeof parsed.system === 'string' ? parsed.system : 'numeric',
      summary: parsed.summary && typeof parsed.summary === 'object' ? parsed.summary : {},
    };
    roll.flat = parsed.flat.filter(f => f && Number.isFinite(f.value)).slice(0, 14);
  }
} catch { /* text row only */ }

const canvas = document.getElementById('tray');
if (!roll || !roll.flat.length) {
  canvas?.remove();
} else if (canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || 248, H = canvas.clientHeight || 84;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bounds = { left: 6, right: W - 6, top: 6, floor: H - 10 };

  const spec = roll.flat;
  // As large as the little tray can carry: shrink only when the count forces it.
  const size = spec.length <= 4 ? 40 : spec.length <= 8 ? 30 : 22;
  const perRow = Math.max(1, Math.floor((W - 12) / (size + 6)));
  const rows = Math.ceil(spec.length / perRow);
  const dice = spec.map((f, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, spec.length - row * perRow);
    const homeX = W / 2 + (i % perRow - (inRow - 1) / 2) * (size + 6);
    const homeY = H / 2 + (row - (rows - 1) / 2) * (size + 4);
    const die = new Die(Number.isInteger(f.sides) ? f.sides : 10, f.value, -size, homeY + (Math.random() - 0.5) * 20, size);
    die.homeX = homeX;
    die.homeY = homeY;
    die.kept = f.kept;
    die.exploded = f.exploded;
    die.rerolled = f.rerolled;
    if (f.hunger) die.hunger = true;
    stampTrayDie(die, f, roll);
    die.throwWith((homeX - die.x) * 2.4, (homeY - die.y) * 2.4);
    return die;
  });

  const surface = new Surface();
  const theme = { paper: '#17181a', line: '#E6E4DD', muted: '#9a978f', accent: '#8FB79A' };
  let last = performance.now();
  let stillFor = 0;
  const frame = now => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    beginFrame();
    surface.step(dt);
    for (const d of dice) d.step(dt, bounds);
    separate(dice, bounds);
    ctx.clearRect(0, 0, W, H);
    surface.draw(ctx, theme);
    for (const d of dice) d.draw(ctx, theme);
    // The window outlives the throw, so the loop stops once everything has
    // settled for a moment rather than spinning until the popover closes.
    stillFor = dice.every(d => d.settled) ? stillFor + dt : 0;
    if (stillFor < 0.6) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
