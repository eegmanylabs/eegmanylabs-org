import { Outlet } from "react-router";
import { AuthProvider } from "@/auth/AuthProvider";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentTitle } from "./route-meta";

/** The outermost route: everything every page needs, signed in or not. */
export function Root({ signInLink }: { signInLink: string | null }) {
  useDocumentTitle();
  return (
    <TooltipProvider>
      <ToastProvider>
        <AuthProvider signInLink={signInLink}>
          <Outlet />
        </AuthProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}
