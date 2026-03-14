import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyViewer } from "@/components/PolicyViewer";
import { useManagedRoles } from "@/hooks/useSecurity";
import { ChevronDown, ChevronRight, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export function RoleManagementPanel({ readOnly }: { readOnly?: boolean }) {
  const { roles, loading, error, createRole, deleteRole } = useManagedRoles();
  const [showAddForm, setShowAddForm] = useState(false);
  const [importArn, setImportArn] = useState("");
  const [expandedRoleId, setExpandedRoleId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const handleCreate = async () => {
    if (!importArn.trim()) return;
    setSubmitting(true);
    try {
      await createRole({ mode: "import", role_arn: importArn.trim() });
      setImportArn("");
      setShowAddForm(false);
      toast.success("Role added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add role");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setSubmitting(true);
    try {
      await deleteRole(id);
      setConfirmDeleteId(null);
      toast.success("Role deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete role");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Managed IAM Roles</h3>
          <p className="text-xs text-muted-foreground mt-1">
            These are the IAM roles approved for use in Loom.<br />
            Builders can only select from these roles when deploying agents and cannot create or modify IAM roles directly.<br />
            Role management is the responsibility of the security team.
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 ml-4" onClick={() => setShowAddForm(!showAddForm)} disabled={readOnly}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Role
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="arn:aws:iam::123456789012:role/my-role"
                value={importArn}
                onChange={(e) => setImportArn(e.target.value)}
                className="flex-1"
              />
              <Button size="sm" onClick={handleCreate} disabled={submitting || !importArn.trim()}>
                {submitting ? "Importing..." : "Import"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">No managed roles yet. Add one above.</p>
      ) : (
        <div className="space-y-2">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardContent className="py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedRoleId(expandedRoleId === role.id ? null : role.id)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {expandedRoleId === role.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{role.role_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{role.role_arn}</div>
                    {role.tags && Object.keys(role.tags).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(role.tags).map(([key, value]) => (
                          <Badge key={key} variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                            {key.replace(/^loom:/, "")}: {value}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground hidden sm:block max-w-[30%] truncate">
                    {role.description}
                  </div>
                  {!readOnly && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDeleteId(role.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {confirmDeleteId === role.id && (
                  <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/5 p-2 text-xs">
                    <span>Delete this role?</span>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(role.id)} disabled={submitting}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </Button>
                  </div>
                )}

                {expandedRoleId === role.id && (
                  <div className="pl-6">
                    <PolicyViewer policy={role.policy_document} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
