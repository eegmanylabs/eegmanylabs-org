// Helpers of the browser tests of laboratories, participations and the imports console. They use
// the synthetic world of `seed:demo` (tools/src/fixtures/), whose people are invented and whose
// addresses use the example.org domain.
import { COLLECTIONS, type Role, type RoleScopeType, roleAssignmentId } from "@eegml/shared";
import type { Browser } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "../support/admin";
import { personInAnotherBrowser } from "./identity-support";
import { expect } from "./support";

/** Cleo Placeholder, the confirmed coordinator of the memory laboratory. */
export const CLEO = {
  email: "cleo.placeholder@example.org",
  personId: "demo-person-cleo",
  name: "Cleo Placeholder",
} as const;

/**
 * Dev Fictional, the principal investigator of the signal laboratory, who is on the team of no
 * replication: a member of another laboratory than the cognition laboratory.
 */
export const DEV = { email: "dev.fictional@example.org", personId: "demo-person-dev", name: "Dev Fictional" } as const;

export const MEMORY_LAB = { id: "demo-lab-memory", name: "Demo Memory Laboratory" } as const;
export const COGNITION_LAB = { id: "demo-lab-cognition", name: "Demo Cognition Laboratory" } as const;

/**
 * Makes a role of an account active, as an administrator's approval would, and waits until the
 * access document says so. A management role starts as awaiting approval when a claim links
 * the account (decision D-005).
 */
export async function approveRole(
  email: string,
  role: Role,
  scopeType: RoleScopeType,
  scopeId: string,
): Promise<string> {
  const { uid } = await adminAuth.getUserByEmail(email);
  const reference = adminDb.doc(COLLECTIONS.roleAssignments.docPath(roleAssignmentId(uid, role, scopeType, scopeId)));
  await expect.poll(async () => (await reference.get()).exists, { message: `the proposed role ${role}` }).toBe(true);
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
  const field =
    role === "lab_coordinator"
      ? "coordinatorLaboratoryIds"
      : role === "lab_member"
        ? "memberLaboratoryIds"
        : "leadReplicationIds";
  await expect
    .poll(
      async () => ((await adminDb.doc(COLLECTIONS.access.docPath(uid)).get()).get(field) as string[] | undefined) ?? [],
      {
        timeout: 30_000,
        message: `the access document after ${role} became active`,
      },
    )
    .toContain(scopeId);
  return uid;
}

/**
 * A member signed in in a browser of their own, once the first sign-in has linked the account:
 * the claim page sends a linked account on to Home, which would otherwise overtake a page the
 * test opens meanwhile.
 */
export async function linkedBrowser(browser: Browser, baseURL: string, email: string) {
  const member = await personInAnotherBrowser(browser, baseURL, email);
  await expect(
    member.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Replications" }),
  ).toBeVisible();
  await expect(member.page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  return member;
}

/** Cleo, signed in in a browser of her own, as the approved coordinator of the memory laboratory. */
export async function coordinatorBrowser(browser: Browser, baseURL: string) {
  const coordinator = await linkedBrowser(browser, baseURL, CLEO.email);
  const uid = await approveRole(CLEO.email, "lab_coordinator", "laboratory", MEMORY_LAB.id);
  return { ...coordinator, uid };
}
