// Apple Maps under the big view (MapKit JS). The token comes from
// js/config.js when you have one locally (see config.example.js), else from
// the deployment's /api/mapkit-token function (Vercel). Without either the
// lab draws on a plain background.
//
// The lab's canvas stays on top: layout points go back to latitude and
// longitude (network.toLatLon) and through the map's projection, so the
// lines sit on the real streets at t = 0 and pan and zoom with the map. As
// the slider moves towards schematic, the map fades out.

const MAPKIT_SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";

let ready = null;

/// A fresh token from the deployment, or null where there's no such
/// function (a local static server) or Apple Maps isn't set up.
async function tokenFromServer() {
  try {
    const response = await fetch("api/mapkit-token", { cache: "no-store" });
    const text = response.ok ? (await response.text()).trim() : "";
    return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

/// Loads MapKit JS once. Resolves false when there's no token or it fails.
export async function loadMapKit(localToken) {
  const first = localToken || (await tokenFromServer());
  if (!first) return false;
  ready ??= new Promise((resolve) => {
    // Later requests (tokens expire) go back to the server unless local.
    let pending = first;
    const token = (done) => {
      if (pending) { done(pending); pending = null; return; }
      (localToken ? Promise.resolve(localToken) : tokenFromServer()).then((t) => t && done(t));
    };
    const script = document.createElement("script");
    script.src = MAPKIT_SRC;
    script.crossOrigin = "anonymous";
    script.dataset.libraries = "map";
    script.dataset.callback = "__mapkitLoaded";
    window.__mapkitLoaded = () => {
      try {
        mapkit.init({ authorizationCallback: token });
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  return ready;
}

export class AppleMapLayer {
  constructor(element, onMove) {
    this.element = element;
    this.map = new mapkit.Map(element, {
      showsCompass: mapkit.FeatureVisibility.Hidden,
      showsMapTypeControl: false,
      showsPointsOfInterest: false,
      isRotationEnabled: false,
      colorScheme: "light",
    });
    // Redraw while the map moves.
    let moving = false;
    const tick = () => { onMove(); if (moving) requestAnimationFrame(tick); };
    this.map.addEventListener("region-change-start", () => { moving = true; tick(); });
    this.map.addEventListener("region-change-end", () => { moving = false; onMove(); });
  }

  /// Frames `points` (layout units; the real stations by default).
  show(net, points = net.stations.map((s) => s.geo)) {
    this.net = net;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const p of points) {
      const { lat, lon } = net.toLatLon(p);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    }
    const span = new mapkit.CoordinateSpan((maxLat - minLat) * 1.15, (maxLon - minLon) * 1.15);
    const centre = new mapkit.Coordinate((minLat + maxLat) / 2, (minLon + maxLon) / 2);
    this.map.setRegionAnimated(new mapkit.CoordinateRegion(centre, span), false);
  }

  /// Layout point → canvas point (the canvas covers the map exactly).
  projector(canvas) {
    const box = canvas.getBoundingClientRect();
    const pageX = box.left + window.scrollX, pageY = box.top + window.scrollY;
    return (p) => {
      const { lat, lon } = this.net.toLatLon(p);
      const point = this.map.convertCoordinateToPointOnPage(new mapkit.Coordinate(lat, lon));
      return { x: point.x - pageX, y: point.y - pageY };
    };
  }

  /// Fades the streets out as the map becomes schematic.
  fade(t) {
    this.element.style.opacity = String(Math.max(0, 1 - t * 1.4));
  }
}
