import * as React from "react"
import { cn } from "../../lib/utils"
import { X } from "lucide-react"

const AlertDialog = ({ open, onOpenChange, children }) => {
  const [isOpen, setIsOpen] = React.useState(open)

  React.useEffect(() => {
    setIsOpen(open)
  }, [open])

  const handleClose = () => {
    setIsOpen(false)
    if (onOpenChange) onOpenChange(false)
  }

  if (!isOpen) return null

  return (
    <>
      {React.Children.map(children, child => {
        if (React.isValidElement(child) && child.type === AlertDialogContent) {
          return React.cloneElement(child, { onClose: handleClose })
        }
        return child
      })}
    </>
  )
}

const AlertDialogTrigger = ({ children, onClick, ...props }) => {
  return React.cloneElement(children, {
    ...props,
    onClick: (e) => {
      if (onClick) onClick(e)
      if (children.props.onClick) children.props.onClick(e)
    }
  })
}

const AlertDialogPortal = ({ children }) => children

const AlertDialogOverlay = ({ className, onClick }) => (
  <div
    className={cn(
      "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm animate-in fade-in-0",
      className
    )}
    onClick={onClick}
  />
)

const AlertDialogContent = ({ className, children, onClose, ...props }) => {
  // Clone children and pass onClose to AlertDialogAction and AlertDialogCancel
  const childrenWithProps = React.Children.map(children, child => {
    if (React.isValidElement(child)) {
      // Check if child is AlertDialogFooter
      if (child.type === AlertDialogFooter) {
        // Clone AlertDialogFooter's children too
        const footerChildrenWithProps = React.Children.map(child.props.children, footerChild => {
          if (React.isValidElement(footerChild)) {
            if (footerChild.type === AlertDialogAction || footerChild.type === AlertDialogCancel) {
              return React.cloneElement(footerChild, {
                onClick: (e) => {
                  if (footerChild.props.onClick) {
                    footerChild.props.onClick(e);
                  }
                  onClose();
                }
              });
            }
          }
          return footerChild;
        });
        return React.cloneElement(child, { children: footerChildrenWithProps });
      }
    }
    return child;
  });

  return (
    <>
      <AlertDialogOverlay onClick={onClose} />
      <div
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        {...props}
      >
        {childrenWithProps}
      </div>
    </>
  );
}

const AlertDialogHeader = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)

const AlertDialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)

const AlertDialogTitle = ({ className, ...props }) => (
  <h2
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
)

const AlertDialogDescription = ({ className, ...props }) => (
  <p
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
)

const AlertDialogAction = ({ className, onClick, ...props }) => (
  <button
    type="button"
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2",
      className
    )}
    onClick={onClick}
    {...props}
  />
)

const AlertDialogCancel = ({ className, onClick, ...props }) => (
  <button
    type="button"
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 mt-2 sm:mt-0",
      className
    )}
    onClick={onClick}
    {...props}
  />
)

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}