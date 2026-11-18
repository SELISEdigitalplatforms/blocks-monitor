import { usePlatformAccess } from "@/madp/blocks/admin";
import { PlatformSettingsTab } from "@/madp/components/admin/PlatformSettingsTab";

/** Platform management → Settings: who may sign up, and the platform's own settings. */
export default function SettingsSection() {
  const access = usePlatformAccess();
  return <PlatformSettingsTab access={access} />;
}
