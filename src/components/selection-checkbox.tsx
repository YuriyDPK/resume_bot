"use client";
import { useEffect, useRef } from "react";
export function SelectionCheckbox({ checked, mixed = false, label, disabled, onChange }: { checked: boolean; mixed?: boolean; label: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} className="row-checkbox" type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />;
}
