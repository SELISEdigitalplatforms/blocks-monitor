import { navigationMenus } from "@/constants/navigation-menus.constant";
import { HealthLayout } from "@/layouts/health-layout/health-layout";
import HealthPage from "@/pages/health";
import IncidentPage from "@/pages/incidents";
import MonitorDetailsPage from "@/pages/monitor/details";
import {
  CallbackPage,
  ConsolePage,
  DashboardOverview,
  EnvironmentsPage,
  LoginPage,
  ProfilePage,
} from "@seliseblocks/blocks-kit/pages";
import {
  ProjectOverviewLayout,
  DashboardLayout,
  ConsoleLayout,
} from "@seliseblocks/blocks-kit/layouts";
import {
  ProtectedGuard,
  PublicGuard,
  AuthResolver,
} from "@seliseblocks/blocks-kit/guards";

import { Navigate, Outlet, type RouteObject } from "react-router-dom";

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
                    element: <HealthLayout />,
                    children: [
                      {
                        index: true,
                        element: <Navigate to="health" replace />,
                      },
                      { path: "health", element: <HealthPage /> },
                      {
                        path: "monitor/:id",
                        element: <MonitorDetailsPage />,
                      },
                      {
                        path: "monitor/incidents/:id",
                        element: <IncidentPage />,
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
