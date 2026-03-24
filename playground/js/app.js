/**
 * Oja Playground — orchestrates VFS, Service Worker, layout mounting,
 * and all global reactive state. Components communicate via context + emit/listen.
 */

import {
  context,
  state,
  derived,
  effect,
  emit,
  listen,
  on,
  keys,
  layout,
  VFS,
  Out,
  notify,
  modal,
  Search,
} from "./oja.js";

// Canonical context keys
export const [files, setFiles] = context("files", {});
export const [activeFile, setActiveFile] = context.persist(
  "active_file",
  "index.html",
);
export const [logs, setLogs] = context("logs", []);
export const [theme, setTheme] = context.persist("theme", "dark");
export const [layoutMode, setLayoutMode] = context.persist(
  "layout_mode",
  "horizontal",
);
export const [mobileView, setMobileView] = context.persist(
  "mobile_view",
  false,
);
export const [autoRefresh, setAutoRefresh] = context.persist(
  "auto_refresh",
  true,
);
export const [panelSplit, setPanelSplit] = context.persist("panel_split", 50);
export const [consoleOpen, setConsoleOpen] = context.persist(
  "console_open",
  true,
);
export const [consoleH, setConsoleH] = context.persist("console_height", 180);
export const [sidebarOpen, setSidebarOpen] = context("sidebar_open", false);
export const [sidebarPin, setSidebarPin] = context.persist(
  "sidebar_pin",
  false,
);
export const [savedState, setSavedState] = state(null);
export const [projects, setProjects] = context("projects", []);

export const isDirty = derived(() => JSON.stringify(files()) !== savedState());

// Fetches examples/blank/index.html; falls back to a minimal inline template.
let _blankCache = null;
async function _fetchBlank() {
  if (_blankCache) return _blankCache;
  try {
    const res = await fetch("../examples/blank/index.html");
    if (res.ok) {
      _blankCache = await res.text();
      return _blankCache;
    }
  } catch (_) {}
  _blankCache = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>New Project</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0f0f0f; color: #e8e8e8; font-family: system-ui, sans-serif;
               min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        #app { text-align: center; }
        h1 { font-size: 1.5rem; margin-bottom: 8px; }
        p  { color: #555; font-size: 14px; }
    </style>
</head>
<body>
<div id="app">
    <h1>New Project</h1>
    <p>Start building with Oja.</p>
</div>
<script type="module">
    import { state, effect } from 'https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.core.esm.js';

    // const [count, setCount] = state(0);
    // effect(() => console.log(count()));
</script>
</body>
</html>`;
  return _blankCache;
}

let _vfs = null;
let _projectsVfs = null;

async function init() {
  showLoading(true);
  try {
    await registerSW();

    _vfs = new VFS("oja-playground");
    await _vfs.ready();

    _projectsVfs = new VFS("oja-projects");
    await _projectsVfs.ready();
    setProjects(await listProjects());

    // If a ?example= query param is present, defer file loading to loadFromQuery()
    // so the example loads after components are mounted and can react to state changes.
    const hasExampleParam = new URLSearchParams(location.search).has("example");

    if (!hasExampleParam) {
      const existing = await _vfs.getAll();
      if (Object.keys(existing).length === 0) {
        await loadExample("starter");
      } else {
        setFiles(existing);
        setSavedState(JSON.stringify(existing));
      }
    }

    await layout.apply("#app", "./layouts/playground.html");
    await Promise.all([
      layout.slot("nav", Out.c("./components/nav.html")),
      layout.slot("tabs", Out.c("./components/tabs.html")),
      layout.slot("editor", Out.c("./components/editor.html")),
      layout.slot("preview", Out.c("./components/preview.html")),
      layout.slot("console", Out.c("./components/console.html")),
      layout.slot("sidebar", Out.c("./components/sidebar.html")),
    ]);

    setupEffects();
    setupEvents();
    setupResize();
    await loadFromURL();
    await loadFromQuery();

    window.addEventListener("beforeunload", (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    await syncToWorker();
    runPreview();
  } catch (err) {
    console.error("[playground] init failed", err);
    notify.error("Failed to start. Check console.");
  } finally {
    showLoading(false);
  }
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return Promise.resolve();
  return new Promise(async (resolve) => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (e) {
      console.warn("[playground] SW registration failed", e);
      resolve();
      return;
    }
    if (navigator.serviceWorker.controller) {
      resolve();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", resolve, {
      once: true,
    });
    setTimeout(resolve, 2000);
  });
}

function syncToWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve();

  return new Promise(async (resolve) => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sw = reg.active;
      if (!sw) {
        resolve();
        return;
      }

      const onMsg = (e) => {
        if (e.data?.type === "VFS_SYNCED") {
          navigator.serviceWorker.removeEventListener("message", onMsg);
          resolve();
        }
      };

      navigator.serviceWorker.addEventListener("message", onMsg);
      sw.postMessage({ type: "SYNC_VFS", files: files() });

      setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        resolve();
      }, 1000);
    } catch (e) {
      resolve();
    }
  });
}

async function runPreview() {
  if (!files()["index.html"]) {
    notify.warn("No index.html to preview.");
    return;
  }
  setLogs([]); // Automatically clear logs on every run so old state isn't visually injected back
  await syncToWorker();
  emit("preview:run", { url: `./preview-zone/index.html?t=${Date.now()}` });
  setSavedState(JSON.stringify(files()));
}

async function loadExample(dir) {
  try {
    await _vfs.clear();
    setLogs([]);
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );

    const base = `../examples/${dir}/`;
    let filesToLoad = ["index.html"];

    try {
      const cfgRes = await fetch(base + "oja.config.json");
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        filesToLoad = cfg.vfs?.files || filesToLoad;
      }
    } catch (_) {}

    const newFiles = {};
    await Promise.all(
      filesToLoad.map(async (path) => {
        try {
          const res = await fetch(base + path);
          if (res.ok) {
            newFiles[path] = await res.text();
            await _vfs.write(path, newFiles[path]);
          }
        } catch (_) {}
      }),
    );

    // If every fetch failed (examples unreachable), fall back to blank
    // rather than leaving the workspace with no files and a silent empty state.
    if (Object.keys(newFiles).length === 0) {
      const html = await _fetchBlank();
      newFiles["index.html"] = html;
      await _vfs.write("index.html", html);
    }

    setFiles(newFiles);
    setActiveFile("index.html");
    setSavedState(JSON.stringify(newFiles));

    await syncToWorker();
    runPreview();
    notify.success(`Loaded "${dir}"`);
  } catch (err) {
    notify.error(`Failed to load "${dir}"`);
    console.error(err);
  }
}

// Replaces the old resetWorkspace. Functions as a true "New Project" action.
async function createNewProject() {
  const ok = await modal.confirm(
    "Create a new blank project? Current files will be lost.",
  );
  if (!ok) return;

  const html = await _fetchBlank();
  const project = { "index.html": html };

  await _vfs.clear();
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  setLogs([]);
  localStorage.removeItem("pg_expanded");

  await _vfs.write("index.html", html);
  setFiles(project);
  setActiveFile("index.html");
  setSavedState(JSON.stringify(project));

  await syncToWorker();
  runPreview();
  notify.success("New project created.");
}

async function createFile(name) {
  if (!name?.trim()) return;
  name = name.trim();
  if (files()[name]) {
    notify.warn(`"${name}" already exists`);
    return;
  }

  const templates = {
    js: `// ${name}\n`,
    css: `/* ${name} */\n`,
    html: `<!-- ${name} -->\n<div>\n\n</div>\n`,
  };
  const ext = name.split(".").pop();
  const content = templates[ext] || "";

  const next = { ...files(), [name]: content };
  setFiles(next);
  setActiveFile(name);
  setSavedState(JSON.stringify(next));
  await _vfs.write(name, content);
  syncToWorker();
}

async function deleteFile(path) {
  if (path === "index.html") {
    notify.warn("index.html is required.");
    return;
  }
  const ok = await modal.confirm(`Delete "${path}"?`);
  if (!ok) return;
  const next = { ...files() };
  delete next[path];
  setFiles(next);
  if (activeFile() === path) setActiveFile("index.html");
  setSavedState(JSON.stringify(next));
  await _vfs.rm(path);
  syncToWorker();
  notify.success(`Deleted "${path}"`);
}

async function renameFile(oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  if (files()[newPath]) {
    notify.warn(`"${newPath}" already exists`);
    return;
  }
  const content = files()[oldPath];
  const next = { ...files() };
  delete next[oldPath];
  next[newPath] = content;
  setFiles(next);
  if (activeFile() === oldPath) setActiveFile(newPath);
  setSavedState(JSON.stringify(next));
  await _vfs.write(newPath, content);
  await _vfs.rm(oldPath);
  syncToWorker();
}

async function exportProject() {
  const data = JSON.stringify(await _vfs.getAll(), null, 2);
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([data], { type: "application/json" })),
    download: `oja-project-${Date.now()}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  notify.success("Exported");
}

async function importProject(file) {
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    await _vfs.clear();
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    for (const [p, c] of Object.entries(imported)) await _vfs.write(p, c);
    setFiles(imported);
    setActiveFile("index.html");
    setSavedState(JSON.stringify(imported));
    await syncToWorker();
    runPreview();
    notify.success(`Imported ${Object.keys(imported).length} files`);
  } catch (err) {
    notify.error("Import failed: " + err.message);
  }
}

async function loadFromURL() {
  const params = new URLSearchParams(location.hash.slice(1));
  const encoded = params.get("state");
  if (!encoded) return;
  try {
    const imported = JSON.parse(decodeURIComponent(atob(encoded)));
    await _vfs.clear();
    for (const [p, c] of Object.entries(imported)) await _vfs.write(p, c);
    setFiles(imported);
    setActiveFile("index.html");
    setSavedState(JSON.stringify(imported));

    // Strip the hash now that it's loaded to VFS, so refreshing doesn't overwrite new edits
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    notify.success("Project loaded from URL");
  } catch (_) {}
}

// Load an example named in the ?example= query param — set by landing page links.
// Runs after loadFromURL so a hash state always takes priority.
async function loadFromQuery() {
  const params = new URLSearchParams(location.search);
  const example = params.get("example");
  if (!example) return;
  // Strip the param immediately so refreshing doesn't reload the example over edits
  history.replaceState(null, "", window.location.pathname);
  await loadExample(example);
}

// ─── Project persistence (VFS('oja-projects')) ────────────────────────────────

// Save current workspace as a named project. Returns the saved record.
async function saveProject(name) {
  if (!name?.trim()) return;
  const id = `proj_${Date.now()}`;
  const record = {
    id,
    name: name.trim(),
    fileCount: Object.keys(files()).length,
    savedAt: Date.now(),
    files: files(),
  };
  await _projectsVfs.write(`project:${id}`, JSON.stringify(record));
  setProjects(await listProjects());
  notify.success(`Saved "${record.name}"`);
  return record;
}

// Load a saved project into the active workspace.
async function openProject(id) {
  if (isDirty()) {
    const ok = await modal.confirm("You have unsaved changes. Open anyway?");
    if (!ok) return;
  }
  const record = await getProject(id);
  if (!record) {
    notify.error("Project not found");
    return;
  }

  await _vfs.clear();
  history.replaceState(null, "", window.location.pathname);
  setLogs([]);

  for (const [p, c] of Object.entries(record.files)) await _vfs.write(p, c);
  setFiles(record.files);
  setActiveFile("index.html");
  setSavedState(JSON.stringify(record.files));
  await syncToWorker();
  runPreview();
  modal.close();
  notify.success(`Opened "${record.name}"`);
}

// Return project metadata list (no files) sorted newest first.
async function listProjects() {
  const all = await _projectsVfs.getAll();
  return Object.values(all)
    .map((raw) => {
      try {
        const r = JSON.parse(raw);
        return {
          id: r.id,
          name: r.name,
          fileCount: r.fileCount,
          savedAt: r.savedAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAt - a.savedAt);
}

// Return a full project record including files.
async function getProject(id) {
  const raw = await _projectsVfs.readText(`project:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Delete a saved project.
async function deleteProject(id) {
  await _projectsVfs.rm(`project:${id}`);
  setProjects(await listProjects());
}

// ─── Remote URL import ────────────────────────────────────────────────────────

// Fetch a project from a remote URL that exposes an oja.config.json.
// Throws with a human-readable message on any fatal error so the caller can notify.error().
async function loadFromRemoteURL(url) {
  const base = url.endsWith("/") ? url : url + "/";

  let cfg;
  try {
    const cfgRes = await fetch(base + "oja.config.json");
    if (!cfgRes.ok) throw new Error(`No oja.config.json found at ${base}`);
    cfg = await cfgRes.json();
  } catch (err) {
    if (err.message.includes("oja.config.json")) throw err;
    throw new Error(`CORS error: the server must allow cross-origin requests`);
  }

  const filePaths = cfg?.vfs?.files;
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("oja.config.json has no vfs.files array");
  }

  const newFiles = {};
  await Promise.all(
    filePaths.map(async (path) => {
      try {
        const res = await fetch(base + path);
        if (res.ok) newFiles[path] = await res.text();
      } catch (_) {}
    }),
  );

  if (Object.keys(newFiles).length === 0) {
    throw new Error(
      "No files could be fetched — check CORS headers on the server",
    );
  }

  await _vfs.clear();
  history.replaceState(null, "", window.location.pathname);
  for (const [p, c] of Object.entries(newFiles)) await _vfs.write(p, c);
  setFiles(newFiles);
  setActiveFile("index.html");
  setSavedState(JSON.stringify(newFiles));
  await syncToWorker();
  runPreview();

  const loaded = Object.keys(newFiles).length;
  const total = filePaths.length;
  if (loaded < total) {
    notify.warn(
      `Loaded ${loaded} of ${total} files — some could not be fetched`,
    );
  } else {
    notify.success(`Loaded ${loaded} files from URL`);
  }
}

function setupEffects() {
  effect(() => {
    document.body.dataset.theme = theme();
  });

  effect(() => {
    document
      .querySelector(".pg-layout")
      ?.setAttribute("data-layout", layoutMode());
  });

  effect(() => {
    const sidebar = document.querySelector(".pg-sidebar");
    const main = document.querySelector(".pg-main");
    if (!sidebar || !main) return;
    const open = sidebarOpen() || sidebarPin();
    sidebar.classList.toggle("open", open);
    sidebar.classList.toggle("pinned", sidebarPin());
    main.classList.toggle("sidebar-pinned", sidebarPin());
  });

  effect(() => {
    const body = document.querySelector(".console-body");
    if (body) {
      body.style.height = consoleH() + "px";
      body.style.maxHeight = "none";
    }
  });

  effect(() => {
    if (!autoRefresh() || !isDirty()) return;
    const t = setTimeout(() => runPreview(), 900);
    return () => clearTimeout(t);
  });
}

function setupEvents() {
  on('[data-action="run"]', "click", () => runPreview());
  listen("preview:force", () => runPreview());
  on('[data-action="new-project"]', "click", () => createNewProject());
  on('[data-action="new-file"]', "click", () => openNewFileModal());
  on('[data-action="examples"]', "click", () => openProjectsModal());
  on('[data-action="save-project"]', "click", () => openSaveProjectPrompt());
  on('[data-action="toggle-theme"]', "click", () =>
    setTheme((t) => (t === "dark" ? "light" : "dark")),
  );
  on('[data-action="toggle-layout"]', "click", () =>
    setLayoutMode((m) => (m === "horizontal" ? "vertical" : "horizontal")),
  );
  on('[data-action="toggle-mobile"]', "click", () => setMobileView((v) => !v));
  on('[data-action="toggle-sidebar"]', "click", () =>
    setSidebarOpen((v) => !v),
  );
  on('[data-action="pin-sidebar"]', "click", () => setSidebarPin((v) => !v));
  on('[data-action="pop-out"]', "click", () => {
    const f = document.getElementById("preview-frame");
    if (f?.src) window.open(f.src, "_blank");
  });

  // Explicit Share button copies URL to clipboard instead of polluting URL bar on every keystroke
  on('[data-action="share"]', "click", () => {
    try {
      const stateStr = JSON.stringify(files());
      const encoded = btoa(encodeURIComponent(stateStr));
      const url =
        window.location.origin +
        window.location.pathname +
        window.location.search +
        "#state=" +
        encoded;
      navigator.clipboard.writeText(url);
      notify.success("Shareable link copied to clipboard!");
    } catch (err) {
      notify.error("Project too large to share via URL. Use Export instead.");
    }
  });

  on('[data-action="export"]', "click", exportProject);
  on('[data-action="import"]', "click", () =>
    document.getElementById("import-input")?.click(),
  );
  on("#import-input", "change", (e) => {
    if (e.target.files?.[0]) importProject(e.target.files[0]);
    e.target.value = "";
  });

  on('[data-action="modal-close"]', "click", () => modal.close());

  // Form submission handlers for modals (allows pressing Enter to submit)
  on("#new-file-form", "submit", (e) => {
    e.preventDefault();
    const val = document.getElementById("new-file-input")?.value?.trim();
    if (val) createFile(val);
    modal.close();
  });

  on("#rename-form", "submit", (e, el) => {
    e.preventDefault();
    const path = el.dataset.path;
    const name = path.split("/").pop();
    const newName = document.getElementById("rename-input")?.value?.trim();
    if (newName && newName !== name) {
      const parts = path.split("/");
      parts.pop();
      const newPath = parts.length ? parts.join("/") + "/" + newName : newName;
      renameFile(path, newPath);
    }
    modal.close();
  });

  on('[data-action="load-example"]', "click", (e, el) => {
    modal.close();
    if (el.dataset.ex === "blank") {
      createNewProject();
      return;
    }
    loadExample(el.dataset.ex);
  });

  on('[data-action="open-project"]', "click", (e, el) => {
    openProject(el.dataset.id);
  });

  on('[data-action="delete-project"]', "click", async (e, el) => {
    e.stopPropagation();
    const ok = await modal.confirm("Delete this saved project?");
    if (!ok) return;
    await deleteProject(el.dataset.id);
    openProjectsModal();
  });

  on("#url-import-form", "submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("url-import-input")?.value?.trim();
    if (!url) return;
    modal.close();
    try {
      await loadFromRemoteURL(url);
    } catch (err) {
      notify.error(err.message);
    }
  });

  on("#save-project-form", "submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("save-project-input")?.value?.trim();
    if (name) saveProject(name);
    modal.close();
  });

  listen("vfs:save", async ({ path, content }) => {
    await _vfs.write(path, content);
    syncToWorker();
  });
  listen("file:delete", ({ path }) => deleteFile(path));
  listen("file:rename", ({ oldPath, newPath }) => renameFile(oldPath, newPath));
  listen("file:rename-prompt", ({ path }) => openRenameModal(path));

  window.addEventListener("message", (e) => {
    if (e.data?.type === "console") {
      setLogs((prev) => [...prev.slice(-199), e.data]);
    }
  });

  document.addEventListener("click", (e) => {
    if (
      !sidebarPin() &&
      sidebarOpen() &&
      !e.target.closest(".pg-sidebar") &&
      !e.target.closest('[data-action="toggle-sidebar"]')
    ) {
      setSidebarOpen(false);
    }
  });

  keys({
    "ctrl+enter": () => runPreview(),
    "ctrl+s": (e) => {
      e.preventDefault();
      runPreview();
    },
    "ctrl+n": (e) => {
      e.preventDefault();
      openNewFileModal();
    },
    "ctrl+e": (e) => {
      e.preventDefault();
      exportProject();
    },
    "ctrl+i": (e) => {
      e.preventDefault();
      document.getElementById("import-input")?.click();
    },
    "ctrl+\\": () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    "ctrl+b": () => setSidebarOpen((v) => !v),
    escape: () => modal.close(),
    f5: (e) => {
      e.preventDefault();
      runPreview();
    },
  });
}

function setupResize() {
  makeResizable(
    document.getElementById("split-handle"),
    (pct) => {
      setPanelSplit(pct);
      document.querySelector(".editor-pane").style.flexBasis = pct + "%";
      document.querySelector(".preview-pane").style.flexBasis = 100 - pct + "%";
    },
    "horizontal",
  );

  makeResizable(
    document.getElementById("console-resize"),
    (px) => {
      const clamped = Math.max(60, Math.min(500, px));
      setConsoleH(clamped);
      if (!consoleOpen()) setConsoleOpen(true);
    },
    "console",
  );
}

function makeResizable(handle, onResize, mode) {
  if (!handle) return;
  let active = false;

  const endDrag = () => {
    if (!active) return;
    active = false;
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    document
      .querySelectorAll("iframe")
      .forEach((f) => (f.style.pointerEvents = ""));
  };

  handle.addEventListener("pointerdown", (e) => {
    active = true;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      mode === "console" ? "ns-resize" : "row-resize";
    document
      .querySelectorAll("iframe")
      .forEach((f) => (f.style.pointerEvents = "none"));
  });

  handle.addEventListener("pointermove", (e) => {
    if (!active) return;
    if (mode === "horizontal") {
      const rect = document
        .querySelector(".editor-preview")
        .getBoundingClientRect();
      const pct = Math.max(
        20,
        Math.min(80, ((e.clientX - rect.left) / rect.width) * 100),
      );
      onResize(Math.round(pct));
    } else if (mode === "console") {
      const px = window.innerHeight - e.clientY - 28;
      onResize(Math.round(px));
    }
  });

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

function openNewFileModal() {
  modal.open("pg-modal", {
    body: Out.html(`
            <form id="new-file-form" style="display:flex;flex-direction:column;gap:12px">
                <input id="new-file-input" class="modal-input" placeholder="e.g. components/card.html" autofocus>
                <div class="modal-hint">
                    <span class="hint-tag">.html</span> component &nbsp;
                    <span class="hint-tag">.js</span> module &nbsp;
                    <span class="hint-tag">.css</span> styles
                </div>
                <button type="submit" class="btn-primary">Create</button>
            </form>
        `),
  });
  setTimeout(() => document.getElementById("new-file-input")?.focus(), 50);
}

function openProjectsModal(activeTab = "projects") {
  const EXAMPLES = [
    {
      id: "blank",
      label: "Blank",
      sub: "empty project",
      tags: ["start", "empty"],
    },
    {
      id: "starter",
      label: "Starter",
      sub: "state · effect · component",
      tags: ["reactive", "beginner"],
    },
    {
      id: "todo",
      label: "Todo",
      sub: "list · reactivity",
      tags: ["list", "state"],
    },
    {
      id: "router",
      label: "Router",
      sub: "multi-page SPA",
      tags: ["routing", "spa"],
    },
    {
      id: "guestbook",
      label: "Guestbook",
      sub: "form · validation",
      tags: ["form", "validate"],
    },
    {
      id: "channel",
      label: "Channel",
      sub: "async pipeline",
      tags: ["async", "concurrency"],
    },
    { id: "game", label: "Game", sub: "Rhyme Rush", tags: ["canvas", "game"] },
    {
      id: "twitter",
      label: "Twitter",
      sub: "full SPA · 17 files",
      tags: ["spa", "advanced"],
    },
  ];

  const exSearch = new Search(
    EXAMPLES.map((e) => ({ id: e.id, ...e })),
    {
      fields: ["label", "sub", "tags"],
    },
  );

  function renderProjectsList() {
    const list = projects();
    if (!list.length) {
      return `<p class="pm-empty">No saved projects yet.<br>Use the Save button to save your current work.</p>`;
    }
    return list
      .map(
        (p) => `
            <div class="pm-project-row" data-action="open-project" data-id="${p.id}">
                <div class="pm-project-info">
                    <span class="pm-project-name">${p.name}</span>
                    <span class="pm-project-meta">${p.fileCount} file${p.fileCount !== 1 ? "s" : ""} · ${_relativeTime(p.savedAt)}</span>
                </div>
                <button class="pm-delete btn-icon-sm" data-action="delete-project" data-id="${p.id}" title="Delete">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>
                </button>
            </div>
        `,
      )
      .join("");
  }

  function renderExampleGrid(items) {
    return `<div class="example-grid">${items
      .map(
        (e) => `
            <button class="example-card" data-action="load-example" data-ex="${e.id}">
                <span class="example-label">${e.label}</span>
                <span class="example-sub">${e.sub}</span>
            </button>
        `,
      )
      .join("")}</div>`;
  }

  modal.open("pg-modal", {
    title: "Projects",
    body: Out.html(`
            <div class="pm-tabs">
                <button class="pm-tab ${activeTab === "projects" ? "active" : ""}" data-tab="projects">My Projects</button>
                <button class="pm-tab ${activeTab === "examples" ? "active" : ""}" data-tab="examples">Examples</button>
                <button class="pm-tab ${activeTab === "import" ? "active" : ""}" data-tab="import">Import URL</button>
            </div>

            <div class="pm-panel" id="pm-projects" style="${activeTab !== "projects" ? "display:none" : ""}">
                <div id="pm-project-list">${renderProjectsList()}</div>
            </div>

            <div class="pm-panel" id="pm-examples" style="${activeTab !== "examples" ? "display:none" : ""}">
                <input id="example-search" class="modal-input" placeholder="Search examples…" style="margin-bottom:10px">
                <div id="example-list">${renderExampleGrid(EXAMPLES)}</div>
            </div>

            <div class="pm-panel" id="pm-import" style="${activeTab !== "import" ? "display:none" : ""}">
                <p class="pm-import-hint">Enter the URL of a project root that contains an <code>oja.config.json</code> file.</p>
                <form id="url-import-form" style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
                    <input id="url-import-input" class="modal-input" placeholder="https://example.com/my-app/" autofocus>
                    <button type="submit" class="btn-primary">Import</button>
                </form>
            </div>
        `),
  });

  // Tab switching + example search wired after modal renders
  setTimeout(() => {
    const modalEl = document.getElementById("pg-modal");
    if (!modalEl) return;

    modalEl.querySelectorAll(".pm-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        modalEl
          .querySelectorAll(".pm-tab")
          .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
        modalEl
          .querySelectorAll(".pm-panel")
          .forEach((p) => (p.style.display = "none"));
        modalEl.querySelector(`#pm-${tab}`).style.display = "";
        if (tab === "examples")
          modalEl.querySelector("#example-search")?.focus();
        if (tab === "import")
          modalEl.querySelector("#url-import-input")?.focus();
      });
    });

    const searchEl = document.getElementById("example-search");
    const listEl = document.getElementById("example-list");
    if (searchEl && listEl) {
      searchEl.addEventListener("input", () => {
        const q = searchEl.value.trim();
        const items = q
          ? exSearch
              .search(q)
              .map((r) => EXAMPLES.find((e) => e.id === r.id))
              .filter(Boolean)
          : EXAMPLES;
        listEl.innerHTML = renderExampleGrid(items);
      });
    }
  }, 30);
}

function openSaveProjectPrompt() {
  modal.open("pg-modal", {
    title: "Save Project",
    body: Out.html(`
            <form id="save-project-form" style="display:flex;flex-direction:column;gap:12px">
                <input id="save-project-input" class="modal-input" placeholder="Project name…" autofocus>
                <button type="submit" class="btn-primary">Save</button>
            </form>
        `),
  });
  setTimeout(() => document.getElementById("save-project-input")?.focus(), 50);
}

// Format a timestamp as a short relative string for project metadata display.
function _relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

function openRenameModal(path) {
  const name = path.split("/").pop();
  modal.open("pg-modal", {
    body: Out.html(`
            <form id="rename-form" data-path="${path}" style="display:flex;flex-direction:column;gap:12px">
                <label style="font-size:11px;color:var(--text-muted)">Rename "${name}"</label>
                <input id="rename-input" class="modal-input" value="${name}" autofocus>
                <button type="submit" class="btn-primary">Rename</button>
            </form>
        `),
  });
  setTimeout(() => {
    const input = document.getElementById("rename-input");
    input?.focus();
    input?.select();
  }, 50);
}

let _loadEl = null;

function showLoading(show) {
  if (show && !_loadEl) {
    _loadEl = Object.assign(document.createElement("div"), {
      className: "pg-loading",
    });
    _loadEl.innerHTML = '<div class="pg-spinner"></div>';
    document.body.appendChild(_loadEl);
  } else if (!show && _loadEl) {
    _loadEl.remove();
    _loadEl = null;
  }
}

init().catch((err) => {
  console.error("[playground] fatal", err);
  notify.error("Fatal error — check console");
});
