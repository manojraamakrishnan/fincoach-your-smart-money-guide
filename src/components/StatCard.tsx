import { type LucideIcon } from "lucide-react";
import { ClayCard } from "@/components/ClayCard";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "primary" | "success" | "warning";
}

const toneStyles: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
};

export function StatCard({ label, value, hint, icon: Icon, tone = "primary" }: StatCardProps) {
  return (
    <ClayCard className="clay-hover flex flex-col gap-3">
      <div
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-2xl",
          toneStyles[tone],
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2.2} />
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </ClayCard>
  );
}
