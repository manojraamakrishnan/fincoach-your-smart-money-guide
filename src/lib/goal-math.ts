// Plain TS math for the Goal Planner. No AI involved here.

export const BUCKET_RETURNS: Record<BucketType, number> = {
  FD: 6.5,
  SIP: 11,
  Gold: 7.5,
};

export type BucketType = "FD" | "SIP" | "Gold";

export type BucketInput = {
  bucket_name: BucketType;
  split_percentage: number;
  assumed_return_rate: number;
};

export type BucketResult = {
  bucket_name: BucketType;
  monthly_amount: number;
  assumed_return: number;
};

export type PlanResult = {
  buckets: BucketResult[];
  total_monthly_amount: number;
};

/**
 * Future value accumulated by investing 1 unit in month 1, where the monthly
 * contribution grows by `stepUpRate`% at every 12-month anniversary, and the
 * balance compounds monthly at `annualRate`%.
 * FV is linear in the contribution, so required monthly = target / factor.
 */
export function futureValueFactor(
  timelineMonths: number,
  annualRate: number,
  stepUpRate: number,
): number {
  const r = annualRate / 100 / 12;
  const step = stepUpRate / 100;
  let balance = 0;
  let contribution = 1;
  for (let m = 0; m < timelineMonths; m++) {
    if (m > 0 && m % 12 === 0) contribution *= 1 + step;
    balance = (balance + contribution) * (1 + r);
  }
  return balance;
}

export function calculatePlan(
  goalAmount: number,
  timelineMonths: number,
  stepUpRate: number,
  buckets: BucketInput[],
): PlanResult {
  const results: BucketResult[] = buckets.map((b) => {
    const target = (goalAmount * b.split_percentage) / 100;
    const factor = futureValueFactor(timelineMonths, b.assumed_return_rate, stepUpRate);
    const monthly = factor > 0 ? target / factor : 0;
    return {
      bucket_name: b.bucket_name,
      monthly_amount: Math.round(monthly),
      assumed_return: b.assumed_return_rate,
    };
  });
  return {
    buckets: results,
    total_monthly_amount: results.reduce((s, b) => s + b.monthly_amount, 0),
  };
}

export type FeasibilityTxn = {
  transaction_date: string;
  amount: number;
  transaction_type: string;
  category: string | null;
};

export type Feasibility = {
  surplus_amount: number;
  shortfall_amount: number;
  discretionary_category: string;
  months_considered: string[];
};

const NON_DISCRETIONARY = new Set([
  "Rent",
  "Utilities",
  "Groceries",
  "Health",
  "Salary/Income",
  "Transfers (P2P)",
]);

const mKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Average monthly surplus (income - expenses) over the last 3 months of data. */
export function calculateFeasibility(
  txns: FeasibilityTxn[],
  totalMonthlyAmount: number,
): Feasibility {
  const months = Array.from(new Set(txns.map((t) => mKey(new Date(t.transaction_date)))))
    .sort()
    .slice(-3);
  const set = new Set(months);
  const recent = txns.filter((t) => set.has(mKey(new Date(t.transaction_date))));

  let income = 0;
  let expense = 0;
  const catTotals = new Map<string, number>();

  for (const t of recent) {
    const amt = Number(t.amount);
    const isCredit = t.transaction_type.toLowerCase() === "credit";
    if (isCredit) {
      income += amt;
      continue;
    }
    if (t.category === "Transfers (P2P)" || t.category === "Salary/Income") continue;
    expense += amt;
    const cat = t.category ?? "Uncategorized";
    if (!NON_DISCRETIONARY.has(cat) && cat !== "Uncategorized") {
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + amt);
    }
  }

  const n = months.length || 1;
  const surplus = Math.round((income - expense) / n);
  const shortfall = Math.max(0, Math.round(totalMonthlyAmount - surplus));
  const top = Array.from(catTotals.entries()).sort((a, b) => b[1] - a[1])[0];

  return {
    surplus_amount: surplus,
    shortfall_amount: shortfall,
    discretionary_category: top?.[0] ?? "Shopping",
    months_considered: months,
  };
}
