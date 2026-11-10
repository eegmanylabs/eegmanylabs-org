import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/page-header";
import { HOME_PANELS } from "./panels";

export function HomePage() {
  const { capabilities } = useAuth();
  const panels = HOME_PANELS.filter((panel) => capabilities.has(panel.requires)).sort((a, b) => a.order - b.order);
  return (
    <>
      <PageHeader title="Home" />
      <div className="grid max-w-reading gap-4">
        {panels.map((panel) => (
          <panel.Component key={panel.id} />
        ))}
      </div>
    </>
  );
}
