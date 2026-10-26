#!/usr/bin/env node
// Renders the README images (SVG) with the same painter as the website:
//   docs/hero.svg     one network going from the real map to schematic
//   docs/pinwake.svg  Pinwake's hand-traced Bangkok next to the automatic style
//   docs/gallery.svg  every network in one style
//
//   node scripts/render-readme.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fromJSON } from "../js/network.js";
import { createLayout, settle } from "../js/layout.js";
import { styleByID } from "../js/styles.js";
import { linePaths } from "../js/paths.js";
import { paint, LIGHT } from "../js/render.js";
import { SvgContext } from "../js/svgcontext.js";

const root = new URL("../", import.meta.url);
const load = (name) => fromJSON(JSON.parse(readFileSync(new URL(`data/${name}.json`, root))), name);
const INK = "#1d1d1f", MUTED = "#86868b", LINE = "#e5e5ea";
const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
const text = (x, y, size, fill, content, extra = "") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${content}</text>`;
const svg = (W, H, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;

/// One layout drawn into the box (x, y, w, h).
function panel(net, styleID, t, x, y, w, h) {
  const state = settle(createLayout(net, styleByID(styleID)), t);
  const paths = linePaths(state, t);
  const ctx = new SvgContext();
  paint(ctx, w, h, state, paths, { theme: LIGHT, x, y, pad: 6 });
  return ctx.toString();
}

const arrow = (x, y) => `<path d="M${x} ${y}h18m-6 -5l6 5l-6 5" fill="none" stroke="${MUTED}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;

function hero() {
  const net = load("berlin");
  const W = 1600, H = 620, top = 150, gapX = 40;
  const steps = [
    ["geographic", 0, "Real map", "0%"],
    ["octilinear", 0.55, "Simplifying", "55%"],
    ["octilinear", 1, "Octilinear", "after Harry Beck, 1933"],
    ["pinwake", 1, "Pinwake", "level runs, even spacing"],
  ];
  const w = (W - 112 - gapX * 3) / 4, h = H - top - 80;
  let body = text(56, 78, 44, INK, "Weft", `font-weight="700" letter-spacing="-0.5"`);
  body += text(56, 114, 19, MUTED, "Berlin U-Bahn, from the real map to schematic, in the styles of famous metro maps");
  steps.forEach(([style, t, title, sub], k) => {
    const x = 56 + k * (w + gapX);
    body += panel(net, style, t, x, top, w, h);
    body += text(x + 6, H - 46, 19, INK, title, `font-weight="600"`);
    body += text(x + 6, H - 22, 14, MUTED, sub);
    if (k < steps.length - 1) body += arrow(x + w + 11, top + h / 2);
  });
  return svg(W, H, body);
}

function pinwake() {
  const net = load("bangkok");
  const W = 1600, H = 820, top = 110, gapX = 60;
  const w = (W - 112 - gapX) / 2, h = H - top - 70;
  let body = text(56, 64, 30, INK, "Bangkok: drawn by hand, and by the Pinwake style", `font-weight="700"`);
  [["hand", "Hand-traced in Pinwake"], ["pinwake", "Pinwake style, automatic"]].forEach(([style, title], k) => {
    const x = 56 + k * (w + gapX);
    body += panel(net, style, 1, x, top, w, h);
    body += text(x + 6, H - 28, 19, INK, title, `font-weight="600"`);
  });
  body += `<line x1="${W / 2}" y1="${top}" x2="${W / 2}" y2="${H - 60}" stroke="${LINE}" stroke-width="1.5"/>`;
  return svg(W, H, body);
}

function gallery() {
  const names = ["bangkok", "singapore", "berlin", "chicago", "freiburg", "stuttgart", "sydney", "wien"];
  const titles = { bangkok: "Bangkok", singapore: "Singapore", berlin: "Berlin", chicago: "Chicago", freiburg: "Freiburg",
                   stuttgart: "Stuttgart", sydney: "Sydney", wien: "Vienna" };
  const cols = 4, cell = 370, gap = 24, head = 84;
  const W = cols * cell + (cols + 1) * gap, rows = Math.ceil(names.length / cols), H = head + rows * (cell + 44) + 6;
  let body = text(gap + 4, 54, 28, INK, "Eight networks in the Pinwake style", `font-weight="700"`);
  names.forEach((name, k) => {
    const x = gap + (k % cols) * (cell + gap), y = head + Math.floor(k / cols) * (cell + 44);
    body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="14" fill="none" stroke="${LINE}" stroke-width="1.5"/>`;
    body += panel(load(name), "pinwake", 1, x + 16, y + 16, cell - 32, cell - 32);
    body += text(x + 4, y + cell + 28, 17, MUTED, titles[name]);
  });
  return svg(W, H, body);
}

mkdirSync(new URL("docs/", root), { recursive: true });
for (const [name, make] of [["hero", hero], ["pinwake", pinwake], ["gallery", gallery]]) {
  writeFileSync(new URL(`docs/${name}.svg`, root), make());
  console.log(`wrote docs/${name}.svg`);
}
