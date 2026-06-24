import { navigationMenus } from "@/constants/navigation-menus.constant";
import {
  AuthResolver,
  CallbackPage,
  ConsoleLayout,
  ConsolePage,
  DashboardLayout,
  DashboardOverview,
  EnvironmentsPage,
  LoginPage,
  ProfilePage,
  ProjectOverviewLayout,
  ProtectedGuard,
  PublicGuard,
} from "@seliseblocks/blocks-kit";
import { Navigate, Outlet, type RouteObject } from "react-router-dom";
import HealthPage from "./dashboard/health";
import HealthIncidentsPage from "./dashboard/health-incidents";
import HealthMonitorPage from "./dashboard/health-monitor";
import { HealthLayout } from "@/layouts/health-layout/health-layout";

const redirectPaths: Record<string, string> = {
  "/app/health/monitor/*": "/app/health",
  "/app/health/monitor/incidents/*": "/app/health",
};

export const routes = [
  {
    element: <Outlet />,
    children: [
      // All Redirect Url Handle here
      {
        path: "/login/callback",
        element: <CallbackPage defaultRedirectUrl="/app/console" />,
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
            children: [{ path: "/login", element: <LoginPage /> }],
          },

          // protected
          {
            path: "/app",
            element: (
              <ProtectedGuard>
                <Outlet />
              </ProtectedGuard>
            ),
            children: [
              {
                element: (
                  <ConsoleLayout>
                    <Outlet />
                  </ConsoleLayout>
                ),
                children: [
                  { path: "profile", element: <ProfilePage /> },
                  { path: "console", element: <ConsolePage /> },
                ],
              },
              {
                path: "project-overview",
                element: (
                  <ProjectOverviewLayout
                    redirectPaths={redirectPaths}
                    navigationMenus={navigationMenus}>
                    <Outlet />
                  </ProjectOverviewLayout>
                ),

                children: [
                  {
                    index: true,
                    element: <Navigate to="environments" replace />,
                  },
                  {
                    path: "environments",
                    element: <EnvironmentsPage />,
                  },
                ],
              },
              {
                // impersonate
                element: (
                  <DashboardLayout
                    redirectPaths={redirectPaths}
                    navigationMenus={navigationMenus}>
                    <Outlet />
                  </DashboardLayout>
                ),
                children: [
                  { path: "dashboard", element: <DashboardOverview /> },
                  {
                    path: "health",
                    element: <HealthLayout />,
                    children: [
                      { path: "health", element: <HealthPage /> },
                      {
                        path: "monitor/:id",
                        element: <HealthMonitorPage />,
                      },
                      {
                        path: "monitor/incidents/:id",
                        element: <HealthIncidentsPage />,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { path: "/", element: <Navigate to="/app/console" replace /> },
          { path: "*", element: <Navigate to="/login" replace /> },
        ],
      },
    ],
  },
] as const satisfies RouteObject[];
