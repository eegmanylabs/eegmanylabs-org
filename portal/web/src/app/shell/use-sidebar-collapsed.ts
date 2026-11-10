import { useCallback, useState } from "react";
import { readStored, writeStored } from "@/utils/storage";

const STORAGE_KEY = "portal.sidebar.collapsed";

/** Whether the sidebar is collapsed to its icon rail. Remembered in this browser. */
export function useSidebarCollapsed(): readonly [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => readStored(STORAGE_KEY) === "true");
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      writeStored(STORAGE_KEY, String(!current));
      return !current;
    });
  }, []);
  return [collapsed, toggle];
}
