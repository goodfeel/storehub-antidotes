import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Clock, Save, Loader2, Info, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FREQUENCY_OPTIONS = [
  { value: "1", label: "Daily" },
  { value: "7", label: "Weekly" },
  { value: "14", label: "Every 2 weeks" },
  { value: "30", label: "Monthly" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, "0")}:00`,
}));

function nextRunDescription(config: {
  enabled: boolean;
  frequencyDays: number;
  dayOfWeek: number;
  hourOfDay: number;
}): string {
  if (!config.enabled) return "Scheduler is disabled";

  const now = new Date();
  const bangkokOffset = 7 * 60; // GMT+7 in minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const bangkokMinutes = (utcMinutes + bangkokOffset) % (24 * 60);
  const bangkokHour = Math.floor(bangkokMinutes / 60);
  const bangkokDay = new Date(now.getTime() + bangkokOffset * 60000).getUTCDay();

  if (config.frequencyDays === 1) {
    if (bangkokHour < config.hourOfDay) {
      return `Today at ${String(config.hourOfDay).padStart(2, "0")}:00 GMT+7`;
    }
    return `Tomorrow at ${String(config.hourOfDay).padStart(2, "0")}:00 GMT+7`;
  }

  if (config.frequencyDays === 7) {
    const daysUntil = (config.dayOfWeek - bangkokDay + 7) % 7;
    const nextDay = daysUntil === 0 && bangkokHour >= config.hourOfDay ? 7 : daysUntil;
    if (nextDay === 0) return `Today at ${String(config.hourOfDay).padStart(2, "0")}:00 GMT+7`;
    if (nextDay === 1) return `Tomorrow at ${String(config.hourOfDay).padStart(2, "0")}:00 GMT+7`;
    return `${DAY_NAMES[config.dayOfWeek]} at ${String(config.hourOfDay).padStart(2, "0")}:00 GMT+7 (in ${nextDay} days)`;
  }

  return `Every ${config.frequencyDays} days at ${String(config.hourOfDay).padStart(2, "0")}:00 GMT+7`;
}

export default function SchedulerPage() {
  const utils = trpc.useUtils();
  const { data: savedConfig, isLoading } = trpc.scheduler.get.useQuery();

  const [enabled, setEnabled] = useState(true);
  const [frequencyDays, setFrequencyDays] = useState(7);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [hourOfDay, setHourOfDay] = useState(8);
  const [includeOnline, setIncludeOnline] = useState(true);

  useEffect(() => {
    if (savedConfig) {
      setEnabled(savedConfig.enabled);
      setFrequencyDays(savedConfig.frequencyDays);
      setDayOfWeek(savedConfig.dayOfWeek);
      setHourOfDay(savedConfig.hourOfDay);
      setIncludeOnline(savedConfig.includeOnline);
    }
  }, [savedConfig]);

  const saveMutation = trpc.scheduler.save.useMutation({
    onSuccess: () => {
      toast.success("Scheduler settings saved");
      utils.scheduler.get.invalidate();
    },
    onError: (err) => toast.error(`Failed to save: ${err.message}`),
  });

  const handleSave = () => {
    saveMutation.mutate({ enabled, frequencyDays, dayOfWeek, hourOfDay, includeOnline });
  };

  const currentConfig = { enabled, frequencyDays, dayOfWeek, hourOfDay };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Export Scheduler</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure automated export frequency. Exports run automatically based on your schedule.
        </p>
      </div>

      {/* Next run preview */}
      {!isLoading && (
        <Card className={enabled ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-gray-50"}>
          <CardContent className="pt-4 flex items-center gap-3">
            <CalendarClock className={`w-5 h-5 shrink-0 ${enabled ? "text-blue-600" : "text-gray-400"}`} />
            <div>
              <p className={`text-sm font-medium ${enabled ? "text-blue-900" : "text-gray-600"}`}>
                Next scheduled export
              </p>
              <p className={`text-xs mt-0.5 ${enabled ? "text-blue-700" : "text-gray-500"}`}>
                {nextRunDescription(currentConfig)}
              </p>
            </div>
            <Badge className={`ml-auto ${enabled ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-gray-100 text-gray-600"}`}>
              {enabled ? "Active" : "Disabled"}
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Scheduler settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Schedule Settings
          </CardTitle>
          <CardDescription>
            All times are in GMT+7 (Bangkok/Asia). The scheduler checks every minute and triggers exports at the configured time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Enable Automated Exports</p>
              <p className="text-xs text-muted-foreground">Automatically export data on the configured schedule</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className={`space-y-4 ${!enabled ? "opacity-50 pointer-events-none" : ""}`}>
            {/* Frequency */}
            <div className="space-y-1.5">
              <Label>Export Frequency</Label>
              <Select
                value={String(frequencyDays)}
                onValueChange={(v) => setFrequencyDays(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The export will cover the previous {frequencyDays} day{frequencyDays > 1 ? "s" : ""} of data.
              </p>
            </div>

            {/* Day of week (only for weekly) */}
            {frequencyDays === 7 && (
              <div className="space-y-1.5">
                <Label>Day of Week</Label>
                <Select
                  value={String(dayOfWeek)}
                  onValueChange={(v) => setDayOfWeek(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_NAMES.map((name, i) => (
                      <SelectItem key={i} value={String(i)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Hour of day */}
            <div className="space-y-1.5">
              <Label>Time of Day (GMT+7)</Label>
              <Select
                value={String(hourOfDay)}
                onValueChange={(v) => setHourOfDay(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Include online */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Include Online Orders</p>
                <p className="text-xs text-muted-foreground">Include transactions from online channels in scheduled exports</p>
              </div>
              <Switch checked={includeOnline} onCheckedChange={setIncludeOnline} />
            </div>
          </div>

          <Button onClick={handleSave} disabled={saveMutation.isPending || isLoading} className="w-full">
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Schedule
          </Button>
        </CardContent>
      </Card>

      {/* Info card */}
      <Card className="bg-muted/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4" /> How Scheduled Exports Work
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            The scheduler runs in the background and checks every minute. When the configured time arrives, it automatically:
          </p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Fetches all stores from your StoreHub account</li>
            <li>Downloads transactions for each store for the past {frequencyDays} day{frequencyDays > 1 ? "s" : ""}</li>
            <li>Downloads inventory data for each store</li>
            <li>Combines all data into labeled CSV files (one per data type)</li>
            <li>Uploads the files to secure cloud storage</li>
            <li>Sends you an email notification with the results</li>
          </ol>
          <p className="text-xs">
            You can view all scheduled export results in the <strong>Export History</strong> page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
