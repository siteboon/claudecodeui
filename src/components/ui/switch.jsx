import * as React from "react"
import { cn } from "../../lib/utils"

const Switch = React.forwardRef(({ className, disabled, checked, onCheckedChange, ...props }, ref) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onCheckedChange?.(!checked)}
    className={cn(
      // Base styles
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      // State styles
      "disabled:cursor-not-allowed disabled:opacity-50",
      // Background color states
      checked
        ? "bg-primary"
        : "bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <span
      className={cn(
        // Base thumb styles
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
        // Position based on checked state
        checked ? "translate-x-5" : "translate-x-0"
      )}
    />
  </button>
))
Switch.displayName = "Switch"

export { Switch }