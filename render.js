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

// A fair die needs to be *isohedral*: every face equivalent under the solid's
// symmetry group, so each has equal probability. Two families cover every face
// count, which is how real d10s, d14s, d24s and d30s are actually made.

// Bipyramid: two apexes over a regular n-gon equator gives 2n triangular faces.
// Triangles are planar by construction, so the only tuning is apex height.
function bipyramid(n) {
  const H = 1.15;
  const verts = [[0, H, 0], [0, -H, 0]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    verts.push([Math.cos(a), 0, Math.sin(a)]);
  }
  const ring = i => 2 + (i % n);
  const faces = [];
  for (let i = 0; i < n; i++) {
    faces.push([0, ring(i), ring(i + 1)]);
    faces.push([1, ring(i + 1), ring(i)]);
  }
  return normalize({ verts, faces });
}

// Trapezohedron: two offset rings plus an apex at each pole, giving 2n kite
// faces. The apex height is not free — the kite [apex, top_i, bot_i, top_i+1]
// is planar only at this exact ratio. Choosing H by eye bowties every face,
// which renders as a tangle of crossing edges.
function trapezohedron(n) {
  // Planarity fixes the apex height exactly, relative to a unit ring radius:
  // H = 2/(1 - cos(pi/n)) - 1 with the rings at y = +/-1. That ratio is scale
  // invariant but grows fast with n, so the raw solid is a needle: at n=15 the
  // apex sits 60x further out than the equator. Squashing y by H brings the
  // poles back to the ring radius, giving the near-spherical proportions a
  // physical d30 actually has. Scaling one axis preserves planarity.
  const h = 1;
  const H = 2 / (1 - Math.cos(Math.PI / n)) - 1;
  // Squashing the poles to exactly the ring radius leaves a sharp bicone, but
  // over-squashing flattens the die into a pinwheel disc. Taller poles as n
  // grows keep high-count dice reading as solids rather than plates.
  const squash = (1 / H) * (n > 6 ? 1.35 : 1.0);

  const verts = [[0, H * squash, 0], [0, -H * squash, 0]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    verts.push([Math.cos(a), h * squash, Math.sin(a)]);
  }
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * TAU;
    verts.push([Math.cos(a), -h * squash, Math.sin(a)]);
  }

  const top = i => 2 + (i % n);
  const bot = i => 2 + n + (i % n);
  const faces = [];
  for (let i = 0; i < n; i++) {
    faces.push([0, top(i), bot(i), top(i + 1)]);
    faces.push([1, bot(i + n - 1), top(i), bot(i)]);
  }
  return normalize({ verts, faces });
}

// d2 is a coin, not a polyhedron: a short cylinder with two large faces. Any
// two-faced solid is impossible, and a coin is what you'd actually flip.
function coin(segments = 20) {
  const verts = [];
  const half = 0.13;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    verts.push([Math.cos(a), half, Math.sin(a)]);
  }
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    verts.push([Math.cos(a), -half, Math.sin(a)]);
  }
  const faces = [
    Array.from({ length: segments }, (_, i) => i),
    Array.from({ length: segments }, (_, i) => 2 * segments - 1 - i),
  ];
  // The rim is drawn as quads so the edge reads as thickness, not a hairline.
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push([i, j, segments + j, segments + i]);
  }
  return normalize({ verts, faces });
}

function normalize(solid) {
  const scale = Math.max(...solid.verts.map(v => Math.hypot(...v)));
  return { verts: solid.verts.map(v => v.map(x => x / scale)), faces: solid.faces };
}

const SOLIDS = { 4: tetra, 6: cube, 8: octa, 12: dodeca, 20: icosa };

// Cache: the hull recovery in dodeca/icosa is O(v^3), and barrels get rebuilt
// on every roll otherwise.
const solidCache = new Map();

// Every die gets a real, fair solid — no flat tokens.
//
//   - Coin for d2, since no two-faced polyhedron exists
//   - Platonic solids where one exists (d4, d6, d8, d12, d20)
//   - Trapezohedron for even counts: 2n kite faces. This is how physical d10s
//     are made, and it extends to d14, d16, d24, d30 and beyond.
//   - Bipyramid for odd counts: 2n triangles over an n-gon equator, then one
//     face is simply never selected. A true odd-faced isohedron doesn't exist,
//     and this is the standard physical compromise.
//
// Both families are isohedral, so every face is equivalent under the solid's
// symmetry — the geometric property that makes a die fair. (The roll itself is
// decided by crypto RNG regardless; this is about the shape being honest.)
export function solidFor(sides) {
  if (sides < 2) return null; // d1 has no meaningful shape
  if (solidCache.has(sides)) return solidCache.get(sides);

  let solid;
  if (sides === 2) {
    solid = coin();
  } else if (SOLIDS[sides]) {
    solid = SOLIDS[sides]();
  } else {
    // Past ~32 faces the facets are too fine to read as anything but a sphere,
    // so cap the geometry while the die still reports its true side count.
    const faces = Math.min(sides, 32);
    // A trapezohedron needs at least 3 kites per pole; below that (d2, d4) the
    // construction degenerates, so fall back to the bipyramid.
    solid = (faces % 2 === 0 && faces / 2 >= 3)
      ? trapezohedron(faces / 2)
      : bipyramid(Math.max(3, Math.ceil(faces / 2)));
  }

  solidCache.set(sides, solid);
  return solid;
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
    this.targetRot = null; // recomputed for wherever this throw lands
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

      // Ease toward the slot the layout assigned, so dice spread out instead of
      // landing wherever momentum happens to leave them.
      if (this.homeX !== undefined) {
        this.vx += (this.homeX - this.x) * 3.2 * dt;
        this.vy += (this.homeY - this.y) * 3.2 * dt;
      }

      if (Math.hypot(this.vx, this.vy) < 8 && Math.abs(this.spin[0]) < 0.02) {
        this.settling = true;
        this.settleT = 0;
        this.restRot = this.rot.slice();
      }
    } else {
      // Ease the tumble to a stop, rotating toward an orientation that presents
      // a face to the camera. Landing on a pole or a vertex reads as a spike and
      // leaves nowhere to paint the numeral.
      if (!this.targetRot) this.targetRot = this.findFaceUpRotation();
      this.settleT = Math.min(1, this.settleT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.settleT, 3);
      for (let i = 0; i < 3; i++) {
        this.rot[i] = this.restRot[i] + (this.targetRot[i] - this.restRot[i]) * e;
      }
      if (this.settleT >= 1) this.settled = true;
    }
  }

  // Search nearby rotations for one that turns some face toward the camera.
  // Sampling beats solving for it: the solids differ enough in face layout that
  // a closed form would need per-family special cases, and this runs once.
  findFaceUpRotation() {
    if (!this.solid) return this.rot.slice();
    let best = this.rot.slice(), bestScore = -Infinity;

    for (let i = 0; i < 90; i++) {
      // First candidate is the current pose, so an already-good landing sticks.
      const cand = i === 0 ? this.rot.slice() : [
        this.rot[0] + (Math.random() - 0.5) * 2.6,
        this.rot[1] + (Math.random() - 0.5) * 2.6,
        this.rot[2] + (Math.random() - 0.5) * 2.6,
      ];
      const pts = this.solid.verts.map(v => rotate(v, cand[0], cand[1], cand[2]));

      let facing = 0;
      for (const face of this.solid.faces) {
        const n = faceNormal(face.map(i2 => pts[i2]));
        const len = Math.hypot(...n);
        if (len) facing = Math.max(facing, n[2] / len);
      }
      // Prefer a square-on face, but stay near the pose it actually landed in.
      const drift = Math.abs(cand[0] - this.rot[0]) + Math.abs(cand[1] - this.rot[1]);
      const score = facing - drift * 0.06;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    return best;
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

    this.drawValue(ctx, theme, s, pts, proj);
    ctx.restore();
  }

  // Paint the numeral onto the face that most directly faces the camera, using
  // that face's own plane. The glyph is skewed to sit in the surface rather than
  // floating flat over the shape, so it tracks the die as it tumbles.
  drawValue(ctx, theme, s, pts, proj) {
    let best = null, bestFacing = 0.2;
    for (const face of this.solid.faces) {
      const fp = face.map(i => pts[i]);
      const n = faceNormal(fp);
      const len = Math.hypot(...n);
      if (!len) continue;
      const facing = n[2] / len;
      if (facing > bestFacing) { bestFacing = facing; best = face; }
    }
    if (!best) return;

    // Face centre in screen space, and two in-plane axes to skew the glyph with.
    const c2 = best.reduce((a, i) => [a[0] + proj[i][0], a[1] + proj[i][1]], [0, 0])
                   .map(v => v / best.length);
    const e0 = proj[best[0]];
    let ux = e0[0] - c2[0], uy = e0[1] - c2[1];
    const ulen = Math.hypot(ux, uy) || 1;
    ux /= ulen; uy /= ulen;

    const label = String(this.value);
    // Long labels (d100 can show 3 digits) need to shrink to stay on the face.
    const fit = label.length > 2 ? 0.34 : label.length > 1 ? 0.42 : 0.52;
    const size = Math.max(7, s * fit * (0.55 + 0.45 * bestFacing));

    ctx.save();
    ctx.translate(c2[0], c2[1]);
    // Rotate to the face's own axis, then squash vertically by how much the
    // face is turned away — the same foreshortening the edges already show.
    ctx.transform(ux, uy, -uy * bestFacing, ux * bestFacing, 0, 0);
    ctx.font = `600 ${size}px "Iosevka Etoile", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.line;
    ctx.globalAlpha = this.settled ? 1 : 0.35 + 0.65 * bestFacing;
    ctx.fillText(label, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
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

// Push overlapping dice apart. Runs every frame, including after they settle, so
// a die can never come to rest on top of another one.
export function separate(dice, bounds, iterations = 3) {
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (let i = 0; i < dice.length; i++) {
      for (let j = i + 1; j < dice.length; j++) {
        const a = dice[i], b = dice[j];
        const min = (a.size + b.size) * 0.5 * 0.92;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= min) continue;

        // Perfectly coincident dice have no separation axis; nudge deterministically.
        if (dist < 1e-6) { dx = (i % 2 ? 1 : -1); dy = (j % 2 ? 1 : -1); dist = Math.hypot(dx, dy); }

        const push = (min - dist) / 2;
        const nx = (dx / dist) * push, ny = (dy / dist) * push;
        a.x -= nx; a.y -= ny;
        b.x += nx; b.y += ny;
        moved = true;
      }
    }
    for (const d of dice) {
      const r = d.size * 0.5;
      d.x = Math.max(bounds.left + r, Math.min(bounds.right - r, d.x));
      d.y = Math.max(bounds.top + r, Math.min(bounds.floor - r, d.y));
    }
    if (!moved) break;
  }
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
