import { navigationMenus } from "@/constants/navigation-menus.constant";
import { MonitorLayout } from "@/layouts/monitor-layout/monitor-layout";
import MonitorPage from "@/pages/monitor";
import IncidentPage from "@/pages/incidents";
import MonitorDetailsPage from "@/pages/monitor/details";
import { AuthResolver, ProtectedGuard, PublicGuard } from "@seliseblocks/genesis-os/guards";
import { ConsoleLayout, DashboardRoute } from "@seliseblocks/genesis-os/layouts";
import {
  CallbackPage,
  ConsolePage,
  DashboardOverview,
  LoginPage,
  ProfilePage,
} from "@seliseblocks/genesis-os/pages";

import { Navigate, Outlet, type RouteObject } from "react-router";

const redirectPaths: Record<string, string> = {
  "/app/monitor/monitor/*": "/app/monitor",
  "/app/monitor/monitor/incidents/*": "/app/monitor",
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
              { index: true, element: <Navigate to="console" replace /> },
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
                // impersonate
                path: ":itemId",
                element: (
                  <DashboardRoute redirectPaths={redirectPaths} navigationMenus={navigationMenus} />
                ),
                children: [
                  {
                    index: true,
                    element: <Navigate to="dashboard" replace />,
                  },
                  { path: "dashboard", element: <DashboardOverview /> },
                  {
                    element: <MonitorLayout />,
                    children: [
                      {
                        index: true,
                        element: <Navigate to="monitor" replace />,
                      },
                      { path: "monitor", element: <MonitorPage /> },
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
