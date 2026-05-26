import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AEO/GEO Tracker" },
      { name: "description", content: "Configure your AEO/GEO Tracker account and preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your account and tracker preferences
          </p>
        </div>

        <div className="max-w-2xl space-y-8">
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <h2 className="text-lg font-semibold text-card-foreground">
              Brand Profile
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="brand">Brand Name</Label>
                <Input id="brand" defaultValue="Your Brand" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" defaultValue="https://yourbrand.com" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <h2 className="text-lg font-semibold text-card-foreground">
              Tracking Preferences
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    Track ChatGPT
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Monitor brand mentions in ChatGPT responses
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    Track Perplexity
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Monitor brand mentions in Perplexity answers
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    Track Gemini
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Monitor brand mentions in Gemini responses
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    Track Claude
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Monitor brand mentions in Claude responses
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <h2 className="text-lg font-semibold text-card-foreground">
              Notifications
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    Email alerts
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Receive email when brand is mentioned
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    Weekly summary
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Get a weekly visibility report
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline">Cancel</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
