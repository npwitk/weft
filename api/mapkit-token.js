// Vercel function: a short-lived MapKit JS token for this site, signed with
// your MapKit key, so the private key never reaches the browser.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   MAPKIT_TEAM_ID       your Apple Developer team ID
//   MAPKIT_KEY_ID        the key's ID (the XXXX in AuthKey_XXXX.p8)
//   MAPKIT_PRIVATE_KEY   the .p8 file's contents, BEGIN/END lines included
//   MAPKIT_ORIGINS       optional, comma-separated extra origins allowed
//                        (e.g. a custom domain); the deployment's own
//                        address is always allowed

import { createPrivateKey, sign } from "node:crypto";

const LIFETIME = 30 * 60; // seconds; MapKit asks again when it expires

export default function handler(req, res) {
  const { MAPKIT_TEAM_ID, MAPKIT_KEY_ID, MAPKIT_PRIVATE_KEY, MAPKIT_ORIGINS = "" } = process.env;
  res.setHeader("Cache-Control", "no-store");
  if (!MAPKIT_TEAM_ID || !MAPKIT_KEY_ID || !MAPKIT_PRIVATE_KEY) {
    res.status(404).send("Apple Maps isn't set up on this deployment.");
    return;
  }
  // Only sign for this site (and any origins you list), never for whoever asks.
  const own = `https://${req.headers.host}`;
  const allowed = [own, ...MAPKIT_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)];
  const asked = req.headers.origin || own;
  if (!allowed.includes(asked)) {
    res.status(403).send("Not for this origin.");
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "ES256", kid: MAPKIT_KEY_ID, typ: "JWT" });
  const payload = b64({ iss: MAPKIT_TEAM_ID, iat: now, exp: now + LIFETIME, origin: asked });
  const key = createPrivateKey(MAPKIT_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  res.status(200).send(`${header}.${payload}.${signature.toString("base64url")}`);
}
