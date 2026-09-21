interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  id?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  label,
  id,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle-switch${checked ? " is-on" : ""}${
        disabled ? " is-disabled" : ""
      }`}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="toggle-switch-knob" aria-hidden />
    </button>
  );
}
