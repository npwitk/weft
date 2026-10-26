// A rail network as a graph, from Pinwake's network JSON (lines with ordered
// stations and real track, stations with lat/lon). Everything is projected
// into one "layout box" (0–1000 on the longer side, y pointing down) so
// every style works in the same units.

export async function loadNetwork(url, name) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return fromJSON(await response.json(), name);
}

export function fromJSON(data, name = "network") {
  // Equirectangular projection around the centroid, in metres.
  const lat0 = mean(data.stations.map((s) => s.lat));
  const lon0 = mean(data.stations.map((s) => s.lon));
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const project = (lat, lon) => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * ky });

  const raw = data.stations.map((s) => project(s.lat, s.lon));
  const box = bounds(raw);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY) || 1;
  const toBox = (p) => ({ x: ((p.x - box.minX) / span) * 1000, y: ((p.y - box.minY) / span) * 1000 });
  const metresPerUnit = span / 1000;

  const index = new Map();
  const stations = data.stations.map((s, i) => {
    const station = {
      index: i,
      id: s.id,
      name: s.nameEN || "",
      lines: s.lines,
      // Where track splits, not a stop: laid out, but not drawn.
      junction: Boolean(s.junction),
      geo: toBox(raw[i]),
      // Pinwake's hand-traced position, when the network has one.
      ref: s.sx != null ? { x: s.sx, y: s.sy } : null,
    };
    index.set(s.id, i);
    return station;
  });

  const lines = data.lines.map((l) => ({
    id: l.id,
    name: l.nameEN,
    color: l.color,
    // Station indices in running order; a station listed twice closes a loop.
    stops: l.stations.map((id) => index.get(id)),
    track: (l.geometry || []).map(([lat, lon]) => toBox(project(lat, lon))),
    trackOffsets: (l.geoOffsets || []).map((m) => m / metresPerUnit),
    refPath: (l.path || []).map(([x, y]) => ({ x, y })),
  }));

  // Undirected edges between consecutive stops, shared by every line on them.
  const edgeMap = new Map();
  for (const line of lines) {
    for (let k = 0; k + 1 < line.stops.length; k++) {
      const a = line.stops[k], b = line.stops[k + 1];
      if (a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), lines: [] });
      const edge = edgeMap.get(key);
      if (!edge.lines.includes(line.id)) edge.lines.push(line.id);
    }
  }
  const edges = [...edgeMap.values()];
  const neighbours = stations.map(() => []);
  edges.forEach((e, i) => {
    neighbours[e.a].push(i);
    neighbours[e.b].push(i);
  });

  const transfers = (data.transfers || [])
    .map(([a, b]) => [index.get(a), index.get(b)])
    .filter(([a, b]) => a != null && b != null);

  // A typical gap between stations, the unit for spacing and step sizes.
  const lengths = edges.map((e) => dist(stations[e.a].geo, stations[e.b].geo)).sort((p, q) => p - q);
  const unit = lengths[Math.floor(lengths.length / 2)] || 10;

  // Back from the layout box to the globe, for drawing on a real map.
  const toLatLon = (p) => ({
    lat: lat0 - (p.y * span / 1000 + box.minY) / ky,
    lon: lon0 + (p.x * span / 1000 + box.minX) / kx,
  });

  return { name, stations, lines, edges, neighbours, transfers, unit, index, metresPerUnit, toLatLon };
}

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
export const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

export function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/// Whether segments p1–p2 and q1–q2 properly cross (touching ends don't count).
export function segmentsCross(p1, p2, q1, q2) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(q1, q2, p1), d2 = d(q1, q2, p2), d3 = d(p1, p2, q1), d4 = d(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/// Distance from point p to segment a–b.
export function pointSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
