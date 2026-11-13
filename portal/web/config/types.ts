// The shape of the configuration compiled into the web bundle. Kept free of imports so that
// both the build scripts (Node) and the application (browser) can use it.

export const PORTAL_MODES = ["emulator", "staging", "production"] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

/**
 * How a page shows who else has it open (D-010): "cursor" sends the caret of each editor, as
 * the editor spike recommends; "presence" sends only who is there; "off" sends nothing.
 */
export const PRESENCE_MODES = ["cursor", "presence", "off"] as const;
export type PresenceMode = (typeof PRESENCE_MODES)[number];

/**
 * Whether notification email is sent, from ops/environments.mjs. The programme decided on 13
 * November 2026 that none is sent for now, so a staging or production build offers no email
 * preferences and says nothing about email being sent. The emulator build keeps them, against a
 * fake outbox that delivers nothing, so that the browser tests still exercise them.
 */
export const MAIL_DELIVERY_MODES = ["disabled", "enabled"] as const;
export type MailDelivery = (typeof MAIL_DELIVERY_MODES)[number];

export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly projectId: string;
  readonly appId: string;
  readonly authDomain?: string;
  readonly storageBucket?: string;
  readonly messagingSenderId?: string;
}

export interface EmulatorAddresses {
  readonly host: string;
  readonly auth: number;
  readonly firestore: number;
  readonly functions: number;
  readonly storage: number;
}

export interface PortalBuildConfig {
  readonly mode: PortalMode;
  readonly firebase: FirebaseWebConfig;
  /** Present only in emulator mode. */
  readonly emulators: EmulatorAddresses | null;
  readonly functionsRegion: string;
  /**
   * App Check with reCAPTCHA Enterprise: the public site key, which a production build must
   * carry. Absent in emulator mode, where App Check has no emulator.
   */
  readonly appCheck: { readonly siteKey: string } | null;
  /** Whether the "Continue with Google" button is built in. */
  readonly googleSignIn: boolean;
  /** How a page shows who else has it open. */
  readonly presence: PresenceMode;
  /** Whether the account page offers email preferences. */
  readonly mailDelivery: MailDelivery;
}
