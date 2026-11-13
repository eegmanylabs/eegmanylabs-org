// Hands the reader a file that the page made, such as an export, without a request to any host:
// the content becomes a local object address that the browser saves under the given name.

/** Saves text as a file of the given type in the reader's browser. */
export function downloadText(fileName: string, content: string, type: string): void {
  save(fileName, new Blob([content], { type }));
}

/** Saves bytes as a file of the given type in the reader's browser, such as a workbook. */
export function downloadBytes(fileName: string, content: Uint8Array, type: string): void {
  save(fileName, new Blob([content.slice().buffer], { type }));
}

function save(fileName: string, blob: Blob): void {
  const address = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = address;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The browser has taken the file once the click has been handled.
  setTimeout(() => URL.revokeObjectURL(address), 0);
}
