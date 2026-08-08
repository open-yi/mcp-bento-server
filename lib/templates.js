/**
 * templates.js — built-in deck templates for `bento-mcp new --template <name>`.
 *
 * Each template is a theme + a designed cover slide skeleton. Agents pick a
 * template from `bento-mcp templates` based on the user's topic, then build
 * slides on top. A template is just a starting point — set-theme/patch can
 * reshape it later.
 */
'use strict';

const MONO = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace";
const SERIF = "'Fraunces', Georgia, serif";

const TEMPLATES = {
  dark: {
    name: 'dark',
    label: 'Dark Tech',
    emoji: '🌑',
    description: 'Deep charcoal + coral accent. Tech demos, developer talks, product deep-dives.',
    theme: { background: '#0B0F17', color: '#F2F0EA', accent: '#FF9E8A', fontFamily: 'system-ui, sans-serif' },
    font: 'system-ui, sans-serif',
    display: 'system-ui, sans-serif',
    accentBar: ['#FF9E8A', '#7A5CFF'],
  },
  light: {
    name: 'light',
    label: 'Light Business',
    emoji: '☀️',
    description: 'Clean white + deep navy + blue accent. Client pitches, QBRs, board updates.',
    theme: { background: '#FAFAF8', color: '#1A1D20', accent: '#2563EB', fontFamily: 'system-ui, sans-serif' },
    font: 'system-ui, sans-serif',
    display: 'system-ui, sans-serif',
    accentBar: ['#2563EB', '#1A1D20'],
  },
  gradient: {
    name: 'gradient',
    label: 'Gradient Launch',
    emoji: '✨',
    description: 'Deep base with violet→coral glow accents. Product launches, keynotes, hype decks.',
    theme: { background: '#0D0A1A', color: '#F4F1FF', accent: '#7A5CFF', fontFamily: 'system-ui, sans-serif' },
    font: 'system-ui, sans-serif',
    display: 'system-ui, sans-serif',
    accentBar: ['#7A5CFF', '#FF9E8A'],
    glow: true,
  },
  editorial: {
    name: 'editorial',
    label: 'Editorial',
    emoji: '📰',
    description: 'Serif display type, big whitespace, quiet color. Creative work, essays, design talks.',
    theme: { background: '#F5F1E8', color: '#211F1B', accent: '#B5532F', fontFamily: 'Georgia, serif' },
    font: 'Georgia, serif',
    display: SERIF,
    accentBar: ['#B5532F', '#211F1B'],
  },
  midnight: {
    name: 'midnight',
    label: 'Midnight',
    emoji: '🌙',
    description: 'Bento signature: deep navy ink + peach accent + serif display. Balanced, elegant, general.',
    theme: { background: '#0D1B2E', color: '#F2F0EA', accent: '#FF9E8A', fontFamily: 'system-ui, sans-serif' },
    font: 'system-ui, sans-serif',
    display: SERIF,
    accentBar: ['#FF9E8A', '#5E7699'],
  },
};

/** Build a full document for a template. Returns {doc, theme} — the doc is a
 *  BentoDoc with the template theme and a designed cover slide. */
function makeDoc(tplName, title) {
  const tpl = TEMPLATES[tplName] || TEMPLATES.dark;
  const { background, color, accent } = tpl.theme;
  const muted = tpl.name === 'light' || tpl.name === 'editorial' ? '#6C757D' : '#9CA3AF';

  const cover = {
    id: 's1',
    background,
    transition: 'none',
    notes: 'Cover',
    elements: [],
  };

  if (tpl.glow) {
    cover.elements.push({
      id: 'glow', type: 'shape', shape: 'ellipse', x: 780, y: -180, w: 720, h: 720,
      rotation: 0, opacity: 1, radius: 0, fill: 'rgba(122,92,255,0.16)', stroke: 'none', strokeWidth: 0,
    });
    cover.elements.push({
      id: 'ring', type: 'shape', shape: 'ellipse', x: 1040, y: 60, w: 300, h: 300,
      rotation: 0, opacity: 0.35, radius: 0, fill: 'none', stroke: accent, strokeWidth: 2, strokeStyle: 'dashed',
    });
  }

  cover.elements.push({
    id: 'kicker', type: 'text', x: 96, y: 160, w: 700, h: 40,
    html: 'A BENTO DECK', fontSize: 20, fontWeight: 600, color: accent, letterSpacing: 4,
    fontFamily: tpl.font, align: 'left', valign: 'top', lineHeight: 1, rotation: 0, opacity: 1,
  });
  cover.elements.push({
    id: 'title', type: 'text', x: 96, y: 210, w: 1000, h: 180,
    html: title, fontSize: 96, fontWeight: 800, color,
    fontFamily: tpl.display, align: 'left', valign: 'top', lineHeight: 1.05, rotation: 0, opacity: 1,
  });
  cover.elements.push({
    id: 'subtitle', type: 'text', x: 96, y: 420, w: 900, h: 80,
    html: 'Subtitle — describe the talk in one line.', fontSize: 26, color: muted, lineHeight: 1.5,
    fontFamily: tpl.font, align: 'left', valign: 'top', rotation: 0, opacity: 1,
  });
  cover.elements.push({
    id: 'bar', type: 'shape', shape: 'rect', x: 96, y: 530, w: 320, h: 14,
    rotation: 0, opacity: 1, radius: 7,
    fillGradient: { angle: 90, stops: [{ at: 0, color: tpl.accentBar[0] }, { at: 1, color: tpl.accentBar[1] }] },
    fill: tpl.accentBar[0], stroke: 'none', strokeWidth: 0,
  });
  cover.elements.push({
    id: 'footer', type: 'text', x: 96, y: 640, w: 700, h: 30,
    html: 'Made with mcp-bento-server · ' + tpl.label, fontSize: 17, color: muted,
    fontFamily: tpl.font, align: 'left', valign: 'top', rotation: 0, opacity: 1,
  });

  return {
    format: 'bento/slides',
    version: 1,
    title,
    size: { width: 1280, height: 720 },
    theme: tpl.theme,
    slides: [cover],
  };
}

/** Human-readable template list (for `bento-mcp templates` and agents). */
function templateSummary() {
  return Object.values(TEMPLATES).map(t => ({
    name: t.name,
    label: t.label,
    emoji: t.emoji,
    description: t.description,
  }));
}

module.exports = { TEMPLATES, makeDoc, templateSummary };
