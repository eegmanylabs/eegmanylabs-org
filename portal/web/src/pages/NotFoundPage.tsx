import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-reading content-center gap-4 p-6">
      <h1 className="text-2xl text-fg">Page not found</h1>
      <p className="text-fg-secondary">
        There is no page at this address. It may have moved, or the address may have been mistyped.
      </p>
      <div>
        <Button asChild variant="primary">
          <Link to="/">Go to Home</Link>
        </Button>
      </div>
    </main>
  );
}
