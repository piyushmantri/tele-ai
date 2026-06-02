// PluginSlot — generic plugin Settings UI loader (RUNTIME script injection).
//
// Prior implementation used Vite's `import.meta.glob` (BUILD-TIME): every
// plugin's `ui.tsx` was bundled into tele's deploy at build time, blocking
// runtime install of new plugins without a rebuild. This rewrite switches
// to runtime <script> injection of `/api/applications/<uuid>/ui.js`, which
// streams the plugin's pre-built IIFE bundle from its installed dir
// (`<installed_path>/dist/ui.js`). The plugin's IIFE registers itself on
// `window.__TELE_PLUGIN_UI__[slug]`, which we poll for.
//
// React-on-window contract: we set `window.React = React` and
// `window.ReactDOM = ReactDOM` BEFORE injecting the script tag. Plugins build
// with `react`/`react-dom` listed as Rollup externals and the classic JSX
// runtime (so JSX compiles to `React.createElement(...)`, which IS on
// `window.React`'s namespace — the modern jsx-runtime mapping is broken
// because `React.jsx`/`React.jsxs` don't exist on the main namespace).
// Assignment is idempotent: same module references on every PluginSlot mount.
// Future tree-shaking of main.tsx must not drop the React import that
// references this contract.
//
// Auth: `/api/applications/<uuid>/ui.js` is allowlisted in
// `apps/server/src/api/index.ts`'s global onRequest hook (UUID is unguessable;
// same trust model as `/api/health`). Without this carve-out, the global hook
// returns JSON 401 BEFORE the route handler, preventing the route from
// streaming the JS.
//
// Readiness: we do NOT use the script tag's `onload` listener — it fires once
// per element insertion, so on remount (when the tag is already in the DOM)
// it never fires again. The 50ms × 60 = 3s poll loop on
// `window.__TELE_PLUGIN_UI__[slug]` is the sole readiness signal. Timeout
// surfaces as "No settings UI defined for this plugin." — same UX as the
// previous build-time empty state for plugins that ship only hook.ts.

import React, { Component, useEffect, useState, type ComponentType } from "react";
import ReactDOM from "react-dom";
import { Alert, Spinner } from "kodeui";

export type PluginUIProps = {
  appId: string;
  registrySlug: string;
};

type LoaderState =
  | { status: "loading" }
  | { status: "ready"; Component: ComponentType<PluginUIProps> }
  | { status: "error"; message: string };

class PluginErrorBoundary extends Component<
  { slug: string; children: React.ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    if (import.meta.env.DEV) {
      console.error(`[PluginSlot] '${this.props.slug}' render error:`, error);
    }
  }

  override render() {
    if (this.state.error) {
      const msg = import.meta.env.DEV
        ? `Plugin '${this.props.slug}' render error: ${this.state.error.message}`
        : "Plugin UI failed to render";
      return <Alert variant="error">{msg}</Alert>;
    }
    return this.props.children;
  }
}

export default function PluginSlot({
  slug,
  appId,
}: {
  slug: string;
  appId: string;
}) {
  const [state, setState] = useState<LoaderState>({ status: "loading" });

  useEffect(() => {
    // Share React with plugins — idempotent; same module ref on every mount.
    // Plugins built with classic JSX runtime emit React.createElement → window.React.
    (window as unknown as { React: typeof React }).React = React;
    (window as unknown as { ReactDOM: typeof ReactDOM }).ReactDOM = ReactDOM;

    const scriptId = `tele-plugin-ui-${slug}`;
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = `/api/applications/${appId}/ui.js`;
      // No onload/onerror listeners — poll loop is the sole readiness signal.
      document.head.appendChild(script);
    }

    setState({ status: "loading" });
    let attempts = 0;
    const timer = window.setInterval(() => {
      const reg = (window as unknown as {
        __TELE_PLUGIN_UI__?: Record<string, ComponentType<PluginUIProps>>;
      }).__TELE_PLUGIN_UI__;
      if (reg && reg[slug]) {
        window.clearInterval(timer);
        setState({ status: "ready", Component: reg[slug]! });
        return;
      }
      attempts++;
      if (attempts >= 60) {
        window.clearInterval(timer);
        setState({
          status: "error",
          message: "No settings UI defined for this plugin.",
        });
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [slug, appId]);

  if (state.status === "loading") {
    return (
      <p className="text-xs flex items-center gap-2" style={{ color: "var(--kode-text-muted)" }}>
        <Spinner size="sm" />
        Loading plugin UI…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="text-sm" style={{ color: "var(--kode-text-muted)" }}>
        {state.message}
      </p>
    );
  }

  const Comp = state.Component;
  return (
    <PluginErrorBoundary slug={slug}>
      <Comp appId={appId} registrySlug={slug} />
    </PluginErrorBoundary>
  );
}
