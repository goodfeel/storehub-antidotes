import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Download, Loader2, CheckCircle2, XCircle, Clock, FileText, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function toLocalDateString(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0]!;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
  if (status === "running") return <Badge className="bg-blue-100 text-blue-800 border-blue-200"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
  return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
}

export default function ExportPage() {
  const [, setLocation] = useLocation();
  const { data: creds } = trpc.credentials.get.useQuery();

  const [dateFrom, setDateFrom] = useState(toLocalDateString(7));
  const [dateTo, setDateTo] = useState(toLocalDateString(0));
  const [includeOnline, setIncludeOnline] = useState(true);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const triggerMutation = trpc.export.trigger.useMutation({
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      toast.success(`Export job #${data.jobId} started`);
    },
    onError: (err) => toast.error(`Failed to start export: ${err.message}`),
  });

  // Poll active job status
  const { data: jobData, refetch: refetchJob } = trpc.export.getJob.useQuery(
    { jobId: activeJobId! },
    { enabled: activeJobId !== null, refetchInterval: activeJobId !== null ? 3000 : false }
  );

  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!jobData) return;
    const status = jobData.job.status;
    if (status === prevStatus.current) return;
    prevStatus.current = status;

    if (status === "completed") {
      toast.success(`Export completed! ${jobData.job.transactionCount} transactions, ${jobData.job.inventoryCount} inventory items.`);
    } else if (status === "failed") {
      toast.error(`Export failed: ${jobData.job.errorMessage}`);
    }
  }, [jobData]);

  const handleExport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!creds) {
      toast.error("Please configure your API credentials first");
      setLocation("/credentials");
      return;
    }
    if (dateFrom > dateTo) {
      toast.error("Start date must be before end date");
      return;
    }
    triggerMutation.mutate({ dateFrom, dateTo, includeOnline });
  };

  const isRunning = jobData?.job.status === "running" || jobData?.job.status === "pending";

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Export Data</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manually trigger a data export for all stores. Transactions and inventory will be exported as separate CSV files.
        </p>
      </div>

      {!creds && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900">API credentials not configured</p>
              <p className="text-xs text-amber-700">You need to set up your StoreHub credentials before exporting.</p>
            </div>
            <Button size="sm" onClick={() => setLocation("/credentials")}>Configure</Button>
          </CardContent>
        </Card>
      )}

      {/* Export form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4" /> Export Configuration
          </CardTitle>
          <CardDescription>
            Select the date range for your export. All stores will be included automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleExport} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dateFrom">From Date</Label>
                <Input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  max={dateTo}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dateTo">To Date</Label>
                <Input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  min={dateFrom}
                  max={toLocalDateString(0)}
                />
              </div>
            </div>

            {/* Quick date presets */}
            <div className="flex flex-wrap gap-2">
              <p className="text-xs text-muted-foreground w-full">Quick presets:</p>
              {[
                { label: "Last 7 days", days: 7 },
                { label: "Last 14 days", days: 14 },
                { label: "Last 30 days", days: 30 },
                { label: "Last 90 days", days: 90 },
              ].map(({ label, days }) => (
                <Button
                  key={days}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => {
                    setDateFrom(toLocalDateString(days));
                    setDateTo(toLocalDateString(0));
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Include Online Orders</p>
                <p className="text-xs text-muted-foreground">Include transactions from online channels</p>
              </div>
              <Switch checked={includeOnline} onCheckedChange={setIncludeOnline} />
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">What will be exported:</p>
              <p>• <strong>transactions_{dateFrom}_to_{dateTo}.csv</strong> — All transactions from all stores, labeled with store name</p>
              <p>• <strong>inventory_{dateFrom}_to_{dateTo}.csv</strong> — Current inventory for all stores, labeled with store name</p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={triggerMutation.isPending || isRunning || !creds}
            >
              {triggerMutation.isPending || isRunning
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Export in progress...</>
                : <><Download className="w-4 h-4 mr-2" /> Start Export</>}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Active job status */}
      {jobData && (
        <Card className={
          jobData.job.status === "completed" ? "border-green-200" :
          jobData.job.status === "failed" ? "border-red-200" :
          "border-blue-200"
        }>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <StatusBadge status={jobData.job.status} />
              Export Job #{jobData.job.id}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobData.job.status === "running" && (
              <div className="flex items-center gap-2 text-sm text-blue-700">
                <Loader2 className="w-4 h-4 animate-spin" />
                Fetching data from StoreHub API... This may take a few minutes for large datasets.
              </div>
            )}

            {jobData.job.status === "completed" && (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-lg font-bold">{jobData.job.storeCount}</p>
                  <p className="text-xs text-muted-foreground">Stores</p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-lg font-bold">{jobData.job.transactionCount?.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Transactions</p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-lg font-bold">{jobData.job.inventoryCount?.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Inventory Items</p>
                </div>
              </div>
            )}

            {jobData.job.status === "failed" && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-800 font-medium">Error Details</p>
                <p className="text-xs text-red-700 mt-1">{jobData.job.errorMessage}</p>
              </div>
            )}

            {/* Download links */}
            {jobData.files.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Download Files</p>
                {jobData.files.map((file) => (
                  <a
                    key={file.id}
                    href={file.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors text-sm"
                  >
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="flex-1 truncate font-mono text-xs">{file.fileName}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {file.fileType === "transactions" ? "Transactions" : "Inventory"}
                    </Badge>
                    <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </a>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Started: {formatDate(jobData.job.startedAt)}
              {jobData.job.completedAt && ` · Completed: ${formatDate(jobData.job.completedAt)}`}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
