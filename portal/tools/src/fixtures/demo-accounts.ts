// SYNTHETIC DATA. Nobody listed here exists.
//
// These accounts are written by `seed:demo` to the Local Emulator Suite so that the portal has
// something to show during development. The names are invented and the addresses use the
// example.org domain, which is reserved for documentation and can never receive mail.

export interface DemoAccount {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  /** The person of the demonstration world that the account has claimed already, or null. */
  readonly personId: string | null;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  // A member who has claimed a profile: the person "Ivy Pretend" of the demonstration world.
  {
    uid: "demo-account-one",
    email: "demo.one@example.org",
    displayName: "Demo Account One",
    personId: "demo-person-ivy",
  },
  // An account whose address matches nobody, so it has to ask for access.
  { uid: "demo-account-two", email: "demo.two@example.org", displayName: "Demo Account Two", personId: null },
];
