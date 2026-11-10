// The two containers of an Excel workbook: the ZIP archive and the XML parts inside it.
//
// A workbook export is read here part by part and nothing is interpreted. The archive reader
// uses the central directory, as the ZIP format intends, and inflates with Node's own zlib. The
// XML reader builds a plain tree with saxes, a strict parser that keeps every character of text
// as it is written, so a value with leading or trailing white space arrives unchanged.
import { inflateRawSync } from "node:zlib";
import { SaxesParser } from "saxes";

/** Raised when a file is not a workbook this reader can open. The message never quotes cell content. */
export class WorkbookFormatError extends Error {
  override readonly name = "WorkbookFormatError";
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** The members of a ZIP archive by name, each inflated. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last thing in the file, before an optional comment of up to 65,535 bytes.
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 0xffff); offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new WorkbookFormatError("The file is not a ZIP archive, so it is no Excel workbook.");
  const entryCount = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (entryCount === 0xffff || offset === 0xffffffff) {
    throw new WorkbookFormatError("The archive uses the ZIP64 format, which this reader does not open.");
  }
  const members = new Map<string, Uint8Array>();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new WorkbookFormatError("The directory of the archive is damaged.");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new WorkbookFormatError("A member of the archive is damaged.");
    }
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === STORED) members.set(name, data);
    else if (method === DEFLATED) members.set(name, inflateRawSync(data));
    else throw new WorkbookFormatError(`A member of the archive uses compression method ${method}, which is not supported.`);
  }
  return members;
}

/** One element of an XML part. Names are local names: a namespace prefix is left out. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  /** The text directly inside the element, exactly as written. */
  text: string;
}

const localName = (name: string): string => name.slice(name.indexOf(":") + 1);

/** Parses one XML part into a tree. Throws `WorkbookFormatError` when the part is not well formed. */
export function parseXml(bytes: Uint8Array): XmlElement {
  const root: XmlElement = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  const parser = new SaxesParser();
  let failure: Error | null = null;
  parser.on("error", (error) => {
    failure ??= error;
  });
  parser.on("opentag", (tag) => {
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(tag.attributes)) attributes[localName(name)] = value;
    const element: XmlElement = { name: localName(tag.name), attributes, children: [], text: "" };
    stack.at(-1)?.children.push(element);
    stack.push(element);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  const append = (text: string) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close();
  const document = root.children[0];
  if (failure !== null || document === undefined) throw new WorkbookFormatError("A part of the workbook is not well-formed XML.");
  return document;
}

/** The first child of an element with a name, or undefined. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((candidate) => candidate.name === name);
}

/** Every child of an element with a name. */
export function childrenOf(element: XmlElement | undefined, name: string): XmlElement[] {
  return element?.children.filter((candidate) => candidate.name === name) ?? [];
}
