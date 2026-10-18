import { AppShell } from "@/layouts/app-shell";
import { MonitorDashboardRoute } from "@/layouts/monitor-dashboard-route";
import { MonitorLayout } from "@/layouts/monitor-layout/monitor-layout";
import MonitorPage from "@/pages/monitor";
import IncidentPage from "@/pages/incidents";
import MonitorDetailsPage from "@/pages/monitor/details";
import ReposPage from "@/pages/repos";
import RepoDetailsPage from "@/pages/repos/details";
import { AuthResolver, ProtectedGuard, PublicGuard } from "@seliseblocks/app-kit/guards";
import { ImpersonationChecker, ImpersonationTerminator } from "@seliseblocks/app-kit";
import {
  CallbackPage,
  DashboardOverview,
  LoginPage,
  ProfilePage,
} from "@seliseblocks/app-kit/pages";
import { ConsoleRoute } from "@/pages/console/console-route";

import { Navigate, Outlet, type RouteObject } from "react-router";

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
              // Returning to the console terminates the environment session before rendering.
              {
                element: (
                  <ImpersonationChecker>
                    <ImpersonationTerminator>
                      <AppShell>
                        <Outlet />
                      </AppShell>
                    </ImpersonationTerminator>
                  </ImpersonationChecker>
                ),
                children: [
                  { path: "profile", element: <ProfilePage /> },
                  { path: "console", element: <ConsoleRoute /> },
                ],
              },

              {
                // impersonate
                path: ":itemId",
                element: <MonitorDashboardRoute />,
                children: [
                  {
                    index: true,
                    element: <Navigate to="dashboard" replace />,
                  },
                  {
                    path: "dashboard",
                    // Like Release, the dashboard leaves out the Domains and Repositories tables.
                    element: <DashboardOverview showDomains={false} showRepositories={false} />,
                  },
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
