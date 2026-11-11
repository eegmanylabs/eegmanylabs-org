// The text of portal/firestore.rules, compared with the collection registry and the schemas.
// These tests need no emulator: they read the rules file as text. They fail when a collection
// has rules that its registry entry does not call for, when an entry that is enforced has none,
// when a list of fields in the rules drifts from its schema, and when an allow statement does
// not start by asking whether the account may act at all.
import {
  APPEND_ONLY_BASE_FIELDS,
  AUTO_ID_PATTERN,
  COLLECTION_ENTRIES,
  type CollectionEntry,
  clientImmutableFields,
  creditRoleKeySchema,
  DOCUMENT_BASE_FIELDS,
  ENTITY_TYPES,
  notificationTypeSchema,
  PAGE_FILE_MAX_BYTES,
  PROGRAMME_POWER_SCOPE_KEYS,
  SPECIAL_CATEGORY_FIELDS,
  SPECIAL_CATEGORY_NAME_PARTS,
  verbatimSourceFields,
  type Writer,
} from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { LIVE_QUERY_MAX_LIMIT } from "../../web/src/data/query-spec";
import { grantedOperations, isListable, isReadAcrossParents } from "../rules/policy";
import { allowStatements, declaredLists, type MatchBlock, matchBlocks, shapeOfPath } from "../rules/rules-source";
import { fieldSetsOf } from "../rules/schema-fields";
import { readRulesFile } from "../rules/support";

const source = readRulesFile("firestore.rules");
const blocks = matchBlocks(source);
const lists = declaredLists(source);

const CATCH_ALL = "/{**}";
const READ_METHODS = ["read", "get", "list"];
const enforced = COLLECTION_ENTRIES.filter((entry) => entry.enforcement === "enforced");
const isReadable = (entry: CollectionEntry) => !entry.read.tiers.every((tier) => tier === "FUNCTION");
const shapeOfEntry = (entry: CollectionEntry) => shapeOfPath(`/${entry.path}`);

/** The entries whose documents a block matches: one by its path, or every subcollection of a name. */
function entriesOf(block: MatchBlock): CollectionEntry[] {
  if (block.shape.startsWith("/{**}/")) {
    const collectionId = block.shape.split("/")[2];
    return COLLECTION_ENTRIES.filter((entry) => entry.parent !== null && entry.collectionId === collectionId);
  }
  return COLLECTION_ENTRIES.filter((entry) => shapeOfEntry(entry) === block.shape);
}

const blocksOf = (entry: CollectionEntry) => blocks.filter((block) => entriesOf(block).includes(entry));
const methodsOf = (entry: CollectionEntry) =>
  new Set(blocksOf(entry).flatMap((block) => block.statements.flatMap((statement) => statement.methods)));

const sorted = (values: Iterable<string>) => [...values].sort();
const capitalised = (writer: Writer) =>
  writer.replace(/(?:^|_)([a-z])/g, (_match, letter: string) => letter.toUpperCase());

describe("the reader of the rules file", () => {
  it("finds the blocks, with the path of a nested block joined to its parents", () => {
    const paths = blocks.map((block) => block.path);
    expect(paths).toContain("/persons/{personId}/private/contact");
    expect(paths).toContain("/users/{uid}/settings/preferences");
    expect(paths).toContain("/{path=**}/memberships/{membershipId}");
    expect(paths).toContain("/{document=**}");
    expect(allowStatements(source).length).toBe(blocks.reduce((count, block) => count + block.statements.length, 0));
  });

  it("is not misled by an allow statement or a brace inside a comment or a string", () => {
    const sample = [
      "service cloud.firestore { match /databases/{database}/documents {",
      "  // allow read: if true; match /hidden/{id} {",
      "  match /a/{id} { allow get: if v.matches('^.{1,3}$') && isActive();",
      "    match /b/{other} { allow create, update: if isMember(); } }",
      "} }",
    ].join("\n");
    expect(
      matchBlocks(sample).map((block) => [block.path, block.statements.map((statement) => statement.methods)]),
    ).toEqual([
      ["/a/{id}/b/{other}", [["create", "update"]]],
      ["/a/{id}", [["get"]]],
    ]);
  });
});

describe("the match blocks of firestore.rules", () => {
  it("each match documents of one enforced registry entry, apart from the block that closes everything else", () => {
    const strays: string[] = [];
    for (const block of blocks) {
      if (block.shape === CATCH_ALL) continue;
      const entries = entriesOf(block);
      if (entries.length !== 1) strays.push(`${block.path}: matches ${entries.length} entries`);
      for (const entry of entries) {
        if (entry.enforcement !== "enforced") strays.push(`${block.path}: ${entry.key} is not enforced yet`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("close every other path with one statement that allows nothing", () => {
    const closing = blocks.filter((block) => block.shape === CATCH_ALL);
    expect(
      closing.map((block) => block.statements.map((statement) => [statement.methods, statement.condition])),
    ).toEqual([[[["read", "write"], "false"]]]);
    const elsewhere = allowStatements(source).filter((statement) => statement.methods.includes("write"));
    expect(elsewhere).toHaveLength(1);
  });

  it("read a subcollection across its parents only where its name belongs to one entry of the whole registry", () => {
    for (const block of blocks.filter((candidate) => candidate.shape.startsWith("/{**}/"))) {
      const collectionId = block.shape.split("/")[2];
      const sharing = COLLECTION_ENTRIES.filter((entry) => entry.collectionId === collectionId);
      expect(
        sharing.map((entry) => entry.key),
        block.path,
      ).toHaveLength(1);
      expect(
        block.statements.map((statement) => statement.methods),
        block.path,
      ).toEqual([["read"]]);
    }
  });

  it("allow the methods that the registry opens, entry by entry, and no others", () => {
    const disagreements: string[] = [];
    for (const entry of enforced) {
      const methods = methodsOf(entry);
      const reads = READ_METHODS.filter((method) => methods.has(method));
      // A fixed-name document is read by its path alone, and so is a document whose identifier
      // is the uid of its owner. Everything else is read as a document and as part of a list.
      const byPathAlone = !isListable(entry) || (entry.parent === null && entry.read.scopeFields.join() === "{uid}");
      const expectedReads = !isReadable(entry) ? [] : byPathAlone ? ["get"] : ["read"];
      const readsAsExpected = sorted(reads).join() === expectedReads.join();
      if (!readsAsExpected) disagreements.push(`${entry.key}: reads through ${reads.join(", ") || "nothing"}`);
      const writes = sorted([...methods].filter((method) => !READ_METHODS.includes(method)));
      const granted = sorted(grantedOperations(entry));
      if (writes.join() !== granted.join()) {
        disagreements.push(
          `${entry.key}: the rules allow ${writes.join(", ") || "no write"}, the registry ${granted.join(", ") || "none"}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("read a subcollection across its parents exactly where the registry opens it to members, scopes or administrators", () => {
    const disagreements = enforced.flatMap((entry) => {
      const acrossParents = blocksOf(entry).some(
        (block) =>
          block.shape.startsWith("/{**}/") && block.statements.some((statement) => statement.methods.includes("read")),
      );
      return acrossParents === (isReadAcrossParents(entry) && isReadable(entry)) ? [] : [entry.key];
    });
    expect(disagreements).toEqual([]);
  });

  it("state above every block the most documents its rules read, within the limit of ten", () => {
    const lines = source.split("\n");
    const unstated: string[] = [];
    lines.forEach((line, index) => {
      const path = /^\s*match\s+(\/\S*)\s*\{/.exec(line)?.[1];
      if (path === undefined || path === "/databases/{database}/documents") return;
      const comment: string[] = [];
      for (let above = index - 1; above >= 0 && (lines[above] ?? "").trim().startsWith("//"); above -= 1) {
        comment.push(lines[above] ?? "");
      }
      const count = /Reads: (\d+)/.exec(comment.join("\n"))?.[1];
      if (count === undefined || Number(count) > 10) unstated.push(`line ${index + 1}: ${path}`);
    });
    expect(unstated).toEqual([]);
  });

  it("start every allow statement by asking whether the account may act", () => {
    const ungated = allowStatements(source)
      .filter((statement) => statement.condition !== "false")
      .filter((statement) => !/^(?:isActive\(\)|isMember\(\)|isOwner\(\w+\))\s*(?:&&|$)/.test(statement.condition))
      .map((statement) => `line ${statement.line}`);
    expect(ungated).toEqual([]);
  });

  it("let nobody but the owner past a gate that does not ask for membership", () => {
    // isActive() and isOwner() admit an account that is no member yet, which the claim flow
    // needs. A write never starts with either, and a read that does names the owner.
    const loose = allowStatements(source).filter((statement) =>
      /^(?:isActive\(\)|isOwner\()/.test(statement.condition),
    );
    for (const statement of loose) {
      expect(
        statement.methods.every((method) => READ_METHODS.includes(method)),
        `line ${statement.line}`,
      ).toBe(true);
      expect(statement.condition, `line ${statement.line}`).toMatch(/^isOwner\(uid\)|request\.auth\.uid/);
    }
  });
});

describe("the lists of fields in firestore.rules", () => {
  const clientWritten = enforced.filter((entry) => entry.write.mode === "client");

  it("name, for each entry a client writes, the fields of its schema", () => {
    const disagreements: string[] = [];
    const compare = (name: string, expected: readonly string[]) => {
      const declared = lists.get(name);
      if (declared === undefined) disagreements.push(`${name} is missing`);
      else if (sorted(declared).join() !== sorted(expected).join()) {
        disagreements.push(`${name}: [${sorted(declared)}] in the rules, [${sorted(expected)}] in the schema`);
      }
    };
    for (const entry of clientWritten) {
      if (entry.write.mode !== "client") continue;
      const fields = fieldSetsOf(entry);
      const immutable = clientImmutableFields(entry);
      const { grants } = entry.write;
      for (const grant of grants) {
        if (grant.onlyFields !== null) {
          const [first] = grant.writers;
          if (first !== undefined) compare(`${entry.key}EditableBy${capitalised(first)}`, grant.onlyFields);
          continue;
        }
        if (grant.operations.includes("create")) compare(`${entry.key}Fields`, fields.settable);
        if (grant.operations.includes("update")) {
          compare(
            `${entry.key}Editable`,
            fields.settable.filter((field) => !immutable.includes(field)),
          );
        }
      }
      // A grant that only deletes writes no field, and asks for no list.
      const writesFields = (grant: (typeof grants)[number]) =>
        grant.operations.includes("create") || (grant.onlyFields === null && grant.operations.includes("update"));
      if (grants.some(writesFields)) {
        compare(`${entry.key}Required`, fields.required);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("check every field that a client may change, by its name, in the block of its entry", () => {
    // A field that an update may change and that no expression of the block names is a field
    // whose type, cap and enumeration nobody checks. The lists themselves do not count.
    const listDeclaration = /function\s+\w+\(\)\s*\{\s*return\s*\[[^\]]*\];\s*\}/g;
    const unchecked: string[] = [];
    for (const entry of clientWritten) {
      const own = blocks.filter((block) => block.shape === shapeOfEntry(entry));
      const body = own.map((block) => block.body.replace(listDeclaration, "")).join("\n");
      const editable = [...lists.entries()]
        .filter(([name]) => new RegExp(`^${entry.key}Editable(?:By\\w+)?$`).test(name))
        .flatMap(([, fields]) => fields);
      for (const field of new Set(editable)) {
        if (field === "archivedAt") continue;
        if (!new RegExp(`'${field}'|\\.${field}\\b`).test(body)) unchecked.push(`${entry.key}.${field}`);
      }
    }
    expect(unchecked).toEqual([]);
  });

  it("name no entry that a client does not write", () => {
    const keys = new Set(clientWritten.map((entry) => entry.key));
    const strays = [...lists.keys()].filter((name) => {
      const match = /^(\w+?)(?:Fields|Required|Editable(?:By\w+)?)$/.exec(name);
      return (
        match !== null &&
        !keys.has(match[1] ?? "") &&
        !["standard", "appendOnly", "touch", "stamp", "specialCategory"].includes(match[1] ?? "")
      );
    });
    expect(strays).toEqual([]);
  });

  it("name, for each entry whose documents an import may have written, the verbatim source values that a client may otherwise change", () => {
    const disagreements: string[] = [];
    for (const entry of clientWritten) {
      if (entry.write.mode !== "client") continue;
      const updatesFreely = entry.write.grants.some(
        (grant) => grant.onlyFields === null && grant.operations.includes("update"),
      );
      const expected = updatesFreely ? verbatimSourceFields(entry) : [];
      const name = `${entry.key}Verbatim`;
      const declared = lists.get(name);
      if (expected.length === 0) {
        if (declared !== undefined) disagreements.push(`${name} is declared, and the schema has no such field`);
        continue;
      }
      if (declared === undefined) disagreements.push(`${name} is missing`);
      else if (sorted(declared).join() !== sorted(expected).join()) {
        disagreements.push(`${name}: [${sorted(declared)}] in the rules, [${sorted(expected)}] in the schema`);
      }
      // The list is no use unless the update of the entry asks for it.
      if (!source.includes(`sourceValuesKept(${name}())`)) disagreements.push(`${name} is never applied`);
    }
    expect(disagreements).toEqual([]);
  });

  it("accept, where the data model calls an identifier opaque, only an identifier that Firestore generated", () => {
    // The rules spell the shape once, and it is the shape of the shared package.
    expect(source).toContain(`return id.matches('${AUTO_ID_PATTERN.source}');`);
    const disagreements: string[] = [];
    for (const entry of clientWritten) {
      const creates = blocksOf(entry).flatMap((block) =>
        block.statements.filter((statement) => statement.methods.includes("create")),
      );
      for (const statement of creates) {
        const asks = /\bautoId\(\w+\)/.test(statement.condition);
        if (asks !== (entry.identifier.kind === "auto")) {
          disagreements.push(
            `${entry.key}: line ${statement.line} ${asks ? "asks for" : "does not ask for"} an identifier that Firestore generated`,
          );
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("repeat the enumerations and the standard fields of the shared package exactly", () => {
    expect(lists.get("entityTypes")).toEqual([...ENTITY_TYPES]);
    expect(lists.get("specialCategoryFields")).toEqual([...SPECIAL_CATEGORY_FIELDS]);
    expect(source).toContain(`!field.lower().matches('.*(${SPECIAL_CATEGORY_NAME_PARTS.join("|")}).*')`);
    expect(lists.get("programmeScopeKeys")).toEqual([...PROGRAMME_POWER_SCOPE_KEYS]);
    expect(lists.get("creditRoleKeys")).toEqual([...creditRoleKeySchema.options]);
    expect(lists.get("notificationTypes")).toEqual([...notificationTypeSchema.options]);
    expect(lists.get("standardFields")).toEqual([...DOCUMENT_BASE_FIELDS]);
    expect(lists.get("appendOnlyFields")).toEqual([...APPEND_ONLY_BASE_FIELDS]);
    expect(lists.get("touchFields")).toEqual(["updatedAt", "updatedBy", "writeContext"]);
    expect(lists.get("stampFields")).toEqual(["updatedAt", "updatedBy", "writeContext", "archivedAt"]);
  });

  it("bound a list at the most documents a live query of the web application asks for", () => {
    expect(source).toContain(`request.query.limit <= ${LIVE_QUERY_MAX_LIMIT};`);
  });
});

describe("portal/storage.rules", () => {
  const storage = readRulesFile("storage.rules");

  it("lets a client read and add the files of a page alone, and denies everything else with one statement", () => {
    const statements = allowStatements(storage);
    expect(statements.map((statement) => statement.methods)).toEqual([["get"], ["create"], ["read", "write"]]);
    expect(statements.at(-1)?.condition).toBe("false");
    for (const statement of statements.slice(0, -1)) expect(statement.condition).toMatch(/^isMember\(\)\s*&&/);
    expect(matchBlocks(storage).map((block) => block.path)).toEqual([
      "/b/{bucket}/o/pages/{pageId}/files/{fileId}/{fileName}",
      "/b/{bucket}/o/{allPaths=**}",
    ]);
  });

  it("never lets an upload replace a file, and holds an upload to the size limit of the shared package", () => {
    const create = allowStatements(storage).find((statement) => statement.methods.includes("create"));
    expect(create?.condition).toContain("resource == null");
    expect(create?.condition).toContain(
      `request.resource.size <= ${PAGE_FILE_MAX_BYTES / (1024 * 1024)} * 1024 * 1024`,
    );
  });
});
