/**
 * Mobile Navigation
 * Bottom tab bar for small screens, replacing the sidebar below `lg`.
 *
 * Ported from the PropertyPro component of the same name: fixed bottom bar,
 * role-filtered tabs, icon over label, destructive count badge, and a spacer so
 * page content is never hidden behind it.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTabHref, visibleMobileTabs } from "@/components/navigation";
import { Badge } from "@/components/ui/badge";
import type { AppPage, Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export function MobileNavigation({
  pages,
  permissions,
  badges = {},
  className,
}: {
  /** The role's assigned pages — the same list the sidebar and `requirePage` use. */
  pages: readonly AppPage[];
  /** Its resolved permissions, for tabs that are not assignable pages. */
  permissions: readonly Permission[];
  badges?: Record<string, number>;
  className?: string;
}) {
  const pathname = usePathname();
  const tabs = visibleMobileTabs(pages, permissions, badges);
  const activeHref = activeTabHref(pathname, tabs);

  if (tabs.length === 0) return null;

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-md",
          "safe-area-pb lg:hidden",
          className,
        )}
      >
        <div className="flex items-stretch justify-around px-2 py-2">
          {tabs.map((tab) => {
            const isActive = tab.href === activeHref;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-3 py-2 text-xs font-medium",
                  "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <tab.icon className="h-5 w-5" />
                  {tab.badge ? (
                    <Badge
                      variant="destructive"
                      className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center p-0 px-1 font-mono text-[10px]"
                    >
                      {tab.badge}
                    </Badge>
                  ) : null}
                </span>
                <span className="w-full truncate text-center">{tab.title}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Keeps the last of the page clear of the fixed bar. */}
      <div className="safe-area-pb h-16 lg:hidden" aria-hidden />
    </>
  );
}
