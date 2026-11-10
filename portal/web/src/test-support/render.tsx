import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Renders inside the providers that the application always has around its pages. */
export function renderWithProviders(element: ReactElement): RenderResult {
  return render(
    <TooltipProvider>
      <ToastProvider>{element}</ToastProvider>
    </TooltipProvider>,
  );
}
