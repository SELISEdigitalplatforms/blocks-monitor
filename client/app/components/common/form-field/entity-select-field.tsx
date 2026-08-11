import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/core";
import { type Control, type FieldValues, type Path } from "react-hook-form";

type EntitySelectFieldProps<TFormValues extends FieldValues, TOption> = {
  control: Control<TFormValues>;
  name: Path<TFormValues>;
  label: string;
  placeholder: string;
  disabled?: boolean;
  options: TOption[];
  getOptionKey: (option: TOption) => string;
  getOptionValue: (option: TOption) => string;
  getOptionLabel: (option: TOption) => string;
  onValueChange: (value: string) => void;
  emptyMessage?: string;
};

export const EntitySelectField = <TFormValues extends FieldValues, TOption>({
  control,
  name,
  label,
  placeholder,
  disabled,
  options,
  getOptionKey,
  getOptionValue,
  getOptionLabel,
  onValueChange,
  emptyMessage,
}: EntitySelectFieldProps<TFormValues, TOption>) => {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="block text-sm font-medium">{label}</FormLabel>
          <FormControl>
            <Select
              value={(field.value as string) || undefined}
              onValueChange={(value) => {
                field.onChange(value);
                onValueChange(value);
              }}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent className="w-[min(var(--radix-select-trigger-width),calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
                {options.length === 0 ? (
                  <SelectItem
                    value="__empty__"
                    disabled
                    className="min-w-0 items-start py-2 text-muted-foreground"
                  >
                    <span className="block max-w-full whitespace-normal break-all leading-5">
                      {emptyMessage ?? "No items available."}
                    </span>
                  </SelectItem>
                ) : (
                  options.map((option) => {
                    const optionValue = getOptionValue(option);
                    const optionLabel = getOptionLabel(option);
                    return (
                      <SelectItem
                        key={getOptionKey(option)}
                        value={optionValue}
                        className="min-w-0 items-start py-2"
                      >
                        <span
                          className="block max-w-full whitespace-normal break-all leading-5"
                          title={optionLabel}
                        >
                          {optionLabel}
                        </span>
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};
