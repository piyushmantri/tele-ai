import { useState } from "react";
import { Card, CardHeader, CardTitle, CardBody, Input, Alert, Button } from "kodeui";
import { api } from "../lib/api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/api/login", { password: pw });
      onSuccess();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "login failed");
    }
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <form onSubmit={submit} style={{ width: 320 }}>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardBody>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Input
                type="password"
                label="Dashboard password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Dashboard password"
                autoFocus
              />
              {err && <Alert variant="error">{err}</Alert>}
              <Button variant="filled" fullWidth type="submit">
                Continue
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
