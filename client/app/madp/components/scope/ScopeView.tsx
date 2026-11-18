/** The scope page (/p/:id/scope). Only a Blocks project id (UUID) renders the page; other ids are redirected by the
 *  project route before they reach it. */
import { useParams } from "react-router-dom";
import { isBlocksProjectId } from "@/madp/blocks/scope/projectKind";
import { BlocksScopeView } from "./blocks/BlocksScopeView";

export function ScopeView() {
  const id = useParams().id;
  return id && isBlocksProjectId(id) ? <BlocksScopeView projectId={id} /> : null;
}
