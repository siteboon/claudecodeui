import React from "react";
import { ChevronDown, List, FolderTree } from "lucide-react";
import { cn } from "../lib/utils";

const VIEW_OPTIONS = [
  {
    value: "session",
    label: "Session View",
    icon: List,
    description: "Flat list sorted by activity",
  },
  {
    value: "repo",
    label: "Repo View",
    icon: FolderTree,
    description: "Grouped by project",
  },
];

function SessionsViewSelector({ value, onChange, className }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef(null);

  const selectedOption =
    VIEW_OPTIONS.find((opt) => opt.value === value) || VIEW_OPTIONS[1];
  const Icon = selectedOption.icon;

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
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
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
            "min-w-[160px] py-1",
          )}
        >
          {VIEW_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
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
                  "w-full flex items-center gap-2 px-3 py-2 text-xs",
                  "hover:bg-accent transition-colors duration-150",
                  isSelected && "bg-accent/50",
                )}
              >
                <OptionIcon
                  className={cn(
                    "w-3.5 h-3.5",
                    isSelected ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <div className="text-left">
                  <div
                    className={cn(
                      "font-medium",
                      isSelected ? "text-primary" : "text-foreground",
                    )}
                  >
                    {option.label}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {option.description}
                  </div>
                </div>
                {isSelected && (
                  <div className="ml-auto w-1.5 h-1.5 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SessionsViewSelector;
