import { AuthScreen } from "@/components/signin/AuthScreen";

/** The existing two-pane sign-in card; authentication is provided by Blocks IAM. */
export default function SignIn() {
  return <AuthScreen mode="signin" />;
}
