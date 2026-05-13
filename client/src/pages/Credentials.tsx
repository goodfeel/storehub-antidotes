import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle2,
  Key,
  Loader2,
  Store,
  TestTube2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type TestResult = {
  success: boolean;
  storeCount?: number;
  stores?: { id: string; name: string }[];
};

export default function CredentialsPage() {
  const { data: creds, isLoading } = trpc.credentials.get.useQuery();
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const testMutation = trpc.credentials.test.useMutation({
    onSuccess: (data) => {
      setTestResult(data);
      toast.success(`Connection successful! Found ${data.storeCount} store(s).`);
    },
    onError: (err) => {
      setTestResult({ success: false });
      toast.error(`Connection failed: ${err.message}`);
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">StoreHub API Connection</h1>
        <p className="text-muted-foreground text-sm mt-1">
          API credentials are read from the server's environment. Set{" "}
          <code>STOREHUB_USERNAME</code> and <code>STOREHUB_API_TOKEN</code> on the host (env file, systemd unit, or panel) to change them.
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading configuration…
          </CardContent>
        </Card>
      ) : creds?.configured ? (
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-green-800">
              <CheckCircle2 className="w-4 h-4" /> Credentials Loaded From Environment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-green-700 font-medium uppercase tracking-wide">
                  Username
                </p>
                <p className="font-mono font-semibold text-green-900">{creds.username}</p>
              </div>
              <div>
                <p className="text-xs text-green-700 font-medium uppercase tracking-wide">
                  API Token
                </p>
                <p className="font-mono text-green-900">{creds.apiTokenMasked}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="border-green-300 text-green-800 hover:bg-green-100"
            >
              {testMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <TestTube2 className="w-3.5 h-3.5 mr-1.5" />
              )}
              Test Connection
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <AlertTriangle className="w-4 h-4" /> Credentials Not Configured
            </CardTitle>
            <CardDescription className="text-amber-700">
              Set <code>STOREHUB_USERNAME</code> and <code>STOREHUB_API_TOKEN</code> in the
              service environment, then restart the server.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {testResult?.success && testResult.stores && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" /> Connected Stores (
              {testResult.storeCount})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {testResult.stores.map((s) => (
                <Badge key={s.id} variant="secondary" className="text-xs">
                  {s.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/40">
        <CardContent className="pt-4 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <Key className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Where these come from:</strong> the server uses Basic HTTP auth against{" "}
              <code className="bg-muted px-1 py-0.5 rounded">api.storehubhq.com</code>. The
              username is your StoreHub back-office subdomain; the API token is generated by
              StoreHub.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
