import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Input, Button, Alert } from "kodeui";
import type { CreateApplicationRegistryBody } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

const SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/;

export default function AddApplicationForm() {
  const qc = useQueryClient();
  const [sourceType, setSourceType] = useState<"git" | "local">("local");
  const [slug, setSlug] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: (body: CreateApplicationRegistryBody) =>
      api.post("/api/applications/registry", body),
    onSuccess: () => {
      setSlug("");
      setSourceUrl("");
      setSourcePath("");
      setClientError(null);
      setOpen(false);
      qc.invalidateQueries({ queryKey: qk.applicationsRegistry });
    },
  });

  function handleSubmit() {
    setClientError(null);
    if (!SLUG_RE.test(slug)) {
      setClientError(
        "Slug must start with lowercase letter/digit and contain only [a-z0-9-_].",
      );
      return;
    }
    if (sourceType === "git") {
      if (!sourceUrl.trim()) {
        setClientError("Git source URL is required.");
        return;
      }
      create.mutate({
        slug: slug.trim(),
        source_type: "git",
        source_url: sourceUrl.trim(),
      });
    } else {
      const path = sourcePath.trim();
      if (!path) {
        setClientError("Local path is required.");
        return;
      }
      if (path.startsWith("~")) {
        setClientError("Path must be absolute — tilde (~) is not expanded.");
        return;
      }
      if (!path.startsWith("/")) {
        setClientError("Path must be absolute (start with /).");
        return;
      }
      create.mutate({
        slug: slug.trim(),
        source_type: "local",
        source_path: path,
      });
    }
  }

  if (!open) {
    return (
      <div className="mb-4 max-w-5xl">
        <Button variant="filled" onClick={() => setOpen(true)}>
          + Add registry entry
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-4 max-w-5xl">
      <Card>
        <CardBody>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium" style={{ color: "var(--kode-text-primary)" }}>Add registry entry</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setClientError(null);
                }}
              >
                Cancel
              </Button>
            </div>

            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--kode-text-muted)" }}>Source type</label>
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={sourceType === "local"}
                    onChange={() => setSourceType("local")}
                  />
                  Local path
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={sourceType === "git"}
                    onChange={() => setSourceType("git")}
                  />
                  Git URL
                </label>
              </div>
            </div>

            <Input
              label="Slug (kebab/snake-case; must equal the plugin's manifest.slug)"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-plugin"
              style={{ fontFamily: "var(--kode-font-mono)" }}
            />

            {sourceType === "git" ? (
              <div>
                <Input
                  label="Git URL"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                  style={{ fontFamily: "var(--kode-font-mono)" }}
                />
                <p className="mt-1 text-xs" style={{ color: "var(--kode-text-muted)" }}>
                  Cloned to <code>data/applications/&lt;slug&gt;/</code> on install.
                  Credentials come from <code>~/.ssh/config</code> / <code>~/.gitconfig</code>.
                </p>
              </div>
            ) : (
              <div>
                <Input
                  label="Absolute path"
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  placeholder="/absolute/path/to/plugin (no ~)"
                  style={{ fontFamily: "var(--kode-font-mono)" }}
                />
                <p className="mt-1 text-xs" style={{ color: "var(--kode-text-muted)" }}>
                  Must start with <code>/</code>. Tilde is NOT expanded. Operator
                  edits to this dir survive uninstall.
                </p>
              </div>
            )}

            {clientError && <Alert variant="error">{clientError}</Alert>}
            {create.error && (
              <Alert variant="error">
                {create.error instanceof Error ? create.error.message : String(create.error)}
              </Alert>
            )}

            <div className="flex justify-end">
              <Button
                variant="filled"
                onClick={handleSubmit}
                disabled={create.isPending}
              >
                {create.isPending ? "Adding…" : "Add to registry"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
