import { Navigate, type RouteObject } from "react-router-dom";
import DashboardLayout from "@/layouts/dashboard-layout/dashboard-layout";
import LoginPage from "./auth/login";
import CallbackPage from "./callback";
import HealthPage from "./dashboard/health";
import HealthIncidentsPage from "./dashboard/health-incidents";
import HealthMonitorPage from "./dashboard/health-monitor";
import ProfilePage from "./dashboard/profile";

export const routes = [
  {
    path: "/login",
    children: [
      { index: true, element: <LoginPage /> },
      { path: "callback", element: <CallbackPage /> },
    ],
  },
  {
    element: <DashboardLayout />,
    children: [
      { path: "/health", element: <HealthPage /> },
      { path: "/health/monitor/:id", element: <HealthMonitorPage /> },
      {
        path: "/health/monitor/incidents/:id",
        element: <HealthIncidentsPage />,
      },
      { path: "/profile", element: <ProfilePage /> },
    ],
  },
  { path: "/", element: <Navigate to="/health" replace /> },
  { path: "*", element: <Navigate to="/login" replace /> },
] as const satisfies RouteObject[];
