"use client";

import { Select } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export type SelectOption = { value: string | number; label: string; disabled?: boolean };
export function SelectField({ value, options, onValueChange, disabled, className = "", placeholder = "Выберите", "aria-label": label }: {
  value: string | number; options: SelectOption[]; onValueChange: (value: string) => void;
  disabled?: boolean; className?: string; placeholder?: string; "aria-label": string;
}) {
  return <Select.Root value={String(value)} onValueChange={onValueChange} disabled={disabled}>
    <Select.Trigger className={"select-trigger " + className} aria-label={label} data-value={String(value)} title={options.find((option) => String(option.value) === String(value))?.label}>
      <Select.Value placeholder={placeholder} /><Select.Icon asChild><ChevronDown size={15} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className="select-content" position="popper" sideOffset={6} collisionPadding={10}>
      <Select.ScrollUpButton className="select-scroll"><ChevronUp size={15} /></Select.ScrollUpButton>
      <Select.Viewport className="select-viewport">{options.filter((option) => String(option.value)).map((option) => <Select.Item className="select-item" key={option.value} value={String(option.value)} data-value={String(option.value)} disabled={option.disabled}>
        <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
      <Select.ScrollDownButton className="select-scroll"><ChevronDown size={15} /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>;
}
