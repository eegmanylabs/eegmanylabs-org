// Preloaded into the firebase command only when a proxy variable is set (see fb.sh).
//
// firebase-tools sends every request through undici's ProxyAgent when HTTPS_PROXY is set and
// does not honour NO_PROXY. Its control calls to the local emulators (rules reload, trigger
// registration) therefore go to the outbound proxy and fail. This shim sends loopback
// destinations direct, which is what NO_PROXY already asks for, and leaves the proxy in place
// for every other host. It never disables the proxy and never touches TLS verification.
const path = require("node:path");

const toolsDirectory = path.dirname(
  require.resolve("firebase-tools/package.json", { paths: [path.join(__dirname, "..")] }),
);
// Resolve undici exactly as firebase-tools does, so the patched class is the one it uses.
const undici = require(require.resolve("undici", { paths: [toolsDirectory] }));

const direct = new undici.Agent();
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const viaProxy = undici.ProxyAgent.prototype.dispatch;

/**
 * @param {{ origin?: unknown }} options
 * @param {unknown} handler
 */
undici.ProxyAgent.prototype.dispatch = function dispatch(options, handler) {
  let host = "";
  try {
    host = new URL(String(options.origin)).hostname;
  } catch {
    // Not a parsable origin: leave the request on the proxy path.
  }
  if (LOOPBACK.has(host)) return direct.dispatch(options, handler);
  return viaProxy.call(this, options, handler);
};
