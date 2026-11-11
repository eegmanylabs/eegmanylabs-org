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
  /** Whether the "Continue with Google" button is built in. */
  readonly googleSignIn: boolean;
  /** How a page shows who else has it open. */
  readonly presence: PresenceMode;
}
