// The fake of OSF reproduces what the design relies on. Every resource is synthetic.
import { describe, expect, it } from "vitest";
import { FAKE_OSF, memoryOsfFake } from "./fake";
import { OsfError } from "./types";

async function failure(promise: Promise<unknown>): Promise<OsfError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OsfError) return error;
    throw error;
  }
  throw new Error("The read was expected to fail.");
}

describe("the OSF fake", () => {
  it("answers a public resource with what the portal keeps of it", async () => {
    const fake = memoryOsfFake();
    expect(await fake.adapter().resource(FAKE_OSF.stage1Registration)).toMatchObject({
      kind: "registration",
      withdrawn: false,
    });
    expect(fake.reads()).toEqual([FAKE_OSF.stage1Registration]);
  });

  it("refuses what is not public, what is gone and everything during an outage", async () => {
    const fake = memoryOsfFake();
    expect((await failure(fake.adapter().resource(FAKE_OSF.privateProject))).kind).toBe("restricted");
    expect((await failure(fake.adapter().resource("zzzzz"))).kind).toBe("notFound");
    fake.setMode("down");
    expect((await failure(fake.adapter().resource(FAKE_OSF.project))).kind).toBe("unavailable");
    expect(fake.reads()).toHaveLength(3);
  });

  it("limits the rate for a number of requests, asking to wait, and then answers again", async () => {
    const fake = memoryOsfFake();
    fake.limitRate(2, 3);
    const first = await failure(fake.adapter().resource(FAKE_OSF.project));
    expect(first).toMatchObject({ kind: "rateLimited", retryAfterSeconds: 3, httpStatus: 429 });
    await failure(fake.adapter().resource(FAKE_OSF.project));
    expect((await fake.adapter().resource(FAKE_OSF.project)).id).toBe(FAKE_OSF.project);
  });

  it("follows what an owner does: making a resource private, withdrawing and deleting", async () => {
    const fake = memoryOsfFake();
    fake.setPublic(FAKE_OSF.project, false);
    expect((await failure(fake.adapter().resource(FAKE_OSF.project))).kind).toBe("restricted");
    fake.withdraw(FAKE_OSF.stage1Registration);
    expect((await fake.adapter().resource(FAKE_OSF.stage1Registration)).withdrawn).toBe(true);
    fake.remove(FAKE_OSF.preprint);
    expect((await failure(fake.adapter().resource(FAKE_OSF.preprint))).kind).toBe("notFound");
  });
});
