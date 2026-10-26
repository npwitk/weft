#!/usr/bin/env node
// Makes a MapKit JS token (an ES256-signed JWT) for js/config.js.
//
//   node scripts/mapkit-token.mjs <AuthKey_XXXX.p8> <KEY_ID> <TEAM_ID> [origin] [days]
//
// In the Apple Developer site: create a Maps ID, then a key with MapKit JS
// enabled, and download its .p8. Keep the .p8 private; the token can be
// public because `origin` limits where it works (default the local server).

import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const [keyFile, keyID, teamID, origin = "http://localhost:8765", days = "30"] = process.argv.slice(2);
if (!keyFile || !keyID || !teamID) {
  console.error("usage: node scripts/mapkit-token.mjs <AuthKey.p8> <KEY_ID> <TEAM_ID> [origin] [days]");
  process.exit(2);
}
const now = Math.floor(Date.now() / 1000);
const b64 = (object) => Buffer.from(JSON.stringify(object)).toString("base64url");
const header = b64({ alg: "ES256", kid: keyID, typ: "JWT" });
const payload = b64({ iss: teamID, iat: now, exp: now + Number(days) * 86_400, origin });
const key = createPrivateKey(readFileSync(keyFile));
const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
console.log(`${header}.${payload}.${signature}`);
