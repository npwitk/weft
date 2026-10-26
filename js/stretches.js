// Layout by stretch, the way Pinwake's Bangkok was drawn by hand: decide
// the big things (where interchanges go, which way each stretch between
// them runs) and let the stations follow, evenly spaced along each stretch.
//
// - Pins: interchanges, line ends, walkway stations, and anywhere the set
//   of lines changes. A stretch is the run of stations between two pins.
// - Only pins move. Each stretch is one straight run at an allowed angle,
//   or two runs joined by a single bend when it can't be straight, so a
//   stretch can't zigzag. Its length follows its number of stops.
// - Lines carry straight on through interchanges where they can, and each
//   stretch keeps roughly its real direction (after Nöllenburg & Wolff's
//   "relative position" rule), so the map still resembles the city.

import { dist, segmentsCross, pointSegment } from "./network.js";
import { dogleg, lerp } from "./paths.js";

const RAMP_PASSES = 40;
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

/// Splits the network into pins and the stretches between them.
export function contract(net) {
  const n = net.stations.length;
  const adj = Array.from({ length: n }, () => []);
  net.edges.forEach((e, ei) => { adj[e.a].push([e.b, ei]); adj[e.b].push([e.a, ei]); });
  const key = (ei) => [...net.edges[ei].lines].sort().join(",");
  const linked = new Set(net.transfers.flat());
  const pin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (adj[i].length !== 2 || linked.has(i) || key(adj[i][0][1]) !== key(adj[i][1][1])) pin[i] = 1;
  }
  // A stretch that comes back to where it started, or two stretches
  // between the same pins, would draw on top of itself: pin its middle.
  // A stretch whose real stations stray far from its straight chord (the
  // track curves round something) is split at the furthest one, like
  // Douglas–Peucker: where the track really turns, the map bends too.
  const G = net.stations.map((s) => s.geo);
  const tolerance = 1.5 * net.unit;
  for (;;) {
    const chains = walk(adj, pin, n);
    const seen = new Set();
    let fixed = false;
    for (const c of chains) {
      const k = c.a < c.b ? `${c.a}|${c.b}` : `${c.b}|${c.a}`;
      if ((c.a === c.b || seen.has(k)) && c.stations.length > 2) {
        pin[c.stations[Math.floor(c.stations.length / 2)]] = 1;
        fixed = true;
      } else if (c.stations.length > 2) {
        let far = -1, worst = tolerance;
        for (let j = 1; j + 1 < c.stations.length; j++) {
          const d = pointSegment(G[c.stations[j]], G[c.a], G[c.b]);
          if (d > worst) { worst = d; far = c.stations[j]; }
        }
        if (far >= 0) { pin[far] = 1; fixed = true; }
      }
      seen.add(k);
    }
    // Two chords crossing where the real tracks don't (lines running side
    // by side, one curving): split the longer stretch at its middle.
    if (!fixed) {
      const crossesReally = (c, d) => {
        for (let x = 0; x + 1 < c.stations.length; x++) {
          for (let y = 0; y + 1 < d.stations.length; y++) {
            if (segmentsCross(G[c.stations[x]], G[c.stations[x + 1]], G[d.stations[y]], G[d.stations[y + 1]])) return true;
          }
        }
        return false;
      };
      outer: for (let i = 0; i < chains.length; i++) {
        for (let j = i + 1; j < chains.length; j++) {
          const c = chains[i], d = chains[j];
          if (c.a === d.a || c.a === d.b || c.b === d.a || c.b === d.b) continue;
          if (!segmentsCross(G[c.a], G[c.b], G[d.a], G[d.b]) || crossesReally(c, d)) continue;
          const longer = c.stations.length >= d.stations.length ? c : d;
          if (longer.stations.length <= 2) continue;
          pin[longer.stations[Math.floor(longer.stations.length / 2)]] = 1;
          fixed = true;
          break outer;
        }
      }
    }
    if (!fixed) return finish(net, chains, pin, key);
  }
}

function walk(adj, pin, n) {
  const used = new Set();
  const chains = [];
  const from = (s) => {
    for (const [first, e0] of adj[s]) {
      if (used.has(e0)) continue;
      used.add(e0);
      const stations = [s, first], edges = [e0];
      let cur = first;
      while (!pin[cur]) {
        const next = adj[cur].find(([, ej]) => !used.has(ej));
        if (!next) break;
        used.add(next[1]);
        edges.push(next[1]);
        cur = next[0];
        stations.push(cur);
      }
      chains.push({ a: s, b: cur, stations, edges });
    }
  };
  for (let s = 0; s < n; s++) if (pin[s]) from(s);
  // Loops with no pin at all start anywhere.
  for (let s = 0; s < n; s++) {
    if (adj[s].some(([, ei]) => !used.has(ei))) { pin[s] = 1; from(s); }
  }
  return chains;
}

function finish(net, chains, pin, key) {
  const edgeChain = new Map();
  chains.forEach((c, ci) => {
    c.k = c.stations.length - 1;
    c.lines = key(c.edges[0]);
    c.edges.forEach((ei) => edgeChain.set(ei, ci));
  });
  const edgeIndex = new Map(net.edges.map((e, ei) => [`${e.a}|${e.b}`, ei]));
  const edgeOf = (u, v) => edgeIndex.get(u < v ? `${u}|${v}` : `${v}|${u}`);
  // Where a line goes from one stretch into the next: (in, pin, out).
  const joints = new Map();
  for (const line of net.lines) {
    for (let k = 1; k + 1 < line.stops.length; k++) {
      const s = line.stops[k];
      if (!pin[s]) continue;
      const c1 = edgeChain.get(edgeOf(line.stops[k - 1], s)), c2 = edgeChain.get(edgeOf(s, line.stops[k + 1]));
      if (c1 == null || c2 == null || c1 === c2) continue;
      joints.set(`${Math.min(c1, c2)}|${s}|${Math.max(c1, c2)}`, [c1, s, c2]);
    }
  }
  const pins = [...pin.keys()].filter((i) => pin[i]);
  const pinChains = new Map(pins.map((p) => [p, []]));
  chains.forEach((c, ci) => { pinChains.get(c.a).push(ci); if (c.b !== c.a) pinChains.get(c.b).push(ci); });
  const pinJoints = new Map(pins.map((p) => [p, []]));
  for (const j of joints.values()) {
    const touched = new Set([j[1], ...[chains[j[0]], chains[j[2]]].flatMap((c) => [c.a, c.b])]);
    for (const p of touched) pinJoints.get(p)?.push(j);
  }
  return { pins, chains, pinChains, pinJoints, edgeChain, isPin: pin };
}

/// Adds the stretch structure to a layout state from layout.js.
export function createStretches(state) {
  const { net } = state;
  const c = contract(net);
  const G = net.stations.map((s) => s.geo);
  // Stretches may cross only where the real track does (not where their
  // straight chords happen to: the track can curve round another line).
  const geoCross = new Set();
  for (const key of state.geoCross) {
    const [e1, e2] = key.split("|").map(Number);
    const c1 = c.edgeChain.get(e1), c2 = c.edgeChain.get(e2);
    if (c1 != null && c2 != null && c1 !== c2) geoCross.add(c1 < c2 ? `${c1}|${c2}` : `${c2}|${c1}`);
  }
  const walkTo = new Map();
  for (const [a, b] of net.transfers) {
    walkTo.set(a, [...(walkTo.get(a) || []), b]);
    walkTo.set(b, [...(walkTo.get(b) || []), a]);
  }
  Object.assign(state, { stretches: c, chainCross: geoCross, geo: G, walkTo, pinPos: G.map((p) => ({ ...p })) });
  derive(state, 0);
}

const sharePin = (a, b) => a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;

export function solveStretches(state, t, passes) {
  const { net, stretches } = state;
  const U = net.unit;
  if (state.t !== t) {
    state.t = t;
    state.step = U * 0.5;
    state.pass = 0;
    state.converged = false;
    if (t === 0) {
      state.pinPos = net.stations.map((s) => ({ ...s.geo }));
      state.converged = true;
      derive(state, 0);
      return true;
    }
  }
  if (state.converged) return true;
  const s = state.style.weights;
  for (let p = 0; p < passes; p++) {
    const ramp = Math.min(1, state.pass / RAMP_PASSES);
    state.pass++;
    const w = {
      geo: 3 * (1 - t) ** 2,
      angle: (s.angle || 0) * t * ramp,
      diagonal: (s.diagonal || 0) * t * ramp,
      length: (s.length || 0) * t,
      bend: (s.bend || 0) * t,
      relative: (s.relative || 0) * t,
      clearance: 6 * t,
    };
    let moved = 0;
    for (const i of stretches.pins) {
      const here = state.pinPos[i];
      let best = here, bestEnergy = pinEnergy(state, i, w);
      // Never add a crossing; moves that remove one are welcome.
      const now = crossings(state, i);
      for (const [dx, dy] of DIRS) {
        const candidate = { x: here.x + dx * state.step, y: here.y + dy * state.step };
        state.pinPos[i] = candidate;
        const after = crossings(state, i);
        if (after < now) bestEnergy = Infinity;
        if (after <= now) {
          const e = pinEnergy(state, i, w);
          if (e < bestEnergy - 1e-4) { best = candidate; bestEnergy = e; }
        }
        state.pinPos[i] = here;
      }
      if (best !== here) { state.pinPos[i] = best; moved++; }
    }
    if (moved <= stretches.pins.length * 0.02 && ramp === 1) {
      state.step /= 2;
      if (state.step < U * 0.01) { state.converged = true; break; }
    }
  }
  if (state.converged) untangle(state);
  derive(state, t);
  return state.converged;
}

function pinEnergy(state, i, w) {
  const { net, stretches, pinPos: P } = state;
  const U = net.unit;
  const G = state.geo;
  const p = P[i];
  let e = w.geo * (dist(p, G[i]) / U) ** 2;
  for (const ci of stretches.pinChains.get(i)) {
    const c = stretches.chains[ci];
    const a = P[c.a], b = P[c.b];
    const len = dist(a, b);
    const theta = Math.atan2(b.y - a.y, b.x - a.x);
    // Room per stop, plus a fixed allowance so short stretches between
    // central interchanges still get space, as on the hand-drawn map.
    e += w.length * Math.log(Math.max(len, 1e-6) / ((0.9 * c.k + 1.5) * U)) ** 2;
    e += w.angle * octDeviation(theta) ** 2;
    e += w.diagonal * Math.sin(2 * theta) ** 2;
    // Keep each stretch heading roughly the way it really goes.
    const real = Math.atan2(G[c.b].y - G[c.a].y, G[c.b].x - G[c.a].x);
    const off = angleBetween(theta, real);
    if (off > (3 * Math.PI) / 8) e += w.relative * ((off - (3 * Math.PI) / 8) / (Math.PI / 4)) ** 2;
  }
  for (const [c1, s, c2] of stretches.pinJoints.get(i)) {
    const before = other(stretches.chains[c1], s), after = other(stretches.chains[c2], s);
    e += w.bend * (turn(P[before], P[s], P[after]) / Math.PI) ** 2;
  }
  // Stations joined by a walkway stay side by side.
  for (const j of state.walkTo.get(i) || []) {
    const d = dist(p, P[j]) / U;
    if (d > 2) e += w.clearance * (d - 2) ** 2;
  }
  // Room: pins apart, and stretches clear of pins they don't touch.
  const minPin = 1.2 * U, minLine = 0.5 * U;
  for (const j of stretches.pins) {
    if (j === i || state.walkTo.get(i)?.includes(j)) continue;
    const d = dist(p, P[j]);
    if (d < minPin) e += w.clearance * (1 - d / minPin) ** 2;
  }
  stretches.chains.forEach((c) => {
    if (c.a === i || c.b === i) {
      for (const j of stretches.pins) {
        if (j === c.a || j === c.b) continue;
        const d = pointSegment(P[j], P[c.a], P[c.b]);
        if (d < minLine) e += w.clearance * (1 - d / minLine) ** 2;
      }
    } else {
      const d = pointSegment(p, P[c.a], P[c.b]);
      if (d < minLine) e += w.clearance * (1 - d / minLine) ** 2;
    }
  });
  return e;
}

/// Crossings the real network doesn't have, on the stretches at pin i.
function crossings(state, i) {
  const { stretches, pinPos: P, chainCross } = state;
  let count = 0;
  for (const ci of stretches.pinChains.get(i)) {
    const c = stretches.chains[ci];
    for (let cj = 0; cj < stretches.chains.length; cj++) {
      if (cj === ci) continue;
      const d = stretches.chains[cj];
      if (sharePin(c, d)) continue;
      if (chainCross.has(ci < cj ? `${ci}|${cj}` : `${cj}|${ci}`)) continue;
      // As drawn: with the bend a stretch gets when it can't be straight.
      const p = drawnStretch(P, c), q = drawnStretch(P, d);
      for (let x = 0; x + 1 < p.length; x++) {
        for (let y = 0; y + 1 < q.length; y++) if (segmentsCross(p[x], p[x + 1], q[y], q[y + 1])) count++;
      }
    }
  }
  return count;
}

function drawnStretch(P, c) {
  const bend = bendOf(P[c.a], P[c.b], c.flip);
  return bend ? [P[c.a], bend, P[c.b]] : [P[c.a], P[c.b]];
}

/// The bend of a stretch that can't be straight: the usual one (longer leg
/// first), or with `flip` the other way round the same corner.
function bendOf(a, b, flip) {
  const usual = dogleg(a, b, 45, null);
  if (!usual || !flip) return usual;
  // The other corner of the same parallelogram.
  return { x: a.x + b.x - usual.x, y: a.y + b.y - usual.y };
}

/// After settling: flip any stretch's bend that removes crossings, the way
/// a hand-drawn map bends the other way round a neighbouring line.
function untangle(state) {
  const { stretches, pinPos: P, chainCross } = state;
  const chains = stretches.chains;
  const crossingsOf = (ci) => {
    const c = chains[ci], p = drawnStretch(P, c);
    let count = 0;
    chains.forEach((d, cj) => {
      if (cj === ci || sharePin(c, d) || chainCross.has(ci < cj ? `${ci}|${cj}` : `${cj}|${ci}`)) return;
      const q = drawnStretch(P, d);
      for (let x = 0; x + 1 < p.length; x++) {
        for (let y = 0; y + 1 < q.length; y++) if (segmentsCross(p[x], p[x + 1], q[y], q[y + 1])) count++;
      }
    });
    return count;
  };
  for (let round = 0; round < 4; round++) {
    let improved = false;
    chains.forEach((c, ci) => {
      if (!dogleg(P[c.a], P[c.b], 45, null)) return;
      const before = crossingsOf(ci);
      if (!before) return;
      c.flip = !c.flip;
      if (crossingsOf(ci) < before) improved = true;
      else c.flip = !c.flip;
    });
    if (!improved) break;
  }
}

/// Station positions and each edge's drawn piece, from the pins: every
/// stretch is drawn a → (bend) → b, with its stations evenly along it.
function derive(state, t) {
  const { net, stretches, pinPos: P } = state;
  const G = net.stations.map((s) => s.geo);
  const shape = smoothstep((t - 0.5) / 0.5);
  const positions = G.map((g, i) => (stretches.isPin[i] ? { ...P[i] } : { ...g }));
  const pieces = new Map();
  for (const c of stretches.chains) {
    const a = P[c.a], b = P[c.b];
    const bend = bendOf(a, b, c.flip);
    const poly = bend && shape > 0 ? [a, lerp(lerp(a, b, 0.5), bend, shape), b] : [a, b];
    const along = [0];
    for (let i = 1; i < poly.length; i++) along.push(along[i - 1] + dist(poly[i - 1], poly[i]));
    const total = along[along.length - 1];
    const at = (s) => {
      for (let i = 1; i < poly.length; i++) {
        if (along[i] >= s - 1e-9) return lerp(poly[i - 1], poly[i], (s - along[i - 1]) / (along[i] - along[i - 1] || 1));
      }
      return poly[poly.length - 1];
    };
    // Stations: evenly along the stretch, eased in from their real places.
    c.stations.forEach((s, j) => {
      if (j === 0 || j === c.k) return;
      positions[s] = lerp(G[s], at((total * j) / c.k), Math.min(1, t * 1.5));
    });
    // Each edge: straight, or through the bend when it falls between them.
    for (let j = 0; j < c.k; j++) {
      const u = c.stations[j], v = c.stations[j + 1];
      const s0 = (total * j) / c.k, s1 = (total * (j + 1)) / c.k;
      const piece = [positions[u]];
      if (poly.length === 3 && along[1] > s0 + 1e-9 && along[1] < s1 - 1e-9) piece.push(poly[1]);
      piece.push(positions[v]);
      pieces.set(`${u}|${v}`, piece);
      pieces.set(`${v}|${u}`, [...piece].reverse());
    }
  }
  state.positions = positions;
  state.pieces = pieces;
}

const other = (c, s) => (c.a === s ? c.b : c.a);

function octDeviation(theta) {
  const s = Math.PI / 4;
  const r = ((theta % s) + s) % s;
  return Math.min(r, s - r) / (s / 2);
}

function angleBetween(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

function turn(u, v, w) {
  return angleBetween(Math.atan2(v.y - u.y, v.x - u.x), Math.atan2(w.y - v.y, w.x - v.x));
}

const smoothstep = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
