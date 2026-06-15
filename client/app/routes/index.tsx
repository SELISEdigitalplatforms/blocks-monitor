import { navigationMenus } from "@/constants/navigation-menus.constant";
import { DashboardOverview } from "@/pages/dashboard-overview";
import {
  AuthResolver,
  CallbackPage,
  ConsoleLayout,
  ConsolePage,
  DashboardLayout,
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

const redirectPaths: Record<string, string> = {
  "/health/monitor/*": "/health",
  "/health/monitor/incidents/*": "/health",
};

export const routes = [
  {
    element: <Outlet />,
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
            children: [{ path: "/login", element: <LoginPage /> }],
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
                  <ConsoleLayout>
                    <Outlet />
                  </ConsoleLayout>
                ),
                children: [
                  { path: "/profile", element: <ProfilePage /> },
                  { path: "/console", element: <ConsolePage /> },
                ],
              },
              {
                path: "/project-overview",
                element: (
                  <ProjectOverviewLayout
                    redirectPaths={redirectPaths}
                    navigationMenus={navigationMenus}>
                    <Outlet />
                  </ProjectOverviewLayout>
                ),

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
                  <DashboardLayout
                    redirectPaths={redirectPaths}
                    navigationMenus={navigationMenus}>
                    <Outlet />
                  </DashboardLayout>
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
