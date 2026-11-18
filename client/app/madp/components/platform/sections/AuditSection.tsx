import { usePlatformAccess } from "@/madp/blocks/admin";
import { AuditTab } from "@/madp/components/admin/AuditTab";

/** Platform management → Audit: every change made on the platform, by whom and when. */
export default function AuditSection() {
  const access = usePlatformAccess();
  return <AuditTab access={access} />;
}
