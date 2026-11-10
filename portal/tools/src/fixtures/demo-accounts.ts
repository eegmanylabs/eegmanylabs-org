// SYNTHETIC DATA. Nobody listed here exists.
//
// These accounts are written by `seed:demo` to the Local Emulator Suite so that the portal has
// something to show during development. The names are invented and the addresses use the
// example.org domain, which is reserved for documentation and can never receive mail.

export interface DemoAccount {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { uid: "demo-account-one", email: "demo.one@example.org", displayName: "Demo Account One" },
  { uid: "demo-account-two", email: "demo.two@example.org", displayName: "Demo Account Two" },
];
