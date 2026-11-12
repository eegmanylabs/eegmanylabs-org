// The rules of the dataset registry (docs/DATA_MODEL.md, section 10), beside the registry-driven
// matrix: every member reads the registry document of a dataset, the workflow of a replication
// and the description of a storage server; the copies, transfers and quality assessments are read
// within the dataset's scope; the listings, the BIDS report and the record of reads only by the
// leads of the replication, the laboratory's coordinators, programme administrators and the core
// team; the location of a copy, the connection of a server and the viewer links by no client; and
// no client writes any of it, because callable functions do.
// Fixtures are synthetic: fictitious accounts, studies, servers and files on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { limit, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { EVERYONE, forEach, storedPath } from "./redteam/exfiltration-and-escalation-support";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld } from "./seed";
import { createRulesEnvironment } from "./support";
import { OTHER_LABORATORY, OTHER_REPLICATION, OWN_LABORATORY, OWN_REPLICATION, stored } from "./world";

let environment: RulesTestEnvironment;
const { get, listAcrossParents, update, remove, createAt } = requestsOf(() => environment);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-datasets");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

describe("the dataset registry", () => {
  it("opens the registry document, the workflow and the description of a server to every member, and to no one else", async () => {
    for (const key of ["datasets", "datasetWorkflows", "storageEndpoints"] as const) {
      await expectOutcomes({
        [`a member reads ${key}`]: ["allowed", get("member", storedPath(key))],
        [`a member of another laboratory reads ${key}`]: ["allowed", get("otherLabMember", storedPath(key))],
        [`a signed-out caller reads ${key}`]: ["denied", get("signedOut", storedPath(key))],
        [`an account without membership reads ${key}`]: ["denied", get("noMembership", storedPath(key))],
        [`a suspended account reads ${key}`]: ["denied", get("suspended", storedPath(key))],
      });
    }
  });

  it("reads copies, transfers and assessments within the dataset's scope only", async () => {
    for (const [key, collection] of [
      ["datasetStorageRefs", "storageRefs"],
      ["datasetTransfers", "transfers"],
      ["datasetQcAssessments", "qcAssessments"],
    ] as const) {
      await expectOutcomes({
        [`the laboratory's member reads ${key}`]: ["allowed", get("ownLabMember", storedPath(key))],
        [`the replication's team reads ${key}`]: ["allowed", get("ownTeam", storedPath(key))],
        [`a member of another laboratory reads ${key}`]: ["denied", get("otherLabMember", storedPath(key))],
        [`another replication's lead reads ${key}`]: ["denied", get("otherLead", storedPath(key))],
        [`a member reads ${key}`]: ["denied", get("member", storedPath(key))],
        [`the laboratory's member lists ${collection} of the laboratory`]: [
          "allowed",
          listAcrossParents("ownLabMember", collection, where("laboratoryId", "==", OWN_LABORATORY), limit(50)),
        ],
        [`the laboratory's member lists ${collection} of another laboratory`]: [
          "denied",
          listAcrossParents("ownLabMember", collection, where("laboratoryId", "==", OTHER_LABORATORY), limit(50)),
        ],
        [`a lead lists ${collection} of another replication`]: [
          "denied",
          listAcrossParents("ownLead", collection, where("replicationId", "==", OTHER_REPLICATION), limit(50)),
        ],
      });
    }
  });

  it("keeps listings, the BIDS report and the record of reads to the leads, the coordinators and the programme", async () => {
    for (const key of [
      "datasetDetail",
      "datasetManifests",
      "datasetManifestFileChunks",
      "datasetAccessEvents",
    ] as const) {
      await expectOutcomes({
        [`the lead reads ${key}`]: ["allowed", get("ownLead", storedPath(key))],
        [`the coordinator reads ${key}`]: ["allowed", get("ownCoordinator", storedPath(key))],
        [`the core team reads ${key}`]: ["allowed", get("coreTeam", storedPath(key))],
        [`an administrator reads ${key}`]: ["allowed", get("admin", storedPath(key))],
        [`an administrator without the factor reads ${key}`]: ["denied", get("adminWithoutFactor", storedPath(key))],
        [`the laboratory's member reads ${key}`]: ["denied", get("ownLabMember", storedPath(key))],
        [`the replication's team reads ${key}`]: ["denied", get("ownTeam", storedPath(key))],
        [`another laboratory's coordinator reads ${key}`]: ["denied", get("otherCoordinator", storedPath(key))],
        [`another replication's lead reads ${key}`]: ["denied", get("otherLead", storedPath(key))],
      });
    }
    await expectOutcomes({
      "the lead lists the listings of the replication": [
        "allowed",
        listAcrossParents("ownLead", "manifests", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "the lead lists the record of reads of the replication": [
        "allowed",
        listAcrossParents("ownLead", "accessEvents", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "the laboratory's member lists the listings of the laboratory": [
        "denied",
        listAcrossParents("ownLabMember", "manifests", where("laboratoryId", "==", OWN_LABORATORY), limit(50)),
      ],
      "a lead lists the listings above the limit": [
        "denied",
        listAcrossParents("ownLead", "manifests", where("replicationId", "==", OWN_REPLICATION), limit(1_001)),
      ],
    });
  });

  it("keeps locations, connections and viewer links from every client", async () => {
    for (const key of ["storageEndpointConnection", "datasetStorageRefLocation", "datasetViewerLinks"] as const) {
      await expectOutcomes(forEach(EVERYONE, "denied", `reads ${key}`, (caller) => get(caller, storedPath(key))));
    }
  });

  it("lets no client write any of it, an administrator included", async () => {
    for (const key of [
      "storageEndpoints",
      "datasets",
      "datasetWorkflows",
      "datasetStorageRefs",
      "datasetTransfers",
      "datasetQcAssessments",
      "datasetManifests",
    ] as const) {
      await expectOutcomes({
        [`an administrator changes ${key}`]: ["denied", update("admin", storedPath(key), { schemaVersion: 1 })],
        [`the lead changes ${key}`]: ["denied", update("ownLead", storedPath(key), { schemaVersion: 1 })],
        [`an administrator deletes ${key}`]: ["denied", remove("admin", storedPath(key))],
        [`the lead writes over ${key}`]: ["denied", createAt("ownLead", storedPath(key), stored())],
      });
    }
  });
});
