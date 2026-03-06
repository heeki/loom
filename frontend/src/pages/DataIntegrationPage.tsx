import { Network } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function DataIntegrationPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <Network className="h-12 w-12 mx-auto text-muted-foreground" />
          <h2 className="text-xl font-semibold">Data Integrations</h2>
          <p className="text-muted-foreground">
            MCP server management and A2A integration configuration will be available in a future release.
          </p>
          <p className="text-sm text-muted-foreground">Coming Soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
