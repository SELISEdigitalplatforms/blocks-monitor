import { Navigate, type RouteObject, Outlet } from "react-router-dom";
import HealthPage from "./dashboard/health";
import HealthIncidentsPage from "./dashboard/health-incidents";
import HealthMonitorPage from "./dashboard/health-monitor";
// import ProfilePage from "./dashboard/profile";
import {
  AuthResolver,
  PublicGuard,
  ProtectedGuard,
  ConsoleLayout,
  ImpersonationChecker,
  ImpersonationTerminator,
  ImpersonationSynchronizer,
  CallbackPage,
  ConsolePage,
  LoginPage,
} from "@seliseblocks/blocks-kit";
import DashboardLayout from "@/layouts/dashboard-layout/dashboard-layout";
import { DashboardOverview } from "@/pages/dashboard-overview";
import { EnvironmentsPage } from "@/pages/environments";
import { ErrorBoundary } from "@/components/error-boundary";
import { ProfileRedirect } from "./dashboard/profile-redirect";

export const routes = [
  {
    element: (
      <ErrorBoundary>
        <Outlet />,
      </ErrorBoundary>
    ),
    children: [
      // All Redirect Url Handle here
      {
        path: "/login/callback",
        element: <CallbackPage redirectUrl="/console" />,
      },
      {
        // Set User Auth Information and resolve authentication state before rendering any route
        element: (
          <AuthResolver>
            <Outlet />
          </AuthResolver>
        ),
        children: [
          // public
          {
            element: (
              <PublicGuard>
                <Outlet />
              </PublicGuard>
            ),
            children: [
              { path: "/login", element: <LoginPage name="blocks-monitor" /> },
            ],
          },

          // protected
          {
            element: (
              <ProtectedGuard>
                <Outlet />
              </ProtectedGuard>
            ),
            children: [
              {
                element: (
                  <ImpersonationChecker>
                    <ImpersonationTerminator>
                      <ConsoleLayout>
                        <Outlet />
                      </ConsoleLayout>
                    </ImpersonationTerminator>
                  </ImpersonationChecker>
                ),
                children: [
                  { path: "/profile", element: <ProfileRedirect /> },
                  { path: "/console", element: <ConsolePage /> },
                ],
              },
              {
                path: "/project-overview",
                element: <DashboardLayout />,
                children: [
                  {
                    path: "environments",
                    element: <EnvironmentsPage />,
                  },
                ],
              },
              {
                // impersonate
                element: (
                  <ImpersonationChecker>
                    <ImpersonationSynchronizer>
                      <DashboardLayout />
                    </ImpersonationSynchronizer>
                  </ImpersonationChecker>
                ),
                children: [
                  { path: "/dashboard", element: <DashboardOverview /> },
                  { path: "/health", element: <HealthPage /> },
                  {
                    path: "/health/monitor/:id",
                    element: <HealthMonitorPage />,
                  },
                  {
                    path: "/health/monitor/incidents/:id",
                    element: <HealthIncidentsPage />,
                  },
                ],
              },
            ],
          },
          { path: "/", element: <Navigate to="/console" replace /> },
          { path: "*", element: <Navigate to="/login" replace /> },
        ],
      },
    ],
  },
] as const satisfies RouteObject[];
