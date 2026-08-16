import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseGoalText, narrateGoalPlan } from "./goal-ai.server";
import {
  calculatePlan,
  calculateFeasibility,
  BUCKET_RETURNS,
  RISK_SPLIT_TABLE,
  LOAN_OPTIONS,
} from "./goal-math";
import type { BucketType, FeasibilityTxn, RiskAppetite } from "./goal-math";

const BUCKET_ENUM = [
  "FD",
  "SIP-Equity",
  "SIP-Debt",
  "RD",
  "Gold",
  "PPF",
  "NPS",
  "Liquid Fund",
] as const;

export const parseGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ text: z.string().min(1), answer: z.string().optional() }).parse(data),
  )
  .handler(async ({ data }) => parseGoalText(data.text, data.answer));

export const buildGoalPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        goal_name: z.string().min(1),
        goal_amount: z.number().positive(),
        timeline_months: z.number().int().positive(),
        step_up_rate: z.number().min(0).max(100),
        risk_appetite: z.enum(["High", "Medium", "Low"]),
        buckets: z
          .array(
            z.object({
              bucket_name: z.enum(BUCKET_ENUM),
              split_percentage: z.number().min(0).max(100),
            }),
          )
          .min(1)
          .max(5),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const buckets = data.buckets.map((b) => ({
      bucket_name: b.bucket_name as BucketType,
      split_percentage: b.split_percentage,
      assumed_return_rate: BUCKET_RETURNS[b.bucket_name as BucketType],
    }));

    const plan = calculatePlan(
      data.goal_amount,
      data.timeline_months,
      data.step_up_rate,
      buckets,
    );

    const { data: rows, error } = await supabase
      .from("transactions")
      .select("transaction_date, amount, transaction_type, category")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const feasibility = calculateFeasibility(
      (rows ?? []) as FeasibilityTxn[],
      plan.total_monthly_amount,
    );

    const { data: goalRow, error: goalErr } = await supabase
      .from("goals")
      .insert({
        user_id: userId,
        goal_name: data.goal_name,
        goal_amount: data.goal_amount,
        timeline_months: data.timeline_months,
        step_up_rate: data.step_up_rate,
        risk_appetite: data.risk_appetite,
      })
      .select("id")
      .single();
    if (goalErr) throw new Error(goalErr.message);

    const { error: bucketErr } = await supabase.from("goal_buckets").insert(
      buckets.map((b) => ({
        goal_id: goalRow.id,
        bucket_type: b.bucket_name,
        split_percentage: b.split_percentage,
        assumed_return_rate: b.assumed_return_rate,
      })),
    );
    if (bucketErr) throw new Error(bucketErr.message);

    const narration = await narrateGoalPlan({
      goal_name: data.goal_name,
      goal_amount: data.goal_amount,
      timeline_months: data.timeline_months,
      risk_appetite: data.risk_appetite as RiskAppetite,
      bucket_results: plan.buckets,
      total_monthly_amount: plan.total_monthly_amount,
      user_chosen_split: data.buckets.map((b) => ({
        bucket_name: b.bucket_name as BucketType,
        split_percentage: b.split_percentage,
      })),
      monthly_surplus: feasibility.surplus_amount,
      shortfall_amount: feasibility.shortfall_amount,
      discretionary_category: feasibility.discretionary_category,
      risk_split_table: RISK_SPLIT_TABLE,
      loan_options: LOAN_OPTIONS,
    });

    return {
      goal_id: goalRow.id,
      plan,
      feasibility,
      narration,
    };
  });