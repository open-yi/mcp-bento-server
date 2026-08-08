---
name: bento-slides
description: Create, edit and refine Bento decks (self-contained single-file PPT, .bento.html) via the bento-mcp CLI — add slides, morph transitions, charts, tables and themes; watch the live browser preview update; self-check quality programmatically with validate/measure. Use when the user asks to make a presentation, slides, deck, or work with .bento.html files.
---

# bento-slides

Drive Bento (the PowerPoint alternative that fits in a file) through the
`bento-mcp` CLI. Every edit is pushed over WebSocket to the browser tab, which
reloads automatically — the user watches the live preview while you work.

## Setup

The CLI is a single npm package (zero runtime deps):

```bash
npm i -g mcp-bento-server      # one-time install
```

If it is not installed yet, `npx -y mcp-bento-server <cmd>` works anywhere
Node 20+ is available (first run downloads the package).

## The loop that matters

**Always open the deck FIRST** — `open` (or `new`) auto-opens the browser tab,
so the user can watch the deck being built live:

```
1. npx -y mcp-bento-server open <file>      # browser auto-opens → user can see
2. npx -y mcp-bento-server add-slide '...'  # build ONE slide at a time
3. ask the user what they see               # the browser already updated
4. repeat — one slide per call, so every step is visible
5. npx -y mcp-bento-server validate         # programmatic self-check
```

**Build incrementally, never all at once** — one slide per `add-slide` call
(each new slide is auto-activated in the browser), then add its content piece
by piece so the user sees it being typed:

```
# 1. create the slide shell (auto-activates in the browser)
npx -y mcp-bento-server add-slide '{"id":"s4","transition":"morph","elements":[]}'

# 2. fill it element by element — each call is visible instantly
npx -y mcp-bento-server patch '{"createElements":[{"slideId":"s4","element":{...title...}}]}'
npx -y mcp-bento-server patch '{"createElements":[{"slideId":"s4","element":{...chart...}}]}'

# 3. grow long text in steps for a typing feel
npx -y mcp-bento-server patch '{"updateElements":[{"slideId":"s4","id":"t1","set":{"html":"Revenue up"}}]}'
npx -y mcp-bento-server patch '{"updateElements":[{"slideId":"s4","id":"t1","set":{"html":"Revenue up 42%"}}]}'
```

Do NOT build the whole deck in one big JSON dump: big payloads hit
command-line length limits and hide the process from the user.

**Large JSON → use a file.** For big ops or full imports, write the JSON to a
file and pass it:

```bash
npx -y mcp-bento-server patch @ops.json
npx -y mcp-bento-server patch ops.json     # file path works too
npx -y mcp-bento-server import-json deck.json
```

The user's browser at http://127.0.0.1:3900/ is the live preview. The browser
tab also runs `window.bento.validate()` and posts the report back, so
`npx -y mcp-bento-server validate` works even for models without vision.

## CLI quick reference

| Task | Command |
|---|---|
| Open / create | `npx -y mcp-bento-server open <file.bento.html>` · `npx -y mcp-bento-server new --title "X" --out f.bento.html` — both auto-open the browser |
| Read | `npx -y mcp-bento-server read` · `npx -y mcp-bento-server slides` · `npx -y mcp-bento-server get <slide-id>` · `npx -y mcp-bento-server describe` |
| Edit | `npx -y mcp-bento-server patch '<ops json>'` · `patch @ops.json` · `add-slide '<slide json>'` · `update-slide <id> '<set json>'` · `delete-slide <id>` · `duplicate-slide <id>` |
| Style | `npx -y mcp-bento-server set-theme '{"background":"#101418"}'` · `npx -y mcp-bento-server set-title "..."` |
| Save | `npx -y mcp-bento-server save` (writes the doc into the file) |
| Quality | `npx -y mcp-bento-server validate` · `npx -y mcp-bento-server measure '{"html":"...","w":600,"fontSize":28}'` |
| JSON round-trip | `npx -y mcp-bento-server export-json --out doc.json` · `npx -y mcp-bento-server import-json doc.json` |
| Server | `npx -y mcp-bento-server status` · `npx -y mcp-bento-server start` · `npx -y mcp-bento-server stop` |

## Patch ops (the core editing surface)

```json
{
  "createElements": [{ "slideId": "s1", "element": { "id": "t1", "type": "text", "x": 96, "y": 200, "w": 500, "h": 80, "html": "Hello", "fontSize": 60, "fontWeight": 800, "color": "#F2F0EA" } }],
  "updateElements": [{ "slideId": "s1", "id": "t1", "set": { "html": "Hello world" } }],
  "deleteElements": [{ "slideId": "s1", "id": "t1" }],
  "addSlides": [{ "id": "s2", "transition": "morph", "elements": [] }],
  "updateSlides": [{ "id": "s2", "set": { "notes": "..." } }],
  "deleteSlides": ["s3"],
  "duplicateSlide": { "id": "s1", "newId": "s1-copy" },
  "setTheme": { "accent": "#FF9E8A" },
  "setTitle": "New title"
}
```

## Element types (shared fields: id, x, y, w, h, rotation, opacity)

- **text**: `html` (inline `<b> <i> <br>` ok), `fontSize`, `fontFamily`, `fontWeight`, `color`, `align` (left|center|right), `valign`, `lineHeight`
- **shape**: `shape` = rect|ellipse|triangle|arrow|line|path, `fill`, `stroke`, `strokeWidth`, `radius`
- **image**: `src` = data URI or `"asset:<key>"` into `doc.assets`, `fit` = cover|contain|fill
- **chart**: `preset` = bar|line|pie|scatter, `option` = ECharts-shaped JSON (bar/line series data must be plain numbers; pie takes {name,value})
- **table**: `columns` [{w}], `rows` [{cells:[{html}]}], `header`, `style` {...}
- **media**: `kind` = video|audio, `src` = data URI | URL | "asset:<key>", flags: controls/autoplay/loop/muted

## Rules that make decks feel designed

- **Morph = shared ids.** Slides with `"transition":"morph"` tween elements
  whose `id` matches the previous slide (position, size, color). Carry 2–4 ids
  through the deck; `duplicate-slide` keeps ids so the morph just works.
- **Entrances**: `fx: { enter: "fade-up", order: 0 }`. On a morph slide, an
  element WITH a partner morphs (no entrance); without a partner it gets a
  default fade-and-rise.
- **Ken-burns**: `fx: { ambient: "kenburns", ken: { dir: "drift|out|in", scale: 1.08, duration: 20 } }` for hero photos (image 0,0,1280,720 + scrim rect + text).
- **Numbers count up**: `fx: { countUp: true }`.
- **State slides**: slide with `stateOf: "<parent-id>"` is a hidden variant reached only by element `link` clicks.
- **Layout guardrails**: canvas 1280×720, keep 96px side margins (content band 1088px wide: 2 col → 528px @ x=96/656, 3 col → 340px @ x=96/470/844, 4 col → 254px @ x=96/374/652/930).
- **`size` and `theme` (incl. `fontFamily`) are required** — the app will not boot without them.
- Never invent property names — unknown keys are ignored silently.

## Quality workflow (no vision required)

1. `npx -y mcp-bento-server validate` — official self-check: text overflow, off-canvas
   elements, broken links, duplicate ids, morph collisions, chart config
   errors. Filter `findings` for `severity: "error"` first.
2. `npx -y mcp-bento-server measure '{"html":"...","w":600,"fontSize":28}'` — size text
   BEFORE placing it so it never overflows.
3. Ask the user about aesthetics — they see the live preview.

## Gotchas

- The `.bento.html` file on disk stays pristine; the bridge script is injected
  only when the server serves the page.
- `docId` is the document's identity — never regenerate it.
- Escape every `<` in JSON as `\u003c` when writing the file block manually.
- The browser tab must be open for `validate` / `measure` to work
  (they run in the frontend, like screenshots in other tools).
