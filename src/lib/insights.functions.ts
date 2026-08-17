import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Txn = {
  id: string;
  transaction_date: string;
  merchant_raw: string;
  amount: number;
  transaction_type: string;
  category: string | null;
};

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
};

const InputSchema = z
  .object({ months: z.array(z.string()).optional() })
  .optional();

export const generateInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    const { data: rows, error } = await supabase
      .from("transactions")
      .select("id, transaction_date, merchant_raw, amount, transaction_type, category")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const txns = (rows ?? []) as Txn[];

    const isDebit = (t: Txn) => t.transaction_type.toLowerCase() === "debit";
    const isSpend = (t: Txn) =>
      isDebit(t) && t.category !== "Salary/Income" && t.category !== "Transfers (P2P)";

    // Group by month
    const byMonth = new Map<string, Txn[]>();
    for (const t of txns) {
      const k = monthKey(new Date(t.transaction_date));
      const arr = byMonth.get(k) ?? [];
      arr.push(t);
      byMonth.set(k, arr);
    }
    const allMonths = Array.from(byMonth.keys()).sort();

    // Determine target months
    let selected = (data?.months ?? []).filter((m) => byMonth.has(m)).sort();
    if (selected.length === 0) {
      // default: latest month present, else current
      selected = allMonths.length ? [allMonths[allMonths.length - 1]] : [monthKey(new Date())];
    }

    const aggregateMonth = (key: string) => {
      const list = byMonth.get(key) ?? [];
      let spend = 0;
      const catTotals = new Map<string, number>();
      const catCounts = new Map<string, number>();
      let largest: Txn | null = null;
      for (const t of list) {
        const amt = Number(t.amount);
        if (isSpend(t)) {
          spend += amt;
          const cat = t.category ?? "Uncategorized";
          catTotals.set(cat, (catTotals.get(cat) ?? 0) + amt);
          catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
        }
        if (
          isDebit(t) &&
          t.category !== "Salary/Income" &&
          t.category !== "Rent" &&
          (!largest || amt > Number(largest.amount))
        ) {
          largest = t;
        }
      }
      const totalOr1 = spend || 1;
      const categories = Array.from(catTotals.entries())
        .map(([name, total]) => ({
          name,
          total: Math.round(total),
          count: catCounts.get(name) ?? 0,
          pct: Math.round((total / totalOr1) * 1000) / 10,
        }))
        .sort((a, b) => b.total - a.total);
      return {
        key,
        label: monthLabel(key),
        total_spend: Math.round(spend),
        categories,
        largest_transaction: largest
          ? {
              merchant: largest.merchant_raw,
              amount: Math.round(Number(largest.amount)),
              category: largest.category,
              date: largest.transaction_date,
            }
          : null,
      };
    };

    const perMonth = selected.map(aggregateMonth);
    const comparative = perMonth.length >= 2;

    let prompt: string;
    let summaryOut: Record<string, unknown>;

    if (comparative) {
      // Build per-category deltas across selected months (earliest -> latest)
      const first = perMonth[0];
      const last = perMonth[perMonth.length - 1];
      const catNames = new Set<string>();
      for (const m of perMonth) m.categories.forEach((c) => catNames.add(c.name));
      const deltas = Array.from(catNames)
        .map((name) => {
          const a = first.categories.find((c) => c.name === name)?.total ?? 0;
          const b = last.categories.find((c) => c.name === name)?.total ?? 0;
          const abs = b - a;
          const pct = a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null;
          return { category: name, first_total: a, last_total: b, abs_change: abs, pct_change: pct };
        })
        .sort((x, y) => Math.abs(y.abs_change) - Math.abs(x.abs_change));

      const totalDeltaPct =
        first.total_spend > 0
          ? Math.round(((last.total_spend - first.total_spend) / first.total_spend) * 1000) / 10
          : null;

      summaryOut = {
        currency: "INR",
        mode: "comparative",
        months: perMonth.map((m) => ({ key: m.key, label: m.label, total_spend: m.total_spend })),
        first_month: { label: first.label, total_spend: first.total_spend },
        last_month: { label: last.label, total_spend: last.total_spend },
        overall_pct_change: totalDeltaPct,
        category_deltas: deltas,
      };

      prompt = `You are a personal finance coach for a young Indian salaried professional. Compare spending across the selected months and produce EXACTLY 3 short comparative insights.

Rules:
- Each insight: ONE sentence, plain language, MUST reference actual numbers/categories from the data.
- Use ₹ for amounts (no decimals). Compare ${first.label} vs ${last.label} (or across all selected months when relevant).
- Cover: (1) overall spend change with ₹ and %, (2) the category with the biggest increase (₹ and %), (3) the category with the biggest decrease OR a notable stable/large category — reference the ₹ and %.
- Phrase like: "Food spending increased 18% (₹1,200) compared to ${first.label}."
- Respond with STRICTLY valid JSON: {"insights": ["...", "...", "..."]}. No prose, no markdown, no code fences.

Data:
${JSON.stringify(summaryOut)}`;
    } else {
      const only = perMonth[0];
      summaryOut = {
        currency: "INR",
        mode: "single",
        month: { label: only.label, total_spend: only.total_spend },
        categories: only.categories,
        largest_transaction: only.largest_transaction,
      };

      prompt = `You are a personal finance coach for a young Indian salaried professional. Based ONLY on the aggregated summary below, produce EXACTLY 3 short insights.

Rules:
- Each insight: ONE sentence, plain language, MUST reference actual numbers/categories/merchants from the data.
- Use ₹ for amounts (no decimals). Do NOT give generic advice.
- Cover: (1) top spending category with amount and % share, (2) a notable secondary category with amount, (3) largest single transaction with merchant and amount.
- Respond with STRICTLY valid JSON: {"insights": ["...", "...", "..."]}. No prose, no markdown, no code fences.

Data:
${JSON.stringify(summaryOut)}`;
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      if (resp.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
      if (resp.status === 402) throw new Error("AI credits exhausted. Please add credits in your workspace.");
      throw new Error(`AI Gateway error [${resp.status}]: ${body}`);
    }

    const json = await resp.json();
    const text: string | undefined = json?.choices?.[0]?.message?.content ?? undefined;
    if (!text) throw new Error("Empty response from AI");

    let insights: string[];
    try {
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
      const obj = JSON.parse(cleaned);
      const arr = Array.isArray(obj) ? obj : obj?.insights;
      if (!Array.isArray(arr)) throw new Error("not an array");
      insights = arr.filter((x): x is string => typeof x === "string").slice(0, 3);
      if (insights.length === 0) throw new Error("empty");
    } catch {
      throw new Error("Failed to parse AI response");
    }

    return { insights, comparative, selected_months: selected };
  });
