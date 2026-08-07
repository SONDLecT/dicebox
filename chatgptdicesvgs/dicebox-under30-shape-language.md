# Dicebox under-30 shape language

## Decision

Use **support-plane vertex truncations of the preceding locked landmark**.

Each truncation removes one exposed vertex and introduces exactly one new planar face. The numbered face count is therefore exact:

```text
F(result) = sides
```

The fixed landmarks remain untouched:

```text
d8, d10, d12, d14, d16, d20, d24, d30
```

Generated gap values:

```text
d9 d11 d13 d15 d17 d18 d19 d21 d22 d23 d25 d26 d27 d28 d29
```

## Exact truncation construction

Input is a convex, outward-wound landmark mesh `P = {verts, faces}` centered at the origin.

For selected vertex `v` with adjacent vertices `N(v)`:

```text
n  = v / |v|
hv = n·v
g  = min(u in N(v)) (hv - n·u)
c  = hv - tau*g
```

For every incident edge `(v,u)`, create the intersection point:

```text
lambda_u = (c - hv) / (n·u - hv)
p_u      = v + lambda_u*(u-v)
```

All `p_u` satisfy `n·p_u = c`, so the new face is exactly planar.

Replace each occurrence of:

```text
previous -> v -> next
```

with:

```text
previous -> p_previous -> p_next -> next
```

Then add the cap face through the `p_u` points, with winding opposite to the new boundary edges in the incident faces.

Finally apply the family aspect transform:

```text
D(a) = diag(1, a, 1)
```

and normalize by the maximum vertex radius. A nonsingular linear transform preserves topology, planarity and convexity.

The specified `tau` values are all below `0.27`. Selected vertices within a family form an independent set, so truncation regions do not share an original edge and cannot overlap.

## Band table

| Die | Base landmark | Selected vertices | `tau` | Y scale `a` | Family/profile |
|---:|---:|---|---:|---:|---|
| 9 | d8 | highest vertex, degree 4 | 0.220 | 0.820 | squat capped octahedron |
| 11 | d10 | upper pole, degree 5 | 0.200 | 1.180 | tall pentagonal crown |
| 13 | d12 | highest vertex, degree 3 | 0.240 | 0.900 | squat triangular crown |
| 15 | d14 | upper pole, degree 7 | 0.170 | 1.120 | tall heptagonal crown |
| 17 | d16 | 1 of 3 spread degree-4 belt vertices | 0.180 | 1.220 | tall keyed octa-shoulder |
| 18 | d16 | 2 of 3 spread degree-4 belt vertices | 0.220 | 1.070 | medium double shoulder |
| 19 | d16 | 3 of 3 spread degree-4 belt vertices | 0.260 | 0.920 | squat triple shoulder |
| 21 | d20 | 1 of a max-spread independent degree-5 triple | 0.160 | 0.880 | squat icosa crown |
| 22 | d20 | 2 of the same triple | 0.195 | 0.990 | balanced double crown |
| 23 | d20 | all 3 | 0.230 | 1.100 | tall triple crown |
| 25 | d24 | 1 of a max-spread independent degree-3 quintet | 0.120 | 1.180 | tall keyed d24 belt |
| 26 | d24 | 2 of the same quintet | 0.145 | 1.095 | two-key belt |
| 27 | d24 | 3 of the same quintet | 0.170 | 1.010 | balanced three-key belt |
| 28 | d24 | 4 of the same quintet | 0.195 | 0.925 | squat four-key belt |
| 29 | d24 | all 5 | 0.220 | 0.840 | broad five-key belt |

### Smooth family functions

For `s = 17..19`:

```text
q16(s)   = s - 16
tau16(s) = 0.18 + 0.04*(s - 17)
a16(s)   = 1.22 - 0.15*(s - 17)
```

For `s = 21..23`:

```text
q20(s)   = s - 20
tau20(s) = 0.16 + 0.035*(s - 21)
a20(s)   = 0.88 + 0.11*(s - 21)
```

For `s = 25..29`:

```text
q24(s)   = s - 24
tau24(s) = 0.12 + 0.025*(s - 25)
a24(s)   = 1.18 - 0.085*(s - 25)
```

Both depth and axial proportion are monotonic within each family. The discrete increase in `q` is required by exact face count: every newly introduced cap is one additional die face.

## Exact topology counts

Truncating a degree-`k` vertex changes topology by:

```text
Delta V = k - 1
Delta E = k
Delta F = 1
```

| Die | V | E | F | Euler |
|---:|---:|---:|---:|---:|
| d9 | 9 | 16 | 9 | 2 |
| d11 | 16 | 25 | 11 | 2 |
| d13 | 22 | 33 | 13 | 2 |
| d15 | 22 | 35 | 15 | 2 |
| d17 | 13 | 28 | 17 | 2 |
| d18 | 16 | 32 | 18 | 2 |
| d19 | 19 | 36 | 19 | 2 |
| d21 | 16 | 35 | 21 | 2 |
| d22 | 20 | 40 | 22 | 2 |
| d23 | 24 | 45 | 23 | 2 |
| d25 | 28 | 51 | 25 | 2 |
| d26 | 30 | 54 | 26 | 2 |
| d27 | 32 | 57 | 27 | 2 |
| d28 | 34 | 60 | 28 | 2 |
| d29 | 36 | 63 | 29 | 2 |

The maximum generated gap mesh is therefore only:

```text
36 vertices / 63 edges / 29 faces
```

### d24 anchor requirement

The d25-d29 count table assumes the locked d24 has `V=26`, `E=48`, `F=24` and at least five mutually nonadjacent degree-3 vertices. Both common d24 anchors satisfy this:

- a 12-fold trapezohedron has 24 degree-3 ring vertices;
- a deltoidal icositetrahedron has eight degree-3 vertices.

## Selection rules

Selection is geometric/topological rather than tied to fragile hard-coded indices.

```text
d9/d11/d13/d15:
    maximum Y vertex

d17-d19:
    choose a maximum-spread independent set of 3 degree-4 vertices on d16

d21-d23:
    choose a maximum-spread independent set of 3 degree-5 vertices on d20

d25-d29:
    choose a maximum-spread independent set of 5 degree-3 vertices on d24
```

For a candidate set `C`, maximize:

```text
min pairwise Euclidean distance
```

subject to no selected pair sharing an edge. Order the chosen set by highest Y first, then repeatedly add the point farthest from the already active set. Prefixes are therefore stable: d18 contains all d17 cuts, d19 contains all d18 cuts, and so on.

## Integration

Insert before the generic pointed/spherical fallback:

```js
const UNDER_30_GAPS = new Set([
  9,11,13,15,17,18,19,21,22,23,25,26,27,28,29,
]);

if (UNDER_30_GAPS.has(sides)) {
  solid = under30GapSolid(sides, canonicalFor);
}
```

`canonicalFor(n)` must return the already-approved mesh for the requested landmark. The generator clones it and does not modify the canonical instance.

## Invariant checklist

Assert every generated solid:

```text
1. face count equals requested side count
2. every face has at least 3 distinct indices
3. every index is valid
4. every undirected edge occurs in exactly 2 faces
5. every shared edge is traversed in opposite directions
6. V - E + F == 2
7. maximum face planarity error < 1e-8
8. dot(faceNormal, faceCentroid - solidCentroid) > 0
9. every vertex lies on or behind every outward face plane, tolerance 1e-8
10. every vertex participates in at least 3 edges
11. maximum V <= 36
12. maximum E <= 63
13. maximum F <= 29
14. repeated generation is byte-stable
```

## Engineering note

These solids deliberately do not attempt equal face areas. Dicebox decides the result before animation, so the mesh is a readable presentation of an exact face count rather than a physical fairness simulation.
