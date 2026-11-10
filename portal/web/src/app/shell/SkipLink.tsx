export const MAIN_CONTENT_ID = "main-content";

/** The first stop for keyboard users: jumps over the navigation to the page content. */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      // The address uses the fragment for routes, so move focus directly instead of following it.
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(MAIN_CONTENT_ID)?.focus();
      }}
      className="fixed top-3 left-3 z-50 -translate-y-[200%] rounded-control bg-accent-strong px-3.5 py-2.5 font-bold text-fg-on-accent focus:translate-y-0"
    >
      Skip to content
    </a>
  );
}
