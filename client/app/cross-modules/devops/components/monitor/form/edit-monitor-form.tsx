import { InfoTooltip } from "@/components/info-tool-tip/info-tool-tip";
import {
  RenderAlternatively,
  RenderConditionally,
} from "@/components/render-elements";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui-kits/accordion/accordion";
import { Button } from "@/components/ui-kits/button/button";
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
import {
  HTTP_METHODS,
  MONITOR_INTERVAL,
  MONITOR_SOURCE_TYPES,
} from "@/cross-modules/devops/constants/alert.constant";
import {
  useGetMonitorById,
  useUpdateHealth,
  useUpdateSingleMonitor,
} from "@/cross-modules/devops/hooks/alerts";
import type {
  IUpdateHealth,
  IUpdateSingleMonitorPayload,
} from "@/cross-modules/devops/models/alerts.model";
import { ErrorTransformer } from "@/cross-modules/devops/utils/error-transform";
import { useGetAllServices } from "@/cross-modules/identifier/hooks/use-services";
import { useGetEnvRepositories } from "@/hooks/use-project";
import { showErrorToast, showSuccessToast } from "@/hooks/use-toast";
import { useProjectStore } from "@/store/useProjectStore";
import { zodResolver } from "@hookform/resolvers/zod";
import { DialogClose } from "@radix-ui/react-dialog";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { getAddMonitorDefaultValues } from "../add-monitor/schema";
import {
  type FormType,
  type MonitorForm,
  type SourceType,
  monitorSchema,
} from "./schema";
import { setMonitorFormDefaultResponseValues } from "./util";

const getMonitorSourceTypeFromMonitorSource = (sourceType: SourceType) => {
  if (sourceType === "deployed") return MONITOR_SOURCE_TYPES.DeployedServices;
  if (sourceType === "my-services")
    return MONITOR_SOURCE_TYPES.ExternalServices;
  return MONITOR_SOURCE_TYPES.OtherServices;
};

type Props = {
  itemId: string;
};

export function EditSingleMonitorForm({ itemId }: Props) {
  const navigate = useNavigate();
  const projectKey = useProjectStore().selectedProject?.tenantId || "";
  const isEditMode = !!itemId;

  const { data: monitorDetails } = useGetMonitorById(itemId);

  const form = useForm<MonitorForm>({
    defaultValues: setMonitorFormDefaultResponseValues(monitorDetails?.data),
    resolver: zodResolver(monitorSchema),
    mode: "onChange",
  });

  const monitorType = form.watch("monitorConfigurationType");
  const sourceType = form.watch("sourceType");
  const selectedRepoId = form.watch("selectedRepoId");
  const selectedServiceId = form.watch("selectedServiceId");
  const httpMethod = form.watch("requestConfiguration.http_methods");
  const sendAsJson = form.watch("requestConfiguration.json_switcher");

  const { data: envRepositoriesResponse, isLoading: isLoadingRepos } =
    useGetEnvRepositories(projectKey);

  const { data: servicesResponse, isLoading: isLoadingServices } =
    useGetAllServices({
      projectKey,
      page: 0,
      pageSize: 100,
    });

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

  const updateRequestMutation = useUpdateSingleMonitor();
  const updateHealthMutation = useUpdateHealth();

  const isSubmittingAny =
    updateRequestMutation.isPending || updateHealthMutation.isPending;

  const onSubmit = async (formValues: MonitorForm) => {
    try {
      if (formValues.monitorConfigurationType === "request") {
        const payload: IUpdateSingleMonitorPayload = {
          itemId,
          projectKey,
          authorizationType: null,
          name: formValues.name,
          repoName: selectedRepo?.repoName || "",
          repoId: formValues.selectedRepoId,
          url: formValues.urlMonitor,
          monitorConfigurationType: 0,
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
          externalServiceId: formValues.selectedServiceId,
          externalServiceName: selectedService?.name || "",
          monitorSourceType: getMonitorSourceTypeFromMonitorSource(
            formValues.sourceType,
          ),
        };

        const res = await updateRequestMutation.mutateAsync(payload);

        if (!res.isSuccess) {
          return showErrorToast({ errors: res.message });
        } else {
          const createdItemId = res?.data?.itemId;
          navigate(`/health/monitor/${createdItemId}`);
        }
      } else {
        const payload: IUpdateHealth = {
          itemId,
          projectKey,
          repoName: selectedRepo?.repoName || "",
          repoId: formValues.selectedRepoId,
          name: formValues.name,
          monitorConfigurationType: 1,
          intervalInSeconds:
            MONITOR_INTERVAL[formValues.monitorSettings.monitor_interval],
          gracePeriodInSeconds:
            MONITOR_INTERVAL[formValues.monitorSettings.grace_time],
          isActive: true,
          externalServiceId: formValues.selectedServiceId,
          externalServiceName: selectedService?.name || "",
          monitorSourceType: getMonitorSourceTypeFromMonitorSource(
            formValues.sourceType,
          ),
        };

        const res = await updateHealthMutation.mutateAsync(payload);

        if (!res.isSuccess) {
          return showErrorToast({ errors: res.message });
        } else {
          const createdItemId = res?.data?.itemId;
          navigate(`/health/monitor/${createdItemId}`);
        }
      }

      showSuccessToast({
        description: "Monitor successfully created.",
      });
      form.reset(getAddMonitorDefaultValues());
    } catch (error) {
      return showErrorToast({ errors: ErrorTransformer(error) });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="max-h-[70vh] overflow-y-auto px-2 space-y-4">
          <RenderConditionally condition={!isEditMode}>
            <FormField
              control={form.control}
              name="monitorConfigurationType"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-1">
                  <FormLabel className="block text-sm font-medium">
                    Monitor type
                  </FormLabel>
                  <FormControl className="flex items-center gap-2">
                    <RadioGroup
                      value={field.value}
                      onValueChange={(value: FormType) =>
                        field.onChange(value, { shouldValidate: true })
                      }
                      className="flex items-center gap-4"
                      disabled={isEditMode}>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="request"
                          id="monitor-type-request"
                        />
                        <label htmlFor="monitor-type-request">Request</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="callback"
                          id="monitor-type-callback"
                        />
                        <label htmlFor="monitor-type-callback">Callback</label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </RenderConditionally>

          <div className="mb-4 rounded-md border border-input bg-background p-4">
            <FormField
              control={form.control}
              name="sourceType"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-1">
                  <FormLabel className="block text-sm font-medium">
                    Tag a Service
                  </FormLabel>
                  <FormControl className="flex items-center gap-2">
                    <RadioGroup
                      value={field.value}
                      onValueChange={(value: SourceType) =>
                        field.onChange(value, {
                          shouldValidate: true,
                        })
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
                        <label htmlFor="monitor-source-deployed">
                          Deployed
                        </label>
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
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <RenderConditionally condition={sourceType === "deployed"}>
              <FormField
                control={form.control}
                name="selectedRepoId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="mb-2 block text-sm font-medium">
                      Select repo
                    </FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={(value) =>
                          field.onChange(value, {
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
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </RenderConditionally>

            <RenderConditionally condition={sourceType === "my-services"}>
              <FormField
                control={form.control}
                name="selectedServiceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="mb-2 block text-sm font-medium">
                      Select service
                    </FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={(value) =>
                          field.onChange(value, {
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
                              value={service.serviceId}
                              className="break-all">
                              {service.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </RenderConditionally>

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

            <RenderConditionally condition={monitorType === "request"}>
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
            </RenderConditionally>
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
                          onValueChange={(values) => field.onChange(values[0])}
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

            <RenderConditionally condition={monitorType === "request"}>
              <AccordionItem value="requestConfig">
                <AccordionTrigger className="flex-row-reverse justify-end gap-4 hover:no-underline">
                  Request Configuration
                </AccordionTrigger>
                <AccordionContent className="flex flex-col gap-4">
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

                  <RenderConditionally condition={sendAsJson}>
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
                  </RenderConditionally>
                </AccordionContent>
              </AccordionItem>
            </RenderConditionally>
          </Accordion>

          <div className="flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>

            <DialogClose>
              <Button
                type="submit"
                disabled={isSubmittingAny || !form.formState.isValid}>
                Save
              </Button>
            </DialogClose>
          </div>
        </div>
      </form>
    </Form>
  );
}
