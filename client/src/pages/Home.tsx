import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Key, Download, History, Clock, CheckCircle2, XCircle, Loader2, AlertCircle, Store } from "lucide-react";
import { useLocation } from "wouter";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
  if (status === "running") return <Badge className="bg-blue-100 text-blue-800 border-blue-200"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
  return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
}

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: creds } = trpc.credentials.get.useQuery();
  const { data: scheduler } = trpc.scheduler.get.useQuery();
  const { data: jobs } = trpc.export.listJobs.useQuery({ limit: 5 });

  const recentJobs = jobs ?? [];
  const lastJob = recentJobs[0];
  const completedJobs = recentJobs.filter((j) => j.status === "completed").length;
  const failedJobs = recentJobs.filter((j) => j.status === "failed").length;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-2">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Welcome back{user?.name ? `, ${user.name}` : ""}. Manage your StoreHub data exports from here.
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={`border-l-4 ${creds ? "border-l-green-500" : "border-l-amber-500"}`}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
              <Key className="w-3.5 h-3.5" /> API Credentials
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{creds ? creds.username : "Not configured"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{creds ? "Connected" : "Setup required"}</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${scheduler?.enabled ? "border-l-blue-500" : "border-l-gray-300"}`}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
              <Clock className="w-3.5 h-3.5" /> Auto-Scheduler
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {scheduler?.enabled
                ? scheduler.frequencyDays === 1 ? "Daily"
                  : scheduler.frequencyDays === 7 ? "Weekly"
                  : scheduler.frequencyDays === 30 ? "Monthly"
                  : `Every ${scheduler.frequencyDays} days`
                : "Disabled"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {scheduler?.enabled ? `At ${String(scheduler.hourOfDay).padStart(2, "0")}:00 GMT+7` : "No scheduled exports"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
              <CheckCircle2 className="w-3.5 h-3.5" /> Completed (Recent)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{completedJobs}</p>
            <p className="text-xs text-muted-foreground mt-0.5">of last 5 jobs</p>
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${failedJobs > 0 ? "border-l-red-500" : "border-l-gray-200"}`}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
              <XCircle className="w-3.5 h-3.5" /> Failed (Recent)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${failedJobs > 0 ? "text-red-600" : "text-muted-foreground"}`}>{failedJobs}</p>
            <p className="text-xs text-muted-foreground mt-0.5">of last 5 jobs</p>
          </CardContent>
        </Card>
      </div>

      {/* Setup checklist if not configured */}
      {!creds && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <AlertCircle className="w-4 h-4" /> Getting Started
            </CardTitle>
            <CardDescription className="text-amber-700">
              Complete these steps to start exporting your StoreHub data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${creds ? "bg-green-500 text-white" : "bg-amber-200 text-amber-800"}`}>
                {creds ? "✓" : "1"}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">Configure API Credentials</p>
                <p className="text-xs text-amber-700">Enter your StoreHub username and API token</p>
              </div>
              {!creds && (
                <Button size="sm" onClick={() => setLocation("/credentials")}>
                  Configure
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-amber-200 text-amber-800">2</div>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">Run Your First Export</p>
                <p className="text-xs text-amber-700">Manually trigger an export to test the connection</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setLocation("/export")}>
                Export
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-amber-200 text-amber-800">3</div>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">Set Up Automated Schedule</p>
                <p className="text-xs text-amber-700">Configure weekly or custom frequency exports</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setLocation("/scheduler")}>
                Schedule
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setLocation("/export")}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="w-4 h-4 text-primary" /> Export Data Now
            </CardTitle>
            <CardDescription>
              Manually trigger a data export for all stores across a custom date range.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={(e) => { e.stopPropagation(); setLocation("/export"); }}>
              Start Export
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setLocation("/history")}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-primary" /> Export History
            </CardTitle>
            <CardDescription>
              View past exports and download previously generated CSV files.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={(e) => { e.stopPropagation(); setLocation("/history"); }}>
              View History
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Jobs */}
      {recentJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Export Jobs</CardTitle>
            <CardDescription>Last {recentJobs.length} export jobs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={job.status} />
                    <div>
                      <p className="text-sm font-medium">
                        {job.dateFrom} → {job.dateTo}
                        <span className="ml-2 text-xs text-muted-foreground capitalize">({job.triggerType})</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {job.status === "completed"
                          ? `${job.storeCount} stores · ${job.transactionCount} transactions · ${job.inventoryCount} inventory items`
                          : job.status === "failed"
                          ? job.errorMessage?.slice(0, 80)
                          : "Processing..."}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</p>
                    {job.files && job.files.length > 0 && (
                      <div className="flex gap-1 mt-1 justify-end">
                        {job.files.map((f) => (
                          <a key={f.id} href={f.fileUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-primary underline hover:no-underline">
                            {f.fileType === "transactions" ? "Transactions" : f.fileType === "sales_summary" ? "Sales Summary" : "Inventory"}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
