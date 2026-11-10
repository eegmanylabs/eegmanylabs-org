import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import "./styles/app.css";
import { createPortalRouter } from "@/app/router";
import { captureSignInLink } from "@/auth/pending-sign-in";
import { liveListenerCount } from "@/data";

declare global {
  interface Window {
    /** Present in emulator builds only, for the end-to-end tests. */
    __portalTest?: { liveListenerCount: () => number };
  }
}

// public/frame-guard.js marks the document when it is shown inside a frame on another site.
// The application does not start there.
if (!document.documentElement.hasAttribute("data-framed")) {
  // Take the single-use code out of the address before the router reads the address.
  const signInLink = captureSignInLink();
  const router = createPortalRouter(signInLink);

  // Vite replaces the mode's name when it builds, so staging and production do not contain this.
  if (import.meta.env.MODE === "emulator") window.__portalTest = { liveListenerCount };

  const root = document.getElementById("root");
  if (!root) throw new Error("index.html has no #root element.");
  // The static notice of index.html has done its job once the application starts.
  document.getElementById("boot-status")?.remove();
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
