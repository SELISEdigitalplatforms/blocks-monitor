import { getRuntimeEnv } from "@/lib/runtime-env";

export default function ProfilePage() {
	const iamBaseUrl = getRuntimeEnv("BLOCKS_IAM_BASE_URL");
	window.location.replace(`${iamBaseUrl}/profile`);
	return null;
}
