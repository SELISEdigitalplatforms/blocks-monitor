// Platform -> Settings: who may create an account (PlatformSetting auth.signup through admin signup.settings.get/save).
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { callFunction } from "./fn";
import { useSession } from "./session";
import type { SignupMode } from "@/domain/signup";

export interface SignupSettingsView {
  mode: SignupMode;
  isDefault: boolean;
}

const key = (uid: string) => ["mf", "admin", uid, "signup.settings.get"] as const;

export function useSignupSettings(enabled = true): UseQueryResult<SignupSettingsView, Error> {
  const uid = useSession((s) => s.profile?.userId ?? "");
  return useQuery({
    queryKey: key(uid),
    queryFn: async () => (await callFunction<SignupSettingsView>("admin", "signup.settings.get", {})).data,
    enabled: enabled && Boolean(uid),
    staleTime: 30_000,
    retry: 0,
  });
}

export function useSaveSignupMode(): UseMutationResult<SignupSettingsView, Error, SignupMode> {
  const client = useQueryClient();
  const uid = useSession((s) => s.profile?.userId ?? "");
  return useMutation({
    mutationFn: async (mode: SignupMode) => (await callFunction<SignupSettingsView>("admin", "signup.settings.save", { mode })).data,
    onSuccess: (data) => {
      client.setQueryData(key(uid), data);
    },
  });
}
