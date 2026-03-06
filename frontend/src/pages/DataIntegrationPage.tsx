import { Cable } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function DataIntegrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Data Integrations</h2>
        <p className="text-sm text-muted-foreground">Configure MCP servers and A2A agent integrations.</p>
      </div>

      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <Cable className="h-12 w-12 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">
              MCP server management and A2A integration configuration will be available in a future release.
            </p>
            <p className="text-sm text-muted-foreground">Coming Soon</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
