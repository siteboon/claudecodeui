import * as React from "react"
import { cn } from "../../lib/utils"
import { Check } from "lucide-react"

const Checkbox = React.forwardRef(({ className, checked, onCheckedChange, ...props }, ref) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      ref={ref}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        checked && "bg-primary text-primary-foreground",
        className
      )}
      onClick={(e) => {
        onCheckedChange?.(!checked)
        props.onClick?.(e)
      }}
      {...props}
    >
      {checked && (
        <Check className="h-3 w-3 mx-auto" />
      )}
    </button>
  )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
