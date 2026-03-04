import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AgentRegistrationFormProps {
  onRegister: (arn: string) => Promise<void>;
  isLoading: boolean;
}

export function AgentRegistrationForm({ onRegister, isLoading }: AgentRegistrationFormProps) {
  const [arn, setArn] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arn.trim()) return;
    await onRegister(arn.trim());
    setArn("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Register Agent</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            placeholder="arn:aws:bedrock-agentcore:region:account:runtime/id"
            value={arn}
            onChange={(e) => setArn(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !arn.trim()}>
            {isLoading ? "Registering..." : "Register"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
