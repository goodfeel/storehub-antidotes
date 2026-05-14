import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Clock, FileText, Download, History, RefreshCw } from "lucide-react";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800 border-red-200 text-xs"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
  if (status === "running") return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
  return <Badge variant="secondary" className="text-xs"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
}

export default function HistoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: jobs, isLoading, refetch, isFetching } = trpc.export.listJobs.useQuery(
    { limit: 50 },
    { refetchInterval: 10000 } // Auto-refresh every 10s
  );

  const runningJobs = (jobs ?? []).filter((j) => j.status === "running" || j.status === "pending");

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Export History</h1>
          <p className="text-muted-foreground text-sm mt-1">
            View all past export jobs and download generated CSV files.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {runningJobs.length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-900">
                {runningJobs.length} export job{runningJobs.length > 1 ? "s" : ""} in progress
              </p>
              <p className="text-xs text-blue-700">This page auto-refreshes every 10 seconds.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <History className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No export history yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Run your first export from the Export Data page to see results here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id} className={
              job.status === "failed" ? "border-red-100" :
              job.status === "completed" ? "border-green-100" : ""
            }>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={job.status} />
                    <span className="text-sm font-semibold">Job #{job.id}</span>
                    <Badge variant="outline" className="text-xs capitalize">{job.triggerType}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(job.createdAt)}</p>
                </div>
                <CardDescription className="text-xs mt-1">
                  Date range: <span className="font-mono font-medium">{job.dateFrom}</span> → <span className="font-mono font-medium">{job.dateTo}</span>
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* Stats */}
                {job.status === "completed" && (
                  <div className={`grid gap-2 ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}>
                    <div className="text-center rounded bg-muted/50 p-2">
                      <p className="text-base font-bold">{job.storeCount ?? 0}</p>
                      <p className="text-xs text-muted-foreground">Stores</p>
                    </div>
                    {isAdmin && (
                      <div className="text-center rounded bg-muted/50 p-2">
                        <p className="text-base font-bold">{(job.transactionCount ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Transactions</p>
                      </div>
                    )}
                    <div className="text-center rounded bg-muted/50 p-2">
                      <p className="text-base font-bold">{(job.inventoryCount ?? 0).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Inventory Items</p>
                    </div>
                  </div>
                )}

                {/* Error message */}
                {job.status === "failed" && job.errorMessage && (
                  <div className="rounded bg-red-50 border border-red-100 p-2.5">
                    <p className="text-xs text-red-800 font-medium">Error</p>
                    <p className="text-xs text-red-700 mt-0.5">{job.errorMessage}</p>
                  </div>
                )}

                {/* Download files */}
                {job.files && job.files.length > 0 && (
                  <div className="space-y-1.5">
                    {job.files.map((file) => (
                      <a
                        key={file.id}
                        href={file.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded border p-2 hover:bg-muted/50 transition-colors text-sm group"
                      >
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <span className="flex-1 truncate font-mono text-xs">{file.fileName}</span>
                        <span className="text-xs text-muted-foreground">{formatBytes(file.fileSizeBytes)}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {file.fileType === "transactions" ? "Transactions" : file.fileType === "sales_summary" ? "Sales Summary" : "Inventory"}
                        </Badge>
                        <Download className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      </a>
                    ))}
                  </div>
                )}

                {/* Timing */}
                <p className="text-xs text-muted-foreground">
                  Started: {formatDate(job.startedAt)}
                  {job.completedAt ? ` · Completed: ${formatDate(job.completedAt)}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
