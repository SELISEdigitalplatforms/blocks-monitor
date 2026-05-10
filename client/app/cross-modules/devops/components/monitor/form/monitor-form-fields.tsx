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
import { HTTP_METHODS } from "@/cross-modules/devops/constants/alert.constant";
import { DialogClose } from "@radix-ui/react-dialog";
import { type FormEventHandler } from "react";
import type { UseFormReturn } from "react-hook-form";
import type {
  MonitorConfigurationType,
  MonitorFormValues,
  MonitorFormMode,
  SourceType,
} from "./schema";

type RepoOption = {
  itemId: string;
  repoName: string;
};

type ServiceOption = {
  serviceId: string;
  name: string;
};

type MonitorFormFieldsProps = {
  form: UseFormReturn<MonitorFormValues>;
  mode: MonitorFormMode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  monitorType: MonitorConfigurationType;
  sourceType: SourceType;
  deployedRepos: RepoOption[];
  services: ServiceOption[];
  isLoadingRepos: boolean;
  isLoadingServices: boolean;
  isSubmitting: boolean;
  isEditMode: boolean;
  sourceError: string;
  isSourceBlocked: boolean;
  onMonitorTypeChange: (value: MonitorConfigurationType) => void;
  onSourceTypeChange: (value: SourceType) => void;
  onRepoChange: (value: string) => void;
  onServiceChange: (value: string) => void;
};

export const MonitorFormFields = ({
  form,
  onSubmit,
  monitorType,
  sourceType,
  deployedRepos,
  services,
  isLoadingRepos,
  isLoadingServices,
  isSubmitting,
  isEditMode,
  sourceError,
  isSourceBlocked,
  onMonitorTypeChange,
  onSourceTypeChange,
  onRepoChange,
  onServiceChange,
}: MonitorFormFieldsProps) => {
  const httpMethod = form.watch("requestConfiguration.http_methods");
  const sendAsJson = form.watch("requestConfiguration.json_switcher");

  return (
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-2">
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
                      onValueChange={(value: MonitorConfigurationType) => {
                        field.onChange(value);
                        onMonitorTypeChange(value);
                      }}
                      className="flex items-center gap-4"
                      disabled={isEditMode}>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="request"
                          id="monitor-type-request"
                        />
                        <label
                          className="cursor-pointer select-none"
                          htmlFor="monitor-type-request">
                          Request
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="callback"
                          id="monitor-type-callback"
                        />
                        <label
                          className="cursor-pointer select-none"
                          htmlFor="monitor-type-callback">
                          Callback
                        </label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </RenderConditionally>

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

            <div className=" rounded-md border border-input bg-background px-4 py-3 space-y-3">
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
                        onValueChange={(value: SourceType) => {
                          field.onChange(value);
                          onSourceTypeChange(value);
                        }}
                        className="flex flex-wrap gap-4"
                        disabled={isEditMode}>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="none"
                            id="monitor-source-none"
                          />
                          <label
                            className="cursor-pointer select-none"
                            htmlFor="monitor-source-none">
                            None
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="deployed"
                            id="monitor-source-deployed"
                          />
                          <label
                            className="cursor-pointer select-none"
                            htmlFor="monitor-source-deployed">
                            Deployed
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem
                            value="my-services"
                            id="monitor-source-my-services"
                          />
                          <label
                            className="cursor-pointer select-none"
                            htmlFor="monitor-source-my-services">
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
                      <FormLabel className="block text-sm font-medium">
                        Select repo
                      </FormLabel>
                      <FormControl>
                        <Select
                          value={field.value || undefined}
                          onValueChange={(value) => {
                            field.onChange(value);
                            onRepoChange(value);
                          }}
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
                          <SelectContent className="w-[min(var(--radix-select-trigger-width),calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
                            {deployedRepos.map((repo) => (
                              <SelectItem
                                key={repo.itemId}
                                value={repo.itemId}
                                className="items-start py-2">
                                <span
                                  className="block max-w-full whitespace-normal break-all leading-5"
                                  title={repo.repoName}>
                                  {repo.repoName}
                                </span>
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
                          value={field.value || undefined}
                          onValueChange={(value) => {
                            field.onChange(value);
                            onServiceChange(value);
                          }}
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
                          <SelectContent className="w-[min(var(--radix-select-trigger-width),calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
                            {services.map((service) => (
                              <SelectItem
                                key={service.serviceId}
                                value={service.serviceId}
                                className="min-w-0 items-start py-2">
                                <span
                                  className="block max-w-full whitespace-normal break-all leading-5"
                                  title={service.name}>
                                  {service.name}
                                </span>
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
              {sourceError && (
                <p className="text-sm text-destructive">{sourceError}</p>
              )}

              {isEditMode && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Monitor source cannot be changed for existing monitors.
                </p>
              )}
            </div>

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
              <AccordionContent className="flex flex-col gap-4 px-1 pt-1">
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
                <AccordionContent className="flex flex-col gap-4 px-1 pt-1">
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
                                <FormItem className="flex items-center gap-2" key={index}>
                                  <FormControl>
                                    <RadioGroupItem
                                      value={item.value}
                                      id={`http-method-${item.value}`}
                                    />
                                  </FormControl>
                                  <FormLabel
                                    className="!mt-0 cursor-pointer select-none"
                                    htmlFor={`http-method-${item.value}`}>
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

            <Button
              type="submit"
              disabled={
                isSubmitting ||
                !form.formState.isValid ||
                Boolean(isSourceBlocked)
              }>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
