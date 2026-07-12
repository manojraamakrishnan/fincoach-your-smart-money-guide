import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { User, LogOut, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { ClayCard } from "@/components/ClayCard";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — FinCoach" },
      { name: "description", content: "Manage your FinCoach account." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  }

  const email = user?.email ?? "—";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account</p>
      </header>

      <ClayCard className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
          <User className="h-9 w-9" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-foreground">
            {email.split("@")[0]}
          </p>
          <p className="truncate text-sm text-muted-foreground">{email}</p>
        </div>
      </ClayCard>

      <ClayCard className="divide-y divide-border p-0">
        <div className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <Mail className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="truncate text-sm font-medium text-foreground">{email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
            <ShieldCheck className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Account status</p>
            <p className="text-sm font-medium text-foreground">Active</p>
          </div>
        </div>
      </ClayCard>

      <button
        type="button"
        onClick={handleSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card py-3.5 text-sm font-semibold text-destructive clay-sm transition-all hover:brightness-[0.98] active:scale-[0.99]"
      >
        <LogOut className="h-4 w-4" strokeWidth={2.2} />
        Log out
      </button>
    </div>
  );
}
