import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Upload, User, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/upload", label: "Upload", icon: Upload },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/profile", label: "Profile", icon: User },
] as const;


export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
      <div className="mx-auto flex max-w-md items-center justify-around gap-1 rounded-3xl bg-card/90 p-2 backdrop-blur-md clay-sm">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-muted-foreground transition-colors"
            activeProps={{ className: "text-primary" }}
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl transition-all",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground group-hover:bg-secondary",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <span className="text-[11px] font-medium">{label}</span>
              </>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
