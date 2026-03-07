import { MemoryManagementPanel } from "../components/MemoryManagementPanel";

export function MemoryManagementPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Memory Resources</h2>
        <p className="text-sm text-muted-foreground">Create and manage AgentCore Memory resources with configurable strategies.</p>
      </div>
      <MemoryManagementPanel />
    </div>
  );
}
