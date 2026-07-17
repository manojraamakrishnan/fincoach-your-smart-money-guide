import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Wallet,
  TrendingUp,
  Tag,
  ArrowRightLeft,
  Sparkles,
  BarChart3,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { ClayCard } from "@/components/ClayCard";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { categorizeTransactions } from "@/lib/categorize.functions";
import { generateInsights } from "@/lib/insights.functions";

import { toast } from "sonner";

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
  const queryClient = useQueryClient();
  const categorizeFn = useServerFn(categorizeTransactions);
  const [errMsg, setErrMsg] = useState<string | null>(null);

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

  const categorize = useMutation({
    mutationFn: async () => categorizeFn(),
    onMutate: () => setErrMsg(null),
    onSuccess: (res) => {
      toast.success(`Categorized ${res.updated} of ${res.total} transactions`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e: Error) => {
      setErrMsg(e.message);
      toast.error(e.message);
    },
  });

  const txns = data ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const isDebit = (t: Txn) => t.transaction_type.toLowerCase() === "debit";

  const monthSpend = txns
    .filter((t) => isDebit(t) && new Date(t.transaction_date) >= monthStart)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const categoryTotals = new Map<string, number>();
  for (const t of txns) {
    if (!isDebit(t) || !t.category) continue;
    categoryTotals.set(t.category, (categoryTotals.get(t.category) ?? 0) + Number(t.amount));
  }
  const spendingCategories = Array.from(categoryTotals.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  const topCategory = spendingCategories[0] ?? null;
  const maxCategoryTotal = topCategory?.total ?? 0;

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

      <button
        type="button"
        onClick={() => categorize.mutate()}
        disabled={categorize.isPending}
        className="clay-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--clay-primary-shadow)] disabled:opacity-70"
      >
        {categorize.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyzing transactions…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Categorize Transactions
          </>
        )}
      </button>

      {errMsg ? (
        <ClayCard className="border border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">{errMsg}</p>
        </ClayCard>
      ) : null}

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
          value={topCategory ? topCategory.name : "—"}
          hint={topCategory ? inr(topCategory.total) : "Not yet categorized"}
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
          <h2 className="text-base font-bold text-foreground">Spending Breakdown</h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            Debit only
          </span>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : spendingCategories.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-3 rounded-2xl bg-secondary/60 clay-inset">
            <BarChart3 className="h-8 w-8 text-muted-foreground" strokeWidth={1.8} />
            <p className="text-sm text-muted-foreground">No categorized spending yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {spendingCategories.map((c) => {
              const pct = maxCategoryTotal > 0 ? (c.total / maxCategoryTotal) * 100 : 0;
              return (
                <div key={c.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="font-semibold tabular-nums text-foreground">{inr(c.total)}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary/70">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ClayCard>

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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="h-4.5 w-4.5" strokeWidth={2.2} />
            </div>
            <h2 className="text-base font-bold text-foreground">AI Insights</h2>
          </div>
          <button
            type="button"
            onClick={() => insights.refetch()}
            disabled={insights.isFetching}
            className="clay-hover flex items-center gap-1.5 rounded-xl bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-60"
          >
            {insights.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>
        {insights.isLoading || insights.isFetching ? (
          <p className="text-sm leading-relaxed text-muted-foreground">Generating insights…</p>
        ) : insights.isError ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Insights unavailable right now
          </p>
        ) : insights.data && insights.data.length > 0 ? (
          <ul className="space-y-2">
            {insights.data.map((line, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Categorize transactions to see insights.
          </p>
        )}
      </ClayCard>

    </div>
  );
}
