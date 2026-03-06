import { useState } from "react";
import { AgentRegistrationForm } from "@/components/AgentRegistrationForm";
import { toast } from "sonner";
import type { AgentDeployRequest } from "@/api/types";

type BuilderTab = "register" | "deploy";

interface AgentListPageProps {
  onRegister: (arn: string, modelId?: string) => Promise<unknown>;
  onDeploy?: (request: AgentDeployRequest) => Promise<unknown>;
}

export function AgentListPage({
  onRegister,
  onDeploy,
}: AgentListPageProps) {
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<BuilderTab>("deploy");

  const handleRegister = async (arn: string, modelId?: string) => {
    setSubmitting(true);
    try {
      await onRegister(arn, modelId);
      toast.success("Agent registered");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeploy = async (request: AgentDeployRequest) => {
    if (!onDeploy) return;
    setSubmitting(true);
    try {
      await onDeploy(request);
      toast.success("Agent deployment started");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deployment failed");
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: { key: BuilderTab; label: string }[] = [
    { key: "deploy", label: "Deploy" },
    { key: "register", label: "Register" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Builder</h2>
        <p className="text-sm text-muted-foreground">Deploy new agents or register existing ones.</p>
      </div>

      <div className="flex rounded-md border text-sm w-fit" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`px-4 py-1.5 transition-colors ${
              tab.key === "deploy" ? "rounded-l-md" : ""
            } ${
              tab.key === "register" ? "rounded-r-md" : ""
            } ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AgentRegistrationForm
        mode={activeTab}
        onRegister={handleRegister}
        onDeploy={onDeploy ? handleDeploy : undefined}
        isLoading={submitting}
      />
    </div>
  );
}
