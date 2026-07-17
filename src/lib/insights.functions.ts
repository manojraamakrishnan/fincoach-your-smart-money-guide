import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Txn = {
  id: string;
  transaction_date: string;
  merchant_raw: string;
  amount: number;
  transaction_type: string;
  category: string | null;
};

export const generateInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    const { data, error } = await supabase
      .from("transactions")
      .select("id, transaction_date, merchant_raw, amount, transaction_type, category")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const txns = (data ?? []) as Txn[];

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const isDebit = (t: Txn) => t.transaction_type.toLowerCase() === "debit";
    const isSpend = (t: Txn) =>
      isDebit(t) && t.category !== "Salary/Income" && t.category !== "Transfers (P2P)";

    let thisMonthSpend = 0;
    let lastMonthSpend = 0;
    const catTotals = new Map<string, number>();
    const catCounts = new Map<string, number>();
    let largest: Txn | null = null;

    for (const t of txns) {
      const d = new Date(t.transaction_date);
      const amt = Number(t.amount);
      if (isSpend(t)) {
        if (d >= thisMonthStart) thisMonthSpend += amt;
        else if (d >= lastMonthStart && d < thisMonthStart) lastMonthSpend += amt;
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

    const categories = Array.from(catTotals.entries())
      .map(([name, total]) => ({ name, total, count: catCounts.get(name) ?? 0 }))
      .sort((a, b) => b.total - a.total);

    const totalThis = thisMonthSpend || 1;
    const pctChange =
      lastMonthSpend > 0
        ? ((thisMonthSpend - lastMonthSpend) / lastMonthSpend) * 100
        : null;

    const summary = {
      currency: "INR",
      this_month: { label: now.toLocaleString("en-IN", { month: "long", year: "numeric" }), total_spend: Math.round(thisMonthSpend) },
      last_month: { label: new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" }), total_spend: Math.round(lastMonthSpend) },
      pct_change_vs_last_month: pctChange === null ? null : Math.round(pctChange * 10) / 10,
      categories: categories.map((c) => ({
        name: c.name,
        total: Math.round(c.total),
        count: c.count,
        pct_of_this_month: Math.round((c.total / totalThis) * 1000) / 10,
      })),
      largest_transaction: largest
        ? {
            merchant: largest.merchant_raw,
            amount: Math.round(Number(largest.amount)),
            category: largest.category,
            date: largest.transaction_date,
          }
        : null,
    };

    const prompt = `You are a personal finance coach for a young Indian salaried professional. Based ONLY on the aggregated summary below, produce EXACTLY 3 short insights.

Rules:
- Each insight: ONE sentence, plain language, MUST reference actual numbers/categories/merchants from the data.
- Use ₹ for amounts (no decimals). Do NOT give generic advice.
- Cover: (1) top spending category with amount and % share this month, (2) month-over-month change vs last month, (3) largest single transaction with merchant and amount.
- If a data point is missing (e.g. no last month data), adapt naturally but still be specific.
- Respond with STRICTLY valid JSON: {"insights": ["...", "...", "..."]}. No prose, no markdown, no code fences.

Data:
${JSON.stringify(summary)}`;

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

    return { insights, summary };
  });
