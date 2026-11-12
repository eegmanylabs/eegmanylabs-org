// The addresses of Drive items that a member pastes. The identifiers are synthetic.
import { describe, expect, it } from "vitest";
import { driveIdOf, linkKindOfAddress } from "./support";

describe("an address of Drive", () => {
  it("names its item, and its kind by its shape where Drive has not described it", () => {
    expect(driveIdOf("https://docs.google.com/document/d/fake-private-protocol/edit")).toBe("fake-private-protocol");
    expect(linkKindOfAddress("https://docs.google.com/document/d/fake-private-protocol/edit")).toBe("googleDoc");
    expect(linkKindOfAddress("https://docs.google.com/spreadsheets/d/fake-sheet/edit")).toBe("googleSheet");
    expect(linkKindOfAddress("https://drive.google.com/drive/u/0/folders/fake-folder")).toBe("driveFolder");
    expect(linkKindOfAddress("https://drive.google.com/file/d/fake-file/view")).toBe("url");
  });
});
