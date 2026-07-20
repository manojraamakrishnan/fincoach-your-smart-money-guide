import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
  Calendar,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
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

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
};

const CHART_COLORS = [
  "#5B6CFF",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#EC4899",
  "#84CC16",
  "#F97316",
  "#14B8A6",
  "#6366F1",
  "#A855F7",
  "#94A3B8",
];

function DashboardPage() {
  const queryClient = useQueryClient();
  const categorizeFn = useServerFn(categorizeTransactions);
  const insightsFn = useServerFn(generateInsights);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<string[] | null>(null);

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

  const txns = useMemo(() => data ?? [], [data]);

  // Available months (sorted ascending)
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const t of txns) set.add(monthKey(new Date(t.transaction_date)));
    return Array.from(set).sort();
  }, [txns]);

  // Default: latest month
  const activeMonths = useMemo(() => {
    if (selectedMonths && selectedMonths.length > 0) {
      return selectedMonths.filter((m) => availableMonths.includes(m));
    }
    return availableMonths.length ? [availableMonths[availableMonths.length - 1]] : [];
  }, [selectedMonths, availableMonths]);

  const activeMonthSet = useMemo(() => new Set(activeMonths), [activeMonths]);

  const insights = useQuery({
    queryKey: ["insights", activeMonths.join(",")],
    queryFn: async () => {
      const res = await insightsFn({ data: { months: activeMonths } });
      return res;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: activeMonths.length > 0,
  });

  const categorize = useMutation({
    mutationFn: async () => categorizeFn(),
    onMutate: () => setErrMsg(null),
    onSuccess: (res) => {
      toast.success(`Categorized ${res.updated} of ${res.total} transactions`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["insights"] });
    },
    onError: (e: Error) => {
      setErrMsg(e.message);
      toast.error(e.message);
    },
  });

  const isDebit = (t: Txn) => t.transaction_type.toLowerCase() === "debit";
  const isSpend = (t: Txn) =>
    isDebit(t) && t.category !== "Salary/Income" && t.category !== "Transfers (P2P)";

  const filteredTxns = useMemo(
    () => txns.filter((t) => activeMonthSet.has(monthKey(new Date(t.transaction_date)))),
    [txns, activeMonthSet],
  );

  const periodSpend = filteredTxns.filter(isSpend).reduce((s, t) => s + Number(t.amount), 0);

  const categoryTotals = new Map<string, number>();
  for (const t of filteredTxns) {
    if (!isSpend(t) || !t.category) continue;
    categoryTotals.set(t.category, (categoryTotals.get(t.category) ?? 0) + Number(t.amount));
  }
  const spendingCategories = Array.from(categoryTotals.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  const topCategory = spendingCategories[0] ?? null;
  const maxCategoryTotal = topCategory?.total ?? 0;

  const recent = filteredTxns.slice(0, 10);

  // Trends: category-wise spend per month across ALL months
  const { trendData, trendCategories } = useMemo(() => {
    const monthCatTotals = new Map<string, Map<string, number>>();
    const catAllTime = new Map<string, number>();
    for (const t of txns) {
      if (!isSpend(t) || !t.category) continue;
      const mk = monthKey(new Date(t.transaction_date));
      const inner = monthCatTotals.get(mk) ?? new Map<string, number>();
      inner.set(t.category, (inner.get(t.category) ?? 0) + Number(t.amount));
      monthCatTotals.set(mk, inner);
      catAllTime.set(t.category, (catAllTime.get(t.category) ?? 0) + Number(t.amount));
    }
    const topCats = Array.from(catAllTime.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([n]) => n);
    const trendData = availableMonths.map((mk) => {
      const row: Record<string, number | string> = { month: monthLabel(mk) };
      const inner = monthCatTotals.get(mk);
      for (const c of topCats) row[c] = Math.round(inner?.get(c) ?? 0);
      return row;
    });
    return { trendData, trendCategories: topCats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, availableMonths]);

  const toggleMonth = (m: string) => {
    setSelectedMonths((prev) => {
      const base = prev ?? activeMonths;
      const set = new Set(base);
      if (set.has(m)) set.delete(m);
      else set.add(m);
      const next = Array.from(set).sort();
      return next.length === 0 ? [availableMonths[availableMonths.length - 1]] : next;
    });
  };

  const periodLabel =
    activeMonths.length === 0
      ? "—"
      : activeMonths.length === 1
        ? monthLabel(activeMonths[0])
        : `${activeMonths.length} months selected`;

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

      {availableMonths.length > 0 ? (
        <ClayCard className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Calendar className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground">Filter by Month</h2>
              <p className="text-xs text-muted-foreground">
                Select one or more months to combine totals
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableMonths.map((m) => {
              const active = activeMonthSet.has(m);
              return (
                <label
                  key={m}
                  className={
                    "flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-1.5 text-xs font-semibold transition-colors " +
                    (active
                      ? "bg-primary text-primary-foreground shadow-[var(--clay-primary-shadow)]"
                      : "bg-secondary text-foreground clay-hover")
                  }
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={active}
                    onChange={() => toggleMonth(m)}
                  />
                  {monthLabel(m)}
                </label>
              );
            })}
          </div>
        </ClayCard>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Spending"
          value={isLoading ? "…" : inr(periodSpend)}
          hint={periodLabel}
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
            label="Transactions"
            value={isLoading ? "…" : String(filteredTxns.length)}
            hint={periodLabel}
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
          <h2 className="text-base font-bold text-foreground">Category Trends</h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            All months
          </span>
        </div>
        {trendData.length === 0 || trendCategories.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-2xl bg-secondary/60 clay-inset">
            <BarChart3 className="h-8 w-8 text-muted-foreground" strokeWidth={1.8} />
            <p className="text-sm text-muted-foreground">Not enough data for trends yet</p>
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  formatter={(v: number) => inr(Number(v))}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {trendCategories.map((c, i) => (
                  <Line
                    key={c}
                    type="monotone"
                    dataKey={c}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </ClayCard>

      <ClayCard className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">Recent Transactions</h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            {activeMonths.length === 1 ? "Selected month" : "Selected period"}
          </span>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : recent.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-3 rounded-2xl bg-secondary/60 clay-inset">
            <BarChart3 className="h-8 w-8 text-muted-foreground" strokeWidth={1.8} />
            <p className="text-sm text-muted-foreground">No transactions in this selection</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {recent.map((t) => {
              const debit = t.transaction_type.toLowerCase() === "debit";
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <div
                    className={
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
                      (debit
                        ? "bg-destructive/10 text-destructive"
                        : "bg-success/10 text-success")
                    }
                  >
                    {debit ? (
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
                      (debit ? "text-destructive" : "text-success")
                    }
                  >
                    {debit ? "−" : "+"}
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
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground">AI Insights</h2>
              <p className="text-xs text-muted-foreground">
                {activeMonths.length >= 2 ? "Comparative view" : "Single-month view"} · {periodLabel}
              </p>
            </div>
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
        ) : insights.data && insights.data.insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.data.insights.map((line, i) => (
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
