import { encode } from "uqr";

/**
 * A QR code drawn in the page from the text it carries. It is generated in the browser, so the
 * secret it holds never leaves the device. Its modules take the text colour, on a white square
 * with the quiet zone the standard asks for.
 */
export function TotpQrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 4 });
  const modules: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) modules.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-tile border border-border bg-surface text-fg"
    >
      <path d={modules.join("")} fill="currentColor" />
    </svg>
  );
}
