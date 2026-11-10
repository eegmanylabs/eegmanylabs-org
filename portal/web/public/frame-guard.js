// Keeps the portal out of frames on other sites.
//
// GitHub Pages cannot send a frame-ancestors policy or an X-Frame-Options header, so a page on
// another site could otherwise show the portal inside a frame and trick a signed-in member into
// clicking something. This script runs before anything else: when the page is framed it asks
// the browser to show the portal in the whole window instead, and marks the document so that
// the application does not start inside the frame (see src/main.tsx).
//
// It is a file of its own because the Content-Security-Policy forbids inline scripts.
(() => {
  if (window.top === window.self) return;
  document.documentElement.setAttribute("data-framed", "true");
  try {
    window.top.location.replace(window.self.location.href);
  } catch (_error) {
    // The browser refused the navigation. The page stays empty inside the frame.
  }
})();
