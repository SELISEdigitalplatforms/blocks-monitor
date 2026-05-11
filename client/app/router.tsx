import { createBrowserRouter, Navigate } from "react-router-dom";

import { DashboardLayout } from "./layouts/dashboard-layout";
import { OidcLayout } from "./layouts/oidc-layout";

// Auth routes (public, with auth layout)
import LoginSimplePage from "./routes/auth/login-simple";

// Public routes (with public guard only)

// OIDC routes (un-guarded)
import OidcIndexPage from "./routes/oidc/index";

// Dashboard routes (protected)
import HealthPage from "./routes/dashboard/health";
import HealthIncidentsPage from "./routes/dashboard/health-incidents";
import HealthMonitorPage from "./routes/dashboard/health-monitor";
import ProfilePage from "./routes/dashboard/profile";

// Console pages

export const router = createBrowserRouter([
  // ── Simple login (no guards, no API calls) ──
  { path: "/login", element: <LoginSimplePage /> },

  // ── OIDC layout (un-guarded, themed) ──
  {
    path: "/oidc",
    element: <OidcLayout />,
    children: [{ index: true, element: <OidcIndexPage /> }],
  },

  // ── Dashboard layout (protected routes) ──
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

  // ── Root redirect: authenticated users go to health ──
  { path: "/", element: <Navigate to="/health" replace /> },

  // ── Catch-all: redirect to login ──
  { path: "*", element: <Navigate to="/login" replace /> },
]);
