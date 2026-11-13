// Keeps the portal out of frames on other sites, and off plain HTTP.
//
// GitHub Pages cannot send a frame-ancestors policy or an X-Frame-Options header, so a page on
// another site could otherwise show the portal inside a frame and trick a signed-in member into
// clicking something. This script runs before anything else: when the page is framed it asks
// the browser to show the portal in the whole window instead, and marks the document so that
// the application does not start inside the frame (see src/main.tsx).
//
// Pages cannot send an HSTS header for a custom domain either. Its "Enforce HTTPS" setting
// redirects plain requests, and this script repeats that redirect for any address other than
// this machine, so that a page reached over HTTP never signs anybody in (docs/SECURITY.md,
// section 8). The policy's upgrade-insecure-requests covers what the page itself loads.
//
// It is a file of its own because the Content-Security-Policy forbids inline scripts.
(() => {
  // This machine, where the preview server and the emulators run without TLS.
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(window.location.hostname);
  if (window.location.protocol === "http:" && !local) {
    document.documentElement.setAttribute("data-framed", "true");
    window.location.replace(
      `https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    return;
  }
  if (window.top === window.self) return;
  document.documentElement.setAttribute("data-framed", "true");
  try {
    window.top.location.replace(window.self.location.href);
  } catch (_error) {
    // The browser refused the navigation. The page stays empty inside the frame.
  }
})();
