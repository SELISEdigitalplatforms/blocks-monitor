import { useParams } from "react-router-dom";
import { WikiView } from "@/components/wiki/WikiView";

/** The project's wiki. */
export default function Wiki() {
  const { id = "" } = useParams();
  return <WikiView key={id} projectId={id} />;
}
