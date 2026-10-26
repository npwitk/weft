// What each line looks like at slider position t, in layout units: the
// real track bent to follow the moved stations (straightening as t grows),
// then shaped by the style: one allowed-angle bend per edge, smooth curves,
// or circles. `stationVertex[k]` is where the line's k-th stop sits in
// `points`, which the export needs for offsets.

import { dist } from "./network.js";

/// Also sets `state.drawn`: station positions as drawn (they can slide
/// along their line, see `evenOut`), for the renderer, scores and export.
export function linePaths(state, t) {
  const { net, style } = state;
  state.drawn = state.positions;
  if (style.drawing === "reference") return referencePaths(net);
  // Past halfway the style takes over from the (straightened) track.
  const shape = smoothstep((t - 0.5) / 0.5);
  const paths = shapedPaths(state, t, shape);
  return style.evenSpacing && shape > 0 ? evenOut(state, paths, shape) : paths;
}

/// Pinwake's rule: interchanges and termini are pinned, and the stations
/// between two pins sit evenly along the line between them. Each station
/// slides along its own drawn line (by `shape`), so it never leaves it.
function evenOut(state, paths, shape) {
  const { net } = state;
  const linked = new Set(net.transfers.flat());
  const pinned = (s) => net.stations[s].lines.length > 1 || linked.has(s);
  const drawn = state.positions.map((p) => ({ ...p }));
  const out = paths.map(({ line, points, stationVertex }) => {
    const along = [0];
    for (let i = 1; i < points.length; i++) along.push(along[i - 1] + dist(points[i - 1], points[i]));
    const stops = line.stops;
    // A station listed twice (a loop closing) is pinned too.
    const pins = stops.map((s, k) => k === 0 || k === stops.length - 1 || pinned(s)
      || stops.indexOf(s) !== stops.lastIndexOf(s));
    const target = stationVertex.map((v) => along[v]);
    let k0 = 0;
    for (let k = 1; k < stops.length; k++) {
      if (!pins[k]) continue;
      for (let j = k0 + 1; j < k; j++) {
        const even = target[k0] + ((target[k] - target[k0]) * (j - k0)) / (k - k0);
        target[j] = target[j] + (even - target[j]) * shape;
      }
      k0 = k;
    }
    // Put each moved station on the polyline as its own vertex.
    const extra = [];
    stops.forEach((s, k) => {
      if (pins[k] || target[k] === along[stationVertex[k]]) return;
      extra.push({ at: target[k], point: pointAt(points, along, target[k]), k });
    });
    if (!extra.length) return { line, points, stationVertex };
    const merged = points.map((p, i) => ({ at: along[i], point: p, vertex: i }));
    for (const e of extra) merged.push({ at: e.at, point: e.point, k: e.k });
    merged.sort((a, b) => a.at - b.at || (a.k != null) - (b.k != null));
    // Drop old station vertices that were only there for a moved station,
    // where the line runs straight through them.
    const keep = merged.filter((m, i) => {
      if (m.vertex == null) return true;
      const k = stationVertex.indexOf(m.vertex);
      if (k < 0 || pins[k] || !extra.some((e) => e.k === k)) return true;
      const prev = merged[i - 1], next = merged[i + 1];
      return !(prev && next && collinear(prev.point, m.point, next.point));
    });
    const newVertex = stationVertex.map((v, k) => {
      const moved = extra.find((e) => e.k === k);
      return moved ? keep.findIndex((m) => m.k === k) : keep.findIndex((m) => m.vertex === v);
    });
    for (const e of extra) drawn[stops[e.k]] = e.point;
    return { line, points: keep.map((m) => m.point), stationVertex: newVertex };
  });
  state.drawn = drawn;
  return out;
}

function pointAt(points, along, s) {
  for (let i = 1; i < points.length; i++) {
    if (along[i] >= s) {
      const span = along[i] - along[i - 1] || 1;
      return lerp(points[i - 1], points[i], (s - along[i - 1]) / span);
    }
  }
  return points[points.length - 1];
}

function collinear(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-6 * (1 + dist(a, c) ** 2);
}

function shapedPaths(state, t, shape) {
  const { net, style } = state;
  const P = state.positions;
  const U = net.unit;
  return net.lines.map((line) => {
    const points = [];
    const stationVertex = [];
    let incoming = null;
    for (let k = 0; k < line.stops.length; k++) {
      const a = line.stops[k];
      if (k === 0) { points.push(P[a]); stationVertex.push(0); continue; }
      const prev = line.stops[k - 1];
      let piece = trackPiece(net, line, k - 1, P[prev], P[a], t * U * 1.5);
      if (shape > 0 && style.drawing === "dogleg") {
        const bend = dogleg(P[prev], P[a], style.step, incoming);
        if (bend) {
          const mid = { x: (P[prev].x + P[a].x) / 2, y: (P[prev].y + P[a].y) / 2 };
          piece = [P[prev], lerp(mid, bend, shape), P[a]];
        } else {
          piece = [P[prev], P[a]];
        }
      } else if (shape > 0 && style.drawing === "arc") {
        piece = arcPiece(P[prev], P[a], state.centre, shape);
      }
      const n = piece.length;
      if (n >= 2) incoming = direction(piece[n - 2], piece[n - 1]);
      points.push(...piece.slice(1));
      stationVertex.push(points.length - 1);
    }
    const drawn = style.drawing === "spline" && shape > 0
      ? spline(points, stationVertex, shape)
      : { points, stationVertex };
    return { line, ...drawn };
  });
}

/// Pinwake's own drawn paths, with each stop found on them.
function referencePaths(net) {
  return net.lines.map((line) => {
    const points = line.refPath;
    const stationVertex = line.stops.map((s) => {
      const ref = net.stations[s].ref;
      let best = 0;
      points.forEach((p, i) => { if (dist(p, ref) < dist(points[best], ref)) best = i; });
      return best;
    });
    return { line, points, stationVertex };
  });
}

/// The real track between stops k and k+1, moved so its ends sit on the
/// stations' current positions, then simplified (Douglas–Peucker).
function trackPiece(net, line, k, a, b, tolerance) {
  const offsets = line.trackOffsets;
  if (!line.track.length || offsets.length !== line.stops.length) return [a, b];
  const from = offsets[k], to = offsets[k + 1];
  const slice = sliceTrack(line.track, Math.min(from, to), Math.max(from, to));
  if (from > to) slice.reverse();
  if (slice.length < 2) return [a, b];
  const ga = slice[0], gb = slice[slice.length - 1];
  const moved = slice.map((p) => similarity(p, ga, gb, a, b));
  moved[0] = a; moved[moved.length - 1] = b;
  return simplify(moved, tolerance);
}

function sliceTrack(track, from, to) {
  const out = [];
  let run = 0;
  for (let i = 0; i + 1 < track.length; i++) {
    const len = dist(track[i], track[i + 1]);
    const s0 = run, s1 = run + len;
    if (s1 >= from && s0 <= to) {
      if (!out.length) out.push(lerp(track[i], track[i + 1], len ? (from - s0) / len : 0));
      if (s1 <= to) out.push(track[i + 1]);
      else { out.push(lerp(track[i], track[i + 1], len ? (to - s0) / len : 0)); break; }
    }
    run = s1;
  }
  return out;
}

/// The map taking p0 → q0 and p1 → q1 (scale, rotation, shift), applied to p.
function similarity(p, p0, p1, q0, q1) {
  const vx = p1.x - p0.x, vy = p1.y - p0.y;
  const wx = q1.x - q0.x, wy = q1.y - q0.y;
  const d = vx * vx + vy * vy || 1e-9;
  const c = (vx * wx + vy * wy) / d, s = (vx * wy - vy * wx) / d;
  const x = p.x - p0.x, y = p.y - p0.y;
  return { x: q0.x + c * x - s * y, y: q0.y + s * x + c * y };
}

export function simplify(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let worst = -1, far = 0;
    for (let k = i + 1; k < j; k++) {
      const d = lineDistance(points[k], points[i], points[j]);
      if (d > far) { far = d; worst = k; }
    }
    if (far > tolerance) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
  }
  return points.filter((_, k) => keep[k]);
}

function lineDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/// One bend on allowed directions from a to b, or null if a–b is already
/// on one. The leg matching the incoming direction goes first, so a line
/// carries straight on through the station; else the longer leg.
export function dogleg(a, b, stepDegrees, incoming) {
  const s = (stepDegrees * Math.PI) / 180;
  const theta = Math.atan2(b.y - a.y, b.x - a.x);
  const lower = Math.floor(theta / s) * s;
  if (Math.abs(theta - lower) < 0.01 || Math.abs(lower + s - theta) < 0.01) return null;
  const u1 = { x: Math.cos(lower), y: Math.sin(lower) };
  const u2 = { x: Math.cos(lower + s), y: Math.sin(lower + s) };
  // b − a = α·u1 + β·u2
  const vx = b.x - a.x, vy = b.y - a.y;
  const det = u1.x * u2.y - u1.y * u2.x;
  const alpha = (vx * u2.y - vy * u2.x) / det;
  const beta = (u1.x * vy - u1.y * vx) / det;
  const viaU1 = { x: a.x + alpha * u1.x, y: a.y + alpha * u1.y };
  const viaU2 = { x: a.x + beta * u2.x, y: a.y + beta * u2.y };
  if (incoming) {
    if (incoming.x * u1.x + incoming.y * u1.y > 0.999) return viaU1;
    if (incoming.x * u2.x + incoming.y * u2.y > 0.999) return viaU2;
  }
  return alpha >= beta ? viaU1 : viaU2;
}

/// a to b around the centre (radius and angle eased), blended with the
/// straight line by `shape`.
function arcPiece(a, b, c, shape) {
  const ra = dist(a, c), rb = dist(b, c);
  const ta = Math.atan2(a.y - c.y, a.x - c.x);
  let tb = Math.atan2(b.y - c.y, b.x - c.x);
  if (tb - ta > Math.PI) tb -= 2 * Math.PI;
  if (ta - tb > Math.PI) tb += 2 * Math.PI;
  // Mostly along the circle: draw an arc; mostly outwards: straight.
  const along = Math.abs(tb - ta) * (ra + rb) / 2;
  if (along < Math.abs(rb - ra)) return [a, b];
  const steps = 8, out = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const r = ra + (rb - ra) * f, th = ta + (tb - ta) * f;
    const onArc = { x: c.x + r * Math.cos(th), y: c.y + r * Math.sin(th) };
    out.push(lerp(lerp(a, b, f), onArc, shape));
  }
  out[0] = a; out[steps] = b;
  return out;
}

/// Catmull–Rom through the points, `shape` scaling the tangents (0 keeps the
/// straight lines). Sampled into short segments.
function spline(points, stationVertex, shape) {
  const out = [points[0]];
  const map = new Map([[0, 0]]);
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const m1 = { x: (p2.x - p0.x) * 0.5 * shape, y: (p2.y - p0.y) * 0.5 * shape };
    const m2 = { x: (p3.x - p1.x) * 0.5 * shape, y: (p3.y - p1.y) * 0.5 * shape };
    const steps = 6;
    for (let k = 1; k <= steps; k++) {
      const s = k / steps, s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      out.push({
        x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
        y: h00 * p1.y + h10 * m1.y + h01 * p2.y + h11 * m2.y,
      });
    }
    map.set(i + 1, out.length - 1);
  }
  return { points: out, stationVertex: stationVertex.map((v) => map.get(v)) };
}

function direction(a, b) {
  const len = dist(a, b) || 1e-9;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

export const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
const smoothstep = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
