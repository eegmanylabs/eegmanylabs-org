// What the signed-in account may do on a page, decided as the security rules decide it
// (`pageLevelFor` of the shared package). It decides what the page offers, never what is allowed.
import { atLeast, type PageAccessLevel, type PageLevel, pageLevelFor } from "@eegml/shared";
import { useAuth } from "@/auth/AuthProvider";
import type { RecordOf } from "@/data";

export function usePageLevel(page: RecordOf<"pages"> | null): PageAccessLevel {
  const { session, access } = useAuth();
  if (page === null || session.status !== "signed-in" || access.status !== "ready" || access.data === null) {
    return "none";
  }
  return pageLevelFor(access.data, { secondFactorVerified: session.user.secondFactor }, page);
}

export const holds = (level: PageAccessLevel, wanted: PageLevel): boolean => atLeast(level, wanted);
