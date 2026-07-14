import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  TrendingUp,
  Tag,
  ArrowRightLeft,
  Sparkles,
  BarChart3,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { ClayCard } from "@/components/ClayCard";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FinCoach" },
      { name: "description", content: "Your spending overview and AI insights." },
    ],
  }),
  component: DashboardPage,
});

type Txn = {
  id: string;
  transaction_date: string;
  merchant_raw: string;
  amount: number;
  transaction_type: string;
  category: string | null;
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["transactions", "dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, transaction_date, merchant_raw, amount, transaction_type, category")
        .order("transaction_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Txn[];
    },
  });

  const txns = data ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthSpend = txns
    .filter(
      (t) =>
        t.transaction_type.toLowerCase() === "debit" &&
        new Date(t.transaction_date) >= monthStart,
    )
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const recent = txns.slice(0, 10);

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
          value={isLoading ? "…" : inr(monthSpend)}
          hint={now.toLocaleString("en-IN", { month: "long", year: "numeric" })}
          icon={TrendingUp}
          tone="primary"
        />
        <StatCard
          label="Top Category"
          value="—"
          hint="Not yet categorized"
          icon={Tag}
          tone="success"
        />
        <div className="col-span-2">
          <StatCard
            label="Number of Transactions"
            value={isLoading ? "…" : String(txns.length)}
            hint="All time"
            icon={ArrowRightLeft}
            tone="warning"
          />
        </div>
      </div>

      <ClayCard className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">Recent Transactions</h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            Last 10
          </span>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : recent.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-3 rounded-2xl bg-secondary/60 clay-inset">
            <BarChart3 className="h-8 w-8 text-muted-foreground" strokeWidth={1.8} />
            <p className="text-sm text-muted-foreground">No transactions yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {recent.map((t) => {
              const isDebit = t.transaction_type.toLowerCase() === "debit";
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <div
                    className={
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
                      (isDebit
                        ? "bg-destructive/10 text-destructive"
                        : "bg-success/10 text-success")
                    }
                  >
                    {isDebit ? (
                      <ArrowUpRight className="h-4 w-4" strokeWidth={2.2} />
                    ) : (
                      <ArrowDownLeft className="h-4 w-4" strokeWidth={2.2} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {t.merchant_raw}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(t.transaction_date).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div
                    className={
                      "text-sm font-bold tabular-nums " +
                      (isDebit ? "text-destructive" : "text-success")
                    }
                  >
                    {isDebit ? "−" : "+"}
                    {inr(Number(t.amount))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
