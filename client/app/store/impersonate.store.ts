import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ImpersonateState {
  isImpersonated: boolean;
  impersonatedTenantId: string | null;
  actualTenantId: string | null;
  startImpersonation: (
    impersonatedTenantId: string,
    actualTenantId: string,
  ) => void;
  stopImpersonation: () => void;

  reset: () => void;
}

export const useImpersonateStore = create<ImpersonateState>()(
  persist(
    (set) => ({
      isImpersonated: false,
      impersonatedTenantId: null,
      actualTenantId: null,
      startImpersonation: (
        impersonatedTenantId: string,
        actualTenantId: string,
      ) => {
        set({ isImpersonated: true, impersonatedTenantId, actualTenantId });
      },
      stopImpersonation: () => {
        set({
          isImpersonated: false,
          impersonatedTenantId: null,
          actualTenantId: null,
        });
      },
      reset: () => {
        set({
          isImpersonated: false,
          impersonatedTenantId: null,
          actualTenantId: null,
        });
      },
    }),
    {
      name: "impersonate-storage",
    },
  ),
);
