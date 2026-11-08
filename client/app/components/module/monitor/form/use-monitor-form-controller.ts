import {
  useAddSingleMonitor,
  useGetMonitorById,
  useGetMonitorListById,
  useGetReposList,
  useIsExternalServiceConfigured,
  useSaveHealth,
  useUpdateHealth,
  useUpdateSingleMonitor,
} from "@/hooks/use-alerts";
import {
  toCreateCallbackPayload,
  toCreateRequestPayload,
  toFormValuesFromMonitorDetails,
  toUpdateCallbackPayload,
  toUpdateRequestPayload,
  type SubmitContext,
} from "./util";
import { ErrorTransformer } from "@seliseblocks/genesis-os/utils";
import { useScopedPath, useGetAllServices } from "@seliseblocks/genesis-os/hooks";
import { showErrorToast, showSuccessToast } from "@/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { type Resolver, useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import {
  getMonitorFormDefaultValues,
  type MonitorFormMode,
  monitorFormSchema,
  type MonitorFormValues,
  type SourceType,
} from "./schema";
import { useT } from "@seliseblocks/genesis-os/i18n";

type RepoOption = {
  itemId: string;
  repoName: string;
  customDeploymentUrl?: string | null;
  defaultDeploymentUrl?: string | null;
  repoUrl?: string | null;
};

type ServiceOption = {
  serviceId: string;
  name: string;
  url?: string | null;
};

type UseMonitorFormControllerParams = {
  mode: MonitorFormMode;
  itemId?: string | null;
  projectKey: string;
  onSuccess?: () => void;
};

export const useMonitorFormController = ({
  mode,
  itemId,
  projectKey,
  onSuccess,
}: UseMonitorFormControllerParams) => {
  const { t } = useT("monitor.monitors");
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const isEditMode = mode === "edit";

  const { data: monitorDetails } = useGetMonitorById(itemId || "");

  // react-hook-form seeds its state from `defaultValues` and only reconciles `values` in
  // an effect, so the two have to be chosen together: a single shared seed would either
  // flash the add defaults on the edit form's first render, or flash the edit fallback on
  // the add form's. Each mode therefore supplies its own pair.
  const { defaultValues, values } = useMemo(() => {
    if (isEditMode) {
      return {
        defaultValues: toFormValuesFromMonitorDetails(),
        values: toFormValuesFromMonitorDetails(monitorDetails?.data),
      };
    }

    const addDefaults = getMonitorFormDefaultValues();
    return { defaultValues: addDefaults, values: addDefaults };
  }, [isEditMode, monitorDetails?.data]);

  const form = useForm<MonitorFormValues>({
    defaultValues,
    values,
    resolver: zodResolver(monitorFormSchema) as Resolver<MonitorFormValues>,
    mode: "onChange",
  });

  const [monitorType, sourceType, selectedRepoId, selectedServiceId] = useWatch({
    control: form.control,
    name: ["monitorConfigurationType", "sourceType", "selectedRepoId", "selectedServiceId"],
  });

  // Sourced from our own API rather than blocks-logic. Same { data: [...] } envelope, so
  // deployedRepos, the selectedRepo lookup and the duplication check below are unchanged.
  const {
    data: envRepositoriesResponse,
    isLoading: isLoadingRepos,
    isError: isReposError,
  } = useGetReposList(projectKey);

  const { data: servicesResponse, isLoading: isLoadingServices } = useGetAllServices({
    projectKey,
    page: 0,
    pageSize: 100,
  });

  const deployedRepos = useMemo<RepoOption[]>(
    () => (envRepositoriesResponse?.data as RepoOption[]) ?? [],
    [envRepositoriesResponse],
  );

  const services = useMemo<ServiceOption[]>(
    () => (servicesResponse?.data as ServiceOption[]) ?? [],
    [servicesResponse],
  );

  const selectedRepo = useMemo(
    () => deployedRepos.find((repo) => repo.itemId === selectedRepoId),
    [deployedRepos, selectedRepoId],
  );

  const selectedService = useMemo(
    () => services.find((service) => service.serviceId === selectedServiceId),
    [services, selectedServiceId],
  );

  const { data: repoMonitorList } = useGetMonitorListById(projectKey, selectedRepoId);

  const { data: externalServiceConfig } = useIsExternalServiceConfigured(selectedServiceId);

  const repoDuplicate = useMemo(() => {
    if (isEditMode || sourceType !== "deployed" || !selectedRepoId) return false;
    const monitors = repoMonitorList?.data || [];
    return monitors.some((monitor) => monitor.itemId !== itemId);
  }, [isEditMode, sourceType, selectedRepoId, repoMonitorList, itemId]);

  const externalConfiguredItemId =
    (externalServiceConfig?.data as { itemId?: string } | null)?.itemId || "";

  const serviceDuplicate =
    !isEditMode &&
    sourceType === "my-services" &&
    Boolean(selectedServiceId) &&
    Boolean(externalConfiguredItemId);

  const sourceError = useMemo(() => {
    if (sourceType === "deployed" && !selectedRepoId) {
      if (isLoadingRepos) return t("MONITOR_FORM_CONTROLLER.LOADING_REPOS");
      // A failed request must not read as "this project has no repositories": without this the
      // 400/500 the endpoint returns is indistinguishable from an empty list, and the user is
      // invited to pick from a list that never loaded.
      if (isReposError) return t("MONITOR_FORM_CONTROLLER.FAILED_TO_GET_REPOS");
      return t("MONITOR_FORM_CONTROLLER.SELECT_DEPLOYED_REPO");
    }

    if (sourceType === "my-services" && !selectedServiceId) {
      return isLoadingServices
        ? t("MONITOR_FORM_CONTROLLER.LOADING_SERVICES")
        : t("MONITOR_FORM_CONTROLLER.SELECT_SERVICE");
    }

    if (repoDuplicate) {
      return t("MONITOR_FORM_CONTROLLER.REPO_DUPLICATE");
    }

    if (serviceDuplicate) {
      return t("MONITOR_FORM_CONTROLLER.SERVICE_DUPLICATE");
    }

    return "";
  }, [
    sourceType,
    selectedRepoId,
    selectedServiceId,
    isLoadingRepos,
    isReposError,
    isLoadingServices,
    repoDuplicate,
    serviceDuplicate,
    t,
  ]);

  const isSourceBlocked = Boolean(sourceError);

  const addMutation = useAddSingleMonitor();
  const saveHealthMutation = useSaveHealth();
  const updateRequestMutation = useUpdateSingleMonitor();
  const updateHealthMutation = useUpdateHealth();

  const isSubmitting =
    addMutation.isPending ||
    saveHealthMutation.isPending ||
    updateRequestMutation.isPending ||
    updateHealthMutation.isPending;

  const setSourceType = (value: SourceType) => {
    form.setValue("sourceType", value, { shouldValidate: true });

    if (value === "deployed") {
      form.setValue("selectedServiceId", "", { shouldValidate: true });
      return;
    }

    if (value === "my-services") {
      form.setValue("selectedRepoId", "", { shouldValidate: true });
      return;
    }

    form.setValue("selectedRepoId", "", { shouldValidate: true });
    form.setValue("selectedServiceId", "", { shouldValidate: true });
  };

  const setMonitorType = (value: "request" | "callback") => {
    form.setValue("monitorConfigurationType", value, { shouldValidate: true });
  };

  const setSelectedRepoId = (value: string) => {
    form.setValue("selectedRepoId", value, { shouldValidate: true });
    form.setValue("selectedServiceId", "", { shouldValidate: true });

    if (mode !== "add") return;

    const repo = deployedRepos.find((item) => item.itemId === value);
    if (!repo) return;

    const prefillUrl = repo.customDeploymentUrl || repo.defaultDeploymentUrl || repo.repoUrl || "";

    form.setValue("urlMonitor", prefillUrl || "", { shouldValidate: true });
  };

  const setSelectedServiceId = (value: string) => {
    form.setValue("selectedServiceId", value, { shouldValidate: true });
    form.setValue("selectedRepoId", "", { shouldValidate: true });

    if (mode !== "add") return;

    const service = services.find((item) => item.serviceId === value);
    if (!service) return;

    form.setValue("urlMonitor", service.url || "", { shouldValidate: true });
  };

  // The create or update call for the form's monitor type (request or callback).
  const saveMonitor = (values: MonitorFormValues, context: SubmitContext) => {
    if (values.monitorConfigurationType === "request") {
      return mode === "add"
        ? addMutation.mutateAsync(toCreateRequestPayload(values, context))
        : updateRequestMutation.mutateAsync(toUpdateRequestPayload(values, context));
    }
    return mode === "add"
      ? saveHealthMutation.mutateAsync(toCreateCallbackPayload(values, context))
      : updateHealthMutation.mutateAsync(toUpdateCallbackPayload(values, context));
  };

  const submit = async (values: MonitorFormValues) => {
    if (isSourceBlocked) return;

    const fallbackRepoName = monitorDetails?.data?.repoName || "";
    const fallbackExternalServiceName = monitorDetails?.data?.externalServiceName || "";

    const context = {
      itemId: itemId || "",
      projectKey,
      repoName: selectedRepo?.repoName || fallbackRepoName,
      externalServiceName: selectedService?.name || fallbackExternalServiceName || "",
    };

    try {
      const res = await saveMonitor(values, context);
      if (!res.isSuccess) {
        return showErrorToast({ errors: res.message });
      }

      if (mode === "add") {
        navigate(scoped(`monitor/${res?.data?.itemId}`));
      }

      showSuccessToast({
        description:
          mode === "add"
            ? t("MONITOR_FORM_CONTROLLER.CREATED")
            : t("MONITOR_FORM_CONTROLLER.UPDATED"),
      });

      onSuccess?.();
    } catch (error) {
      return showErrorToast({ errors: ErrorTransformer(error) });
    }
  };

  return {
    form,
    monitorType,
    sourceType,
    deployedRepos,
    services,
    isLoadingRepos,
    isReposError,
    isLoadingServices,
    isEditMode,
    isSubmitting,
    sourceError,
    isSourceBlocked,
    setMonitorType,
    setSourceType,
    setSelectedRepoId,
    setSelectedServiceId,
    submit,
  };
};
