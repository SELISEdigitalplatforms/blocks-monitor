import { useMemo } from "react";
import { History } from "lucide-react";
import { Chip } from "@/ui/kit";
import { useParams } from "react-router-dom";
import { isBlocksProjectId } from "@/domain/projects";
import { blocksBadgesFor, useBlocksChangeRequests } from "./blocksChanges";

/** Small history badges of a feature: "Changed in v1.1", "Enhanced in v1.2", "New in v1.1". Inline, the caller places them in a flex-wrap row. */
export function ChangeBadges({ featureRef }: { featureRef: string }) {
  const id = useParams().id;
  return isBlocksProjectId(id) ? <BlocksBadges id={id} featureRef={featureRef} /> : null;
}

function BlocksBadges({ id, featureRef }: { id: string; featureRef: string }) {
  const rows = useBlocksChangeRequests(id).data;
  const badges = useMemo(() => blocksBadgesFor(featureRef, rows), [featureRef, rows]);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <Chip key={b.key} tone="ai" icon={<History size={12} strokeWidth={1.75} aria-hidden />}>{b.label}</Chip>
      ))}
    </>
  );
}
