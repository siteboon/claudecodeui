import { useState } from 'react';
import type { ComponentType } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type AuthInputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  isDisabled: boolean;
  type?: 'text' | 'password' | 'email';
  name?: string;
  autoComplete?: string;
  icon?: ComponentType<{ className?: string }>;
};

/**
 * A labelled input field for authentication forms.
 * Renders a `<label>` / `<input>` pair and forwards browser autofill hints
 * (`name`, `autoComplete`) so that password managers can identify and fill
 * the field correctly. Password fields gain a show/hide visibility toggle.
 */
export default function AuthInputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  isDisabled,
  type = 'text',
  name,
  autoComplete,
  icon: Icon,
}: AuthInputFieldProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const isPasswordField = type === 'password';
  const resolvedType = isPasswordField && isPasswordVisible ? 'text' : type;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="group relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
        )}
        <input
          id={id}
          type={resolvedType}
          name={name ?? id}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full rounded-xl border border-border bg-background/60 py-2.5 text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/60 hover:border-foreground/20 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 ${
            Icon ? 'pl-10' : 'pl-3.5'
          } ${isPasswordField ? 'pr-11' : 'pr-3.5'}`}
          placeholder={placeholder}
          required
          disabled={isDisabled}
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={() => setIsPasswordVisible((previous) => !previous)}
            disabled={isDisabled}
            tabIndex={-1}
            aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
