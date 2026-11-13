// Builds the Content-Security-Policy for the <meta http-equiv> element.
//
// GitHub Pages cannot set response headers, so a meta element is the only way to deliver the
// policy. A policy delivered this way cannot carry frame-ancestors, report-uri, report-to or
// sandbox: browsers ignore them there. Framing is therefore handled by public/frame-guard.js.
import type { PortalBuildConfig } from "./types.ts";

export function buildContentSecurityPolicy(config: PortalBuildConfig): string {
  const connect = ["'self'"];
  const script = ["'self'"];
  const frame: string[] = [];
  const image = ["'self'", "data:", "blob:"];

  if (config.emulators) {
    const { host, auth, firestore, functions, storage } = config.emulators;
    for (const port of [auth, firestore, functions, storage]) connect.push(`http://${host}:${port}`);
    // The emulator's stand-in for the Google sign-in helper frame.
    if (config.googleSignIn) frame.push(`http://${host}:${auth}`);
  } else {
    connect.push(
      "https://identitytoolkit.googleapis.com", // Authentication
      "https://securetoken.googleapis.com", // refresh of the sign-in token
      "https://firestore.googleapis.com", // Firestore
      `https://${config.functionsRegion}-${config.firebase.projectId}.cloudfunctions.net`, // callable functions
      "https://firebasestorage.googleapis.com", // Cloud Storage
    );
    image.push("https://firebasestorage.googleapis.com");
    // Firestore loads this one image after a failed request to tell "the network is down" from
    // "the server is down". Without it every connectivity blip is a policy violation.
    image.push("https://www.google.com/images/cleardot.gif");
  }

  if (config.appCheck) {
    // App Check with reCAPTCHA Enterprise: Google's script and its frame, and the exchange of
    // the attestation for an App Check token.
    script.push("https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/");
    frame.push("https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/");
    connect.push("https://content-firebaseappcheck.googleapis.com", "https://www.google.com/recaptcha/");
  }

  if (config.googleSignIn) {
    // signInWithPopup loads Google's helper script and talks to a hidden frame on the
    // authentication domain. The pop-up itself is a top-level window and is not governed here.
    script.push("https://apis.google.com");
    if (!config.emulators && config.firebase.authDomain) frame.push(`https://${config.firebase.authDomain}`);
  }

  const directives: [string, string[]][] = [
    ["default-src", ["'none'"]],
    ["script-src", script],
    // Radix adds one <style> element at run time (the scroll lock of dialogs and menus), so
    // inline styles are allowed. Inline scripts are not.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", image],
    ["font-src", ["'self'"]],
    ["connect-src", connect],
    ["frame-src", frame.length > 0 ? frame : ["'none'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  if (!config.emulators) directives.push(["upgrade-insecure-requests", []]);
  return directives.map(([name, values]) => [name, ...values].join(" ")).join("; ");
}
