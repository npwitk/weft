// Scores for a drawn layout. Lower is better for all of them. Layouts come
// in different sizes, so distances are compared after scaling each layout
// onto the target (Procrustes with scale and shift, no rotation: north
// stays up) and are given in typical station gaps.

import { dist, segmentsCross } from "./network.js";

export const METRICS = [
  { id: "angle", name: "Angle error", unit: "°", scale: 22.5, help: "How far drawn lines stray from the style's allowed directions" },
  { id: "turning", name: "Turning", unit: "°/line", scale: 360, help: "Total turning along each line; straighter lines are easier to follow" },
  { id: "spread", name: "Uneven spacing", unit: "", scale: 1, help: "Spread of station-to-station distances (coefficient of variation)" },
  { id: "crossings", name: "New crossings", unit: "", scale: 3, help: "Lines crossing where they don't in reality" },
  { id: "crowding", name: "Crowding", unit: "", scale: 10, help: "Pairs of stations closer than 40% of a typical gap" },
  { id: "geo", name: "Off the real map", unit: "gaps", scale: 3, help: "Mean distance from each station's real position" },
  { id: "hand", name: "Off hand-traced", unit: "gaps", scale: 3, help: "Mean distance from Pinwake's hand-traced position", info: true },
];

export const DEFAULT_WEIGHTS = { angle: 1, turning: 1, spread: 1, crossings: 2, crowding: 1, geo: 0.5, hand: 0 };

export function measure(state, paths) {
  const { net, style } = state;
  const P = style.drawing === "reference" ? net.stations.map((s) => s.ref) : (state.drawn || state.positions);
  const out = {};

  // Angle error, length-weighted over drawn segments.
  const step = style.step ?? (style.drawing === "reference" ? 45 : null);
  if (step) {
    let total = 0, length = 0;
    for (const { points } of paths) {
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i], b = points[i + 1];
        const len = dist(a, b);
        if (len < 1e-6) continue;
        total += deviationDegrees(a, b, step, state.centre) * len;
        length += len;
      }
    }
    out.angle = length ? total / length : 0;
  } else {
    out.angle = null;
  }

  // Turning per line.
  let turning = 0;
  for (const { points } of paths) {
    for (let i = 1; i + 1 < points.length; i++) {
      const a1 = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
      const a2 = Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x);
      let d = Math.abs(a2 - a1) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (dist(points[i - 1], points[i]) > 1e-6 && dist(points[i], points[i + 1]) > 1e-6) turning += d;
    }
  }
  out.turning = (turning * 180) / Math.PI / paths.length;

  // Spacing: drawn length between consecutive stops.
  const gaps = [];
  for (const { points, stationVertex } of paths) {
    for (let k = 1; k < stationVertex.length; k++) {
      let len = 0;
      for (let i = stationVertex[k - 1]; i < stationVertex[k]; i++) len += dist(points[i], points[i + 1]);
      if (len > 1e-6) gaps.push(len);
    }
  }
  const meanGap = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - meanGap) ** 2, 0) / (gaps.length || 1));
  out.spread = meanGap ? sd / meanGap : 0;
  const ownUnit = median(gaps) || 1;

  // Crossings between station-to-station edges that the real map lacks.
  let crossings = 0;
  const E = net.edges;
  for (let i = 0; i < E.length; i++) {
    for (let j = i + 1; j < E.length; j++) {
      const e = E[i], f = E[j];
      if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
      if (state.geoCross.has(`${i}|${j}`)) continue;
      if (segmentsCross(P[e.a], P[e.b], P[f.a], P[f.b])) crossings++;
    }
  }
  out.crossings = crossings;

  let crowding = 0;
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) if (dist(P[i], P[j]) < 0.4 * ownUnit) crowding++;
  }
  out.crowding = crowding;

  out.geo = alignedDistance(P, net.stations.map((s) => s.geo)) / net.unit;
  const refs = net.stations.map((s) => s.ref);
  out.hand = refs.every(Boolean) ? alignedDistance(P, refs) / refUnit(net) : null;
  return out;
}

/// One number to rank styles: the weighted, scaled metrics.
export function total(scores, weights) {
  let sum = 0;
  for (const m of METRICS) {
    const v = scores[m.id];
    if (v == null || !weights[m.id]) continue;
    sum += weights[m.id] * Math.min(3, v / m.scale);
  }
  return sum;
}

function deviationDegrees(a, b, step, centre) {
  let theta = Math.atan2(b.y - a.y, b.x - a.x);
  let s = step === "orthoradial" ? 90 : step;
  if (step === "orthoradial") {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    theta -= Math.atan2(m.y - centre.y, m.x - centre.x);
  }
  const deg = (theta * 180) / Math.PI;
  const r = ((deg % s) + s) % s;
  return Math.min(r, s - r);
}

/// Mean distance from `points` to `target` after the best uniform scale
/// and shift of `points`, in target units.
export function alignedDistance(points, target) {
  const n = points.length;
  const pc = centroid(points), tc = centroid(target);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = points[i].x - pc.x, py = points[i].y - pc.y;
    num += px * (target[i].x - tc.x) + py * (target[i].y - tc.y);
    den += px * px + py * py;
  }
  const s = den ? num / den : 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.hypot(tc.x + s * (points[i].x - pc.x) - target[i].x, tc.y + s * (points[i].y - pc.y) - target[i].y);
  }
  return sum / n;
}

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

function refUnit(net) {
  return median(net.edges.map((e) => dist(net.stations[e.a].ref, net.stations[e.b].ref))) || 1;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
