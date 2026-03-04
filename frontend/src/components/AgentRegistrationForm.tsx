import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Mode = "register" | "deploy";

interface ConfigPair {
  key: string;
  value: string;
}

interface AgentRegistrationFormProps {
  onRegister: (arn: string) => Promise<void>;
  onDeploy?: (name: string, codeUri: string, config?: Record<string, string>) => Promise<void>;
  isLoading: boolean;
}

export function AgentRegistrationForm({ onRegister, onDeploy, isLoading }: AgentRegistrationFormProps) {
  const [mode, setMode] = useState<Mode>("register");
  const [arn, setArn] = useState("");
  const [name, setName] = useState("");
  const [codeUri, setCodeUri] = useState("");
  const [configPairs, setConfigPairs] = useState<ConfigPair[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "register") {
      if (!arn.trim()) return;
      await onRegister(arn.trim());
      setArn("");
    } else {
      if (!name.trim() || !codeUri.trim() || !onDeploy) return;
      const config: Record<string, string> = {};
      for (const pair of configPairs) {
        if (pair.key.trim()) {
          config[pair.key.trim()] = pair.value;
        }
      }
      await onDeploy(
        name.trim(),
        codeUri.trim(),
        Object.keys(config).length > 0 ? config : undefined,
      );
      setName("");
      setCodeUri("");
      setConfigPairs([]);
    }
  };

  const addConfigPair = () => {
    setConfigPairs([...configPairs, { key: "", value: "" }]);
  };

  const updateConfigPair = (index: number, field: "key" | "value", val: string) => {
    setConfigPairs((prev) =>
      prev.map((pair, i) => (i === index ? { ...pair, [field]: val } : pair)),
    );
  };

  const removeConfigPair = (index: number) => {
    setConfigPairs(configPairs.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            {mode === "register" ? "Register Agent" : "Deploy Agent"}
          </CardTitle>
          <div className="flex rounded-md border text-xs">
            <button
              type="button"
              className={`px-3 py-1 rounded-l-md transition-colors ${
                mode === "register"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
              onClick={() => setMode("register")}
            >
              Register
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded-r-md transition-colors ${
                mode === "deploy"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
              onClick={() => setMode("deploy")}
            >
              Deploy
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "register" ? (
            <div className="flex gap-2">
              <Input
                placeholder="arn:aws:bedrock-agentcore:region:account:runtime/id"
                value={arn}
                onChange={(e) => setArn(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || !arn.trim()}>
                {isLoading ? "Registering..." : "Register"}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Agent name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="s3://bucket/agent-code.zip"
                  value={codeUri}
                  onChange={(e) => setCodeUri(e.target.value)}
                  className="flex-1"
                />
              </div>
              {configPairs.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Initial Configuration</div>
                  {configPairs.map((pair, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder="Key"
                        value={pair.key}
                        onChange={(e) => updateConfigPair(i, "key", e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="Value"
                        value={pair.value}
                        onChange={(e) => updateConfigPair(i, "value", e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeConfigPair(i)}
                      >
                        &times;
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addConfigPair}>
                  + Add Config
                </Button>
                <div className="flex-1" />
                <Button
                  type="submit"
                  disabled={isLoading || !name.trim() || !codeUri.trim() || !onDeploy}
                >
                  {isLoading ? "Deploying..." : "Deploy"}
                </Button>
              </div>
            </>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
