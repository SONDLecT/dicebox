# Dicebox d21–d29 regular exact-face set

## Why the previous shapes looked lumpy

The earlier construction added one local truncation for every extra face. The d20 and d24 landmark solids do not have symmetry orbits of size 1–5, so those cuts cannot be distributed equivalently. Each new face therefore created a unique low-support direction and an uneven projected outline.

This replacement never performs local cuts. Every generated ring is a regular polygon, every sector changes together, and adjacent rings are homothetic with identical angular phase. The result has controlled axial silhouettes and exactly planar quad belts.

## Construction

### Odd d21, d23, d25, d27, d29

For `s = 2m + 1`: one apex, two regular m-gon rings and one polygon cap.

- `m` triangular crown faces
- `m` planar quadrilateral belt faces
- `1` polygon cap
- `F = 2m + 1 = s`
- `V = 2m + 1 = s`
- `E = 4m = 2s - 2`

Parameters:

```text
q = (s - 21) / 8
aspect      = 0.94 + 0.34 q
upperRadius = 0.78 + 0.08 q
apexY       = aspect
upperRingY  = 0.18 aspect
lowerRingY  = -0.64 aspect
```

### Even d22, d26, d28

For `s = 2m + 2`: three regular m-gon rings and two polygon caps.

- `2m` planar quadrilateral belt faces
- `2` polygon caps
- `F = 2m + 2 = s`
- `V = 3m`
- `E = 5m`

Parameters:

```text
q = (s - 22) / 6
aspect    = 1.12 - 0.27 q
capRadius = 0.60 + 0.09 q
topRingY  = 0.86 aspect
middleY   = 0
bottomY   = -topRingY
```

### d24

The locked d24 is the exact deltoidal icositetrahedron: 26 vertices, 48 edges and 24 congruent planar kite faces.

## Counts

| Die | Family | V | E | F |
|---:|---|---:|---:|---:|
| d21 | odd-crown-prismatoid | 21 | 40 | 21 |
| d22 | even-terraced-lantern | 30 | 50 | 22 |
| d23 | odd-crown-prismatoid | 23 | 44 | 23 |
| d24 | deltoidal-icositetrahedron | 26 | 48 | 24 |
| d25 | odd-crown-prismatoid | 25 | 48 | 25 |
| d26 | even-terraced-lantern | 36 | 60 | 26 |
| d27 | odd-crown-prismatoid | 27 | 52 | 27 |
| d28 | even-terraced-lantern | 39 | 65 | 28 |
| d29 | odd-crown-prismatoid | 29 | 56 | 29 |

## Invariants

Every exported mesh was checked for:

- exactly `sides` faces;
- two incident faces per undirected edge;
- opposite directed use of every shared edge;
- Euler characteristic 2;
- planar faces;
- outward winding;
- convexity;
- centering at the solid volume centroid;
- normalization to circumradius 1.