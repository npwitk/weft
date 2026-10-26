import { loadNetwork } from "./network.js";
import { createLayout, solve } from "./layout.js";
import { STYLES, HAND_TRACED } from "./styles.js";
import { linePaths } from "./paths.js";
import { measure, total, METRICS, DEFAULT_WEIGHTS } from "./metrics.js";
import { draw, LIGHT } from "./render.js";
import { exportLayout, download } from "./export.js";
import { loadMapKit, AppleMapLayer } from "./applemap.js";

// js/config.js is yours and stays out of git (see config.example.js).
const config = await import("./config.js").catch(() => ({}));
let mapLayer = null;
const mapOn = () => Boolean(mapLayer && $("useMap").checked);

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

let net = null;
let entries = [];          // { style, state, card, canvas, scores, dirty }
let selected = store.get("lab.style", "octilinear");
// ?city=berlin&t=0.4&style=grid make shareable links.
const query = new URLSearchParams(location.search);
if (query.get("style")) selected = query.get("style");
let t = query.has("t") ? Math.min(1, Math.max(0, Number(query.get("t")) || 0)) : Number(store.get("lab.t", 1));
let weights = { ...DEFAULT_WEIGHTS, ...store.get("lab.weights", {}) };


async function open(city) {
  net = await loadNetwork(`data/${city}.json`, city);
  const styles = [...STYLES, ...(net.stations.every((s) => s.ref) ? [HAND_TRACED] : [])];
  $("cards").replaceChildren();
  entries = styles.map((style) => {
    const card = document.createElement("button");
    card.className = "card";
    card.type = "button";
    card.innerHTML = `<canvas></canvas><h3><span>${style.name}</span><span class="badge"></span></h3><p class="why">${style.inspiredBy}</p><table></table>`;
    card.addEventListener("click", () => select(style.id));
    $("cards").append(card);
    return { style, state: createLayout(net, style), card, canvas: card.querySelector("canvas"), scores: null, dirty: true };
  });
  if (!entries.some((e) => e.style.id === selected)) selected = "octilinear";
  select(selected);
  mapLayer?.show(net);
}

function select(id) {
  selected = id;
  store.set("lab.style", id);
  for (const e of entries) e.card.setAttribute("aria-pressed", String(e.style.id === id));
  const e = current();
  $("bigName").textContent = e.style.name;
  $("bigWhy").textContent = e.style.inspiredBy;
  e.dirty = true;
}

const current = () => entries.find((e) => e.style.id === selected);

// Settle every style a little each frame, selected one first, ~10 ms total.
function frame() {
  const start = performance.now();
  const order = [current(), ...entries.filter((e) => e !== current())].filter(Boolean);
  for (const e of order) {
    if (performance.now() - start > 10) break;
    if (!e.state.converged || e.state.t !== t) {
      solve(e.state, t, 2);
      e.dirty = true;
    }
  }
  const th = LIGHT;
  for (const e of entries) {
    if (!e.dirty) continue;
    e.dirty = false;
    const paths = linePaths(e.state, t);
    e.paths = paths;
    draw(e.canvas, e.state, paths, { theme: th });
    if (e === current()) {
      const project = mapOn() ? mapLayer.projector($("big")) : null;
      draw($("big"), e.state, paths, { theme: th, labels: $("labels").checked, project });
    }
    if (e.state.converged || e.style.fixed) e.scores = measure(e.state, paths);
  }
  renderScores();
  requestAnimationFrame(frame);
}

function renderScores() {
  const ready = entries.filter((e) => e.scores);
  const totals = new Map(ready.map((e) => [e, total(e.scores, weights)]));
  const best = [...totals].filter(([e]) => !e.style.fixed).sort((a, b) => a[1] - b[1])[0]?.[0];
  for (const e of entries) {
    const badge = e.card.querySelector(".badge");
    badge.textContent = e === best && ready.length === entries.length ? "Best for these weights" : "";
    const table = e.card.querySelector("table");
    const key = e.scores ? JSON.stringify(e.scores) + JSON.stringify(weights) : "settling";
    if (table.dataset.key === key) continue;
    table.dataset.key = key;
    if (!e.scores) { table.innerHTML = `<tr><td class="info">Settling…</td><td></td></tr>`; continue; }
    table.innerHTML = METRICS.map((m) => {
      const v = e.scores[m.id];
      if (v == null) return "";
      const text = Number.isInteger(v) ? v : v.toFixed(m.unit === "°" || m.unit === "°/line" ? 1 : 2);
      return `<tr title="${m.help}"><td class="${m.info ? "info" : ""}">${m.name}</td><td>${text}${m.unit && m.unit !== "gaps" ? " " + m.unit : ""}</td></tr>`;
    }).join("") + `<tr class="total"><td>Total</td><td>${totals.get(e).toFixed(2)}</td></tr>`;
  }
}

function buildWeights() {
  $("weights").innerHTML = METRICS.map((m) =>
    `<label title="${m.help}">${m.name}<input type="number" min="0" max="5" step="0.5" data-id="${m.id}" value="${weights[m.id] ?? 0}"></label>`).join("");
  $("weights").addEventListener("input", (event) => {
    const id = event.target.dataset.id;
    if (!id) return;
    weights[id] = Math.max(0, Number(event.target.value) || 0);
    store.set("lab.weights", weights);
  });
}

function setT(value) {
  t = value;
  store.set("lab.t", t);
  $("t").value = t;
  $("tv").textContent = `${Math.round(t * 100)}%`;
  for (const e of entries) { e.scores = null; e.dirty = true; }
  mapLayer?.fade(mapOn() ? t : 1);
  reframeSoon();
}

// After a slider move settles, frame the map on the layout as drawn now.
let reframeTimer = null;
function reframeSoon() {
  clearTimeout(reframeTimer);
  reframeTimer = setTimeout(() => {
    const e = current();
    if (mapOn() && e) mapLayer.show(net, e.state.positions);
  }, 600);
}

$("t").addEventListener("input", (event) => setT(Number(event.target.value)));
$("labels").addEventListener("change", () => { const e = current(); if (e) e.dirty = true; });
$("city").addEventListener("change", (event) => { store.set("lab.city", event.target.value); open(event.target.value); });
$("export").addEventListener("click", () => {
  const e = current();
  if (!e?.paths) return;
  download(`${net.name}-${e.style.id}-${Math.round(t * 100)}.json`, exportLayout(e.state, e.paths, t));
});
new ResizeObserver(() => entries.forEach((e) => (e.dirty = true))).observe(document.body);

$("useMap").addEventListener("change", () => {
  $("bigWrap").classList.toggle("on-map", mapOn());
  mapLayer?.fade(mapOn() ? t : 1);
  const e = current(); if (e) e.dirty = true;
});

buildWeights();
if (await loadMapKit(config.MAPKIT_TOKEN)) {
  mapLayer = new AppleMapLayer($("map"), () => { const e = current(); if (e) e.dirty = true; });
  $("mapToggle").hidden = false;
  $("bigWrap").classList.add("on-map");
}
const city = query.get("city") || store.get("lab.city", "bangkok");
$("city").value = city;
setT(t);
open(city).then(() => requestAnimationFrame(frame));
