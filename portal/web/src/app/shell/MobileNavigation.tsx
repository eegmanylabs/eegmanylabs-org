import { Menu } from "lucide-react";
import { useState } from "react";
import logo from "@/assets/logo.png";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { SidebarNav } from "./SidebarNav";
import { SidebarShortcuts } from "./SidebarShortcuts";
import { SidebarWorkspace } from "./SidebarWorkspace";

/**
 * Navigation for narrow screens: a button in the top bar that opens the destinations in a
 * panel over the page. Focus is held inside the panel while it is open.
 */
export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton label="Open navigation" className="md:hidden">
          <Menu aria-hidden="true" strokeWidth={1.8} />
        </IconButton>
      </DialogTrigger>
      <DialogContent title="Navigation" hideTitle placement="left" className="bg-surface-muted">
        <img src={logo} alt="EEGManyLabs" width={1600} height={355} className="-mt-8 mb-5 ml-2 h-7 w-auto" />
        <SidebarNav onNavigate={() => setOpen(false)} />
        <SidebarWorkspace onNavigate={() => setOpen(false)} />
        <SidebarShortcuts onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
