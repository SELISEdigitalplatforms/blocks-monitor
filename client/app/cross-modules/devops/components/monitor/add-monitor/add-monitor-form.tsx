// import { InfoTooltip } from "@/components/info-tool-tip/info-tool-tip";
// import { RenderAlternatively } from "@/components/render-elements";
// import {
//   Form,
//   FormControl,
//   FormField,
//   FormItem,
//   FormLabel,
//   FormMessage,
// } from "@/components/ui-kits/form/form";
// import { Input } from "@/components/ui-kits/input/input";
// import {
//   RadioGroup,
//   RadioGroupItem,
// } from "@/components/ui-kits/radio-group/radio-group";
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from "@/components/ui-kits/select/select";
// import { Slider } from "@/components/ui-kits/slider/slider";
// import { Switch } from "@/components/ui-kits/switch/switch";
// import { Textarea } from "@/components/ui-kits/textarea/textarea";
// import {
//   HTTP_METHODS,
//   MONITOR_INTERVAL,
//   MONITOR_SOURCE_TYPES,
// } from "@/cross-modules/devops/constants/alert.constant";
// import {
//   Accordion,
//   AccordionContent,
//   AccordionItem,
//   AccordionTrigger,
// } from "@/components/ui-kits/accordion/accordion";
// import { DialogClose } from "@radix-ui/react-dialog";
// import {
//   type AddMonitorForm,
//   type FormType,
//   type SourceType,
//   addMonitorSchema,
//   getAddMonitorDefaultValues,
// } from "./schema";
// import { Button } from "@/components/ui-kits/button/button";
// import {
//   IAddSingleMonitorPayload,
//   ISaveHealth,
// } from "@/cross-modules/devops/models/alerts.model";
// import { ErrorTransformer } from "@/cross-modules/devops/utils/error-transform";
// import { showErrorToast, showSuccessToast } from "@/hooks/use-toast";
// import { zodResolver } from "@hookform/resolvers/zod";
// import { useForm } from "react-hook-form";
// import { useNavigate } from "react-router-dom";
// import {
//   useAddSingleMonitor,
//   useUpdateSingleMonitor,
//   useSaveHealth,
//   useUpdateHealth,
// } from "@/cross-modules/devops/hooks/alerts";

// const getMonitorTypeFromRequestFlag = (request?: boolean): FormType =>
//   request ? "request" : "callback";

// type AlertProviderProps = {
//   itemId?: string;
//   repoName?: string;
//   repoId?: string;
//   request?: boolean;
//   externalServiceId?: string;
//   externalServiceName?: string;
// };

// export function AddSingleMonitorForm(props: AlertProviderProps) {
//   const {
//     itemId,
//     repoId,
//     repoName,
//     request,
//     externalServiceId,
//     externalServiceName,
//   } = props;
//   const navigate = useNavigate();

//   const isSourceBlocked = !!sourceError;

//   const addMutation = useAddSingleMonitor();
//   const updateRequestMutation = useUpdateSingleMonitor();
//   const saveHealthMutation = useSaveHealth();
//   const updateHealthMutation = useUpdateHealth();

//   const isSubmittingAny =
//     addMutation.isPending ||
//     updateRequestMutation.isPending ||
//     saveHealthMutation.isPending ||
//     updateHealthMutation.isPending;

//   const isEditMode = !!itemId;

//   const form = useForm<AddMonitorForm>({
//     defaultValues: getAddMonitorDefaultValues(
//       getMonitorTypeFromRequestFlag(request),
//     ),
//     resolver: zodResolver(addMonitorSchema),
//     mode: "onChange",
//   });

//   const monitorType = form.watch("monitorType");
//   const sourceType = form.watch("sourceType");
//   const selectedRepoId = form.watch("selectedRepoId");
//   const selectedServiceId = form.watch("selectedServiceId");
//   const httpMethod = form.watch("requestConfiguration.http_methods");
//   const sendAsJson = form.watch("requestConfiguration.json_switcher");
//   const onSubmit = async (formValues: AddMonitorForm) => {
//     try {
//       if (isSourceBlocked) return;

//       const effectiveRepoId = formValues.selectedRepoId || repoId || "";
//       const effectiveRepoName = selectedRepo?.repoName || repoName || "";
//       const effectiveExternalServiceId =
//         formValues.selectedServiceId || externalServiceId || "";

//       if (formValues.monitorType === "request") {
//         const payload: IAddSingleMonitorPayload & {
//           monitorSourceType?: MONITOR_SOURCE_TYPES;
//         } = {
//           itemId: itemId || "",
//           projectKey,
//           name: formValues.name,
//           repoName: effectiveRepoName,
//           repoId: effectiveRepoId,
//           url: formValues.urlMonitor,
//           monitorType: formValues.requestConfiguration.http_methods,
//           customPayload:
//             formValues.requestConfiguration.http_methods === "2"
//               ? formValues.requestConfiguration.request_body
//               : "",
//           intervalInSeconds:
//             MONITOR_INTERVAL[formValues.monitorSettings.monitor_interval],
//           timeoutInSeconds:
//             MONITOR_INTERVAL[formValues.monitorSettings.request_timeout],
//           customHttpHeaders: JSON.stringify({
//             [formValues.requestConfiguration.x_header_name]:
//               formValues.requestConfiguration.value,
//           }),
//           isActive: true,
//           httpMethodType: formValues.requestConfiguration.http_methods,
//           protocolType: "HTTP",
//           externalServiceId: effectiveExternalServiceId || undefined,
//           monitorSourceType,
//         };

//         const res = itemId
//           ? await updateRequestMutation.mutateAsync(payload)
//           : await addMutation.mutateAsync(payload);

//         if (!res.isSuccess) {
//           return showErrorToast({ errors: res.message });
//         }

//         if (!itemId) {
//           const createdItemId = res?.data?.itemId;
//           navigate(`/health/monitor/${createdItemId}`);
//         }
//       } else {
//         const payload: ISaveHealth = {
//           repoName: effectiveRepoName || undefined,
//           repoId: effectiveRepoId || undefined,
//           projectKey,
//           name: formValues.name,
//           intervalInSeconds:
//             MONITOR_INTERVAL[formValues.monitorSettings.monitor_interval],
//           gracePeriodInSeconds:
//             MONITOR_INTERVAL[formValues.monitorSettings.grace_time],
//           isActive: true,
//           externalServiceId: effectiveExternalServiceId || undefined,
//           monitorSourceType,
//         };

//         const res = itemId
//           ? await updateHealthMutation.mutateAsync({ ...payload, itemId })
//           : await saveHealthMutation.mutateAsync(payload);

//         if (!res.isSuccess) {
//           return showErrorToast({ errors: res.message });
//         }

//         if (!itemId) {
//           const createdItemId = res?.data?.itemId;
//           navigate(`/health/monitor/${createdItemId}`);
//         }
//       }

//       showSuccessToast({
//         description: itemId
//           ? "Monitor successfully updated."
//           : "Monitor successfully created.",
//       });
//       form.reset(
//         getAddMonitorDefaultValues(getMonitorTypeFromRequestFlag(request)),
//       );
//       onOpenChange(false);
//     } catch (error) {
//       return showErrorToast({ errors: ErrorTransformer(error) });
//     }
//   };
//   return (
//     <Form {...form}>
//       <form onSubmit={form.handleSubmit(onSubmit)}>
//         <div className="max-h-[70vh] overflow-y-auto px-2">
//           {!itemId && (
//             <div className="mb-4">
//               <label className="mb-2 block text-sm font-medium">
//                 Monitor Type
//               </label>
//               <RadioGroup
//                 value={monitorType}
//                 onValueChange={(value: FormType) =>
//                   form.setValue("monitorType", value, {
//                     shouldValidate: true,
//                   })
//                 }
//                 className="flex gap-4">
//                 <div className="flex items-center gap-2">
//                   <RadioGroupItem value="request" id="request" />
//                   <label htmlFor="request">Request</label>
//                 </div>
//                 <div className="flex items-center gap-2">
//                   <RadioGroupItem value="callback" id="callback" />
//                   <label htmlFor="callback">Callback</label>
//                 </div>
//               </RadioGroup>
//             </div>
//           )}

//           <div className="mb-4 rounded-md border border-input bg-background p-4">
//             <label className="mb-2 block text-sm font-medium">
//               Tag a Service
//             </label>
//             <RadioGroup
//               value={sourceType}
//               onValueChange={(value: SourceType) =>
//                 form.setValue("sourceType", value, { shouldValidate: true })
//               }
//               className="flex flex-wrap gap-4"
//               disabled={isEditMode}>
//               <div className="flex items-center gap-2">
//                 <RadioGroupItem value="none" id="monitor-source-none" />
//                 <label htmlFor="monitor-source-none">None</label>
//               </div>
//               <div className="flex items-center gap-2">
//                 <RadioGroupItem value="deployed" id="monitor-source-deployed" />
//                 <label htmlFor="monitor-source-deployed">Deployed</label>
//               </div>
//               <div className="flex items-center gap-2">
//                 <RadioGroupItem
//                   value="my-services"
//                   id="monitor-source-my-services"
//                 />
//                 <label htmlFor="monitor-source-my-services">My services</label>
//               </div>
//             </RadioGroup>

//             {sourceType === "deployed" && (
//               <div className="mt-4">
//                 <label className="mb-2 block text-sm font-medium">
//                   Select repo
//                 </label>
//                 <Select
//                   value={selectedRepoId || undefined}
//                   onValueChange={(value) =>
//                     form.setValue("selectedRepoId", value, {
//                       shouldValidate: true,
//                     })
//                   }
//                   disabled={isEditMode || isLoadingRepos}>
//                   <SelectTrigger>
//                     <SelectValue
//                       placeholder={
//                         isLoadingRepos ? "Loading repos..." : "Select a repo"
//                       }
//                     />
//                   </SelectTrigger>
//                   <SelectContent>
//                     {deployedRepos.map((repo) => (
//                       <SelectItem key={repo.itemId} value={repo.itemId}>
//                         {repo.repoName}
//                       </SelectItem>
//                     ))}
//                   </SelectContent>
//                 </Select>
//               </div>
//             )}

//             {sourceType === "my-services" && (
//               <div className="mt-4">
//                 <label className="mb-2 block text-sm font-medium">
//                   Select service
//                 </label>
//                 <Select
//                   value={selectedServiceId || undefined}
//                   onValueChange={(value) =>
//                     form.setValue("selectedServiceId", value, {
//                       shouldValidate: true,
//                     })
//                   }
//                   disabled={isEditMode || isLoadingServices}>
//                   <SelectTrigger>
//                     <SelectValue
//                       placeholder={
//                         isLoadingServices
//                           ? "Loading services..."
//                           : "Select a service"
//                       }
//                     />
//                   </SelectTrigger>
//                   <SelectContent>
//                     {services.map((service) => (
//                       <SelectItem
//                         key={service.serviceId}
//                         value={service.serviceId}>
//                         {service.name}
//                       </SelectItem>
//                     ))}
//                   </SelectContent>
//                 </Select>
//               </div>
//             )}

//             {sourceError && (
//               <p className="mt-2 text-sm text-destructive">{sourceError}</p>
//             )}
//             {isEditMode && (
//               <p className="mt-2 text-xs text-muted-foreground">
//                 Monitor source cannot be changed for existing monitors.
//               </p>
//             )}
//           </div>

//           <div className="flex flex-col gap-4">
//             <FormField
//               control={form.control}
//               name="name"
//               render={({ field }) => (
//                 <FormItem>
//                   <FormLabel>Name</FormLabel>
//                   <FormControl>
//                     <Input
//                       {...field}
//                       disabled={isEditMode}
//                       onBlur={(e) => {
//                         field.onChange(e.target.value.trim());
//                         field.onBlur();
//                       }}
//                     />
//                   </FormControl>
//                   <FormMessage />
//                 </FormItem>
//               )}
//             />

//             <RenderAlternatively condition={monitorType === "request"}>
//               <FormField
//                 control={form.control}
//                 name="urlMonitor"
//                 render={({ field }) => (
//                   <FormItem>
//                     <FormLabel>URL to monitor</FormLabel>
//                     <FormControl>
//                       <Input {...field} disabled={isEditMode} />
//                     </FormControl>
//                     <FormMessage />
//                   </FormItem>
//                 )}
//               />

//               <></>
//             </RenderAlternatively>
//           </div>

//           <Accordion type="single" collapsible className="w-full">
//             <AccordionItem value="monitorSettings">
//               <AccordionTrigger className="flex-row-reverse justify-end gap-4 hover:no-underline">
//                 Monitor settings
//               </AccordionTrigger>
//               <AccordionContent className="flex flex-col gap-4">
//                 <FormField
//                   control={form.control}
//                   name="monitorSettings.monitor_interval"
//                   render={({ field }) => (
//                     <FormItem className="flex flex-col gap-2">
//                       <FormLabel className="flex items-center gap-2">
//                         Monitor interval
//                         <InfoTooltip content="How frequently the system will check your endpoint for availability and performance" />
//                       </FormLabel>
//                       <FormControl>
//                         <Slider
//                           min={1}
//                           max={5}
//                           step={1}
//                           value={[field.value]}
//                           onValueChange={(values) => field.onChange(values[0])}
//                         />
//                       </FormControl>

//                       <div className="flex justify-between px-1 text-xs text-muted-foreground">
//                         <span>30s</span>
//                         <span>1min</span>
//                         <span>5min</span>
//                         <span>30min</span>
//                         <span>1h</span>
//                       </div>
//                       <FormMessage />
//                     </FormItem>
//                   )}
//                 />

//                 <RenderAlternatively condition={monitorType === "request"}>
//                   <FormField
//                     control={form.control}
//                     name="monitorSettings.request_timeout"
//                     render={({ field }) => (
//                       <FormItem className="flex flex-col gap-2">
//                         <FormLabel className="flex items-center gap-2">
//                           Request timeout
//                           <InfoTooltip content="Maximum time to wait for a response from your endpoint before considering it timed out" />
//                         </FormLabel>
//                         <FormControl>
//                           <Slider
//                             min={1}
//                             max={5}
//                             step={1}
//                             value={[field.value]}
//                             onValueChange={(values) =>
//                               field.onChange(values[0])
//                             }
//                           />
//                         </FormControl>
//                         <div className="flex justify-between px-1 text-xs text-muted-foreground">
//                           <span>30s</span>
//                           <span>1min</span>
//                           <span>5min</span>
//                           <span>30min</span>
//                           <span>1h</span>
//                         </div>
//                         <FormMessage />
//                       </FormItem>
//                     )}
//                   />

//                   <FormField
//                     control={form.control}
//                     name="monitorSettings.grace_time"
//                     render={({ field }) => (
//                       <FormItem className="flex flex-col gap-2">
//                         <FormLabel className="flex items-center gap-2">
//                           Grace Time
//                           <InfoTooltip content="Maximum time to wait for a response from your endpoint before considering it timed out" />
//                         </FormLabel>
//                         <FormControl>
//                           <Slider
//                             min={1}
//                             max={5}
//                             step={1}
//                             value={[field.value]}
//                             onValueChange={(values) =>
//                               field.onChange(values[0])
//                             }
//                           />
//                         </FormControl>
//                         <div className="flex justify-between px-1 text-xs text-muted-foreground">
//                           <span>30s</span>
//                           <span>1min</span>
//                           <span>5min</span>
//                           <span>30min</span>
//                           <span>1h</span>
//                         </div>
//                         <FormMessage />
//                       </FormItem>
//                     )}
//                   />
//                 </RenderAlternatively>
//               </AccordionContent>
//             </AccordionItem>

//             <RenderAlternatively condition={monitorType === "request"}>
//               <AccordionItem value="requestConfig">
//                 <AccordionTrigger className="flex-row-reverse justify-end gap-4 hover:no-underline">
//                   Request Configuration
//                 </AccordionTrigger>
//                 <AccordionContent>
//                   <div className="flex flex-col gap-4">
//                     <FormField
//                       control={form.control}
//                       name="requestConfiguration.http_methods"
//                       render={({ field }) => (
//                         <FormItem className="space-y-3">
//                           <FormLabel>HTTP method</FormLabel>
//                           <FormControl>
//                             <RadioGroup
//                               onValueChange={field.onChange}
//                               value={field.value}
//                               className="flex flex-col gap-4">
//                               <div className="flex gap-6">
//                                 {HTTP_METHODS.map((item, index) => (
//                                   <FormItem
//                                     className="flex items-center gap-2"
//                                     key={index}>
//                                     <FormControl>
//                                       <RadioGroupItem value={item.value} />
//                                     </FormControl>
//                                     <FormLabel className="!mt-0">
//                                       {item.label}
//                                     </FormLabel>
//                                   </FormItem>
//                                 ))}
//                               </div>
//                             </RadioGroup>
//                           </FormControl>
//                           <FormMessage />
//                         </FormItem>
//                       )}
//                     />
//                     <FormField
//                       control={form.control}
//                       name="requestConfiguration.request_body"
//                       render={({ field }) => (
//                         <FormItem className="md:col-span-2">
//                           <FormLabel>Request body</FormLabel>
//                           <FormControl>
//                             <Textarea
//                               placeholder="Enter request body content..."
//                               rows={3}
//                               disabled={httpMethod !== "2"}
//                               {...field}
//                             />
//                           </FormControl>
//                           <FormMessage />
//                         </FormItem>
//                       )}
//                     />
//                     <FormField
//                       control={form.control}
//                       name="requestConfiguration.json_switcher"
//                       render={({ field }) => (
//                         <FormItem className="flex items-center justify-between">
//                           <FormLabel className="flex items-center gap-2">
//                             Send as JSON (application/json)
//                             <InfoTooltip content="Set Content-Type header to application/json for API requests" />
//                           </FormLabel>
//                           <FormControl>
//                             <Switch
//                               checked={field.value}
//                               onCheckedChange={field.onChange}
//                               className="!mt-0"
//                             />
//                           </FormControl>
//                         </FormItem>
//                       )}
//                     />
//                     {sendAsJson && (
//                       <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
//                         <span className="text-lg font-semibold md:col-span-2">
//                           Request headers
//                         </span>

//                         <FormField
//                           control={form.control}
//                           name="requestConfiguration.x_header_name"
//                           render={({ field }) => (
//                             <FormItem>
//                               <FormLabel>X-Header-Name</FormLabel>
//                               <FormControl>
//                                 <Input {...field} />
//                               </FormControl>
//                               <FormMessage />
//                             </FormItem>
//                           )}
//                         />
//                         <FormField
//                           control={form.control}
//                           name="requestConfiguration.value"
//                           render={({ field }) => (
//                             <FormItem>
//                               <FormLabel>Value</FormLabel>
//                               <FormControl>
//                                 <Input {...field} />
//                               </FormControl>
//                               <FormMessage />
//                             </FormItem>
//                           )}
//                         />
//                       </div>
//                     )}
//                   </div>
//                 </AccordionContent>
//               </AccordionItem>

//               <></>
//             </RenderAlternatively>
//           </Accordion>

//           <div className="flex justify-end gap-2 pt-4">
//             <DialogClose asChild>
//               <Button type="button" variant="outline">
//                 Cancel
//               </Button>
//             </DialogClose>
//             <Button
//               type="submit"
//               disabled={
//                 isSubmittingAny ||
//                 !form.formState.isValid ||
//                 Boolean(isSourceBlocked)
//               }>
//               Save
//             </Button>
//           </div>
//           {sourceError && (
//             <p className="pt-2 text-sm text-destructive">{sourceError}</p>
//           )}
//         </div>
//       </form>
//     </Form>
//   );
// }
