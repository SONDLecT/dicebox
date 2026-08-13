// Oracle engine tests: text cleaning, table rolling, link resolution, and data
// integrity of the generated Ironsworn dataset.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { oracleText, rollOracle, oracleReading, oracleTableList, slugifyOracle, oracleSlug, findOracleBySlug } from '../oracle-dice.js';
import { IRONSWORN_ORACLES as IRON } from '../ironsworn-oracles.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
// A deterministic rng: feed it the rolls you want (1-based, like randInt).
const scripted = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

// ---- text cleaning ----
ok('strips id-links, keeps label', oracleText('The harm is mortal. [Face Death](id:classic/moves/suffer/face_death).') === 'The harm is mortal. Face Death.');
ok('strips __bold__ lead', oracleText('__A feature of the landscape.__ Envision it.') === 'A feature of the landscape. Envision it.');
ok('collapses whitespace', oracleText('a   b\n c') === 'a b c');
ok('empty is safe', oracleText(null) === '' && oracleText(undefined) === '');

// ---- dataset shape / attribution ----
ok('title present', IRON.title.includes('Ironsworn'));
ok('author is Tomkin', IRON.authors.includes('Shawn Tomkin'));
ok('license is CC BY 4.0', /creativecommons\.org\/licenses\/by\/4\.0/.test(IRON.license));
// Ironsworn folds in its Delve expansion (classic 38 + delve 48).
ok('86 tables (Ironsworn + Delve)', Object.keys(IRON.tables).length === 86);
ok('browse list covers all tables', oracleTableList(IRON).length === 86);
ok('table list carries a path', oracleTableList(IRON).every(t => Array.isArray(t.path) && t.path.length >= 1));

// ---- data integrity: every table's rows tile 1..sides with no gaps/overlaps ----
{
  let clean = true, offender = '';
  for (const [id, t] of Object.entries(IRON.tables)) {
    const rows = [...t.rows].sort((a, b) => a.a - b.a);
    if (rows[0].a !== 1) { clean = false; offender = `${id} starts at ${rows[0].a}`; break; }
    if (rows[rows.length - 1].b !== t.sides) { clean = false; offender = `${id} ends at ${rows[rows.length - 1].b}/${t.sides}`; break; }
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].a !== rows[i - 1].b + 1) { clean = false; offender = `${id} gap/overlap at ${rows[i].a}`; break; }
    }
    if (!clean) break;
  }
  ok('rows tile 1..sides contiguously', clean, offender);
}

// ---- rolling: row lookup + clamp ----
{
  const action = 'classic/oracles/turning_point/combat_action';
  // find a real table to roll deterministically: the "Action" table (1d100, 1 Scheme…)
  const actionTbl = Object.entries(IRON.tables).find(([, t]) => t.name === 'Action');
  ok('Action table exists', !!actionTbl);
  const [aid, at] = actionTbl;
  const r1 = rollOracle(IRON, aid, scripted(1));
  ok('roll 1 hits the first row', r1.roll === 1 && r1.text === at.rows[0].t.replace(/__/g, ''));
  const rMax = rollOracle(IRON, aid, scripted(at.sides));
  ok('roll at max hits the last row', rMax.roll === at.sides);
}

// ---- link resolution: "Roll twice" auto-expands to 2 sub-rolls ----
{
  // Character Goal 96-100 is "Roll twice" (auto, n=2, same table).
  const goal = Object.entries(IRON.tables).find(([, t]) => t.name === 'Character Goal');
  ok('Character Goal table exists', !!goal);
  const [gid] = goal;
  // First roll lands 96 (the roll-twice row); the two auto sub-rolls land 1 then 2.
  const res = rollOracle(IRON, gid, scripted(96, 1, 2));
  ok('roll-twice yields two auto links', res.links.length === 2, `got ${res.links.length}`);
  ok('sub-rolls are distinct values', res.links[0].roll !== res.links[1].roll);
  ok('reading joins parent + children', oracleReading(res).split(' + ').length >= 2);
}

// ---- optional (auto:false) links surface as suggestions, not auto-rolled ----
{
  const settle = Object.entries(IRON.tables).find(([, t]) => t.name === 'Settlement Name');
  if (settle) {
    const [sid] = settle;
    const res = rollOracle(IRON, sid, scripted(1)); // 1-15 links to landscape_feature, auto:false
    ok('optional link is suggested, not auto-rolled', res.links.length === 0 && res.suggested.length >= 1, `links=${res.links.length} suggested=${res.suggested.length}`);
    ok('suggestion carries a readable name', res.suggested[0].name && typeof res.suggested[0].name === 'string');
  } else { ok('Settlement Name table exists', false); }
}

// ---- recursion is bounded (no runaway on pathological data) ----
{
  const goal = Object.entries(IRON.tables).find(([, t]) => t.name === 'Character Goal')[0];
  // Always land on 96 (roll-twice) — depth guard must stop it terminating.
  const res = rollOracle(IRON, goal, scripted(96));
  ok('bounded recursion returns', !!res && Array.isArray(res.links));
}

// ---- notation slugs ----
ok('slugify basic', slugifyOracle('Pay the Price') === 'pay-the-price');
ok('slugify punctuation', slugifyOracle('50/50') === '50-50');
ok('slugify two words', slugifyOracle('Almost Certain') === 'almost-certain');
{
  // every table has a unique, round-tripping slug
  const list = oracleTableList(IRON);
  const slugs = list.map(t => oracleSlug(IRON, t.id));
  ok('every table has a slug', slugs.every(Boolean));
  ok('slugs are unique', new Set(slugs).size === slugs.length);
  ok('slug round-trips to its id', list.every(t => findOracleBySlug(IRON, oracleSlug(IRON, t.id)) === t.id));
}
{
  const byName = name => oracleTableList(IRON).find(t => t.name === name);
  ok('oracle:likely resolves', IRON.tables[findOracleBySlug(IRON, 'likely')].name === 'Likely');
  ok('oracle:50-50 resolves', IRON.tables[findOracleBySlug(IRON, '50-50')].name === '50/50');
  ok('oracle:pay-the-price resolves', IRON.tables[findOracleBySlug(IRON, 'pay-the-price')].name === 'Pay the Price');
  ok('unknown slug is null', findOracleBySlug(IRON, 'no-such-table') === null);
  ok('empty query is null', findOracleBySlug(IRON, '') === null);
  // a unique prefix still resolves
  const payId = byName('Pay the Price').id;
  ok('unique prefix resolves', findOracleBySlug(IRON, 'pay-the') === payId);
}

console.log(`\noracle-dice: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
