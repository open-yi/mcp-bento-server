# mcp-bento-server

**Local-first MCP server & CLI for authoring Bento decks (single-file PPT) with AI agents and live browser preview.**

Bento — the [PowerPoint alternative that fits in a file](https://bento.page) — carries its own viewer, presenter and editor inside a single `.bento.html` document. This toolkit gives agents a programmatic way to drive it:

- **CLI** (`bento-mcp`): open, read, patch, add/duplicate/delete slides, set themes, validate — anything an agent needs to build a deck.
- **Live browser preview**: edits are pushed over WebSocket to your browser tab, which reloads automatically. You watch the result as the agent works.
- **Programmatic self-check**: `validate` and `measure` run inside the browser and post structured reports back — so even a non-vision model can catch overflow, broken links, duplicate ids and chart config errors without screenshots.
- **MCP server**: one line of config and Claude Code / opencode can call `bento_*` tools natively.
- **One skill, three harnesses**: the bundled `SKILL.md` (Agent Skills standard) installs into Claude Code, opencode and pi with a single command.

Zero runtime dependencies — Node 20+ built-ins only. Local-first: the file on disk is the document; nothing leaves your machine.

---

## Quick start

```bash
npm i -g mcp-bento-server

# create a deck (or open an existing .bento.html)
bento-mcp new --title "Q3 Report" --out report.bento.html

# open http://127.0.0.1:3900/ in your browser — that's your live preview

# let an agent edit it
bento-mcp patch '{"addSlides":[{"id":"s2","transition":"morph","elements":[{"id":"t1","type":"text","x":96,"y":200,"w":900,"h":120,"html":"Revenue up 42%","fontSize":72,"fontWeight":900,"color":"#F2F0EA"}]}]}'

# self-check quality
bento-mcp validate

# the file is the deliverable
bento-mcp save
```

No `npm i` in a project yet? `npx -y mcp-bento-server <cmd>` works anywhere Node 20+ exists.

## CLI reference

```
bento-mcp serve [--port N]     start the server in the foreground
bento-mcp start|stop|status    manage the background server
bento-mcp open <file>          open a .bento.html deck
bento-mcp new --title T --out F   create a new deck
bento-mcp read                 dump the document JSON
bento-mcp slides               list slides (id, elements, transition)
bento-mcp get <slide-id>       dump one slide
bento-mcp describe             plain-text summary of the whole deck
bento-mcp patch '<ops json>'   apply an ops patch (create/update/delete)
bento-mcp add-slide '<json>'   add a slide
bento-mcp update-slide <id> '<set json>'
bento-mcp delete-slide <id>
bento-mcp duplicate-slide <id> keeps element ids → morph pairs automatically
bento-mcp set-theme '<json>'   set theme fields
bento-mcp set-title "..."      set the deck title
bento-mcp save                 write the doc back into the file
bento-mcp export-json [--out F] / import-json <file>
bento-mcp validate             programmatic self-check (browser tab required)
bento-mcp measure '<spec json>'   size text before placing it (browser tab required)
bento-mcp install-skill        install the skill into Claude Code, opencode and pi
bento-mcp mcp                  run as an MCP stdio server
```

## MCP configuration

Claude Code (`.mcp.json`) or opencode (`opencode.json`):

```json
{
  "mcp": {
    "bento": {
      "type": "local",
      "command": ["bento-mcp", "mcp"]
    }
  }
}
```

Tools: `bento_open_deck`, `bento_new_deck`, `bento_save_deck`, `bento_read_doc`,
`bento_list_slides`, `bento_get_slide`, `bento_describe`, `bento_patch_elements`,
`bento_add_slide`, `bento_update_slide`, `bento_delete_slide`, `bento_duplicate_slide`,
`bento_set_theme`, `bento_validate`, `bento_measure`, `bento_status`.

## Install the skill everywhere

```bash
bento-mcp install-skill
```

Writes `SKILL.md` to `~/.claude/skills/bento-slides/`,
`~/.config/opencode/skills/bento-slides/` and `~/.agents/skills/bento-slides/`
(pi reads these directly; Claude Code and opencode use the Agent Skills standard).

## How it works

```
        your browser (the human's live preview)
   http://127.0.0.1:3900/  ← Bento editor, injected bridge script
        ▲                            │
        │ SSE: doc-updated → reload  │ POST: validate/measure results
        └────────────────────────────┘
                      │
        mcp-bento-server (Node, zero deps)
        ├── CLI (bento-mcp)  ── JSON API
        ├── MCP stdio server ── bento_* tools
        └── HTTP + SSE on 127.0.0.1:3900
                      │ read/write #bento-doc block
              *.bento.html  (the file IS the document)
```

- The bundled `assets/Bento_Slides.bento.html` is the official Bento build,
  used as the editor page.
- The bridge script is **injected at serve time** — the file on disk stays
  pristine (Bento rewrites the whole file on save, so we never write into it).
- `validate` / `measure` run in the browser frontend and post results back,
  which is how a non-vision model verifies layout without screenshots.

## License

MIT — our code is MIT. The bundled Bento runtime (`Bento_Slides.bento.html`)
is MIT © 2026 The Bento authors; its embedded components (reveal.js, Moveable,
Selecto) are MIT, and its embedded typefaces (Fraunces, Instrument Sans) are
OFL — see the NOTICE block at the top of that file and the upstream
[THIRD_PARTY_NOTICES.md](https://github.com/nyblnet/bento/blob/main/THIRD_PARTY_NOTICES.md).

This is an **unofficial** third-party tool. Not affiliated with the Bento project.
