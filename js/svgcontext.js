// Just enough of the canvas 2D API for render.js's `paint`, writing SVG
// instead, so the README images are drawn by exactly the same code.

export class SvgContext {
  constructor() {
    this.parts = [];
    this.d = "";
    this.hasPoint = false;
    this.strokeStyle = "#000";
    this.fillStyle = "#000";
    this.lineWidth = 1;
    this.lineCap = "butt";
    this.lineJoin = "miter";
    this.font = "10px sans-serif";
    this.textBaseline = "alphabetic";
    this.dash = [];
  }

  beginPath() { this.d = ""; this.hasPoint = false; }
  moveTo(x, y) { this.d += `M${f(x)} ${f(y)}`; this.hasPoint = true; }
  lineTo(x, y) { this.d += `${this.hasPoint ? "L" : "M"}${f(x)} ${f(y)}`; this.hasPoint = true; }
  quadraticCurveTo(cx, cy, x, y) { this.d += `Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`; }
  closePath() { this.d += "Z"; }
  setLineDash(dash) { this.dash = dash; }

  /// Clockwise arcs, as render.js uses them.
  arc(x, y, r, a0, a1) {
    const point = (a) => [x + r * Math.cos(a), y + r * Math.sin(a)];
    const [sx, sy] = point(a0);
    this.d += `${this.hasPoint ? "L" : "M"}${f(sx)} ${f(sy)}`;
    this.hasPoint = true;
    let sweep = a1 - a0;
    if (sweep >= 2 * Math.PI - 1e-9) {
      const [mx, my] = point(a0 + Math.PI);
      this.d += `A${f(r)} ${f(r)} 0 1 1 ${f(mx)} ${f(my)}A${f(r)} ${f(r)} 0 1 1 ${f(sx)} ${f(sy)}`;
      return;
    }
    sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const [ex, ey] = point(a1);
    this.d += `A${f(r)} ${f(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${f(ex)} ${f(ey)}`;
  }

  stroke() {
    const dash = this.dash.length ? ` stroke-dasharray="${this.dash.join(" ")}"` : "";
    this.parts.push(`<path d="${this.d}" fill="none" stroke="${this.strokeStyle}" stroke-width="${f(this.lineWidth)}" stroke-linecap="${this.lineCap}" stroke-linejoin="${this.lineJoin}"${dash}/>`);
  }

  fill() { this.parts.push(`<path d="${this.d}" fill="${this.fillStyle}"/>`); }

  fillText(text, x, y) {
    const match = /(?:(\d{3})\s+)?([\d.]+)px\s+(.*)/.exec(this.font) || [];
    const weight = match[1] ? ` font-weight="${match[1]}"` : "";
    const baseline = this.textBaseline === "middle" ? ` dominant-baseline="middle"` : "";
    this.parts.push(`<text x="${f(x)}" y="${f(y)}" font-size="${match[2] || 10}" font-family="${escape(match[3] || "sans-serif")}"${weight}${baseline} fill="${this.fillStyle}">${escape(text)}</text>`);
  }

  toString() { return this.parts.join(""); }
}

const f = (v) => (Math.round(v * 10) / 10).toString();
const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
