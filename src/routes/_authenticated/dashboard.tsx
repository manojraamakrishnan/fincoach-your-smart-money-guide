import { createFileRoute } from "@tanstack/react-router";
import {
  Wallet,
  TrendingUp,
  Tag,
  ArrowRightLeft,
  Sparkles,
  BarChart3,
} from "lucide-react";
import { ClayCard } from "@/components/ClayCard";
import { StatCard } from "@/components/StatCard";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FinCoach" },
      { name: "description", content: "Your spending overview and AI insights." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--clay-primary-shadow)]">
          <Wallet className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Welcome to</p>
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-foreground">
            Your Dashboard
          </h1>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Spending This Month"
          value="—"
          hint="No data yet"
          icon={TrendingUp}
          tone="primary"
        />
        <StatCard
          label="Top Category"
          value="—"
          hint="No data yet"
          icon={Tag}
          tone="success"
        />
        <div className="col-span-2">
          <StatCard
            label="Number of Transactions"
            value="—"
            hint="Upload a statement to begin"
            icon={ArrowRightLeft}
            tone="warning"
          />
        </div>
      </div>

      <ClayCard className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">Spending Overview</h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            Monthly
          </span>
        </div>
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl bg-secondary/60 clay-inset">
          <BarChart3 className="h-8 w-8 text-muted-foreground" strokeWidth={1.8} />
          <p className="text-sm text-muted-foreground">
            Your spending chart will appear here
          </p>
        </div>
      </ClayCard>

      <ClayCard className="space-y-3 bg-primary/5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-4.5 w-4.5" strokeWidth={2.2} />
          </div>
          <h2 className="text-base font-bold text-foreground">AI Insights</h2>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your AI-generated insights will appear here
        </p>
      </ClayCard>
    </div>
  );
}
