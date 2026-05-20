import { getRuntimeEnv } from "@/lib/runtime-env";

export default function ProfilePage() {
	const idpBaseUrl = getRuntimeEnv("BLOCKS_IDP_BASE_URL");
	window.location.replace(`${idpBaseUrl}/profile`);
	return null;
}
