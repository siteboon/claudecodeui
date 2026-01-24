import React from "react";
import { ChevronDown, Clock } from "lucide-react";
import { cn } from "../lib/utils";

const TIMEFRAME_OPTIONS = [
  { value: "1h", label: "1 hour" },
  { value: "8h", label: "8 hours" },
  { value: "1d", label: "1 day" },
  { value: "1w", label: "1 week" },
  { value: "2w", label: "2 weeks" },
  { value: "1m", label: "1 month" },
  { value: "all", label: "All time" },
];

function TimeframeFilter({ value, onChange, className }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef(null);

  const selectedOption =
    TIMEFRAME_OPTIONS.find((opt) => opt.value === value) ||
    TIMEFRAME_OPTIONS[3]; // default to 1w

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md",
          "bg-muted/50 hover:bg-muted border border-border/50",
          "transition-colors duration-150",
          "focus:outline-none focus:ring-2 focus:ring-primary/20",
        )}
      >
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-foreground">{selectedOption.label}</span>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute top-full left-0 mt-1 z-50",
            "bg-popover border border-border rounded-md shadow-lg",
            "min-w-[120px] py-1",
          )}
        >
          {TIMEFRAME_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs",
                  "hover:bg-accent transition-colors duration-150",
                  isSelected && "bg-accent/50",
                )}
              >
                <span
                  className={cn(
                    "font-medium",
                    isSelected ? "text-primary" : "text-foreground",
                  )}
                >
                  {option.label}
                </span>
                {isSelected && (
                  <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TimeframeFilter;
