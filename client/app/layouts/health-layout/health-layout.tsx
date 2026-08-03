import { Outlet } from "react-router";

export function HealthLayout() {
  return (
    <main className="p-6">
      <Outlet />
    </main>
  );
}
