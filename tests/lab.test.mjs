import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fromJSON, segmentsCross } from "../js/network.js";
import { createLayout, settle } from "../js/layout.js";
import { STYLES, HAND_TRACED, styleByID } from "../js/styles.js";
import { linePaths, dogleg } from "../js/paths.js";
import { measure } from "../js/metrics.js";
import { exportLayout } from "../js/export.js";

const load = (name) => fromJSON(JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url))), name);
const networks = readdirSync(new URL("../data/", import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

test("every network loads with lines, edges and a station gap", () => {
  for (const name of networks) {
    const net = load(name);
    assert.ok(net.lines.length > 0 && net.edges.length > 0, name);
    assert.ok(net.unit > 0, name);
    for (const line of net.lines) assert.ok(line.stops.every((s) => s != null), `${name} ${line.id}`);
  }
});

test("at 0% every style is the real map", () => {
  const net = load("freiburg");
  for (const style of STYLES) {
    const state = settle(createLayout(net, style), 0);
    state.positions.forEach((p, i) => assert.deepEqual(p, net.stations[i].geo));
  }
});

test("at 100% the angle styles draw only allowed directions", () => {
  const net = load("wien");
  for (const id of ["octilinear", "grid", "hexalinear"]) {
    const state = settle(createLayout(net, styleByID(id)), 1);
    const scores = measure(state, linePaths(state, 1));
    assert.ok(scores.angle < 0.5, `${id}: ${scores.angle}°`);
  }
});

// Lines may cross only as often as they really do. Known leftovers are
// listed so they can't grow, and any other style or network must stay at 0.
const KNOWN_CROSSINGS = { "grid:bangkok": 1, "stretch:singapore": 1, "stretch:berlin": 2, "stretch:wien": 1 };

test("no style adds crossings the real network doesn't have", () => {
  for (const name of ["bangkok", "singapore", "berlin", "wien"]) {
    const net = load(name);
    for (const style of STYLES) {
      const state = settle(createLayout(net, style), 1);
      const found = measure(state, linePaths(state, 1)).crossings;
      assert.ok(found <= (KNOWN_CROSSINGS[`${style.id}:${name}`] ?? 0), `${name} ${style.id}: ${found}`);
    }
  }
});

test("by stretch: stations spread evenly and every stretch has at most one bend", () => {
  const net = load("bangkok");
  const state = settle(createLayout(net, styleByID("stretch")), 1);
  linePaths(state, 1);
  for (const c of state.stretches.chains) {
    const piecePoints = new Set();
    for (let j = 0; j < c.k; j++) {
      for (const p of state.pieces.get(`${c.stations[j]}|${c.stations[j + 1]}`).slice(1, -1)) piecePoints.add(`${p.x},${p.y}`);
    }
    assert.ok(piecePoints.size <= 1, `${c.a}→${c.b} bends ${piecePoints.size} times`);
  }
});

test("the hand-traced layout matches itself and keeps to 45°", () => {
  const net = load("bangkok");
  const state = createLayout(net, HAND_TRACED);
  const scores = measure(state, linePaths(state, 1));
  assert.ok(scores.hand < 1e-9);
  assert.ok(scores.angle < 1, `${scores.angle}°`);
});

test("a dogleg bends once, on allowed directions, and keeps the ends", () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 3 };
  const bend = dogleg(a, b, 45, null);
  for (const [p, q] of [[a, bend], [bend, b]]) {
    const deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    assert.ok(Math.abs(deg / 45 - Math.round(deg / 45)) < 1e-6, `${deg}`);
  }
  assert.equal(dogleg(a, { x: 5, y: 5 }, 45, null), null);
});

test("export is Pinwake's format: 0–1000 box, offsets along each path", () => {
  const net = load("bangkok");
  const state = settle(createLayout(net, styleByID("octilinear")), 1);
  const out = exportLayout(state, linePaths(state, 1), 1);
  assert.equal(out.stations.length, net.stations.length);
  for (const s of out.stations) assert.ok(s.sx >= 0 && s.sx <= 1000 && s.sy >= 0 && s.sy <= 1000);
  for (const line of out.lines) {
    const source = net.lines.find((l) => l.id === line.id);
    assert.equal(line.offsets.length, source.stops.length);
    for (let k = 1; k < line.offsets.length; k++) assert.ok(line.offsets[k] >= line.offsets[k - 1], line.id);
  }
});

test("segmentsCross ignores touching ends", () => {
  const p = (x, y) => ({ x, y });
  assert.equal(segmentsCross(p(0, 0), p(2, 2), p(0, 2), p(2, 0)), true);
  assert.equal(segmentsCross(p(0, 0), p(1, 1), p(1, 1), p(2, 0)), false);
});
