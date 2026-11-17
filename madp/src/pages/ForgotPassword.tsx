import { AuthScreen } from "@/components/signin/AuthScreen";
import { ForgotPasswordView } from "@/components/signin/ForgotPasswordView";

/** /forgot-password: ask for a reset link. The answer is the same whether or not the address has an account. */
export default function ForgotPassword() {
  return <AuthScreen mode="signin" content={<ForgotPasswordView />} />;
}
