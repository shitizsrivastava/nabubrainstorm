# NabuBrainstorm — Claude Context

## What this app is
Electron 29 desktop app: a visual brainstorm board where you place text, images, PDFs, videos, sound, sticky notes, quotes, and links on a canvas, connect them with bezier wires, annotate images, and export PNG.

## Deploy pipeline (ALWAYS use this)
```powershell
& "C:\Users\pc\Desktop\MY apps\NabuBrainstorm\deploy.ps1"
```
Stops the running app, copies source files into the Electron build, repacks `app.asar`, relaunches.
**Both** copy and repack are required — this Electron build loads `app.asar` with priority over the `app/` folder.

Files deployed: `board.html`, `main.js`, `preload.js`, `package.json`
Build location: `NabuBrainstorm-win32-x64\resources\`
Source of truth: `app.asar` (NOT the `app/` folder)

## Version / build stamp
- `APP_VERSION` constant in board.html (bump by hand on releases); also mirrored in `package.json`.
- `BUILD_DATE` is the literal token `__BUILD_DATE__` in source — deploy.ps1 replaces it with the
  current `yyyy-MM-dd` in the deployed build copy only (source keeps the token). Shown as a `v1.1.0`
  badge next to the titlebar logo (`#verBadge`, hover for date) and in the Help panel footer (`#helpVer`).
  So "last updated" is auto-accurate every deploy — no manual date edits.

## File structure
```
NabuBrainstorm\
  board.html           — all UI, state, rendering (~2160 lines)
  main.js              — Electron main process, all IPC handlers (~282 lines)
  preload.js           — contextBridge (window.nabu.*) (~41 lines)
  deploy.ps1           — deploy script
  CLAUDE.md            — this file
  PROJECT_STRUCTURE.md — detailed function/CSS/data reference
  NabuBrainstorm-win32-x64\   — built Electron app (don't edit directly)
    resources\
      app.asar         — packed source (what Electron actually runs)
      app\             — unpacked copy (also updated by deploy.ps1)
```

## Architecture
- **Renderer**: single `board.html` — no framework, vanilla JS + CSS
- **IPC**: `preload.js` exposes `window.nabu.*` API via `contextBridge`
- **Security**: `contextIsolation: true`, `webSecurity: false` (needed for local `file://` URLs)
- **Canvas**: CSS transform (`translate + scale`) on a 5000×4000 px div
- **Connectors**: SVG layer (`pointer-events:none`), cubic bezier paths, `pointer-events:stroke` for hit testing

## Key state variables (board.html ~line 494)
```js
let board = { title, elements[], connectors[] };
let filePath = null;
let vpX=0, vpY=0, vpZ=1;              // viewport pan/zoom
let spaceHeld=false, spacePanned=false;
let selectedId=null, editingId=null;
let selectedIds=new Set();             // multi-select (lasso)
let selectedConnId=null;
let connDrag=null;   // { fromId, fromPort, x1,y1, x2,y2, snapTarget }
let wpDrag=null;     // { connId, pending, sx,sy }
let drag=null;       // { id, ids, offsets, ox,oy, sx,sy, moved, curX,curY }
let resize=null;     // { id, dir, x0,y0, w0,h0, ratio }
let pendCreate=null; // { x,y,sx,sy }
let lasso=null;      // { x0,y0 }
let annotMode=null;  // 'arrow'|'circle'|'text'|null
let annotDrawing=null;
let undoStack=[], redoStack=[];  // JSON strings of board.elements, cap 100
let searchMatches=[], searchIdx=0;
let serialsVisible=true;
let gridOn=true;
const GRID=20, SNAP=6;
```

## Element types
Each element in `board.elements[]`:
| type | key fields |
|------|-----------|
| `text` | `el.text`, `el.w` |
| `quote` | `el.text`, `el.w` |
| `sticky` | `el.text`, `el.w` |
| `image` | `el.src` (base64 JPEG data URL), `el.w`, `el.h`, `el.annotations[]` |
| `video` | `el.path` (Windows path), `el.name`, `el.w` |
| `pdf` | `el.path`, `el.name` |
| `sound` | `el.path`, `el.name` |
| `link` | `el.url`, `el.name` |

All elements also: `el.id` (uid), `el.x`, `el.y`, `el.serial` (1-based), `el.color?`, `el.notes?` (presenter commentary, see below)

## Connector schema (board.connectors[])
```js
{ id, fromId, toId, fromPort?, toPort?, label?, unit?, waypoint?:{x,y} }
// ports: 'n'|'s'|'e'|'w'
```

## Grouping (~line 2250, 2370)
A flat, persistent peer set — deliberately a different data model from the parent/child
sub-asset attachments below. `el.groupId` (shared uid string) is the only persisted field.
- `groupMembers(gid)` / `currentFullGroupId()` — the latter returns a groupId only when
  `selectedIds` is *exactly* one whole group (no more, no less); a lasso that catches only
  some of a group, or a mix of grouped/ungrouped elements, intentionally doesn't count, so the
  bounding-box outline/resize handles only ever appear for a "clean" group selection.
- **Selecting a group**: `selectGroupIds(ids, primaryId)` mirrors `selectEl()`'s DOM-toggle
  approach (see Selection section above) instead of calling `render()`, for the same reason —
  this runs from a mousedown/contextmenu handler, and replacing nodes mid-gesture breaks
  click/dblclick synthesis. Both the mousedown handler and the `contextmenu` listener check
  `el.groupId` and route into `selectGroupIds()` with every member instead of a plain
  `selectEl()`, but only when the clicked element **isn't already** part of the current
  selection (`!selectedIds.has(id)`) — clicking within an existing multi-selection (lasso or
  group) preserves it untouched, matching the pre-existing mousedown convention. Lasso-select
  does the same expansion after the fact: any group caught partially by the rubber-band pulls
  in its remaining members before finalizing `selectedIds`.
- **Move together**: needs no group-specific code at all — `drag.ids` (populated from
  `selectedIds`) already moves every selected element in lockstep; since `selectGroupIds()`
  populates `selectedIds` with the whole group, dragging any member drags all of them for free.
- **Delete together**: same story — `deleteSel()` already bulk-deletes everything in
  `selectedIds`. This surfaced a real (pre-existing, unrelated to grouping) bug while wiring it
  up: the `Delete`/`Backspace` keydown handler only checked `if (selectedId)`, never
  `selectedIds`, so a multi-element selection with no single "primary" id (which is exactly
  what both lasso-select-2+ and `selectGroupIds()` produce) silently ate the keypress. Fixed by
  widening the guard to `if (selectedId || selectedIds.size>0)`.
- **Group resize**: dragging a corner of the dashed bounding box (`.group-rz`, handled in the
  same mousedown/mousemove/mouseup listeners as normal per-element resize, via a parallel
  `groupResize` state var) derives one **uniform** scale factor from the width drag only —
  mirroring how single-element diagonal-handle resize already derives height from width via a
  locked `ratio` — then applies that same scale to every member's `x`/`y` (relative to the
  group's own top-left) and to `w`/`h` where those fields exist. Deliberately uniform rather
  than independent x/y stretch: it keeps each member's own aspect ratio intact as a side effect,
  with no per-type special-casing needed. Individual members' own `.rz` handles are hidden while
  a full group is selected (`body.group-active .el.sel .rz{display:none}`) so there's only ever
  one set of resize handles to grab.
- **Visual**: `updateGroupOutline()` draws a dashed cyan `.group-outline` box + 4 `.group-rz`
  corner handles straight into `#canvas`, like the lasso/guide overlays — meaning it must be
  torn down and redrawn after every `render()` (which replaces canvas's entire innerHTML); hooked
  into `render()` itself, plus called directly from `selectGroupIds()` and the drag/resize
  mousemove handlers, since those deliberately skip `render()`.

## Asset attachments / sub-assets (~line 569)
A second relationship system, separate from `board.connectors` wires. Lets you mark one asset
as logically "belonging to" another (e.g. a source link or PDF belongs to a photo) while keeping
both fully visible and independently usable — unlike wires, this is a parent/child tree relationship,
not a peer-to-peer link, and it is drawn in **purple**, never gold, so it reads as a different kind
of connection at a glance.
- `el.attachments` — array of child element ids, set on the "host" (parent)
- `el.hostId` — set on the child, pointing at its host. The child still renders normally at full
  size at its own `x`/`y` (NOT hidden) — `render()` just tags its wrapper with an extra
  `.el-subasset` class (via string-replace on the `elHtml()` output, so no per-type branch needed)
- **Attach**: hold **Alt** while dragging one element onto another, then drop — plain
  dragging/overlapping (no Alt) NEVER attaches, it only repositions. While Alt is held mid-drag,
  the would-be host gets a dashed purple outline (`.attach-target-hover`). `findAttachTarget()`
  finds the smallest element whose bounds contain the drop point; `attachAsset(childId, hostId)`
  records the relationship and repositions the child just beside its host (stacked vertically if
  there are several) so it stays fully visible, not stacked exactly on top
- **Tether line**: `attachTetherInnerHtml()` draws a dashed purple bezier (`stroke-dasharray`,
  `#9B59B6`, arrow marker `#arr-purple`) from host to child in the same SVG layer as connectors
  (`connSvgHtml()` / `refreshConnSvg()` both call it). A wide invisible `.tether-hit` path makes it
  easy to click
- **Select / detach**: clicking a tether sets `selectedTetherId`; Delete/Backspace calls
  `detachAsset()`. Right-click a sub-asset → context menu also has "🔗 Detach from parent"
- **Hover/selection color**: `.el-subasset:hover` / `.el.el-subasset.sel` use a purple outline
  (`#9B59B6`) instead of the default gold (`#B8860B`) so a sub-asset is visually distinct even
  without looking at its tether
- **Delete cascade**: deleting a host does NOT delete its children — `unattachChildrenOf()` in
  `deleteSel()` just clears their `hostId` so they remain as normal independent elements
- **Numbering**: a sub-asset's serial badge does NOT show its own standalone `el.serial` — `elHtml()`
  computes a dotted label `"{host.serial}.{index}"` (e.g. `1.1`, `1.2`) from its position in
  `host.attachments`, styled in purple (`.serial-badge-sub`) and not click-to-renumber (that's only
  for top-level `el.serial` via `clickSerial()`/`renumberEl()`)

## Save system (.brb files)
- **Autosave**: 30s debounce (`markDirty`) + 1 min interval → `Documents\NabuBrainstorm\Autosaves\` (cap 30)
- **Manual save**: Ctrl+S or Save button → `Documents\NabuBrainstorm\Saved\` (cap 10)
- **Filename**: `BoardTitle_2026-06-14_14-30_autosave.brb` / `BoardTitle_2026-06-14_14-30.brb`
- **Last file**: stored in `%APPDATA%\NabuBrainstorm\nabu-config.json`, loaded on startup
- **Custom save folder**: user can change via Restore panel
- **Cross-board search**: `#restoreSearch` input filters `renderRestoreList()` by substring match
  on filename (case-insensitive) — since filenames embed the board title, this is effectively a
  board-title search. Filter (`_restoreFilter`) persists across `switchRestoreTab()` so a search
  term stays applied when you check both Manual Saves and Autosaves, but resets each time
  `openRestorePanel()` runs. **Row buttons key off `data-filepath`, not array index** — `restoreFile(fp)`
  finds the entry by `filePath` rather than indexing into `_restoreData.saved`/`.autosaves`, because
  once the list is filtered, a rendered row's position no longer matches its index in the full array.

## Render pipeline
- `render()` — full innerHTML re-render: `connSvgHtml() + board.elements.map(elHtml).join('')`
- `elHtml(el)` — returns HTML string for one element (switch on `el.type`)
- `refreshConnSvg()` — re-render SVG only (used during wire drag for perf)
- `markDirty()` — sets save indicator + triggers autosave debounce

## Element rendering (elHtml ~line 805)
Render priority (first match wins):
1. `sticky` → `.el-sticky` + `.sticky-body[contenteditable]`
2. `text`/`quote` → `.el-text`/`.el-quote` + `.el-body[contenteditable]`
3. `image` → `.el-image` + `<img src=base64>` + annotation SVG + 8 resize handles
4. `video` → `.el-video-card` + `<video preload=metadata muted>` + label bar + 4 resize handles
5. `sound` → `.el-audio-card` + animated bar visualization
6. `pdf` → `.el-pdf-card` + icon + name
7. **fallback** (link, etc.) → `.el-chip.chip-{type}` with icon + name/url

Every element gets: serial badge (`.serial-badge`), add-above button (`.el-add`), 4 port handles (`.port-handle.port-{n|s|e|w}`), color toggle dot (`.color-toggle-dot`)

## Selection & double-click editing
`selectEl(id)` toggles the `.sel` class **directly on the existing DOM node** instead of calling
`render()` for ordinary single-selection changes. This matters: `render()` replaces every `.el`
node in the DOM, and if the clicked element's own mousedown handler triggers a selection change,
that same node gets yanked out from under the gesture before `mouseup`/`click` fire — which
silently breaks the browser's native `click`/`dblclick` event synthesis. Double-click-to-edit is
therefore implemented as manual click counting (`_dblId`/`_dblT` module state, 380ms window), not
a native `dblclick` listener, specifically because a real `dblclick` never had a stable node to
fire on. `selectEl()` finds "what was previously selected" by querying `document.querySelectorAll('.el.sel')`
rather than tracking a `prevId` variable, since callers like the mousedown handler often clear
`selectedIds` *before* calling `selectEl()`, making that Set unreliable for detecting a
multi-select → single-select transition. Falls back to a full `render()` only if the target id's
node doesn't exist yet (brand-new element).

## Color tagging (~line 1650, 1693)
- `el.color` (hex string) is the only persisted field; the 5 swatches in `#colorBar` call `setColor(c)`.
- `colorRingStyle(el)` returns a `box-shadow:0 0 0 4px {color}` inline style, applied uniformly
  across every element type in `elHtml()` (including images, which previously had no color support).
  Deliberately uses `box-shadow` instead of `outline`/`border`: `.el.sel{outline:none!important}`
  (added during an earlier visual-polish pass) permanently wins over any inline `outline`, so
  anything relying on `outline` for its color ring goes invisible the instant the element is
  selected, no matter how it's set. `colorRingStyle` takes only `el`, not a selection flag — it
  must stay selection-independent, since `selectEl()` (above) no longer always triggers a
  `render()`, so a selection-dependent inline style would go stale until some unrelated action
  forced a re-render.
- **`#colorBar` visibility**: `updateColorBar()` shows/positions the bar for the current single
  selection; `_colorBarHiddenId` + `toggleColorBar(id)` (wired to the `.color-toggle-dot` 🎨 icon
  in the element's corner) let the user manually dismiss the bar without clearing the color itself.
  `selectEl()` resets `_colorBarHiddenId = null` whenever the selected id actually changes, so a
  dismissed bar stays hidden only for that one element — selecting anything else always shows its
  bar fresh. The `✕` swatch (`setColor(null);selectEl(null)`) is a separate, older "clear color and
  close" action and is unaffected by the hide/show toggle.

## Alignment guides & resize snapping (~line 2545)
- `otherRects(excludeId)` — canvas-space `{x,y,w,h}` for every element except the one being
  moved/resized, shared by both drag and resize snapping so they behave identically.
- `applySnap(id, x, y)` (drag) and `applyResizeSnap(id, dir, x, y, w, h)` (resize) both compare
  the moving element's left/center/right (and top/center/bottom) against every sibling's, within
  `SNAP` (6px) tolerance, and return the corrected coordinate plus a bounded guide descriptor. Falls
  back to `GRID` snapping when nothing aligns.
- **Diagonal resize handles keep their locked aspect ratio** (`ratio = h0/w0`, only set at resize
  start) — `applyResizeSnap` deliberately only snaps the horizontal edge for `se`/`sw`/`ne`/`nw`
  (checked via `dir.includes('e'|'w')`), never the vertical one (checked via **exact** `dir==='s'|'n'`,
  not `includes`, since `'se'.includes('s')` is also true and would otherwise fight the ratio lock).
  The resize mousemove handler recomputes `h = Math.round(w*ratio)` itself after any horizontal
  snap changes `w`, exactly like the un-snapped path already did.
- `showGuides(gs)` bounds each guide line to the span between the moving element and whichever
  sibling it matched (±16px overhang), Figma-style, rather than drawing across the whole canvas —
  makes it obvious *which* element you're aligned with. `clearGuides()` removes them; called on
  every `mouseup` for both drag and resize.

## Micro-animations
- **Element spawn-in**: `spawnAnim(id)` adds `.spawn-in` (`elSpawn` keyframe: fade + scale-up from
  0.88, ~220ms) to a freshly-created element's node. Every element-creation call site must call it
  explicitly right after its own `render()` — there's no central hook, since nodes only exist once
  `render()` has run. When adding a new creation path, grep for `spawnAnim(` call sites to match the
  existing pattern rather than relying on `render()` to trigger it automatically.
- **Wire draw-in**: `connSpawnAnim(id)` (called right after a new connector is pushed + rendered)
  measures the new `<path>`'s real `getTotalLength()` — bezier length varies a lot with port
  distance, so a fixed dasharray would either gap or under-fill — sets `stroke-dasharray`/
  `stroke-dashoffset` to that length with transitions off, forces a reflow, then transitions
  `stroke-dashoffset` to 0 over 280ms and clears the inline styles afterward (harmless to leave
  them, but keeps `render()`'s next rebuild starting from a clean node).

## Connector system (~line 578)
- `portPos(el, port, node)` — canvas coords of N/S/E/W port dot
- `nearestPort(el, p)` — which of 4 ports is closest to canvas point
- `bestPorts(fromEl, toEl)` — auto-pick best port pair based on relative position
- `connCtrl(a, fp, b, tp, bend)` — bezier control points; ctrl capped `min(max(28, dist*0.25), 90)`
- `connPath(a, fp, b, tp, bend)` — SVG path string `M…C…`
- `connPathThrough(a, w, b)` — S-curve through waypoint
- `connGeom(c, ci)` — single source of truth: returns `{a, b, fp, tp, bend, path, mid}`
- Parallel wires between same pair get alternating bend offsets

Wire UI: 16px invisible hit area (`.conn-hit`) + 2px visible path (`.conn-path`) + label FO + unit FO + reshape circle + tools cluster FO (when selected)

## Quick Look / Preview modal (~line 1472)
`quickLook(el)` opens `#previewBg`:
- `image` → `<img>` fullscreen
- `video` → `<video controls autoplay>` + fallback "Open in system player"
- `pdf` → `<embed type="application/pdf">` + fallback button
- `sound` → `<audio controls autoplay>` + 🎵 icon
- `text/quote/sticky` → styled text display
- `link` → URL display + "Open in browser" button

## Image annotations (~line 1576)
`el.annotations[]` per image:
```js
{ type:'arrow', x1,y1,x2,y2 }      // % of image dimensions
{ type:'circle', cx,cy,rx,ry }
{ type:'text', x,y, text }
```
Toolbar: `.annot-bar` floats below selected image; `annotMode` state; drawn on `<svg class="annot-svg">` overlay.

## Rich text in notes (text/quote/sticky)
Lightweight markdown kept as **plain text** in `el.text` — no HTML storage, no sanitization
needed, stays portable in the JSON save file.
- **Syntax**: `**bold**`, `*italic*`, and a line starting with `☐ ` (unchecked) or `☑ ` (checked)
  becomes a checklist item.
- **Rendering**: `mdToHtml(text, elId)` (board.html ~line 928) converts this to styled markup —
  only called for *display*; while `editingId === el.id` the raw markdown/glyphs show as literal
  text in the contenteditable, standard "edit source, view rendered" split. `esc()` runs first, so
  this is XSS-safe regardless of what's typed.
- **Toolbar**: `.fmt-bar` (`updateFmtBar()`) shows only while editing a text/quote/sticky, positioned
  like `.color-bar`/`.annot-bar`. `fmtWrap('**'|'*')` wraps the current selection via
  `execCommand('insertText', ...)`, or — if nothing's selected — inserts an empty pair and walks the
  caret back between them so typing continues inside the span. Buttons use
  `onmousedown="event.preventDefault()"` so clicking them doesn't blur/collapse the text selection
  first. `fmtChecklist()` walks up from the caret to the nearest block-level child of the editable
  body (Chromium wraps each physical Enter-created line in its own `<div>`) and prepends `☐ ` to
  *that* line only.
- **Checklist toggle in display mode**: each `.ck-box` span carries its own
  `onclick="toggleChecklistLine(id, lineIndex)"` (with `onmousedown` stopPropagation so it doesn't
  trigger drag/select on the parent `.el`) — flips the glyph on that one line of `el.text`,
  `pushHistory()`+`markDirty()`+`render()`, same as any other discrete click action (unlike normal
  typing, which is deliberately not undo-tracked per keystroke, matching `onBody()`'s existing
  behavior).
- **Gotcha already fixed while building this**: `nodeOf(id)` returns the `.el` wrapper, not the
  editable body — grab `.el-body, .sticky-body` inside it (see `fmtBody()`), otherwise `.innerText`
  picks up the serial badge text too.

## IPC handlers (main.js → preload.js → window.nabu.*)
| IPC channel | `window.nabu.*` | Description |
|------------|-----------------|-------------|
| `board-new` | `boardNew()` | blank board |
| `board-save-auto` | `boardSaveAuto(payload)` | autosave to Autosaves/ |
| `board-save-user` | `boardSaveUser(payload)` | manual save to Saved/ |
| `board-save` | `boardSave(payload)` | legacy inline save |
| `board-open` | `boardOpen(filePath)` | open dialog or load path |
| `get-last-file` | `getLastFile()` | last opened/autosaved file |
| `list-saves` | `listSaves()` | list both save folders |
| `open-folder` | `openFolder(p)` | open folder in Explorer |
| `get-save-dirs` | `getSaveDirs()` | current save dir paths |
| `set-save-dir` | `setSaveDir()` | pick new save root folder |
| `reset-save-dir` | `resetSaveDir()` | revert to default save location |
| `read-image-file` | `readImageFile(fp)` | returns base64 data URL |
| `pick-image-folder` | `pickImageFolder()` | folder picker for images |
| `pick-asset-file` | `pickAssetFile({extensions,multi})` | file picker dialog |
| `open-file` | `openFile(fp)` | shell.openPath |
| `open-external` | `openExternal(url)` | shell.openExternal |
| `export-png` | `exportPng({title})` | capturePage() → save PNG |
| `get-version` | `getVersion()` | app.getVersion() |
| `win-minimize` | `minimize()` | minimize window |
| `win-maximize` | `maximize()` | maximize/unmaximize |
| `win-close` | `close()` | close window |
| `set-fullscreen` | `setFullScreen(on)` | fullscreen mode |

## Mouse / keyboard shortcuts
| Input | Action |
|-------|--------|
| `Alt + Click` empty canvas | Create text box |
| `Alt + Drag` element onto another | Attach as sub-asset (📎 badge) |
| `Space + drag` | Pan |
| `Space` tap (element selected) | Quick Look preview |
| `Tab` | Open insert menu |
| `Ctrl+S` | Save |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+F` | Search |
| `Del` / `Backspace` | Delete selected element or wire |
| `Esc` | Deselect / close overlay |
| `Dbl-click` text/quote/sticky | Edit inline |
| `Dbl-click` video/sound/pdf | Open Quick Look preview |
| `Dbl-click` link | Open in browser |
| `Drag` gold port dot | Draw connector wire |
| `Click` wire → `Drag` | Bend wire (add waypoint) |
| `Middle-click drag` | Pan |
| `Ctrl+Scroll` | Zoom |
| `Drag` empty canvas | Lasso select |
| `Right-click` element | Context menu |
| `F10` | Capture mode — hides all UI chrome (`body.capture-mode`) for OBS window capture |
| `F9` | Presentation step mode — glides camera between top-level elements in serial order (`←`/`→`/`PgUp`/`PgDn` step, `Esc` exits, HUD shows `n / total`) |

## OBS transparent overlay (`?obs=1`)
Real-alpha live overlay for OBS Browser Sources — the user's "live transparent PNG".
- **URL**: `http://127.0.0.1:41414/board.html?obs=1` (server prefers stable ports 41414–41419,
  falls back to random; "Copy OBS overlay link" button in Help → Features uses `location.origin`)
- **main.js**: `handleObsRoutes()` — `/obs-events` (SSE, replays last message per type to new
  clients), `/obs-state` (POST relay from main window), `/media?p=` (streams local media files
  because OBS's CEF can't load `file://`; 127.0.0.1-only)
- **board.html**: `obsView` flag (query param `obs`) → `setupObsView()` — subscribes to SSE,
  applies 4 message types: `board` (full re-render, debounced 200ms from `render()`/`markDirty`),
  `vp` (viewport remapped to overlay's own window size, ~30fps from `applyVP()`), `pos`
  (position-only updates during drags, ~20fps from `refreshConnSvg()`, no re-render), `focus`
  (presentation glow, from `presentStep()`/`togglePresent()`)
- Overlay is read-only: `body.obs-view` CSS hides all chrome + `pointer-events:none`, keydown/paste
  handlers early-return, `init()` branches before any `window.nabu` call (undefined in OBS's CEF)
- `toFileUrl()` returns `/media?p=` URLs in obsView so video/sound cards work
- `toast(m, force)` — toasts are suppressed while `capture-mode` is active unless forced

## Presenter Notes window (`?notes=1`)
PowerPoint-style speaker notes — a genuinely separate OS window (own title "NabuBrainstorm —
Presenter Notes", normal frame) so an OBS Window Capture of the board never picks it up.
- **Data**: `el.notes` (string) on any element, edited via right-click → "🗒 Commentary…"
  (`openNotesEditor()`/`saveNotesEditor()`, `#notesEditBg` modal). Saved with the board like any
  other field — no schema migration needed, just guard `el.notes || ''`.
- **Opening**: toolbar "🗒 Notes" button → `openNotesWindow()` → `window.nabu.openNotesWindow()` →
  `open-notes-window` IPC handler in main.js creates/focuses a `BrowserWindow` loading
  `board.html?notes=1` from the same local server.
- **Sync**: reuses the OBS overlay's SSE relay (`/obs-events`/`/obs-state`) — no separate channel.
  `setupNotesView()` subscribes and applies `board` (element mirror) and `focus` (which element to
  show) messages. `selectEl()` now also sends a `focus` message (guarded by `!presentOn` so it
  doesn't fight presentation stepping), so plain clicking — not just F9 presenting — updates the
  notes window.
- **Render**: `renderNotesView()` draws the *entire* rundown at once via `nvRundownItems()`
  (`presentEls()` order, 1..N, with each top-level point's sub-assets — see attachments above —
  interleaved right after it as 1.1/1.2 using `.nv-child`), not just the current point — every
  point's label + commentary is always visible in `#nvList`, with the one matching `_notesFocusId`
  getting `.nv-item.active` (bold, full opacity, gold/purple badge) and `scrollIntoView({block:'center'})`;
  everything else stays dimmed (`opacity:0.55`) but readable. This is what makes stepping with F9's
  arrow keys feel like scrolling a script, not flipping slides. Sub-assets can't hold their own
  sub-assets (`findAttachTarget` refuses any element that already has a `hostId`), so labels never
  go deeper than one dot — there's no 1.1.2. `#nvEmpty` only shows when there are zero serialed
  elements at all; otherwise the list always renders even with nothing focused yet (browsing mode,
  nothing highlighted).
- **Appearance controls**: `.nv-toolbar` (theme, font family, font size ± ) — `nvToggleTheme()`/
  `nvSetFont()`/`nvBumpScale()` write to `localStorage['nabuNotesPrefs']` and reapply via
  `nvApplyPrefs()`, which is also called on `setupNotesView()` init so preferences survive
  reopening the window. Light theme is `body.notes-view.nv-light`; font/size are CSS vars
  (`--nv-font`, `--nv-scale`) consumed by `.nv-item-body`'s `font-size:calc(…* var(--nv-scale))`.
- **Log vs Edit mode**: `nvEditMode` (in-memory only, never persisted — always opens in read-only
  Log mode so a stray click never turns the window editable mid-presentation). `nvToggleEditMode()`
  flips it and re-renders; in Edit mode `renderNotesView()` swaps each `.nv-item-body` div for a
  `<textarea class="nv-edit-area">`. Typing calls `nvScheduleEditSave(id, value)` — updates the
  local `board.elements` mirror immediately, then debounces 600ms before calling
  `nvFlushEditSave(id, value)`, which sends `window.nabu.sendNotesEdit({id, notes})`. Blur flushes
  immediately regardless of the debounce timer. That IPC call (`notes-edit` channel, preload.js +
  `ipcMain.on('notes-edit', ...)` in main.js) is a **separate one-way channel from the board window
  to the notes window back to the board window** — deliberately not routed through the `/obs-state`
  HTTP relay, since that relay is one-way (board → overlays) by design. The board window's `init()`
  registers `window.nabu.onNotesEdit(...)`, which applies the edit exactly like `saveNotesEditor()`
  (`pushHistory`, `markDirty`, `render`, `obsPushBoard()` to echo the change back out to the notes
  window and any OBS overlay). **Focus guard**: `renderNotesView()` bails out immediately if
  `document.activeElement` is a `.nv-edit-area` — otherwise the SSE echo from your own edit (or any
  other board change) would rebuild the list mid-keystroke and drop focus/cursor.
- **Read-only**: `notesView` flag guards the same spots as `obsView` (keydown, paste) — it never
  calls `selectEl()` itself, so there's no feedback loop.
- Elements with notes get a small teal `.notes-dot` next to their serial badge (built into the `SN`
  string so every element branch in `elHtml()` gets it for free).

## In-app Help panel (`#shortcutsBg`)
Toolbar "❓ Help" button / `F1` opens a two-tab modal: **Shortcuts** (grid of `.sc-group`
blocks) and **Features** (stacked `.ft-item` guide covering paste-as-image, capture mode,
presentation mode, attachments, etc.). `helpTab('sc'|'ft')` switches panes.
**When adding a user-facing feature or shortcut, update this panel too.**

## Viewport animation
`setVPTarget(x, y, z, k)` lerps `vpX/vpY/vpZ` toward a clamped target each rAF frame
(time-based decay, so dropped frames don't slow the glide). Used by Ctrl+scroll zoom
(retargets mid-flight so fast scrolling accumulates on the target), search focus, minimap
click, and presentation mode (`k=0.09` slow cinematic glide, default `0.28`). Code that
sets `vpX/vpY/vpZ` directly (pan drag, scroll-pan, export tiling) calls `cancelVPAnim()` first.

## Export PNG (~line 1799)
`exportPng()` — fits all elements in viewport, adds `body.exporting` class (hides toolbar/minimap/dot grid/port handles/serials via CSS), waits 150ms, calls `window.nabu.exportPng()`, restores viewport.

## Templates (`TEMPLATES` array, ~line 3146)
Each entry is `{ name, desc, elements:[{type,x,y,w,text,color?}, ...] }` — plain element specs
(no `id`/`serial`, those get assigned on apply). `applyTpl(i)` maps in fresh `uid()`s and calls
`renumberTopLevel()`, which assigns serials 1..N in **array order** (its sort is stable and every
template element starts with no serial, so array order survives) — meaning every template must be
authored in the order you'd want to present it, since that authored order becomes the presentation
order the moment it's applied. `openTpl()` renders `.tpl-card`s into `#tplGrid` from this array; add
a new template by appending to `TEMPLATES` before the trailing `'Blank Board'` entry.

## Paste-as-image + web-clip source link (~line 1976)
Pasting rich content (Excel tables, formatted webpage selections — `looksRichPaste()` sniffs for
`<table>`, `<img>`, or 3+ `style=` attributes) rasterizes it client-side via an SVG
`<foreignObject>` → `<img>` → `<canvas>` pipeline (`rasterizeRichPaste()`), landing as a normal
JPEG image element through the same `addImageDataUrl()` every other image path uses.
- **`addImageDataUrl(dataUrl, stagger, onCreated)`** takes an optional third callback, invoked with
  the newly-created element once it's pushed and rendered. Added specifically so the paste handler
  can auto-attach a source link without every other call site needing to change.
- **Source link**: `extractSourceUrl(html)` does a best-effort scan of the pasted HTML fragment for
  the first `href="https?://..."` and, if found, `attachSourceLink(hostEl, url)` creates a `link`
  element and attaches it as a sub-asset (purple tether, dotted `1.1` label) under the pasted image.
  This is inherently hit-or-miss — we don't control a browser like Kosmik does to track page origin,
  we only see whatever happens to be in the clipboard fragment — so plain prose selections usually
  won't have a link to find, and the paste just proceeds without one.
- **Gotcha already fixed while building this**: creating a brand-new element and attaching it as a
  sub-asset *in the same step* needs **two `render()` calls** — one to give the new element a real
  DOM node (which `attachAsset()`'s positioning math and the tether-drawing code both look up via
  `nodeOf()`, not from `board.elements`), then `attachAsset()`, then a second `render()` so the
  tether can actually find both nodes. Skipping the first render silently drops the tether line on
  its very first paint (found by testing this, not by inspection).
- **Gotcha already fixed while building this**: `rasterizeRichPaste()` originally waited a
  `requestAnimationFrame` before measuring the staging div — `offsetWidth`/`offsetHeight` force
  layout synchronously on access regardless of paint timing, so that wait was pure risk with no
  benefit: rAF callbacks are paused for hidden/unfocused pages, so a paste timed with the window not
  focused could hang the whole promise forever. Now measured synchronously, immune to that.

## Offline "smart" helpers (Stats panel, ~line 3838)
Deliberately **not** real AI — no network call, no API key, no cost. The user explicitly chose
this over an LLM-backed assist feature (personal use only, didn't want an ongoing API bill), so if
anyone's ever tempted to wire this up to a real model later, that's a product decision to revisit
with them, not something to swap in quietly.
- **`topThemes(n)`**: tokenizes every element's text/name/url, strips the app's own `**`/`*`/`☐`/`☑`
  markdown glyphs first (otherwise checklist/bold markers pollute the word list), filters a small
  `STOPWORDS` set (includes `'video'` — deliberately, since almost every board is about a video and
  that word alone tells you nothing), and only surfaces words appearing **more than once** — a
  word seen exactly once isn't a "theme," it's noise. Rendered as `.theme-chip`s under a "Top words"
  divider in `updateStats()`; section is omitted entirely when nothing repeats.
- **`findDuplicateNotes()`**: normalizes each text/quote/sticky note's text (lowercase, strip
  markdown glyphs, collapse whitespace) and groups exact matches — skips anything under 6 chars
  after normalizing so trivial one-word notes don't false-positive against each other.
  **`toggleDuplicates()`** is a toggle, not a one-shot action: first click outlines every element in
  every duplicate group with `.dup-match` (blue outline, distinct from search's orange/gold and
  sub-assets' purple) and toasts a count; second click clears it. If there's nothing to find, it
  toasts that and resets `_dupHighlightOn` back to `false` so the button doesn't get stuck "on" with
  nothing highlighted.

## Common pitfalls
- After editing any source file, always run `deploy.ps1` — the app reads from `app.asar`
- `board.connectors` may be undefined on old saves — always guard with `|| []`
- `webSecurity:false` is intentional for local `file://` media (video/PDF/sound)
- Export PNG adds `body.exporting` class to hide UI chrome before capture
- Images stored as base64 JPEG (max 1400px, quality 0.9), displayed at initial max 360px
- `toFileUrl(p)` converts Windows backslash path to `file:///` forward-slash URL
- `link` type stores URL in `el.url`, NOT `el.text` (though `el.name` mirrors `el.url` on creation)
- `editingId` is separate from `selectedId`; must check both when handling keydowns
