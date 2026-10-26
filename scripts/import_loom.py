#!/usr/bin/env python3
"""Converts a LOOM line graph (GeoJSON from https://github.com/ad-freiburg/loom,
e.g. its examples/berlin.json) into the network format the lab reads, which
is Pinwake's: lines with ordered stops and real track, stations with lat/lon.

    python3 -I scripts/import_loom.py <loom.json> <out.json> <Display name>

LOOM stores a graph: nodes (stations, or junctions where track splits) and
edges carrying the lines that run along them. The lab wants each line as
runs of stops, so every line's edges are walked into paths: from an end of
the line, carrying straight on at junctions, until its edges are used up.
A line that branches becomes several runs ("U5", "U5 · 2"). Junctions stay
in as unnamed nodes so the track keeps its shape.

LOOM is by Patrick Brosi and the University of Freiburg's Chair of
Algorithms and Data Structures (GPL-3.0); its example graphs are built from
the cities' published GTFS feeds. See data/SOURCES.md.
"""
import json, math, sys
from collections import defaultdict


def metres(a, b):
    """Equirectangular distance between [lon, lat] points."""
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k * 111_320, (a[1] - b[1]) * 110_540)


def bearing(a, b):
    return math.atan2(b[1] - a[1], (b[0] - a[0]) * math.cos(math.radians(a[1])))


def main(src, out, name):
    data = json.load(open(src))
    nodes, edges = {}, []
    for f in data["features"]:
        g, p = f["geometry"], f["properties"]
        if g["type"] == "Point":
            nodes[p["id"]] = {"coord": g["coordinates"], "label": (p.get("station_label") or "").strip(),
                              "station": "station_id" in p}
        elif g["type"] == "LineString":
            edges.append({"from": p["from"], "to": p["to"], "coords": g["coordinates"], "lines": p.get("lines", [])})

    # Lines by LOOM id; unlabelled ones (Chicago) are named by their colour.
    info = {}
    for e in edges:
        for l in e["lines"]:
            info.setdefault(l["id"], {"label": l.get("label") or "", "color": "#" + l.get("color", "888888").lstrip("#")})
    unnamed = sorted(i for i, v in info.items() if not v["label"])
    for n, i in enumerate(unnamed, 1):
        info[i]["label"] = colour_name(info[i]["color"]) or f"Line {n}"

    out_lines, used_nodes = [], set()
    for line_id, meta in sorted(info.items(), key=lambda kv: natural(kv[1]["label"])):
        mine = [e for e in edges if any(l["id"] == line_id for l in e["lines"])]
        for k, run in enumerate(walk(mine, nodes)):
            stops = [r[0] for r in run]
            coords, offsets = [], []
            for node, piece in run:
                if piece:
                    coords.extend(piece if not coords else piece[1:])
                else:
                    coords.append(nodes[node]["coord"])
                along = 0.0
                for a, b in zip(coords, coords[1:]):
                    along += metres(a, b)
                offsets.append(round(along, 1))
            used_nodes.update(stops)
            label = meta["label"] if k == 0 else f"{meta['label']} · {k + 1}"
            out_lines.append({
                "id": f"{slug(meta['label'])}-{k + 1}" if k else slug(meta["label"]),
                "nameEN": label, "color": meta["color"], "loop": False,
                "stations": [f"n{node}" for node in stops],
                "geometry": [[round(c[1], 6), round(c[0], 6)] for c in coords],
                "geoOffsets": offsets,
            })

    lines_at = defaultdict(list)
    for l in out_lines:
        for s in l["stations"]:
            if l["id"] not in lines_at[s]:
                lines_at[s].append(l["id"])
    stations = []
    for node in sorted(used_nodes):
        n = nodes[node]
        stations.append({"id": f"n{node}", "nameEN": n["label"], "lat": round(n["coord"][1], 6),
                         "lon": round(n["coord"][0], 6), "lines": lines_at[f"n{node}"],
                         **({} if n["station"] else {"junction": True})})
    result = {"source": f"LOOM example graph ({src.split('/')[-1]}), github.com/ad-freiburg/loom",
              "name": name, "lines": out_lines, "stations": stations, "transfers": []}
    json.dump(result, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{name}: {len(out_lines)} runs, {sum(1 for s in stations if 'junction' not in s)} stations, "
          f"{sum(1 for s in stations if 'junction' in s)} junctions")


def walk(mine, nodes):
    """Splits one line's edges into runs [(node, track from previous node)]."""
    adjacent = defaultdict(list)
    for i, e in enumerate(mine):
        adjacent[e["from"]].append(i)
        adjacent[e["to"]].append(i)
    unused = set(range(len(mine)))
    runs = []
    while unused:
        # Start at an end of the line if one is left, else anywhere (a loop).
        ends = [n for n, es in adjacent.items() if sum(1 for i in es if i in unused) == 1]
        start = min(ends) if ends else mine[min(unused)]["from"]
        run = [(start, None)]
        here, heading = start, None
        while True:
            options = [i for i in adjacent[here] if i in unused]
            if not options:
                break
            # Carry on as straight as possible.
            def straightness(i):
                piece = oriented(mine[i], here)
                if heading is None or len(piece) < 2:
                    return 0
                d = bearing(piece[0], piece[min(len(piece) - 1, 3)]) - heading
                return abs(math.atan2(math.sin(d), math.cos(d)))
            i = min(options, key=straightness)
            unused.discard(i)
            piece = oriented(mine[i], here)
            nxt = mine[i]["to"] if mine[i]["from"] == here else mine[i]["from"]
            run.append((nxt, piece))
            if len(piece) >= 2:
                heading = bearing(piece[max(0, len(piece) - 4)], piece[-1])
            here = nxt
        if len(run) > 1:
            runs.append(run)
    return runs


def oriented(edge, start):
    return edge["coords"] if edge["from"] == start else list(reversed(edge["coords"]))


def slug(text):
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-") or "line"


def natural(text):
    import re
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", text)]


def colour_name(hex_colour):
    """Chicago's L lines are known by colour."""
    names = {"#c60c30": "Red", "#00a1de": "Blue", "#62361b": "Brown", "#009b3a": "Green",
             "#f9461c": "Orange", "#e27ea6": "Pink", "#522398": "Purple", "#f9e300": "Yellow"}
    return names.get(hex_colour.lower())


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
