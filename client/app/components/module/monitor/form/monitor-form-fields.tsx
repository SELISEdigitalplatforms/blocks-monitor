import { InfoTooltip } from "@seliseblocks/genesis-os/components";
import { RenderAlternatively, RenderConditionally } from "@seliseblocks/genesis-os/components";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/core";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/core";
import { Input } from "@/components/core";
import { RadioGroup } from "@/components/core";
import { Switch } from "@/components/core";
import { Textarea } from "@/components/core";
import { HTTP_METHODS } from "@/constants/alert.constant";
import { type FormEventHandler } from "react";
import type { UseFormReturn } from "react-hook-form";
import { EntitySelectField } from "@/components/common/form-field/entity-select-field";
import { FormActionsRow } from "@/components/common/form-field/form-actions-row";
import { IntervalSliderField } from "@/components/common/form-field/interval-slider-field";
import { LabeledRadioOption } from "@/components/common/form-field/labeled-radio-option";
import type {
  MonitorConfigurationType,
  MonitorFormValues,
  MonitorFormMode,
  SourceType,
} from "./schema";
import { useT } from "@seliseblocks/genesis-os/i18n";

type RepoOption = {
  itemId: string;
  repoName: string;
};

type ServiceOption = {
  serviceId: string;
  name: string;
};

const MONITOR_INTERVAL_TICKS = ["30s", "1min", "5min", "30min", "1h"];

type MonitorFormFieldsProps = {
  form: UseFormReturn<MonitorFormValues>;
  mode: MonitorFormMode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  monitorType: MonitorConfigurationType;
  sourceType: SourceType;
  deployedRepos: RepoOption[];
  services: ServiceOption[];
  isLoadingRepos: boolean;
  isReposError?: boolean;
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
  isReposError,
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
  const { t } = useT("monitor.monitors");
  const monitorTypeOptions: { id: string; value: MonitorConfigurationType; label: string }[] = [
    { id: "monitor-type-request", value: "request", label: t("MONITOR_FORM_FIELDS.HTTP_CHECK") },
    { id: "monitor-type-callback", value: "callback", label: t("MONITOR_FORM_FIELDS.HEARTBEAT") },
  ];
  const sourceTypeOptions: { id: string; value: SourceType; label: string }[] = [
    { id: "monitor-source-none", value: "none", label: t("MONITOR_FORM_FIELDS.SOURCE_NONE") },
    {
      id: "monitor-source-deployed",
      value: "deployed",
      label: t("MONITOR_FORM_FIELDS.SOURCE_DEPLOYED"),
    },
    {
      id: "monitor-source-my-services",
      value: "my-services",
      label: t("MONITOR_FORM_FIELDS.SOURCE_MY_SERVICES"),
    },
  ];
  const monitorIntervalTooltip = t("MONITOR_FORM_FIELDS.INTERVAL_TOOLTIP");
  const timeoutTooltip = t("MONITOR_FORM_FIELDS.TIMEOUT_TOOLTIP");
  const httpMethod = form.watch("requestConfiguration.http_methods");
  const sendAsJson = form.watch("requestConfiguration.json_switcher");

  // A failed fetch also leaves deployedRepos empty, so without the isReposError guard the form
  // renders "Failed to get repos." and "No deployed repos available." together - one of which is a
  // guess. Only claim the list is empty when it actually loaded.
  const showEmptyRepos = !isLoadingRepos && !isReposError && deployedRepos.length === 0;
  const showEmptyServices = !isLoadingServices && services.length === 0;

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
                    {t("MONITOR_FORM_FIELDS.MONITOR_TYPE")}
                  </FormLabel>
                  <FormControl className="flex items-center gap-2">
                    <RadioGroup
                      value={field.value}
                      onValueChange={(value: MonitorConfigurationType) => {
                        field.onChange(value);
                        onMonitorTypeChange(value);
                      }}
                      className="flex items-center gap-4"
                      disabled={isEditMode}
                    >
                      {monitorTypeOptions.map((option) => (
                        <LabeledRadioOption
                          key={option.id}
                          id={option.id}
                          value={option.value}
                          label={option.label}
                          disabled={isEditMode}
                        />
                      ))}
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
                  <FormLabel>{t("common:NAME")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t("MONITOR_FORM_FIELDS.NAME_PLACEHOLDER")}
                      disabled={isEditMode}
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
                      {t("MONITOR_FORM_FIELDS.TAG_A_SERVICE")}
                    </FormLabel>
                    <FormControl className="flex items-center gap-2">
                      <RadioGroup
                        value={field.value}
                        onValueChange={(value: SourceType) => {
                          field.onChange(value);
                          onSourceTypeChange(value);
                        }}
                        className="flex flex-wrap gap-4"
                        disabled={isEditMode}
                      >
                        {sourceTypeOptions.map((option) => (
                          <LabeledRadioOption
                            key={option.id}
                            id={option.id}
                            value={option.value}
                            label={option.label}
                            disabled={isEditMode}
                          />
                        ))}
                      </RadioGroup>
                    </FormControl>

                    <FormMessage />
                  </FormItem>
                )}
              />

              <RenderConditionally condition={sourceType === "deployed"}>
                <EntitySelectField
                  control={form.control}
                  name="selectedRepoId"
                  label={t("MONITOR_FORM_FIELDS.SELECT_REPO")}
                  placeholder={
                    isLoadingRepos
                      ? t("MONITOR_FORM_FIELDS.LOADING_REPOS")
                      : t("MONITOR_FORM_FIELDS.SELECT_A_REPO")
                  }
                  disabled={isEditMode || isLoadingRepos}
                  options={deployedRepos}
                  getOptionKey={(repo) => repo.itemId}
                  getOptionValue={(repo) => repo.itemId}
                  getOptionLabel={(repo) => repo.repoName}
                  onValueChange={onRepoChange}
                  emptyMessage={t("MONITOR_FORM_FIELDS.NO_ITEMS")}
                />
                {showEmptyRepos && (
                  <p className="text-sm text-muted-foreground">
                    {t("MONITOR_FORM_FIELDS.NO_DEPLOYED_REPOS")}
                  </p>
                )}
              </RenderConditionally>

              <RenderConditionally condition={sourceType === "my-services"}>
                <EntitySelectField
                  control={form.control}
                  name="selectedServiceId"
                  label={t("MONITOR_FORM_FIELDS.SELECT_SERVICE")}
                  placeholder={
                    isLoadingServices
                      ? t("MONITOR_FORM_FIELDS.LOADING_SERVICES")
                      : t("MONITOR_FORM_FIELDS.SELECT_A_SERVICE")
                  }
                  disabled={isEditMode || isLoadingServices}
                  options={services}
                  getOptionKey={(service) => service.serviceId}
                  getOptionValue={(service) => service.serviceId}
                  getOptionLabel={(service) => service.name}
                  onValueChange={onServiceChange}
                  emptyMessage={t("MONITOR_FORM_FIELDS.NO_ITEMS")}
                />
                {showEmptyServices && (
                  <p className="text-sm text-muted-foreground">
                    {t("MONITOR_FORM_FIELDS.NO_SERVICES")}
                  </p>
                )}
              </RenderConditionally>
              {sourceError && <p className="text-sm text-destructive">{sourceError}</p>}

              {isEditMode && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("MONITOR_FORM_FIELDS.SOURCE_LOCKED")}
                </p>
              )}
            </div>

            <RenderConditionally condition={monitorType === "request"}>
              <FormField
                control={form.control}
                name="urlMonitor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("MONITOR_FORM_FIELDS.URL_TO_MONITOR")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("MONITOR_FORM_FIELDS.URL_PLACEHOLDER")}
                        disabled={isEditMode}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </RenderConditionally>
          </div>

          {/*
            Add opens "Monitor settings" for you, since a new monitor almost always
            needs these set. defaultValue rather than value keeps it uncontrolled, so
            it is an initial state the user can still collapse. Edit is left alone.
          */}
          <Accordion
            type="single"
            collapsible
            defaultValue={isEditMode ? undefined : "monitorSettings"}
            className="w-full"
          >
            <AccordionItem value="monitorSettings">
              <AccordionTrigger className="flex-row-reverse justify-end gap-4 hover:no-underline">
                {t("MONITOR_FORM_FIELDS.MONITOR_SETTINGS")}
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-4 px-1 pt-1">
                <IntervalSliderField
                  control={form.control}
                  name="monitorSettings.monitor_interval"
                  label={t("MONITOR_FORM_FIELDS.MONITOR_INTERVAL")}
                  tooltipContent={monitorIntervalTooltip}
                  tickLabels={MONITOR_INTERVAL_TICKS}
                />

                <RenderAlternatively
                  condition={monitorType === "request"}
                  whenTrue={
                    <IntervalSliderField
                      control={form.control}
                      name="monitorSettings.request_timeout"
                      label={t("MONITOR_FORM_FIELDS.REQUEST_TIMEOUT")}
                      tooltipContent={timeoutTooltip}
                      tickLabels={MONITOR_INTERVAL_TICKS}
                    />
                  }
                  whenFalse={
                    <IntervalSliderField
                      control={form.control}
                      name="monitorSettings.grace_time"
                      label={t("MONITOR_FORM_FIELDS.GRACE_TIME")}
                      tooltipContent={timeoutTooltip}
                      tickLabels={MONITOR_INTERVAL_TICKS}
                    />
                  }
                />
              </AccordionContent>
            </AccordionItem>

            <RenderConditionally condition={monitorType === "request"}>
              <AccordionItem value="requestConfig">
                <AccordionTrigger className="flex-row-reverse justify-end gap-4 hover:no-underline">
                  {t("MONITOR_FORM_FIELDS.REQUEST_CONFIGURATION")}
                </AccordionTrigger>
                <AccordionContent className="flex flex-col gap-4 px-1 pt-1">
                  <FormField
                    control={form.control}
                    name="requestConfiguration.http_methods"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>{t("MONITOR_FORM_FIELDS.HTTP_METHOD")}</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            value={field.value}
                            className="flex flex-col gap-4"
                          >
                            <div className="flex gap-6">
                              {HTTP_METHODS.map((item) => (
                                <LabeledRadioOption
                                  key={`http-method-${item.value}`}
                                  id={`http-method-${item.value}`}
                                  value={item.value}
                                  label={item.label}
                                />
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
                        <FormLabel>{t("MONITOR_FORM_FIELDS.REQUEST_BODY")}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t("MONITOR_FORM_FIELDS.REQUEST_BODY_PLACEHOLDER")}
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
                          {t("MONITOR_FORM_FIELDS.SEND_AS_JSON")}
                          <InfoTooltip content={t("MONITOR_FORM_FIELDS.JSON_TOOLTIP")} />
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="mt-0!"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <RenderConditionally condition={sendAsJson}>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <span className="text-lg font-semibold md:col-span-2">
                        {t("MONITOR_FORM_FIELDS.REQUEST_HEADERS")}
                      </span>

                      <FormField
                        control={form.control}
                        name="requestConfiguration.x_header_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>X-Header-Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t("MONITOR_FORM_FIELDS.HEADER_NAME_PLACEHOLDER")}
                              />
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
                            <FormLabel>{t("MONITOR_FORM_FIELDS.VALUE")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t("MONITOR_FORM_FIELDS.VALUE_PLACEHOLDER")}
                              />
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

          <FormActionsRow
            cancelLabel={t("common:CANCEL")}
            saveLabel={t("common:SAVE")}
            isSaveDisabled={isSubmitting || !form.formState.isValid || Boolean(isSourceBlocked)}
          />
        </div>
      </form>
    </Form>
  );
};
