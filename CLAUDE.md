# CSPM Report Builder — Claude Instructions

## JS Build System (CRITICAL)

The browser loads **`static/js/builder.js`** — this is the concatenated bundle output.  
**Never edit `static/js/builder.js` directly** — changes there are wiped on the next build.

Source files are in **`static/js/src/`**:
| File | Contents |
|------|----------|
| `core.js` | IIFE open, shared state (`findings[]`, `editingIndex`), utilities, toast |
| `ui.js` | Theme, sidebar, tabs, mesh background, dashboard |
| `findings.js` | Findings table, detail pane, form, batch operations, drag-drop |
| `export.js` | Report HTML builder, PDF rendering, CSV, JSON, autosave |
| `wizi.js` | Wiz GraphQL API integration, import logic, bulk import |
| `products.js` | Product registry: grid, timeline, form, diff, version management |
| `init.js` | Final initialization, event wiring, IIFE close |

### Workflow for every JS change

```bash
# 1. Edit the file in src/
nano static/js/src/wizi.js

# 2. Rebuild the bundle
python3 build_js.py

# 3. Bump the cache-busting version in index.html so the browser picks up the new file
#    (find ?v=NNN on the builder.js <script> tag and increment NNN)
```

The build script (`build_js.py`) already exists in the project root.  
The CSS equivalent is `build_css.py`.

---

## Keeping This File Up to Date

After any significant structural change — adding a new directory, new src file, new build script, new backend blueprint, new major feature — **update this file** to reflect it. Future Claude sessions load this file first; if it's stale, they start with a wrong mental model.

Examples of changes that warrant an update here:
- A new `static/js/src/*.js` file added to the bundle
- A new Flask blueprint or service layer added under `backend/`
- A new build or tooling script added to the project root
- A new major dependency or rendering step introduced

---

## Roadmap & Task Tracking

Planned work, feature roadmaps, and multi-step task breakdowns live in **`.plan/`** at the project root.  
Check this directory for open plans before starting any non-trivial feature work.

---

## Other Project Notes

- Flask app runs on port 8080 inside Docker
- PDF rendering via Playwright (headless Chromium)
- UI is Hebrew / RTL — test RTL layout after any CSS or HTML change
- The IIFE opens in `core.js` and closes in `init.js`; all src files share the same scope
