# atlasclark.github.io

Atlas Devices tools hub. Static landing page plus static tools, served by GitHub Pages from `main`.

## Layout
```
index.html              landing page + TOOLS registry (script block)
tools/<slug>/index.html one folder per tool
assets/brand/           web-sized logos and icons (originals in source/)
```

## Add a tool
1. Build it as plain HTML/CSS/JS in `tools/<slug>/index.html`.
2. Add one entry to `TOOLS` in `index.html` (`slug`, `name`, `summary`, `category`, `tags`, `status`).
   `status`: `live` (linked), `beta` (linked, flagged), `planned` (not linked).
3. Increase `REV` in `index.html`, then push to `main`.

## Tools
- `tools/pcb-viewer/` — PCB Viewer. Opens a project folder (IPC-2581 `.cvg`, BOM `.xlsx`/`.csv`,
  TOP/BOT images) in the browser. Files are read in memory only; the page CSP blocks all network
  requests. Board project files must never be committed: `.gitignore` blocks `*.cvg`, `*.xlsx`,
  `*.xls`, `*.xlsm`, and `Reference Project Folder/`.

## Preview locally
`python -m http.server 5517`, then open http://localhost:5517
