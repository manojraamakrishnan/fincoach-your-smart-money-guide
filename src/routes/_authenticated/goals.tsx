import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Target, Sparkles, Loader2, ArrowLeft, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { ClayCard } from "@/components/ClayCard";
import { GoalMarkdown } from "@/components/GoalMarkdown";
import { Slider } from "@/components/ui/slider";
import { parseGoal, buildGoalPlan } from "@/lib/goals.functions";
import { BUCKET_RETURNS } from "@/lib/goal-math";
import type { BucketType, RiskAppetite } from "@/lib/goal-math";

export const Route = createFileRoute("/_authenticated/goals")({
  head: () => ({
    meta: [
      { title: "Goal Planner — FinCoach" },
      {
        name: "description",
        content: "Turn a savings goal into a monthly FD, SIP and Gold investment plan.",
      },
      { property: "og:title", content: "Goal Planner — FinCoach" },
      {
        property: "og:description",
        content: "Turn a savings goal into a monthly FD, SIP and Gold investment plan.",
      },
    ],
  }),
  component: GoalsPage,
});

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const BUCKETS: BucketType[] = [
  "FD",
  "SIP-Equity",
  "SIP-Debt",
  "RD",
  "Gold",
  "PPF",
  "NPS",
  "Liquid Fund",
];
const MAX_BUCKETS = 5;
const RISK_OPTIONS: RiskAppetite[] = ["Low", "Medium", "High"];

type Goal = { goal_name: string; goal_amount: number; timeline_months: number };

function GoalsPage() {
  const parseFn = useServerFn(parseGoal);
  const planFn = useServerFn(buildGoalPlan);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState("");
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [goal, setGoal] = useState<Goal | null>(null);

  const emptySplits = (): Record<BucketType, number> =>
    Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<BucketType, number>;

  const [selected, setSelected] = useState<BucketType[]>(["SIP-Equity"]);
  const [splits, setSplits] = useState<Record<BucketType, number>>({
    ...emptySplits(),
    "SIP-Equity": 100,
  });
  const [stepUp, setStepUp] = useState(0);
  const [riskAppetite, setRiskAppetite] = useState<RiskAppetite>("Medium");

  const totalSplit = useMemo(
    () => selected.reduce((s, b) => s + (splits[b] ?? 0), 0),
    [selected, splits],
  );

  const parse = useMutation({
    mutationFn: async () => parseFn({ data: { text, answer: answer || undefined } }),
    onSuccess: (res) => {
      if (res.goal_amount && res.timeline_months) {
        setGoal({
          goal_name: res.goal_name ?? "My goal",
          goal_amount: res.goal_amount,
          timeline_months: res.timeline_months,
        });
        setFollowUp(null);
        setStep(2);
      } else {
        setFollowUp(res.follow_up_question ?? "Could you share the amount and the timeline?");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const build = useMutation({
    mutationFn: async () => {
      if (!goal) throw new Error("No goal");
      return planFn({
        data: {
          ...goal,
          step_up_rate: stepUp,
          risk_appetite: riskAppetite,
          buckets: selected.map((b) => ({ bucket_name: b, split_percentage: splits[b] })),
        },
      });
    },
    onSuccess: () => setStep(3),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBucket = (b: BucketType) => {
    setSelected((prev) => {
      const isRemoving = prev.includes(b);
      if (!isRemoving && prev.length >= MAX_BUCKETS) {
        toast.error(`You can select up to ${MAX_BUCKETS} buckets.`);
        return prev;
      }
      const next = isRemoving ? prev.filter((x) => x !== b) : [...prev, b];
      if (next.length === 0) return prev;
      const even = Math.floor(100 / next.length);
      const map = emptySplits();
      next.forEach((k, i) => (map[k] = i === 0 ? 100 - even * (next.length - 1) : even));
      setSplits(map);
      return next;
    });
  };

  const setSplit = (b: BucketType, v: number) => setSplits((p) => ({ ...p, [b]: v }));

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--clay-primary-shadow)]">
          <Target className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Step {step} of 3</p>
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-foreground">
            Goal Planner
          </h1>
        </div>
      </header>

      {step === 1 && (
        <ClayCard className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-foreground">What are you saving for?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Type it naturally, e.g. “₹1.2L for a bike in 18 months”.
            </p>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="₹1.2L for a bike in 18 months"
            className="w-full resize-none rounded-2xl bg-secondary/60 p-4 text-sm text-foreground outline-none ring-primary/30 placeholder:text-muted-foreground focus:ring-2"
          />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Risk appetite</p>
            <div className="flex gap-2">
              {RISK_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRiskAppetite(r)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    riskAppetite === r
                      ? "bg-primary text-primary-foreground shadow-[var(--clay-primary-shadow)]"
                      : "bg-secondary/60 text-muted-foreground"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          {followUp && (
            <div className="space-y-2 rounded-2xl bg-accent/10 p-4">
              <p className="text-sm font-semibold text-foreground">{followUp}</p>
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer"
                className="w-full rounded-xl bg-card px-3 py-2 text-sm outline-none ring-primary/30 focus:ring-2"
              />
            </div>
          )}
          <button
            type="button"
            disabled={!text.trim() || parse.isPending}
            onClick={() => parse.mutate()}
            className="clay-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--clay-primary-shadow)] disabled:opacity-60"
          >
            {parse.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {followUp ? "Continue" : "Understand my goal"}
          </button>
        </ClayCard>
      )}

      {step === 2 && goal && (
        <>
          <ClayCard>
            <p className="text-sm text-muted-foreground">Your goal</p>
            <p className="text-lg font-bold text-foreground">{goal.goal_name}</p>
            <p className="text-sm text-muted-foreground">
              {inr(goal.goal_amount)} in {goal.timeline_months} months
            </p>
          </ClayCard>

          <ClayCard className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-foreground">Pick your buckets</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick up to {MAX_BUCKETS}. Splits must add up to 100%.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Returns shown are long-term historical averages (RBI/AMFI/MCX), not
                predictions — actual returns are not guaranteed.
              </p>
            </div>

            <div className="space-y-4">
              {BUCKETS.map((b) => {
                const on = selected.includes(b);
                return (
                  <div key={b} className="space-y-3 rounded-2xl bg-secondary/50 p-4">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleBucket(b)}
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                      />
                      <span className="text-sm font-semibold text-foreground">{b}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {BUCKET_RETURNS[b]}% hist. avg
                      </span>
                    </label>
                    {on && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Split</span>
                          <span className="font-semibold text-foreground">{splits[b]}%</span>
                        </div>
                        <Slider
                          value={[splits[b]]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={(v) => setSplit(b, v[0])}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-secondary/50 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Total split</span>
              <span
                className={
                  totalSplit === 100 ? "font-bold text-[#22C55E]" : "font-bold text-destructive"
                }
              >
                {totalSplit}%
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="stepup">
                Annual step-up (optional)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="stepup"
                  type="number"
                  min={0}
                  max={100}
                  value={stepUp}
                  onChange={(e) => setStepUp(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                  className="w-24 rounded-xl bg-secondary/60 px-3 py-2 text-sm outline-none ring-primary/30 focus:ring-2"
                />
                <span className="text-sm text-muted-foreground">% increase per year</span>
              </div>
            </div>
          </ClayCard>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="clay-hover flex items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-semibold text-foreground clay-sm"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              disabled={totalSplit !== 100 || build.isPending}
              onClick={() => build.mutate()}
              className="clay-hover flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--clay-primary-shadow)] disabled:opacity-60"
            >
              {build.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PiggyBank className="h-4 w-4" />
              )}
              Calculate plan
            </button>
          </div>
        </>
      )}

      {step === 3 && build.data && goal && (
        <>
          <ClayCard className="space-y-1">
            <p className="text-sm text-muted-foreground">{goal.goal_name}</p>
            <p className="text-2xl font-extrabold text-foreground">
              {inr(build.data.plan.total_monthly_amount)}
              <span className="text-sm font-medium text-muted-foreground">/month</span>
            </p>
            <p className="text-sm text-muted-foreground">
              to reach {inr(goal.goal_amount)} in {goal.timeline_months} months
            </p>
          </ClayCard>

          <ClayCard className="space-y-3">
            {build.data.plan.buckets.map((b) => (
              <div key={b.bucket_name} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-foreground">{b.bucket_name}</span>
                <span className="text-muted-foreground">
                  {inr(b.monthly_amount)}/mo · {b.assumed_return}%
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Avg monthly surplus</span>
              <span className="font-semibold text-foreground">
                {inr(build.data.feasibility.surplus_amount)}
              </span>
            </div>
            {build.data.feasibility.shortfall_amount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Shortfall</span>
                <span className="font-semibold text-destructive">
                  {inr(build.data.feasibility.shortfall_amount)}
                </span>
              </div>
            )}
          </ClayCard>

          <ClayCard className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">Your plan</h2>
            </div>
            <GoalMarkdown content={build.data.narration} />
          </ClayCard>

          <button
            type="button"
            onClick={() => {
              build.reset();
              setStep(2);
            }}
            className="clay-hover flex w-full items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-semibold text-foreground clay-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Adjust buckets
          </button>
        </>
      )}
    </div>
  );
}