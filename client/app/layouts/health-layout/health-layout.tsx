import { Button } from "@/components/ui-kits/button/button";
import { getRuntimeEnv } from "@seliseblocks/blocks-kit";
import { Outlet } from "react-router-dom";

export function HealthLayout() {
  return (
    <main className="p-6 space-y-6">
      <HealthHeader />
      <Outlet />
    </main>
  );
}

const HealthHeader = () => {
  return (
    <div className="flex items-center justify-end">
      <a
        href={getRuntimeEnv("BLOCKS_MONITOR_BASE_URL") + "/swagger/index.html"}
        target="_blank"
        rel="noopener noreferrer">
        <Button variant="outline">API Docs</Button>
      </a>
    </div>
  );
};
