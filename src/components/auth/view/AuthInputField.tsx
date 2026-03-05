type AuthInputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  isDisabled: boolean;
  type?: 'text' | 'password' | 'email';
};

export default function AuthInputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  isDisabled,
  type = 'text',
}: AuthInputFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={placeholder}
        required
        disabled={isDisabled}
      />
    </div>
  );
}
