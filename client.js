window.__ModuleLoader__.load({
	id: "dsh-plugin-environments",
	factory(require) {
		const module = { exports: {} };
		(function (module, exports, require) {
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target2, all) => {
  for (var name in all)
    __defProp(target2, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target2) => (target2 = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target2, "default", { value: mod, enumerable: true }) : target2,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/client/src/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var React9 = __toESM(require("react"), 1);
var import_react9 = require("react");

// packages/client/src/api.ts
var import_react = require("react");
var ROUTE = "api/environments";
var ApiError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
async function call(action, body = {}, signal) {
  const response = await fetch(ROUTE, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    ...signal ? { signal } : {}
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`HTTP ${response.status}`);
  }
  if (!data.ok) throw new ApiError(data.error ?? `HTTP ${response.status}`, data.code);
  return data.value;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
var listeners = /* @__PURE__ */ new Set();
function invalidate() {
  for (const l of listeners) l();
}
function onInvalidate(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function isUnknownAction(error) {
  return error instanceof Error && /unknown action/i.test(error.message);
}
function useEnvState(sessionId, { intervalMs = 4e3, discover = false } = {}) {
  const [state, setState] = (0, import_react.useState)({ data: void 0, error: void 0, loading: true });
  const [tick, setTick] = (0, import_react.useState)(0);
  const refresh = (0, import_react.useCallback)(() => setTick((v) => v + 1), []);
  const first = (0, import_react.useRef)(true);
  (0, import_react.useEffect)(() => {
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);
  (0, import_react.useEffect)(() => {
    let disposed = false;
    let timer;
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await call(
          "state",
          { sessionId, discover: discover && first.current },
          controller.signal
        );
        first.current = false;
        if (!disposed) setState({ data, error: void 0, loading: false });
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        setState((prev) => ({ ...prev, error: messageOf(error), loading: false }));
      }
      if (!disposed) {
        timer = setTimeout(() => {
          if (document.visibilityState === "visible") void load();
          else timer = setTimeout(() => void load(), intervalMs);
        }, intervalMs);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId, tick, intervalMs, discover]);
  return { ...state, refresh };
}
function useAction() {
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(void 0);
  const mounted = (0, import_react.useRef)(true);
  (0, import_react.useEffect)(
    () => () => {
      mounted.current = false;
    },
    []
  );
  const run = (0, import_react.useCallback)(async (fn) => {
    setBusy(true);
    setError(void 0);
    try {
      const value = await fn();
      invalidate();
      return value;
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
      return void 0;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: () => setError(void 0) };
}

// packages/client/src/binding-logic.ts
var WORKSPACE_ROW_PREFIX = "workspace:";
function workspaceIdOfRowKey(key) {
  if (!key?.startsWith(WORKSPACE_ROW_PREFIX)) return void 0;
  const id = key.slice(WORKSPACE_ROW_PREFIX.length);
  return id || void 0;
}
function pathKey(p) {
  if (!p) return "";
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(p);
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return windows ? s.toLowerCase() : s;
}
function isUnavailable(state) {
  return state === "offline" || state === "error";
}
function bindingsFromState(state, workspaces) {
  const bindings = [];
  for (const ws of workspaces) {
    const remote = state.remoteWorkspaces.find(
      (r) => r.workspaceId !== void 0 && r.workspaceId === ws.workspaceId || !!ws.path && pathKey(r.hostPath) === pathKey(ws.path)
    );
    if (!remote) continue;
    bindings.push({
      workspaceId: ws.workspaceId,
      path: ws.path ?? remote.hostPath,
      kind: "remote",
      envId: remote.envId,
      remoteRoot: remote.root,
      remoteWorkspace: { id: remote.id, title: remote.title }
    });
  }
  const availability = {};
  const devices = state.discovered.adb.filter(
    (d) => !!d && typeof d === "object"
  );
  const environments = [];
  for (const id of new Set(bindings.flatMap((b) => b.envId ? [b.envId] : []))) {
    const env = state.environments.find((e) => e.id === id);
    if (!env) {
      availability[id] = { state: "error", reason: `unknown environment "${id}"` };
      continue;
    }
    environments.push({ id: env.id, name: env.name, kind: env.kind });
    if (env.kind === "local") availability[id] = { state: "available" };
    else if (env.kind === "adb" && !state.discovered.adbError) {
      const d = devices.find((x) => x.serial === env.config.serial);
      availability[id] = d?.state === "device" ? { state: "available" } : { state: "offline", reason: d ? `device is ${String(d.state)}` : "device not connected" };
    } else availability[id] = { state: env.status?.busy ? "busy" : "unknown" };
  }
  return { bindings, availability, environments };
}
function bindingsById(view) {
  const map = /* @__PURE__ */ new Map();
  for (const b of view?.bindings ?? []) if (b.workspaceId) map.set(b.workspaceId, b);
  return map;
}
function workspacesKey(workspaces) {
  return workspaces.map((w) => `${w.workspaceId}\0${w.path ?? ""}`).join("");
}

// packages/client/src/bindings.ts
var INTERVAL_MS = 1e4;
var BindingsStore = class {
  snapshot = { supported: void 0, view: void 0, byId: /* @__PURE__ */ new Map(), error: void 0 };
  listeners = /* @__PURE__ */ new Set();
  workspaces = [];
  key = "";
  timer;
  inflight;
  stopInvalidate;
  seq = 0;
  subscribe = (listener) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };
  getSnapshot = () => this.snapshot;
  /** The workspaces currently listed; a change refetches immediately. */
  setWorkspaces(workspaces) {
    const key = workspacesKey(workspaces);
    if (key === this.key) return;
    this.key = key;
    this.workspaces = [...workspaces];
    if (this.listeners.size > 0) this.refresh();
  }
  refresh = () => {
    clearTimeout(this.timer);
    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    const mine = ++this.seq;
    void this.load(controller.signal).then(
      (next) => {
        if (mine === this.seq) this.set(next);
      },
      (error) => {
        if (mine === this.seq && !controller.signal.aborted) this.set({ ...this.snapshot, error: messageOf(error) });
      }
    ).finally(() => {
      if (mine !== this.seq || this.listeners.size === 0) return;
      this.timer = setTimeout(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") this.refresh();
        else this.timer = setTimeout(this.refresh, INTERVAL_MS);
      }, INTERVAL_MS);
    });
  };
  async load(signal) {
    const workspaces = this.workspaces;
    if (workspaces.length === 0) {
      return { ...this.snapshot, view: { bindings: [], availability: {}, environments: [] }, byId: /* @__PURE__ */ new Map() };
    }
    if (this.snapshot.supported !== false) {
      try {
        const view2 = await call("workspace.bindings", { workspaces }, signal);
        return { supported: true, view: view2, byId: bindingsById(view2), error: void 0 };
      } catch (error) {
        if (!isUnknownAction(error)) throw error;
      }
    }
    const state = await call("state", {}, signal);
    const view = bindingsFromState(state, workspaces);
    return { supported: false, view, byId: bindingsById(view), error: void 0 };
  }
  set(next) {
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
  start() {
    this.stopInvalidate = onInvalidate(this.refresh);
    this.refresh();
  }
  stop() {
    this.stopInvalidate?.();
    this.stopInvalidate = void 0;
    clearTimeout(this.timer);
    this.inflight?.abort();
    this.seq++;
  }
};

// packages/client/src/chip.tsx
var React3 = __toESM(require("react"), 1);
var import_react3 = require("react");
var import_react_dom = require("react-dom");

// packages/client/src/browser.tsx
var React2 = __toESM(require("react"), 1);
var import_react2 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/client/src/icons.tsx
var React = __toESM(require("react"), 1);
var base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
function Svg({ size = 20, children, ...rest }) {
  return /* @__PURE__ */ React.createElement("svg", { ...base, width: size, height: size, "aria-hidden": "true", ...rest }, children);
}
function IconEnvironments({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "12", height: "9", rx: "1.6" }), /* @__PURE__ */ React.createElement("path", { d: "M7 17h4M9 13v4" }), /* @__PURE__ */ React.createElement("rect", { x: "16", y: "9", width: "5", height: "11", rx: "1.4" }), /* @__PURE__ */ React.createElement("path", { d: "M18 17.5h1" }));
}
function IconLocal({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "12", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M8 20h8M12 16v4" }));
}
function IconServer({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "7", rx: "1.8" }), /* @__PURE__ */ React.createElement("rect", { x: "3", y: "13", width: "18", height: "7", rx: "1.8" }), /* @__PURE__ */ React.createElement("path", { d: "M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" }));
}
function IconSsh({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2.2" }), /* @__PURE__ */ React.createElement("path", { d: "m7 9 3 3-3 3M12.5 15H17" }));
}
function IconPhone({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("rect", { x: "6.5", y: "2.5", width: "11", height: "19", rx: "2.4" }), /* @__PURE__ */ React.createElement("path", { d: "M10.5 18.5h3" }));
}
function IconWindows({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M4 5.5 11 4.4V11H4zM13 4.1 20 3v8h-7zM4 13h7v6.6L4 18.5zM13 13h7v8l-7-1.1z" }));
}
function IconFolder({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M3 7.2A2.2 2.2 0 0 1 5.2 5h3.6l2 2.2h8A2.2 2.2 0 0 1 21 9.4v7.4A2.2 2.2 0 0 1 18.8 19H5.2A2.2 2.2 0 0 1 3 16.8z" }));
}
function IconFile({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M7 3h7l4 4v12.5A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3z" }), /* @__PURE__ */ React.createElement("path", { d: "M14 3v4h4" }));
}
function IconPlus({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M5 12h14" }));
}
function IconRefresh({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M20 11a8 8 0 0 0-14.6-4M4 4v4h4M4 13a8 8 0 0 0 14.6 4M20 20v-4h-4" }));
}
function IconTrash({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M4 7h16M10 11v6M14 11v6M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7" }));
}
function IconEdit({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "m14.5 5.5 4 4M4 20l1-4.5L16.3 4.2a1.7 1.7 0 0 1 2.4 0l1.1 1.1a1.7 1.7 0 0 1 0 2.4L8.5 19z" }));
}
function IconPlug({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" }));
}
function IconScreenshot({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M3 5h18v11H3zM9 20h6M12 16v4" }));
}
function IconUp({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M12 19V6M6 11l6-6 6 6" }));
}
function IconHome({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "m4 11 8-7 8 7M6 10v9h12v-9" }));
}
function IconChevron({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "m9 6 6 6-6 6" }));
}
function IconCheck({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "m5 12.5 4.5 4.5L19 7.5" }));
}
function IconDesktopShared({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M3 5h18v11H3zM9 20h6M12 16v4" }), /* @__PURE__ */ React.createElement("path", { d: "m10 8 4.5 1.6-2 .7-.7 2z" }));
}
function IconDesktopPrivate({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M7 3h14v9", strokeDasharray: "2 2.2" }), /* @__PURE__ */ React.createElement("path", { d: "M3 7h14v9H3zM7 20h6M10 16v4" }));
}
function IconDesktopSession({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M3 5h18v11H3zM9 20h6M12 16v4" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "9", r: "1.8" }), /* @__PURE__ */ React.createElement("path", { d: "M9 13.4a3.2 3.2 0 0 1 6 0" }));
}
function IconSpinner({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size, className: "envx-spin" }, /* @__PURE__ */ React.createElement("path", { d: "M12 3a9 9 0 1 0 9 9" }));
}
function IconReverse({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4" }));
}
function IconCopy({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("rect", { x: "9", y: "9", width: "11", height: "11", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M5 15V6a2 2 0 0 1 2-2h8" }));
}
function IconArrowRight({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("path", { d: "M3 12h17M15 7l5 5-5 5" }));
}
function IconKey({ size }) {
  return /* @__PURE__ */ React.createElement(Svg, { size }, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "15", r: "4" }), /* @__PURE__ */ React.createElement("path", { d: "m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" }));
}
var KIND_ICON = {
  local: IconLocal,
  server: IconServer,
  ssh: IconSsh,
  adb: IconPhone,
  winuser: IconWindows,
  reverse: IconReverse
};
function KindIcon({ kind, size = 20 }) {
  const C = (kind !== void 0 && Object.hasOwn(KIND_ICON, kind) ? KIND_ICON[kind] : void 0) ?? IconServer;
  return /* @__PURE__ */ React.createElement(C, { size });
}

// packages/client/src/names.ts
function envName(env, t) {
  if (!env) return "";
  return env.builtin && env.kind === "local" ? t("env.builtinLocal") : env.name;
}

// packages/client/src/browser.tsx
function formatSize(n) {
  if (n === void 0 || n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function baseName(p) {
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
function RemoteBrowser({
  open,
  mode = "workspace",
  environments,
  initialEnvId,
  initialPath,
  onClose,
  onPicked,
  onCreated,
  t
}) {
  const [envId, setEnvId] = (0, import_react2.useState)(initialEnvId);
  const [listing, setListing] = (0, import_react2.useState)(void 0);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(void 0);
  const [pathText, setPathText] = (0, import_react2.useState)("");
  const [title, setTitle] = (0, import_react2.useState)("");
  const [titleTouched, setTitleTouched] = (0, import_react2.useState)(false);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [newFolder, setNewFolder] = (0, import_react2.useState)(void 0);
  const seq = (0, import_react2.useRef)(0);
  const load = (0, import_react2.useCallback)(async (id, path) => {
    if (!id) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(void 0);
    try {
      const value = await call("fs.list", { envId: id, path });
      if (mine !== seq.current) return;
      setListing(value);
      setPathText(value.path);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(messageOf(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    const id = initialEnvId ?? environments[0]?.id;
    setEnvId(id);
    setListing(void 0);
    setTitle("");
    setTitleTouched(false);
    setNewFolder(void 0);
    void load(id, initialPath);
  }, [open, initialEnvId, initialPath]);
  const env = environments.find((e) => e.id === envId);
  const current = listing?.path;
  const derivedTitle = current && env ? `${baseName(current)} @ ${env.name}` : "";
  const effectiveTitle = titleTouched ? title : derivedTitle;
  const changeEnv = (id) => {
    setEnvId(id);
    setListing(void 0);
    void load(id, void 0);
  };
  const join = (name) => {
    const sep = listing?.sep ?? "/";
    const dir = current ?? "";
    return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
  };
  const createFolder = async () => {
    const name = (newFolder ?? "").trim();
    if (!name) {
      setNewFolder(void 0);
      return;
    }
    try {
      await call("fs.mkdir", { envId, path: join(name) });
      setNewFolder(void 0);
      void load(envId, join(name));
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const confirm = async (startSession) => {
    if (!current) return;
    if (mode === "pick") {
      if (envId) onPicked?.({ envId, path: current });
      return;
    }
    setBusy(true);
    setError(void 0);
    try {
      const value = await call("remoteWorkspace.create", {
        envId,
        root: current,
        title: effectiveTitle
      });
      invalidate();
      onCreated?.(value, startSession);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const dirs = (listing?.entries ?? []).filter((e) => e.type === "dir");
  const files = (listing?.entries ?? []).filter((e) => e.type !== "dir");
  const footer = /* @__PURE__ */ React2.createElement("div", { className: "envx-footer" }, mode === "workspace" && /* @__PURE__ */ React2.createElement(
    "input",
    {
      className: "envx-input",
      style: { flex: 1, minWidth: 0 },
      value: effectiveTitle,
      placeholder: t("browser.workspaceName"),
      "aria-label": t("browser.workspaceName"),
      onChange: (e) => {
        setTitle(e.target.value);
        setTitleTouched(true);
      }
    }
  ), mode !== "workspace" && /* @__PURE__ */ React2.createElement("span", { className: "envx-spacer" }), /* @__PURE__ */ React2.createElement(import_dsh_client_ui_primitives.Button, { variant: "ghost", onClick: onClose }, t("action.cancel")), mode === "workspace" && /* @__PURE__ */ React2.createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: !current || busy, onClick: () => void confirm(false) }, t("browser.create")), /* @__PURE__ */ React2.createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: !current || busy, onClick: () => void confirm(true) }, mode === "workspace" ? t("browser.createAndOpen") : t("action.choose")));
  return /* @__PURE__ */ React2.createElement(
    import_dsh_client_ui_primitives.Modal,
    {
      open,
      onClose,
      title: mode === "workspace" ? t("browser.title.workspace") : t("browser.title"),
      closeLabel: t("action.close"),
      footer,
      className: "envx-dialog-wide"
    },
    /* @__PURE__ */ React2.createElement("div", { className: "envx-browser" }, /* @__PURE__ */ React2.createElement("div", { className: "envx-browser-bar" }, /* @__PURE__ */ React2.createElement(
      "select",
      {
        className: "envx-input",
        value: envId ?? "",
        "aria-label": t("browser.env"),
        onChange: (e) => changeEnv(e.target.value)
      },
      environments.map((e) => /* @__PURE__ */ React2.createElement("option", { key: e.id, value: e.id }, envName(e, t)))
    ), /* @__PURE__ */ React2.createElement("div", { className: "envx-crumbs" }, /* @__PURE__ */ React2.createElement(
      "input",
      {
        value: pathText,
        "aria-label": t("browser.path"),
        spellCheck: false,
        onChange: (e) => setPathText(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") void load(envId, pathText.trim() || void 0);
        }
      }
    )), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "envx-iconbtn",
        title: t("action.up"),
        "aria-label": t("action.up"),
        disabled: !listing?.parent,
        onClick: () => void load(envId, listing?.parent)
      },
      /* @__PURE__ */ React2.createElement(IconUp, { size: 16 })
    ), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "envx-iconbtn",
        title: t("action.home"),
        "aria-label": t("action.home"),
        disabled: !listing?.home,
        onClick: () => void load(envId, listing?.home)
      },
      /* @__PURE__ */ React2.createElement(IconHome, { size: 16 })
    ), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "envx-iconbtn",
        title: t("action.newFolder"),
        "aria-label": t("action.newFolder"),
        disabled: !current,
        onClick: () => setNewFolder("")
      },
      /* @__PURE__ */ React2.createElement(IconPlus, { size: 16 })
    ), /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        className: "envx-iconbtn",
        title: t("action.refresh"),
        "aria-label": t("action.refresh"),
        onClick: () => void load(envId, current)
      },
      /* @__PURE__ */ React2.createElement(IconRefresh, { size: 16 })
    )), /* @__PURE__ */ React2.createElement("div", { className: "envx-browser-list", role: "list" }, loading && !listing && /* @__PURE__ */ React2.createElement("div", { className: "envx-browser-state" }, /* @__PURE__ */ React2.createElement(IconSpinner, { size: 16 }), t("browser.loading")), error && /* @__PURE__ */ React2.createElement(
      "div",
      {
        className: "envx-browser-state",
        style: { color: "var(--dsw-alias-state-error-primary)", flexDirection: "column" }
      },
      /* @__PURE__ */ React2.createElement("span", null, error),
      /* @__PURE__ */ React2.createElement("button", { type: "button", className: "envx-textbtn", onClick: () => void load(envId, listing?.path) }, t("action.retry"))
    ), !error && listing && /* @__PURE__ */ React2.createElement(React2.Fragment, null, newFolder !== void 0 && /* @__PURE__ */ React2.createElement("div", { className: "envx-entry", "data-type": "dir" }, /* @__PURE__ */ React2.createElement(IconFolder, { size: 16 }), /* @__PURE__ */ React2.createElement(
      "input",
      {
        className: "envx-input",
        style: { height: 26 },
        autoFocus: true,
        value: newFolder,
        placeholder: t("browser.folderName"),
        onChange: (e) => setNewFolder(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") void createFolder();
          if (e.key === "Escape") {
            e.stopPropagation();
            setNewFolder(void 0);
          }
        },
        onBlur: () => void createFolder()
      }
    )), dirs.map((e) => /* @__PURE__ */ React2.createElement(
      "button",
      {
        type: "button",
        key: `d:${e.name}`,
        className: "envx-entry",
        "data-type": "dir",
        onClick: () => void load(envId, join(e.name))
      },
      /* @__PURE__ */ React2.createElement(IconFolder, { size: 16 }),
      /* @__PURE__ */ React2.createElement("span", null, e.name)
    )), files.map((e) => /* @__PURE__ */ React2.createElement("div", { key: `f:${e.name}`, className: "envx-entry", "data-type": "file" }, /* @__PURE__ */ React2.createElement(IconFile, { size: 16 }), /* @__PURE__ */ React2.createElement("span", null, e.name), /* @__PURE__ */ React2.createElement("em", null, formatSize(e.size)))), dirs.length === 0 && files.length === 0 && newFolder === void 0 && /* @__PURE__ */ React2.createElement("div", { className: "envx-browser-state" }, t("browser.empty")))))
  );
}

// packages/client/src/chip.tsx
function Popover({ anchor, onClose, children }) {
  const ref = (0, import_react3.useRef)(null);
  const [pos, setPos] = (0, import_react3.useState)(void 0);
  (0, import_react3.useLayoutEffect)(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const el = ref.current;
      const h = el?.offsetHeight ?? 320;
      const w = el?.offsetWidth ?? 340;
      const above = r.top - 8 - h >= 8;
      const top = above ? r.top - 8 - h : Math.min(window.innerHeight - h - 8, r.bottom + 8);
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
      setPos({ top: Math.max(8, top), left });
    };
    place();
    const obs = new ResizeObserver(place);
    if (ref.current) obs.observe(ref.current);
    window.addEventListener("resize", place);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);
  (0, import_react3.useEffect)(() => {
    const onDown = (e) => {
      const target2 = e.target;
      if (ref.current?.contains(target2) || anchor.contains(target2)) return;
      if (target2?.closest?.("[role=dialog],[data-envx-keep]")) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ React3.createElement(
      "div",
      {
        ref,
        className: "envx-pop",
        role: "dialog",
        style: pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }
      },
      children
    ),
    document.body
  );
}
function Panel({ sessionId, data, t, openManager, onClose }) {
  const [browser, setBrowser] = (0, import_react3.useState)(void 0);
  const act = useAction();
  const remount = useAction();
  const [savedNote, setSavedNote] = (0, import_react3.useState)(false);
  const envs = data.environments;
  const byId = Object.fromEntries(envs.map((e) => [e.id, e]));
  const s = data.session;
  const mount = s?.mount;
  const mountEnv = mount ? byId[mount.envId] : void 0;
  const locked = !!s?.started;
  const choosable = !locked && !mount?.inherited && mount?.source !== "workspace";
  const borrowable = new Set(s?.borrowable ?? []);
  const candidates = envs.filter((e) => e.borrowable !== false);
  const modeLabel = (gui) => gui ? t("mode.gui") : t("mode.headless");
  const toggle = (id) => {
    const next = new Set(borrowable);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void act.run(() => call("session.set", { sessionId, borrowable: [...next], cwd: s?.cwd }));
  };
  const sourceLabel = s?.borrowableSource === "session" ? t("pop.borrow.custom") : s?.borrowableSource === "workspace" ? t("pop.borrow.inherit.workspace") : t("pop.borrow.inherit.all");
  return /* @__PURE__ */ React3.createElement(React3.Fragment, null, /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-section" }, /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-title" }, /* @__PURE__ */ React3.createElement("span", null, t("pop.mount")), mount?.source === "workspace" && !mount.inherited && /* @__PURE__ */ React3.createElement("small", null, t("pop.mount.fromWorkspace")), mount?.inherited && /* @__PURE__ */ React3.createElement("small", null, t("pop.mount.inherited"))), /* @__PURE__ */ React3.createElement("p", { className: "envx-pop-hint" }, locked ? t("pop.mount.locked") : t("pop.mount.hint")), (!mount || choosable) && /* @__PURE__ */ React3.createElement(
    "div",
    {
      className: "envx-pop-item",
      "data-kind": "local",
      "data-click": choosable && mount ? "" : void 0,
      role: choosable ? "radio" : void 0,
      "aria-checked": choosable ? !mount : void 0,
      tabIndex: choosable && mount ? 0 : void 0,
      onClick: () => {
        if (choosable && mount) void act.run(() => call("session.set", { sessionId, mount: null, cwd: s?.cwd }));
      }
    },
    /* @__PURE__ */ React3.createElement("span", { className: "envx-check", "data-on": !mount ? "" : void 0 }, /* @__PURE__ */ React3.createElement(IconCheck, { size: 12 })),
    /* @__PURE__ */ React3.createElement("span", { className: "envx-tile", "data-kind": "local" }, /* @__PURE__ */ React3.createElement(KindIcon, { kind: "local", size: 15 })),
    /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-item-main" }, /* @__PURE__ */ React3.createElement("strong", null, t("pop.host")), /* @__PURE__ */ React3.createElement("span", null, t("pop.host.desc")))
  ), mount && /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-item", "data-kind": mountEnv?.kind ?? "server" }, /* @__PURE__ */ React3.createElement("span", { className: "envx-check", "data-on": "" }, /* @__PURE__ */ React3.createElement(IconCheck, { size: 12 })), /* @__PURE__ */ React3.createElement("span", { className: "envx-tile", "data-kind": mountEnv?.kind ?? "server" }, /* @__PURE__ */ React3.createElement(KindIcon, { kind: mountEnv?.kind, size: 15 })), /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-item-main" }, /* @__PURE__ */ React3.createElement("strong", null, mountEnv ? envName(mountEnv, t) : mount.envId), /* @__PURE__ */ React3.createElement("span", { title: s.mountActive?.remoteRoot ?? mount.remoteRoot }, s.mountActive?.remoteRoot ?? mount.remoteRoot ?? "", s.mountActive ? ` \xB7 ${modeLabel(s.mountActive.gui)}` : "", !s.mountActive && !s.mountError ? ` \xB7 ${t("pop.mount.pending")}` : "")), choosable && /* @__PURE__ */ React3.createElement(
    "button",
    {
      type: "button",
      className: "envx-textbtn",
      "data-quiet": "",
      onClick: () => setBrowser({ envId: mount.envId })
    },
    t("pop.mount.pick")
  )), choosable && envs.filter((e) => e.id !== mount?.envId).map((env) => /* @__PURE__ */ React3.createElement(
    "div",
    {
      key: env.id,
      className: "envx-pop-item",
      "data-click": "",
      "data-kind": env.kind,
      role: "radio",
      "aria-checked": false,
      tabIndex: 0,
      onClick: () => setBrowser({ envId: env.id }),
      onKeyDown: (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setBrowser({ envId: env.id });
        }
      }
    },
    /* @__PURE__ */ React3.createElement("span", { className: "envx-check" }),
    /* @__PURE__ */ React3.createElement("span", { className: "envx-tile", "data-kind": env.kind }, /* @__PURE__ */ React3.createElement(KindIcon, { kind: env.kind, size: 15 })),
    /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-item-main" }, /* @__PURE__ */ React3.createElement("strong", null, envName(env, t)), /* @__PURE__ */ React3.createElement("span", null, t(`kind.${env.kind}`), " \xB7 ", modeLabel(env.effectiveMountMode === "gui")))
  )), (s?.mountBlocked ?? s?.mountError) && /* @__PURE__ */ React3.createElement("div", { className: "envx-error-line", style: { marginTop: 6 }, role: "alert" }, s.mountBlocked ?? t("pop.mount.error", { message: s.mountError ?? "" })), s?.mountBlocked && /* @__PURE__ */ React3.createElement(React3.Fragment, null, /* @__PURE__ */ React3.createElement("p", { className: "envx-pop-hint" }, t("pop.mount.blocked")), /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-foot" }, /* @__PURE__ */ React3.createElement(
    "button",
    {
      type: "button",
      className: "envx-textbtn",
      disabled: remount.busy,
      onClick: () => (
        // The outcome (mounted, or the new reason) shows up in the session state either way.
        void remount.run(() => call("session.remount", { sessionId }).finally(invalidate))
      )
    },
    remount.busy ? /* @__PURE__ */ React3.createElement(IconSpinner, { size: 13 }) : t("action.remount")
  )))), /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-section" }, /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-title" }, /* @__PURE__ */ React3.createElement("span", null, t("pop.borrow")), /* @__PURE__ */ React3.createElement("small", null, sourceLabel)), /* @__PURE__ */ React3.createElement("p", { className: "envx-pop-hint" }, t("pop.borrow.hint")), candidates.map((env) => {
    const held = (s?.held ?? []).find((h) => h.envId === env.id && !h.attached);
    const busyElsewhere = env.status?.busy && !held;
    const guiElsewhere = env.status?.gui && !held?.gui && !(s?.mountActive?.gui && mount?.envId === env.id);
    const guiWho = env.status?.gui?.title ?? env.status?.gui?.sessionId?.slice(0, 8) ?? "";
    return /* @__PURE__ */ React3.createElement(
      "div",
      {
        key: env.id,
        className: "envx-pop-item",
        "data-click": "",
        "data-kind": env.kind,
        role: "checkbox",
        "aria-checked": borrowable.has(env.id),
        tabIndex: 0,
        onClick: () => toggle(env.id),
        onKeyDown: (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle(env.id);
          }
        }
      },
      /* @__PURE__ */ React3.createElement("span", { className: "envx-check", "data-on": borrowable.has(env.id) ? "" : void 0 }, /* @__PURE__ */ React3.createElement(IconCheck, { size: 12 })),
      /* @__PURE__ */ React3.createElement("span", { className: "envx-tile", "data-kind": env.kind }, /* @__PURE__ */ React3.createElement(KindIcon, { kind: env.kind, size: 15 })),
      /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-item-main" }, /* @__PURE__ */ React3.createElement("strong", null, envName(env, t)), /* @__PURE__ */ React3.createElement("span", null, held ? `${t("badge.borrow")} \xB7 ${held.alias} \xB7 ${modeLabel(held.gui)}` : busyElsewhere ? t("status.busy") : guiElsewhere ? t("status.guiBy", { who: guiWho }) : `${t(`kind.${env.kind}`)}${env.description && env.description !== env.name ? ` \xB7 ${env.description}` : ""}`)),
      held && /* @__PURE__ */ React3.createElement(
        "button",
        {
          type: "button",
          className: "envx-textbtn",
          onClick: (e) => {
            e.stopPropagation();
            void act.run(() => call("lease.release", { leaseId: held.id }));
          }
        },
        t("action.return")
      )
    );
  }), /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-foot" }, s?.borrowableSource === "session" && /* @__PURE__ */ React3.createElement(
    "button",
    {
      type: "button",
      className: "envx-textbtn",
      "data-quiet": "",
      onClick: () => void act.run(() => call("session.set", { sessionId, borrowable: null }))
    },
    t("pop.borrow.reset")
  ), s?.cwd && s.borrowableSource === "workspace" && /* @__PURE__ */ React3.createElement(
    "button",
    {
      type: "button",
      className: "envx-textbtn",
      "data-quiet": "",
      onClick: () => void act.run(() => call("workspace.set", { workspacePath: s.cwd, borrowable: null }))
    },
    t("pop.borrow.clearWorkspace")
  ), s?.cwd && s.borrowableSource === "session" && /* @__PURE__ */ React3.createElement(
    "button",
    {
      type: "button",
      className: "envx-textbtn",
      "data-quiet": "",
      onClick: () => void act.run(async () => {
        await call("workspace.set", { workspacePath: s.cwd, borrowable: [...borrowable] });
        setSavedNote(true);
        setTimeout(() => setSavedNote(false), 2e3);
      })
    },
    savedNote ? t("pop.borrow.saved") : t("pop.borrow.saveWorkspace")
  ), /* @__PURE__ */ React3.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ React3.createElement(
    "button",
    {
      type: "button",
      className: "envx-textbtn",
      onClick: () => {
        onClose();
        openManager();
      }
    },
    t("action.manage")
  )), act.error && /* @__PURE__ */ React3.createElement("div", { className: "envx-error-line", style: { marginTop: 6 } }, act.error)), /* @__PURE__ */ React3.createElement(
    RemoteBrowser,
    {
      open: !!browser,
      mode: "pick",
      environments: envs,
      initialEnvId: browser?.envId,
      onClose: () => setBrowser(void 0),
      onPicked: ({ envId, path }) => {
        setBrowser(void 0);
        void act.run(() => call("session.set", { sessionId, mount: { envId, remoteRoot: path }, cwd: s?.cwd }));
      },
      t
    }
  ));
}
function EnvironmentChip({
  sessionId,
  t,
  openManager
}) {
  const [open, setOpen] = (0, import_react3.useState)(false);
  const anchor = (0, import_react3.useRef)(null);
  const { data } = useEnvState(sessionId, { intervalMs: open ? 2500 : 8e3 });
  const s = data?.session;
  const mount = s?.mount;
  const mountEnv = mount ? data?.environments.find((e) => e.id === mount.envId) : void 0;
  const mountName = mountEnv ? envName(mountEnv, t) : mount?.envId ?? "";
  const heldCount = s?.held.filter((h) => !h.attached).length ?? 0;
  const blocked = s?.mountBlocked;
  const gui = !!s?.mountActive?.gui;
  const label = mount ? mountName : t("chip.host");
  const title = [
    blocked ?? (mount ? t("chip.mounted", { name: mountName }) : t("chip.host.title")),
    mount && s?.mountActive ? gui ? t("mode.gui") : t("mode.headless") : void 0,
    heldCount ? t("chip.borrowed", { count: heldCount }) : void 0
  ].filter(Boolean).join(" \xB7 ");
  (0, import_react3.useEffect)(() => {
    if (open) invalidate();
  }, [open]);
  return /* @__PURE__ */ React3.createElement(React3.Fragment, null, /* @__PURE__ */ React3.createElement(
    "button",
    {
      ref: anchor,
      type: "button",
      className: "envx-chipbtn",
      "data-active": mount && !blocked ? "" : void 0,
      "data-error": blocked ? "" : void 0,
      "aria-expanded": open,
      "aria-haspopup": "dialog",
      title,
      onClick: () => setOpen((v) => !v)
    },
    /* @__PURE__ */ React3.createElement(KindIcon, { kind: mount ? mountEnv?.kind ?? "server" : "local", size: 16 }),
    /* @__PURE__ */ React3.createElement("span", null, label),
    gui && /* @__PURE__ */ React3.createElement("em", null, t("mode.gui")),
    blocked && /* @__PURE__ */ React3.createElement("i", { "aria-hidden": "true" }),
    heldCount > 0 && /* @__PURE__ */ React3.createElement("b", null, heldCount)
  ), open && anchor.current && /* @__PURE__ */ React3.createElement(Popover, { anchor: anchor.current, onClose: () => setOpen(false) }, data ? /* @__PURE__ */ React3.createElement(Panel, { sessionId, data, t, openManager, onClose: () => setOpen(false) }) : /* @__PURE__ */ React3.createElement("div", { className: "envx-pop-section" }, /* @__PURE__ */ React3.createElement(IconSpinner, { size: 16 }))));
}

// packages/client/src/locales.ts
var NS = "environments";
var zh = {
  panel: "\u73AF\u5883",
  "page.title": "\u73AF\u5883",
  "page.subtitle": "\u8BA9\u667A\u80FD\u4F53\u4F7F\u7528\u5176\u4ED6\u8BBE\u5907\uFF1A\u6302\u8F7D\u4E3A\u5DE5\u4F5C\u533A\uFF0C\u6216\u5728\u9700\u8981\u65F6\u501F\u7528\u3002",
  "action.refresh": "\u5237\u65B0",
  "action.add": "\u6DFB\u52A0\u73AF\u5883",
  "action.test": "\u6D4B\u8BD5\u8FDE\u63A5",
  "action.testing": "\u8FDE\u63A5\u4E2D\u2026",
  "action.edit": "\u7F16\u8F91",
  "action.delete": "\u5220\u9664",
  "action.cancel": "\u53D6\u6D88",
  "action.save": "\u4FDD\u5B58",
  "action.saveAndTest": "\u4FDD\u5B58\u5E76\u6D4B\u8BD5",
  "action.close": "\u5173\u95ED",
  "action.viewDesktop": "\u67E5\u770B\u684C\u9762",
  "session.title": "\u72EC\u7ACB\u4F1A\u8BDD\u6A21\u5F0F",
  "session.purpose": "\u8BA9\u6BCF\u4E2A Windows \u8D26\u6237\u767B\u5F55\u5230\u81EA\u5DF1\u7684\u4F1A\u8BDD\uFF1A\u6709\u72EC\u7ACB\u7684\u9F20\u6807\u6307\u9488\u548C\u771F\u5B9E\u952E\u9F20\u8F93\u5165\uFF0C\u4E0D\u4F1A\u548C\u4F60\u62A2\u9F20\u6807\uFF0C\u4E5F\u4E0D\u4F1A\u51FA\u73B0\u5728\u4F60\u7684\u5C4F\u5E55\u4E0A\u3002",
  "session.probing": "\u6B63\u5728\u68C0\u6D4B\u672C\u673A\u2026",
  "session.badge.probing": "\u68C0\u6D4B\u4E2D",
  "session.badge.ready": "\u5DF2\u5C31\u7EEA",
  "session.badge.setup": "\u9700\u8981\u8BBE\u7F6E",
  "session.badge.reboot": "\u5F85\u91CD\u542F",
  "session.badge.error": "\u68C0\u6D4B\u5931\u8D25",
  "session.line.ready": "\u9009\u62E9\u300C\u72EC\u7ACB\u4F1A\u8BDD\u300D\u7684\u8D26\u6237\u4F1A\u767B\u5F55\u5230\u81EA\u5DF1\u7684 Windows \u4F1A\u8BDD\u3002",
  "session.line.install.home": "Windows \u5BB6\u5EAD\u7248\u4E0D\u80FD\u6258\u7BA1\u8FDC\u7A0B\u684C\u9762\u4F1A\u8BDD\uFF0C\u5B89\u88C5 TermWrap \u8865\u4E01\u540E\u5373\u53EF\u4F7F\u7528\u3002",
  "session.line.install.client": "\u672C\u673A\u7684 Windows \u7248\u672C\u540C\u4E00\u65F6\u95F4\u53EA\u5141\u8BB8\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u5B89\u88C5 TermWrap \u8865\u4E01\u540E\u5373\u53EF\u4F7F\u7528\u3002",
  "session.line.enable": "Server \u7248\u539F\u751F\u652F\u6301\u591A\u4F1A\u8BDD\uFF0C\u53EA\u9700\u5F00\u542F\u8FDC\u7A0B\u684C\u9762\u4E3B\u673A\u3002",
  "session.line.reboot": "TermWrap \u5DF2\u5B89\u88C5\uFF0C\u4F46\u670D\u52A1\u6CA1\u80FD\u81EA\u52A8\u91CD\u8F7D\uFF1B\u91CD\u542F\u7535\u8111\u540E\u751F\u6548\u3002",
  "session.line.manual": "\u8FD9\u4E2A\u6784\u5EFA\u6CA1\u6709\u9644\u5E26 TermWrap\uFF0C\u8BF7\u6309 docs/session-mode.md \u624B\u52A8\u5B89\u88C5\u540E\u91CD\u542F\u3002",
  "session.line.unsupported": "\u53EA\u6709 Windows \u4E3B\u673A\u652F\u6301\u72EC\u7ACB\u4F1A\u8BDD\u3002",
  "session.line.error": "\u65E0\u6CD5\u68C0\u6D4B\uFF1A{message}",
  "session.check.termwrap": "TermWrap \u591A\u4F1A\u8BDD\u8865\u4E01",
  "session.check.rdp": "\u8FDC\u7A0B\u684C\u9762\u4E3B\u673A\u5DF2\u5F00\u542F",
  "session.check.rfxvmt": "rfxvmt.dll \u7EC4\u4EF6",
  "session.check.group": "Remote Desktop Users \u7EC4",
  "session.check.service": "Terminal Services \u6B63\u5728\u8FD0\u884C",
  "session.check.listener": "3389 \u7AEF\u53E3\u6B63\u5728\u76D1\u542C",
  "session.action.install": "\u5B89\u88C5 TermWrap",
  "session.action.enable": "\u5F00\u542F\u8FDC\u7A0B\u684C\u9762",
  "session.action.recheck": "\u91CD\u65B0\u68C0\u6D4B",
  "session.action.details": "\u8BE6\u60C5",
  "session.action.hide": "\u6536\u8D77",
  "session.working": "\u5904\u7406\u4E2D\u2026",
  "session.note.admin": "\u9700\u8981\u7BA1\u7406\u5458\u6388\u6743\uFF0C\u901A\u5E38\u4E0D\u7528\u91CD\u542F\u3002",
  "session.note.adminReboot": "\u9700\u8981\u7BA1\u7406\u5458\u6388\u6743\uFF1B\u5B8C\u6210\u540E\u4F1A\u81EA\u52A8\u91CD\u542F\u8FDC\u7A0B\u684C\u9762\u670D\u52A1\uFF0C\u4E0D\u9700\u8981\u91CD\u542F\u7535\u8111\u3002",
  "session.install.detail": "\u968F\u5305 TermWrap {version}\uFF08MIT \u8BB8\u53EF\uFF0C{files} \u4E2A\u6587\u4EF6\uFF0C\u5B89\u88C5\u65F6\u4E0D\u8054\u7F51\uFF09\u3002\u5B89\u88C5\u4F1A\u628A %ProgramFiles%\\RDP Wrapper \u52A0\u5165 Defender \u6392\u9664\u9879\u3001\u628A Terminal Services \u7684\u670D\u52A1 DLL \u6307\u5411\u5B83\u3001\u5F00\u542F\u8FDC\u7A0B\u684C\u9762\uFF0C\u7136\u540E\u81EA\u52A8\u91CD\u542F\u8BE5\u670D\u52A1\u8BA9\u8865\u4E01\u7ACB\u5373\u751F\u6548\uFF08\u53EA\u6709\u91CD\u542F\u670D\u52A1\u5931\u8D25\u65F6\u624D\u9700\u8981\u91CD\u542F\u7535\u8111\uFF09\u3002",
  "session.enable.detail": "\u4F1A\u5F00\u542F\u8FDC\u7A0B\u684C\u9762\u4E3B\u673A\uFF08fDenyTSConnections=0\uFF09\u5E76\u542F\u52A8 Terminal Services\u3002",
  "session.ready.detail": "\u672C\u673A\u53EF\u4EE5\u4E3A\u6BCF\u4E2A\u8D26\u6237\u6258\u7BA1\u72EC\u7ACB\u7684 Windows \u4F1A\u8BDD\u3002",
  "session.edition": "\u7CFB\u7EDF\u7248\u672C\uFF1A{edition}\u3002",
  "session.done.enable": "\u5DF2\u5F00\u542F\u3002\u5982\u679C\u72B6\u6001\u6CA1\u6709\u53D8\u5316\uFF0C\u70B9\u300C\u91CD\u65B0\u68C0\u6D4B\u300D\u3002",
  "session.done.install": "\u5DF2\u5B89\u88C5\u5E76\u751F\u6548\uFF0C\u4E0D\u9700\u8981\u91CD\u542F\u7535\u8111\u3002",
  "session.done.installReboot": "\u5DF2\u5B89\u88C5\uFF0C\u4F46\u8FDC\u7A0B\u684C\u9762\u670D\u52A1\u6CA1\u80FD\u81EA\u52A8\u91CD\u8F7D\uFF1B\u8BF7\u91CD\u542F\u7535\u8111\u3002",
  "action.pause": "\u6682\u505C",
  "action.resume": "\u7EE7\u7EED",
  "desktop.title": "{{name}} \u7684\u684C\u9762",
  "desktop.mode.shared": "\u5171\u7528\u684C\u9762",
  "desktop.mode.private": "\u72EC\u7ACB\u684C\u9762",
  "desktop.mode.session": "\u72EC\u7ACB\u4F1A\u8BDD",
  "desktop.mode.shared.desc": "\u7A0B\u5E8F\u663E\u793A\u5728\u4F60\u7684\u5C4F\u5E55\u4E0A\uFF0C\u4E0E\u4F60\u5171\u7528\u9F20\u6807\u952E\u76D8",
  "desktop.mode.private.desc": "\u5728\u9690\u85CF\u7684\u684C\u9762\u91CC\u8FD0\u884C\uFF0C\u53EF\u901A\u8FC7\u300C\u67E5\u770B\u684C\u9762\u300D\u89C2\u770B",
  "desktop.mode.session.desc": "\u767B\u5F55\u5230\u81EA\u5DF1\u7684 Windows \u4F1A\u8BDD\uFF0C\u6709\u72EC\u7ACB\u6307\u9488\u548C\u771F\u5B9E\u8F93\u5165",
  "desktop.mode.session.notReady": "\u4E5F\u53EF\u4EE5\u5148\u4FDD\u5B58\uFF0C\u8BBE\u7F6E\u5B8C\u6210\u540E\u5373\u53EF\u8FDE\u63A5\u3002",
  "desktop.card.notReady": "\u672C\u673A\u8FD8\u4E0D\u80FD\u6258\u7BA1\u72EC\u7ACB\u4F1A\u8BDD\uFF0C\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u3002",
  "desktop.card.setup": "\u53BB\u8BBE\u7F6E",
  "desktop.saved.notReady": "\u5DF2\u4FDD\u5B58\u3002\u672C\u673A\u5B8C\u6210\u72EC\u7ACB\u4F1A\u8BDD\u8BBE\u7F6E\u540E\u5373\u53EF\u8FDE\u63A5\u3002",
  "desktop.size": "{{w}}\xD7{{h}}",
  "desktop.fps": "{{fps}} fps",
  "desktop.connecting": "\u6B63\u5728\u83B7\u53D6\u753B\u9762\u2026",
  "desktop.hint": "\u8FD9\u662F\u8BE5\u73AF\u5883\u5F53\u524D\u684C\u9762\u7684\u5B9E\u65F6\u753B\u9762\uFF08\u7EA6\u6BCF\u79D2 4 \u5E27\uFF0C\u5DF2\u7F29\u5C0F\uFF09\u3002\u72EC\u7ACB\u684C\u9762\u4E0A\u7684\u7A97\u53E3\u4E0D\u4F1A\u51FA\u73B0\u5728\u4F60\u81EA\u5DF1\u7684\u684C\u9762\u4E0A\u3002",
  "action.newWorkspace": "\u65B0\u5EFA\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
  "action.browse": "\u6D4F\u89C8\u6587\u4EF6",
  "action.release": "\u91CA\u653E",
  "action.return": "\u5F52\u8FD8",
  "action.newSession": "\u65B0\u4F1A\u8BDD",
  "action.remove": "\u79FB\u9664",
  "action.addDevice": "\u6DFB\u52A0\u5230\u5217\u8868",
  "action.create": "\u521B\u5EFA",
  "action.manage": "\u7BA1\u7406\u73AF\u5883\u2026",
  "action.apply": "\u5E94\u7528",
  "action.unmount": "\u53D6\u6D88\u6302\u8F7D",
  "action.choose": "\u9009\u62E9\u6B64\u76EE\u5F55",
  "action.up": "\u4E0A\u4E00\u7EA7",
  "action.home": "\u4E3B\u76EE\u5F55",
  "action.newFolder": "\u65B0\u5EFA\u6587\u4EF6\u5939",
  "action.open": "\u6253\u5F00",
  "action.retry": "\u91CD\u8BD5",
  "action.done": "\u5B8C\u6210",
  "action.copy": "\u590D\u5236",
  "action.copied": "\u5DF2\u590D\u5236",
  "action.saveAndGenerate": "\u4FDD\u5B58\u5E76\u751F\u6210\u547D\u4EE4",
  "kind.local": "\u672C\u673A\u8FDB\u7A0B",
  "kind.server": "\u73AF\u5883\u670D\u52A1\u5668",
  "kind.ssh": "SSH",
  "kind.adb": "Android (ADB)",
  "kind.winuser": "Windows \u8D26\u6237",
  "kind.reverse": "\u73AF\u5883\u670D\u52A1\u5668\uFF08\u53CD\u5411\uFF09",
  "kind.local.desc": "\u5728\u8FD0\u884C dsh \u7684\u7535\u8111\u4E0A\u5355\u72EC\u542F\u52A8\u7684 dsh-env-server \u8FDB\u7A0B",
  "kind.server.desc": "\u8FD0\u884C dsh-env-server \u7684\u673A\u5668\uFF0C\u53EF\u4EE5\u76F4\u8FDE\uFF0C\u4E5F\u53EF\u4EE5\u8BA9\u5B83\u53CD\u5411\u8FDE\u5165",
  "kind.ssh.desc": "\u901A\u8FC7 SSH \u8FDE\u63A5\u670D\u52A1\u5668",
  "kind.adb.desc": "\u771F\u673A\u6216\u6A21\u62DF\u5668\uFF0C\u901A\u8FC7 adb \u63A7\u5236",
  "kind.winuser.desc": "\u672C\u673A\u4E0A\u7684\u53D7\u9650\u6D4B\u8BD5\u8D26\u6237\uFF0C\u53EF\u8FD0\u884C\u56FE\u5F62\u754C\u9762\u7A0B\u5E8F",
  "kind.reverse.desc": "\u7531\u76EE\u6807\u673A\u5668\u4E3B\u52A8\u8FDE\u63A5\u8FC7\u6765\uFF08\u76EE\u6807\u673A\u5668\u6CA1\u6709\u516C\u7F51\u5730\u5740\u65F6\u4F7F\u7528\uFF09",
  "section.environments": "\u73AF\u5883",
  "section.workspaces": "\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
  "section.workspaces.hint": "\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u91CC\u7684\u4F1A\u8BDD\u4F1A\u76F4\u63A5\u5728\u8BE5\u73AF\u5883\u4E2D\u8BFB\u5199\u6587\u4EF6\u3001\u6267\u884C\u547D\u4EE4\u3002",
  "section.workspaces.empty": "\u8FD8\u6CA1\u6709\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u3002\u5728\u4EFB\u610F\u73AF\u5883\u5361\u7247\u4E0A\u9009\u62E9\u201C\u65B0\u5EFA\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u201D\u3002",
  "section.leases": "\u4F7F\u7528\u4E2D",
  "section.leases.empty": "\u5F53\u524D\u6CA1\u6709\u4F1A\u8BDD\u5728\u4F7F\u7528\u73AF\u5883\u3002",
  "section.accounts": "Windows \u6D4B\u8BD5\u8D26\u6237",
  "section.accounts.hint": "\u53D7\u9650\u7684\u672C\u5730\u6807\u51C6\u8D26\u6237\u3002\u4EE5\u5B83\u8FD0\u884C\u7684\u7A0B\u5E8F\u663E\u793A\u5728\u5F53\u524D\u684C\u9762\u4E0A\uFF0C\u4FBF\u4E8E\u667A\u80FD\u4F53\u8FDB\u884C\u754C\u9762\u6D4B\u8BD5\u3002\u521B\u5EFA\u548C\u5220\u9664\u9700\u8981\u7BA1\u7406\u5458\u786E\u8BA4\u3002",
  "section.accounts.empty": "\u8FD8\u6CA1\u6709\u6D4B\u8BD5\u8D26\u6237\u3002",
  "status.available": "\u7A7A\u95F2",
  "status.busy": "\u4F7F\u7528\u4E2D",
  "status.busyBy": "{who} \u4F7F\u7528\u4E2D",
  "status.queue": "{count} \u4E2A\u4F1A\u8BDD\u6392\u961F",
  "status.offline": "\u79BB\u7EBF",
  "status.unknown": "\u672A\u68C0\u6D4B",
  "status.connected": "\u53EF\u8FDE\u63A5 \xB7 {ms} ms",
  "status.failed": "\u8FDE\u63A5\u5931\u8D25",
  "status.discovered": "\u81EA\u52A8\u53D1\u73B0",
  "status.builtin": "\u5185\u7F6E",
  "status.shared": "\u65E0\u754C\u9762\u53EF\u5E76\u884C",
  "status.exclusive": "\u72EC\u5360",
  "status.guiBy": "GUI\uFF1A{who}",
  "badge.mount": "\u6302\u8F7D",
  "badge.borrow": "\u501F\u7528",
  "field.name": "\u540D\u79F0",
  "field.name.ph": "\u4F8B\u5982\uFF1A\u6D4B\u8BD5\u673A Pixel 8",
  "field.id": "\u6807\u8BC6",
  "field.id.hint": "\u667A\u80FD\u4F53\u501F\u7528\u540E\uFF0C\u5DE5\u5177\u540D\u4EE5\u5B83\u4E3A\u524D\u7F00\uFF0C\u4F8B\u5982 {alias}__screenshot",
  "field.description": "\u5907\u6CE8",
  "field.host": "\u4E3B\u673A",
  "field.port": "\u7AEF\u53E3",
  "field.token": "\u4EE4\u724C",
  "field.token.hint": "\u670D\u52A1\u7AEF\u7684\u5171\u4EAB\u5BC6\u94A5\uFF1A\u542F\u52A8\u65F6\u6253\u5370\uFF0C\u6216\u901A\u8FC7 --token-file / --token-stdin \u6307\u5B9A\u3002\u7528\u4E8E\u53CC\u5411\u8BA4\u8BC1\u548C\u52A0\u5BC6\uFF0C\u4E0D\u4F1A\u660E\u6587\u4F20\u8F93",
  "field.url": "\u5730\u5740\uFF08URL\uFF09",
  "field.url.hint": "tcp://\u4E3B\u673A:\u7AEF\u53E3\u3001ws://\u4E3B\u673A:\u7AEF\u53E3/\u8DEF\u5F84\uFF0C\u6216\u7ECF TLS \u53CD\u5411\u4EE3\u7406\u7684 wss://\u2026",
  "field.username": "\u7528\u6237\u540D",
  "field.password": "\u5BC6\u7801",
  "field.password.hint": "\u7559\u7A7A\u5219\u4F7F\u7528\u5BC6\u94A5\u6216 ssh-agent",
  "field.privateKey": "\u79C1\u94A5\u8DEF\u5F84",
  "field.privateKey.ph": "~/.ssh/id_ed25519",
  "field.passphrase": "\u79C1\u94A5\u53E3\u4EE4",
  "field.serverPath": "\u8FDC\u7AEF dsh-env-server \u8DEF\u5F84",
  "field.serverPath.hint": "\u53EF\u9009\u3002\u586B\u5199\u540E\u901A\u8FC7 SSH \u542F\u52A8\u5B83\uFF0C\u83B7\u5F97 UDP \u96A7\u9053\u3001\u539F\u751F\u641C\u7D22\u7B49\u5B8C\u6574\u80FD\u529B",
  "field.cwd": "\u9ED8\u8BA4\u76EE\u5F55",
  "field.serial": "\u8BBE\u5907\u5E8F\u5217\u53F7",
  "field.serial.hint": "\u6765\u81EA adb devices\uFF0C\u4F8B\u5982 emulator-5554 \u6216 192.168.1.20:5555",
  "field.account": "\u8D26\u6237\u540D",
  "field.account.hint": "1\u201320 \u4E2A\u5B57\u6BCD\u3001\u6570\u5B57\u3001_ \u6216 -",
  "field.account.hint.create": "1\u201320 \u4E2A\u5B57\u6BCD\u3001\u6570\u5B57\u3001_ \u6216 -\u3002\u4F1A\u521B\u5EFA\u4E00\u4E2A\u53D7\u9650\u7684\u672C\u5730\u6807\u51C6\u8D26\u6237\uFF0CWindows \u4F1A\u5F39\u51FA\u7BA1\u7406\u5458\u786E\u8BA4\u3002",
  "field.desktop": "\u684C\u9762",
  "field.headlessParallel": "\u65E0\u754C\u9762\u4F7F\u7528\u53EF\u5E76\u884C",
  "field.headlessParallel.hint": "\u591A\u4E2A\u4F1A\u8BDD\u53EF\u4EE5\u540C\u65F6\u4EE5\u65E0\u754C\u9762\u65B9\u5F0F\u4F7F\u7528\u5B83\uFF08\u6587\u4EF6\u3001\u547D\u4EE4\u3001\u8FDB\u7A0B\u3001\u96A7\u9053\uFF09\uFF1BGUI\uFF08\u622A\u56FE\u3001\u952E\u9F20\u3001\u754C\u9762\u64CD\u4F5C\uFF09\u59CB\u7EC8\u53EA\u80FD\u7531\u4E00\u4E2A\u4F1A\u8BDD\u6301\u6709\uFF0C\u5176\u4ED6\u4F1A\u8BDD\u6392\u961F\u3002\u5173\u95ED\u540E\u6574\u4E2A\u73AF\u5883\u540C\u4E00\u65F6\u95F4\u53EA\u5141\u8BB8\u4E00\u4E2A\u4F1A\u8BDD\u4F7F\u7528\u3002",
  "field.mountMode": "\u6302\u8F7D\u65B9\u5F0F",
  "field.mountMode.hint": "\u6302\u8F7D\u5230\u6B64\u73AF\u5883\u7684\u4F1A\u8BDD\u9ED8\u8BA4\u4EE5\u54EA\u79CD\u65B9\u5F0F\u5360\u7528\u5B83\u3002GUI \u88AB\u522B\u7684\u4F1A\u8BDD\u5360\u7528\u65F6\uFF0C\u6302\u8F7D\u9000\u56DE\u65E0\u754C\u9762\u65B9\u5F0F\u3002",
  "field.mountMode.default": "\u9ED8\u8BA4\uFF08{mode}\uFF09",
  "mode.headless": "\u65E0\u754C\u9762",
  "mode.gui": "GUI",
  "mode.headless.desc": "\u6587\u4EF6\u3001\u547D\u4EE4\u3001\u8FDB\u7A0B",
  "mode.gui.desc": "\u53E6\u542B\u622A\u56FE\u3001\u952E\u9F20\u3001\u754C\u9762\u64CD\u4F5C",
  "field.borrowable": "\u5141\u8BB8\u501F\u7528",
  "field.kind": "\u7C7B\u578B",
  "dialog.add": "\u6DFB\u52A0\u73AF\u5883",
  "dialog.edit": "\u7F16\u8F91\u73AF\u5883",
  "dialog.delete.title": "\u5220\u9664\u73AF\u5883",
  "dialog.delete.body": "\u786E\u5B9A\u5220\u9664\u201C{name}\u201D\u5417\uFF1F\u6B63\u5728\u4F7F\u7528\u5B83\u7684\u4F1A\u8BDD\u4F1A\u7ACB\u5373\u65AD\u5F00\u3002",
  "dialog.account.delete": "\u786E\u5B9A\u5220\u9664\u8D26\u6237\u201C{name}\u201D\u53CA\u5176\u7528\u6237\u914D\u7F6E\u6587\u4EF6\u5417\uFF1FWindows \u4F1A\u5F39\u51FA\u7BA1\u7406\u5458\u786E\u8BA4\u3002",
  "server.help.title": "\u5982\u4F55\u5728\u76EE\u6807\u673A\u5668\u4E0A\u542F\u52A8\u670D\u52A1",
  "server.help.body": "\u628A dsh-env-server \u590D\u5236\u5230\u76EE\u6807\u673A\u5668\uFF0C\u628A\u4EE4\u724C\u5199\u5165 token.txt\uFF08\u4E0D\u5199\u5219\u542F\u52A8\u65F6\u968F\u673A\u751F\u6210\u5E76\u6253\u5370\uFF09\uFF0C\u7136\u540E\u8FD0\u884C\u5176\u4E2D\u4E00\u6761\uFF1A",
  "server.help.tcp": "TCP",
  "server.help.ws": "WebSocket\uFF08\u53EF\u653E\u5728 TLS \u53CD\u5411\u4EE3\u7406\u4E4B\u540E\uFF09",
  "field.direction": "\u8FDE\u63A5\u65B9\u5F0F",
  "direction.direct": "\u76F4\u8FDE",
  "direction.direct.desc": "dsh \u8FDE\u63A5\u5230\u76EE\u6807\u673A\u5668\u4E0A\u76D1\u542C\u7684\u670D\u52A1\uFF0C\u76EE\u6807\u673A\u5668\u9700\u8981\u80FD\u4ECE\u672C\u673A\u8BBF\u95EE\u5230\u3002",
  "direction.reverse": "\u53CD\u5411\u8FDE\u63A5",
  "direction.reverse.desc": "\u76EE\u6807\u673A\u5668\u4E3B\u52A8\u8FDE\u56DE\u672C\u673A\uFF0C\u9002\u5408\u6CA1\u6709\u516C\u7F51\u5730\u5740\u3001\u5728 NAT \u6216\u9632\u706B\u5899\u4E4B\u540E\u7684\u673A\u5668\u3002",
  "direction.this": "\u672C\u673A",
  "direction.target": "\u76EE\u6807\u673A",
  "direction.locked": "\u521B\u5EFA\u540E\u4E0D\u80FD\u66F4\u6539\u8FDE\u63A5\u65B9\u5F0F",
  "field.address": "\u5730\u5740",
  "address.hostPort": "\u4E3B\u673A\u548C\u7AEF\u53E3",
  "address.url": "URL",
  "more.title": "\u66F4\u591A\u9009\u9879",
  "reverse.listener.title": "\u672C\u673A\u76D1\u542C",
  "reverse.listener.body": "\u6240\u6709\u53CD\u5411\u8FDE\u63A5\u5171\u7528\u8FD9\u4E9B\u76D1\u542C\u3002\u76EE\u6807\u673A\u5668\u8FD0\u884C dsh-env-server connect \u8FDE\u5230\u8FD9\u91CC\uFF1B\u9700\u8981\u7ECF\u516C\u7F51\u8BBF\u95EE\u65F6\uFF0C\u8BF7\u5728\u9632\u706B\u5899/\u8DEF\u7531\u5668\u653E\u884C\u7AEF\u53E3\uFF0C\u6216\u653E\u5728 TLS \u53CD\u5411\u4EE3\u7406\u4E4B\u540E\u3002",
  "reverse.listener.off": "\u672A\u5F00\u542F",
  "reverse.listener.on": "\u6B63\u5728\u76D1\u542C\u7AEF\u53E3 {port}",
  "reverse.listener.none": "\u672A\u5F00\u542F\u4EFB\u4F55\u76D1\u542C",
  "reverse.listener.autoTcp": "\u672A\u5F00\u542F\u4EFB\u4F55\u76D1\u542C \xB7 \u4FDD\u5B58\u65F6\u4F1A\u81EA\u52A8\u5F00\u542F TCP\uFF08\u7AEF\u53E3 {port}\uFF09",
  "reverse.listener.failed": "{proto} \u76D1\u542C\u5931\u8D25\uFF1A{error}",
  "reverse.listener.dirty": "\u6709\u672A\u5E94\u7528\u7684\u66F4\u6539\uFF0C\u4FDD\u5B58\u65F6\u4F1A\u4E00\u5E76\u5E94\u7528\u3002",
  "reverse.next.title": "\u4FDD\u5B58\u4E4B\u540E",
  "reverse.next.body": "\u4F1A\u751F\u6210\u4E00\u4E2A\u5BC6\u94A5\u548C\u4E00\u6761\u547D\u4EE4\u3002\u5728\u76EE\u6807\u673A\u5668\u4E0A\u8FD0\u884C\u8FD9\u6761\u547D\u4EE4\uFF0C\u5B83\u5C31\u4F1A\u8FDE\u4E0A\u6765\uFF0C\u65AD\u7EBF\u540E\u4E5F\u4F1A\u81EA\u52A8\u91CD\u8FDE\u3002",
  "reverse.command.again": "\u5BC6\u94A5\u53EA\u5728\u751F\u6210\u65F6\u663E\u793A\u4E00\u6B21\u3002\u8981\u8BA9\u53E6\u4E00\u53F0\u673A\u5668\u8FDE\u63A5\u6216\u627E\u56DE\u547D\u4EE4\uFF0C\u53EF\u4EE5\u91CD\u65B0\u751F\u6210\uFF1B\u65E7\u5BC6\u94A5\u4F1A\u7ACB\u5373\u5931\u6548\u3002",
  "reverse.bind": "\u76D1\u542C\u5730\u5740",
  "reverse.path": "\u8DEF\u5F84",
  "reverse.publicHost": "\u5BF9\u5916\u5730\u5740",
  "reverse.publicHost.hint": "\u751F\u6210\u547D\u4EE4\u65F6\u76EE\u6807\u673A\u5668\u8981\u8FDE\u63A5\u7684\u4E3B\u673A\u540D\u6216 IP\uFF0C\u7559\u7A7A\u5219\u4F7F\u7528 {host}",
  "reverse.rotate": "\u91CD\u65B0\u751F\u6210\u5BC6\u94A5\u548C\u547D\u4EE4",
  "reverse.connected": "\u5DF2\u8FDE\u63A5 \xB7 {peer} \xB7 {active} \u4E2A\u4F1A\u8BDD",
  "reverse.waiting": "\u7B49\u5F85\u76EE\u6807\u673A\u5668\u8FDE\u63A5\u2026",
  "reverse.command.title": "\u5728\u76EE\u6807\u673A\u5668\u4E0A\u8FD0\u884C",
  "reverse.command.body": "\u5BC6\u94A5\u53EA\u663E\u793A\u8FD9\u4E00\u6B21\u3002\u547D\u4EE4\u4F1A\u628A\u5B83\u5199\u5165\u4EC5\u81EA\u5DF1\u53EF\u8BFB\u7684\u6587\u4EF6\uFF0C\u7136\u540E\u8FDE\u63A5\u5E76\u5728\u65AD\u7EBF\u540E\u81EA\u52A8\u91CD\u8FDE\u3002",
  "reverse.command.noListener": "\u6CA1\u6709\u5F00\u542F\u4EFB\u4F55\u76D1\u542C\uFF0C\u65E0\u6CD5\u751F\u6210\u547D\u4EE4\uFF1A\u5728\u201C\u672C\u673A\u76D1\u542C\u201D\u4E2D\u5F00\u542F TCP \u6216 WebSocket\uFF0C\u7136\u540E\u91CD\u65B0\u751F\u6210\u5BC6\u94A5\u3002",
  "reverse.command.posix": "Linux / macOS",
  "reverse.command.windows": "Windows (PowerShell)",
  "reverse.secret": "\u5BC6\u94A5",
  "browser.title": "\u9009\u62E9\u76EE\u5F55",
  "browser.title.workspace": "\u65B0\u5EFA\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
  "browser.env": "\u73AF\u5883",
  "browser.path": "\u8DEF\u5F84",
  "browser.empty": "\u7A7A\u76EE\u5F55",
  "browser.loading": "\u6B63\u5728\u8BFB\u53D6\u2026",
  "browser.workspaceName": "\u5DE5\u4F5C\u533A\u540D\u79F0",
  "browser.folderName": "\u6587\u4EF6\u5939\u540D\u79F0",
  "browser.create": "\u521B\u5EFA\u5DE5\u4F5C\u533A",
  "browser.createAndOpen": "\u521B\u5EFA\u5E76\u5F00\u59CB\u4F1A\u8BDD",
  "browser.items": "{count} \u9879",
  "ws.root": "{env} \xB7 {root}",
  "lease.since": "{time}",
  "lease.tunnels": "{count} \u6761\u96A7\u9053",
  "lease.session": "\u4F1A\u8BDD {id}",
  "lease.guiUsers": "GUI\uFF1A{ids}",
  "chip.label": "\u73AF\u5883",
  "chip.host": "\u672C\u673A",
  "chip.host.title": "\u5728\u672C\u673A\uFF08\u8FD0\u884C dsh \u7684\u7535\u8111\uFF09\u4E0A\u8FD0\u884C",
  "chip.mounted": "\u5728 {name} \u4E0A\u8FD0\u884C",
  "chip.borrowed": "\u5DF2\u501F\u7528 {count} \u4E2A",
  "pop.mount": "\u8FD0\u884C\u73AF\u5883",
  "pop.mount.hint": "\u8FD9\u4E2A\u4F1A\u8BDD\u7684\u6587\u4EF6\u4E0E\u547D\u4EE4\u5DE5\u5177\u5728\u54EA\u91CC\u6267\u884C\u3002\u9009\u62E9\u5176\u4ED6\u73AF\u5883\u65F6\u8FD8\u9700\u8981\u9009\u4E00\u4E2A\u76EE\u5F55\u3002",
  "pop.host": "\u672C\u673A",
  "pop.host.desc": "\u8FD0\u884C dsh \u7684\u7535\u8111\uFF0C\u76F4\u63A5\u4F7F\u7528\u5F53\u524D\u5DE5\u4F5C\u533A",
  "pop.mount.active": "{name}",
  "pop.mount.locked": "\u4F1A\u8BDD\u5DF2\u5F00\u59CB\uFF0C\u8FD0\u884C\u73AF\u5883\u4E0D\u53EF\u66F4\u6539\u3002",
  "pop.mount.fromWorkspace": "\u6765\u81EA\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
  "pop.mount.inherited": "\u4E0E\u7236\u4F1A\u8BDD\u5171\u4EAB",
  "pop.mount.pick": "\u9009\u62E9\u76EE\u5F55\u2026",
  "pop.mount.error": "\u6302\u8F7D\u5931\u8D25\uFF1A{message}",
  "pop.mount.pending": "\u5C06\u5728\u4F1A\u8BDD\u5F00\u59CB\u65F6\u6302\u8F7D",
  "pop.borrow": "\u53EF\u501F\u7528",
  "pop.borrow.hint": "\u667A\u80FD\u4F53\u53EF\u4EE5\u7528 env_borrow \u4E34\u65F6\u501F\u7528\u8FD9\u4E9B\u73AF\u5883\u3002",
  "pop.borrow.inherit.all": "\u9ED8\u8BA4\uFF1A\u5168\u90E8\u73AF\u5883",
  "pop.borrow.inherit.workspace": "\u7EE7\u627F\u81EA\u5DE5\u4F5C\u533A",
  "pop.borrow.custom": "\u672C\u4F1A\u8BDD\u81EA\u5B9A\u4E49",
  "pop.borrow.reset": "\u6062\u590D\u9ED8\u8BA4",
  "pop.borrow.saveWorkspace": "\u8BBE\u4E3A\u6B64\u5DE5\u4F5C\u533A\u9ED8\u8BA4",
  "pop.borrow.saved": "\u5DF2\u4FDD\u5B58\u4E3A\u5DE5\u4F5C\u533A\u9ED8\u8BA4",
  "pop.held": "\u5DF2\u501F\u7528",
  "pop.held.none": "\u5C1A\u672A\u501F\u7528\u4EFB\u4F55\u73AF\u5883",
  "pop.tools": "{count} \u4E2A\u5DE5\u5177",
  "err.generic": "\u64CD\u4F5C\u5931\u8D25\uFF1A{message}",
  "time.justNow": "\u521A\u521A",
  "time.minutes": "{n} \u5206\u949F\u524D",
  "time.hours": "{n} \u5C0F\u65F6\u524D",
  "info.os": "{os} \xB7 {arch}",
  "empty.title": "\u6DFB\u52A0\u7B2C\u4E00\u4E2A\u73AF\u5883",
  "empty.body": "\u8FDE\u63A5\u670D\u52A1\u5668\u3001\u624B\u673A\u6216\u6D4B\u8BD5\u8D26\u6237\uFF0C\u8BA9\u667A\u80FD\u4F53\u5728\u771F\u5B9E\u8BBE\u5907\u4E0A\u5DE5\u4F5C\u3002",
  "adb.error": "adb \u4E0D\u53EF\u7528\uFF1A{message}"
};
var en = {
  panel: "Environments",
  "page.title": "Environments",
  "page.subtitle": "Let agents use other devices: mount one as the workspace, or borrow it when needed.",
  "action.refresh": "Refresh",
  "action.add": "Add environment",
  "action.test": "Test connection",
  "action.testing": "Connecting\u2026",
  "action.edit": "Edit",
  "action.delete": "Delete",
  "action.cancel": "Cancel",
  "action.save": "Save",
  "action.saveAndTest": "Save and test",
  "action.close": "Close",
  "action.viewDesktop": "View desktop",
  "session.title": "Separate-session mode",
  "session.purpose": "Each Windows account logs on to a session of its own: its own mouse pointer and real input, never fighting you for the mouse or showing up on your screen.",
  "session.probing": "Checking this computer\u2026",
  "session.badge.probing": "Checking",
  "session.badge.ready": "Ready",
  "session.badge.setup": "Needs setup",
  "session.badge.reboot": "Reboot pending",
  "session.badge.error": "Check failed",
  "session.line.ready": "Accounts set to \u201CSeparate session\u201D log on to a Windows session of their own.",
  "session.line.install.home": "Windows Home cannot host Remote Desktop sessions; installing the TermWrap patch makes it possible.",
  "session.line.install.client": "This Windows edition allows one session at a time; installing the TermWrap patch lifts that limit.",
  "session.line.enable": "Server editions host several sessions natively; only the Remote Desktop host needs switching on.",
  "session.line.reboot": "TermWrap is installed, but the service did not pick it up; it takes effect after a reboot.",
  "session.line.manual": "This build does not bundle TermWrap; install it manually following docs/session-mode.md and reboot.",
  "session.line.unsupported": "Separate sessions are only available on Windows hosts.",
  "session.line.error": "Could not check: {message}",
  "session.check.termwrap": "TermWrap multi-session patch",
  "session.check.rdp": "Remote Desktop host enabled",
  "session.check.rfxvmt": "rfxvmt.dll component",
  "session.check.group": "Remote Desktop Users group",
  "session.check.service": "Terminal Services running",
  "session.check.listener": "Port 3389 listening",
  "session.action.install": "Install TermWrap",
  "session.action.enable": "Enable Remote Desktop",
  "session.action.recheck": "Check again",
  "session.action.details": "Details",
  "session.action.hide": "Hide",
  "session.working": "Working\u2026",
  "session.note.admin": "Needs administrator approval; usually no reboot.",
  "session.note.adminReboot": "Needs administrator approval; Terminal Services is restarted afterwards, so no reboot is needed.",
  "session.install.detail": "Bundled TermWrap {version} (MIT, {files} files, nothing is downloaded). The install adds %ProgramFiles%\\RDP Wrapper to the Defender exclusions, points the Terminal Services service DLL at it, enables Remote Desktop and then restarts that service so the patch is active at once (only a failed restart needs a reboot).",
  "session.enable.detail": "Switches the Remote Desktop host on (fDenyTSConnections=0) and starts Terminal Services.",
  "session.ready.detail": "This computer can host a separate Windows session per account.",
  "session.edition": "Edition: {edition}.",
  "session.done.enable": "Enabled. If the status does not change, choose \u201CCheck again\u201D.",
  "session.done.install": "Installed and already active; no reboot is needed.",
  "session.done.installReboot": "Installed, but Terminal Services did not pick the patch up; restart the computer.",
  "action.pause": "Pause",
  "action.resume": "Resume",
  "desktop.title": "{{name}}'s desktop",
  "desktop.mode.shared": "Shared desktop",
  "desktop.mode.private": "Private desktop",
  "desktop.mode.session": "Separate session",
  "desktop.mode.shared.desc": "Runs on your screen and shares your mouse and keyboard",
  "desktop.mode.private.desc": "Runs on a hidden desktop; watch it with \u201CView desktop\u201D",
  "desktop.mode.session.desc": "Logs on to its own Windows session with its own pointer and real input",
  "desktop.mode.session.notReady": "You can also save now; it connects once setup is done.",
  "desktop.card.notReady": "This computer cannot host separate sessions yet, so it cannot connect.",
  "desktop.card.setup": "Set up",
  "desktop.saved.notReady": "Saved. The account connects once separate sessions are set up on this computer.",
  "desktop.size": "{{w}}\xD7{{h}}",
  "desktop.fps": "{{fps}} fps",
  "desktop.connecting": "Fetching the screen\u2026",
  "desktop.hint": "Live view of this environment\u2019s desktop (about 4 frames per second, downscaled). Windows on a private desktop never appear on your own desktop.",
  "action.newWorkspace": "New remote workspace",
  "action.browse": "Browse files",
  "action.release": "Release",
  "action.return": "Return",
  "action.newSession": "New session",
  "action.remove": "Remove",
  "action.addDevice": "Add to list",
  "action.create": "Create",
  "action.manage": "Manage environments\u2026",
  "action.apply": "Apply",
  "action.unmount": "Unmount",
  "action.choose": "Choose this folder",
  "action.up": "Up",
  "action.home": "Home",
  "action.newFolder": "New folder",
  "action.open": "Open",
  "action.retry": "Retry",
  "action.done": "Done",
  "action.copy": "Copy",
  "action.copied": "Copied",
  "action.saveAndGenerate": "Save and get command",
  "kind.local": "Local process",
  "kind.server": "Environment server",
  "kind.ssh": "SSH",
  "kind.adb": "Android (ADB)",
  "kind.winuser": "Windows account",
  "kind.reverse": "Environment server (reverse)",
  "kind.local.desc": "A separate dsh-env-server process on the computer running dsh",
  "kind.server.desc": "A machine running dsh-env-server, reached directly or dialing in",
  "kind.ssh.desc": "A server reached over SSH",
  "kind.adb.desc": "A phone or emulator controlled through adb",
  "kind.winuser.desc": "A restricted test account on this computer that can run GUI programs",
  "kind.reverse.desc": "The target machine dials in (when it has no public address)",
  "section.environments": "Environments",
  "section.workspaces": "Remote workspaces",
  "section.workspaces.hint": "Sessions in a remote workspace read, write and run commands inside that environment.",
  "section.workspaces.empty": "No remote workspaces yet. Choose \u201CNew remote workspace\u201D on any environment card.",
  "section.leases": "In use",
  "section.leases.empty": "No session is using an environment right now.",
  "section.accounts": "Windows test accounts",
  "section.accounts.hint": "Restricted local standard accounts. Programs started as one appear on the current desktop so agents can test user interfaces. Creating and deleting needs administrator approval.",
  "section.accounts.empty": "No test accounts yet.",
  "status.available": "Available",
  "status.busy": "In use",
  "status.busyBy": "In use by {who}",
  "status.queue": "{count} waiting",
  "status.offline": "Offline",
  "status.unknown": "Not checked",
  "status.connected": "Reachable \xB7 {ms} ms",
  "status.failed": "Connection failed",
  "status.discovered": "Discovered",
  "status.builtin": "Built in",
  "status.shared": "Headless shared",
  "status.exclusive": "Exclusive",
  "status.guiBy": "GUI: {who}",
  "badge.mount": "Mounted",
  "badge.borrow": "Borrowed",
  "field.name": "Name",
  "field.name.ph": "e.g. Test phone Pixel 8",
  "field.id": "Identifier",
  "field.id.hint": "Prefix of the tools an agent gets after borrowing, e.g. {alias}__screenshot",
  "field.description": "Notes",
  "field.host": "Host",
  "field.port": "Port",
  "field.token": "Token",
  "field.token.hint": "The server\u2019s shared secret: printed at start, or set with --token-file / --token-stdin. It authenticates both sides and keys the encryption; it is never sent in clear",
  "field.url": "Address (URL)",
  "field.url.hint": "tcp://host:port, ws://host:port/path, or wss://\u2026 through a TLS reverse proxy",
  "field.username": "User name",
  "field.password": "Password",
  "field.password.hint": "Leave empty to use a key or ssh-agent",
  "field.privateKey": "Private key path",
  "field.privateKey.ph": "~/.ssh/id_ed25519",
  "field.passphrase": "Key passphrase",
  "field.serverPath": "Remote dsh-env-server path",
  "field.serverPath.hint": "Optional. When set it is started over SSH for full capabilities such as UDP tunnels and native search",
  "field.cwd": "Default directory",
  "field.serial": "Device serial",
  "field.serial.hint": "From adb devices, e.g. emulator-5554 or 192.168.1.20:5555",
  "field.account": "Account name",
  "field.account.hint": "1\u201320 letters, digits, _ or -",
  "field.account.hint.create": "1\u201320 letters, digits, _ or -. A restricted local standard account is created; Windows asks for administrator approval.",
  "field.desktop": "Desktop",
  "field.headlessParallel": "Parallel headless use",
  "field.headlessParallel.hint": "Several sessions may use it headless at the same time (files, commands, processes, tunnels); the GUI (screenshots, input, UI automation) is always held by one session at a time while others wait. When off, only one session may use the environment at all.",
  "field.mountMode": "Mount mode",
  "field.mountMode.hint": "How sessions mounted on this environment occupy it by default. When another session holds the GUI, the mount falls back to headless.",
  "field.mountMode.default": "Default ({mode})",
  "mode.headless": "Headless",
  "mode.gui": "GUI",
  "mode.headless.desc": "Files, commands, processes",
  "mode.gui.desc": "Also screenshots, input, UI automation",
  "field.borrowable": "Allow borrowing",
  "field.kind": "Type",
  "dialog.add": "Add environment",
  "dialog.edit": "Edit environment",
  "dialog.delete.title": "Delete environment",
  "dialog.delete.body": "Delete \u201C{name}\u201D? Sessions using it are disconnected immediately.",
  "dialog.account.delete": "Delete the account \u201C{name}\u201D and its user profile? Windows asks for administrator approval.",
  "server.help.title": "How to start the server on the target machine",
  "server.help.body": "Copy dsh-env-server to the target machine, put the token in token.txt (or omit it to have one generated and printed), then run one of:",
  "server.help.tcp": "TCP",
  "server.help.ws": "WebSocket (can sit behind a TLS reverse proxy)",
  "field.direction": "Connection",
  "direction.direct": "Direct",
  "direction.direct.desc": "dsh connects to the server listening on the target; the target must be reachable from here.",
  "direction.reverse": "Reverse",
  "direction.reverse.desc": "The target dials in to this computer \u2014 for machines without a public address or behind NAT or a firewall.",
  "direction.this": "This PC",
  "direction.target": "Target",
  "direction.locked": "The connection type cannot be changed after creation",
  "field.address": "Address",
  "address.hostPort": "Host and port",
  "address.url": "URL",
  "more.title": "More options",
  "reverse.listener.title": "Listeners on this computer",
  "reverse.listener.body": "Shared by all reverse connections. The target runs dsh-env-server connect and dials in here; for access over the internet open the port in your firewall/router or put it behind a TLS reverse proxy.",
  "reverse.listener.off": "Off",
  "reverse.listener.on": "Listening on port {port}",
  "reverse.listener.none": "No listener enabled",
  "reverse.listener.autoTcp": "No listener enabled \xB7 TCP (port {port}) is switched on when you save",
  "reverse.listener.failed": "{proto} listener failed: {error}",
  "reverse.listener.dirty": "Unapplied changes are applied when you save.",
  "reverse.next.title": "After saving",
  "reverse.next.body": "You get a secret and a command. Run the command on the target machine and it connects, reconnecting automatically after drops.",
  "reverse.command.again": "The secret is shown only when it is generated. To connect another machine or get the command again, generate a new one; the old secret stops working at once.",
  "reverse.bind": "Bind address",
  "reverse.path": "Path",
  "reverse.publicHost": "Public address",
  "reverse.publicHost.hint": "Host name or IP the target machine dials, used in the generated command; empty = {host}",
  "reverse.rotate": "New secret and command",
  "reverse.connected": "Connected \xB7 {peer} \xB7 {active} sessions",
  "reverse.waiting": "Waiting for the target machine to connect\u2026",
  "reverse.command.title": "Run on the target machine",
  "reverse.command.body": "The secret is shown only this once. The command stores it in a file only you can read, connects, and reconnects automatically.",
  "reverse.command.noListener": "No listener is enabled, so there is no command: enable TCP or WebSocket under Listeners, then generate a new secret.",
  "reverse.command.posix": "Linux / macOS",
  "reverse.command.windows": "Windows (PowerShell)",
  "reverse.secret": "Secret",
  "browser.title": "Choose a folder",
  "browser.title.workspace": "New remote workspace",
  "browser.env": "Environment",
  "browser.path": "Path",
  "browser.empty": "Empty folder",
  "browser.loading": "Reading\u2026",
  "browser.workspaceName": "Workspace name",
  "browser.folderName": "Folder name",
  "browser.create": "Create workspace",
  "browser.createAndOpen": "Create and start session",
  "browser.items": "{count} items",
  "ws.root": "{env} \xB7 {root}",
  "lease.since": "{time}",
  "lease.tunnels": "{count} tunnels",
  "lease.session": "Session {id}",
  "lease.guiUsers": "GUI: {ids}",
  "chip.label": "Environment",
  "chip.host": "This computer",
  "chip.host.title": "Runs on this computer (the one running dsh)",
  "chip.mounted": "Runs on {name}",
  "chip.borrowed": "{count} borrowed",
  "pop.mount": "Runs on",
  "pop.mount.hint": "Where this session\u2019s file and shell tools run. Another environment also needs a folder.",
  "pop.host": "This computer",
  "pop.host.desc": "The computer running dsh, using the current workspace directly",
  "pop.mount.active": "{name}",
  "pop.mount.locked": "The session has started; where it runs can no longer change.",
  "pop.mount.fromWorkspace": "From the remote workspace",
  "pop.mount.inherited": "Shared with the parent session",
  "pop.mount.pick": "Choose a folder\u2026",
  "pop.mount.error": "Mount failed: {message}",
  "pop.mount.pending": "Mounts when the session starts",
  "pop.borrow": "Borrowable",
  "pop.borrow.hint": "The agent may borrow these environments with env_borrow.",
  "pop.borrow.inherit.all": "Default: every environment",
  "pop.borrow.inherit.workspace": "Inherited from the workspace",
  "pop.borrow.custom": "Customized for this session",
  "pop.borrow.reset": "Reset to default",
  "pop.borrow.saveWorkspace": "Make default for this workspace",
  "pop.borrow.saved": "Saved as the workspace default",
  "pop.held": "Borrowed",
  "pop.held.none": "Nothing borrowed yet",
  "pop.tools": "{count} tools",
  "err.generic": "Something went wrong: {message}",
  "time.justNow": "just now",
  "time.minutes": "{n} min ago",
  "time.hours": "{n} h ago",
  "info.os": "{os} \xB7 {arch}",
  "empty.title": "Add your first environment",
  "empty.body": "Connect a server, a phone or a test account so agents can work on real devices.",
  "adb.error": "adb is unavailable: {message}"
};
var zhWorkspace = {
  "ws.state.available": "\u53EF\u7528",
  "ws.state.busy": "\u4F7F\u7528\u4E2D",
  "ws.state.offline": "\u4E0D\u53EF\u7528",
  "ws.state.error": "\u51FA\u9519",
  "ws.state.unknown": "\u672A\u68C0\u6D4B",
  "ws.tag.remote": "\u8FDC\u7A0B\u5DE5\u4F5C\u533A \xB7 {name} \xB7 {root}",
  "pop.mount.blocked": "\u6302\u8F7D\u6210\u529F\u4E4B\u524D\uFF0C\u8FD9\u4E2A\u4F1A\u8BDD\u4E0D\u80FD\u7EE7\u7EED\u5BF9\u8BDD\u3002",
  "action.remount": "\u91CD\u65B0\u6302\u8F7D",
  "pop.borrow.clearWorkspace": "\u6E05\u9664\u5DE5\u4F5C\u533A\u9ED8\u8BA4",
  "env.builtinLocal": "\u672C\u673A\uFF08\u72EC\u7ACB\u8FDB\u7A0B\uFF09"
};
var enWorkspace = {
  "ws.state.available": "Available",
  "ws.state.busy": "In use",
  "ws.state.offline": "Unavailable",
  "ws.state.error": "Error",
  "ws.state.unknown": "Not checked",
  "ws.tag.remote": "Remote workspace \xB7 {name} \xB7 {root}",
  "pop.mount.blocked": "This session cannot continue until its environment is mounted.",
  "action.remount": "Mount again",
  "pop.borrow.clearWorkspace": "Clear workspace default",
  "env.builtinLocal": "This computer (separate process)"
};
var dictionaries = {
  zh: { ...zh, ...zhWorkspace },
  en: { ...en, ...enWorkspace }
};

// packages/client/src/page.tsx
var React7 = __toESM(require("react"), 1);
var import_react7 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/client/src/desktop-view.tsx
var React4 = __toESM(require("react"), 1);
var import_react4 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var INTERVAL_MS2 = 250;
function DesktopView({ env, t, onClose }) {
  const [frame, setFrame] = (0, import_react4.useState)(void 0);
  const [error, setError] = (0, import_react4.useState)(void 0);
  const [paused, setPaused] = (0, import_react4.useState)(false);
  const [fps, setFps] = (0, import_react4.useState)(0);
  const times = (0, import_react4.useRef)([]);
  (0, import_react4.useEffect)(() => {
    if (paused) return;
    let disposed = false;
    let timer;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const next = await call("desktop.frame", { envId: env.id, maxWidth: 1100 }, controller.signal);
        if (disposed) return;
        setFrame(next);
        setError(void 0);
        const now = Date.now();
        times.current = [...times.current.filter((at) => now - at < 2e3), now];
        setFps(Math.round(times.current.length / 2 * 10) / 10);
      } catch (e) {
        if (disposed || controller.signal.aborted) return;
        setError(messageOf(e));
      }
      if (!disposed) timer = setTimeout(() => void tick(), INTERVAL_MS2);
    };
    void tick();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [env.id, paused]);
  const desktop = frame?.desktop ?? (env.config.desktop === "private" ? t("desktop.mode.private") : void 0);
  return /* @__PURE__ */ React4.createElement(
    import_dsh_client_ui_primitives2.Modal,
    {
      open: true,
      onClose,
      title: t("desktop.title", { name: env.name }),
      closeLabel: t("action.close"),
      className: "envx-dialog envx-desktop",
      footer: /* @__PURE__ */ React4.createElement("div", { className: "envx-footer" }, /* @__PURE__ */ React4.createElement("span", { className: "envx-chip", "data-tone": desktop ? "accent" : void 0 }, desktop ?? t("desktop.mode.shared")), frame && /* @__PURE__ */ React4.createElement("span", { className: "envx-chip" }, t("desktop.size", { w: frame.width, h: frame.height })), !paused && fps > 0 && /* @__PURE__ */ React4.createElement("span", { className: "envx-chip" }, t("desktop.fps", { fps: String(fps) })), /* @__PURE__ */ React4.createElement("span", { className: "envx-spacer" }), /* @__PURE__ */ React4.createElement(import_dsh_client_ui_primitives2.Button, { variant: "ghost", onClick: () => setPaused((p) => !p) }, paused ? t("action.resume") : t("action.pause")), /* @__PURE__ */ React4.createElement(import_dsh_client_ui_primitives2.Button, { variant: "primary", onClick: onClose }, t("action.close")))
    },
    /* @__PURE__ */ React4.createElement("div", { className: "envx-desktop-frame" }, frame ? /* @__PURE__ */ React4.createElement(
      "img",
      {
        alt: t("desktop.title", { name: env.name }),
        src: `data:${frame.mime};base64,${frame.data}`,
        style: { width: "100%", display: "block", borderRadius: 6 }
      }
    ) : /* @__PURE__ */ React4.createElement("div", { className: "envx-empty" }, error ?? t("desktop.connecting"))),
    frame && error && /* @__PURE__ */ React4.createElement("div", { className: "envx-result", "data-ok": "false" }, error),
    frame && !error && /* @__PURE__ */ React4.createElement("div", { className: "envx-help", style: { marginTop: 8 } }, t("desktop.hint"))
  );
}

// packages/client/src/env-dialog.tsx
var React6 = __toESM(require("react"), 1);
var import_react6 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/client/src/session-mode.tsx
var React5 = __toESM(require("react"), 1);
var import_react5 = require("react");

// packages/client/src/session-logic.ts
var CHECK_KEYS = [
  ["termwrap", "termwrap-missing"],
  ["rdp", "rdp-disabled"],
  ["rfxvmt", "rfxvmt-missing"],
  ["group", "rd-users-group-missing"],
  ["service", "term-service-stopped"],
  ["listener", "listener-down"]
];
function needsTermWrap(status) {
  return status.needsTermWrap ?? status.editionKind !== "server";
}
function sessionPhase(status, installedThisRun = false) {
  if (status.ready) return "ready";
  if (status.missing.includes("not-windows")) return "unsupported";
  if (!needsTermWrap(status)) return "enable";
  if (installedThisRun || status.termsrv?.wrapperInstalled || !status.missing.includes("termwrap-missing"))
    return "reboot";
  return status.termwrap.present ? "install" : "manual";
}
function sessionChecks(status) {
  const termwrap = needsTermWrap(status);
  return CHECK_KEYS.filter(([id]) => termwrap || id !== "termwrap").map(([id, key]) => {
    const i = status.missing.indexOf(key);
    return { id, ok: i < 0, reason: i < 0 ? void 0 : status.reasons[i] };
  });
}

// packages/client/src/session-mode.tsx
var snapshot = { status: void 0, error: void 0, loading: false, installed: false };
var listeners2 = /* @__PURE__ */ new Set();
var set = (patch) => {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners2) l();
};
var subscribe = (l) => {
  listeners2.add(l);
  return () => {
    listeners2.delete(l);
  };
};
async function probe() {
  if (snapshot.loading) return;
  set({ loading: true, error: void 0 });
  try {
    const status = await call("session.status");
    set({ status, loading: false, installed: status.ready ? false : snapshot.installed });
  } catch (e) {
    set({ error: messageOf(e), loading: false });
  }
}
function useSessionStatus(platform) {
  const snap = (0, import_react5.useSyncExternalStore)(subscribe, () => snapshot);
  const windows = platform === "win32";
  (0, import_react5.useEffect)(() => {
    if (windows && !snapshot.status && !snapshot.loading && !snapshot.error) void probe();
  }, [windows]);
  const phase = snap.status ? sessionPhase(snap.status, snap.installed) : void 0;
  return { ...snap, phase, ready: phase === "ready", reload: probe };
}
function lineOf(t, s) {
  if (s.error) return t("session.line.error", { message: s.error });
  if (!s.status) return t("session.probing");
  switch (s.phase) {
    case "ready":
      return t("session.line.ready");
    case "install":
      return s.status.editionKind === "home" ? t("session.line.install.home") : t("session.line.install.client");
    case "manual":
      return t("session.line.manual");
    case "reboot":
      return t("session.line.reboot");
    case "enable":
      return t("session.line.enable");
    default:
      return t("session.line.unsupported");
  }
}
function SessionBadge({ t, state }) {
  const tone = state.error ? "error" : !state.status ? "idle" : state.phase === "ready" ? "ok" : state.phase === "reboot" ? "info" : "warn";
  const text = state.error ? t("session.badge.error") : !state.status ? t("session.badge.probing") : state.phase === "ready" ? t("session.badge.ready") : state.phase === "reboot" ? t("session.badge.reboot") : t("session.badge.setup");
  return /* @__PURE__ */ React5.createElement("span", { className: "envx-sess-badge", "data-tone": tone }, tone === "idle" ? /* @__PURE__ */ React5.createElement(IconSpinner, { size: 11 }) : /* @__PURE__ */ React5.createElement("i", null), text);
}
function SessionSetup({ t, platform, variant = "panel", footnote }) {
  const state = useSessionStatus(platform);
  const [open, setOpen] = (0, import_react5.useState)(false);
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const [actionError, setActionError] = (0, import_react5.useState)(void 0);
  const [notice, setNotice] = (0, import_react5.useState)(void 0);
  if (platform !== "win32") return null;
  const { status, phase } = state;
  const run = async (action) => {
    setBusy(true);
    setActionError(void 0);
    setNotice(void 0);
    try {
      const result = await call(action);
      if (action === "session.install") {
        const reboot = result?.rebootRequired === true;
        set({ installed: reboot });
        setNotice(t(reboot ? "session.done.installReboot" : "session.done.install"));
      } else setNotice(t("session.done.enable"));
      await probe();
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const primary = phase === "install" ? /* @__PURE__ */ React5.createElement(
    "button",
    {
      type: "button",
      className: "envx-linkbtn",
      "data-primary": "",
      disabled: busy,
      onClick: () => void run("session.install")
    },
    busy ? /* @__PURE__ */ React5.createElement(IconSpinner, { size: 14 }) : null,
    busy ? t("session.working") : t("session.action.install")
  ) : phase === "enable" ? /* @__PURE__ */ React5.createElement(
    "button",
    {
      type: "button",
      className: "envx-linkbtn",
      "data-primary": "",
      disabled: busy,
      onClick: () => void run("session.enable")
    },
    busy ? /* @__PURE__ */ React5.createElement(IconSpinner, { size: 14 }) : null,
    busy ? t("session.working") : t("session.action.enable")
  ) : phase === "reboot" || state.error ? /* @__PURE__ */ React5.createElement("button", { type: "button", className: "envx-linkbtn", disabled: state.loading, onClick: () => void state.reload() }, state.loading ? /* @__PURE__ */ React5.createElement(IconSpinner, { size: 14 }) : /* @__PURE__ */ React5.createElement(IconRefresh, { size: 14 }), t("session.action.recheck")) : null;
  const note = phase === "install" ? t("session.note.adminReboot") : phase === "enable" ? t("session.note.admin") : void 0;
  const checks = status ? sessionChecks(status) : [];
  return /* @__PURE__ */ React5.createElement(
    "section",
    {
      className: "envx-sess",
      "data-variant": variant,
      "data-phase": phase ?? "probing",
      "data-open": open ? "" : void 0
    },
    /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-head" }, variant === "panel" && /* @__PURE__ */ React5.createElement("span", { className: "envx-tile", "data-kind": "winuser" }, /* @__PURE__ */ React5.createElement(IconDesktopSession, { size: 20 })), /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-main" }, variant === "panel" && /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-title" }, /* @__PURE__ */ React5.createElement("strong", null, t("session.title")), /* @__PURE__ */ React5.createElement(SessionBadge, { t, state })), /* @__PURE__ */ React5.createElement("span", { className: "envx-sess-line" }, lineOf(t, state))), /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-actions" }, status && /* @__PURE__ */ React5.createElement("button", { type: "button", className: "envx-sess-toggle", "aria-expanded": open, onClick: () => setOpen((v) => !v) }, open ? t("session.action.hide") : t("session.action.details"), /* @__PURE__ */ React5.createElement(IconChevron, { size: 14 })), primary)),
    (note || footnote) && !open && /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-note" }, [note, footnote].filter(Boolean).join(" ")),
    actionError && /* @__PURE__ */ React5.createElement("div", { className: "envx-error-line" }, actionError),
    notice && !actionError && /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-note" }, notice),
    open && status && /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-body" }, variant === "panel" && /* @__PURE__ */ React5.createElement("p", { className: "envx-sess-purpose" }, t("session.purpose")), /* @__PURE__ */ React5.createElement("ul", { className: "envx-sess-checks" }, checks.map((c) => /* @__PURE__ */ React5.createElement("li", { key: c.id, "data-ok": c.ok ? "" : void 0, title: c.reason }, /* @__PURE__ */ React5.createElement("i", null, c.ok ? /* @__PURE__ */ React5.createElement(IconCheck, { size: 11 }) : null), /* @__PURE__ */ React5.createElement("span", null, t(`session.check.${c.id}`))))), /* @__PURE__ */ React5.createElement("div", { className: "envx-sess-foot" }, /* @__PURE__ */ React5.createElement("span", null, phase === "install" || phase === "manual" || phase === "reboot" ? t("session.install.detail", {
      version: status.termwrap.version ?? "\u2014",
      files: String(status.termwrap.files.length)
    }) : phase === "enable" ? t("session.enable.detail") : t("session.ready.detail"), status.edition ? ` ${t("session.edition", { edition: status.edition })}` : ""), phase !== "reboot" && !state.error && /* @__PURE__ */ React5.createElement(
      "button",
      {
        type: "button",
        className: "envx-textbtn",
        "data-quiet": "",
        disabled: state.loading,
        onClick: () => void state.reload()
      },
      t("session.action.recheck")
    )))
  );
}

// packages/client/src/env-dialog.tsx
var PICKABLE = ["server", "ssh", "adb", "winuser"];
function aliasOf(name) {
  let a = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "env";
  if (!/^[a-z]/.test(a)) a = `env_${a}`;
  return a;
}
function Field({ label, hint, children }) {
  return /* @__PURE__ */ React6.createElement("div", { className: "envx-field" }, /* @__PURE__ */ React6.createElement("label", null, label), children, hint && /* @__PURE__ */ React6.createElement("small", null, hint));
}
function TextInput({ value, onChange, mono, ...rest }) {
  return /* @__PURE__ */ React6.createElement(
    "input",
    {
      className: "envx-input",
      "data-mono": mono ? "" : void 0,
      value: value ?? "",
      onChange: (e) => onChange(e.target.value),
      spellCheck: false,
      autoComplete: "off",
      ...rest
    }
  );
}
function Disclosure({
  title,
  summary,
  open,
  onToggle,
  children
}) {
  return /* @__PURE__ */ React6.createElement("div", { className: "envx-disc", "data-open": open ? "" : void 0 }, /* @__PURE__ */ React6.createElement("button", { type: "button", className: "envx-disc-head", "aria-expanded": open, onClick: onToggle }, /* @__PURE__ */ React6.createElement(IconChevron, { size: 14 }), /* @__PURE__ */ React6.createElement("span", { className: "envx-disc-title" }, title), summary && /* @__PURE__ */ React6.createElement("span", { className: "envx-disc-summary" }, summary)), open && /* @__PURE__ */ React6.createElement("div", { className: "envx-disc-body" }, children));
}
function CommandBlock({ label, text, t }) {
  const [copied, setCopied] = (0, import_react6.useState)(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return /* @__PURE__ */ React6.createElement("div", { className: "envx-cmd" }, label && /* @__PURE__ */ React6.createElement("span", { className: "envx-cmd-label" }, label), /* @__PURE__ */ React6.createElement("div", { className: "envx-cmd-body" }, /* @__PURE__ */ React6.createElement("code", null, text), /* @__PURE__ */ React6.createElement(
    "button",
    {
      type: "button",
      className: "envx-cmd-copy",
      "data-copied": copied ? "" : void 0,
      "aria-label": t("action.copy"),
      onClick: copy
    },
    copied ? /* @__PURE__ */ React6.createElement(IconCheck, { size: 14 }) : /* @__PURE__ */ React6.createElement(IconCopy, { size: 14 }),
    /* @__PURE__ */ React6.createElement("span", null, copied ? t("action.copied") : t("action.copy"))
  )));
}
var DEFAULTS = {
  server: { port: 7461 },
  ssh: { port: 22 },
  adb: {},
  winuser: {},
  reverse: {}
};
function EnvDialog({ open, environment, environments, platform, defaultMountMode, onClose, t }) {
  const editing = !!environment;
  const [kind, setKind] = (0, import_react6.useState)(environment?.kind);
  const [name, setName] = (0, import_react6.useState)("");
  const [id, setId] = (0, import_react6.useState)("");
  const [idTouched, setIdTouched] = (0, import_react6.useState)(false);
  const [description, setDescription] = (0, import_react6.useState)("");
  const [config, setConfig] = (0, import_react6.useState)({});
  const [addr, setAddr] = (0, import_react6.useState)("host");
  const [headlessParallel, setHeadlessParallel] = (0, import_react6.useState)(true);
  const [mountMode, setMountMode] = (0, import_react6.useState)("");
  const [moreOpen, setMoreOpen] = (0, import_react6.useState)(false);
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [result, setResult] = (0, import_react6.useState)(void 0);
  const [reveal, setReveal] = (0, import_react6.useState)(void 0);
  const [savedId, setSavedId] = (0, import_react6.useState)(void 0);
  const session = useSessionStatus(kind === "winuser" ? platform : void 0);
  const listeners3 = useReverseListeners(open && kind === "reverse");
  (0, import_react6.useEffect)(() => {
    if (!open) return;
    setKind(environment?.kind);
    setName(environment?.name ?? "");
    setId(environment?.id ?? "");
    setIdTouched(!!environment);
    setDescription(environment?.description ?? "");
    setConfig(environment?.config ?? {});
    setAddr(environment?.config.url ? "url" : "host");
    setHeadlessParallel(environment?.headlessParallel ?? true);
    setMountMode(environment?.mountMode ?? "");
    setMoreOpen(false);
    setResult(void 0);
    setReveal(void 0);
    setSavedId(void 0);
    setBusy(false);
  }, [open, environment]);
  const choose = (k) => {
    setKind(k);
    setConfig({ ...DEFAULTS[k] });
    setAddr("host");
    setHeadlessParallel(true);
    setMountMode("");
    setResult(void 0);
  };
  const setDirection = (k) => {
    if (k === kind) return;
    setConfig((c) => ({ ...DEFAULTS[k], ...c.cwd ? { cwd: c.cwd } : {} }));
    setKind(k);
    setResult(void 0);
  };
  const lease = { headlessParallel, mountMode: mountMode || null };
  const set2 = (key, value) => setConfig((c) => ({ ...c, [key]: value }));
  const effectiveId = idTouched ? id : aliasOf(name || kind || "env");
  const kinds = PICKABLE.filter((k) => k !== "winuser" || platform === "win32");
  const live = environments?.find((e) => e.id === (savedId ?? environment?.id)) ?? environment;
  const serverConfig = () => {
    const { url, host, port, ...rest } = config;
    return addr === "url" ? { ...rest, url } : { ...rest, host, port };
  };
  const valid = kind && name.trim() && (kind === "server" && (addr === "url" ? !!config.url : !!(config.host && config.port)) || kind === "reverse" || kind === "ssh" && config.host || kind === "adb" && config.serial || kind === "winuser" && config.account);
  const save = async () => {
    setBusy(true);
    setResult(void 0);
    try {
      let saved;
      if (kind === "reverse") {
        await listeners3.ensure();
        const r = await call("save", {
          environment: { id: effectiveId, name: name.trim(), kind, description, ...lease, config }
        });
        invalidate();
        setIdTouched(true);
        setId(r.environment.id);
        setSavedId(r.environment.id);
        if (r.reverse) setReveal(r.reverse);
        else onClose();
        return;
      }
      if (kind === "winuser" && !editing) {
        saved = (await call("winuser.create", {
          name: config.account,
          environmentName: name.trim(),
          desktop: config.desktop
        })).environment;
        if (!headlessParallel || mountMode) {
          saved = (await call("save", {
            environment: { ...saved, ...lease, config: { account: config.account, desktop: config.desktop } }
          })).environment;
        }
      } else {
        saved = (await call("save", {
          environment: {
            id: effectiveId,
            name: name.trim(),
            kind,
            description,
            ...lease,
            config: kind === "server" ? serverConfig() : config
          }
        })).environment;
      }
      invalidate();
      if (kind === "winuser" && config.desktop === "session" && !session.ready) {
        setResult({ ok: true, text: t("desktop.saved.notReady") });
        setTimeout(onClose, 1400);
        return;
      }
      const test = await call("test", { id: saved.id });
      invalidate();
      if (test.ok) {
        setResult({
          ok: true,
          text: t("status.connected", { ms: test.ms ?? 0 }) + (test.info ? ` \u2014 ${test.info.os}${test.info.arch ? ` \xB7 ${test.info.arch}` : ""}${test.info.user ? ` \xB7 ${test.info.user}` : ""}` : "")
        });
        setTimeout(onClose, 900);
      } else {
        setResult({ ok: false, text: test.error ?? "" });
        setIdTouched(true);
        setId(saved.id);
      }
    } catch (e) {
      setResult({ ok: false, text: messageOf(e) });
    } finally {
      setBusy(false);
    }
  };
  const primaryLabel = busy ? kind === "reverse" ? t("session.working") : t("action.testing") : kind === "reverse" ? editing ? t("action.save") : t("action.saveAndGenerate") : kind === "winuser" && config.desktop === "session" && !session.ready ? t("action.save") : t("action.saveAndTest");
  const footer = kind ? /* @__PURE__ */ React6.createElement("div", { className: "envx-footer" }, !editing && !reveal && /* @__PURE__ */ React6.createElement(
    import_dsh_client_ui_primitives3.Button,
    {
      variant: "ghost",
      onClick: () => {
        setKind(void 0);
        setResult(void 0);
      }
    },
    "\u2039 ",
    t("field.kind")
  ), /* @__PURE__ */ React6.createElement("span", { className: "envx-spacer" }), !reveal && /* @__PURE__ */ React6.createElement(import_dsh_client_ui_primitives3.Button, { variant: "ghost", onClick: onClose }, t("action.cancel")), reveal ? /* @__PURE__ */ React6.createElement(import_dsh_client_ui_primitives3.Button, { variant: "primary", onClick: onClose }, t("action.done")) : /* @__PURE__ */ React6.createElement(
    import_dsh_client_ui_primitives3.Button,
    {
      variant: "primary",
      disabled: !valid || busy,
      icon: busy ? /* @__PURE__ */ React6.createElement(IconSpinner, { size: 16 }) : void 0,
      onClick: () => void save()
    },
    primaryLabel
  )) : void 0;
  const moreSummary = [
    headlessParallel ? t("status.shared") : t("status.exclusive"),
    `${t("field.mountMode")} \xB7 ${mountMode ? t(`mode.${mountMode}`) : t("field.mountMode.default", { mode: t(`mode.${defaultMountMode ?? "headless"}`) })}`,
    description.trim()
  ].filter(Boolean).join(" \xB7 ");
  const serverFamily = kind === "server" || kind === "reverse";
  return /* @__PURE__ */ React6.createElement(
    import_dsh_client_ui_primitives3.Modal,
    {
      open,
      onClose,
      title: editing ? t("dialog.edit") : t("dialog.add"),
      closeLabel: t("action.close"),
      footer,
      className: "envx-dialog"
    },
    !kind && /* @__PURE__ */ React6.createElement("div", { className: "envx-kinds" }, kinds.map((k) => /* @__PURE__ */ React6.createElement("button", { type: "button", key: k, className: "envx-kind", "data-kind": k, onClick: () => choose(k) }, /* @__PURE__ */ React6.createElement("span", { className: "envx-tile", "data-kind": k }, /* @__PURE__ */ React6.createElement(KindIcon, { kind: k })), /* @__PURE__ */ React6.createElement("span", null, /* @__PURE__ */ React6.createElement("strong", null, t(`kind.${k}`)), /* @__PURE__ */ React6.createElement("span", null, t(`kind.${k}.desc`)))))),
    kind && reveal && /* @__PURE__ */ React6.createElement("div", { className: "envx-form", "data-kind": kind }, /* @__PURE__ */ React6.createElement(ReverseReveal, { reveal, env: live, t })),
    kind && !reveal && /* @__PURE__ */ React6.createElement("div", { className: "envx-form", "data-kind": kind }, serverFamily && /* @__PURE__ */ React6.createElement(
      DirectionPicker,
      {
        value: kind === "reverse" ? "reverse" : "server",
        onChange: setDirection,
        locked: editing,
        t
      }
    ), /* @__PURE__ */ React6.createElement("div", { className: "envx-field-row", "data-even": "" }, /* @__PURE__ */ React6.createElement(Field, { label: t("field.name") }, /* @__PURE__ */ React6.createElement(TextInput, { value: name, onChange: setName, placeholder: t("field.name.ph"), "data-modal-autofocus": "" })), /* @__PURE__ */ React6.createElement(Field, { label: t("field.id") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: effectiveId,
        mono: true,
        disabled: editing,
        onChange: (v) => {
          setId(v.replace(/[^A-Za-z0-9_.-]/g, ""));
          setIdTouched(true);
        }
      }
    ))), !editing && /* @__PURE__ */ React6.createElement("small", { className: "envx-form-note" }, t("field.id.hint", { alias: aliasOf(effectiveId) })), kind === "server" && /* @__PURE__ */ React6.createElement(ServerSection, { config, set: set2, addr, onAddr: setAddr, editing, t }), kind === "reverse" && /* @__PURE__ */ React6.createElement(
      ReverseSection,
      {
        environment: live,
        editing,
        listeners: listeners3,
        onReveal: (r) => {
          setSavedId(effectiveId);
          setReveal(r);
        },
        t
      },
      /* @__PURE__ */ React6.createElement(Field, { label: t("field.cwd") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.cwd, onChange: (v) => set2("cwd", v), placeholder: "/home/me/project", mono: true }))
    ), kind === "ssh" && /* @__PURE__ */ React6.createElement(React6.Fragment, null, /* @__PURE__ */ React6.createElement("div", { className: "envx-field-row" }, /* @__PURE__ */ React6.createElement(Field, { label: t("field.host") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.host, onChange: (v) => set2("host", v), placeholder: "build.example.com", mono: true })), /* @__PURE__ */ React6.createElement(Field, { label: t("field.port") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: config.port,
        onChange: (v) => set2("port", v.replace(/\D/g, "")),
        inputMode: "numeric",
        mono: true
      }
    ))), /* @__PURE__ */ React6.createElement("div", { className: "envx-field-row", "data-even": "" }, /* @__PURE__ */ React6.createElement(Field, { label: t("field.username") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.username, onChange: (v) => set2("username", v), mono: true })), /* @__PURE__ */ React6.createElement(Field, { label: t("field.password") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.password, onChange: (v) => set2("password", v), type: "password" }))), /* @__PURE__ */ React6.createElement("small", { className: "envx-form-note" }, t("field.password.hint")), /* @__PURE__ */ React6.createElement("div", { className: "envx-field-row", "data-even": "" }, /* @__PURE__ */ React6.createElement(Field, { label: t("field.privateKey") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: config.privateKeyPath,
        onChange: (v) => set2("privateKeyPath", v),
        placeholder: t("field.privateKey.ph"),
        mono: true
      }
    )), /* @__PURE__ */ React6.createElement(Field, { label: t("field.passphrase") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.passphrase, onChange: (v) => set2("passphrase", v), type: "password" }))), /* @__PURE__ */ React6.createElement(Field, { label: t("field.cwd") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.cwd, onChange: (v) => set2("cwd", v), placeholder: "/home/me/project", mono: true })), /* @__PURE__ */ React6.createElement(Field, { label: t("field.serverPath"), hint: t("field.serverPath.hint") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: config.serverPath,
        onChange: (v) => set2("serverPath", v),
        placeholder: "/usr/local/bin/dsh-env-server",
        mono: true
      }
    ))), kind === "adb" && /* @__PURE__ */ React6.createElement(Field, { label: t("field.serial"), hint: t("field.serial.hint") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.serial, onChange: (v) => set2("serial", v), placeholder: "emulator-5554", mono: true })), kind === "winuser" && /* @__PURE__ */ React6.createElement(React6.Fragment, null, /* @__PURE__ */ React6.createElement(
      Field,
      {
        label: t("field.account"),
        hint: editing ? t("field.account.hint") : t("field.account.hint.create")
      },
      /* @__PURE__ */ React6.createElement(
        TextInput,
        {
          value: config.account,
          disabled: editing,
          onChange: (v) => set2("account", v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20)),
          placeholder: "dsh-test",
          mono: true
        }
      )
    ), /* @__PURE__ */ React6.createElement(
      DesktopModePicker,
      {
        value: config.desktop ?? "shared",
        onChange: (desktop) => setConfig((c) => ({ ...c, desktop })),
        session,
        platform,
        t
      }
    )), /* @__PURE__ */ React6.createElement(
      Disclosure,
      {
        title: t("more.title"),
        summary: moreOpen ? void 0 : moreSummary,
        open: moreOpen,
        onToggle: () => setMoreOpen((v) => !v)
      },
      /* @__PURE__ */ React6.createElement(Field, { label: t("field.description") }, /* @__PURE__ */ React6.createElement(TextInput, { value: description, onChange: setDescription })),
      /* @__PURE__ */ React6.createElement("div", { className: "envx-switch-row" }, /* @__PURE__ */ React6.createElement("div", null, /* @__PURE__ */ React6.createElement("span", null, t("field.headlessParallel")), /* @__PURE__ */ React6.createElement("small", null, t("field.headlessParallel.hint"))), /* @__PURE__ */ React6.createElement(import_dsh_client_ui_primitives3.Switch, { checked: headlessParallel, onChange: setHeadlessParallel, label: t("field.headlessParallel") })),
      /* @__PURE__ */ React6.createElement(Field, { label: t("field.mountMode"), hint: t("field.mountMode.hint") }, /* @__PURE__ */ React6.createElement(
        "select",
        {
          className: "envx-input",
          value: mountMode,
          onChange: (e) => setMountMode(e.target.value === "gui" || e.target.value === "headless" ? e.target.value : "")
        },
        /* @__PURE__ */ React6.createElement("option", { value: "" }, t("field.mountMode.default", { mode: t(`mode.${defaultMountMode ?? "headless"}`) })),
        /* @__PURE__ */ React6.createElement("option", { value: "headless" }, t("mode.headless"), " \xB7 ", t("mode.headless.desc")),
        /* @__PURE__ */ React6.createElement("option", { value: "gui" }, t("mode.gui"), " \xB7 ", t("mode.gui.desc"))
      ))
    ), result && /* @__PURE__ */ React6.createElement("div", { className: "envx-result", "data-ok": String(result.ok) }, result.ok ? /* @__PURE__ */ React6.createElement(IconCheck, { size: 16 }) : null, /* @__PURE__ */ React6.createElement("span", null, result.text)), busy && !result && kind !== "reverse" && /* @__PURE__ */ React6.createElement("div", { className: "envx-result", "data-ok": "pending" }, /* @__PURE__ */ React6.createElement(IconSpinner, { size: 16 }), /* @__PURE__ */ React6.createElement("span", null, t("action.testing"))))
  );
}
function DirectionPicker({
  value,
  onChange,
  locked,
  t
}) {
  const options = [
    { kind: "server", key: "direct" },
    { kind: "reverse", key: "reverse" }
  ];
  const move = (e) => {
    if (locked) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = value === "server" ? "reverse" : "server";
    onChange(next);
    const group = e.currentTarget.parentElement;
    group?.querySelector(`[data-dir='${next}']`)?.focus();
  };
  return /* @__PURE__ */ React6.createElement("div", { className: "envx-field" }, /* @__PURE__ */ React6.createElement("label", { id: "envx-direction-label" }, t("field.direction")), /* @__PURE__ */ React6.createElement("div", { className: "envx-modes", "data-cols": "2", role: "radiogroup", "aria-labelledby": "envx-direction-label" }, options.map(({ kind, key }) => {
    const on = value === kind;
    return /* @__PURE__ */ React6.createElement(
      "button",
      {
        key: kind,
        type: "button",
        role: "radio",
        "aria-checked": on,
        tabIndex: on ? 0 : -1,
        className: "envx-mode envx-dir",
        "data-dir": kind,
        "data-on": on ? "" : void 0,
        disabled: locked && !on,
        title: locked && !on ? t("direction.locked") : void 0,
        onClick: () => onChange(kind),
        onKeyDown: move
      },
      /* @__PURE__ */ React6.createElement("span", { className: "envx-flow", "data-dir": kind, "aria-hidden": "true" }, /* @__PURE__ */ React6.createElement("span", { className: "envx-flow-node" }, /* @__PURE__ */ React6.createElement(IconLocal, { size: 14 }), t("direction.this")), /* @__PURE__ */ React6.createElement("span", { className: "envx-flow-arrow" }, /* @__PURE__ */ React6.createElement(IconArrowRight, { size: 16 })), /* @__PURE__ */ React6.createElement("span", { className: "envx-flow-node" }, /* @__PURE__ */ React6.createElement(IconServer, { size: 14 }), t("direction.target"))),
      /* @__PURE__ */ React6.createElement("strong", null, t(`direction.${key}`)),
      /* @__PURE__ */ React6.createElement("span", null, t(`direction.${key}.desc`))
    );
  })));
}
function ServerSection({ config, set: set2, addr, onAddr, editing, t }) {
  const [helpOpen, setHelpOpen] = (0, import_react6.useState)(!editing);
  const port = String(config.port || 7461);
  return /* @__PURE__ */ React6.createElement(React6.Fragment, null, /* @__PURE__ */ React6.createElement("div", { className: "envx-field" }, /* @__PURE__ */ React6.createElement("div", { className: "envx-field-head" }, /* @__PURE__ */ React6.createElement("label", null, t("field.address")), /* @__PURE__ */ React6.createElement(
    import_dsh_client_ui_primitives3.SegmentedControl,
    {
      id: "envx-addr",
      className: "envx-seg",
      value: addr,
      label: t("field.address"),
      options: [
        { value: "host", label: t("address.hostPort") },
        { value: "url", label: t("address.url") }
      ],
      onChange: onAddr
    }
  )), addr === "host" ? /* @__PURE__ */ React6.createElement("div", { className: "envx-field-row" }, /* @__PURE__ */ React6.createElement(
    TextInput,
    {
      value: config.host,
      onChange: (v) => set2("host", v.trim()),
      placeholder: "192.168.1.20",
      "aria-label": t("field.host"),
      mono: true
    }
  ), /* @__PURE__ */ React6.createElement(
    TextInput,
    {
      value: config.port,
      onChange: (v) => set2("port", v.replace(/\D/g, "")),
      inputMode: "numeric",
      placeholder: "7461",
      "aria-label": t("field.port"),
      mono: true
    }
  )) : /* @__PURE__ */ React6.createElement(React6.Fragment, null, /* @__PURE__ */ React6.createElement(
    TextInput,
    {
      value: config.url,
      onChange: (v) => set2("url", v.trim()),
      placeholder: "wss://env.example.com/dsh-env",
      "aria-label": t("field.url"),
      mono: true
    }
  ), /* @__PURE__ */ React6.createElement("small", null, t("field.url.hint")))), /* @__PURE__ */ React6.createElement(Field, { label: t("field.token"), hint: t("field.token.hint") }, /* @__PURE__ */ React6.createElement(TextInput, { value: config.token, onChange: (v) => set2("token", v), type: "password", mono: true })), /* @__PURE__ */ React6.createElement(Disclosure, { title: t("server.help.title"), open: helpOpen, onToggle: () => setHelpOpen((v) => !v) }, /* @__PURE__ */ React6.createElement("p", { className: "envx-disc-text" }, t("server.help.body")), /* @__PURE__ */ React6.createElement(
    CommandBlock,
    {
      label: t("server.help.tcp"),
      text: `dsh-env-server serve --listen 0.0.0.0:${port} --token-file token.txt`,
      t
    }
  ), /* @__PURE__ */ React6.createElement(
    CommandBlock,
    {
      label: t("server.help.ws"),
      text: `dsh-env-server serve --listen ws://127.0.0.1:${port}/dsh-env --token-file token.txt`,
      t
    }
  )));
}
var DESKTOP_MODES = [
  { mode: "shared", Icon: IconDesktopShared },
  { mode: "private", Icon: IconDesktopPrivate },
  { mode: "session", Icon: IconDesktopSession }
];
function DesktopModePicker({ value, onChange, session, platform, t }) {
  const move = (e, i) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = DESKTOP_MODES[(i + d + DESKTOP_MODES.length) % DESKTOP_MODES.length];
    if (!next) return;
    onChange(next.mode);
    const group = e.currentTarget.parentElement;
    group?.querySelector(`[data-mode='${next.mode}']`)?.focus();
  };
  return /* @__PURE__ */ React6.createElement("div", { className: "envx-field" }, /* @__PURE__ */ React6.createElement("label", { id: "envx-desktop-label" }, t("field.desktop")), /* @__PURE__ */ React6.createElement("div", { className: "envx-modes", role: "radiogroup", "aria-labelledby": "envx-desktop-label" }, DESKTOP_MODES.map(({ mode, Icon }, i) => {
    const on = value === mode;
    return /* @__PURE__ */ React6.createElement(
      "button",
      {
        key: mode,
        type: "button",
        role: "radio",
        "aria-checked": on,
        tabIndex: on ? 0 : -1,
        className: "envx-mode",
        "data-mode": mode,
        "data-on": on ? "" : void 0,
        onClick: () => onChange(mode),
        onKeyDown: (e) => move(e, i)
      },
      /* @__PURE__ */ React6.createElement("span", { className: "envx-mode-top" }, /* @__PURE__ */ React6.createElement(Icon, { size: 18 }), mode === "session" && session.status && session.phase !== "ready" && /* @__PURE__ */ React6.createElement(SessionBadge, { t, state: session })),
      /* @__PURE__ */ React6.createElement("strong", null, t(`desktop.mode.${mode}`)),
      /* @__PURE__ */ React6.createElement("span", null, t(`desktop.mode.${mode}.desc`))
    );
  })), value === "session" && !session.ready && /* @__PURE__ */ React6.createElement(SessionSetup, { t, platform, variant: "inline", footnote: t("desktop.mode.session.notReady") }));
}
function useReverseListeners(active) {
  const [status, setStatus] = (0, import_react6.useState)(void 0);
  const [settings, setSettings] = (0, import_react6.useState)({});
  const [applied, setApplied] = (0, import_react6.useState)("{}");
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [error, setError] = (0, import_react6.useState)(void 0);
  const accept = (r) => {
    setStatus(r.status);
    setSettings(r.settings);
    setApplied(JSON.stringify(r.settings));
  };
  (0, import_react6.useEffect)(() => {
    if (!active) return;
    let live = true;
    setError(void 0);
    void call("reverse.settings", {}).then(
      (r) => live && accept(r),
      (e) => live && setError(messageOf(e))
    );
    return () => {
      live = false;
    };
  }, [active]);
  const dirty = JSON.stringify(settings) !== applied;
  const push = async (next) => {
    setBusy(true);
    setError(void 0);
    try {
      accept(
        await call("reverse.settings", {
          settings: next
        })
      );
      invalidate();
    } catch (e) {
      setError(messageOf(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    settings,
    setSettings,
    dirty,
    busy,
    error,
    apply: () => push(settings).catch(() => void 0),
    ensure: async () => {
      if (!status) return;
      const any = !!settings.tcp?.enabled || !!settings.ws?.enabled;
      if (any && !dirty) return;
      await push(any ? settings : { ...settings, tcp: { ...settings.tcp, enabled: true } });
    }
  };
}
function connectionOf(env) {
  const c = env?.connection;
  return c && c.idle + c.active > 0 ? c : void 0;
}
function ReverseLive({ env, t }) {
  const conn = connectionOf(env);
  return /* @__PURE__ */ React6.createElement("div", { className: "envx-live", "data-state": conn ? "ok" : "wait", role: "status" }, conn ? /* @__PURE__ */ React6.createElement("i", null) : /* @__PURE__ */ React6.createElement(IconSpinner, { size: 14 }), /* @__PURE__ */ React6.createElement("span", null, conn ? t("reverse.connected", { peer: conn.peer ?? "", active: conn.active }) : t("reverse.waiting")));
}
function ReverseReveal({ reveal, env, t }) {
  const [os, setOs] = (0, import_react6.useState)("posix");
  const text = os === "windows" ? reveal.windows : reveal.posix;
  return /* @__PURE__ */ React6.createElement(React6.Fragment, null, /* @__PURE__ */ React6.createElement("div", { className: "envx-step" }, /* @__PURE__ */ React6.createElement("span", { className: "envx-step-icon" }, /* @__PURE__ */ React6.createElement(IconKey, { size: 16 })), /* @__PURE__ */ React6.createElement("div", null, /* @__PURE__ */ React6.createElement("strong", null, t("reverse.command.title")), /* @__PURE__ */ React6.createElement("span", null, reveal.posix ? t("reverse.command.body") : t("reverse.command.noListener")))), (reveal.posix || reveal.windows) && /* @__PURE__ */ React6.createElement("div", { className: "envx-field" }, /* @__PURE__ */ React6.createElement(
    import_dsh_client_ui_primitives3.SegmentedControl,
    {
      id: "envx-os",
      className: "envx-seg",
      value: os,
      label: t("reverse.command.title"),
      options: [
        { value: "posix", label: t("reverse.command.posix") },
        { value: "windows", label: t("reverse.command.windows") }
      ],
      onChange: setOs
    }
  ), text && /* @__PURE__ */ React6.createElement(CommandBlock, { text, t })), /* @__PURE__ */ React6.createElement(CommandBlock, { label: t("reverse.secret"), text: reveal.secret, t }), /* @__PURE__ */ React6.createElement(ReverseLive, { env, t }));
}
function ReverseSection({ environment, editing, listeners: listeners3, onReveal, t, children }) {
  const { status, settings, setSettings } = listeners3;
  const [open, setOpen] = (0, import_react6.useState)(false);
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [error, setError] = (0, import_react6.useState)(void 0);
  const rotate = async () => {
    if (!environment) return;
    setBusy(true);
    setError(void 0);
    try {
      await listeners3.ensure();
      onReveal((await call("reverse.rotate", { id: environment.id })).reverse);
      invalidate();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const tcp = settings.tcp ?? {};
  const ws = settings.ws ?? {};
  const numeric = (v) => {
    const n = v.replace(/\D/g, "");
    return n ? Number(n) : void 0;
  };
  const listenerText = (l) => !l?.enabled ? t("reverse.listener.off") : l.listening ? t("reverse.listener.on", { port: l.port }) : l.error ?? "";
  const failures = status ? [
    ["TCP", status.tcp],
    ["WebSocket", status.ws]
  ].filter(([, l]) => l.enabled && !l.listening && l.error) : [];
  const summary = !status ? /* @__PURE__ */ React6.createElement(IconSpinner, { size: 12 }) : failures.length ? /* @__PURE__ */ React6.createElement("span", { "data-tone": "error" }, failures.map(([p, l]) => t("reverse.listener.failed", { proto: p, error: l.error ?? "" })).join(" \xB7 ")) : !status.tcp.enabled && !status.ws.enabled ? /* @__PURE__ */ React6.createElement("span", { "data-tone": "warn" }, t("reverse.listener.autoTcp", { port: tcp.port ?? 7462 })) : /* @__PURE__ */ React6.createElement("span", null, [
    status.tcp.enabled ? `TCP :${status.tcp.port}` : "",
    status.ws.enabled ? `WebSocket :${status.ws.port}${status.ws.path ?? ""}` : ""
  ].filter(Boolean).join(" \xB7 "), " \u2192 ", status.publicHost);
  return /* @__PURE__ */ React6.createElement(React6.Fragment, null, editing && /* @__PURE__ */ React6.createElement(ReverseLive, { env: environment, t }), children, /* @__PURE__ */ React6.createElement(
    Disclosure,
    {
      title: t("reverse.listener.title"),
      summary: open ? void 0 : summary,
      open,
      onToggle: () => setOpen((v) => !v)
    },
    /* @__PURE__ */ React6.createElement("p", { className: "envx-disc-text" }, t("reverse.listener.body")),
    /* @__PURE__ */ React6.createElement("div", { className: "envx-switch-row" }, /* @__PURE__ */ React6.createElement("div", null, /* @__PURE__ */ React6.createElement("span", null, "TCP"), /* @__PURE__ */ React6.createElement("small", null, listenerText(status?.tcp))), /* @__PURE__ */ React6.createElement(
      import_dsh_client_ui_primitives3.Switch,
      {
        checked: !!tcp.enabled,
        onChange: (v) => setSettings((s) => ({ ...s, tcp: { ...s.tcp, enabled: v } })),
        label: "TCP"
      }
    )),
    tcp.enabled && /* @__PURE__ */ React6.createElement("div", { className: "envx-field-row", "data-even": "" }, /* @__PURE__ */ React6.createElement(Field, { label: t("reverse.bind") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: tcp.host,
        onChange: (v) => setSettings((s) => ({ ...s, tcp: { ...s.tcp, host: v } })),
        placeholder: "0.0.0.0",
        mono: true
      }
    )), /* @__PURE__ */ React6.createElement(Field, { label: t("field.port") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: tcp.port,
        onChange: (v) => setSettings((s) => ({ ...s, tcp: { ...s.tcp, port: numeric(v) } })),
        inputMode: "numeric",
        placeholder: "7462",
        mono: true
      }
    ))),
    /* @__PURE__ */ React6.createElement("div", { className: "envx-switch-row" }, /* @__PURE__ */ React6.createElement("div", null, /* @__PURE__ */ React6.createElement("span", null, "WebSocket"), /* @__PURE__ */ React6.createElement("small", null, listenerText(status?.ws))), /* @__PURE__ */ React6.createElement(
      import_dsh_client_ui_primitives3.Switch,
      {
        checked: !!ws.enabled,
        onChange: (v) => setSettings((s) => ({ ...s, ws: { ...s.ws, enabled: v } })),
        label: "WebSocket"
      }
    )),
    ws.enabled && /* @__PURE__ */ React6.createElement("div", { className: "envx-field-row", "data-three": "" }, /* @__PURE__ */ React6.createElement(Field, { label: t("reverse.bind") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: ws.host,
        onChange: (v) => setSettings((s) => ({ ...s, ws: { ...s.ws, host: v } })),
        placeholder: "0.0.0.0",
        mono: true
      }
    )), /* @__PURE__ */ React6.createElement(Field, { label: t("field.port") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: ws.port,
        onChange: (v) => setSettings((s) => ({ ...s, ws: { ...s.ws, port: numeric(v) } })),
        inputMode: "numeric",
        placeholder: "7463",
        mono: true
      }
    )), /* @__PURE__ */ React6.createElement(Field, { label: t("reverse.path") }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: ws.path,
        onChange: (v) => setSettings((s) => ({ ...s, ws: { ...s.ws, path: v } })),
        placeholder: "/dsh-env",
        mono: true
      }
    ))),
    /* @__PURE__ */ React6.createElement(Field, { label: t("reverse.publicHost"), hint: t("reverse.publicHost.hint", { host: status?.publicHost ?? "" }) }, /* @__PURE__ */ React6.createElement(
      TextInput,
      {
        value: settings.publicHost,
        onChange: (v) => setSettings((s) => ({ ...s, publicHost: v })),
        placeholder: status?.publicHost,
        mono: true
      }
    )),
    listeners3.dirty && /* @__PURE__ */ React6.createElement("div", { className: "envx-inline-actions" }, /* @__PURE__ */ React6.createElement("span", null, t("reverse.listener.dirty")), /* @__PURE__ */ React6.createElement(
      import_dsh_client_ui_primitives3.Button,
      {
        variant: "outline",
        size: "sm",
        disabled: listeners3.busy,
        icon: listeners3.busy ? /* @__PURE__ */ React6.createElement(IconSpinner, { size: 14 }) : void 0,
        onClick: () => void listeners3.apply()
      },
      t("action.apply")
    ))
  ), editing ? /* @__PURE__ */ React6.createElement("div", { className: "envx-step" }, /* @__PURE__ */ React6.createElement("span", { className: "envx-step-icon" }, /* @__PURE__ */ React6.createElement(IconKey, { size: 16 })), /* @__PURE__ */ React6.createElement("div", null, /* @__PURE__ */ React6.createElement("strong", null, t("reverse.command.title")), /* @__PURE__ */ React6.createElement("span", null, t("reverse.command.again"))), /* @__PURE__ */ React6.createElement(
    import_dsh_client_ui_primitives3.Button,
    {
      variant: "outline",
      size: "sm",
      disabled: busy || !environment,
      icon: busy ? /* @__PURE__ */ React6.createElement(IconSpinner, { size: 14 }) : void 0,
      onClick: () => void rotate()
    },
    t("reverse.rotate")
  )) : /* @__PURE__ */ React6.createElement("div", { className: "envx-step" }, /* @__PURE__ */ React6.createElement("span", { className: "envx-step-icon" }, /* @__PURE__ */ React6.createElement(IconKey, { size: 16 })), /* @__PURE__ */ React6.createElement("div", null, /* @__PURE__ */ React6.createElement("strong", null, t("reverse.next.title")), /* @__PURE__ */ React6.createElement("span", null, t("reverse.next.body")))), (error || listeners3.error) && /* @__PURE__ */ React6.createElement("div", { className: "envx-result", "data-ok": "false" }, /* @__PURE__ */ React6.createElement("span", null, error ?? listeners3.error)));
}
function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onClose, t }) {
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [error, setError] = (0, import_react6.useState)(void 0);
  (0, import_react6.useEffect)(() => {
    if (open) {
      setBusy(false);
      setError(void 0);
    }
  }, [open]);
  const go = async () => {
    setBusy(true);
    setError(void 0);
    try {
      await onConfirm();
      invalidate();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ React6.createElement(
    import_dsh_client_ui_primitives3.Modal,
    {
      open,
      onClose,
      title,
      closeLabel: t("action.close"),
      className: "envx-dialog",
      footer: /* @__PURE__ */ React6.createElement("div", { className: "envx-footer" }, /* @__PURE__ */ React6.createElement(import_dsh_client_ui_primitives3.Button, { variant: "ghost", onClick: onClose }, t("action.cancel")), /* @__PURE__ */ React6.createElement(
        import_dsh_client_ui_primitives3.Button,
        {
          variant: "primary",
          disabled: busy,
          onClick: () => void go(),
          style: danger ? { background: "var(--dsw-alias-state-error-primary)" } : void 0
        },
        confirmLabel
      ))
    },
    /* @__PURE__ */ React6.createElement("p", { style: { margin: 0, color: "var(--dsw-alias-label-secondary)", fontSize: 13.5, lineHeight: "21px" } }, body),
    error && /* @__PURE__ */ React6.createElement("div", { className: "envx-result", "data-ok": "false", style: { marginTop: 12 } }, /* @__PURE__ */ React6.createElement("span", null, error))
  );
}

// packages/client/src/page.tsx
function relativeTime(t, ms) {
  const d = Date.now() - ms;
  if (d < 6e4) return t("time.justNow");
  if (d < 36e5) return t("time.minutes", { n: Math.floor(d / 6e4) });
  return t("time.hours", { n: Math.floor(d / 36e5) });
}
function target(env) {
  const c = env.config;
  switch (env.kind) {
    case "server":
      return c.url || `${c.host}:${c.port}`;
    case "ssh":
      return `${c.username ? `${c.username}@` : ""}${c.host}${c.port && Number(c.port) !== 22 ? `:${c.port}` : ""}`;
    case "adb":
      return c.serial;
    case "winuser":
      return c.account;
    case "reverse":
      return env.connection?.peer;
    default:
      return env.description;
  }
}
function statusOf(env, t) {
  const st = env.status;
  const queue = st?.queue?.length ? ` \xB7 ${t("status.queue", { count: st.queue.length })}` : "";
  if (st?.busy) {
    const who = st.holders?.[0]?.title;
    return { state: "busy", text: (who ? t("status.busyBy", { who }) : t("status.busy")) + queue };
  }
  if (st?.gui) {
    const who = st.gui.title ?? st.gui.sessionId?.slice(0, 8) ?? "";
    return { state: "busy", text: t("status.guiBy", { who }) + queue };
  }
  if (env.kind === "reverse") {
    const c = env.connection;
    return c && c.idle + c.active > 0 ? { state: "ok", text: t("status.available"), ...c.peer ? { detail: c.peer } : {} } : { state: "idle", text: t("status.offline") };
  }
  if (env.lastError) return { state: "error", text: t("status.failed"), detail: env.lastError };
  if (env.info || env.kind === "local" || env.discovered) return { state: "ok", text: t("status.available") };
  return { state: "idle", text: t("status.unknown") };
}
function EnvCard({ env, t, onEdit, onDelete, onWorkspace, onDesktop, sessionReady }) {
  const test = useAction();
  const status = statusOf(env, t);
  const sub = [t(`kind.${env.kind}`), target(env)].filter(Boolean).join(" \xB7 ");
  const info = env.info;
  const canView = !!info?.caps?.includes("screenshot");
  return /* @__PURE__ */ React7.createElement("article", { className: "envx-card", "data-kind": env.kind }, /* @__PURE__ */ React7.createElement("div", { className: "envx-card-head" }, /* @__PURE__ */ React7.createElement("span", { className: "envx-tile", "data-kind": env.kind }, /* @__PURE__ */ React7.createElement(KindIcon, { kind: env.kind })), /* @__PURE__ */ React7.createElement("div", { className: "envx-card-title" }, /* @__PURE__ */ React7.createElement("strong", { title: envName(env, t) }, envName(env, t)), /* @__PURE__ */ React7.createElement("span", { className: "envx-sub", title: sub }, sub)), /* @__PURE__ */ React7.createElement("span", { className: "envx-status", "data-state": status.state, title: status.detail ?? status.text }, /* @__PURE__ */ React7.createElement("i", null), status.text)), /* @__PURE__ */ React7.createElement("div", { className: "envx-meta" }, /* @__PURE__ */ React7.createElement("span", { className: "envx-chip" }, /* @__PURE__ */ React7.createElement("code", null, env.alias)), info && /* @__PURE__ */ React7.createElement("span", { className: "envx-chip" }, t("info.os", { os: info.os, arch: info.arch || "\u2014" })), info?.user && /* @__PURE__ */ React7.createElement("span", { className: "envx-chip" }, info.user), /* @__PURE__ */ React7.createElement("span", { className: "envx-chip" }, env.headlessParallel ? t("status.shared") : t("status.exclusive")), env.effectiveMountMode === "gui" && /* @__PURE__ */ React7.createElement("span", { className: "envx-chip" }, t("field.mountMode"), " \xB7 ", t("mode.gui")), env.kind === "winuser" && /* @__PURE__ */ React7.createElement("span", { className: "envx-chip", "data-tone": env.config.desktop === "shared" ? void 0 : "accent" }, env.config.desktop === "private" ? t("desktop.mode.private") : env.config.desktop === "session" ? t("desktop.mode.session") : t("desktop.mode.shared")), env.discovered && /* @__PURE__ */ React7.createElement("span", { className: "envx-chip", "data-tone": "accent" }, t("status.discovered")), env.builtin && /* @__PURE__ */ React7.createElement("span", { className: "envx-chip" }, t("status.builtin"))), env.kind === "winuser" && env.config.desktop === "session" && sessionReady === false && /* @__PURE__ */ React7.createElement("div", { className: "envx-card-notice" }, /* @__PURE__ */ React7.createElement("span", null, t("desktop.card.notReady")), /* @__PURE__ */ React7.createElement("button", { type: "button", className: "envx-textbtn", onClick: () => onEdit(env) }, t("desktop.card.setup"))), (test.error || status.state === "error" && status.detail) && /* @__PURE__ */ React7.createElement("div", { className: "envx-error-line" }, test.error ?? status.detail), /* @__PURE__ */ React7.createElement("div", { className: "envx-card-foot" }, /* @__PURE__ */ React7.createElement("button", { type: "button", className: "envx-linkbtn", onClick: () => onWorkspace(env) }, /* @__PURE__ */ React7.createElement(IconFolder, { size: 14 }), t("action.newWorkspace")), /* @__PURE__ */ React7.createElement(
    "button",
    {
      type: "button",
      className: "envx-linkbtn",
      disabled: test.busy,
      onClick: () => void test.run(async () => {
        const r = await call("test", { id: env.id });
        if (!r.ok) throw new Error(r.error);
      })
    },
    test.busy ? /* @__PURE__ */ React7.createElement(IconSpinner, { size: 14 }) : /* @__PURE__ */ React7.createElement(IconPlug, { size: 14 }),
    test.busy ? t("action.testing") : t("action.test")
  ), /* @__PURE__ */ React7.createElement("span", { className: "envx-card-tools" }, canView && /* @__PURE__ */ React7.createElement(import_dsh_client_ui_primitives4.Tooltip, { label: t("action.viewDesktop"), side: "top" }, /* @__PURE__ */ React7.createElement(
    "button",
    {
      type: "button",
      className: "envx-iconbtn",
      "aria-label": t("action.viewDesktop"),
      onClick: () => onDesktop(env)
    },
    /* @__PURE__ */ React7.createElement(IconScreenshot, { size: 16 })
  )), env.discovered && /* @__PURE__ */ React7.createElement(import_dsh_client_ui_primitives4.Tooltip, { label: t("action.addDevice"), side: "top" }, /* @__PURE__ */ React7.createElement(
    "button",
    {
      type: "button",
      className: "envx-iconbtn",
      "aria-label": t("action.addDevice"),
      onClick: () => void call("save", {
        environment: {
          id: env.id,
          name: env.name,
          kind: "adb",
          config: env.config,
          description: env.description
        }
      }).then(invalidate)
    },
    /* @__PURE__ */ React7.createElement(IconPlus, { size: 16 })
  )), !env.builtin && !env.discovered && /* @__PURE__ */ React7.createElement(React7.Fragment, null, /* @__PURE__ */ React7.createElement(import_dsh_client_ui_primitives4.Tooltip, { label: t("action.edit"), side: "top" }, /* @__PURE__ */ React7.createElement(
    "button",
    {
      type: "button",
      className: "envx-iconbtn",
      "aria-label": t("action.edit"),
      onClick: () => onEdit(env)
    },
    /* @__PURE__ */ React7.createElement(IconEdit, { size: 16 })
  )), /* @__PURE__ */ React7.createElement(import_dsh_client_ui_primitives4.Tooltip, { label: t("action.delete"), side: "top" }, /* @__PURE__ */ React7.createElement(
    "button",
    {
      type: "button",
      className: "envx-iconbtn",
      "data-danger": "",
      "aria-label": t("action.delete"),
      onClick: () => onDelete(env)
    },
    /* @__PURE__ */ React7.createElement(IconTrash, { size: 16 })
  ))))));
}
function EnvironmentsPage({ t, startSession }) {
  const { data, error, loading, refresh } = useEnvState(void 0, { discover: true });
  const [dialog, setDialog] = (0, import_react7.useState)(void 0);
  const [desktopEnv, setDesktopEnv] = (0, import_react7.useState)(void 0);
  const refreshing = useAction();
  const envs = data?.environments ?? [];
  const byId = Object.fromEntries(envs.map((e) => [e.id, e]));
  const workspaces = data?.remoteWorkspaces ?? [];
  const leases = data?.leases ?? [];
  const usesSession = envs.some((e) => e.kind === "winuser" && e.config.desktop === "session");
  const session = useSessionStatus(usesSession ? data?.platform : void 0);
  const onCreated = (value, start) => {
    setDialog(void 0);
    if (start && value.workspaceId) startSession(value.workspaceId);
  };
  const deleting = dialog?.type === "delete" ? dialog.environment : void 0;
  return /* @__PURE__ */ React7.createElement("div", { className: "envx-page" }, /* @__PURE__ */ React7.createElement("div", { className: "envx-scroll" }, /* @__PURE__ */ React7.createElement("div", { className: "envx-content" }, /* @__PURE__ */ React7.createElement("header", { className: "envx-heading" }, /* @__PURE__ */ React7.createElement("div", null, /* @__PURE__ */ React7.createElement("h1", null, t("page.title")), /* @__PURE__ */ React7.createElement("p", null, t("page.subtitle"))), /* @__PURE__ */ React7.createElement("div", { className: "envx-actions" }, /* @__PURE__ */ React7.createElement(import_dsh_client_ui_primitives4.Tooltip, { label: t("action.refresh"), side: "bottom" }, /* @__PURE__ */ React7.createElement(
    "button",
    {
      type: "button",
      className: "envx-iconbtn",
      "aria-label": t("action.refresh"),
      onClick: () => void refreshing.run(async () => {
        await call("state", { discover: true });
        refresh();
      })
    },
    refreshing.busy || loading && !data ? /* @__PURE__ */ React7.createElement(IconSpinner, { size: 16 }) : /* @__PURE__ */ React7.createElement(IconRefresh, { size: 16 })
  )), /* @__PURE__ */ React7.createElement(import_dsh_client_ui_primitives4.Button, { variant: "primary", icon: /* @__PURE__ */ React7.createElement(IconPlus, { size: 16 }), onClick: () => setDialog({ type: "env" }) }, t("action.add")))), error && /* @__PURE__ */ React7.createElement("div", { className: "envx-banner" }, t("err.generic", { message: error })), data?.discovered.adbError && envs.some((e) => e.kind === "adb") && /* @__PURE__ */ React7.createElement("div", { className: "envx-banner", "data-tone": "info" }, t("adb.error", { message: data.discovered.adbError })), /* @__PURE__ */ React7.createElement("section", { className: "envx-section" }, /* @__PURE__ */ React7.createElement("div", { className: "envx-section-head" }, /* @__PURE__ */ React7.createElement("h2", null, t("section.environments"), /* @__PURE__ */ React7.createElement("span", { className: "envx-count" }, envs.length))), /* @__PURE__ */ React7.createElement("div", { className: "envx-grid" }, envs.map((env) => /* @__PURE__ */ React7.createElement(
    EnvCard,
    {
      key: env.id,
      env,
      t,
      sessionReady: session.status ? session.ready : void 0,
      onEdit: (e) => setDialog({ type: "env", environment: e }),
      onDelete: (e) => setDialog({ type: "delete", environment: e }),
      onWorkspace: (e) => setDialog({ type: "browser", envId: e.id }),
      onDesktop: setDesktopEnv
    }
  )), /* @__PURE__ */ React7.createElement(
    "button",
    {
      type: "button",
      className: "envx-card envx-kind",
      "data-dashed": "",
      style: {
        alignItems: "center",
        justifyContent: "center",
        minHeight: 132,
        flexDirection: "column",
        gap: 6,
        color: "var(--dsw-alias-label-tertiary)"
      },
      onClick: () => setDialog({ type: "env" })
    },
    /* @__PURE__ */ React7.createElement(IconPlus, { size: 20 }),
    /* @__PURE__ */ React7.createElement("span", { style: { fontSize: 13 } }, t("action.add"))
  ))), /* @__PURE__ */ React7.createElement("section", { className: "envx-section" }, /* @__PURE__ */ React7.createElement("div", { className: "envx-section-head" }, /* @__PURE__ */ React7.createElement("div", null, /* @__PURE__ */ React7.createElement("h2", null, t("section.workspaces"), /* @__PURE__ */ React7.createElement("span", { className: "envx-count" }, workspaces.length)), /* @__PURE__ */ React7.createElement("p", null, t("section.workspaces.hint"))), /* @__PURE__ */ React7.createElement("button", { type: "button", className: "envx-linkbtn", onClick: () => setDialog({ type: "browser" }) }, /* @__PURE__ */ React7.createElement(IconPlus, { size: 14 }), t("action.newWorkspace"))), workspaces.length === 0 ? /* @__PURE__ */ React7.createElement("div", { className: "envx-empty" }, t("section.workspaces.empty")) : /* @__PURE__ */ React7.createElement("div", { className: "envx-list" }, workspaces.map((ws) => {
    const env = byId[ws.envId];
    const workspaceId = ws.workspaceId;
    return /* @__PURE__ */ React7.createElement("div", { className: "envx-row", key: ws.id, "data-kind": env?.kind ?? "server" }, /* @__PURE__ */ React7.createElement("span", { className: "envx-tile", "data-kind": env?.kind ?? "server" }, /* @__PURE__ */ React7.createElement(IconFolder, { size: 18 })), /* @__PURE__ */ React7.createElement("div", { className: "envx-row-main" }, /* @__PURE__ */ React7.createElement("strong", null, ws.title), /* @__PURE__ */ React7.createElement("span", { title: ws.root }, t("ws.root", { env: env?.name ?? ws.envId, root: ws.root }))), workspaceId && /* @__PURE__ */ React7.createElement("button", { type: "button", className: "envx-linkbtn", onClick: () => startSession(workspaceId) }, t("action.newSession")), /* @__PURE__ */ React7.createElement(import_dsh_client_ui_primitives4.Tooltip, { label: t("action.remove"), side: "top" }, /* @__PURE__ */ React7.createElement(
      "button",
      {
        type: "button",
        className: "envx-iconbtn",
        "data-danger": "",
        "aria-label": t("action.remove"),
        onClick: () => void call("remoteWorkspace.delete", { id: ws.id }).then(invalidate)
      },
      /* @__PURE__ */ React7.createElement(IconTrash, { size: 16 })
    )));
  }))), /* @__PURE__ */ React7.createElement("section", { className: "envx-section" }, /* @__PURE__ */ React7.createElement("div", { className: "envx-section-head" }, /* @__PURE__ */ React7.createElement("h2", null, t("section.leases"), /* @__PURE__ */ React7.createElement("span", { className: "envx-count" }, leases.length))), leases.length === 0 ? /* @__PURE__ */ React7.createElement("div", { className: "envx-empty" }, t("section.leases.empty")) : /* @__PURE__ */ React7.createElement("div", { className: "envx-list" }, leases.map((l) => {
    const env = byId[l.envId];
    return /* @__PURE__ */ React7.createElement("div", { className: "envx-row", key: l.id, "data-kind": env?.kind ?? "server" }, /* @__PURE__ */ React7.createElement("span", { className: "envx-tile", "data-kind": env?.kind ?? "server" }, /* @__PURE__ */ React7.createElement(KindIcon, { kind: env?.kind, size: 18 })), /* @__PURE__ */ React7.createElement("div", { className: "envx-row-main" }, /* @__PURE__ */ React7.createElement("strong", null, env ? envName(env, t) : l.name), /* @__PURE__ */ React7.createElement("span", null, t("lease.session", {
      id: String(l.owner?.sessionId ?? "").replace(/^session-/, "").slice(0, 8)
    }), " \xB7 ", relativeTime(t, l.createdAt), l.owner?.reason ? ` \xB7 ${l.owner.reason}` : "", l.tunnels?.length ? ` \xB7 ${t("lease.tunnels", { count: l.tunnels.length })}` : "", l.mode === "gui" && l.guiUsers?.some((u) => u !== l.owner?.sessionId) ? ` \xB7 ${t("lease.guiUsers", {
      ids: l.guiUsers.map((u) => u.replace(/^session-/, "").slice(0, 8)).join(", ")
    })}` : "")), /* @__PURE__ */ React7.createElement("span", { className: "envx-chip", "data-tone": l.mode === "gui" ? "accent" : void 0 }, l.mode === "gui" ? t("mode.gui") : t("mode.headless")), /* @__PURE__ */ React7.createElement("span", { className: "envx-chip", "data-tone": l.purpose === "mount" ? "accent" : void 0 }, l.purpose === "mount" ? t("badge.mount") : t("badge.borrow")), /* @__PURE__ */ React7.createElement(
      "button",
      {
        type: "button",
        className: "envx-linkbtn",
        onClick: () => void call("lease.release", { leaseId: l.id }).then(invalidate)
      },
      t("action.release")
    ));
  }))))), /* @__PURE__ */ React7.createElement(
    EnvDialog,
    {
      open: dialog?.type === "env",
      environment: dialog?.type === "env" ? dialog.environment : void 0,
      environments: envs,
      platform: data?.platform,
      defaultMountMode: data?.defaults?.mountMode,
      onClose: () => setDialog(void 0),
      t
    }
  ), /* @__PURE__ */ React7.createElement(
    ConfirmDialog,
    {
      open: dialog?.type === "delete",
      title: t("dialog.delete.title"),
      body: deleting?.kind === "winuser" ? t("dialog.account.delete", { name: deleting.config.account ?? "" }) : t("dialog.delete.body", { name: deleting?.name ?? "" }),
      confirmLabel: t("action.delete"),
      danger: true,
      onConfirm: () => {
        if (!deleting) return Promise.resolve();
        return deleting.kind === "winuser" ? call("winuser.delete", { name: deleting.config.account }) : call("delete", { id: deleting.id });
      },
      onClose: () => setDialog(void 0),
      t
    }
  ), /* @__PURE__ */ React7.createElement(
    RemoteBrowser,
    {
      open: dialog?.type === "browser",
      mode: "workspace",
      environments: envs,
      initialEnvId: dialog?.type === "browser" ? dialog.envId : void 0,
      onClose: () => setDialog(void 0),
      onCreated,
      t
    }
  ), desktopEnv && /* @__PURE__ */ React7.createElement(DesktopView, { env: byId[desktopEnv.id] ?? desktopEnv, t, onClose: () => setDesktopEnv(void 0) }));
}

// packages/client/src/styles.css
var styles_default = ".envx-page,\n.envx-dialog {\n  --envx-warn: var(--dsw-alias-state-warn-primary, #d98a0b);\n}\n.envx-page {\n  display: flex;\n  width: 100%;\n  height: 100%;\n  min-width: 0;\n  min-height: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font-size: 14px;\n  line-height: 1.6;\n}\n.envx-scroll {\n  flex: 1;\n  min-height: 0;\n  overflow: auto;\n  scrollbar-gutter: stable;\n}\n.envx-content {\n  max-width: 1040px;\n  margin: 0 auto;\n  padding: 0 clamp(24px, 4vw, 48px) 64px;\n}\n.envx-heading {\n  display: flex;\n  align-items: flex-end;\n  justify-content: space-between;\n  gap: 16px;\n  padding-top: 28px;\n  margin-bottom: 28px;\n}\n.envx-heading h1 {\n  margin: 0;\n  font-size: 22px;\n  line-height: 30px;\n  font-weight: 600;\n  letter-spacing: -0.01em;\n}\n.envx-heading p {\n  margin: 4px 0 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n  line-height: 20px;\n}\n.envx-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-shrink: 0;\n}\n.envx-section {\n  margin-top: 32px;\n}\n.envx-section:first-of-type {\n  margin-top: 0;\n}\n.envx-section-head {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 12px;\n  margin-bottom: 12px;\n}\n.envx-section-head h2 {\n  margin: 0;\n  font-size: 14px;\n  line-height: 22px;\n  font-weight: 600;\n}\n.envx-section-head p {\n  margin: 2px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n  max-width: 640px;\n}\n.envx-count {\n  margin-left: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  font-weight: 400;\n  font-variant-numeric: tabular-nums;\n}\n.envx-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));\n  gap: 12px;\n}\n\n.envx-card {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-width: 0;\n  padding: 16px;\n  border-radius: 14px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1);\n  transition:\n    border-color 0.15s,\n    box-shadow 0.15s;\n}\n.envx-card:hover {\n  border-color: var(--dsw-alias-border-l3);\n  box-shadow: 0 4px 18px color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);\n}\n.envx-card[data-dashed] {\n  border-style: dashed;\n  background: transparent;\n}\n.envx-card-head {\n  display: flex;\n  align-items: flex-start;\n  gap: 12px;\n  min-width: 0;\n}\n.envx-tile {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 38px;\n  height: 38px;\n  border-radius: 10px;\n  color: var(--envx-accent);\n  background: color-mix(in srgb, var(--envx-accent) 13%, transparent);\n}\n[data-kind='local'] {\n  --envx-accent: #4b83f0;\n}\n[data-kind='server'],\n[data-kind='reverse'] {\n  --envx-accent: #8b6cf0;\n}\n[data-kind='ssh'] {\n  --envx-accent: #16a37b;\n}\n[data-kind='adb'] {\n  --envx-accent: #3dba54;\n}\n[data-kind='winuser'] {\n  --envx-accent: #1e9bd7;\n}\n.envx-card-title {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n}\n.envx-card-title strong {\n  font-size: 14px;\n  line-height: 20px;\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-sub {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-status {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 22px;\n  padding: 0 8px 0 6px;\n  border-radius: 11px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  white-space: nowrap;\n  max-width: 46%;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.envx-status i {\n  flex: none;\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--dsw-alias-label-dimmed, #aaa);\n}\n.envx-status[data-state='ok'] i {\n  background: var(--dsw-alias-state-success-primary);\n}\n.envx-status[data-state='busy'] {\n  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-label-primary));\n  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);\n}\n.envx-status[data-state='busy'] i {\n  background: var(--dsw-alias-state-warn-primary);\n}\n.envx-status[data-state='error'] {\n  color: var(--dsw-alias-state-error-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);\n}\n.envx-status[data-state='error'] i {\n  background: var(--dsw-alias-state-error-primary);\n}\n.envx-meta {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n  min-height: 22px;\n  align-items: center;\n}\n.envx-chip {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 22px;\n  padding: 0 8px;\n  border-radius: 6px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  white-space: nowrap;\n  max-width: 100%;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.envx-chip[data-tone='accent'] {\n  color: var(--dsw-alias-state-business-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);\n}\n.envx-chip[data-tone='warn'] {\n  color: var(--envx-warn);\n  background: color-mix(in srgb, var(--envx-warn) 12%, transparent);\n}\n\n/* ---- separate-session mode: readiness panel (page) and inline setup (account dialog) ---- */\n.envx-sess {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  margin-bottom: 12px;\n  padding: 12px 14px 12px 16px;\n  border-radius: 14px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1);\n}\n.envx-sess[data-variant='inline'] {\n  margin: 4px 0 0;\n  padding: 10px 12px;\n  border-radius: 10px;\n  border-color: transparent;\n  background: color-mix(in srgb, var(--envx-warn) 8%, transparent);\n}\n.envx-sess[data-variant='inline'][data-phase='reboot'],\n.envx-sess[data-variant='inline'][data-phase='probing'] {\n  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);\n}\n.envx-sess[data-variant='panel'][data-phase='install'],\n.envx-sess[data-variant='panel'][data-phase='enable'],\n.envx-sess[data-variant='panel'][data-phase='manual'] {\n  border-color: color-mix(in srgb, var(--envx-warn) 35%, var(--dsw-alias-border-l2));\n}\n.envx-sess-head {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-width: 0;\n}\n.envx-sess-head .envx-tile {\n  width: 34px;\n  height: 34px;\n  border-radius: 9px;\n}\n.envx-sess-main {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n}\n.envx-sess-title {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n.envx-sess-title strong {\n  font-size: 13.5px;\n  line-height: 20px;\n  font-weight: 600;\n  white-space: nowrap;\n}\n.envx-sess-line {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12.5px;\n  line-height: 19px;\n}\n.envx-sess-actions {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n.envx-sess-toggle {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  height: 28px;\n  padding: 0 6px 0 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  font-size: 12.5px;\n  cursor: pointer;\n}\n.envx-sess-toggle:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n.envx-sess-toggle svg {\n  transition: transform 0.15s;\n}\n.envx-sess-toggle[aria-expanded='true'] svg {\n  transform: rotate(90deg);\n}\n.envx-sess-note {\n  margin: -4px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n}\n.envx-sess[data-variant='panel'] .envx-sess-note,\n.envx-sess[data-variant='panel'] > .envx-card-notice {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 6px 6px 10px;\n  border-radius: 8px;\n  font-size: 12px;\n  line-height: 17px;\n  color: var(--envx-warn);\n  background: color-mix(in srgb, var(--envx-warn) 9%, transparent);\n}\n.envx-card-notice span {\n  flex: 1;\n  min-width: 0;\n}\n.envx-card-notice .envx-textbtn {\n  flex: none;\n}\n.envx-error-line {\n  padding-left: 46px;\n}\n.envx-sess-body {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding-top: 10px;\n  border-top: 0.5px solid var(--dsw-alias-border-l1);\n}\n.envx-sess[data-variant='panel'] .envx-sess-body {\n  margin-left: 46px;\n}\n.envx-sess-purpose {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12.5px;\n  line-height: 19px;\n}\n.envx-sess-checks {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));\n  gap: 6px 16px;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n.envx-sess-checks li {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  font-size: 12.5px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-primary);\n}\n.envx-sess-checks li span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-sess-checks i {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 15px;\n  height: 15px;\n  border-radius: 50%;\n  box-sizing: border-box;\n  border: 1.5px solid color-mix(in srgb, var(--envx-warn) 70%, transparent);\n}\n.envx-sess-checks li[data-ok] {\n  color: var(--dsw-alias-label-tertiary);\n}\n.envx-sess-checks li[data-ok] i {\n  border: none;\n  color: #fff;\n  background: var(--dsw-alias-state-success-primary);\n}\n.envx-sess-checks li[data-ok] svg {\n  stroke-width: 2.6;\n}\n.envx-sess-foot {\n  display: flex;\n  align-items: flex-end;\n  gap: 12px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n}\n.envx-sess-foot > span {\n  flex: 1;\n  min-width: 0;\n}\n.envx-sess-foot .envx-textbtn {\n  flex: none;\n}\n.envx-sess-badge {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  height: 18px;\n  padding: 0 7px 0 6px;\n  border-radius: 9px;\n  font-size: 11px;\n  line-height: 16px;\n  font-weight: 500;\n  white-space: nowrap;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n}\n.envx-sess-badge i {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: currentColor;\n}\n.envx-sess-badge[data-tone='ok'] {\n  color: var(--dsw-alias-state-success-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent);\n}\n.envx-sess-badge[data-tone='warn'] {\n  color: var(--envx-warn);\n  background: color-mix(in srgb, var(--envx-warn) 13%, transparent);\n}\n.envx-sess-badge[data-tone='info'] {\n  color: var(--dsw-alias-state-business-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 11%, transparent);\n}\n.envx-sess-badge[data-tone='error'] {\n  color: var(--dsw-alias-state-error-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);\n}\n\n/* desktop mode picker in the Windows-account dialog */\n.envx-modes {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 8px;\n}\n.envx-mode {\n  appearance: none;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 2px;\n  min-width: 0;\n  padding: 10px 12px 11px;\n  border-radius: 10px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  background: var(--dsw-alias-bg-base);\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition:\n    border-color 0.12s,\n    background 0.12s,\n    box-shadow 0.12s;\n}\n.envx-mode:hover {\n  border-color: var(--dsw-alias-border-l4, var(--dsw-alias-border-l3));\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n.envx-mode:focus-visible {\n  outline: none;\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);\n}\n.envx-mode[data-on] {\n  border-color: var(--dsw-alias-state-business-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-base));\n  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-state-business-primary);\n}\n.envx-mode-top {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  width: 100%;\n  height: 22px;\n  margin-bottom: 4px;\n  color: var(--dsw-alias-label-tertiary);\n}\n.envx-mode[data-on] .envx-mode-top {\n  color: var(--dsw-alias-state-business-primary);\n}\n.envx-mode strong {\n  font-size: 13px;\n  line-height: 19px;\n  font-weight: 600;\n}\n.envx-mode > span:last-child {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11.5px;\n  line-height: 16px;\n}\n.envx-modes[data-cols='2'] {\n  grid-template-columns: repeat(2, 1fr);\n}\n.envx-mode:disabled {\n  cursor: not-allowed;\n  opacity: 0.45;\n}\n.envx-mode:disabled:hover {\n  border-color: var(--dsw-alias-border-l3);\n  background: var(--dsw-alias-bg-base);\n}\n.envx-dir {\n  padding: 12px 14px 13px;\n  gap: 3px;\n}\n\n/* connection direction diagram: This PC \u2192 Target, mirrored for reverse */\n.envx-flow {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  width: 100%;\n  margin-bottom: 8px;\n  color: var(--dsw-alias-label-tertiary);\n}\n.envx-flow-node {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 22px;\n  padding: 0 7px;\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-layer-2);\n  font-size: 11px;\n  line-height: 16px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n.envx-flow-arrow {\n  flex: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 18px;\n  position: relative;\n}\n.envx-flow-arrow::before {\n  content: '';\n  position: absolute;\n  left: 0;\n  right: 8px;\n  top: 50%;\n  border-top: 1.5px dashed currentColor;\n  opacity: 0.55;\n}\n.envx-flow-arrow svg {\n  margin-left: auto;\n  position: relative;\n}\n.envx-flow[data-dir='reverse'] .envx-flow-arrow {\n  transform: scaleX(-1);\n}\n.envx-mode[data-on] .envx-flow {\n  color: var(--dsw-alias-state-business-primary);\n}\n.envx-mode[data-on] .envx-flow-node {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);\n}\n.envx-mode[data-on] .envx-flow-arrow::before {\n  animation: envx-flow 0.9s linear infinite;\n  opacity: 0.8;\n  border-top-style: solid;\n  background: none;\n}\n@keyframes envx-flow {\n  from {\n    opacity: 0.45;\n  }\n  50% {\n    opacity: 0.95;\n  }\n  to {\n    opacity: 0.45;\n  }\n}\n@media (prefers-reduced-motion: reduce) {\n  .envx-mode[data-on] .envx-flow-arrow::before {\n    animation: none;\n  }\n}\n.envx-chip code {\n  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);\n  font-size: 11.5px;\n}\n.envx-card-notice {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 6px 6px 10px;\n  border-radius: 8px;\n  font-size: 12px;\n  line-height: 17px;\n  color: var(--envx-warn);\n  background: color-mix(in srgb, var(--envx-warn) 9%, transparent);\n}\n.envx-card-notice span {\n  flex: 1;\n  min-width: 0;\n}\n.envx-card-notice .envx-textbtn {\n  flex: none;\n}\n.envx-error-line {\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 12px;\n  line-height: 18px;\n  overflow-wrap: anywhere;\n}\n.envx-card-foot {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n  margin-top: auto;\n  padding-top: 4px;\n}\n/* The trailing icon actions wrap as one unit and stick to the right edge, so a narrow card\n   never strands a single icon (the delete button) on a line of its own. */\n.envx-card-tools {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  flex: none;\n  margin-left: auto;\n}\n.envx-iconbtn {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 28px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  cursor: pointer;\n  transition:\n    background 0.12s,\n    color 0.12s;\n}\n.envx-iconbtn:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n.envx-iconbtn[data-danger]:hover {\n  background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover));\n  color: var(--dsw-alias-state-error-primary);\n}\n.envx-iconbtn:disabled {\n  opacity: 0.4;\n  cursor: default;\n}\n.envx-linkbtn {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 28px;\n  padding: 0 10px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 12.5px;\n  cursor: pointer;\n  white-space: nowrap;\n  transition:\n    background 0.12s,\n    border-color 0.12s;\n}\n.envx-linkbtn:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n  border-color: var(--dsw-alias-border-l3);\n}\n.envx-linkbtn:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n.envx-linkbtn[data-primary] {\n  border-color: transparent;\n  color: var(--dsw-alias-label-primary-foreground, #fff);\n  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));\n}\n.envx-linkbtn[data-primary]:hover {\n  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary));\n}\n\n.envx-list {\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: 14px;\n  background: var(--dsw-alias-bg-layer-1);\n  overflow: hidden;\n}\n.envx-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  min-height: 56px;\n  padding: 10px 14px 10px 16px;\n}\n.envx-row + .envx-row {\n  border-top: 0.5px solid var(--dsw-alias-border-l1);\n}\n.envx-row-main {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n}\n.envx-row-main strong {\n  font-size: 13.5px;\n  line-height: 20px;\n  font-weight: 500;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-row-main span {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-row .envx-tile {\n  width: 32px;\n  height: 32px;\n  border-radius: 9px;\n}\n.envx-empty {\n  padding: 22px 16px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 13px;\n  text-align: center;\n  border: 0.5px dashed var(--dsw-alias-border-l2);\n  border-radius: 14px;\n}\n.envx-banner {\n  display: flex;\n  gap: 8px;\n  align-items: flex-start;\n  margin-bottom: 16px;\n  padding: 10px 12px;\n  border-radius: 10px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-state-error-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);\n  overflow-wrap: anywhere;\n}\n.envx-banner[data-tone='info'] {\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n}\n.envx-spin {\n  animation: envx-spin 0.9s linear infinite;\n}\n@keyframes envx-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n/* dialogs */\n.envx-dialog {\n  width: min(560px, calc(100vw - 48px));\n}\n.envx-dialog-wide {\n  width: min(720px, calc(100vw - 48px));\n}\n/* live desktop viewer: a wide dialog holding the newest frame */\n.envx-desktop {\n  width: min(1180px, calc(100vw - 48px));\n}\n.envx-desktop-frame {\n  min-height: 240px;\n  max-height: min(72vh, 900px);\n  overflow: auto;\n  background: #000;\n  border-radius: 6px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.envx-form {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n}\n.envx-field {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  min-width: 0;\n}\n.envx-field > label {\n  font-size: 12.5px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  font-weight: 500;\n}\n.envx-field small {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n}\n.envx-field-row {\n  display: grid;\n  grid-template-columns: 1fr 120px;\n  gap: 12px;\n}\n.envx-field-row[data-even] {\n  grid-template-columns: 1fr 1fr;\n}\n.envx-input {\n  box-sizing: border-box;\n  width: 100%;\n  height: 34px;\n  padding: 0 10px;\n  border-radius: 8px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13.5px;\n  outline: none;\n  transition:\n    border-color 0.12s,\n    box-shadow 0.12s;\n}\n.envx-input:focus {\n  border-color: var(--dsw-alias-state-business-primary);\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);\n}\n.envx-input::placeholder {\n  color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary));\n}\n.envx-input[data-mono] {\n  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);\n  font-size: 12.5px;\n}\nselect.envx-input {\n  appearance: none;\n  padding-right: 28px;\n  background-image:\n    linear-gradient(45deg, transparent 50%, currentColor 50%),\n    linear-gradient(135deg, currentColor 50%, transparent 50%);\n  background-position:\n    calc(100% - 15px) 14px,\n    calc(100% - 10px) 14px;\n  background-size: 5px 5px;\n  background-repeat: no-repeat;\n}\n.envx-switch-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 10px 12px;\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-2);\n}\n.envx-switch-row div {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n}\n.envx-switch-row span {\n  font-size: 13px;\n  line-height: 20px;\n}\n.envx-switch-row small {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n}\n.envx-kinds {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 10px;\n}\n.envx-kind {\n  appearance: none;\n  display: flex;\n  gap: 12px;\n  align-items: flex-start;\n  text-align: left;\n  padding: 14px;\n  border-radius: 12px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1);\n  color: inherit;\n  font: inherit;\n  cursor: pointer;\n  transition:\n    border-color 0.12s,\n    background 0.12s,\n    transform 0.12s;\n}\n.envx-kind:hover {\n  border-color: var(--envx-accent);\n  background: color-mix(in srgb, var(--envx-accent) 5%, var(--dsw-alias-bg-layer-1));\n}\n.envx-kind:active {\n  transform: scale(0.99);\n}\n.envx-kind strong {\n  display: block;\n  font-size: 13.5px;\n  line-height: 20px;\n  font-weight: 600;\n}\n.envx-kind span span {\n  display: block;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n}\n.envx-help {\n  padding: 12px;\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-layer-2);\n  font-size: 12.5px;\n  line-height: 19px;\n  color: var(--dsw-alias-label-secondary);\n}\n.envx-help strong {\n  display: block;\n  color: var(--dsw-alias-label-primary);\n  font-weight: 600;\n  margin-bottom: 2px;\n}\n.envx-help code {\n  display: block;\n  margin-top: 8px;\n  padding: 8px 10px;\n  border-radius: 8px;\n  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-base));\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);\n  font-size: 12px;\n  overflow-x: auto;\n  white-space: nowrap;\n  user-select: all;\n}\n.envx-result {\n  display: flex;\n  gap: 8px;\n  align-items: flex-start;\n  padding: 10px 12px;\n  border-radius: 10px;\n  font-size: 12.5px;\n  line-height: 19px;\n  overflow-wrap: anywhere;\n}\n.envx-result[data-ok='true'] {\n  color: var(--dsw-alias-state-success-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);\n}\n.envx-result[data-ok='false'] {\n  color: var(--dsw-alias-state-error-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);\n}\n.envx-footer {\n  width: 100%;\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n  align-items: center;\n}\n.envx-footer .envx-spacer {\n  flex: 1;\n}\n.envx-result[data-ok='pending'] {\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n}\n.envx-form-note {\n  margin-top: -8px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n}\n.envx-field-row[data-three] {\n  grid-template-columns: 1fr 96px 1fr;\n}\n.envx-field-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  min-height: 28px;\n}\n.envx-field-head > label {\n  font-size: 12.5px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  font-weight: 500;\n}\n.envx-seg {\n  align-self: flex-start;\n}\n.envx-field-head .envx-seg {\n  align-self: center;\n}\n\n/* collapsible group */\n.envx-disc {\n  border-radius: 10px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1);\n}\n.envx-disc-head {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 40px;\n  padding: 8px 12px;\n  border: none;\n  border-radius: 10px;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13px;\n  text-align: left;\n  cursor: pointer;\n}\n.envx-disc-head:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n.envx-disc-head:focus-visible {\n  outline: none;\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);\n}\n.envx-disc-head > svg {\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n  transition: transform 0.15s;\n}\n.envx-disc-head[aria-expanded='true'] > svg {\n  transform: rotate(90deg);\n}\n.envx-disc[data-open] .envx-disc-head {\n  border-bottom-left-radius: 0;\n  border-bottom-right-radius: 0;\n}\n.envx-disc-title {\n  flex: none;\n  font-weight: 500;\n}\n.envx-disc-summary {\n  flex: 1;\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  text-align: right;\n}\n.envx-disc-summary svg {\n  vertical-align: middle;\n}\n.envx-disc-summary [data-tone='warn'] {\n  color: var(--envx-warn);\n}\n.envx-disc-summary [data-tone='error'] {\n  color: var(--dsw-alias-state-error-primary);\n}\n.envx-disc-body {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  padding: 4px 12px 14px;\n}\n.envx-disc-text {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12.5px;\n  line-height: 19px;\n}\n.envx-disc-body .envx-switch-row {\n  background: var(--dsw-alias-bg-layer-2);\n}\n.envx-inline-actions {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n}\n\n/* copyable command */\n.envx-cmd {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  min-width: 0;\n}\n.envx-cmd-label {\n  font-size: 12px;\n  line-height: 17px;\n  color: var(--dsw-alias-label-secondary);\n  font-weight: 500;\n}\n.envx-cmd-body {\n  position: relative;\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  padding: 9px 10px 9px 12px;\n  border-radius: 8px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-base));\n}\n.envx-cmd-body code {\n  flex: 1;\n  min-width: 0;\n  padding-top: 3px;\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);\n  font-size: 12px;\n  line-height: 18px;\n  white-space: pre-wrap;\n  word-break: break-all;\n  user-select: all;\n}\n.envx-cmd-copy {\n  appearance: none;\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  height: 24px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n  transition:\n    color 0.12s,\n    background 0.12s,\n    border-color 0.12s;\n}\n.envx-cmd-copy:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n.envx-cmd-copy[data-copied] {\n  color: var(--dsw-alias-state-success-primary);\n  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);\n}\n\n/* a guided step: icon, title, text, optional action */\n.envx-step {\n  display: flex;\n  align-items: flex-start;\n  gap: 12px;\n  padding: 12px;\n  border-radius: 10px;\n  background: color-mix(in srgb, var(--envx-accent, var(--dsw-alias-state-business-primary)) 7%, transparent);\n}\n.envx-step > div {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n.envx-step strong {\n  font-size: 13px;\n  line-height: 19px;\n  font-weight: 600;\n}\n.envx-step > div > span {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12.5px;\n  line-height: 19px;\n}\n.envx-step > button {\n  flex: none;\n  align-self: center;\n}\n.envx-step-icon {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 30px;\n  height: 30px;\n  border-radius: 8px;\n  color: var(--envx-accent, var(--dsw-alias-state-business-primary));\n  background: color-mix(in srgb, var(--envx-accent, var(--dsw-alias-state-business-primary)) 14%, transparent);\n}\n\n/* live connection state of a reverse environment */\n.envx-live {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 12px;\n  border-radius: 10px;\n  font-size: 12.5px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  overflow-wrap: anywhere;\n}\n.envx-live i {\n  flex: none;\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-success-primary);\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent);\n}\n.envx-live[data-state='ok'] {\n  color: var(--dsw-alias-state-success-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);\n}\n\n/* remote browser */\n.envx-browser {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-height: 0;\n}\n.envx-browser-bar {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n}\n.envx-browser-bar select {\n  flex: none;\n  width: 200px;\n}\n.envx-browser-list {\n  height: 320px;\n  overflow: auto;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: 10px;\n  background: var(--dsw-alias-bg-base);\n}\n.envx-entry {\n  appearance: none;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  width: 100%;\n  height: 34px;\n  padding: 0 12px;\n  border: none;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13px;\n  text-align: left;\n  cursor: pointer;\n}\n.envx-entry:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n.envx-entry[data-type='file'] {\n  color: var(--dsw-alias-label-tertiary);\n  cursor: default;\n}\n.envx-entry[data-type='file']:hover {\n  background: transparent;\n}\n.envx-entry svg {\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n}\n.envx-entry[data-type='dir'] svg {\n  color: #e0a43a;\n}\n.envx-entry span {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-entry em {\n  flex: none;\n  font-style: normal;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  font-variant-numeric: tabular-nums;\n}\n.envx-browser-state {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  height: 100%;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 13px;\n  padding: 0 24px;\n  text-align: center;\n}\n.envx-crumbs {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  min-width: 0;\n  flex: 1;\n  height: 34px;\n  padding: 0 6px;\n  border-radius: 8px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  background: var(--dsw-alias-bg-base);\n  overflow: hidden;\n}\n.envx-crumbs input {\n  flex: 1;\n  min-width: 0;\n  height: 100%;\n  border: none;\n  outline: none;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);\n  font-size: 12.5px;\n}\n\n/* composer chip + popover */\n.envx-chipbtn {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 28px;\n  padding: 0 8px;\n  border: none;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 13px;\n  line-height: 20px;\n  cursor: pointer;\n  white-space: nowrap;\n  max-width: 220px;\n  transition:\n    background 0.12s,\n    color 0.12s;\n}\n.envx-chipbtn:hover,\n.envx-chipbtn[aria-expanded='true'] {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n.envx-chipbtn[data-active] {\n  color: var(--dsw-alias-state-business-primary);\n}\n.envx-chipbtn[data-error] {\n  color: var(--dsw-alias-state-error-primary);\n}\n.envx-chipbtn i {\n  flex: none;\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-error-primary);\n}\n.envx-chipbtn span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.envx-chipbtn b {\n  font-weight: 500;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 16px;\n  height: 16px;\n  padding: 0 4px;\n  border-radius: 8px;\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-primary-foreground, #fff);\n  background: var(--dsw-alias-state-business-primary);\n}\n/* GUI lease badge next to the environment name */\n.envx-chipbtn em {\n  font-style: normal;\n  font-size: 10.5px;\n  line-height: 14px;\n  padding: 0 4px;\n  border-radius: 4px;\n  border: 1px solid currentColor;\n  opacity: 0.8;\n}\n.envx-pop {\n  position: fixed;\n  z-index: 1000;\n  width: 340px;\n  max-height: min(560px, calc(100vh - 32px));\n  overflow: auto;\n  padding: 6px;\n  border-radius: 14px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);\n  backdrop-filter: blur(24px);\n  box-shadow: 0 12px 40px color-mix(in srgb, #000 18%, transparent);\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  line-height: 20px;\n  animation: envx-pop 0.12s ease-out;\n}\n@keyframes envx-pop {\n  from {\n    opacity: 0;\n    transform: translateY(4px);\n  }\n}\n.envx-pop-section {\n  padding: 10px 10px 8px;\n}\n.envx-pop-section + .envx-pop-section {\n  border-top: 0.5px solid var(--dsw-alias-border-l1);\n}\n.envx-pop-title {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  font-size: 12px;\n  line-height: 18px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-secondary);\n  text-transform: none;\n  margin-bottom: 6px;\n}\n.envx-pop-title small {\n  font-weight: 400;\n  color: var(--dsw-alias-label-tertiary);\n}\n.envx-pop-hint {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 17px;\n  margin: 0 0 8px;\n}\n.envx-pop-item {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-height: 36px;\n  padding: 4px 6px;\n  border-radius: 8px;\n}\n.envx-pop-item[data-click] {\n  cursor: pointer;\n}\n.envx-pop-item[data-click]:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n.envx-pop-item .envx-tile {\n  width: 26px;\n  height: 26px;\n  border-radius: 7px;\n}\n.envx-pop-item-main {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n}\n.envx-pop-item-main strong {\n  font-weight: 500;\n  font-size: 13px;\n  line-height: 18px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-pop-item-main span {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11.5px;\n  line-height: 16px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-check {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 16px;\n  height: 16px;\n  border-radius: 5px;\n  border: 1px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l3));\n  color: transparent;\n  transition:\n    background 0.1s,\n    border-color 0.1s;\n}\n.envx-check[data-on] {\n  background: var(--dsw-alias-state-business-primary);\n  border-color: var(--dsw-alias-state-business-primary);\n  color: #fff;\n}\n.envx-pop-foot {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n  margin-top: 8px;\n}\n.envx-textbtn {\n  appearance: none;\n  border: none;\n  background: transparent;\n  padding: 2px 6px;\n  border-radius: 6px;\n  color: var(--dsw-alias-state-business-primary);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n.envx-textbtn:hover {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);\n}\n.envx-textbtn[data-quiet] {\n  color: var(--dsw-alias-label-tertiary);\n}\n.envx-textbtn[data-quiet]:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n.envx-textbtn:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n.envx-mounted {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 8px;\n  border-radius: 10px;\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);\n}\n.envx-hero {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 6px;\n  padding: 40px 16px;\n  border: 0.5px dashed var(--dsw-alias-border-l2);\n  border-radius: 14px;\n  text-align: center;\n}\n.envx-hero strong {\n  font-size: 14px;\n  font-weight: 600;\n}\n.envx-hero span {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 13px;\n}\n\n/* ---- workspace bindings (sidebar rows of remote workspaces) ---- */\n.envx-ws-tag {\n  display: inline-flex;\n  flex: 0 1 auto;\n  align-items: center;\n  gap: 4px;\n  min-width: 0;\n  max-width: 112px;\n  height: 20px;\n  padding: 0 6px;\n  border: none;\n  border-radius: var(--dsw-radius-sm, 6px);\n  background: transparent;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  font-size: 11px;\n  line-height: 16px;\n}\n.envx-ws-tag svg {\n  flex: none;\n}\n.envx-ws-tag-name {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.envx-ws-tag[data-state='offline'],\n.envx-ws-tag[data-state='error'] {\n  color: var(--dsw-alias-state-error-primary);\n}\n.envx-ws-dot {\n  flex: none;\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-error-primary);\n}\n.envx-ws-dot[data-state='busy'] {\n  background: var(--dsw-alias-state-warn-primary);\n}\n";

// packages/client/src/workspace-decor.tsx
var React8 = __toESM(require("react"), 1);
var import_react8 = require("react");
var import_react_dom2 = require("react-dom");
var ROW_SELECTOR = '[role="treeitem"][data-row-key^="workspace:"]';
var HOST_ATTR = "data-envx-ws";
var EMPTY = [];
var useNoWorkspaces = (selector) => selector({ items: EMPTY });
var selectItems = (s) => s.items;
function makeHost() {
  const el = document.createElement("span");
  el.setAttribute(HOST_ATTR, "trail");
  el.style.display = "contents";
  return el;
}
function placeTrail(row, trail) {
  const actions = Array.from(row.children).find((c) => !c.hasAttribute(HOST_ATTR) && c.querySelector("button"));
  if (trail.parentElement !== row || trail.nextElementSibling !== (actions ?? null))
    row.insertBefore(trail, actions ?? null);
}
function sameDecorations(a, b) {
  return a.length === b.length && a.every((d, i) => {
    const e = b[i];
    return !!e && d.workspaceId === e.workspaceId && d.row === e.row && d.trail === e.trail;
  });
}
function stateLabel(t, a) {
  if (!a) return "";
  const label = t(`ws.state.${a.state}`);
  return a.reason ? `${label} \xB7 ${a.reason}` : label;
}
function Tag({ binding, view, t }) {
  const env = view?.environments.find((e) => e.id === binding.envId);
  const a = binding.envId ? view?.availability[binding.envId] : void 0;
  const name = env?.name ?? binding.envId ?? "";
  const unavailable = isUnavailable(a?.state);
  const title = [t("ws.tag.remote", { name, root: binding.remoteRoot ?? "" }), stateLabel(t, a)].filter(Boolean).join("\n");
  return /* @__PURE__ */ React8.createElement("span", { className: "envx-ws-tag", "data-state": a?.state ?? "unknown", title, "aria-label": title, role: "img" }, /* @__PURE__ */ React8.createElement(KindIcon, { kind: env?.kind, size: 12 }), /* @__PURE__ */ React8.createElement("span", { className: "envx-ws-tag-name" }, name), (unavailable || a?.state === "busy") && /* @__PURE__ */ React8.createElement("span", { className: "envx-ws-dot", "data-state": a?.state, "aria-hidden": "true" }));
}
function WorkspaceDecorations({ store, t, useWorkspaces }) {
  const useItems = useWorkspaces ?? useNoWorkspaces;
  const items = useItems(selectItems);
  const snapshot2 = (0, import_react8.useSyncExternalStore)(store.subscribe, store.getSnapshot);
  const [decorations, setDecorations] = (0, import_react8.useState)([]);
  const [rowIds, setRowIds] = (0, import_react8.useState)([]);
  const hosts = (0, import_react8.useRef)(/* @__PURE__ */ new Map());
  const byIdRef = (0, import_react8.useRef)(snapshot2.byId);
  byIdRef.current = snapshot2.byId;
  (0, import_react8.useEffect)(() => {
    const refs = items.length > 0 ? items.map((w) => ({ workspaceId: w.workspaceId, path: w.path })) : rowIds.map((workspaceId) => ({ workspaceId }));
    store.setWorkspaces(refs);
  }, [items, rowIds, store]);
  const sync = (0, import_react8.useCallback)(() => {
    const byId = byIdRef.current;
    const seen = /* @__PURE__ */ new Set();
    const ids = [];
    const next = [];
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      const workspaceId = workspaceIdOfRowKey(row.getAttribute("data-row-key"));
      if (!workspaceId) continue;
      ids.push(workspaceId);
      const binding = byId.get(workspaceId);
      if (!binding?.envId || binding.kind !== "remote") continue;
      seen.add(row);
      let trail = hosts.current.get(row);
      if (!trail) {
        trail = makeHost();
        hosts.current.set(row, trail);
      }
      placeTrail(row, trail);
      next.push({ workspaceId, row, trail });
    }
    for (const [row, trail] of hosts.current) {
      if (seen.has(row)) continue;
      trail.remove();
      hosts.current.delete(row);
    }
    setDecorations((prev) => sameDecorations(prev, next) ? prev : next);
    setRowIds((prev) => prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids);
  }, []);
  (0, import_react8.useLayoutEffect)(() => {
    sync();
  }, [snapshot2.byId, sync]);
  (0, import_react8.useEffect)(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const target2 = r.target instanceof Element ? r.target : null;
        if (target2 === document.body || target2?.closest('[role="tree"]')) {
          schedule();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const trails = hosts.current;
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const trail of trails.values()) trail.remove();
      trails.clear();
    };
  }, [sync]);
  return /* @__PURE__ */ React8.createElement(React8.Fragment, null, decorations.map((d) => {
    const binding = snapshot2.byId.get(d.workspaceId);
    if (!binding) return null;
    return (0, import_react_dom2.createPortal)(/* @__PURE__ */ React8.createElement(Tag, { binding, view: snapshot2.view, t }), d.trail, d.workspaceId);
  }));
}

// packages/client/src/index.tsx
var PANEL_ID = "environments";
var inject = ["slots", "locale", "layout", "uiWorkspace"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), "environments: dictionaries");
  const t = ctx.locale.bind(NS);
  const subscribeLocale = (listener) => ctx.locale.subscribe(listener);
  const localeSnapshot = () => ctx.locale.getSnapshot();
  ctx.effect(() => {
    if (typeof document === "undefined") return () => {
    };
    const style = document.createElement("style");
    style.dataset["plugin"] = "dsh-plugin-environments";
    style.textContent = styles_default;
    document.head.appendChild(style);
    return () => style.remove();
  }, "environments: styles");
  const openManager = () => {
    try {
      ctx.layout.selectPanel(PANEL_ID);
    } catch {
    }
  };
  const startSession = (workspaceId) => {
    try {
      ctx.uiWorkspace.startSession(workspaceId);
    } catch {
    }
  };
  function Page() {
    (0, import_react9.useSyncExternalStore)(subscribeLocale, localeSnapshot);
    return /* @__PURE__ */ React9.createElement(EnvironmentsPage, { t, startSession });
  }
  function Chip({ sessionId }) {
    (0, import_react9.useSyncExternalStore)(subscribeLocale, localeSnapshot);
    if (!sessionId) return null;
    return /* @__PURE__ */ React9.createElement(EnvironmentChip, { sessionId, t, openManager });
  }
  const bindings = new BindingsStore();
  function Decorations({ useWorkspaces }) {
    (0, import_react9.useSyncExternalStore)(subscribeLocale, localeSnapshot);
    return /* @__PURE__ */ React9.createElement(WorkspaceDecorations, { store: bindings, t, useWorkspaces });
  }
  function PanelIcon({ size }) {
    return /* @__PURE__ */ React9.createElement(IconEnvironments, { size });
  }
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS
      },
      Page
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 30,
        locale: NS,
        label: () => t("panel")
      },
      PanelIcon
    )
  );
  ctx.slots.inject(
    "conversation.input.left",
    () => ctx.slots.register(
      {
        name: "conversation.input.left",
        id: "environments",
        order: 60,
        locale: NS,
        inject: (sessionId) => ({ sessionId: sessionId === void 0 ? void 0 : String(sessionId) })
      },
      Chip
    )
  );
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      {
        name: "shell.overlay",
        id: "environments.workspace-bindings",
        locale: NS
      },
      Decorations
    )
  );
}

		})(module, module.exports, require);
		const entry = module.exports;
		return { inject: entry.inject, apply: entry.apply };
	},
});
