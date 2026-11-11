// Helpers of the browser tests of the registry of replications and members. They use the
// synthetic world of `seed:demo` (tools/src/fixtures/), whose people are invented and whose
// addresses use the example.org domain.
import { COLLECTIONS, roleAssignmentId } from "@eegml/shared";
import type { Browser, Page } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "../support/admin";
import { personInAnotherBrowser } from "./identity-support";
import { expect, signIn } from "./support";

/** Ivy Pretend, a member of a laboratory and of the team of DemoGamma2010, through the account that claimed her. */
export const IVY = { email: "demo.one@example.org", personId: "demo-person-ivy", name: "Ivy Pretend" } as const;

/** Ben Sample, the confirmed lead of DemoAlpha2001, who claims his profile when he first signs in. */
export const BEN = { email: "ben.sample@example.org", personId: "demo-person-ben", name: "Ben Sample" } as const;

export const ALPHA = "DemoAlpha2001";

/** Signs Ivy in and waits until the directory is offered. */
export async function signInAsIvy(page: Page): Promise<void> {
  await signIn(page, IVY.email);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Replications" }),
  ).toBeVisible();
}

/**
 * Makes the replication lead role of an account active, as an administrator's approval would,
 * and waits until its access document lists the replication. Ben's role starts as awaiting
 * approval when his claim links him (decision D-005).
 */
export async function approveLeadRole(email: string, studyKey: string): Promise<string> {
  const { uid } = await adminAuth.getUserByEmail(email);
  const reference = adminDb.doc(
    COLLECTIONS.roleAssignments.docPath(roleAssignmentId(uid, "replication_lead", "replication", studyKey)),
  );
  await expect.poll(async () => (await reference.get()).exists, { message: "the proposed lead role" }).toBe(true);
  if ((await reference.get()).get("status") !== "active") {
    const now = Timestamp.now();
    await reference.update({
      status: "active",
      grantedBy: "system:e2e",
      grantedAt: now,
      updatedAt: now,
      updatedBy: "system:e2e",
    });
  }
  await expect
    .poll(
      async () =>
        ((await adminDb.doc(COLLECTIONS.access.docPath(uid)).get()).get("leadReplicationIds") as
          | string[]
          | undefined) ?? [],
      {
        timeout: 30_000,
        message: "the access document of the lead",
      },
    )
    .toContain(studyKey);
  return uid;
}

/** Ben, signed in in a browser of his own, as the approved lead of DemoAlpha2001. */
export async function leadBrowser(browser: Browser, baseURL: string) {
  const lead = await personInAnotherBrowser(browser, baseURL, BEN.email);
  const uid = await approveLeadRole(BEN.email, ALPHA);
  return { ...lead, uid };
}

/** The row of a record table with the given accessible name. */
export const rowNamed = (page: Page, name: string | RegExp) => page.getByRole("row", { name });
