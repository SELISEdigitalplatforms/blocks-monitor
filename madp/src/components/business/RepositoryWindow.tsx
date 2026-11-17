import { Modal } from "@/ui/kit";
import type { ProjectRecord } from "@/blocks/projects/records";
import { BlocksRepositoryCard } from "@/embedded/BlocksRepositoryCard";

/** Uses Blocks connections and saves the chosen repository in the existing MADP workflow. */
export function RepositoryWindow({ project, canEdit, open, onClose }: {
  project: ProjectRecord; canEdit: boolean; open: boolean; onClose: () => void;
}) {
  return <Modal open={open} onClose={onClose} width={760} title="Project repository">
    {open && <BlocksRepositoryCard key={project.id} project={project} canEdit={canEdit} onDone={onClose} />}
  </Modal>;
}
