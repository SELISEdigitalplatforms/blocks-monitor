import { lazy, Suspense, useEffect, useLayoutEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import { DEFAULT_CONCEPT, isConcept } from "@/components/hero/types";
import { ProjectEntry, ProjectRoute } from "@/components/project/ProjectRoute";
import { AnalysisRedirect, StepRedirect } from "@/components/project/StepRedirect";
import { BareShell, RouteBoundary, Shell } from "@/ui/Shell";
import SignIn from "@/pages/SignIn";
import ForgotPassword from "@/pages/ForgotPassword";
import SignUp from "@/pages/SignUp";
import Activate from "@/pages/Activate";
import ResetPasswordPage from "@/pages/ResetPassword";
import LoginCallback from "@/pages/LoginCallback";
import { useDemo } from "@/state/store";
import { GuidedStartHost } from "@/components/guided/GuidedStart";
import { SetupWindowsHost } from "@/components/setup/SetupWindowsHost";
import { PaywallHost } from "@/components/billing/PaywallHost";

const Landing = lazy(() => import("@/pages/Landing"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const NewProject = lazy(() => import("@/pages/NewProject"));
const CinematicNewProject = lazy(() => import("@/components/cinematic/CinematicNewProject"));
const ProjectStep = lazy(() => import("@/pages/ProjectStep"));
const Analysis = lazy(() => import("@/pages/Analysis"));
const Board = lazy(() => import("@/pages/Board"));
const Build = lazy(() => import("@/pages/Build"));
const Delivered = lazy(() => import("@/pages/Delivered"));
const Wiki = lazy(() => import("@/pages/Wiki"));
const Produced = lazy(() => import("@/pages/Produced"));
const WikiIndex = lazy(() => import("@/pages/WikiIndex"));
const Settings = lazy(() => import("@/pages/Settings"));
const BillingPage = lazy(() => import("@/components/billing/BillingPage"));
const CheckoutPage = lazy(() => import("@/components/billing/CheckoutPage"));
const Admin = lazy(() => import("@/pages/Admin"));
const PublicShare = lazy(() => import("@/pages/PublicShare"));
const AppPreviewPage = lazy(() => import("@/pages/AppPreview"));

/** index.html paints only the landing dark before the app loads; once the page's own dark stage is on screen, the page colour follows the theme again. */
function useFirstPaintDone() {
  useLayoutEffect(() => { delete document.documentElement.dataset.firstPaint; }, []);
}

/** The landing page in its own theme (dark by default; the toggle in its bar switches to light). "/" shows the Story
 *  hero; /samples/:concept is the same page with an alternative hero (Foundry, Blueprint, Line). */
function LandingRoute() {
  const theme = useDemo((s) => s.landingTheme);
  const { pathname } = useLocation();
  const { concept } = useParams();
  const [params] = useSearchParams();
  const legacy = params.get("hero");
  useFirstPaintDone();
  // a sample page opens at its top, like a new page
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [pathname]);
  // the sign-in and the app open in the theme the visitor is looking at here, so the first click does not flip the screen
  useEffect(() => { if (useDemo.getState().theme !== theme) useDemo.setState({ theme }); }, [theme]);
  if (!concept && isConcept(legacy) && legacy !== DEFAULT_CONCEPT) return <Navigate to={`/samples/${legacy}`} replace />;
  if (concept !== undefined && (!isConcept(concept) || concept === DEFAULT_CONCEPT)) return <Navigate to="/" replace />;
  return <BareShell theme={theme}><RouteBoundary bare><Suspense fallback={<div data-theme="dark" className="min-h-screen bg-canvas" />}><Landing /></Suspense></RouteBoundary></BareShell>;
}

/** /pricing: the public pricing page, in the landing page's theme (its switch is in the same bar). */
function PricingRoute() {
  const theme = useDemo((s) => s.landingTheme);
  useFirstPaintDone();
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, []);
  useEffect(() => { if (useDemo.getState().theme !== theme) useDemo.setState({ theme }); }, [theme]);
  return <BareShell theme={theme}><RouteBoundary bare><Suspense fallback={<div className="min-h-screen bg-canvas" />}><Pricing /></Suspense></RouteBoundary></BareShell>;
}

function SignInRoute({ forgot = false }: { forgot?: boolean }) {
  useFirstPaintDone();
  return <BareShell appIcons><RouteBoundary bare>{forgot ? <ForgotPassword /> : <SignIn />}</RouteBoundary></BareShell>;
}

function SignUpRoute() {
  useFirstPaintDone();
  return <BareShell appIcons><RouteBoundary bare><SignUp /></RouteBoundary></BareShell>;
}

/** The pages an email link opens (activation, password reset): bare. */
function AccountLinkRoute({ children }: { children: ReactNode }) {
  useFirstPaintDone();
  return <BareShell><RouteBoundary bare>{children}</RouteBoundary></BareShell>;
}

/** The objective is a tab of the Requirements & objective step: old /p/:id/objective links land there. */
function ObjectiveRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={`/p/${id}/requirements?tab=objective`} replace />;
}

/** An app page that loads on first visit: the rail and the top bar stay, a quiet outline holds the page's place. */
function Page({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={
      <div aria-hidden className="flex flex-col gap-6">
        <div className="h-9 w-72 rounded-full bg-ink/[0.06]" />
        <div className="hatched h-64 rounded-card bg-surface/60" />
      </div>
    }>{children}</Suspense>
  );
}

/** "/" is the public landing page; the app lives under its own slugs behind the sign-in. */
export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route index element={<LandingRoute />} />
          <Route path="/samples/:concept" element={<LandingRoute />} />
          <Route path="/welcome" element={<Navigate to="/" replace />} />
          <Route path="/pricing" element={<PricingRoute />} />
          <Route path="/sign-in" element={<SignInRoute />} />
          <Route path="/login/callback" element={<AccountLinkRoute><LoginCallback /></AccountLinkRoute>} />
          <Route path="/sign-up" element={<SignUpRoute />} />
          <Route path="/activate" element={<AccountLinkRoute><Activate /></AccountLinkRoute>} />
          <Route path="/resetpassword" element={<AccountLinkRoute><ResetPasswordPage /></AccountLinkRoute>} />
          <Route path="/reset-password" element={<AccountLinkRoute><ResetPasswordPage /></AccountLinkRoute>} />
          <Route path="/forgot-password" element={<SignInRoute forgot />} />
          <Route path="/s/:token" element={<AccountLinkRoute><PublicShare /></AccountLinkRoute>} />
          {/* a deployed version as its own app (Open the preview / Open the app): full screen, behind the sign-in */}
          <Route path="/preview/:projectId/:version" element={<RouteBoundary bare><Suspense fallback={<div className="min-h-screen bg-canvas" />}><AppPreviewPage /></Suspense></RouteBoundary>} />
          {/* full screen, outside the shell: it signs the visitor in like the shell does */}
          <Route path="/new/cinematic" element={<RouteBoundary bare><Suspense fallback={<div className="min-h-screen bg-canvas" />}><CinematicNewProject /></Suspense></RouteBoundary>} />
          {/* the guided project start opens over any app page (New project, Home's box, the rail's New) */}
          <Route element={<><Shell /><GuidedStartHost /><SetupWindowsHost /><PaywallHost /></>}>
            <Route path="/dashboard" element={<Page><Dashboard /></Page>} />
            <Route path="/home" element={<Navigate to="/dashboard" replace />} />
            <Route path="/projects" element={<Page><Projects /></Page>} />
            <Route path="/wiki" element={<Page><WikiIndex /></Page>} />
            <Route path="/new" element={<Page><NewProject /></Page>} />
            <Route path="/p/:id" element={<ProjectRoute />}>
              <Route index element={<ProjectEntry />} />
              <Route path="business" element={<Page><ProjectStep step={1} /></Page>} />
              {/* Business Analysis: the design the owner approved on 08.11.2026 (?view=sections: the former four steps as sections) */}
              <Route path="analysis" element={<Page><Analysis /></Page>} />
              {/* the review address of that design: old links keep working (query and anchor kept) */}
              <Route path="analysis-next" element={<StepRedirect to="analysis" />} />
              <Route path="understanding" element={<AnalysisRedirect section="understanding" />} />
              <Route path="sanitization" element={<AnalysisRedirect section="sanitization" />} />
              <Route path="brief" element={<StepRedirect to="business" />} />
              <Route path="requirements" element={<AnalysisRedirect section="requirements" />} />
              <Route path="objective" element={<ObjectiveRedirect />} />
              <Route path="scope" element={<AnalysisRedirect section="scope" />} />
              <Route path="board" element={<Page><Board /></Page>} />
              <Route path="build" element={<Page><Build /></Page>} />
              <Route path="delivered" element={<Page><Delivered /></Page>} />
              <Route path="wiki" element={<Page><Wiki /></Page>} />
              <Route path="produced" element={<Page><Produced /></Page>} />
            </Route>
            <Route path="/settings" element={<Page><Settings /></Page>} />
            <Route path="/billing" element={<Page><BillingPage /></Page>} />
            <Route path="/billing/checkout" element={<Page><CheckoutPage /></Page>} />
            {/* Platform management: the overview at /admin, each section at /admin/<section> */}
            <Route path="/admin" element={<Page><Admin /></Page>} />
            <Route path="/admin/:section" element={<Page><Admin /></Page>} />
            <Route path="/oversight" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
