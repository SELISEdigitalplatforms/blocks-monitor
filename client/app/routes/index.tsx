import { getNavigationMenus } from "@/constants/navigation-menus.constant";
import { MadpBridgeProvider } from "@/madp/MadpBridgeProvider";
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
import { lazy, Suspense, useMemo } from "react";
import { Navigate, Outlet, useLocation, useParams, type RouteObject } from "react-router";
import { useProjectStore } from "@seliseblocks/genesis-os/store";

/**
 * Redirects MADP-style absolute paths (/p/:id/..., /projects, /dashboard, etc.)
 * to the Blocks shell path (/app/:itemId/p/:id/...).
 * MADP pages use absolute paths but the Blocks shell nests everything under /app/:itemId/.
 */
function MadpPathRedirect() {
  const location = useLocation();
  const project = useProjectStore.getState().selectedProject;
  const itemId = project?.ItemId ?? (project as Record<string, unknown> | null)?.itemId as string ?? "";

  if (!itemId) return <Navigate to="/app/console" replace />;

  // Rewrite the MADP path under the Blocks shell
  const newPath = `/app/${itemId}${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={newPath} replace />;
}

// Lazy-load MADP pages
const MadpDashboard = lazy(() => import("@/madp/pages/Dashboard"));
const MadpProjects = lazy(() => import("@/madp/pages/Projects"));
const MadpNewProject = lazy(() => import("@/madp/pages/NewProject"));
const MadpProjectStep = lazy(() => import("@/madp/pages/ProjectStep"));
const MadpAnalysis = lazy(() => import("@/madp/pages/Analysis"));
const BlocksAnalysis = lazy(() => import("@/madp/pages/BlocksAnalysis"));
const BlocksBuild = lazy(() => import("@/madp/pages/BlocksBuild"));
const BlocksRelease = lazy(() => import("@/madp/pages/BlocksRelease"));
const MadpBoard = lazy(() => import("@/madp/pages/Board"));
const MadpBuild = lazy(() => import("@/madp/pages/Build"));
const MadpDelivered = lazy(() => import("@/madp/pages/Delivered"));
const MadpWiki = lazy(() => import("@/madp/pages/Wiki"));
const MadpWikiIndex = lazy(() => import("@/madp/pages/WikiIndex"));
const MadpProduced = lazy(() => import("@/madp/pages/Produced"));
const MadpSettings = lazy(() => import("@/madp/pages/Settings"));
const MadpAdmin = lazy(() => import("@/madp/pages/Admin"));

function MadpPage({ children }: { children: React.ReactNode }) {
  return (
    <MadpBridgeProvider>
      <Suspense
        fallback={
          <div className="flex flex-col gap-6 p-6">
            <div className="h-9 w-72 rounded-full bg-muted/40" />
            <div className="h-64 rounded-xl bg-muted/20" />
          </div>
        }
      >
        {children}
      </Suspense>
    </MadpBridgeProvider>
  );
}

function MadpDashboardRoute() {
  const { t } = useT("madp.shared");
  const navigationMenus = useMemo(() => getNavigationMenus(t), [t]);
  return <DashboardRoute redirectPaths={{}} navigationMenus={navigationMenus} />;
}

export const routes = [
  {
    element: <Outlet />,
    children: [
      {
        path: "/login/callback",
        element: <CallbackPage defaultRedirectUrl="/app/console" />,
      },
      {
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
                path: ":itemId",
                element: <MadpDashboardRoute />,
                children: [
                  {
                    index: true,
                    element: <Navigate to="dashboard" replace />,
                  },
                  { path: "dashboard", element: <DashboardOverview /> },

                  // MADP feature routes
                  {
                    element: (
                      <main className="p-6">
                        <Outlet />
                      </main>
                    ),
                    children: [
                      {
                        path: "home",
                        element: <MadpPage><MadpDashboard /></MadpPage>,
                      },
                      {
                        path: "analysis",
                        element: <MadpPage><BlocksAnalysis /></MadpPage>,
                      },
                      {
                        path: "new",
                        element: <MadpPage><MadpNewProject /></MadpPage>,
                      },
                      {
                        path: "build",
                        element: <MadpPage><BlocksBuild /></MadpPage>,
                      },
                      {
                        path: "release",
                        element: <MadpPage><BlocksRelease /></MadpPage>,
                      },
                      {
                        path: "wiki",
                        element: <MadpPage><MadpWikiIndex /></MadpPage>,
                      },
                      {
                        path: "settings",
                        element: <MadpPage><MadpSettings /></MadpPage>,
                      },
                      {
                        path: "admin",
                        element: <MadpPage><MadpAdmin /></MadpPage>,
                      },
                      {
                        path: "admin/:section",
                        element: <MadpPage><MadpAdmin /></MadpPage>,
                      },
                      // Project-specific routes (MADP pages use useParams().id)
                      {
                        path: "p/:id",
                        children: [
                          {
                            index: true,
                            element: <MadpPage><MadpProjectStep /></MadpPage>,
                          },
                          {
                            path: "business",
                            element: <MadpPage><MadpProjectStep /></MadpPage>,
                          },
                          {
                            path: "analysis",
                            element: <MadpPage><MadpAnalysis /></MadpPage>,
                          },
                          {
                            path: "board",
                            element: <MadpPage><MadpBoard /></MadpPage>,
                          },
                          {
                            path: "build",
                            element: <MadpPage><MadpBuild /></MadpPage>,
                          },
                          {
                            path: "delivered",
                            element: <MadpPage><MadpDelivered /></MadpPage>,
                          },
                          {
                            path: "wiki",
                            element: <MadpPage><MadpWiki /></MadpPage>,
                          },
                          {
                            path: "produced",
                            element: <MadpPage><MadpProduced /></MadpPage>,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { path: "/", element: <Navigate to="/app/console" replace /> },

          // MADP path redirects: catch absolute MADP paths and redirect to /app/:itemId/...
          { path: "/p/:id/*", element: <MadpPathRedirect /> },
          { path: "/p/:id", element: <MadpPathRedirect /> },
          { path: "/projects", element: <MadpPathRedirect /> },
          { path: "/dashboard", element: <MadpPathRedirect /> },
          { path: "/home", element: <MadpPathRedirect /> },
          { path: "/new", element: <MadpPathRedirect /> },
          { path: "/new/*", element: <MadpPathRedirect /> },
          { path: "/wiki", element: <MadpPathRedirect /> },
          { path: "/settings", element: <MadpPathRedirect /> },
          { path: "/admin", element: <MadpPathRedirect /> },
          { path: "/admin/*", element: <MadpPathRedirect /> },
          { path: "/billing", element: <MadpPathRedirect /> },
          { path: "/billing/*", element: <MadpPathRedirect /> },

          { path: "*", element: <Navigate to="/login" replace /> },
        ],
      },
    ],
  },
] as const satisfies RouteObject[];
