<div align="center">

<img src="assets/oja_icon.png" alt="Oja" width="120" />

# Oja Playground

**A browser-based IDE for [Oja](https://github.com/agberohq/oja) — the minimal zero-build JavaScript framework.**

Write, edit, and preview Oja apps in real time. No install. No build step. Just open and code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Oja](https://img.shields.io/badge/Oja-v0.0.10-388bfd)](https://github.com/agberohq/oja)
[![Zero Build](https://img.shields.io/badge/build-zero-3fb950)]()

</div>

---

## Overview

Oja Playground is a fully self-contained, browser-based development environment for the **Oja** framework. It features a code editor, live preview, integrated console, and a virtual file system — all running client-side with zero server dependencies.

Built on Oja itself, the playground demonstrates the framework's capabilities while providing a frictionless way to learn and experiment with it.

<br>

## Features

| Feature                 | Description                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| **Code Editor**         | Powered by CodeMirror with syntax highlighting for HTML, JS, CSS, and JSON |
| **Live Preview**        | Sandboxed iframe with auto-refresh and mobile device simulation (375×667)  |
| **Integrated Console**  | Captures `console.log`, warnings, errors, and unhandled promise rejections |
| **Virtual File System** | All files persist in IndexedDB — your work survives page reloads           |
| **Multi-file Projects** | Tabbed interface with color-coded file types and full CRUD                 |
| **Import / Export**     | Save and load projects as JSON files                                       |
| **8 Built-in Examples** | From hello-world to a full Twitter clone                                   |
| **Dark / Light Theme**  | GitHub-inspired theming with one-click toggle                              |
| **Offline-first**       | Service Worker serves virtual files — works after first visit              |

<br>

## Getting Started

No installation required. The playground runs entirely in the browser.

```bash
git clone https://github.com/agberohq/oja-playground.git
cd oja-playground
```

Serve the directory with [Agbero](https://github.com/agberohq/agbero):

```bash
agbero serve . --https
```

Then open `https://localhost` in your browser and navigate to `/playground/`.

<br>

## Examples

The playground ships with 8 examples — click any to open it directly:

| Example           | Level    | Concepts                                  |
| ----------------- | -------- | ----------------------------------------- |
| **Starter**       | Beginner | `state`, `effect`, components             |
| **Todo**          | Reactive | Lists, `derived`, batch updates           |
| **Router**        | Routing  | Multi-page SPA, middleware                |
| **Guestbook**     | Forms    | Form handling, validation, `context`      |
| **Channel**       | Async    | Async pipelines, `go()` channels          |
| **Rhyme Rush**    | Advanced | Game loop, AI integration, animations     |
| **Twitter Clone** | Full App | Auth, layouts, routing, modals — 17 files |
| **Blank**         | —        | Empty workspace, start from scratch       |

<br>

## Architecture

```
oja-playground/
├── index.html                 # Landing page
├── playground/
│   ├── index.html             # Playground app shell
│   ├── sw.js                  # Service Worker (virtual file serving)
│   ├── js/
│   │   ├── app.js             # Main orchestrator (state, effects, VFS)
│   │   └── oja.js             # CDN import for Oja framework
│   ├── layouts/
│   │   └── playground.html    # 3-pane layout with slot composition
│   ├── components/
│   │   ├── nav.html           # Toolbar & project controls
│   │   ├── editor.html        # CodeMirror editor
│   │   ├── tabs.html          # File tab bar
│   │   ├── sidebar.html       # File tree explorer
│   │   ├── preview.html       # Sandbox iframe + mobile toggle
│   │   └── console.html       # Integrated console output
│   └── css/
│       └── styles.css         # Playground styling
└── examples/
    ├── starter/
    ├── todo/
    ├── router/
    ├── channel/
    ├── guestbook/
    ├── game/
    ├── twitter/               # 17-file Twitter clone
    └── blank/
```

<br>

## How It Works

```
┌─────────────┐     debounce      ┌───────────────┐
│  CodeMirror  │ ───────────────▶  │ context('files')│
│   Editor     │    (350ms)       │  (reactive VFS) │
└─────────────┘                   └───────┬────────┘
                                          │ sync
                                          ▼
                                  ┌───────────────┐
                                  │ Service Worker │
                                  │  (sw.js)       │
                                  └───────┬────────┘
                                          │ intercept /preview-zone/*
                                          ▼
                                  ┌───────────────┐     postMessage
                                  │ Preview iframe │ ──────────────▶ Console
                                  │  (sandbox)     │   (logs, errors)
                                  └───────────────┘
```

1. User edits files in the CodeMirror editor
2. Changes are debounced and saved to reactive `context('files')` state
3. VFS is synced to the Service Worker and persisted in IndexedDB
4. The preview iframe requests files from `/preview-zone/*`
5. The Service Worker serves virtual files with correct MIME types and injects a console bridge script
6. Console output is forwarded to the parent via `postMessage` and rendered in the integrated console

<br>

## Tech Stack

| Layer     | Technology                                                       |
| --------- | ---------------------------------------------------------------- |
| Framework | [Oja](https://github.com/agberohq/oja) v0.0.10 (ES modules, CDN) |
| Editor    | CodeMirror 5.65.16                                               |
| Storage   | IndexedDB (VFS) + localStorage (UI state)                        |
| Fonts     | IBM Plex Sans / IBM Plex Mono                                    |
| Build     | None — pure ES modules in the browser                            |

<br>

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

<br>

## License

This project is licensed under the [MIT License](LICENSE).

Built by [Agbero HQ](https://github.com/agberohq).
