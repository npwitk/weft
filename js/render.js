// Draws a layout in Pinwake's look: lines sharing track run side by side in
// lanes, bends are rounded, an interchange is one white pill holding a dot
// per line, ordinary stations are small white dots with a thin outline.
//
// `paint` only uses a small part of the canvas 2D API (paths, arcs,
// quadratic curves, text), so the same code draws to a <canvas> on the page
// and, through svgcontext.js, to the README's SVG images.

import { bounds } from "./network.js";

export const LIGHT = { ink: "#1d1d1f", muted: "#8a8a8e", stationFill: "#ffffff", background: "#ffffff" };

export function draw(canvas, state, paths, options = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  paint(ctx, W, H, state, paths, options);
}

/// `project`, when given, places layout points on screen (e.g. through an
/// Apple Map); otherwise the layout is fitted into W × H (offset by x, y).
export function paint(ctx, W, H, state, paths, { labels = false, theme = LIGHT, project = null, x = 0, y = 0, pad } = {}) {
  const { net } = state;
  const P = state.drawn || state.positions;

  let toScreen, scale;
  if (project) {
    toScreen = project;
    const a = project({ x: 0, y: 0 }), b = project({ x: 100, y: 0 });
    scale = Math.hypot(b.x - a.x, b.y - a.y) / 100;
  } else {
    const box = bounds([...P, ...paths.flatMap((p) => p.points)]);
    const margin = pad ?? (labels ? 40 : 14);
    scale = Math.min((W - 2 * margin) / (box.maxX - box.minX || 1), (H - 2 * margin) / (box.maxY - box.minY || 1));
    const ox = x + (W - (box.maxX - box.minX) * scale) / 2, oy = y + (H - (box.maxY - box.minY) * scale) / 2;
    toScreen = (p) => ({ x: ox + (p.x - box.minX) * scale, y: oy + (p.y - box.minY) * scale });
  }

  // Sizes follow how far apart stations are drawn, like Pinwake's zoom.
  const gap = typicalGap(paths) * scale;
  const width = Math.max(1.4, Math.min(7, gap * 0.17));
  const laneWidth = width * 1.4;
  const radius = width * 3;

  // Lanes: lines sharing an edge sit side by side across it.
  const lanes = new Map();
  for (const e of net.edges) {
    [...e.lines].sort().forEach((id, k, all) => lanes.set(`${e.a}|${e.b}|${id}`, k - (all.length - 1) / 2));
  }
  const laneOffset = (a, b, lineID) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const lane = lanes.get(`${lo}|${hi}|${lineID}`) || 0;
    const p = toScreen(P[lo]), q = toScreen(P[hi]);
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (-(q.y - p.y) / len) * lane * laneWidth, y: ((q.x - p.x) / len) * lane * laneWidth };
  };

  // Lines.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  for (const { line, points, stationVertex } of paths) {
    const screen = [];
    for (let k = 1; k < stationVertex.length; k++) {
      const off = laneOffset(line.stops[k - 1], line.stops[k], line.id);
      for (let i = stationVertex[k - 1]; i <= stationVertex[k]; i++) {
        const s = toScreen(points[i]);
        screen.push({ x: s.x + off.x, y: s.y + off.y });
      }
    }
    ctx.strokeStyle = line.color;
    ctx.beginPath();
    roundedPolyline(ctx, dedupe(screen), radius);
    ctx.stroke();
  }

  // Interchanges: stations where routes meet, split or end, joined with any
  // station linked by a walkway, drawn as one pill of line-coloured dots.
  // Walkway-linked stations share a pill only when drawn close together;
  // otherwise they keep their own and a dashed walkway joins them.
  const near = (a, b) => {
    const p = toScreen(P[a]), q = toScreen(P[b]);
    return Math.hypot(p.x - q.x, p.y - q.y) < laneWidth * 4;
  };
  const groups = interchangeGroups(net, near);
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = Math.max(1, width * 0.3);
  ctx.strokeStyle = theme.muted;
  for (const [a, b] of net.transfers) {
    if (near(a, b)) continue;
    const p = toScreen(P[a]), q = toScreen(P[b]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  const inGroup = new Set(groups.flat());
  const dotRadius = Math.max(1.6, laneWidth * 0.44);
  const outline = Math.max(0.7, width * 0.22);

  // Ordinary stations first, so pills sit on top. Like Pinwake, they only
  // show once there's room (zoomed in) and never closer than 16 pt apart,
  // so a zoomed-out map shows the lines' colour, not a row of dots.
  // A white dot inside the line (Pinwake: 6 pt in a line up to 8 pt).
  const minor = width * 0.36;
  const shown = [];
  for (const s of gap >= 14 && width >= 3.5 ? net.stations : []) {
    if (s.junction || inGroup.has(s.index)) continue;
    const p = toScreen(P[s.index]);
    if (shown.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 16)) continue;
    shown.push(p);
    ctx.beginPath();
    ctx.arc(p.x, p.y, minor, 0, 2 * Math.PI);
    ctx.fillStyle = theme.stationFill;
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, width * 0.1);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.stroke();
  }

  for (const group of groups) {
    const dots = groupDots(net, group, P, toScreen, laneOffset, laneWidth);
    if (!dots.length) continue;
    ctx.beginPath();
    capsule(ctx, dots.map((d) => d.point), dotRadius + Math.max(1.2, width * 0.35));
    ctx.fillStyle = theme.stationFill;
    ctx.fill();
    ctx.lineWidth = outline * 1.4;
    ctx.strokeStyle = "rgba(29, 29, 31, 0.75)";
    ctx.stroke();
    for (const dot of dots) {
      ctx.beginPath();
      ctx.arc(dot.point.x, dot.point.y, dotRadius, 0, 2 * Math.PI);
      ctx.fillStyle = dot.color;
      ctx.fill();
      ctx.lineWidth = outline * 0.8;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.stroke();
    }
  }

  if (labels) {
    ctx.font = `600 ${Math.max(9, Math.min(12, gap * 0.35))}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = "middle";
    for (const s of net.stations) {
      if (s.junction || !s.name) continue;
      const p = toScreen(P[s.index]);
      ctx.fillText(s.name, p.x + dotRadius * 2.6, p.y);
    }
  }
}

/// A polyline with each bend rounded by up to `radius` (quadratic corners).
function roundedPolyline(ctx, pts, radius) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6 * l1 * l2) { ctx.lineTo(b.x, b.y); continue; }
    const r = Math.min(radius, l1 / 2, l2 / 2);
    ctx.lineTo(b.x - ((b.x - a.x) / l1) * r, b.y - ((b.y - a.y) / l1) * r);
    ctx.quadraticCurveTo(b.x, b.y, b.x + ((c.x - b.x) / l2) * r, b.y + ((c.y - b.y) / l2) * r);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function dedupe(pts) {
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.01);
}

/// A pill around the dots: a circle for one, else a capsule along the two
/// dots furthest apart.
function capsule(ctx, dots, r) {
  let a = dots[0], b = dots[0], best = 0;
  for (const p of dots) for (const q of dots) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > best) { best = d; a = p; b = q; }
  }
  if (best < 0.5) { ctx.arc(a.x, a.y, r, 0, 2 * Math.PI); return; }
  const th = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(th), ny = Math.cos(th);
  // Dots off the axis widen the pill.
  const off = Math.max(...dots.map((p) => Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny)));
  const R = r + off / 2;
  const cx = (off / 2) * nx * Math.sign(dots.reduce((s, p) => s + (p.x - a.x) * nx + (p.y - a.y) * ny, 0) || 1);
  const cy = (off / 2) * ny * Math.sign(dots.reduce((s, p) => s + (p.x - a.x) * nx + (p.y - a.y) * ny, 0) || 1);
  const A = { x: a.x + cx, y: a.y + cy }, B = { x: b.x + cx, y: b.y + cy };
  ctx.moveTo(A.x - nx * R, A.y - ny * R);
  ctx.lineTo(B.x - nx * R, B.y - ny * R);
  ctx.arc(B.x, B.y, R, th - Math.PI / 2, th + Math.PI / 2);
  ctx.lineTo(A.x + nx * R, A.y + ny * R);
  ctx.arc(A.x, A.y, R, th + Math.PI / 2, th + (3 * Math.PI) / 2);
  ctx.closePath();
}

/// Where you can change to a different route: lines meet, split or end
/// here. Stations along a shared trunk are ordinary stops, as on real maps.
export function isInterchange(net, i) {
  if (net.stations[i].lines.length < 2) return false;
  const incident = net.neighbours[i].map((ei) => [...net.edges[ei].lines].sort().join(","));
  return incident.length !== 2 || incident[0] !== incident[1];
}

/// Interchanges, each joined with the stations walkways link it to.
function interchangeGroups(net, near) {
  const parent = new Map();
  const find = (i) => { while (parent.get(i) !== i) i = parent.get(i); return i; };
  const add = (i) => { if (!parent.has(i)) parent.set(i, i); };
  net.stations.forEach((s) => { if (!s.junction && isInterchange(net, s.index)) add(s.index); });
  for (const [a, b] of net.transfers) {
    add(a); add(b);
    if (near(a, b)) parent.set(find(a), find(b));
  }
  const groups = new Map();
  for (const i of parent.keys()) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return [...groups.values()];
}

/// One dot per line per station, on that line's lane; dots that land on one
/// spot (lines crossing) sit in a row centred on it.
function groupDots(net, group, P, toScreen, laneOffset, laneWidth) {
  const dots = [];
  for (const i of group) {
    const base = toScreen(P[i]);
    for (const lineID of net.stations[i].lines) {
      const ei = net.neighbours[i].find((e) => net.edges[e].lines.includes(lineID));
      const edge = ei != null ? net.edges[ei] : null;
      const off = edge ? laneOffset(edge.a, edge.b, lineID) : { x: 0, y: 0 };
      const color = net.lines.find((l) => l.id === lineID)?.color || "#888";
      dots.push({ point: { x: base.x + off.x, y: base.y + off.y }, color });
    }
  }
  const clusters = [];
  for (const d of dots) {
    const c = clusters.find((c) => Math.hypot(c[0].point.x - d.point.x, c[0].point.y - d.point.y) < laneWidth * 0.5);
    if (c) c.push(d); else clusters.push([d]);
  }
  for (const c of clusters) {
    if (c.length < 2) continue;
    const cx = c[0].point.x;
    c.forEach((d, j) => { d.point = { x: cx + (j - (c.length - 1) / 2) * laneWidth, y: c[0].point.y }; });
  }
  return dots;
}

function typicalGap(paths) {
  const gaps = [];
  for (const { points, stationVertex } of paths) {
    for (let k = 1; k < stationVertex.length; k++) {
      const a = points[stationVertex[k - 1]], b = points[stationVertex[k]];
      gaps.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 10;
}
