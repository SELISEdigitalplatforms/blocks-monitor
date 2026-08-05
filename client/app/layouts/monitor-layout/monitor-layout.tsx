import { Outlet } from "react-router";

export function MonitorLayout() {
  return (
    <main className="p-6">
      <Outlet />
    </main>
  );
}
