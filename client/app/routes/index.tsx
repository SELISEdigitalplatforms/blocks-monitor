import { getNavigationMenus } from "@/constants/navigation-menus.constant";
import { MonitorLayout } from "@/layouts/monitor-layout/monitor-layout";
import MadpPage from "@/pages/madp";
import ProjectRepositoriesPage from "@/pages/madp/repositories";
import ReposPage from "@/pages/repos";
import RepoDetailsPage from "@/pages/repos/details";
import { AuthResolver, ProtectedGuard, PublicGuard } from "@seliseblocks/genesis-os/guards";
import { ConsoleLayout, DashboardRoute } from "@seliseblocks/genesis-os/layouts";
import {
  CallbackPage,
  ConsolePage,
  DashboardOverview,
  LoginPage,
  ProfilePage,
} from "@seliseblocks/genesis-os/pages";

import { useT } from "@seliseblocks/genesis-os/i18n";
import { useMemo } from "react";
import { Navigate, Outlet, type RouteObject } from "react-router";

const redirectPaths: Record<string, string> = {};

// Rebuilds the menu labels when the language changes.
function MadpDashboardRoute() {
  // `t` changes with the language and when its text arrives, so the labels are rebuilt then.
  const { t } = useT("monitor.shared");
  const navigationMenus = useMemo(() => getNavigationMenus(t), [t]);
  return <DashboardRoute redirectPaths={redirectPaths} navigationMenus={navigationMenus} />;
}

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
                element: <MadpDashboardRoute />,
                children: [
                  {
                    index: true,
                    element: <Navigate to="madp" replace />,
                  },
                  { path: "dashboard", element: <Navigate to="../madp" replace /> },
                  { path: "madp/*", element: <MadpPage /> },
                  { path: "overview", element: <DashboardOverview /> },
                  { path: "monitor/*", element: <Navigate to="../madp" replace /> },
                  { path: "alert-recipients", element: <Navigate to="../madp" replace /> },
                  {
                    element: <MonitorLayout />,
                    children: [
                      { path: "repositories", element: <ProjectRepositoriesPage /> },
                      { path: "repos", element: <ReposPage /> },
                      { path: "repo/:repoId", element: <RepoDetailsPage /> },
                      { path: "repos/:repoId", element: <RepoDetailsPage /> },
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
