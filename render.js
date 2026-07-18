// Wireframe die rendering + throw simulation.
//
// Dice are drawn as pure line work: no fill, no shadow. Depth comes only from
// drawing back-facing edges at reduced opacity. The "table" is one hairline rule.

const TAU = Math.PI * 2;

// Unit-radius polyhedra. Faces are index loops into verts; each face carries the
// pip value shown when that face points at the camera.
function tetra() {
  const v = [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].map(norm);
  return { verts: v, faces: [[0,1,2],[0,3,1],[0,2,3],[1,3,2]] };
}
function cube() {
  const v = [];
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) v.push(norm([x,y,z]));
  return { verts: v, faces: [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]] };
}
function octa() {
  const v = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  return { verts: v, faces: [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]] };
}
function dodeca() {
  const p = (1 + Math.sqrt(5)) / 2, q = 1 / p, v = [];
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) v.push(norm([x,y,z]));
  for (const s of [-1,1]) for (const t of [-1,1]) {
    v.push(norm([0, s*q, t*p])); v.push(norm([s*q, t*p, 0])); v.push(norm([s*p, 0, t*q]));
  }
  return { verts: v, faces: hullFaces(v, 5) };
}
function icosa() {
  const p = (1 + Math.sqrt(5)) / 2, v = [];
  for (const s of [-1,1]) for (const t of [-1,1]) {
    v.push(norm([0, s, t*p])); v.push(norm([s, t*p, 0])); v.push(norm([s*p, 0, t]));
  }
  return { verts: v, faces: hullFaces(v, 3) };
}

function norm(v) {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0]/m, v[1]/m, v[2]/m];
}

// Recover faces from a vertex cloud on the unit sphere by grouping vertices that
// share a common plane. Cheaper than a full convex hull and exact for these solids.
function hullFaces(verts, size) {
  const faces = [], seen = new Set();
  for (let i = 0; i < verts.length; i++) {
    for (let j = i+1; j < verts.length; j++) {
      for (let k = j+1; k < verts.length; k++) {
        let n = norm(cross(sub(verts[j], verts[i]), sub(verts[k], verts[i])));
        if (!Number.isFinite(n[0])) continue; // collinear triple
        let d = dot(n, verts[i]);

        // Orient the normal outward. Testing `d > threshold` instead would drop
        // every face on the far side of the origin — that silently cost the
        // icosahedron half its faces.
        if (d < 0) { n = n.map(x => -x); d = -d; }
        if (d < 1e-9) continue; // plane through the centre bounds nothing

        // A supporting plane of the hull has every vertex on one side of it.
        // Without this test, any coplanar set qualifies — including internal
        // cross-sections, which gave the d12 twelve phantom faces.
        const on = [];
        let bounding = true;
        for (let m = 0; m < verts.length; m++) {
          const side = dot(n, verts[m]) - d;
          if (Math.abs(side) < 1e-6) on.push(m);
          else if (side > 1e-6) bounding = false;
        }
        if (!bounding) continue;
        if (on.length !== size) continue;
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push(sortRing(on, verts, n));
      }
    }
  }
  return faces;
}

function sortRing(idx, verts, n) {
  const c = idx.reduce((a, i) => [a[0]+verts[i][0], a[1]+verts[i][1], a[2]+verts[i][2]], [0,0,0])
                .map(x => x / idx.length);
  const u = norm(sub(verts[idx[0]], c));
  const w = cross(n, u);
  return idx.slice().sort((a, b) => {
    const va = sub(verts[a], c), vb = sub(verts[b], c);
    return Math.atan2(dot(va, w), dot(va, u)) - Math.atan2(dot(vb, w), dot(vb, u));
  });
}

const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

const SOLIDS = { 4: tetra, 6: cube, 8: octa, 12: dodeca, 20: icosa };

// Dice whose side count has no matching Platonic solid (d10, d100, d3, d30, d7…)
// are drawn as a flat rounded token with the numeral stroked on it. Faking a
// barrel or trapezohedron for every arbitrary side count would read worse than
// an honest token, and arbitrary sides are a first-class feature here.
export function solidFor(sides) {
  return SOLIDS[sides] ? SOLIDS[sides]() : null;
}

export class Die {
  constructor(sides, value, x, y, size) {
    this.sides = sides;
    this.value = value;
    this.size = size;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.solid = solidFor(sides);
    this.rot = [Math.random()*TAU, Math.random()*TAU, Math.random()*TAU];
    this.spin = [0, 0, 0];
    this.settling = false;
    this.settled = false;
    this.settleT = 0;
    this.restRot = null;
  }

  throwWith(vx, vy) {
    this.vx = vx; this.vy = vy;
    const speed = Math.hypot(vx, vy);
    this.spin = [
      (Math.random()-0.5) * 0.02 * speed + 0.15,
      (Math.random()-0.5) * 0.02 * speed + 0.15,
      (Math.random()-0.5) * 0.02 * speed,
    ];
    this.settling = false;
    this.settled = false;
  }

  step(dt, bounds) {
    if (this.settled) return;

    if (!this.settling) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= 0.94;
      this.vy *= 0.94;

      const r = this.size * 0.55;
      if (this.x < bounds.left + r) { this.x = bounds.left + r; this.vx = Math.abs(this.vx) * 0.55; }
      if (this.x > bounds.right - r) { this.x = bounds.right - r; this.vx = -Math.abs(this.vx) * 0.55; }
      if (this.y < bounds.top + r) { this.y = bounds.top + r; this.vy = Math.abs(this.vy) * 0.55; }
      if (this.y > bounds.floor - r) { this.y = bounds.floor - r; this.vy = -Math.abs(this.vy) * 0.55; }

      for (let i = 0; i < 3; i++) {
        this.rot[i] += this.spin[i] * dt * 60;
        this.spin[i] *= 0.965;
      }

      if (Math.hypot(this.vx, this.vy) < 8 && Math.abs(this.spin[0]) < 0.02) {
        this.settling = true;
        this.settleT = 0;
        this.restRot = this.rot.slice();
      }
    } else {
      // Ease the tumble to a stop. The face value is already decided by the
      // roller; this is presentation, so we just park the die at a clean angle.
      this.settleT = Math.min(1, this.settleT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.settleT, 3);
      for (let i = 0; i < 3; i++) {
        this.rot[i] = this.restRot[i] + this.spin[i] * 8 * e;
      }
      if (this.settleT >= 1) this.settled = true;
    }
  }

  draw(ctx, theme) {
    const s = this.size * 0.5;
    ctx.save();
    ctx.translate(this.x, this.y);

    if (!this.solid) {
      this.drawToken(ctx, theme, s);
      ctx.restore();
      return;
    }

    const [rx, ry, rz] = this.rot;
    const pts = this.solid.verts.map(v => rotate(v, rx, ry, rz));
    const proj = pts.map(p => {
      const d = 4 / (4 - p[2]);
      return [p[0] * s * d, p[1] * s * d, p[2]];
    });

    // Back edges first, faint; front edges over them at full strength.
    const edges = new Map();
    for (const face of this.solid.faces) {
      const n = faceNormal(face.map(i => pts[i]));
      const front = n[2] > 0;
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i+1) % face.length];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) || false) || front);
      }
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const pass of [false, true]) {
      ctx.beginPath();
      for (const [key, front] of edges) {
        if (front !== pass) continue;
        const [a, b] = key.split(':').map(Number);
        ctx.moveTo(proj[a][0], proj[a][1]);
        ctx.lineTo(proj[b][0], proj[b][1]);
      }
      ctx.strokeStyle = theme.line;
      ctx.globalAlpha = pass ? 1 : 0.22;
      ctx.lineWidth = pass ? 1.6 : 1.1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (this.settled) this.drawValue(ctx, theme, s);
    ctx.restore();
  }

  // Numeral on the face pointing at the camera, so the value sits where a real
  // die would show it rather than floating over the whole shape.
  drawValue(ctx, theme, s) {
    ctx.font = `600 ${s * 0.62}px "Iosevka Etoile", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.line;
    ctx.fillText(String(this.value), 0, s * 0.04);
  }

  drawToken(ctx, theme, s) {
    const r = s * 0.34;
    ctx.beginPath();
    roundRect(ctx, -s*0.82, -s*0.82, s*1.64, s*1.64, r);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.font = `500 ${s * 0.26}px "Inter Tight", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.muted;
    ctx.fillText(`d${this.sides}`, 0, -s * 0.42);

    ctx.font = `600 ${s * 0.6}px "Iosevka Etoile", ui-monospace, monospace`;
    ctx.fillStyle = theme.line;
    ctx.fillText(String(this.settled ? this.value : '·'), 0, s * 0.14);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function rotate(v, rx, ry, rz) {
  let [x, y, z] = v;
  let c = Math.cos(rx), s = Math.sin(rx);
  [y, z] = [y*c - z*s, y*s + z*c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x*c + z*s, -x*s + z*c];
  c = Math.cos(rz); s = Math.sin(rz);
  [x, y] = [x*c - y*s, x*s + y*c];
  return [x, y, z];
}

function faceNormal(pts) {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  const c = pts.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]);
  // Point the normal outward from the centroid before testing facing.
  return dot(n, c) < 0 ? n.map(x => -x) : n;
}

// One hairline for the table, plus a ripple that expands where a die lands.
export class Surface {
  constructor() { this.ripples = []; }
  impact(x, y) { this.ripples.push({ x, y, t: 0 }); }
  step(dt) {
    this.ripples = this.ripples.filter(r => (r.t += dt) < 1);
  }
  draw(ctx, theme, bounds) {
    ctx.save();
    ctx.strokeStyle = theme.muted;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bounds.left, bounds.floor);
    ctx.lineTo(bounds.right, bounds.floor);
    ctx.stroke();

    for (const r of this.ripples) {
      const e = 1 - Math.pow(1 - r.t, 2);
      ctx.globalAlpha = 0.3 * (1 - r.t);
      ctx.beginPath();
      ctx.ellipse(r.x, bounds.floor, 12 + e * 90, 3 + e * 16, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}
