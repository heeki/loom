import { useState } from "react";
import { RoleManagementPanel } from "@/components/RoleManagementPanel";
import { AuthorizerManagementPanel } from "@/components/AuthorizerManagementPanel";
import { PermissionRequestsPanel } from "@/components/PermissionRequestsPanel";

type SecurityTab = "roles" | "authorizers" | "permissions";

export function SecurityAdminPage({ readOnly }: { readOnly?: boolean }) {
  const [activeTab, setActiveTab] = useState<SecurityTab>("roles");

  const tabs: { key: SecurityTab; label: string }[] = [
    { key: "roles", label: "IAM Roles" },
    { key: "authorizers", label: "Authorizers" },
    { key: "permissions", label: "Permission Requests" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Security Administration</h2>
        <p className="text-sm text-muted-foreground">Manage IAM roles, authorizer configurations, and permission requests.</p>
      </div>

      <div className="flex rounded-md border text-sm w-fit" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`px-4 py-1.5 transition-colors ${
              tab.key === "roles" ? "rounded-l-md" : ""
            } ${
              tab.key === "permissions" ? "rounded-r-md" : ""
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

      {activeTab === "roles" && <RoleManagementPanel readOnly={readOnly} />}
      {activeTab === "authorizers" && <AuthorizerManagementPanel readOnly={readOnly} />}
      {activeTab === "permissions" && <PermissionRequestsPanel readOnly={readOnly} />}
    </div>
  );
}
