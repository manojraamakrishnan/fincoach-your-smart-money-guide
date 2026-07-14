import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Subscriptions",
  "Utilities",
  "Rent",
  "Shopping",
  "Entertainment",
  "Health",
  "Travel",
  "Transfers (P2P)",
  "Salary/Income",
  "Uncategorized",
];

export const categorizeTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const geminiKey = process.env.Gemini;
    if (!geminiKey) throw new Error("Gemini API key not configured");

    const { data: txns, error } = await supabase
      .from("transactions")
      .select("id, merchant_raw, amount, transaction_type")
      .eq("user_id", userId)
      .is("category", null);
    if (error) throw new Error(error.message);
    if (!txns || txns.length === 0) return { updated: 0, total: 0 };

    const list = txns
      .map(
        (t) =>
          `- transaction_id: ${t.id} | merchant: ${t.merchant_raw} | amount: ${t.amount} | type: ${t.transaction_type}`,
      )
      .join("\n");

    const prompt = `You are a financial transaction classifier. Classify each transaction into EXACTLY ONE of these categories:
${CATEGORIES.map((c) => `- ${c}`).join("\n")}

Rules:
- Treat every "Credit" type transaction as "Salary/Income" unless it is clearly something else.
- Use "Uncategorized" only if truly unclear from the merchant name.
- Respond with STRICTLY valid JSON: an array of objects with exactly two fields: "transaction_id" and "category". No prose, no markdown, no code fences.

Transactions:
${list}`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Gemini API error [${resp.status}]: ${body}`);
    }

    const json = await resp.json();
    const text: string | undefined =
      json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ??
      undefined;
    if (!text) throw new Error("Empty response from Gemini");

    let parsed: Array<{ transaction_id: string; category: string }>;
    try {
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error("not an array");
    } catch {
      throw new Error("Failed to parse AI response as JSON. No changes made.");
    }

    const validIds = new Set(txns.map((t) => t.id));
    const validCats = new Set(CATEGORIES);
    let updated = 0;
    for (const item of parsed) {
      if (!item?.transaction_id || !item?.category) continue;
      if (!validIds.has(item.transaction_id)) continue;
      if (!validCats.has(item.category)) continue;
      const { error: upErr } = await supabase
        .from("transactions")
        .update({ category: item.category })
        .eq("id", item.transaction_id)
        .eq("user_id", userId);
      if (!upErr) updated++;
    }

    return { updated, total: txns.length };
  });
