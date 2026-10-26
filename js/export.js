// A layout in Pinwake's network format: each station's `sx`/`sy`, each
// line's `path` (bends included) and its stops' `offsets` along it, all in a
// 0–1000 box, the same normalisation as Pinwake's relayout_schematic.py.
// Merge it into a network with Pinwake's Design/RailData/apply_layout.py.

import { bounds } from "./network.js";

export function exportLayout(state, paths, t) {
  const { net } = state;
  const positions = state.drawn || state.positions;
  const all = [...positions, ...paths.flatMap((p) => p.points)];
  const box = bounds(all);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY) || 1;
  const norm = (p) => [round((p.x - box.minX) / span * 1000), round((p.y - box.minY) / span * 1000)];

  const lines = paths.map(({ line, points, stationVertex }) => {
    const path = points.map(norm);
    const along = [0];
    for (let i = 1; i < path.length; i++) {
      along.push(along[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    }
    return { id: line.id, path, offsets: stationVertex.map((v) => round(along[v])) };
  });
  const stations = net.stations.map((s, i) => {
    const [sx, sy] = norm(positions[i]);
    return { id: s.id, sx, sy };
  });
  return {
    generator: "weft",
    network: net.name,
    style: state.style.id,
    t,
    lines,
    stations,
  };
}

const round = (v) => Math.round(v * 10) / 10;

export function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
