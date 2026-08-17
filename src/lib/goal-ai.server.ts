import type { BucketResult, BucketType, RiskAppetite, LoanOption } from "./goal-math";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callGemini(body: Record<string, unknown>): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const resp = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", ...body }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (resp.status === 402) throw new Error("AI credits exhausted. Please add credits in your workspace.");
    throw new Error(`AI Gateway error [${resp.status}]: ${text}`);
  }
  const json = await resp.json();
  const content: string | undefined = json?.choices?.[0]?.message?.content ?? undefined;
  if (!content) throw new Error("Empty response from AI");
  return content;
}

export type ParsedGoal = {
  goal_name: string | null;
  goal_amount: number | null;
  timeline_months: number | null;
  follow_up_question: string | null;
};

export async function parseGoalText(text: string, extra?: string): Promise<ParsedGoal> {
  const prompt = `Extract a savings goal from the user's message. Amounts may use Indian shorthand (1.2L = 120000, 2Cr = 20000000, 50k = 50000).

Return STRICTLY valid JSON only:
{"goal_name": string|null, "goal_amount": number|null, "timeline_months": number|null, "follow_up_question": string|null}

Rules:
- goal_name: short noun phrase, e.g. "Bike", "Europe trip".
- goal_amount: plain number in rupees, no symbols.
- timeline_months: whole number of months (convert years).
- If goal_amount OR timeline_months is missing/unclear, set it null and write ONE short follow-up question asking only for the missing piece. Otherwise follow_up_question must be null.
- No markdown, no code fences.

User message: ${JSON.stringify(text)}${extra ? `\nUser's answer to your follow-up: ${JSON.stringify(extra)}` : ""}`;

  const raw = await callGemini({
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    throw new Error("Could not understand that goal. Try: \"₹1.2L for a bike in 18 months\"");
  }
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);
  return {
    goal_name: typeof obj.goal_name === "string" && obj.goal_name.trim() ? obj.goal_name.trim() : null,
    goal_amount: num(obj.goal_amount),
    timeline_months: num(obj.timeline_months) ? Math.round(Number(obj.timeline_months)) : null,
    follow_up_question:
      typeof obj.follow_up_question === "string" && obj.follow_up_question.trim()
        ? obj.follow_up_question.trim()
        : null,
  };
}

export type NarrationInput = {
  goal_name: string;
  goal_amount: number;
  timeline_months: number;
  risk_appetite: RiskAppetite;
  bucket_results: BucketResult[];
  total_monthly_amount: number;
  user_chosen_split: { bucket_name: BucketType; split_percentage: number }[];
  monthly_surplus: number;
  shortfall_amount: number;
  discretionary_category: string;
  risk_split_table: Record<RiskAppetite, { equity: number; stable: number }>;
  loan_options: LoanOption[];
};

const NARRATION_SYSTEM = `You are generating a goal-planning summary. You will be given goal_name, goal_amount, timeline_months, risk_appetite, bucket_results (array of bucket_name/monthly_amount/assumed_return), total_monthly_amount, user_chosen_split (array of bucket_name/split_percentage), monthly_surplus, shortfall_amount, discretionary_category, risk_split_table (equity vs stable % benchmark per risk_appetite tier — SIP-Equity and NPS count as "equity-type", all other buckets count as "stable"), and loan_options (array of name/rate_range/tenure). Output using this exact markdown structure and nothing else:

1. One bolded headline sentence stating the total monthly investment required.

2. A bullet list, one line per bucket: '- [bucket_name]: ₹[monthly_amount]/month (assumed [assumed_return]% historical average return)'.

3. One bolded feasibility line comparing total_monthly_amount to monthly_surplus.

4. IF shortfall_amount > 0: a bulleted list — first 2-3 items are concrete spending-cut suggestions based on discretionary_category, and the LAST item is labeled "Last resort — funding gap via loan" listing the loan_options with a one-line warning that loan interest may exceed investment returns, so this should only be considered if spending cuts and timeline extension aren't enough.

5. Compare user_chosen_split's equity-type percentage (sum of SIP-Equity and NPS splits) against risk_split_table's equity percentage for this risk_appetite. If they differ by more than 10 percentage points, state the difference and explain briefly (max 2-3 sentences, plain text) why a split closer to the benchmark may suit their risk_appetite and timeline better. If they're close, skip this section entirely.

6. These two lines verbatim, always last:

'Historical averages shown, not predictions — actual returns are not guaranteed.'

'Illustrative only, not personalized investment or loan advice. Consult a SEBI-registered advisor.'

Do not generate, alter, predict, or estimate any number yourself — use only the numbers and tables provided in the input. Do not add extra commentary, caveats, or advice beyond this structure.`;

export async function narrateGoalPlan(input: NarrationInput): Promise<string> {
  return callGemini({
    messages: [
      { role: "system", content: NARRATION_SYSTEM },
      { role: "user", content: JSON.stringify(input) },
    ],
  });
}