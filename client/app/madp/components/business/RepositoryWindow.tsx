/** The Code chip's window: where the product's code lives. Holds today's repository card, open right away — a new
 *  repository created for you (the default), one you already have, or GitHub connected later. Same rules as the card. */
import { Modal } from "@/madp/ui/kit";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { NewRepositoryCard } from "./NewRepositoryCard";
import { RepositoryCard } from "./RepositoryCard";
import { useT } from "@/madp/i18n";

export function RepositoryWindow({ project, canEdit, open, onClose }: {
  project: ProjectRecord; canEdit: boolean; open: boolean; onClose: () => void;
}) {
  const t = useT();
  const existing = project.type === "brownfield";
  return (
    <Modal open={open} onClose={onClose} width={760}
      title={existing ? t("analysis.business.repo.productCode", "The product's code") : t("analysis.business.repo.whereCode", "Where the code lives")}>
      {existing
        ? <RepositoryCard project={project} canEdit={canEdit} embedded onDone={onClose} />
        : <NewRepositoryCard project={project} canEdit={canEdit} embedded onDone={onClose} />}
    </Modal>
  );
}
