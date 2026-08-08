# generate a cooler mcp-bento-server intro deck (marketing-grade)
import json

DOC = {
  "format": "bento/slides",
  "version": 1,
  "title": "mcp-bento-server — Install & Use",
  "size": {"width": 1280, "height": 720},
  "theme": {"background": "#0B0F17", "color": "#F2F0EA", "accent": "#FF9E8A", "fontFamily": "system-ui, sans-serif"},
  "slides": []
}

ACCENT  = "#FF9E8A"
ACCENT2 = "#7A5CFF"
TEXT    = "#F2F0EA"
MUTED   = "#9CA3AF"
DIM     = "#5A6B7C"
CODEBG  = "#0F1420"
CODEBAR = "#1A2230"
CODERED, CODEYEL, CODERED2 = "#FF5F57", "#FEBC2E", "#28C840"
MONO    = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"
CODE    = "#7CFC00"
CODESUB = "#8B98A8"
JSONK   = "#A8D8FF"
GHOST   = "rgba(255,255,255,0.07)"

def text(id_, x, y, w, h, html, **kw):
    el = {"id": id_, "type": "text", "x": x, "y": y, "w": w, "h": h, "html": html,
          "fontSize": kw.pop("fontSize", 24), "fontFamily": kw.pop("fontFamily", "system-ui, sans-serif"),
          "fontWeight": kw.pop("fontWeight", 400), "color": kw.pop("color", TEXT),
          "align": kw.pop("align", "left"), "valign": kw.pop("valign", "top"),
          "lineHeight": kw.pop("lineHeight", 1.2), "rotation": 0, "opacity": 1, **kw}
    return el

def shape(id_, kind, x, y, w, h, **kw):
    el = {"id": id_, "type": "shape", "shape": kind, "x": x, "y": y, "w": w, "h": h,
          "fill": kw.pop("fill", "#141925"), "stroke": kw.pop("stroke", "none"), "strokeWidth": kw.pop("strokeWidth", 0),
          "radius": kw.pop("radius", 12), "rotation": 0, "opacity": 1, **kw}
    return el

def grad_shape(id_, kind, x, y, w, h, stops, angle=135, **kw):
    el = shape(id_, kind, x, y, w, h, **kw)
    el["fillGradient"] = {"angle": angle, "stops": [{"at": s[0], "color": s[1]} for s in stops]}
    return el

def code_window(id_, x, y, w, h, title, lines, fontSize=20, lineHeight=1.55):
    """macOS-style window with traffic-light dots; height auto-fits the code."""
    n = len(lines)
    text_h = n * fontSize * lineHeight
    win_h = max(h, int(text_h) + 72)
    els = [shape(id_, "rect", x, y, w, win_h, fill=CODEBG, radius=12, stroke="#232B3A", strokeWidth=1)]
    els.append(shape(id_ + "-bar", "rect", x, y, w, 38, fill=CODEBAR, radius=12))
    els.append(shape(id_ + "-d1", "ellipse", x + 18, y + 14, 10, 10, fill=CODERED))
    els.append(shape(id_ + "-d2", "ellipse", x + 34, y + 14, 10, 10, fill=CODEYEL))
    els.append(shape(id_ + "-d3", "ellipse", x + 50, y + 14, 10, 10, fill=CODERED2))
    els.append(text(id_ + "-wt", x + w / 2 - 150, y + 9, 300, 22, title, fontSize=12, fontFamily=MONO, color=CODESUB, align="center"))
    html = "".join(f"<br>{l}" if i else l for i, l in enumerate(lines))
    els.append(text(id_ + "-t", x + 26, y + 56, w - 52, win_h - 70, html, fontSize=fontSize, fontFamily=MONO, color=CODE, lineHeight=lineHeight))
    return els

def header(slide_id, title_text, notes=""):
    els = [
        text("title-main", 96, 60, 760, 80, title_text, fontSize=46, fontWeight=800, fx={"enter": "fade-up", "order": 0}),
        grad_shape("accent-bar", "rect", 96, 152, 160, 8, [(0, ACCENT), (1, ACCENT2)], angle=90, radius=4),
        text("pageno", 1144, 660, 100, 30, "", fontSize=16, color=DIM, align="right"),
    ]
    return {"id": slide_id, "background": "#0B0F17", "transition": "morph", "notes": notes, "elements": els}

def add(slide, *items):
    for it in items:
        if isinstance(it, list):
            slide["elements"].extend(it)
        else:
            slide["elements"].append(it)

# ─────────────────────────── P1 cover ───────────────────────────
DOC["slides"].append({
  "id": "s1", "background": "#0B0F17", "transition": "none", "notes": "Cover",
  "elements": [
    grad_shape("bg-glow", "ellipse", 700, -160, 760, 760, [(0, "rgba(255,158,138,0.16)"), (1, "rgba(122,92,255,0.04)")], angle=135, radius=0, stroke="none"),
    shape("ring1", "ellipse", 1050, 60, 320, 320, fill="none", stroke=ACCENT, strokeWidth=2, strokeStyle="dashed", radius=0, opacity=0.35),
    shape("dot-a", "ellipse", 1220, 330, 14, 14, fill=ACCENT, radius=0, opacity=0.8),
    shape("dot-b", "ellipse", 1018, 402, 8, 8, fill=ACCENT2, radius=0),
    text("kicker", 96, 160, 700, 40, "LOCAL-FIRST TOOLKIT FOR BENTO", fontSize=20, color=ACCENT, fontWeight=600, letterSpacing=5, fx={"enter": "fade-up", "order": 0}),
    text("title-main", 96, 208, 1020, 180, "mcp-bento-server", fontSize=104, fontWeight=800, lineHeight=1, fx={"enter": "fade-up", "order": 1}),
    text("subtitle", 96, 410, 920, 90, "An MCP server &amp; CLI for authoring <b>Bento decks</b> — single-file PPTs built by AI agents, watched live in your browser.", fontSize=26, color=MUTED, lineHeight=1.5, fx={"enter": "fade-up", "order": 2}),
    grad_shape("accent-bar", "rect", 96, 520, 340, 14, [(0, ACCENT), (1, ACCENT2)], angle=90, radius=7, fx={"enter": "fade-up", "order": 3}),
    shape("chip1", "rect", 96, 568, 150, 42, fill="#141925", radius=21, stroke="#232B3A", strokeWidth=1, fx={"enter": "fade-up", "order": 4}),
    text("chip1-t", 126, 580, 120, 20, "CLI", fontSize=16, color=TEXT, align="center", fontWeight=600),
    shape("chip2", "rect", 262, 568, 160, 42, fill="#141925", radius=21, stroke="#232B3A", strokeWidth=1, fx={"enter": "fade-up", "order": 5}),
    text("chip2-t", 292, 580, 120, 20, "MCP server", fontSize=16, color=TEXT, align="center", fontWeight=600),
    shape("chip3", "rect", 438, 568, 180, 42, fill="#141925", radius=21, stroke="#232B3A", strokeWidth=1, fx={"enter": "fade-up", "order": 6}),
    text("chip3-t", 468, 580, 140, 20, "Live preview", fontSize=16, color=TEXT, align="center", fontWeight=600),
    text("footer1", 96, 648, 700, 30, "Local-first · Zero runtime deps · MIT · Node 20+", fontSize=17, color=DIM),
  ]
})

# ─────────────────────────── P2 the idea ───────────────────────────
s = header("s2", "The idea")
def feature_card(prefix, n, title_, body, x):
    els = []
    els.append(shape(prefix, "rect", x, 220, 340, 360, fill="#10151F", radius=18, stroke="#1F2735", strokeWidth=1, fx={"enter": "fade-up", "order": 1}))
    els.append(text(prefix + "-gh", x + 12, 210, 200, 120, n, fontSize=96, fontWeight=800, color=GHOST, lineHeight=1))
    els.append(grad_shape(prefix + "-top", "rect", x + 26, 250, 60, 6, [(0, ACCENT), (1, ACCENT2)], angle=90, radius=3))
    els.append(text(prefix + "-t", x + 26, 280, 288, 70, title_, fontSize=30, fontWeight=800))
    els.append(text(prefix + "-b", x + 26, 360, 288, 190, body, fontSize=19, color=MUTED, lineHeight=1.6))
    return els
add(s,
  feature_card("c1", "01", "One file, forever", "A <b>.bento.html</b> carries the deck, editor and viewer. Open it anywhere, send it anywhere — no installs, no accounts.", 96),
  feature_card("c2", "02", "Agent-editable JSON", "The document is one plain JSON block near the top of the file. Agents read &amp; rewrite it <b>in place</b>.", 470),
  feature_card("c3", "03", "Live browser preview", "Every edit applies <b>in place via loadDoc</b> — no page reload, no save prompt, fully undoable.", 844))
DOC["slides"].append(s)

# ─────────────────────────── P3 install ───────────────────────────
s = header("s3", "Install")
add(s,
  text("lbl1", 96, 200, 500, 30, "Global install — one command:", fontSize=19, color=MUTED, fx={"enter": "fade-up"}),
  code_window("cb1", 96, 240, 720, 150, "terminal — bash", ["$ npm i -g mcp-bento-server", "", "added 1 package in 0.9s"], fontSize=21),
  text("lbl2", 96, 420, 500, 30, "Or run anywhere, nothing to install:", fontSize=19, color=MUTED, fx={"enter": "fade-up"}),
  code_window("cb2", 96, 460, 720, 150, "terminal — bash", ["$ npx -y mcp-bento-server <command>", "", "zero runtime dependencies · Node 20+"], fontSize=21),
  grad_shape("side-g", "rect", 880, 200, 6, 410, [(0, ACCENT), (1, ACCENT2)], angle=90, radius=3),
  text("side1", 912, 208, 290, 40, "What you get", fontSize=26, fontWeight=800, fx={"enter": "fade-up", "order": 1}),
  text("side2", 912, 272, 290, 34, "▸ CLI  (bento-mcp)", fontSize=20, color=TEXT, fx={"enter": "fade-up", "order": 2}),
  text("side3", 912, 316, 290, 34, "▸ MCP server — 16 tools", fontSize=20, color=TEXT, fx={"enter": "fade-up", "order": 3}),
  text("side4", 912, 360, 290, 34, "▸ Live browser preview", fontSize=20, color=TEXT, fx={"enter": "fade-up", "order": 4}),
  text("side5", 912, 404, 290, 34, "▸ One skill, 3 harnesses", fontSize=20, color=TEXT, fx={"enter": "fade-up", "order": 5}),
  text("side6", 912, 448, 290, 60, "▸ Programmatic self-check (validate / measure)", fontSize=20, color=TEXT, lineHeight=1.4, fx={"enter": "fade-up", "order": 6}))
DOC["slides"].append(s)

# ─────────────────────────── P4 quick start ───────────────────────────
s = header("s4", "Quick start")
add(s,
  code_window("cb", 96, 190, 1088, 430, "terminal — zsh", [
    "# create a deck",
    'bento-mcp new --title "Q3 Report" --out report.bento.html',
    "",
    "# open http://127.0.0.1:3900/  — that is your live preview",
    "",
    "# let an agent edit it (patch the document JSON)",
    "bento-mcp patch '{\"addSlides\":[...]}'",
    "",
    "# programmatic self-check — overflow, broken links, dup ids",
    "bento-mcp validate",
    "",
    "# the file is the deliverable",
    "bento-mcp save",
  ], fontSize=20),
  text("hint", 96, 650, 900, 30, "Every command keeps your browser tab in sync — in place, no reload, no save prompt.", fontSize=18, color=DIM))
DOC["slides"].append(s)

# ─────────────────────────── P5 MCP integration ───────────────────────────
s = header("s5", "Use it from your agent")
add(s,
  text("lbl", 96, 195, 620, 30, "One line of config — Claude Code .mcp.json / opencode.json", fontSize=19, color=MUTED, fx={"enter": "fade-up"}),
  code_window("cb", 96, 235, 640, 210, "mcp.json", [
    '"mcp": {',
    '  "bento": {',
    '    "type": "local",',
    '    "command": ["bento-mcp", "mcp"]',
    '  }',
    '}',
  ], fontSize=19, lineHeight=1.65),
  text("tools-h", 780, 195, 404, 36, "16  bento_* tools", fontSize=24, fontWeight=800, color=ACCENT, fx={"enter": "fade-up", "order": 1}),
  text("tools-s", 780, 235, 404, 30, "your agent's native deck toolkit", fontSize=16, color=DIM, fx={"enter": "fade-up", "order": 1}))
tool_names = ["bento_open_deck", "bento_new_deck", "bento_save_deck", "bento_read_doc", "bento_list_slides", "bento_get_slide", "bento_describe", "bento_patch_elements", "bento_add_slide", "bento_update_slide", "bento_delete_slide", "bento_duplicate_slide", "bento_set_theme", "bento_validate", "bento_measure", "bento_status"]
for i, t in enumerate(tool_names):
    col = i // 8
    row = i % 8
    s["elements"].append(text(f"tool-{i}", 780 + col * 215, 290 + row * 42, 210, 30, t, fontSize=16.5, fontFamily=MONO, color=JSONK, fx={"enter": "fade-up", "order": 2}))
DOC["slides"].append(s)

# ─────────────────────────── P6 one skill three harnesses ───────────────────────────
s = header("s6", "One skill, three harnesses")
def harness(prefix, x, name, path_txt, note):
    els = []
    els.append(shape(prefix, "rect", x, 380, 340, 220, fill="#10151F", radius=18, stroke="#1F2735", strokeWidth=1, fx={"enter": "fade-up", "order": 2}))
    els.append(grad_shape(prefix + "-top", "rect", x + 24, 412, 60, 6, [(0, ACCENT), (1, ACCENT2)], angle=90, radius=3))
    els.append(text(prefix + "-t", x + 24, 440, 280, 40, name, fontSize=28, fontWeight=800))
    els.append(text(prefix + "-p", x + 24, 496, 292, 70, path_txt, fontSize=15, fontFamily=MONO, color=JSONK, lineHeight=1.5))
    els.append(text(prefix + "-b", x + 24, 570, 292, 40, note, fontSize=16, color=MUTED))
    return els
add(s,
  code_window("cb", 96, 200, 640, 92, "terminal — bash", ["$ bento-mcp install-skill", "", "installed → 3 harnesses"], fontSize=18),
  text("hint", 780, 215, 404, 60, "One SKILL.md, written into all three — no manual setup.", fontSize=19, color=MUTED, lineHeight=1.4),
  harness("h1", 96, "Claude Code", "~/.claude/skills/\nbento-slides/", "Native MCP + Agent Skills"),
  harness("h2", 470, "opencode", "~/.config/opencode/\nskills/bento-slides/", "Same SKILL.md, same commands"),
  harness("h3", 844, "pi", "~/.agents/skills/\nbento-slides/", "Reads the standard directly"),
  text("std", 96, 640, 900, 30, "Agent Skills standard — one SKILL.md, every harness reads it.", fontSize=18, color=DIM))
DOC["slides"].append(s)

# ─────────────────────────── P7 how it works ───────────────────────────
s = header("s7", "How it works")
def node(prefix, x, t, s_):
    els = [grad_shape(prefix, "rect", x, 250, 250, 130, [(0, "#171E2E"), (1, "#10151F")], radius=18, stroke="#2A3550", strokeWidth=1, fx={"enter": "fade-up", "order": 1})]
    els.append(text(prefix + "-t", x + 28, 288, 200, 50, t, fontSize=28, fontWeight=800))
    els.append(text(prefix + "-s", x + 28, 340, 200, 30, s_, fontSize=16, color=MUTED))
    return els
add(s,
  node("b1", 96, "Agent", "CLI or MCP tools"),
  shape("a1", "line", 372, 300, 96, 0, fill=ACCENT, strokeWidth=3, stroke=ACCENT, lineEnd="arrow"),
  node("b2", 490, "JSON patch", "#bento-doc block"),
  shape("a2", "line", 766, 300, 96, 0, fill=ACCENT, strokeWidth=3, stroke=ACCENT, lineEnd="arrow"),
  node("b3", 884, "Browser", "loadDoc · in place"),
  text("n1", 96, 420, 1088, 130, "Your file on disk is the <b>source of truth</b>. The browser is a live view. The bridge is injected at serve time, so the <b>.bento.html</b> you ship stays pristine.", fontSize=23, color=MUTED, lineHeight=1.6, fx={"enter": "fade-up", "order": 2}),
  shape("underline", "rect", 96, 570, 340, 4, fill="#232B3A", radius=2, fx={"enter": "fade-up", "order": 2}))
DOC["slides"].append(s)

# ─────────────────────────── P8 end ───────────────────────────
DOC["slides"].append({
  "id": "s8", "background": "#0B0F17", "transition": "morph", "notes": "End",
  "elements": [
    grad_shape("bg-glow", "ellipse", -140, 140, 760, 760, [(0, "rgba(122,92,255,0.14)"), (1, "rgba(255,158,138,0.03)")], angle=135, radius=0),
    shape("ring1", "ellipse", 980, 40, 280, 280, fill="none", stroke=ACCENT2, strokeWidth=2, strokeStyle="dashed", radius=0, opacity=0.3),
    text("title-main", 96, 200, 1000, 170, "Ship it.", fontSize=104, fontWeight=800, lineHeight=1),
    grad_shape("accent-bar", "rect", 96, 400, 340, 14, [(0, ACCENT), (1, ACCENT2)], angle=90, radius=7),
    text("made", 96, 450, 900, 44, "This deck was built with <b>mcp-bento-server</b> itself.", fontSize=26, color=MUTED),
    text("foot", 96, 620, 700, 30, "bento-mcp · local-first · MIT · github.com/nyblnet/bento", fontSize=18, color=DIM),
  ]
})

# page numbers
for i, s_ in enumerate(DOC["slides"], 1):
    for e in s_["elements"]:
        if e.get("id") == "pageno":
            e["html"] = f"{i:02d} / {len(DOC['slides']):02d}"

with open("ppt-intro.json", "w", encoding="utf-8") as f:
    json.dump(DOC, f, ensure_ascii=False, indent=1)
print("ppt-intro.json written, slides:", len(DOC["slides"]))
