import { useParams } from "react-router-dom";
import { ProducedView } from "@/components/outputs/ProducedView";

/** What MADP produced for the project: every file the agents saved, to open or download. */
export default function Produced() {
  const { id = "" } = useParams();
  return <ProducedView key={id} projectId={id} />;
}
