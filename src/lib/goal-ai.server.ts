import type { BucketResult } from "./goal-math";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callGemini(body: Record<string, unknown>): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
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
  bucket_results: BucketResult[];
  total_monthly_amount: number;
  monthly_surplus: number;
  shortfall_amount: number;
  discretionary_category: string;
};

const NARRATION_SYSTEM = `You are generating a goal-planning summary. You will be given goal_name, goal_amount, timeline_months, bucket_results (array of bucket_name/monthly_amount/assumed_return), monthly_surplus, shortfall_amount, and discretionary_category. Output using this exact markdown structure and nothing else:

1. One bolded headline sentence stating the total monthly investment required.

2. A bullet list, one line per bucket: '- [bucket_name]: ₹[monthly_amount]/month (assumed [assumed_return]% avg return)'.

3. One bolded feasibility line comparing total_monthly_amount to monthly_surplus.

4. IF shortfall_amount > 0: a bulleted list of exactly 3 options — extend timeline, reduce goal amount, or cut spending in [discretionary_category] — each with a one-line concrete suggestion.

5. A maximum 2-sentence plain-text explanation of why the allocation looks the way it does, only if not obvious from the numbers.

6. These two lines verbatim, always last:

'Based on historical average returns — not guaranteed.'

'Illustrative only, not personalized investment advice. Consult a SEBI-registered advisor.'

Do not generate, alter, or estimate any number yourself — use only the numbers provided in the input. Do not add extra commentary, caveats, or advice beyond this structure.`;

export async function narrateGoalPlan(input: NarrationInput): Promise<string> {
  return callGemini({
    messages: [
      { role: "system", content: NARRATION_SYSTEM },
      { role: "user", content: JSON.stringify(input) },
    ],
  });
}
