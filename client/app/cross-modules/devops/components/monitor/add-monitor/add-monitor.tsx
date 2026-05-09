import { InfoTooltip } from "@/components/info-tool-tip/info-tool-tip";
import { RenderAlternatively } from "@/components/render-elements";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui-kits/accordion/accordion";
import { Button } from "@/components/ui-kits/button/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-kits/dialog/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui-kits/form/form";
import { Input } from "@/components/ui-kits/input/input";
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
import { Slider } from "@/components/ui-kits/slider/slider";
import { Switch } from "@/components/ui-kits/switch/switch";
import { Textarea } from "@/components/ui-kits/textarea/textarea";
import { showErrorToast, showSuccessToast } from "@/hooks/use-toast";
import { useGetEnvRepositories } from "@/hooks/use-project";
import { useProjectStore } from "@/store/useProjectStore";
import {
  HTTP_METHODS,
  MONITOR_INTERVAL,
  MONITOR_SOURCE_TYPES,
  REVERSE_MONITOR_INTERVAL,
} from "@blocks-devops/constants/alert.constant";
import {
  useAddSingleMonitor,
  useGetMonitorById,
  useGetMonitorListById,
  useIsExternalServiceConfigured,
  useSaveHealth,
  useUpdateHealth,
  useUpdateSingleMonitor,
} from "@blocks-devops/hooks/alerts";
import type {
  IAddSingleMonitorPayload,
  ISaveHealth,
} from "@/cross-modules/devops/models/alerts.model";
import { ErrorTransformer } from "@blocks-devops/utils/error-transform";
import { useGetAllServices } from "@blocks-identifier/hooks/use-services";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import {
  addMonitorSchema,
  type AddMonitorForm,
  type FormType,
  getAddMonitorDefaultValues,
  type SourceType,
} from "./schema";

type AlertProviderProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  itemId?: string;
  repoName?: string;
  repoId?: string;
  request?: boolean;
  externalServiceId?: string;
  externalServiceName?: string;
};

const getMonitorTypeFromRequestFlag = (request?: boolean): FormType =>
  request ? "request" : "callback";

const getSourceTypeFromMonitorSource = (
  monitorSourceTypes: number,
): SourceType => {
  if (monitorSourceTypes === Number(MONITOR_SOURCE_TYPES.ExternalServices)) {
    return "my-services";
  }
  if (monitorSourceTypes === Number(MONITOR_SOURCE_TYPES.DeployedServices)) {
    return "deployed";
  }
  return "none";
};

const AddSingleMonitor = ({
  open,
  onOpenChange,
  itemId,
  repoId,
  repoName,
  request,
  externalServiceId,
  externalServiceName,
}: AlertProviderProps) => {
  const navigate = useNavigate();
  const projectKey = useProjectStore().selectedProject?.tenantId || "";
  const isEditMode = !!itemId;

  const form = useForm<AddMonitorForm>({
    defaultValues: getAddMonitorDefaultValues(
      getMonitorTypeFromRequestFlag(request),
    ),
    resolver: zodResolver(addMonitorSchema),
    mode: "onChange",
  });

  const monitorType = form.watch("monitorType");
  const sourceType = form.watch("sourceType");
  const selectedRepoId = form.watch("selectedRepoId");
  const selectedServiceId = form.watch("selectedServiceId");
  const httpMethod = form.watch("requestConfiguration.http_methods");
  const sendAsJson = form.watch("requestConfiguration.json_switcher");

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

  const addMutation = useAddSingleMonitor();
  const updateRequestMutation = useUpdateSingleMonitor();
  const saveHealthMutation = useSaveHealth();
  const updateHealthMutation = useUpdateHealth();

  const isSubmittingAny =
    addMutation.isPending ||
    updateRequestMutation.isPending ||
    saveHealthMutation.isPending ||
    updateHealthMutation.isPending;

  useEffect(() => {
    if (!open || itemId) return;

    const defaults = getAddMonitorDefaultValues(
      getMonitorTypeFromRequestFlag(request),
    );

    if (externalServiceId) {
      defaults.sourceType = "my-services";
      defaults.selectedServiceId = externalServiceId;
    } else if (repoId) {
      defaults.sourceType = "deployed";
      defaults.selectedRepoId = repoId;
    }

    form.reset(defaults);
  }, [open, itemId, request, externalServiceId, repoId, form]);

  useEffect(() => {
    if (sourceType === "deployed") {
      if (selectedServiceId) {
        form.setValue("selectedServiceId", "", { shouldValidate: true });
      }
      if (projectKey) refetchEnvRepos();
      return;
    }

    if (sourceType === "my-services") {
      if (selectedRepoId) {
        form.setValue("selectedRepoId", "", { shouldValidate: true });
      }
      return;
    }

    if (selectedRepoId) {
      form.setValue("selectedRepoId", "", { shouldValidate: true });
    }
    if (selectedServiceId) {
      form.setValue("selectedServiceId", "", { shouldValidate: true });
    }
  }, [
    sourceType,
    projectKey,
    refetchEnvRepos,
    selectedRepoId,
    selectedServiceId,
    form,
  ]);

  useEffect(() => {
    if (open && sourceType === "deployed" && projectKey) {
      refetchEnvRepos();
    }
  }, [open, sourceType, projectKey, refetchEnvRepos]);

  useEffect(() => {
    if (itemId) return;

    if (sourceType === "deployed") {
      const name = selectedRepo?.repoName;
      const url =
        selectedRepo?.customDeploymentUrl ||
        selectedRepo?.defaultDeploymentUrl ||
        selectedRepo?.repoUrl;
      if (name !== undefined) {
        form.setValue("name", name, { shouldValidate: true });
      }
      if (url !== undefined) {
        form.setValue("urlMonitor", url, { shouldValidate: true });
      }
      return;
    }

    if (sourceType === "my-services") {
      if (selectedService?.name !== undefined) {
        form.setValue("name", selectedService.name, { shouldValidate: true });
      }
      if (selectedService?.url !== undefined) {
        form.setValue("urlMonitor", selectedService.url, {
          shouldValidate: true,
        });
      }
    }
  }, [itemId, sourceType, selectedRepo, selectedService, form]);

  useEffect(() => {
    if (!open || !itemId || !monitorDetails?.data) return;

    const data = monitorDetails.data;
    const isRequestType = data.monitorConfigurationType === 0;
    const monitorTypeForEdit: FormType = isRequestType ? "request" : "callback";

    const defaults = getAddMonitorDefaultValues(monitorTypeForEdit);
    defaults.name = data.name || "";
    defaults.urlMonitor = data.url || "";
    defaults.monitorSettings.monitor_interval =
      REVERSE_MONITOR_INTERVAL[data.intervalInSeconds] || 2;
    defaults.monitorSettings.request_timeout =
      REVERSE_MONITOR_INTERVAL[data.timeoutInSeconds] || 3;
    defaults.monitorSettings.grace_time =
      REVERSE_MONITOR_INTERVAL[
        (data as { gracePeriodInSeconds?: number }).gracePeriodInSeconds || 60
      ] || 3;

    defaults.sourceType = getSourceTypeFromMonitorSource(
      data.monitorSourceTypes,
    );

    if (defaults.sourceType === "deployed" && data.repoId) {
      defaults.selectedRepoId = data.repoId;
    }
    if (defaults.sourceType === "my-services") {
      const editServiceId = (data as { externalServiceId?: string })
        .externalServiceId;
      if (editServiceId) {
        defaults.selectedServiceId = editServiceId;
      }
    }

    if (isRequestType) {
      let headerName = "";
      let headerValue = "";
      let jsonSwitcher = false;

      try {
        const headers = data.customHttpHeaders
          ? JSON.parse(data.customHttpHeaders)
          : {};
        const firstEntry = Object.entries(headers)[0];
        if (firstEntry) {
          headerName = String(firstEntry[0] || "");
          headerValue = String(firstEntry[1] || "");
          jsonSwitcher = !!(headerName && headerValue);
        }
      } catch {
        headerName = "";
        headerValue = "";
        jsonSwitcher = false;
      }

      defaults.requestConfiguration.http_methods =
        data.httpMethodType?.toString() || "0";
      defaults.requestConfiguration.request_body = !data.customPayload
        ? '{"key": "value"}'
        : JSON.stringify(JSON.parse(data.customPayload as string));
      defaults.requestConfiguration.json_switcher = jsonSwitcher;
      defaults.requestConfiguration.x_header_name = headerName;
      defaults.requestConfiguration.value = headerValue;
    }

    form.reset(defaults);
  }, [open, itemId, monitorDetails, form]);

  const onSubmit = async (formValues: AddMonitorForm) => {
    try {
      if (isSourceBlocked) return;

      const effectiveRepoId = formValues.selectedRepoId || repoId || "";
      const effectiveRepoName = selectedRepo?.repoName || repoName || "";
      const effectiveExternalServiceId =
        formValues.selectedServiceId || externalServiceId || "";
      const effectiveExternalServiceName =
        selectedService?.name || externalServiceName || "";

      if (formValues.monitorType === "request") {
        const payload: IAddSingleMonitorPayload & {
          monitorSourceType?: MONITOR_SOURCE_TYPES;
        } = {
          itemId: itemId || "",
          projectKey,
          name: formValues.name,
          repoName: effectiveRepoName,
          repoId: effectiveRepoId,
          url: formValues.urlMonitor,
          monitorType: formValues.requestConfiguration.http_methods,
          customPayload:
            formValues.requestConfiguration.http_methods === "2"
              ? formValues.requestConfiguration.request_body
              : "",
          intervalInSeconds:
            MONITOR_INTERVAL[formValues.monitorSettings.monitor_interval],
          timeoutInSeconds:
            MONITOR_INTERVAL[formValues.monitorSettings.request_timeout],
          customHttpHeaders: JSON.stringify({
            [formValues.requestConfiguration.x_header_name]:
              formValues.requestConfiguration.value,
          }),
          isActive: true,
          httpMethodType: formValues.requestConfiguration.http_methods,
          protocolType: "HTTP",
          externalServiceId: effectiveExternalServiceId || undefined,
          externalServiceName: effectiveExternalServiceName || undefined,
          monitorSourceType,
        };

        const res = itemId
          ? await updateRequestMutation.mutateAsync(payload)
          : await addMutation.mutateAsync(payload);

        if (!res.isSuccess) {
          return showErrorToast({ errors: res.message });
        }

        if (!itemId) {
          const createdItemId = res?.data?.itemId;
          navigate(`/health/monitor/${createdItemId}`);
        }
      } else {
        const payload: ISaveHealth = {
          repoName: effectiveRepoName || undefined,
          repoId: effectiveRepoId || undefined,
          projectKey,
          name: formValues.name,
          intervalInSeconds:
            MONITOR_INTERVAL[formValues.monitorSettings.monitor_interval],
          gracePeriodInSeconds:
            MONITOR_INTERVAL[formValues.monitorSettings.grace_time],
          isActive: true,
          externalServiceId: effectiveExternalServiceId || undefined,
          externalServiceName: effectiveExternalServiceName || undefined,
          monitorSourceType,
        };

        const res = itemId
          ? await updateHealthMutation.mutateAsync({ ...payload, itemId })
          : await saveHealthMutation.mutateAsync(payload);

        if (!res.isSuccess) {
          return showErrorToast({ errors: res.message });
        }

        if (!itemId) {
          const createdItemId = res?.data?.itemId;
          navigate(`/health/monitor/${createdItemId}`);
        }
      }

      showSuccessToast({
        description: itemId
          ? "Monitor successfully updated."
          : "Monitor successfully created.",
      });
      form.reset(
        getAddMonitorDefaultValues(getMonitorTypeFromRequestFlag(request)),
      );
      onOpenChange(false);
    } catch (error) {
      return showErrorToast({ errors: ErrorTransformer(error) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-screen-sm">
        <DialogHeader>
          <DialogTitle>{itemId ? "Configure" : "Add monitor"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="max-h-[70vh] overflow-y-auto px-2">
              {!itemId && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium">
                    Monitor Type
                  </label>
                  <RadioGroup
                    value={monitorType}
                    onValueChange={(value: FormType) =>
                      form.setValue("monitorType", value, {
                        shouldValidate: true,
                      })
                    }
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
                  Tag a Service
                </label>
                <RadioGroup
                  value={sourceType}
                  onValueChange={(value: SourceType) =>
                    form.setValue("sourceType", value, { shouldValidate: true })
                  }
                  className="flex flex-wrap gap-4"
                  disabled={isEditMode}>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="none" id="monitor-source-none" />
                    <label htmlFor="monitor-source-none">None</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="deployed"
                      id="monitor-source-deployed"
                    />
                    <label htmlFor="monitor-source-deployed">Deployed</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="my-services"
                      id="monitor-source-my-services"
                    />
                    <label htmlFor="monitor-source-my-services">
                      My services
                    </label>
                  </div>
                </RadioGroup>

                {sourceType === "deployed" && (
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-medium">
                      Select repo
                    </label>
                    <Select
                      value={selectedRepoId || undefined}
                      onValueChange={(value) =>
                        form.setValue("selectedRepoId", value, {
                          shouldValidate: true,
                        })
                      }
                      disabled={isEditMode || isLoadingRepos}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            isLoadingRepos
                              ? "Loading repos..."
                              : "Select a repo"
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
                      onValueChange={(value) =>
                        form.setValue("selectedServiceId", value, {
                          shouldValidate: true,
                        })
                      }
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

              <div className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={isEditMode}
                          onBlur={(e) => {
                            field.onChange(e.target.value.trim());
                            field.onBlur();
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <RenderAlternatively condition={monitorType === "request"}>
                  <FormField
                    control={form.control}
                    name="urlMonitor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>URL to monitor</FormLabel>
                        <FormControl>
                          <Input {...field} disabled={isEditMode} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <></>
                </RenderAlternatively>
              </div>

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="monitorSettings">
                  <AccordionTrigger className="flex-row-reverse justify-end gap-4 hover:no-underline">
                    Monitor settings
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-4">
                    <FormField
                      control={form.control}
                      name="monitorSettings.monitor_interval"
                      render={({ field }) => (
                        <FormItem className="flex flex-col gap-2">
                          <FormLabel className="flex items-center gap-2">
                            Monitor interval
                            <InfoTooltip content="How frequently the system will check your endpoint for availability and performance" />
                          </FormLabel>
                          <FormControl>
                            <Slider
                              min={1}
                              max={5}
                              step={1}
                              value={[field.value]}
                              onValueChange={(values) =>
                                field.onChange(values[0])
                              }
                            />
                          </FormControl>

                          <div className="flex justify-between px-1 text-xs text-muted-foreground">
                            <span>30s</span>
                            <span>1min</span>
                            <span>5min</span>
                            <span>30min</span>
                            <span>1h</span>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <RenderAlternatively condition={monitorType === "request"}>
                      <FormField
                        control={form.control}
                        name="monitorSettings.request_timeout"
                        render={({ field }) => (
                          <FormItem className="flex flex-col gap-2">
                            <FormLabel className="flex items-center gap-2">
                              Request timeout
                              <InfoTooltip content="Maximum time to wait for a response from your endpoint before considering it timed out" />
                            </FormLabel>
                            <FormControl>
                              <Slider
                                min={1}
                                max={5}
                                step={1}
                                value={[field.value]}
                                onValueChange={(values) =>
                                  field.onChange(values[0])
                                }
                              />
                            </FormControl>
                            <div className="flex justify-between px-1 text-xs text-muted-foreground">
                              <span>30s</span>
                              <span>1min</span>
                              <span>5min</span>
                              <span>30min</span>
                              <span>1h</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="monitorSettings.grace_time"
                        render={({ field }) => (
                          <FormItem className="flex flex-col gap-2">
                            <FormLabel className="flex items-center gap-2">
                              Grace Time
                              <InfoTooltip content="Maximum time to wait for a response from your endpoint before considering it timed out" />
                            </FormLabel>
                            <FormControl>
                              <Slider
                                min={1}
                                max={5}
                                step={1}
                                value={[field.value]}
                                onValueChange={(values) =>
                                  field.onChange(values[0])
                                }
                              />
                            </FormControl>
                            <div className="flex justify-between px-1 text-xs text-muted-foreground">
                              <span>30s</span>
                              <span>1min</span>
                              <span>5min</span>
                              <span>30min</span>
                              <span>1h</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </RenderAlternatively>
                  </AccordionContent>
                </AccordionItem>

                <RenderAlternatively condition={monitorType === "request"}>
                  <AccordionItem value="requestConfig">
                    <AccordionTrigger className="flex-row-reverse justify-end gap-4 hover:no-underline">
                      Request Configuration
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-col gap-4">
                        <FormField
                          control={form.control}
                          name="requestConfiguration.http_methods"
                          render={({ field }) => (
                            <FormItem className="space-y-3">
                              <FormLabel>HTTP method</FormLabel>
                              <FormControl>
                                <RadioGroup
                                  onValueChange={field.onChange}
                                  value={field.value}
                                  className="flex flex-col gap-4">
                                  <div className="flex gap-6">
                                    {HTTP_METHODS.map((item, index) => (
                                      <FormItem
                                        className="flex items-center gap-2"
                                        key={index}>
                                        <FormControl>
                                          <RadioGroupItem value={item.value} />
                                        </FormControl>
                                        <FormLabel className="!mt-0">
                                          {item.label}
                                        </FormLabel>
                                      </FormItem>
                                    ))}
                                  </div>
                                </RadioGroup>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="requestConfiguration.request_body"
                          render={({ field }) => (
                            <FormItem className="md:col-span-2">
                              <FormLabel>Request body</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Enter request body content..."
                                  rows={3}
                                  disabled={httpMethod !== "2"}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="requestConfiguration.json_switcher"
                          render={({ field }) => (
                            <FormItem className="flex items-center justify-between">
                              <FormLabel className="flex items-center gap-2">
                                Send as JSON (application/json)
                                <InfoTooltip content="Set Content-Type header to application/json for API requests" />
                              </FormLabel>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  className="!mt-0"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        {sendAsJson && (
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <span className="text-lg font-semibold md:col-span-2">
                              Request headers
                            </span>

                            <FormField
                              control={form.control}
                              name="requestConfiguration.x_header_name"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>X-Header-Name</FormLabel>
                                  <FormControl>
                                    <Input {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="requestConfiguration.value"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Value</FormLabel>
                                  <FormControl>
                                    <Input {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <></>
                </RenderAlternatively>
              </Accordion>

              <div className="flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  disabled={
                    isSubmittingAny ||
                    !form.formState.isValid ||
                    Boolean(isSourceBlocked)
                  }>
                  Save
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddSingleMonitor;
