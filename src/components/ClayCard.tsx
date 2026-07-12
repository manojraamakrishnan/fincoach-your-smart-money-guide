import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * ClayCard — the base surface for FinCoach's claymorphism UI.
 * Soft rounded corners with gentle layered depth.
 */
export const ClayCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("clay rounded-3xl p-5", className)}
        {...props}
      />
    );
  },
);
ClayCard.displayName = "ClayCard";
