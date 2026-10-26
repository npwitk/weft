// Map styles: the design rules of real maps, as settings for one optimiser.
//
// - `step`: allowed line directions, every `step` degrees (45 = octilinear).
//   "orthoradial" means along or across circles around the centre.
// - `weights`: how much each rule matters once fully schematic (t = 1);
//   the slider scales them in. See layout.js for what each term measures.
// - `drawing`: how an edge between two stations is drawn.
//   track: the real track; dogleg: straight runs joined by one allowed-angle
//   bend; spline: smooth curves through the stations; arc: circles.

export const STYLES = [
  {
    id: "geographic",
    name: "Geographic",
    inspiredBy: "The real track, simplified as the slider moves",
    step: null,
    weights: { length: 1.2, bend: 0.6 },
    drawing: "track",
  },
  {
    id: "octilinear",
    name: "Octilinear",
    inspiredBy: "Harry Beck's London Underground (1933); Bangkok's and Singapore's official maps",
    step: 45,
    weights: { angle: 6, length: 1.5, bend: 2.5 },
    drawing: "dogleg",
  },
  {
    id: "pinwake",
    name: "Pinwake",
    inspiredBy: "Pinwake's hand-traced Bangkok: mostly level and upright, few bends, stations evenly spaced between interchanges",
    step: 45,
    // Learned from the hand-traced Bangkok: 77% of its track is level or
    // upright, about 5 bends a line, even gaps between pinned stations.
    weights: { angle: 6, length: 1.5, bend: 3.5, diagonal: 1.2 },
    drawing: "dogleg",
    evenSpacing: true,
  },
  {
    id: "grid",
    name: "Grid",
    inspiredBy: "Massimo Vignelli's New York subway (1972): right angles only",
    step: 90,
    weights: { angle: 8, length: 2.5, bend: 3 },
    drawing: "dogleg",
  },
  {
    id: "hexalinear",
    name: "Hexalinear",
    inspiredBy: "Max Roberts' 60° designs",
    step: 60,
    weights: { angle: 6, length: 1.5, bend: 2.5 },
    drawing: "dogleg",
  },
  {
    id: "curvilinear",
    name: "Curvy",
    inspiredBy: "Max Roberts' curvilinear maps; the flowing lines of Tokyo's diagrams",
    step: null,
    weights: { length: 1.8, bend: 3 },
    drawing: "spline",
  },
  {
    id: "concentric",
    name: "Circles",
    inspiredBy: "Max Roberts' concentric-circles maps (Berlin, London)",
    step: "orthoradial",
    weights: { angle: 5, length: 0.8, bend: 0.4 },
    drawing: "arc",
  },
];

/// Pinwake's hand-traced layout, shown and scored like a style.
export const HAND_TRACED = {
  id: "hand",
  name: "Hand-traced",
  inspiredBy: "Pinwake's own diagram, pinned by hand",
  fixed: true,
  drawing: "reference",
};

export const styleByID = (id) => [...STYLES, HAND_TRACED].find((s) => s.id === id);
