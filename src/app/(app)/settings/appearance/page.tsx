import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getViewerTheme, requirePage } from "@/lib/session";

export const metadata: Metadata = { title: "Display & Appearance" };

/**
 * How the app looks, for the signed-in person.
 *
 * An Account screen rather than an administration one: the theme is stored on
 * the account and affects nobody else, so it carries no permission of its own
 * and sits alongside Profile. Every signed-in person may reach it.
 */
export default async function AppearancePage() {
  const [viewer, theme] = await Promise.all([requirePage("appearance"), getViewerTheme()]);

  return (
    <div className="max-w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          Display &amp; Appearance
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How the workspace looks for {viewer.name.split(" ")[0] || "you"}
        </p>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Theme
          </CardTitle>
          <CardDescription>
            Choose a colour scheme, or follow your operating system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AppearanceForm current={theme} />
        </CardContent>
      </Card>
    </div>
  );
}
