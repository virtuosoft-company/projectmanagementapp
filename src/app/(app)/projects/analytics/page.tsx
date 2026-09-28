import type { Metadata } from "next";
import { Calendar, ChevronDown, Download, Filter, TrendingDown, TrendingUp } from "lucide-react";
import { TimesheetChart } from "@/components/dashboard/timesheet-chart";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay } from "@/lib/domain";
import { getEntryDetails, getHoursByDay, getMetrics } from "@/lib/queries";
import { projectScope, requirePage } from "@/lib/session";
import { cn, formatDuration } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const viewer = await requirePage("analytics");

  const [metrics, entries, hoursByDay] = await Promise.all([
    getMetrics(viewer.workspaceId, {
      projects: await projectScope(),
    }),
    getEntryDetails(viewer.workspaceId),
    getHoursByDay(viewer.workspaceId),
  ]);

  // The estimate baseline counts each entry against its task's estimate, which
  // is how the variance column adds up to the totals below.
  const estimateHours = entries.reduce((sum, entry) => sum + entry.task.estimateHours, 0);
  const variance = estimateHours - metrics.totalHoursExact;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Timesheets &amp; variance analysis
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card className="shadow-none">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 px-6">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Button variant="outline" size="sm" className="gap-2">
            All Users
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
          <Button variant="outline" size="sm" className="gap-2 font-normal">
            <Calendar className="h-4 w-4" />
            Pick a date range
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Total Logged" value={formatDuration(metrics.totalHoursExact)} />
        <Metric
          label="Tracked"
          value={formatDuration(metrics.totalHoursExact)}
        />
        <Metric
          label="Variance"
          value={formatDuration(Math.abs(variance))}
          badge={variance >= 0 ? "under" : "over"}
          hint={`${formatDuration(metrics.totalHoursExact)} actual / ${formatDuration(estimateHours)} est`}
        />
      </div>

      <Card className="shadow-none">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>Timesheet</CardTitle>
          <span className="text-xs text-muted-foreground">Daily</span>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <TimesheetChart
              data={hoursByDay.map((point) => ({ date: point.date, hours: point.hours }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>Detailed Entries</CardTitle>
          <span className="text-xs text-muted-foreground">{entries.length} entries</span>
        </CardHeader>
        <CardContent>
          <div className="relative w-full overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="text-left text-xs text-muted-foreground">
                  <Th>Date</Th>
                  <Th>User</Th>
                  <Th>Task</Th>
                  <Th>Project</Th>
                  <Th className="text-right">Duration</Th>
                  <Th className="text-right">Variance</Th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b transition-colors hover:bg-muted/50">
                    <Td className="whitespace-nowrap font-mono">{formatDay(entry.date)}</Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <UserAvatar
                          name={entry.member.name}
                          className="h-6 w-6 bg-primary/10"
                          textClassName="text-[10px] text-primary"
                        />
                        <span className="whitespace-nowrap">
                          {entry.member.name.split(" ")[0]}
                        </span>
                      </span>
                    </Td>
                    <Td>{entry.task.title}</Td>
                    <Td className="text-muted-foreground">{entry.project.name}</Td>
                    <Td className="whitespace-nowrap text-right font-mono">
                      {formatDuration(entry.hours)}
                    </Td>
                    <Td
                      className={cn(
                        "whitespace-nowrap text-right font-mono",
                        entry.variance < 0 && "text-destructive",
                      )}
                    >
                      {entry.variance < 0 ? "+" : ""}
                      {formatDuration(Math.abs(entry.variance))}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  badge?: "under" | "over";
}) {
  const TrendIcon = badge === "over" ? TrendingUp : TrendingDown;

  return (
    <Card className="shadow-none">
      <CardContent className="p-4 px-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <p className="font-mono text-2xl font-bold">{value}</p>
          {badge ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                badge === "under"
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              <TrendIcon className="h-3 w-3" />({badge})
            </span>
          ) : null}
        </div>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 font-medium", className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children}</td>;
}
