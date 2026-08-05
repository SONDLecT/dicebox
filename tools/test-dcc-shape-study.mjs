import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'dcc-shape-study.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dicebox-shape-study-'));
let passed = 0;

function ok(name, condition, detail = '') {
  if (!condition) throw new Error(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  PASS  ${name}`);
  passed++;
}

function generate(name) {
  const out = path.join(tmp, name);
  const run = spawnSync(process.execPath, [script, '--out', out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return { svg: fs.readFileSync(out, 'utf8'), stdout: run.stdout };
}

try {
  const first = generate('first.svg');
  const second = generate('second.svg');
  ok('shape study is deterministic',
     crypto.createHash('sha256').update(first.svg).digest('hex') ===
     crypto.createHash('sha256').update(second.svg).digest('hex'));
  ok('gallery declares review-only scope', first.svg.includes('Review-only artifact') && first.svg.includes('runtime geometry is unchanged'));
  ok('gallery contains no active or remote content',
     !/<script\b|\bonload\s*=|javascript:|(?:href|src)=["']https?:/i.test(first.svg));
  ok('gallery covers all target rows', ['d3','d5','d7','d14','d16','d24','d30'].every(d => first.svg.includes(`>${d}<`)));
  ok('gallery includes retained controls', ['d4','d6','d8','d10','d12','d20'].every(d => first.svg.includes(`>${d}<`)));
  ok('d5 alternatives are present', first.svg.includes('A · triangular prism') && first.svg.includes('B · softened prism'));
  ok('d7 alternatives are present', first.svg.includes('A · pentagonal prism') && first.svg.includes('Rounder Impact-like study'));
  ok('d24 alternatives are present', first.svg.includes('deltoidal icositetrahedron') && first.svg.includes('tetrakis hexahedron'));
  ok('d30 landmark is present', first.svg.includes('Rhombic triacontahedron') && first.stdout.includes('d30Rhombic'));
  ok('candidate topology checks ran', ['cubeD3','d5Prism','d5Soft','d7Prism','d7Soft','d14Rounder','d16Bipyramid','d24Deltoidal','d24Tetrakis','d30Rhombic'].every(n => first.stdout.includes(`${n}`)));
  ok('every checked candidate is manifold', !first.stdout.includes('manifold=false'));
  ok('every checked candidate is planar and convex', !first.stdout.includes('valid=false') && first.stdout.includes('valid=true'));

  const hostileReference = path.join(tmp, 'reference.png" onload="alert(1)');
  fs.writeFileSync(hostileReference, 'not-an-image');
  const hostileOut = path.join(tmp, 'hostile.svg');
  const hostile = spawnSync(process.execPath, [script, '--out', hostileOut, '--reference', hostileReference], { encoding: 'utf8' });
  ok('unsafe reference extensions are rejected', hostile.status !== 0,
     `exit ${hostile.status}; ${hostile.stderr || hostile.stdout}`);

  const missing = spawnSync(process.execPath, [script, '--out', path.join(tmp, 'missing.svg'), '--reference', path.join(tmp, 'missing.png')], { encoding: 'utf8' });
  ok('an explicitly requested missing reference fails clearly', missing.status !== 0,
     `exit ${missing.status}; ${missing.stderr || missing.stdout}`);

  console.log(`\n${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
