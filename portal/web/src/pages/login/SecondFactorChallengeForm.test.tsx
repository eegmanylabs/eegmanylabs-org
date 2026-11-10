// The second step of signing in, tested with a fake challenge: the Authentication emulator
// implements no one-time passwords.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SecondFactorChallenge } from "@/data";
import type { AuthStub } from "@/test-support/auth-stub";

const data = vi.hoisted(() => {
  class SecondFactorError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return {
    SecondFactorError,
    SECOND_FACTOR_MESSAGES: {
      "invalid-code": "That code did not match. Enter the code your authenticator app shows now.",
      expired: "This took too long and has to start again.",
      unknown: "Something went wrong with the second factor. Try again.",
    },
    SUPPORTED_FACTOR_IDS: ["totp"],
    normaliseCode: (code: string) => (/^\d{6}$/.test(code.replace(/\s+/g, "")) ? code.replace(/\s+/g, "") : null),
  };
});
vi.mock("@/data", () => data);

const auth = vi.hoisted(() => ({ value: {} as AuthStub }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => auth.value }));

const { SecondFactorChallengeForm } = await import("./SecondFactorChallengeForm");

const challenge = (factorIds: string[]): SecondFactorChallenge => ({
  factors: factorIds.map((factorId, index) => ({
    uid: `factor-${index}`,
    displayName: `Device ${index}`,
    factorId,
    enrolledAt: null,
  })),
  answer: vi.fn(),
});

beforeEach(() => {
  auth.value = { answerSecondFactor: vi.fn().mockResolvedValue(undefined), abandonLink: vi.fn() };
});

describe("SecondFactorChallengeForm", () => {
  it("answers the challenge with the code, and takes focus so that a keyboard user can type at once", async () => {
    const user = userEvent.setup();
    render(<SecondFactorChallengeForm challenge={challenge(["totp"])} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Code from your authenticator app"));
    await user.keyboard("654321{Enter}");
    expect(auth.value.answerSecondFactor).toHaveBeenCalledExactlyOnceWith("factor-0", "654321");
  });

  it("refuses a code of the wrong form, and says why a refused code failed", async () => {
    const user = userEvent.setup();
    vi.mocked(auth.value.answerSecondFactor as (uid: string, code: string) => Promise<void>).mockRejectedValueOnce(
      new data.SecondFactorError("invalid-code"),
    );
    render(<SecondFactorChallengeForm challenge={challenge(["totp"])} />);
    await user.keyboard("12{Enter}");
    expect(screen.getByText("Enter the 6 digits your authenticator app shows.")).toBeTruthy();
    expect(auth.value.answerSecondFactor).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Code from your authenticator app"));
    await user.keyboard("000000{Enter}");
    expect(await screen.findByText(/That code did not match/)).toBeTruthy();
  });

  it("lets the member choose between apps, and answers with the one chosen", async () => {
    const user = userEvent.setup();
    render(<SecondFactorChallengeForm challenge={challenge(["totp", "totp"])} />);
    await user.click(screen.getByLabelText("Device 1"));
    await user.type(screen.getByLabelText("Code from your authenticator app"), "111111");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(auth.value.answerSecondFactor).toHaveBeenCalledExactlyOnceWith("factor-1", "111111");
  });

  it("explains that a text-message factor cannot be used, and offers a way back", async () => {
    const user = userEvent.setup();
    render(<SecondFactorChallengeForm challenge={challenge(["phone"])} />);
    expect(screen.getByRole("alert").textContent).toContain("authenticator app only");
    expect(screen.queryByLabelText("Code from your authenticator app")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Use a different address" }));
    expect(auth.value.abandonLink).toHaveBeenCalledOnce();
  });
});
