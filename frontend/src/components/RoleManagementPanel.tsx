import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyViewer } from "@/components/PolicyViewer";
import { useManagedRoles } from "@/hooks/useSecurity";
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { PolicyDocument } from "@/api/types";

export function RoleManagementPanel() {
  const { roles, loading, error, createRole, updateRole, deleteRole } = useManagedRoles();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState<"import" | "wizard">("import");
  const [importArn, setImportArn] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPolicyJson, setNewPolicyJson] = useState("");
  const [expandedRoleId, setExpandedRoleId] = useState<number | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editPolicyJson, setEditPolicyJson] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      if (addMode === "import") {
        if (!importArn.trim()) return;
        await createRole({ mode: "import", role_arn: importArn.trim() });
        setImportArn("");
      } else {
        if (!newRoleName.trim()) return;
        let policyDoc: PolicyDocument | undefined;
        if (newPolicyJson.trim()) {
          policyDoc = JSON.parse(newPolicyJson) as PolicyDocument;
        }
        await createRole({
          mode: "wizard",
          role_name: newRoleName.trim(),
          description: newDescription.trim(),
          policy_document: policyDoc,
        });
        setNewRoleName("");
        setNewDescription("");
        setNewPolicyJson("");
      }
      setShowAddForm(false);
      toast.success("Role added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add role");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id: number) => {
    setSubmitting(true);
    try {
      let policyDoc: PolicyDocument | undefined;
      if (editPolicyJson.trim()) {
        policyDoc = JSON.parse(editPolicyJson) as PolicyDocument;
      }
      await updateRole(id, {
        description: editDescription,
        policy_document: policyDoc,
      });
      setEditingRoleId(null);
      toast.success("Role updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role");
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
        <h3 className="text-sm font-medium">Managed IAM Roles</h3>
        <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Role
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex rounded-md border text-xs w-fit" role="tablist">
              <button
                type="button"
                className={`px-3 py-1 rounded-l-md transition-colors ${addMode === "import" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                onClick={() => setAddMode("import")}
              >
                Import Existing
              </button>
              <button
                type="button"
                className={`px-3 py-1 rounded-r-md transition-colors ${addMode === "wizard" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                onClick={() => setAddMode("wizard")}
              >
                Create New
              </button>
            </div>
            {addMode === "import" ? (
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
            ) : (
              <div className="space-y-2">
                <Input
                  placeholder="Role name"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                />
                <Input
                  placeholder="Description (optional)"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
                <Textarea
                  placeholder='Policy document JSON (optional)&#10;{"Version":"2012-10-17","Statement":[...]}'
                  value={newPolicyJson}
                  onChange={(e) => setNewPolicyJson(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                />
                <Button size="sm" onClick={handleCreate} disabled={submitting || !newRoleName.trim()}>
                  {submitting ? "Creating..." : "Create"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No managed roles yet. Add one above.</p>
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
                  </div>
                  <div className="text-xs text-muted-foreground hidden sm:block max-w-[30%] truncate">
                    {role.description}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingRoleId(role.id);
                        setEditDescription(role.description);
                        setEditPolicyJson(JSON.stringify(role.policy_document, null, 2));
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(role.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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

                {editingRoleId === role.id && (
                  <div className="space-y-2 rounded border border-dashed p-3">
                    <Input
                      placeholder="Description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                    <Textarea
                      value={editPolicyJson}
                      onChange={(e) => setEditPolicyJson(e.target.value)}
                      rows={6}
                      className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleUpdate(role.id)} disabled={submitting}>
                        {submitting ? "Saving..." : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingRoleId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {expandedRoleId === role.id && editingRoleId !== role.id && (
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
