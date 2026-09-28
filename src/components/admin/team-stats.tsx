import { ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { AdminUser } from "@/lib/admin";

/**
 * The figures above the team roster — for whoever is responsible for who is on
 * the team, not for everybody on it.
 *
 * Counts are derived here rather than passed in as four numbers: the caller
 * already has the rows, and splitting the derivation from the display is what
 * lets the two disagree.
 *
 * The rows are already scoped by the caller, so a manager's counts describe
 * their own reports.
 */
export function TeamStats({ members }: { members: AdminUser[] }) {
  const active = members.filter((member) => member.active).length;
  const privileged = members.filter((member) => member.role === "admin").length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        icon={Users}
        tone="primary"
        value={members.length.toString()}
        label="Team Members"
        hint="In this workspace"
      />
      <KpiCard
        icon={UserCheck}
        tone="success"
        value={active.toString()}
        label="Active"
        hint="Can sign in"
      />
      <KpiCard
        icon={UserX}
        tone="destructive"
        value={(members.length - active).toString()}
        label="Disabled"
        hint="Sign-in blocked"
      />
      <KpiCard
        icon={ShieldCheck}
        tone="warning"
        value={privileged.toString()}
        label="Owners & Admins"
        hint="Elevated access"
      />
    </div>
  );
}
