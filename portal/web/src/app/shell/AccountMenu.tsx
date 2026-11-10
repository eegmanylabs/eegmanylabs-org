import { LogOut, UserRound } from "lucide-react";
import { useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";

/** Shows who is signed in and holds the actions that concern the account itself. */
export function AccountMenu() {
  const user = useSignedInUser();
  const { signOut } = useAuth();
  const toast = useToast();
  const name = user.displayName ?? user.email ?? "Your account";

  const handleSignOut = () => {
    signOut().catch(() => {
      toast.show({ tone: "error", title: "You are still signed in.", description: "Signing out failed. Try again." });
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Account: ${name}`} className="max-w-64">
          <UserRound aria-hidden="true" strokeWidth={1.8} />
          <span className="hidden truncate sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          Signed in as
          <span className="block truncate text-sm text-fg">{user.email ?? name}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut aria-hidden="true" strokeWidth={1.8} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
