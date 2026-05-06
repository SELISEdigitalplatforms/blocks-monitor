import { RenderAlternatively } from "@/components/render-elements";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-kits/dialog/dialog";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui-kits/radio-group/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-kits/select/select";
import { useProjectStore } from "@/store/useProjectStore";
import { useGetEnvRepositories } from "@/hooks/use-project";
import { useGetAllServices } from "@blocks-identifier/hooks/use-services";
import {
  useGetMonitorById,
  useGetMonitorListById,
  useIsExternalServiceConfigured,
} from "@blocks-devops/hooks/alerts";
import { MONITOR_SOURCE_TYPES } from "@blocks-devops/constants/alert.constant";
import { useEffect, useMemo, useState } from "react";
import CallbackForm from "./callback-form";
import RequestForm from "./request-form";

type FormType = "request" | "callback";
type SourceType = "deployed" | "my-services" | "none";

type AlertProviderProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  itemId?: string;
  repoName?: string;
  repoId?: string;
  request?: boolean;
  externalServiceId?: string;
};

const AddSingleMonitor = ({
  open,
  onOpenChange,
  itemId,
  repoId,
  repoName,
  request,
  externalServiceId,
}: AlertProviderProps) => {
  const [selectedForm, setSelectedForm] = useState<FormType>(
    request ? "request" : "callback",
  );
  const projectKey = useProjectStore().selectedProject?.tenantId || "";
  const [sourceType, setSourceType] = useState<SourceType>("none");
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");

  const isEditMode = !!itemId;

  const {
    data: envRepositoriesResponse,
    isLoading: isLoadingRepos,
    refetch: refetchEnvRepos,
  } = useGetEnvRepositories(projectKey, open && sourceType === "deployed");
  const { data: servicesResponse, isLoading: isLoadingServices } =
    useGetAllServices({
      projectKey,
      page: 0,
      pageSize: 100,
    });
  const { data: monitorDetails } = useGetMonitorById(itemId || "");

  const deployedRepos = useMemo(
    () => envRepositoriesResponse?.data ?? [],
    [envRepositoriesResponse],
  );
  const services = useMemo(
    () => servicesResponse?.data ?? [],
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

  const monitorSourceType = useMemo(() => {
    if (sourceType === "deployed") return MONITOR_SOURCE_TYPES.DeployedServices;
    if (sourceType === "my-services")
      return MONITOR_SOURCE_TYPES.ExternalServices;
    return MONITOR_SOURCE_TYPES.OtherServices;
  }, [sourceType]);

  const prefillName = useMemo(() => {
    if (sourceType === "deployed") return selectedRepo?.repoName || undefined;
    if (sourceType === "my-services") return selectedService?.name || undefined;
    return undefined;
  }, [sourceType, selectedRepo, selectedService]);

  const prefillUrl = useMemo(() => {
    if (sourceType === "deployed") {
      return (
        selectedRepo?.customDeploymentUrl ||
        selectedRepo?.defaultDeploymentUrl ||
        selectedRepo?.repoUrl ||
        undefined
      );
    }
    if (sourceType === "my-services") return selectedService?.url || undefined;
    return undefined;
  }, [sourceType, selectedRepo, selectedService]);

  const { data: repoMonitorList } = useGetMonitorListById(
    projectKey,
    selectedRepoId,
    !!selectedRepoId,
  );
  const { data: externalServiceConfig } =
    useIsExternalServiceConfigured(selectedServiceId);

  const repoDuplicate = useMemo(() => {
    if (itemId || sourceType !== "deployed" || !selectedRepoId) return false;
    const monitors = repoMonitorList?.data || [];
    return monitors.some((monitor) => monitor.itemId !== itemId);
  }, [sourceType, selectedRepoId, repoMonitorList, itemId]);

  const externalConfiguredItemId =
    (externalServiceConfig?.data as { itemId?: string } | null)?.itemId || "";
  const serviceDuplicate =
    !itemId &&
    sourceType === "my-services" &&
    !!selectedServiceId &&
    !!externalConfiguredItemId &&
    externalConfiguredItemId !== itemId;

  const sourceError = useMemo(() => {
    if (sourceType === "deployed" && !selectedRepoId) {
      return isLoadingRepos ? "Loading repos..." : "Select a deployed repo.";
    }
    if (sourceType === "my-services" && !selectedServiceId) {
      return isLoadingServices ? "Loading services..." : "Select a service.";
    }
    if (repoDuplicate)
      return "A monitor already exists for this deployed repo.";
    if (serviceDuplicate) return "A monitor already exists for this service.";
    return "";
  }, [
    sourceType,
    selectedRepoId,
    selectedServiceId,
    isLoadingRepos,
    isLoadingServices,
    repoDuplicate,
    serviceDuplicate,
  ]);

  const isSourceBlocked = !!sourceError;

  useEffect(() => {
    if (sourceType === "deployed") {
      setSelectedServiceId("");
      if (projectKey) refetchEnvRepos();
    } else if (sourceType === "my-services") {
      setSelectedRepoId("");
    } else {
      setSelectedRepoId("");
      setSelectedServiceId("");
    }
  }, [sourceType, projectKey, refetchEnvRepos]);

  useEffect(() => {
    if (open && sourceType === "deployed" && projectKey) {
      refetchEnvRepos();
    }
  }, [open, sourceType, projectKey, refetchEnvRepos]);

  useEffect(() => {
    if (externalServiceId) {
      setSourceType("my-services");
      setSelectedServiceId(externalServiceId);
      return;
    }
    if (repoId) {
      setSourceType("deployed");
      setSelectedRepoId(repoId);
      return;
    }
    if (!itemId) {
      setSourceType("none");
    }
  }, [externalServiceId, repoId, itemId]);

  useEffect(() => {
    if (!itemId || !monitorDetails?.data) return;

    const monitorSourceTypes = monitorDetails.data.monitorSourceTypes;
    const isExternalSource =
      monitorSourceTypes === Number(MONITOR_SOURCE_TYPES.ExternalServices);
    const isDeployedSource =
      monitorSourceTypes === Number(MONITOR_SOURCE_TYPES.DeployedServices);
    const isNoneSource =
      monitorSourceTypes === Number(MONITOR_SOURCE_TYPES.OtherServices);

    if (isExternalSource) {
      setSourceType("my-services");
      const externalId = (monitorDetails.data as { externalServiceId?: string })
        .externalServiceId;
      if (externalId) setSelectedServiceId(externalId);
      return;
    }

    if (isDeployedSource) {
      setSourceType("deployed");
      if (monitorDetails.data.repoId)
        setSelectedRepoId(monitorDetails.data.repoId);
      return;
    }

    if (isNoneSource) {
      setSourceType("none");
      setSelectedRepoId("");
      setSelectedServiceId("");
    }
  }, [itemId, monitorDetails]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-screen-sm">
        <DialogHeader>
          <DialogTitle>
            {itemId ? "Configure monitor" : "Add single monitor"}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-2">
          {/* Radio Group for Form Selection - Only show when adding new monitor */}
          {!itemId && (
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium">
                Monitor Type
              </label>
              <RadioGroup
                value={selectedForm}
                onValueChange={(value: FormType) => setSelectedForm(value)}
                className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="request" id="request" />
                  <label htmlFor="request">Request</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="callback" id="callback" />
                  <label htmlFor="callback">Callback</label>
                </div>
              </RadioGroup>
            </div>
          )}

          <div className="mb-4 rounded-md border border-input bg-background p-4">
            <label className="mb-2 block text-sm font-medium">
              Monitor Source
            </label>
            <RadioGroup
              value={sourceType}
              onValueChange={(value: SourceType) => setSourceType(value)}
              className="flex flex-wrap gap-4"
              disabled={isEditMode}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="none" id="monitor-source-none" />
                <label htmlFor="monitor-source-none">None</label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="deployed" id="monitor-source-deployed" />
                <label htmlFor="monitor-source-deployed">Deployed</label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="my-services"
                  id="monitor-source-my-services"
                />
                <label htmlFor="monitor-source-my-services">My services</label>
              </div>
            </RadioGroup>

            {sourceType === "deployed" && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium">
                  Select repo
                </label>
                <Select
                  value={selectedRepoId || undefined}
                  onValueChange={setSelectedRepoId}
                  disabled={isEditMode || isLoadingRepos}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoadingRepos ? "Loading repos..." : "Select a repo"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {deployedRepos.map((repo) => (
                      <SelectItem key={repo.itemId} value={repo.itemId}>
                        {repo.repoName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {sourceType === "my-services" && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium">
                  Select service
                </label>
                <Select
                  value={selectedServiceId || undefined}
                  onValueChange={setSelectedServiceId}
                  disabled={isEditMode || isLoadingServices}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoadingServices
                          ? "Loading services..."
                          : "Select a service"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((service) => (
                      <SelectItem
                        key={service.serviceId}
                        value={service.serviceId}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {sourceError && (
              <p className="mt-2 text-sm text-destructive">{sourceError}</p>
            )}
            {isEditMode && (
              <p className="mt-2 text-xs text-muted-foreground">
                Monitor source cannot be changed for existing monitors.
              </p>
            )}
          </div>

          {/* Conditional Form Rendering */}
          <RenderAlternatively condition={selectedForm === "request"}>
            <RequestForm
              itemId={itemId}
              onClose={() => onOpenChange(false)}
              repoId={selectedRepoId || repoId}
              repoName={selectedRepo?.repoName || repoName}
              externalServiceId={selectedServiceId || externalServiceId}
              prefillName={prefillName}
              prefillUrl={prefillUrl}
              monitorSourceType={monitorSourceType}
              isSourceBlocked={isSourceBlocked}
              sourceError={sourceError}
            />

            <CallbackForm
              itemId={itemId}
              repoId={selectedRepoId || repoId}
              repoName={selectedRepo?.repoName || repoName}
              externalServiceId={selectedServiceId || externalServiceId}
              prefillName={prefillName}
              monitorSourceType={monitorSourceType}
              isSourceBlocked={isSourceBlocked}
              sourceError={sourceError}
              onClose={() => onOpenChange(false)}
            />
          </RenderAlternatively>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddSingleMonitor;
