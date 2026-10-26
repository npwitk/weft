// The optimiser shared by every style: multi-criteria hill climbing on
// station positions (after Stott & Rodgers). Each pass tries moving every
// station a step in eight directions and keeps a move when it lowers that
// station's share of the energy. Steps halve when nothing improves.
//
// Energy terms (all in units of the network's typical station gap U):
// - geo:       distance from the real position; weight (1 − t)², so t = 0
//              is the real map
// - angle:     how far each edge is from the style's allowed directions
// - length:    log of each edge's length over U (even spacing)
// - bend:      turns along a line (straight lines read best; for the curvy
//              style this is what keeps curves gentle)
// - diagonal:  diagonals cost more than level or upright runs
// - clearance: stations too close to each other or to another line
// Moves that create a crossing the real network doesn't have are refused.

import { dist, mean, segmentsCross, pointSegment } from "./network.js";
import { createStretches, solveStretches } from "./stretches.js";

/// Passes over which the angle rule fades in after the slider moves.
const ANGLE_RAMP_PASSES = 40;

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

export function createLayout(net, style) {
  const n = net.stations.length;
  // Bend triples (u, v, w): consecutive stops on a line, once each.
  const triples = new Map();
  for (const line of net.lines) {
    for (let k = 1; k + 1 < line.stops.length; k++) {
      const [u, v, w] = [line.stops[k - 1], line.stops[k], line.stops[k + 1]];
      if (u === v || v === w || u === w) continue;
      const key = u < w ? `${u}|${v}|${w}` : `${w}|${v}|${u}`;
      if (!triples.has(key)) triples.set(key, [u, v, w]);
    }
  }
  const bendsTouching = Array.from({ length: n }, () => []);
  for (const t of triples.values()) for (const s of new Set(t)) bendsTouching[s].push(t);

  // Crossings the real network already has stay allowed.
  const geoCross = new Set();
  const { edges, stations } = net;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (sharesEnd(edges[i], edges[j])) continue;
      if (segmentsCross(stations[edges[i].a].geo, stations[edges[i].b].geo,
                        stations[edges[j].a].geo, stations[edges[j].b].geo)) {
        geoCross.add(`${i}|${j}`);
      }
    }
  }
  const centre = {
    x: mean(stations.map((s) => s.geo.x)),
    y: mean(stations.map((s) => s.geo.y)),
  };
  // A fixed style (Pinwake's hand-traced map) never moves.
  const fixed = Boolean(style.fixed);
  const state = {
    net, style, centre, geoCross,
    triples: [...triples.values()], bendsTouching,
    positions: stations.map((s) => ({ ...(fixed ? s.ref : s.geo) })),
    t: null, step: 0, converged: fixed,
  };
  // Styles laid out by stretch move only interchanges (stretches.js).
  if (style.solver === "stretches") createStretches(state);
  return state;
}

const sharesEnd = (e, f) => e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b;

/// Runs up to `passes` passes towards slider position `t`. Returns true once
/// settled. Warm-starts from the current positions, so a slider drag moves
/// the map smoothly instead of starting over.
export function solve(state, t, passes = 1) {
  const { net } = state;
  const U = net.unit;
  if (state.style.fixed) return true;
  if (state.stretches) return solveStretches(state, t, passes);
  if (state.t !== t) {
    state.t = t;
    state.step = U * 0.35;
    state.pass = 0;
    state.converged = false;
    if (t === 0) {
      state.positions = net.stations.map((s) => ({ ...s.geo }));
      state.converged = true;
    }
  }
  if (state.converged) return true;
  const n = state.positions.length;
  for (let p = 0; p < passes; p++) {
    // Smooth first, then bring the angle rule in: neighbouring edges are
    // already heading the same way, so they snap together into straight
    // runs instead of zigzagging one by one. Steps can't shrink to the end
    // before the ramp is done.
    const ramp = Math.min(1, state.pass / ANGLE_RAMP_PASSES);
    const w = weights(state.style, t);
    w.angle *= ramp;
    state.pass++;
    // Rebuilt every pass; a cell of U covers a move plus the clearance.
    state.grid = buildGrid(state);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const here = state.positions[i];
      let best = here, bestEnergy = localEnergy(state, i, w);
      for (const [dx, dy] of DIRS) {
        const candidate = { x: here.x + dx * state.step, y: here.y + dy * state.step };
        state.positions[i] = candidate;
        if (!createsCrossing(state, i)) {
          const e = localEnergy(state, i, w);
          // Only clear gains count, so the search settles.
          if (e < bestEnergy - 1e-4) { best = candidate; bestEnergy = e; }
        }
        state.positions[i] = here;
      }
      if (best !== here) { state.positions[i] = best; moved++; }
    }
    if (moved <= n * 0.02 && ramp === 1) {
      state.step /= 2;
      if (state.step < U * 0.01) { state.converged = true; return true; }
    }
  }
  return false;
}

/// Uniform grid over stations and edges (by bounding box), cell size U.
function buildGrid(state) {
  const { net, positions } = state;
  const size = net.unit;
  const stations = new Map(), edges = new Map();
  const key = (cx, cy) => cx * 100_003 + cy;
  const put = (map, k, v) => { const list = map.get(k); if (list) list.push(v); else map.set(k, [v]); };
  positions.forEach((p, i) => put(stations, key(Math.floor(p.x / size), Math.floor(p.y / size)), i));
  net.edges.forEach((e, ei) => {
    const a = positions[e.a], b = positions[e.b];
    for (let cx = Math.floor(Math.min(a.x, b.x) / size); cx <= Math.floor(Math.max(a.x, b.x) / size); cx++) {
      for (let cy = Math.floor(Math.min(a.y, b.y) / size); cy <= Math.floor(Math.max(a.y, b.y) / size); cy++) {
        put(edges, key(cx, cy), ei);
      }
    }
  });
  return { size, key, stations, edges, stamp: new Uint32Array(Math.max(net.edges.length, positions.length)), tick: 0 };
}

/// Items of `map` in cells within one cell of the box around the points.
function nearby(grid, map, points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const out = [];
  grid.tick++;
  for (let cx = Math.floor(minX / grid.size) - 1; cx <= Math.floor(maxX / grid.size) + 1; cx++) {
    for (let cy = Math.floor(minY / grid.size) - 1; cy <= Math.floor(maxY / grid.size) + 1; cy++) {
      for (const v of map.get(grid.key(cx, cy)) || []) {
        if (grid.stamp[v] !== grid.tick) { grid.stamp[v] = grid.tick; out.push(v); }
      }
    }
  }
  return out;
}

/// Runs to the end (for tests and export).
export function settle(state, t, maxPasses = 400) {
  for (let i = 0; i < maxPasses && !solve(state, t, 1); i++);
  return state;
}

export function weights(style, t) {
  const s = style.weights || {};
  return {
    geo: 3 * (1 - t) ** 2,
    angle: (s.angle || 0) * t,
    length: (s.length || 0) * t,
    bend: (s.bend || 0) * t,
    diagonal: (s.diagonal || 0) * t,
    clearance: 6 * t,
  };
}

function localEnergy(state, i, w) {
  const { net, positions } = state;
  const U = net.unit;
  const p = positions[i];
  let e = 0;
  if (w.geo) {
    const d = dist(p, net.stations[i].geo) / U;
    e += w.geo * d * d;
  }
  for (const ei of net.neighbours[i]) {
    const edge = net.edges[ei];
    const a = positions[edge.a], b = positions[edge.b];
    const len = dist(a, b);
    if (w.length) e += w.length * Math.log(Math.max(len, 1e-6) / U) ** 2;
    if (w.angle) e += w.angle * angleDeviation(state, a, b) ** 2;
    // Level and upright runs over diagonals: 0 at 0°/90°, 1 at 45°.
    if (w.diagonal) e += w.diagonal * Math.sin(2 * Math.atan2(b.y - a.y, b.x - a.x)) ** 2;
  }
  if (w.bend) {
    for (const [u, v, x] of state.bendsTouching[i]) {
      e += w.bend * (turn(positions[u], positions[v], positions[x]) / Math.PI) ** 2;
    }
  }
  if (w.clearance) {
    const grid = state.grid;
    const minStation = 0.55 * U, minEdge = 0.3 * U;
    for (const j of nearby(grid, grid.stations, [p])) {
      if (j === i) continue;
      const d = dist(p, positions[j]);
      if (d < minStation) e += w.clearance * (1 - d / minStation) ** 2;
    }
    for (const ei of nearby(grid, grid.edges, [p])) {
      const edge = net.edges[ei];
      if (edge.a === i || edge.b === i) continue;
      const d = pointSegment(p, positions[edge.a], positions[edge.b]);
      if (d < minEdge) e += w.clearance * (1 - d / minEdge) ** 2;
    }
    // This station's own edges passing too close to other stations.
    for (const ei of net.neighbours[i]) {
      const edge = net.edges[ei];
      for (const j of nearby(grid, grid.stations, [positions[edge.a], positions[edge.b]])) {
        if (j === edge.a || j === edge.b) continue;
        const d = pointSegment(positions[j], positions[edge.a], positions[edge.b]);
        if (d < minEdge) e += w.clearance * (1 - d / minEdge) ** 2;
      }
    }
  }
  return e;
}

function createsCrossing(state, i) {
  const { net, positions, geoCross, grid } = state;
  for (const ei of net.neighbours[i]) {
    const e = net.edges[ei];
    for (const fi of nearby(grid, grid.edges, [positions[e.a], positions[e.b]])) {
      if (fi === ei) continue;
      const f = net.edges[fi];
      if (sharesEnd(e, f)) continue;
      const key = ei < fi ? `${ei}|${fi}` : `${fi}|${ei}`;
      if (geoCross.has(key)) continue;
      if (segmentsCross(positions[e.a], positions[e.b], positions[f.a], positions[f.b])) return true;
    }
  }
  return false;
}

/// Turning angle at v going u → v → w, 0 (straight) to π (reversing).
export function turn(u, v, w) {
  const a1 = Math.atan2(v.y - u.y, v.x - u.x);
  const a2 = Math.atan2(w.y - v.y, w.x - v.x);
  let d = Math.abs(a2 - a1) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/// How far edge a–b is from the style's nearest allowed direction, as a
/// fraction of the worst case (0 on an allowed direction, 1 halfway between).
export function angleDeviation(state, a, b) {
  const step = state.style.step;
  if (!step) return 0;
  let theta = Math.atan2(b.y - a.y, b.x - a.x);
  let s = (step === "orthoradial" ? 90 : step) * Math.PI / 180;
  if (step === "orthoradial") {
    // Along or across the circle around the centre at the edge's midpoint.
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    theta -= Math.atan2(m.y - state.centre.y, m.x - state.centre.x);
  }
  const r = ((theta % s) + s) % s;
  return Math.min(r, s - r) / (s / 2);
}
