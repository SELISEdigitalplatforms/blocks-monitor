import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import type { ProjectRecord } from "@/blocks/projects/records";
import { ProjectEntry, ProjectRoute } from "@/components/project/ProjectRoute";
import { AnalysisRedirect, StepRedirect } from "@/components/project/StepRedirect";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { SetupWindowsHost } from "@/components/setup/SetupWindowsHost";
import { PaywallHost } from "@/components/billing/PaywallHost";

const ProjectStep = lazy(() => import("@/pages/ProjectStep"));
const Analysis = lazy(() => import("@/pages/Analysis"));
const Board = lazy(() => import("@/pages/Board"));
const Build = lazy(() => import("@/pages/Build"));
const Delivered = lazy(() => import("@/pages/Delivered"));
const Wiki = lazy(() => import("@/pages/Wiki"));
const Produced = lazy(() => import("@/pages/Produced"));
const Billing = lazy(() => import("@/components/billing/BillingPage"));
const Checkout = lazy(() => import("@/components/billing/CheckoutPage"));
const Preview = lazy(() => import("@/pages/AppPreview"));

/** Only the selected server-resolved project is reachable in this embedded router. */
export function ProjectWorkspace({ project }: { project: ProjectRecord }) {
  return <div className="madp-embedded-content"><Suspense fallback={<div role="status" className="p-6 text-ink2">Opening project…</div>}>
    <Routes>
      <Route path="/p/:id" element={<ScopedProject projectId={project.id} />}>
        <Route index element={<ProjectEntry />} />
        <Route path="business" element={<ProjectStep step={1} />} />
        <Route path="analysis" element={<Analysis />} />
        <Route path="analysis-next" element={<StepRedirect to="analysis" />} />
        <Route path="brief" element={<StepRedirect to="business" />} />
        <Route path="understanding" element={<AnalysisRedirect section="understanding" />} />
        <Route path="sanitization" element={<AnalysisRedirect section="sanitization" />} />
        <Route path="requirements" element={<AnalysisRedirect section="requirements" />} />
        <Route path="objective" element={<AnalysisRedirect section="requirements" />} />
        <Route path="scope" element={<AnalysisRedirect section="scope" />} />
        <Route path="board" element={<Board />} />
        <Route path="build" element={<Build />} />
        <Route path="delivered" element={<Delivered />} />
        <Route path="wiki" element={<Wiki />} />
        <Route path="produced" element={<Produced />} />
      </Route>
      <Route path="/billing" element={<Billing />} />
      <Route path="/billing/checkout" element={<Checkout />} />
      <Route path="/preview/:projectId/:version" element={<ScopedPreview projectId={project.id} />} />
      <Route path="*" element={<Navigate to={`/p/${project.id}`} replace />} />
    </Routes>
  </Suspense><SetupWindowsHost /><PaywallHost /><AssistantLauncher /></div>;
}

function ScopedProject({ projectId }: { projectId: string }) {
  const { id } = useParams();
  return id === projectId ? <ProjectRoute /> : <Navigate to={`/p/${projectId}`} replace />;
}
function ScopedPreview({ projectId }: { projectId: string }) {
  const { projectId: requested } = useParams();
  return requested === projectId ? <Preview /> : <Navigate to={`/p/${projectId}`} replace />;
}
