/**
 * install-skill.js — install the bundled skill into all three harnesses so a
 * single SKILL.md serves Claude Code, opencode and pi (Agent Skills standard).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_SRC = path.join(__dirname, '..', 'skill');
const TARGETS = [
  { name: 'Claude Code', dir: path.join(os.homedir(), '.claude', 'skills', 'bento-slides') },
  { name: 'opencode', dir: path.join(os.homedir(), '.config', 'opencode', 'skills', 'bento-slides') },
  { name: 'pi', dir: path.join(os.homedir(), '.agents', 'skills', 'bento-slides') }
];

async function installSkill() {
  const results = [];
  for (const t of TARGETS) {
    try {
      fs.mkdirSync(t.dir, { recursive: true });
      // copy SKILL.md (and any future references) verbatim
      for (const f of fs.readdirSync(SKILL_SRC)) {
        fs.copyFileSync(path.join(SKILL_SRC, f), path.join(t.dir, f));
      }
      results.push({ harness: t.name, dir: t.dir, ok: true });
    } catch (e) {
      results.push({ harness: t.name, dir: t.dir, ok: false, error: e.message });
    }
  }
  return { ok: true, installed: results };
}

module.exports = { installSkill };
