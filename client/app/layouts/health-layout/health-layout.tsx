import { Outlet } from "react-router-dom";

export function HealthLayout() {
  return (
    <main className="p-6">
      <Outlet />
    </main>
  );
}
