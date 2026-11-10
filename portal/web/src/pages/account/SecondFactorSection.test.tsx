// The management of the second factor, tested against a fake of the multi-factor API: the
// Authentication emulator implements no one-time passwords. Addresses are synthetic and use
// the example.org domain.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrolledFactor, SecondFactorApi, TotpEnrolment } from "@/data";
import type { AuthStub } from "@/test-support/auth-stub";
import { renderWithProviders } from "@/test-support/render";

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
      "requires-recent-login":
        "For your security this needs a recent sign-in. Sign out, sign in again and try once more.",
      unavailable: "The sign-in service did not accept this.",
      network: "The portal could not reach the sign-in service.",
      unknown: "Something went wrong with the second factor. Try again.",
    },
    SUPPORTED_FACTOR_IDS: ["totp"],
    normaliseCode: (code: string, length = 6) => {
      const digits = code.replace(/\s+/g, "");
      return new RegExp(`^\\d{${length}}$`).test(digits) ? digits : null;
    },
    secondFactor: { listFactors: () => [] },
  };
});
vi.mock("@/data", () => data);

const auth = vi.hoisted(() => ({ value: {} as AuthStub }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => auth.value }));

const { SecondFactorSection, groupedSecret } = await import("./SecondFactorSection");

const factor: EnrolledFactor = {
  uid: "factor-1",
  displayName: "Work phone",
  factorId: "totp",
  enrolledAt: "2026-11-01T10:00:00.000Z",
};

function fakeApi(factors: EnrolledFactor[] = []) {
  const state = { factors: [...factors] };
  const enrolment: TotpEnrolment & { complete: ReturnType<typeof vi.fn> } = {
    secretKey: "JBSWY3DPEHPK3PXPJBSWY3DP",
    otpauthUrl:
      "otpauth://totp/EEGManyLabs%20portal:member%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=EEGManyLabs%20portal",
    codeLength: 6,
    complete: vi.fn(async (_code: string, displayName: string) => {
      state.factors.push({ uid: "factor-new", displayName, factorId: "totp", enrolledAt: null });
    }),
  };
  const api: SecondFactorApi & {
    startTotpEnrolment: ReturnType<typeof vi.fn>;
    removeFactor: ReturnType<typeof vi.fn>;
  } = {
    listFactors: () => state.factors,
    startTotpEnrolment: vi.fn(async () => enrolment),
    removeFactor: vi.fn(async (uid: string) => {
      state.factors = state.factors.filter((candidate) => candidate.uid !== uid);
    }),
  };
  return { api, enrolment };
}

beforeEach(() => {
  auth.value = { retryRegistration: vi.fn() };
});

describe("SecondFactorSection", () => {
  it("enrols an authenticator app: the secret as a QR code and as text, then a code", async () => {
    const user = userEvent.setup();
    const { api, enrolment } = fakeApi();
    renderWithProviders(<SecondFactorSection accountName="member@example.org" required api={api} />);
    expect(screen.getByText("No second factor yet")).toBeTruthy();
    expect(screen.getByText("Required for your role")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add an authenticator app" }));
    expect(api.startTotpEnrolment).toHaveBeenCalledExactlyOnceWith("member@example.org");
    expect(screen.getByRole("img", { name: /QR code/ })).toBeTruthy();
    expect(screen.getByTestId("totp-secret").textContent).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP");

    // A code of the wrong form is refused here, without a call.
    await user.type(screen.getByLabelText("Code from the app"), "12345");
    await user.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    expect(screen.getByText("Enter the 6 digits your authenticator app shows.")).toBeTruthy();
    expect(enrolment.complete).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Code from the app"));
    await user.type(screen.getByLabelText("Code from the app"), "123 456");
    await user.clear(screen.getByLabelText("Name for this device"));
    await user.type(screen.getByLabelText("Name for this device"), "Phone");
    await user.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    expect(enrolment.complete).toHaveBeenCalledExactlyOnceWith("123456", "Phone");
    // The server is told, so that the access document and the rules see the factor.
    expect(auth.value.retryRegistration).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Your second factors" }).textContent).toContain("Phone"),
    );
  });

  it("keeps the enrolment open and says why when the code does not match", async () => {
    const user = userEvent.setup();
    const { api, enrolment } = fakeApi();
    enrolment.complete.mockRejectedValueOnce(new data.SecondFactorError("invalid-code"));
    renderWithProviders(<SecondFactorSection accountName="member@example.org" required={false} api={api} />);
    await user.click(screen.getByRole("button", { name: "Add an authenticator app" }));
    await user.type(screen.getByLabelText("Code from the app"), "000000");
    await user.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    expect(await screen.findByText(/That code did not match/)).toBeTruthy();
    expect(screen.getByLabelText("Code from the app")).toBeTruthy();
    expect(auth.value.retryRegistration).not.toHaveBeenCalled();
  });

  it("says, in an emulator build, that the emulator cannot enrol an app, instead of asking to try again", async () => {
    const user = userEvent.setup();
    const { api } = fakeApi();
    api.startTotpEnrolment.mockRejectedValueOnce(new data.SecondFactorError("unknown"));
    renderWithProviders(<SecondFactorSection accountName="member@example.org" required={false} api={api} />);
    await user.click(screen.getByRole("button", { name: "Add an authenticator app" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("cannot enrol an authenticator app");
    expect(alert.textContent).not.toContain("Try again");
  });

  it("says what to do when the enrolment needs a recent sign-in", async () => {
    const user = userEvent.setup();
    const { api } = fakeApi();
    api.startTotpEnrolment.mockRejectedValueOnce(new data.SecondFactorError("requires-recent-login"));
    renderWithProviders(<SecondFactorSection accountName="member@example.org" required={false} api={api} />);
    await user.click(screen.getByRole("button", { name: "Add an authenticator app" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Sign out, sign in again");
  });

  it("lists the enrolled factors and removes one after a confirmation that warns about the role", async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([factor]);
    renderWithProviders(<SecondFactorSection accountName="member@example.org" required api={api} />);
    expect(screen.getByRole("list", { name: "Your second factors" }).textContent).toContain("Work phone");

    await user.click(screen.getByRole("button", { name: "Remove Work phone" }));
    const dialog = screen.getByRole("dialog", { name: "Remove this second factor?" });
    expect(dialog.textContent).toContain("Your administrative powers stop working");
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(api.removeFactor).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove Work phone" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(api.removeFactor).toHaveBeenCalledExactlyOnceWith("factor-1");
    expect(await screen.findByText("No second factor yet")).toBeTruthy();
  });
});

describe("groupedSecret", () => {
  it("groups a secret in fours for typing", () => {
    expect(groupedSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(groupedSecret("ABCD")).toBe("ABCD");
  });
});
