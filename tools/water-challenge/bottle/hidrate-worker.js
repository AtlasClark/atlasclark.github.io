/* Hidrate relay for the Atlas Water Challenge: a Cloudflare Worker (rev 1.0).

   Why: Hidrate's API only accepts its app key in the X-Parse-Client-Key header, and
   its server tells browsers not to send that header (CORS). The challenge page asks
   this Worker instead; the Worker adds the header and passes Hidrate's answer back.

   Safe by design:
   - Answers only the challenge page's origin, and only callers with the relay key.
   - Forwards only login, today's sips and the session check, and only to Hidrate.
   - Hidrate's app id and client key live in the Worker's encrypted secrets, not here.
   - Stores and logs nothing.

   Set up (Cloudflare dashboard, free plan):
   1. Workers & Pages > Create > "Start with Hello World!". Name it (e.g. hidrate-relay) > Deploy.
   2. Edit code (the </> button): replace all of the sample code with this file > Deploy.
   3. Settings > Variables and Secrets > Add, type Secret, three times:
        HIDRATE_APP_ID      Hidrate's app id     (HIDRATE_APP_ID in the R55 HTA)
        HIDRATE_CLIENT_KEY  Hidrate's client key (HIDRATE_CLIENT_KEY in the R55 HTA)
        RELAY_KEY           the relay key the challenge page made for you
   4. Copy the Worker's address (https://<name>.<you>.workers.dev) into the page:
      Settings > Bottle sync > Relay address, then Test. */

const UPSTREAM = "https://www.hidrateapp.com/parse";
const ORIGINS = ["https://atlasclark.github.io", "http://localhost:5517", "http://127.0.0.1:5517"];
const PATHS = { "/parse/login": "POST", "/parse/classes/Sip": "GET", "/parse/users/me": "GET" };

/* Same time whatever the input, so the relay key can't be guessed a letter at a time. */
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!ORIGINS.includes(origin)) return new Response('{"error":"origin not allowed"}', { status: 403, headers: { "Content-Type": "application/json" } });
    const cors = {
      "Access-Control-Allow-Origin": origin, "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Relay-Key, X-Parse-Session-Token, X-Parse-Revocable-Session",
      "Access-Control-Max-Age": "600"
    };
    const reply = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body),
                                                 { status, headers: Object.assign({ "Content-Type": "application/json" }, cors) });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const ready = !!(env.HIDRATE_APP_ID && env.HIDRATE_CLIENT_KEY && env.RELAY_KEY);
    if (url.pathname === "/ping") {
      return reply(200, { ok: true, relay: "1.0", configured: ready, keyOk: sameKey(request.headers.get("X-Relay-Key") || "", env.RELAY_KEY) });
    }
    if (!ready) return reply(500, { error: "the relay is missing its secrets (see the set-up notes)" });
    if (!sameKey(request.headers.get("X-Relay-Key") || "", env.RELAY_KEY)) return reply(401, { error: "relay key wrong or missing" });
    if (PATHS[url.pathname] !== request.method) return reply(404, { error: "not relayed" });

    const headers = { "X-Parse-Application-Id": env.HIDRATE_APP_ID, "X-Parse-Client-Key": env.HIDRATE_CLIENT_KEY };
    const token = request.headers.get("X-Parse-Session-Token");
    if (token) headers["X-Parse-Session-Token"] = token;
    if (request.headers.get("X-Parse-Revocable-Session")) headers["X-Parse-Revocable-Session"] = "1";
    const init = { method: request.method, headers };
    if (request.method === "POST") { headers["Content-Type"] = "application/json"; init.body = await request.text(); }
    let up;
    try { up = await fetch(UPSTREAM + url.pathname.slice("/parse".length) + url.search, init); }
    catch (e) { return reply(502, { error: "Hidrate did not answer: " + (e && e.message || e) }); }
    return reply(up.status, await up.text());
  }
};
