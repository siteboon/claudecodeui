import * as React from "react"
import { cn } from "../../lib/utils"

const ScrollArea = React.forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <div 
      className="h-full w-full rounded-[inherit] overflow-auto"
      style={{
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y'
      }}
    >
      {children}
    </div>
  </div>
))
ScrollArea.displayName = "ScrollArea"

export { ScrollArea }