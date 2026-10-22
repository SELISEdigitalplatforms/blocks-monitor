import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
const Tabs = TabsPrimitive.Root;
const tabListClass =
  "inline-flex h-9 max-w-full shrink-0 items-center justify-start gap-5 overflow-x-auto rounded-none border-0 border-b border-border bg-transparent p-0 text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const tabTriggerClass =
  "inline-flex h-full shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-none border-b-2 border-transparent px-1 py-0 text-sm font-medium text-muted-foreground ring-offset-background transition-colors hover:bg-transparent hover:text-high-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-selected:border-primary aria-selected:text-primary";
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn(tabListClass, className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn(tabTriggerClass, className)} {...props} />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;
const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
// Existing callers can keep these helpers; underline tabs are now the shared default.
const underlineTabsListClass = cn(tabListClass, "w-full");
const underlineTabTriggerClass = tabTriggerClass;
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  underlineTabsListClass,
  underlineTabTriggerClass,
};
