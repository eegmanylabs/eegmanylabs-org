import type { AuthContextValue } from "@/auth/AuthProvider";

/**
 * The value a test gives `useAuth` in place of the real provider: any part of the context,
 * open to change between tests.
 */
export type AuthStub = { -readonly [Key in keyof AuthContextValue]?: AuthContextValue[Key] };
