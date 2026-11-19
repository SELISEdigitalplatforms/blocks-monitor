import { Navigate, useLocation, useParams } from "react-router-dom";
import { prefixPath } from "@/madp/lib/pathPrefix";

/** An older project link lands on the step that replaced it. */
export function StepRedirect({ to }: { to: string }) {
  const { id = "" } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={prefixPath(`/p/${id}/${to}${search}${hash}`)} replace />;
}

/** A former Business Analysis step (understanding, sanitization, requirements, scope) opens its section of the one
 *  Business Analysis page (owner 08.11.2026); the query string stays, the section becomes the anchor. */
export function AnalysisRedirect({ section }: { section: string }) {
  const { id = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={prefixPath(`/p/${id}/analysis${search}#${section}`)} replace />;
}
