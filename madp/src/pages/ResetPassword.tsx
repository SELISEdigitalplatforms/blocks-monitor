import { AuthScreen } from "@/components/signin/AuthScreen";

/** The page behind the reset link in the password-reset email. */
export default function ResetPassword() {
  return <AuthScreen mode="reset" />;
}
