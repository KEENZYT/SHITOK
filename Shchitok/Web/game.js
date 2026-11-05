(() => {
'use strict';

/* ============================================================
   ЩИТОК v0.3 — симулятор монтажа электрощита
   Рабочий процесс: детали на рейку → провода в зажимы →
   отрезать → зачистить. Ортогональная укладка по каналам.
   Canvas 2D, без зависимостей.
   ============================================================ */

/* ---------------- helpers ---------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const nowMs = () => performance.now();

function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segInt(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/* ---------------- constants ---------------- */
const W = 1160, H = 700;
const PANEL = { x: 40, y: 20, w: 900, h: 660, r: 18 };
const RAIL_TOP = { x: 70, y: 132, w: 840, h: 14 };
const RAIL_BOT = { x: 70, y: 470, w: 840, h: 14 };
const DEV_TOP = 64, DEV_BOT = 196, MOD_W = 44, MOD_GAP = 4;
const TERM_TOP = 76, TERM_BOT = 184;
const TRAY = { x: 980, y: 180, w: 160, h: 480 };
const LANE_MIN = 24, LANE_MAX = 656;

const COLORS = {
  L:  { base: '#b25f28', light: '#e2a06a', dark: '#7a3d16', name: 'Фаза' },
  N:  { base: '#2f6fb0', light: '#82b8e4', dark: '#1d4a78', name: 'Ноль' },
  PE: { base: '#6fa832', light: '#bfe57a', dark: '#4a7220', name: 'Земля' },
};

const LEVELS = window.LEVELS || [];

/* ---------------- tools ---------------- */
const TOOLS = {
  hand:        { id: 'hand',        name: 'Рука',      icon: '✋', desc: 'Вставлять провода в зажимы и тянуть детали' },
  cutters:     { id: 'cutters',     name: 'Кусачки',   icon: '✂️', desc: 'Отрезать провод нужной длины' },
  stripper:    { id: 'stripper',    name: 'Стриппер',  icon: '🔧', desc: 'Зачистить концы провода' },
  screwdriver: { id: 'screwdriver', name: 'Отвёртка',  icon: '🪛', desc: 'Затягивать клеммы и коннекторы' },
  multimeter: { id: 'multimeter', name: 'Мультиметр', icon: '🔌', desc: 'Проверить соединение двумя щупами' },
  remove: { id: 'remove', name: 'Снять провод', icon: '✖', desc: 'Нажмите на провод, чтобы снять его' },
};
const TOOL_ORDER = ['hand', 'cutters', 'stripper', 'screwdriver', 'multimeter', 'remove'];
const TOOL_UNLOCK = {};

/* ---------------- progress ---------------- */
const STORAGE_KEY = 'shchitok_progress_v1';

function defaultProgress() {
  return {
    version: 1,
    levels: {},
    unlockedTools: ['hand', 'cutters', 'stripper', 'screwdriver', 'multimeter', 'remove'],
    settings: { sound: true },
  };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.version === 1) {
        p.levels = p.levels || {};
        p.unlockedTools = Array.from(new Set(['hand', 'cutters', 'stripper', 'screwdriver', 'multimeter', 'remove'].concat(Array.isArray(p.unlockedTools) ? p.unlockedTools : [])));
        p.settings = Object.assign({ sound: true }, p.settings || {});
        return p;
      }
    }
  } catch (e) { /* ignore */ }
  return defaultProgress();
}

let progress = loadProgress();

function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
}

function isToolUnlocked(id) { return progress.unlockedTools.indexOf(id) >= 0; }

// В прототипе все объекты доступны сразу; результаты сохраняются отдельно.
function isLevelUnlocked(index) {
  return Number.isInteger(index) && index >= 0 && index < LEVELS.length;
}

function levelStars(index) {
  const l = LEVELS[index];
  if (!l) return 0;
  const p = progress.levels[l.id];
  return p ? p.stars || 0 : 0;
}

/* ---------------- active level ---------------- */
let activeDevices = [];
let activeClamps = [];
let activeBuses = [];
const nodes = {};

const devW = (d) => d.mods * MOD_W + (d.mods - 1) * MOD_GAP;

function addNode(id, x, y, dir, type, label, devId, showLabel) {
  nodes[id] = { id, x, y, dir, type, label, devId, showLabel: !!showLabel };
}

function buildLevel(level) {
  state.level = level;
  for (const k in nodes) delete nodes[k];

  if (level.assembly) { buildAssembly(level); return; }
  state.assembly = null;

  activeDevices = level.devices.map((d) => Object.assign({}, d, { installed: false }));
  let cursor = 76;
  for (const d of activeDevices) {
    d.x = cursor;
    cursor += devW(d) + MOD_GAP;
  }

  activeClamps = (level.clamps || level.blocks || []).map((b, i) => Object.assign({}, b, {
    x: 76 + i * 48, y: 418, w: 44, h: 110,
  }));
  activeBuses = level.buses.map((b) => Object.assign({}, b, { y: 450, h: 40 }));

  for (const b of activeClamps) {
    addNode(b.id, b.x + b.w / 2, b.y + 14, { x: 0, y: -1 }, b.type, b.id.toUpperCase(), b.id, false);
  }
  for (const b of activeBuses) {
    addNode(b.id, b.x + (b.nodeOffset || 20), b.y + b.h / 2, { x: 0, y: -1 }, b.type, b.label, b.id, false);
  }
}

function addDeviceNodes(d) {
  if (d.kind === 'meter' || d.kind === 'meter3') {
    const offs = [16, 52, 88, 124];
    const types = d.kind === 'meter3' ? ['L', 'L', 'L', 'N'] : ['L', 'L', 'N', 'N'];
    offs.forEach((o, i) => {
      addNode('m' + (i + 1), d.x + o, TERM_BOT, { x: 0, y: 1 }, types[i], String(i + 1), d.id, false);
    });
    return;
  }
  const w = devW(d);
  if (d.mods === 3) {
    addNode(d.id + '_t1', d.x + 22, TERM_TOP, { x: 0, y: -1 }, 'L', '1', d.id, true);
    addNode(d.id + '_t3', d.x + 70, TERM_TOP, { x: 0, y: -1 }, 'L', '3', d.id, true);
    addNode(d.id + '_t5', d.x + 118, TERM_TOP, { x: 0, y: -1 }, 'L', '5', d.id, true);
    addNode(d.id + '_b2', d.x + 22, TERM_BOT, { x: 0, y: 1 }, 'L', '2', d.id, true);
    addNode(d.id + '_b4', d.x + 70, TERM_BOT, { x: 0, y: 1 }, 'L', '4', d.id, true);
    addNode(d.id + '_b6', d.x + 118, TERM_BOT, { x: 0, y: 1 }, 'L', '6', d.id, true);
    return;
  }
  if (d.mods === 2) {
    addNode(d.id + '_t1', d.x + 22, TERM_TOP, { x: 0, y: -1 }, 'L', '1', d.id, true);
    addNode(d.id + '_t3', d.x + 70, TERM_TOP, { x: 0, y: -1 }, 'N', '3', d.id, true);
    addNode(d.id + '_b2', d.x + 22, TERM_BOT, { x: 0, y: 1 }, 'L', '2', d.id, true);
    addNode(d.id + '_b4', d.x + 70, TERM_BOT, { x: 0, y: 1 }, 'N', '4', d.id, true);
  } else {
    addNode(d.id + '_t1', d.x + w / 2, TERM_TOP, { x: 0, y: -1 }, 'L', '1', d.id, true);
    addNode(d.id + '_b2', d.x + w / 2, TERM_BOT, { x: 0, y: 1 }, d.kind === 'socket' ? 'PE' : 'L', '2', d.id, true);
  }
}

/* ============================================================
   РЕЖИМ СБОРКИ: коса → коннекторы → зажимы → рейки → шины
   ============================================================ */
const ASSEMBLY_BUNDLE = { x: 100, y: 20, w: 200, h: 120 };
const CONNECTOR_TOP = { x: 100, y: 200, w: 200, h: 40 };
const CONNECTOR_BOTTOM = { x: 100, y: 560, w: 200, h: 40 };

const STEP_HINTS = {
  strip: 'Возьмите стриппер и нажмите на косу',
  topConnector: 'Перетащите верхний коннектор из лотка на панель',
  bottomConnector: 'Перетащите нижний коннектор из лотка на панель',
  cutYellow: 'Кусачками отрежьте три жёлтых провода',
  insertYellow: 'Ручкой: выберите жёлтый провод и нажмите на верхний коннектор',
  tightenTop: 'Отвёрткой затяните верхний коннектор',
  separate: 'Нажмите на косу, чтобы разделить белые и синие',
  clamps: 'Перетащите четыре зажима из лотка на панель',
  clipBlue: 'Ручкой: выберите синий провод и нажмите на зажим',
  tightenClamps: 'Отвёрткой затяните все зажимы',
  insertBlue: 'Нажмите на косу, чтобы вставить синие в нижний коннектор',
  tightenBottom: 'Отвёрткой затяните нижний коннектор',
  rails: 'Перетащите верхнюю и нижнюю рейки из лотка',
  devices: 'Перетащите QF1, QF2 и счётчик на рейки',
  busbars: 'Перетащите белые шины в автоматы, а N-шину — на панель',
};

function buildAssembly(level) {
  const a = {
    stripped: false,
    separated: false,
    blueInserted: false,
    connectors: {
      top: { installed: false, tight: false },
      bottom: { installed: false, tight: false },
    },
    clamps: level.clamps.map((c) => Object.assign({}, c, { installed: false, tight: false })),
    rails: { top: false, bottom: false },
    busbars: level.buses.map((b) => Object.assign({}, b, { installed: false })),
    bundle: { wires: [] },
    selectedWire: null,
    dragItem: null,
  };
  state.assembly = a;

  activeDevices = level.devices.map((d) => Object.assign({}, d, { installed: false }));
  let cursor = 76;
  for (const d of activeDevices) {
    d.x = cursor;
    cursor += devW(d) + MOD_GAP;
  }
  activeClamps = [];
  activeBuses = [];

  const colors = [['L', 3], ['N', 3], ['PE', 3]];
  let x = 120;
  for (const [color, count] of colors) {
    for (let i = 0; i < count; i++) {
      a.bundle.wires.push({
        id: color.toLowerCase() + i,
        color,
        x: x + i * 20,
        cut: false,
        inserted: false,
        clipped: false,
      });
    }
    x += count * 20 + 20;
  }

  for (const b of a.busbars) {
    if (b.breaker === 'nbus') { b.x = 700; b.y = 470; b.w = 190; b.h = 40; }
  }
}

function assemblyItems() {
  const a = state.assembly;
  if (!a) return [];
  const items = [];
  if (!a.connectors.top.installed) items.push({ kind: 'connector', id: 'top', label: 'Коннектор', sub: 'верх', color: 'L' });
  if (!a.connectors.bottom.installed) items.push({ kind: 'connector', id: 'bottom', label: 'Коннектор', sub: 'низ', color: 'PE' });
  for (const c of a.clamps) if (!c.installed) items.push({ kind: 'clamp', id: c.id, label: 'Зажим', sub: '', color: 'PE' });
  if (!a.rails.top) items.push({ kind: 'rail', id: 'top', label: 'Рейка', sub: 'верх', color: 'N' });
  if (!a.rails.bottom) items.push({ kind: 'rail', id: 'bottom', label: 'Рейка', sub: 'низ', color: 'N' });
  for (const d of activeDevices) if (!d.installed) items.push({ kind: 'device', id: d.id, label: d.label, sub: d.sub, color: 'L' });
  for (const b of a.busbars) if (!b.installed) items.push({ kind: 'busbar', id: b.id, label: 'Шина', sub: b.label, color: b.type });
  return items;
}

function itemCardRect(item) {
  const items = assemblyItems();
  const i = items.findIndex((x) => x.kind === item.kind && x.id === item.id);
  if (i < 0) return null;
  return { x: TRAY.x + 10 + (i % 2) * 72, y: TRAY.y + 40 + Math.floor(i / 2) * 62, w: 66, h: 56 };
}

function itemSlot(item) {
  const a = state.assembly;
  if (!a) return null;
  if (item.kind === 'connector') return item.id === 'top' ? CONNECTOR_TOP : CONNECTOR_BOTTOM;
  if (item.kind === 'clamp') {
    const c = a.clamps.find((c) => c.id === item.id);
    return c ? { x: c.x - 22, y: c.y, w: 44, h: 40 } : null;
  }
  if (item.kind === 'rail') return item.id === 'top' ? RAIL_TOP : RAIL_BOT;
  if (item.kind === 'device') {
    const d = activeDevices.find((d) => d.id === item.id);
    return d ? { x: d.x, y: DEV_TOP, w: devW(d), h: DEV_BOT - DEV_TOP } : null;
  }
  if (item.kind === 'busbar') {
    const b = a.busbars.find((b) => b.id === item.id);
    if (!b) return null;
    if (b.breaker === 'nbus') return { x: b.x, y: b.y, w: b.w, h: b.h };
    const d = activeDevices.find((d) => d.id === b.breaker);
    return d ? { x: d.x, y: 200, w: devW(d), h: 20 } : null;
  }
  return null;
}

function hitItem(p) {
  for (const item of assemblyItems()) {
    const r = itemCardRect(item);
    if (r && pointInRect(p, r, 8)) return item;
  }
  return null;
}

function installItem(item) {
  const a = state.assembly;
  if (!a) return;
  if (item.kind === 'connector') {
    a.connectors[item.id].installed = true;
    const isTop = item.id === 'top';
    addNode(isTop ? 'topOut' : 'bottomOut', 200, isTop ? 240 : 560, { x: 0, y: isTop ? 1 : -1 }, 'L', isTop ? 'верх' : 'низ', isTop ? 'topConnector' : 'bottomConnector', false);
  } else if (item.kind === 'clamp') {
    const c = a.clamps.find((c) => c.id === item.id);
    if (c) c.installed = true;
  } else if (item.kind === 'rail') {
    a.rails[item.id] = true;
  } else if (item.kind === 'device') {
    installDevice(item.id);
  } else if (item.kind === 'busbar') {
    const b = a.busbars.find((b) => b.id === item.id);
    if (b) {
      b.installed = true;
      if (b.breaker === 'nbus') {
        addNode('nbus', b.x, b.y, { x: 0, y: -1 }, 'N', 'N', 'nbus', false);
      } else {
        const d = activeDevices.find((d) => d.id === b.breaker);
        if (d) { b.x = d.x; b.y = 200; b.w = devW(d); b.h = 20; }
      }
    }
  }
  Sound.mount();
  checkAllSteps();
  renderTasks();
  updateHUD();
}

function finishItemDrag() {
  const a = state.assembly;
  const d = a && a.dragItem;
  if (!d) return;
  const slot = itemSlot(d.item);
  const cx = d.x + 33, cy = d.y + 28;
  if (slot && pointInRect({ x: cx, y: cy }, slot, 26)) installItem(d.item);
  else toast('Перетащите деталь в её место на щите', 'info');
  a.dragItem = null;
}

function hitBundle(p) {
  return pointInRect(p, ASSEMBLY_BUNDLE, 6);
}

function hitBundleWire(p) {
  const a = state.assembly;
  if (!a) return null;
  for (const w of a.bundle.wires) {
    if (w.color === 'L' && !w.inserted && Math.abs(p.x - w.x) < 9 && p.y > 20 && p.y < 130) return w;
    if (w.color === 'PE' && !w.clipped && Math.abs(p.x - w.x) < 9 && p.y > 20 && p.y < 130) return w;
  }
  return null;
}

function hitConnector(p) {
  if (pointInRect(p, CONNECTOR_TOP, 6)) return { kind: 'connector', id: 'top' };
  if (pointInRect(p, CONNECTOR_BOTTOM, 6)) return { kind: 'connector', id: 'bottom' };
  return null;
}

function hitClamp(p) {
  const a = state.assembly;
  if (!a) return null;
  for (const c of a.clamps) {
    if (c.installed && pointInRect(p, { x: c.x - 22, y: c.y, w: 44, h: 40 }, 6)) return c;
  }
  return null;
}

function handleConnectorClick(conn) {
  const a = state.assembly;
  if (!a) return;
  const c = a.connectors[conn.id];
  if (!c.installed) { toast('Сначала установите коннектор', 'info'); return; }
  const w = a.bundle.wires.find((w) => w.id === a.selectedWire);
  if (!w) { toast('Сначала выберите провод в косе', 'info'); return; }
  if (conn.id === 'top' && w.color === 'L' && !w.inserted) {
    w.inserted = true;
    a.selectedWire = null;
    Sound.connect();
    toast('Жёлтый вставлен в верхний коннектор', 'ok');
    checkAllSteps();
  } else if (conn.id === 'bottom' && w.color === 'PE' && !a.blueInserted) {
    a.blueInserted = true;
    a.selectedWire = null;
    Sound.connect();
    toast('Синие вставлены в нижний коннектор', 'ok');
    checkAllSteps();
  } else {
    toast('Этот провод сюда не подходит', 'info');
  }
}

function handleClampClick(clamp) {
  const a = state.assembly;
  if (!a) return;
  if (!clamp.installed) { toast('Сначала приклейте зажим', 'info'); return; }
  const w = a.bundle.wires.find((w) => w.id === a.selectedWire);
  if (!w) { toast('Сначала выберите синий провод в косе', 'info'); return; }
  if (w.color === 'PE' && !w.clipped) {
    w.clipped = true;
    a.selectedWire = null;
    Sound.connect();
    toast('Синий закреплён в зажиме', 'ok');
    checkAllSteps();
  } else {
    toast('В зажим идут только синие провода', 'info');
  }
}

function handleBundleClick() {
  const a = state.assembly;
  if (!a) return;
  if (!a.stripped) { toast('Сначала зачистите косу стриппером', 'info'); return; }
  if (!a.separated) {
    a.separated = true;
    addNode('whiteOut', 200, 120, { x: 0, y: 1 }, 'N', 'белые', 'bundle', false);
    Sound.connect();
    toast('Белые и синие разделены на пучки', 'ok');
    checkAllSteps();
    return;
  }
  const blues = a.bundle.wires.filter((w) => w.color === 'PE');
  if (blues.every((w) => w.clipped) && !a.blueInserted) {
    a.blueInserted = true;
    Sound.connect();
    toast('Синие вставлены в нижний коннектор', 'ok');
    checkAllSteps();
    return;
  }
  toast('Разделите пучки и закрепите синие в зажимах', 'info');
}

function tightenAssemblyItem(item) {
  const a = state.assembly;
  if (!a) return;
  if (item.kind === 'connector') {
    const c = a.connectors[item.id];
    if (!c.installed) { toast('Сначала установите коннектор', 'info'); return; }
    if (c.tight) { toast('Уже затянуто', 'info'); return; }
    c.tight = true;
    Sound.ratchet();
    toast('Коннектор затянут', 'ok');
    checkAllSteps();
  } else if (item.kind === 'clamp') {
    const c = a.clamps.find((c) => c.id === item.id);
    if (!c || !c.installed) { toast('Сначала приклейте зажим', 'info'); return; }
    if (c.tight) { toast('Уже затянуто', 'info'); return; }
    c.tight = true;
    Sound.ratchet();
    toast('Зажим затянут', 'ok');
    checkAllSteps();
  }
}

function checkStep(step) {
  const a = state.assembly;
  if (!a) return false;
  switch (step) {
    case 'strip': return a.stripped;
    case 'topConnector': return a.connectors.top.installed;
    case 'bottomConnector': return a.connectors.bottom.installed;
    case 'cutYellow': return a.bundle.wires.filter((w) => w.color === 'L').every((w) => w.cut);
    case 'insertYellow': return a.bundle.wires.filter((w) => w.color === 'L').every((w) => w.inserted);
    case 'tightenTop': return a.connectors.top.tight;
    case 'separate': return a.separated;
    case 'clamps': return a.clamps.every((c) => c.installed);
    case 'clipBlue': return a.bundle.wires.filter((w) => w.color === 'PE').every((w) => w.clipped);
    case 'tightenClamps': return a.clamps.every((c) => c.tight);
    case 'insertBlue': return a.blueInserted;
    case 'tightenBottom': return a.connectors.bottom.tight;
    case 'rails': return a.rails.top && a.rails.bottom;
    case 'devices': return activeDevices.every((d) => d.installed);
    case 'busbars': return a.busbars.every((b) => b.installed);
    default: return false;
  }
}

function checkAllSteps() {
  for (const t of state.tasks) {
    if (t.def.type === 'step' && !t.done && checkStep(t.def.step)) completeTask(t);
  }
}

/* ---------------- assembly rendering ---------------- */
function drawBundle() {
  const a = state.assembly;
  if (!a) return;
  const b = a.bundle;
  for (const w of b.wires) {
    let x = w.x;
    if (b.separated && w.color === 'N') x = 140 + (w.x - 180);
    let y2 = 120;
    if (w.color === 'L' && w.cut) y2 = 100;
    if (w.color === 'L' && w.inserted) y2 = 200;
    if (w.color === 'PE' && w.clipped) y2 = 310;
    if (w.color === 'PE' && a.blueInserted) y2 = 560;
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, y2);
    ctx.strokeStyle = COLORS[w.color].base;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = COLORS[w.color].light;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (a.stripped) {
      ctx.beginPath();
      ctx.arc(x, y2, 2.6, 0, TAU);
      ctx.fillStyle = '#d98a52';
      ctx.fill();
    }
  }
  if (!b.separated) {
    rr(ctx, 110, 114, 180, 9, 3);
    ctx.fillStyle = '#3b4550';
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6d7885';
  ctx.font = 'bold 8px Inter, system-ui, sans-serif';
  ctx.fillText('КОСА', 200, 14);
}

function drawConnector(id) {
  const a = state.assembly;
  if (!a) return;
  const c = a.connectors[id];
  const rect = id === 'top' ? CONNECTOR_TOP : CONNECTOR_BOTTOM;
  if (!c.installed) {
    ctx.save();
    ctx.setLineDash([7, 6]);
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 5);
    ctx.fillStyle = 'rgba(110,124,140,0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(105,118,133,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7d8895';
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(id === 'top' ? 'ВЕРХНИЙ КОННЕКТОР' : 'НИЖНИЙ КОННЕКТОР', rect.x + rect.w / 2, rect.y + rect.h / 2 + 3);
    ctx.restore();
    return;
  }
  rr(ctx, rect.x, rect.y, rect.w, rect.h, 5);
  const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  g.addColorStop(0, '#f2f5f8');
  g.addColorStop(1, '#c6ced7');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#98a2ae';
  ctx.lineWidth = 1;
  ctx.stroke();
  const holes = id === 'top' ? [120, 140, 160] : [240, 260, 280];
  for (const hx of holes) {
    ctx.beginPath();
    ctx.arc(hx, rect.y + rect.h / 2, 5, 0, TAU);
    ctx.fillStyle = '#2b333d';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(rect.x + rect.w - 14, rect.y + rect.h / 2, 6, 0, TAU);
  ctx.fillStyle = c.tight ? '#4ade80' : '#f5a623';
  ctx.fill();
  ctx.strokeStyle = '#7d8794';
  ctx.stroke();
  ctx.fillStyle = '#4a5460';
  ctx.font = 'bold 9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(id === 'top' ? 'ВЕРХ' : 'НИЗ', rect.x + 30, rect.y + rect.h / 2 + 3);
}

function drawClampSpot(c) {
  if (!c.installed) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    rr(ctx, c.x - 22, c.y, 44, 40, 4);
    ctx.fillStyle = 'rgba(110,124,140,0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(105,118,133,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7d8895';
  ctx.font = '7px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('зажим', c.x, c.y + 24);
    ctx.restore();
    return;
  }
  rr(ctx, c.x - 22, c.y, 44, 40, 4);
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + 40);
  g.addColorStop(0, '#f2f5f8');
  g.addColorStop(1, '#c6ced7');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#98a2ae';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.x, c.y + 10, 5, 0, TAU);
  ctx.fillStyle = '#2b333d';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c.x, c.y + 30, 4, 0, TAU);
  ctx.fillStyle = c.tight ? '#4ade80' : '#f5a623';
  ctx.fill();
}

function drawRailSlot(id) {
  const a = state.assembly;
  if (!a) return;
  const r = id === 'top' ? RAIL_TOP : RAIL_BOT;
  if (a.rails[id]) { drawRail(r); return; }
  ctx.save();
  ctx.setLineDash([7, 6]);
  rr(ctx, r.x, r.y, r.w, r.h, 3);
  ctx.fillStyle = 'rgba(110,124,140,0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(105,118,133,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#7d8895';
  ctx.font = 'bold 9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(id === 'top' ? 'ВЕРХНЯЯ РЕЙКА' : 'НИЖНЯЯ РЕЙКА', r.x + r.w / 2, r.y + r.h / 2 + 3);
  ctx.restore();
}

function drawItemCard(item, x, y, w, h, dragging) {
  ctx.save();
  if (dragging) { ctx.shadowColor = 'rgba(245,166,35,0.7)'; ctx.shadowBlur = 16; }
  rr(ctx, x, y, w, h, 6);
  ctx.fillStyle = dragging ? 'rgba(245,166,35,0.2)' : 'rgba(245,248,250,0.96)';
  ctx.fill();
  ctx.strokeStyle = dragging ? '#f5a623' : '#98a2ae';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#39424e';
  ctx.font = 'bold 9px Inter, system-ui, sans-serif';
  ctx.fillText(item.label, x + w / 2, y + 16);
  ctx.fillStyle = '#7b8693';
  ctx.font = '7px Inter, system-ui, sans-serif';
  ctx.fillText(item.sub || '', x + w / 2, y + 26);

  const cx = x + w / 2, cy = y + 40;
  if (item.kind === 'connector') {
    rr(ctx, cx - 16, cy - 4, 32, 8, 2);
    ctx.fillStyle = '#cfd6de'; ctx.fill();
    ctx.strokeStyle = '#98a2ae'; ctx.stroke();
  } else if (item.kind === 'clamp') {
    rr(ctx, cx - 10, cy - 6, 20, 12, 2);
    ctx.fillStyle = '#cfd6de'; ctx.fill();
    ctx.strokeStyle = '#98a2ae'; ctx.stroke();
  } else if (item.kind === 'rail') {
    rr(ctx, cx - 18, cy - 3, 36, 6, 2);
    ctx.fillStyle = '#b9c2cc'; ctx.fill();
  } else if (item.kind === 'device') {
    rr(ctx, cx - 8, cy - 10, 16, 20, 2);
    ctx.fillStyle = '#2b6cb0'; ctx.fill();
  } else if (item.kind === 'busbar') {
    rr(ctx, cx - 16, cy - 4, 32, 8, 2);
    ctx.fillStyle = '#f2f5f8'; ctx.fill();
    ctx.strokeStyle = '#98a2ae'; ctx.stroke();
  }
}

function drawAssemblyTray() {
  rr(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 14);
  ctx.fillStyle = 'rgba(18,24,32,0.55)';
  ctx.fill();
  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = 'rgba(120,140,165,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7d8b9c';
  ctx.font = 'bold 10px Inter, system-ui, sans-serif';
  ctx.fillText('МОНТАЖНЫЙ ЛОТОК', TRAY.x + TRAY.w / 2, TRAY.y + 24);
  const items = assemblyItems();
  if (!items.length) {
    ctx.fillStyle = '#5c6a7a';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillText('Все детали установлены', TRAY.x + TRAY.w / 2, TRAY.y + 80);
    return;
  }
  for (const item of items) {
    const r = itemCardRect(item);
    if (r) drawItemCard(item, r.x, r.y, r.w, r.h, false);
  }
}

function drawAssemblyHints() {
  const t = nowMs();
  const a = state.assembly;
  if (!a || !state.hint || !state.hint.step || t >= state.hint.until) return;
  const pulse = 0.5 + 0.5 * Math.sin(t / 200);
  const step = state.hint.step;
  const ring = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r + pulse * 4, 0, TAU);
    ctx.strokeStyle = 'rgba(74,163,255,0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  };
  if (step === 'strip' || step === 'separate') ring(200, 70, 60);
  if (step === 'topConnector' || step === 'insertYellow' || step === 'tightenTop') ring(200, 220, 80);
  if (step === 'bottomConnector' || step === 'insertBlue' || step === 'tightenBottom') ring(200, 580, 80);
  if (step === 'cutYellow' || step === 'insertYellow') {
    for (const w of a.bundle.wires) if (w.color === 'L') ring(w.x, 70, 10);
  }
  if (step === 'clamps' || step === 'clipBlue' || step === 'tightenClamps') {
    for (const c of a.clamps) ring(c.x, c.y + 20, 26);
  }
  if (step === 'rails') { ring(490, 139, 60); ring(490, 477, 60); }
  if (step === 'devices') { for (const d of activeDevices) ring(d.x + devW(d) / 2, 130, 40); }
  if (step === 'busbars') {
    for (const b of a.busbars) {
      const d = activeDevices.find((d) => d.id === b.breaker);
      if (d) ring(d.x + devW(d) / 2, 200, 30);
    }
  }
}

function drawAssemblyPreview() {
  const a = state.assembly;
  if (!a || !a.selectedWire) return;
  const w = a.bundle.wires.find((w) => w.id === a.selectedWire);
  if (!w) return;
  const c = COLORS[w.color];
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -nowMs() / 45;
  ctx.beginPath();
  ctx.moveTo(w.x, 120);
  ctx.lineTo(state.pointer.x, state.pointer.y);
  ctx.strokeStyle = c.base;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(state.pointer.x, state.pointer.y, 6, 0, TAU);
  ctx.strokeStyle = c.light;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawAssembly() {
  const a = state.assembly;
  if (!a) return;
  drawPanel();
  drawBundle();
  drawConnector('top');
  drawConnector('bottom');
  for (const c of a.clamps) drawClampSpot(c);
  drawRailSlot('top');
  drawRailSlot('bottom');
  for (const d of activeDevices) drawDevice(d);
  for (const b of a.busbars) if (b.installed) drawBusbar(b);
  drawWires();
  drawNodes();
  drawAssemblyTray();
  drawPreview();
  drawAssemblyHints();
  drawAssemblyPreview();
  if (a.dragItem) drawItemCard(a.dragItem.item, a.dragItem.x, a.dragItem.y, 66, 56, true);
  drawParticles();
}

/* ---------------- state ---------------- */
const state = {
  running: false,
  paused: false,
  finished: false,
  startTime: 0,
  elapsed: 0,
  levelIndex: 0,
  level: LEVELS[0] || { id: 'l1', name: 'Уровень', tasks: [] },
  wires: [],
  history: [],
  wireSeq: 0,
  tasks: [],
  pendingNode: null,
  probeNode: null,
  hoverNode: null,
  hoverWire: null,
  dragWire: null,
  dragPart: null,
  meterMounted: false,
  selectedColor: 'auto',
  tool: 'hand',
  mistakes: 0,
  hintsUsed: 0,
  hint: null,
  flash: null,
  particles: [],
  pointer: { x: -100, y: -100, inside: false },
  lastUnlockedTool: null,
  assembly: null,
  toastTimer: 0,
};

const neatCache = { value: 100, dirty: true };

/* ---------------- audio ---------------- */
const Sound = {
  ctx: null,
  muted: !progress.settings.sound,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch (e) { this.ctx = null; }
  },
  beep(freq, dur = 0.08, type = 'sine', vol = 0.05, delay = 0) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.03);
    } catch (e) { /* ignore */ }
  },
  click() { this.beep(1250, 0.035, 'square', 0.022); },
  connect() { this.beep(680, 0.09, 'sine', 0.05); this.beep(1020, 0.12, 'sine', 0.04, 0.07); },
  error() { this.beep(170, 0.16, 'sawtooth', 0.045); this.beep(120, 0.2, 'sawtooth', 0.04, 0.1); },
  mount() { this.beep(200, 0.1, 'square', 0.05); this.beep(420, 0.12, 'sine', 0.05, 0.08); this.beep(840, 0.16, 'sine', 0.04, 0.17); },
  snip() { this.beep(2200, 0.03, 'square', 0.03); this.beep(1600, 0.04, 'square', 0.025, 0.04); },
  ratchet() { this.beep(1400, 0.03, 'square', 0.025); this.beep(900, 0.04, 'square', 0.02, 0.05); this.beep(1500, 0.03, 'square', 0.02, 0.1); },
  strip() { this.beep(1800, 0.05, 'sawtooth', 0.03); this.beep(2400, 0.06, 'sawtooth', 0.025, 0.06); },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.26, 'sine', 0.055, i * 0.12)); },
};

/* ---------------- canvas ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * DPR;
canvas.height = H * DPR;

// На телефоне увеличиваем щит и даём перемещать его отдельно от монтажа.
const phoneLayout = window.matchMedia('(max-width:700px), (max-height:500px) and (pointer:coarse)');
const camera = { zoom: 2.2, cx: 350, cy: 300, scale: 1, pan: false, drag: null };
let mobileDevice = null;
function fitCanvas() {
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const base = Math.min(r.width / W, r.height / H);
  if (!phoneLayout.matches) {
    canvas.style.width = Math.floor(W * base) + 'px';
    canvas.style.height = Math.floor(H * base) + 'px';
    canvas.style.left = ''; canvas.style.top = ''; canvas.style.transform = '';
    return;
  }
  const scale = base * camera.zoom;
  camera.scale = scale;
  const halfW = r.width / (2 * scale), halfH = r.height / (2 * scale);
  camera.cx = halfW >= W / 2 ? W / 2 : clamp(camera.cx, halfW, W - halfW);
  camera.cy = halfH >= H / 2 ? H / 2 : clamp(camera.cy, halfH, H - halfH);
  canvas.style.width = (W * scale) + 'px'; canvas.style.height = (H * scale) + 'px';
  canvas.style.left = (r.width / 2 - camera.cx * scale) + 'px';
  canvas.style.top = (r.height / 2 - camera.cy * scale) + 'px';
  canvas.style.transform = 'none';
}
function focusCamera(x, y) {
  if (!phoneLayout.matches) return;
  camera.cx = x; camera.cy = y;
  if (camera.zoom < 1.6) camera.zoom = 2.2;
  fitCanvas();
}
function setPan(on) { camera.pan = false; camera.drag = null; }
window.addEventListener('resize', () => {
  const d = activeDevices.find(d => d.id === mobileDevice && !d.installed);
  if (d && phoneLayout.matches) focusCamera(d.x + devW(d)/2, (DEV_TOP+DEV_BOT)/2);
  else fitCanvas();
});
if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe(document.getElementById('stage'));
fitCanvas();

/* ---------------- wire geometry (ортогональная укладка) ---------------- */
// Выбираем свободную горизонтальную дорожку, не проводя её через корпуса.
function defaultLane(A, B) {
  const preferred = A.y < 100 && B.y < 100 ? 56 :
    A.y > 400 && B.y > 400 ? 550 : 210;
  const lanes = [56, 184];
  for (let y = 210; y <= 410; y += 12) lanes.push(y);
  for (let y = 540; y <= 636; y += 12) lanes.push(y);
  const x1 = Math.min(A.x, B.x), x2 = Math.max(A.x, B.x);
  let best = lanes[0], bestCost = Infinity;
  for (const lane of lanes) {
    let cost = Math.abs(lane - preferred) / 100;
    for (const d of activeDevices) {
      if (d.installed && lane > 80 && lane < 180 && x2 > d.x && x1 < d.x + devW(d)) cost += 100;
    }
    for (const w of state.wires) {
      const p = wirePoints(w);
      if (!p || Math.abs(lane - p.lane) >= 9) continue;
      const overlap = Math.min(x2, Math.max(p.A.x, p.B.x)) - Math.max(x1, Math.min(p.A.x, p.B.x));
      if (overlap > 12) cost += 50;
    }
    if (cost < bestCost) { best = lane; bestCost = cost; }
  }
  return best;
}

function wirePoints(w) {
  const A = nodes[w.a], B = nodes[w.b];
  if (!A || !B) return null;
  const lane = clamp(w.lane, LANE_MIN, LANE_MAX);
  return { A, B, lane, p1: { x: A.x, y: lane }, p2: { x: B.x, y: lane } };
}

function sampleWire(w) {
  const p = wirePoints(w);
  if (!p) return [];
  return [p.A, p.p1, p.p2, p.B];
}

function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  return len;
}

function wireBadgePos(w) {
  const p = wirePoints(w);
  if (!p) return null;
  return { x: (p.p1.x + p.p2.x) / 2, y: (p.p1.y + p.p2.y) / 2 + 34 };
}

/* ---------------- neatness ---------------- */
// Оцениваем только видимые проблемы, которые можно исправить укладкой.
// Пересечения под прямым углом и длину не штрафуем: это 2D-проекция щита.
function neatnessDetails() {
  let overlaps = 0, overDevices = 0;
  const paths = state.wires.map(w => ({w, p: wirePoints(w)})).filter(x => x.p);
  for (const {p} of paths) {
    const lo = Math.min(p.A.x, p.B.x), hi = Math.max(p.A.x, p.B.x);
    if (hi - lo > 12 && activeDevices.some(d => d.installed &&
        p.lane > 80 && p.lane < 180 && hi > d.x && lo < d.x + devW(d))) overDevices++;
  }
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i].p, b = paths[j].p;
      if (Math.abs(a.lane - b.lane) >= 8) continue;
      const overlap = Math.min(Math.max(a.A.x, a.B.x), Math.max(b.A.x, b.B.x)) -
        Math.max(Math.min(a.A.x, a.B.x), Math.min(b.A.x, b.B.x));
      // Небольшой общий участок у клеммы не считается наложением.
      if (overlap > 16) overlaps++;
    }
  }
  return { overlaps, overDevices, value: Math.max(0, 100 - overlaps * 10 - overDevices * 15) };
}

function computeNeatness() { return neatnessDetails().value; }

function getNeatness() {
  if (neatCache.dirty) {
    neatCache.value = computeNeatness();
    neatCache.dirty = false;
  }
  return neatCache.value;
}

/* ---------------- particles ---------------- */
function burst(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const sp = 40 + Math.random() * 150;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40,
      life: 0.5 + Math.random() * 0.5,
      size: 1.5 + Math.random() * 2.5,
      color: color || '#f5a623',
    });
  }
}

/* ============================================================
   RENDERING
   ============================================================ */
function drawWall() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b2430');
  g.addColorStop(0.55, '#121820');
  g.addColorStop(1, '#0a0e13');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.022)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  const vg = ctx.createRadialGradient(W / 2, H / 2, 180, W / 2, H / 2, 720);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawScrew(x, y, r = 7) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  g.addColorStop(0, '#f2f5f8');
  g.addColorStop(0.55, '#b9c2cc');
  g.addColorStop(1, '#7d8794');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,70,80,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y);
  ctx.lineTo(x + r * 0.55, y);
  ctx.moveTo(x, y - r * 0.55);
  ctx.lineTo(x, y + r * 0.55);
  ctx.strokeStyle = 'rgba(70,80,92,0.75)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawSticker(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(22, 18);
  ctx.lineTo(-22, 18);
  ctx.closePath();
  ctx.fillStyle = '#f2c53d';
  ctx.fill();
  ctx.strokeStyle = '#8a6a12';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(2, -11);
  ctx.lineTo(-5, 3);
  ctx.lineTo(1, 3);
  ctx.lineTo(-2, 13);
  ctx.lineTo(7, -2);
  ctx.lineTo(1, -2);
  ctx.closePath();
  ctx.fillStyle = '#2a2109';
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#6c7784';
  ctx.font = 'bold 9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('220/380 В', x, y + 32);
}

function drawSchematicSticker(x, y) {
  ctx.save();
  rr(ctx, x - 36, y - 28, 72, 56, 4);
  ctx.fillStyle = '#f3f6f9';
  ctx.fill();
  ctx.strokeStyle = '#a3adb8';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = '#5a6572';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 26, y - 14);
  ctx.lineTo(x - 10, y - 14);
  ctx.lineTo(x - 10, y + 2);
  ctx.lineTo(x + 6, y + 2);
  ctx.lineTo(x + 6, y - 14);
  ctx.lineTo(x + 24, y - 14);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - 10, y - 14, 2.4, 0, TAU);
  ctx.arc(x + 6, y - 14, 2.4, 0, TAU);
  ctx.fillStyle = '#5a6572';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 20, y + 12);
  ctx.lineTo(x - 20, y + 4);
  ctx.moveTo(x - 26, y + 8);
  ctx.lineTo(x - 14, y + 8);
  ctx.moveTo(x + 16, y + 12);
  ctx.lineTo(x + 16, y + 4);
  ctx.moveTo(x + 10, y + 8);
  ctx.lineTo(x + 22, y + 8);
  ctx.stroke();
  ctx.fillStyle = '#7b8693';
  ctx.font = 'bold 7px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('СХЕМА', x, y + 22);
  ctx.restore();
}

function drawPanel() {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  rr(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.r);
  const g = ctx.createLinearGradient(PANEL.x, PANEL.y, PANEL.x + PANEL.w, PANEL.y + PANEL.h);
  g.addColorStop(0, '#e6ebf1');
  g.addColorStop(0.45, '#cfd6de');
  g.addColorStop(1, '#aeb8c2');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  rr(ctx, PANEL.x + 1.5, PANEL.y + 1.5, PANEL.w - 3, PANEL.h - 3, PANEL.r - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  rr(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.r);
  ctx.clip();
  const ig = ctx.createLinearGradient(0, PANEL.y, 0, PANEL.y + 46);
  ig.addColorStop(0, 'rgba(0,0,0,0.16)');
  ig.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ig;
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, 46);
  ctx.restore();

  drawScrew(64, 44);
  drawScrew(916, 44);
  drawScrew(64, 656);
  drawScrew(916, 656);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#5d6875';
  ctx.font = 'bold 13px Inter, system-ui, sans-serif';
  ctx.fillText('ЩИТ ЭЛЕКТРОСНАБЖЕНИЯ', 70, 44);
  ctx.fillStyle = '#7d8895';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.fillText('220 / 380 В · 50 Гц · TN-S · ' + (state.level ? state.level.name : ''), 70, 57);

  drawSticker(806, 556);
  drawSchematicSticker(628, 566);
}

function drawRail(r) {
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, '#8d97a3');
  g.addColorStop(0.3, '#eef2f6');
  g.addColorStop(0.62, '#bcc5cf');
  g.addColorStop(1, '#79838f');
  rr(ctx, r.x, r.y, r.w, r.h, 3);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,70,80,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(55,65,78,0.22)';
  for (let x = r.x + 10; x < r.x + r.w - 8; x += 24) ctx.fillRect(x, r.y + 4, 10, r.h - 8);
}

function drawDeviceSlot(d) {
  const w = devW(d);
  rr(ctx, d.x, DEV_TOP, w, DEV_BOT - DEV_TOP, 6);
  ctx.fillStyle = 'rgba(110,124,140,0.1)';
  ctx.fill();
  ctx.setLineDash([7, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(105,118,133,0.6)';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7d8895';
  ctx.font = 'bold 11px Inter, system-ui, sans-serif';
  ctx.fillText(d.label, d.x + w / 2, DEV_TOP + 70);
  ctx.font = '8px Inter, system-ui, sans-serif';
  ctx.fillText('перетащите', d.x + w / 2, DEV_TOP + 84);
}

function drawDevice(d) {
  if (!d.installed) { drawDeviceSlot(d); return; }
  const w = devW(d);
  const x = d.x, y = DEV_TOP, h = DEV_BOT - DEV_TOP;

  if (d.kind === 'meter' || d.kind === 'meter3') { drawMeter(x, y, w, h, {}); return; }

  rr(ctx, x, y, w, h, 5);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#f5f8fa');
  g.addColorStop(0.5, '#e5eaf0');
  g.addColorStop(1, '#cbd3db');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#98a2ae';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (d.mods > 1) {
    for (let i = 1; i < d.mods; i++) {
      const sx = x + i * (MOD_W + MOD_GAP) - MOD_GAP / 2;
      ctx.beginPath();
      ctx.moveTo(sx, y + 5);
      ctx.lineTo(sx, y + h - 5);
      ctx.strokeStyle = 'rgba(120,130,142,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  const cx = x + w / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#39424e';
  ctx.font = 'bold 11px Inter, system-ui, sans-serif';
  ctx.fillText(d.label, cx, y + 38);
  ctx.fillStyle = '#7b8693';
  ctx.font = '8px Inter, system-ui, sans-serif';
  ctx.fillText(d.sub, cx, y + 49);

  const isContactor = d.kind === 'contactor';
  if (d.kind === 'breaker3') {
    for (let i = 0; i < 3; i++) {
      const tx = x + 22 + i * 48;
      rr(ctx, tx - 14, y + 56, 28, 48, 4);
      ctx.fillStyle = '#c3cbd4'; ctx.fill();
      ctx.strokeStyle = '#a6afb9'; ctx.lineWidth = 1; ctx.stroke();
      const tg3 = ctx.createLinearGradient(0, y + 60, 0, y + 100);
      tg3.addColorStop(0, '#63b0f2'); tg3.addColorStop(1, '#2b6cb0');
      rr(ctx, tx - 9, y + 60, 18, 40, 3);
      ctx.fillStyle = tg3; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(tx - 6, y + 64, 12, 3);
    }
  } else if (d.kind === 'button') {
    ctx.beginPath(); ctx.arc(cx, y + 80, 14, 0, TAU);
    ctx.fillStyle = d.sub === 'стоп' ? '#d64545' : '#3fae5a'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 4, y + 76, 4, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fill();
  } else if (d.kind === 'thermal') {
    ctx.beginPath(); ctx.arc(cx, y + 80, 16, 0, TAU);
    ctx.fillStyle = '#e8edf2'; ctx.fill();
    ctx.strokeStyle = '#98a2ae'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, y + 80); ctx.lineTo(cx + 9, y + 70);
    ctx.strokeStyle = '#2b6cb0'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, y + 80, 2.5, 0, TAU); ctx.fillStyle = '#5a6572'; ctx.fill();
  } else if (d.kind === 'motor') {
    ctx.beginPath(); ctx.arc(cx, y + 80, 16, 0, TAU);
    ctx.fillStyle = '#c3cbd4'; ctx.fill();
    ctx.strokeStyle = '#98a2ae'; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + nowMs() / 600;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * 7, y + 80 + Math.sin(a) * 7, 6, 3, a, 0, TAU);
      ctx.fillStyle = '#8d97a3'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, y + 80, 3, 0, TAU); ctx.fillStyle = '#5a6572'; ctx.fill();
  } else if (d.kind === 'socket') {
    rr(ctx, cx - 14, y + 58, 28, 44, 4);
    ctx.fillStyle = '#e8edf2'; ctx.fill();
    ctx.strokeStyle = '#98a2ae'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 6, y + 80, 3, 0, TAU); ctx.arc(cx + 6, y + 80, 3, 0, TAU);
    ctx.fillStyle = '#5a6572'; ctx.fill();
  } else {
    rr(ctx, cx - 14, y + 56, 28, 48, 4);
    ctx.fillStyle = '#c3cbd4'; ctx.fill();
    ctx.strokeStyle = '#a6afb9'; ctx.lineWidth = 1; ctx.stroke();
    const tg = ctx.createLinearGradient(0, y + 60, 0, y + 100);
    if (isContactor) { tg.addColorStop(0, '#9aa7b5'); tg.addColorStop(1, '#5d6b7a'); }
    else { tg.addColorStop(0, '#63b0f2'); tg.addColorStop(1, '#2b6cb0'); }
    rr(ctx, cx - 9, y + 60, 18, 40, 3);
    ctx.fillStyle = tg; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(cx - 6, y + 64, 12, 3);
  }

  if (d.kind === 'rcd') {
    ctx.beginPath();
    ctx.arc(x + w - 14, y + 70, 5, 0, TAU);
    ctx.fillStyle = '#e8edf2';
    ctx.fill();
    ctx.strokeStyle = '#9aa4b0';
    ctx.stroke();
    ctx.fillStyle = '#7b8693';
    ctx.font = '6px Inter, system-ui, sans-serif';
    ctx.fillText('TEST', x + w - 14, y + 84);
  }
  if (isContactor) {
    ctx.fillStyle = '#7b8693';
    ctx.font = '6px Inter, system-ui, sans-serif';
    ctx.fillText('KM', cx, y + 114);
  }
}

function drawMeter(x, y, w, h, opts) {
  opts = opts || {};
  ctx.save();
  if (opts.hover || opts.dragging) { ctx.shadowColor = 'rgba(245,166,35,0.75)'; ctx.shadowBlur = 20; }
  rr(ctx, x, y, w, h, 6);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#f4f7fa');
  g.addColorStop(0.6, '#e0e6ec');
  g.addColorStop(1, '#c6ced7');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#96a0ac';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#3b4550';
  ctx.font = 'bold 11px Inter, system-ui, sans-serif';
  ctx.fillText('СЧЁТЧИК', x + w / 2, y + 16);
  ctx.fillStyle = '#7b8693';
  ctx.font = '8px Inter, system-ui, sans-serif';
  ctx.fillText('1ф · 220 В · 50 Гц', x + w / 2, y + 27);

  rr(ctx, x + 12, y + 34, w - 24, 44, 4);
  ctx.fillStyle = '#152019';
  ctx.fill();
  ctx.strokeStyle = '#0b120d';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#7ef0a0';
  ctx.font = 'bold 19px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('00000', x + w - 20, y + 63);
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillStyle = '#4fbf74';
  ctx.fillText('kWh', x + w - 20, y + 73);

  const blink = Math.sin(nowMs() / 320) > 0.55;
  ctx.beginPath();
  ctx.arc(x + w - 18, y + 26, 3, 0, TAU);
  ctx.fillStyle = blink ? '#ff5a4d' : '#5a2a26';
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#8b95a1';
  ctx.font = '7px Inter, system-ui, sans-serif';
  ctx.fillText('МЕРКУРИЙ 201', x + w / 2, y + 92);

  const offs = [16, 52, 88, 124];
  offs.forEach((o, i) => {
    const tx = x + o, ty = y + 120;
    ctx.beginPath();
    ctx.arc(tx, ty, 5, 0, TAU);
    ctx.fillStyle = '#39424e';
    ctx.fill();
    ctx.strokeStyle = '#cfd6de';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#6b7683';
    ctx.font = '7px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), tx, ty - 8);
  });
}

function drawClamp(b) {
  const { x, y, w, h } = b;
  rr(ctx, x, y, w, h, 4);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#eef2f6');
  g.addColorStop(1, '#c6ced7');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#98a2ae';
  ctx.lineWidth = 1;
  ctx.stroke();

  const connected = state.wires.some((w) => w.a === b.id || w.b === b.id);
  ctx.save();
  ctx.translate(x + w / 2, y + 16);
  ctx.rotate(connected ? 0 : -0.5);
  rr(ctx, -13, -5, 26, 10, 3);
  ctx.fillStyle = COLORS[b.type].base;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x + w / 2, y + 14, 5, 0, TAU);
  ctx.fillStyle = '#2b333d';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x + w / 2, y + h - 30, 4, 0, TAU);
  ctx.fillStyle = COLORS[b.type].base;
  ctx.fill();

  ctx.fillStyle = '#4a5460';
  ctx.font = 'bold 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(b.id.toUpperCase(), x + w / 2, y + h - 12);
}

function drawBusbar(bar) {
  rr(ctx, bar.x, bar.y, bar.w, bar.h, 5);
  const g = ctx.createLinearGradient(0, bar.y, 0, bar.y + bar.h);
  if (bar.white) {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#f0f3f6');
    g.addColorStop(1, '#d5dbe2');
  } else {
    g.addColorStop(0, '#e2e8ee');
    g.addColorStop(0.5, '#bcc5cf');
    g.addColorStop(1, '#8d97a3');
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#7d8794';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = COLORS[bar.type].base;
  ctx.fillRect(bar.x + 6, bar.y + 4, bar.w - 12, 4);

  for (let i = 0; i < 5; i++) drawScrew(bar.x + 20 + i * ((bar.w - 40) / 4), bar.y + bar.h / 2, 4.5);

  ctx.fillStyle = '#3b4550';
  ctx.font = 'bold 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(bar.label, bar.x + 8, bar.y - 7);
}

function drawWires() {
  const t = nowMs();
  for (const w of state.wires) {
    const p = wirePoints(w);
    if (!p) continue;
    const c = COLORS[w.color] || COLORS.L;
    const hovered = state.hoverWire && state.hoverWire.wire === w;
    const mid = { x: (p.p1.x + p.p2.x) / 2, y: (p.p1.y + p.p2.y) / 2 };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(p.A.x, p.A.y);
    ctx.lineTo(p.p1.x, p.p1.y);
    ctx.lineTo(p.p2.x, p.p2.y);
    ctx.lineTo(p.B.x, p.B.y);

    ctx.save();
    ctx.translate(2, 3);
    ctx.strokeStyle = 'rgba(15,20,26,0.22)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = c.base;
    ctx.lineWidth = hovered ? 7.5 : 6.5;
    ctx.stroke();

    ctx.strokeStyle = c.light;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (w.color === 'PE') {
      ctx.setLineDash([5, 7]);
      ctx.strokeStyle = '#e9e35a';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!w.cut) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (w.stripped) {
      ctx.beginPath();
      ctx.arc(p.A.x, p.A.y, 3.2, 0, TAU);
      ctx.fillStyle = '#d98a52';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.B.x, p.B.y, 3.2, 0, TAU);
      ctx.fill();
    }

    const age = t - (w.born || 0);
    if (age < 420) {
      ctx.globalAlpha = (1 - age / 420) * 0.4;
      ctx.strokeStyle = c.light;
      ctx.lineWidth = 13;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Скрытый обрыв становится видимым только после прозвонки.
    if (w.broken && w.detected) {
      ctx.beginPath(); ctx.arc(mid.x, mid.y, 13, 0, TAU);
      ctx.fillStyle = '#e5484d'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = 'bold 16px system-ui'; ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', mid.x, mid.y + 1);
    } else {
    // ручка укладки
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, 6, 0, TAU);
    ctx.fillStyle = c.base;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, 2, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    }

    ctx.restore();

    if (hovered && !state.dragWire) {
      const bp = wireBadgePos(w);
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, 11, 0, TAU);
      ctx.fillStyle = '#e5484d';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bp.x - 4, bp.y - 4);
      ctx.lineTo(bp.x + 4, bp.y + 4);
      ctx.moveTo(bp.x + 4, bp.y - 4);
      ctx.lineTo(bp.x - 4, bp.y + 4);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawNodes() {
  const t = nowMs();
  for (const id in nodes) {
    const n = nodes[id];
    const hovered = state.hoverNode === id;
    const pending = state.pendingNode === id || state.probeNode === id;
    const hinted = state.hint && state.hint.nodes && state.hint.nodes.indexOf(id) >= 0 && t < state.hint.until;
    const flashing = state.flash && state.flash.nodes.indexOf(id) >= 0 && t < state.flash.until;
    const loose = state.wires.some((w) => (w.a === id || w.b === id) && (!w.cut || !w.stripped || !w.tightened));

    ctx.beginPath();
    ctx.arc(n.x, n.y, 6, 0, TAU);
    ctx.fillStyle = '#2b333d';
    ctx.fill();
    ctx.strokeStyle = '#e8edf3';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(n.x, n.y, 2.2, 0, TAU);
    ctx.fillStyle = '#aab4c0';
    ctx.fill();

    if (loose) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 9.5, 0, TAU);
      ctx.strokeStyle = 'rgba(245,166,35,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (hovered || pending || hinted || flashing) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 170);
      let col = 'rgba(245,166,35,0.85)';
      if (pending) col = '#f5a623';
      else if (flashing) col = state.flash.color || '#ef5350';
      else if (hinted) col = '#4aa3ff';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 10 + pulse * 3, 0, TAU);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (n.showLabel) {
      ctx.fillStyle = '#6d7885';
      ctx.font = '8px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.dir.y < 0 ? n.y - 10 : n.y + 14);
    }
  }
}

function partCardRect(d) {
  const uninstalled = activeDevices.filter((x) => !x.installed);
  const i = uninstalled.indexOf(d);
  if (i < 0) return null;
  return { x: TRAY.x + 10, y: TRAY.y + 40 + i * 72, w: 140, h: 64 };
}

function drawPartCard(d, x, y, w, h, dragging) {
  ctx.save();
  if (dragging) { ctx.shadowColor = 'rgba(245,166,35,0.7)'; ctx.shadowBlur = 18; }
  rr(ctx, x, y, w, h, 8);
  ctx.fillStyle = dragging ? 'rgba(245,166,35,0.2)' : 'rgba(245,248,250,0.96)';
  ctx.fill();
  ctx.strokeStyle = dragging ? '#f5a623' : '#98a2ae';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#39424e';
  ctx.font = 'bold 12px Inter, system-ui, sans-serif';
  ctx.fillText(d.label, x + 10, y + 20);
  ctx.fillStyle = '#7b8693';
  ctx.font = '8px Inter, system-ui, sans-serif';
  ctx.fillText(d.sub || ' ', x + 10, y + 32);

  if (d.kind === 'meter' || d.kind === 'meter3') {
    rr(ctx, x + 10, y + 42, w - 20, 24, 3);
    ctx.fillStyle = '#152019';
    ctx.fill();
    ctx.fillStyle = '#7ef0a0';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('00000', x + w - 14, y + 59);
  } else {
    rr(ctx, x + w / 2 - 9, y + 42, 18, 26, 3);
    ctx.fillStyle = '#c3cbd4';
    ctx.fill();
    rr(ctx, x + w / 2 - 6, y + 45, 12, 20, 2);
    ctx.fillStyle = d.kind === 'contactor' ? '#5d6b7a' : '#2b6cb0';
    ctx.fill();
  }
}

function drawTray() {
  rr(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 14);
  ctx.fillStyle = 'rgba(18,24,32,0.55)';
  ctx.fill();
  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = 'rgba(120,140,165,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7d8b9c';
  ctx.font = 'bold 10px Inter, system-ui, sans-serif';
  ctx.fillText('МОНТАЖНЫЙ ЛОТОК', TRAY.x + TRAY.w / 2, TRAY.y + 24);

  const uninstalled = activeDevices.filter((d) => !d.installed);
  if (!uninstalled.length) {
    ctx.fillStyle = '#5c6a7a';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillText('Все детали установлены', TRAY.x + TRAY.w / 2, TRAY.y + 80);
    return;
  }
  for (const d of uninstalled) {
    const r = partCardRect(d);
    if (r) drawPartCard(d, r.x, r.y, r.w, r.h, false);
  }
}

function drawPreview() {
  if (!state.pendingNode || !state.running || state.finished || state.paused) return;
  const A = nodes[state.pendingNode];
  if (!A) return;
  let target = { x: state.pointer.x, y: state.pointer.y, type: null };
  if (state.hoverNode && state.hoverNode !== state.pendingNode && nodes[state.hoverNode]) target = nodes[state.hoverNode];
  const colorKey = state.selectedColor === 'auto' ? (target.type || A.type) : state.selectedColor;
  const c = COLORS[colorKey] || COLORS.L;
  const lane = clamp(target.y, LANE_MIN, LANE_MAX);

  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.lineDashOffset = -nowMs() / 45;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(A.x, lane);
  ctx.lineTo(target.x, lane);
  ctx.lineTo(target.x, target.y);
  ctx.strokeStyle = c.base;
  ctx.lineWidth = 5;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(target.x, target.y, 7, 0, TAU);
  ctx.strokeStyle = c.light;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawHints() {
  const t = nowMs();
  if (!state.hint || t >= state.hint.until) return;
  const pulse = 0.5 + 0.5 * Math.sin(t / 200);
  if (state.hint.install) {
    const d = activeDevices.find((x) => x.id === state.hint.install);
    if (!d) return;
    const slot = { x: d.x, y: DEV_TOP, w: devW(d), h: DEV_BOT - DEV_TOP };
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -t / 60;
    rr(ctx, slot.x - 6, slot.y - 6, slot.w + 12, slot.h + 12, 9);
    ctx.strokeStyle = 'rgba(74,163,255,' + (0.5 + pulse * 0.5) + ')';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    const r = partCardRect(d);
    if (r) {
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 50 + pulse * 6, 0, TAU);
      ctx.strokeStyle = 'rgba(74,163,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / 0.6, 0, 1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, TAU);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawScene() {
  if (state.assembly) { drawAssembly(); return; }
  drawPanel();
  drawRail(RAIL_TOP);
  for (const d of activeDevices) drawDevice(d);
  drawRail(RAIL_BOT);
  for (const b of activeClamps) drawClamp(b);
  for (const b of activeBuses) drawBusbar(b);

  drawWires();
  drawNodes();
  drawTray();
  drawPreview();
  drawHints();

  if (state.dragPart) {
    const d = activeDevices.find((x) => x.id === state.dragPart.deviceId);
    if (d) drawPartCard(d, state.dragPart.x, state.dragPart.y, 140, 64, true);
  }
  drawParticles();
}

function drawToolCursor() {
  if (state.tool === 'hand') return;
  const p = state.pointer;
  if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return;
  const t = TOOLS[state.tool];
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x + 17, p.y - 17, 13, 0, TAU);
  ctx.fillStyle = 'rgba(16,21,28,0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,166,35,0.65)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.icon, p.x + 17, p.y - 16);
  ctx.restore();
}

function drawScreenOverlays() {
  drawToolCursor();
}

/* ---------------- loop ---------------- */
let lastT = 0;
let hudTick = 0;

function loop(t) {
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
  lastT = t;

  if (state.running && !state.finished && !state.paused) {
    state.elapsed = (t - state.startTime) / 1000;
  }

  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 420 * dt;
    p.life -= dt;
  }
  if (state.particles.length) state.particles = state.particles.filter((p) => p.life > 0);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  drawWall();
  drawScene();
  drawScreenOverlays();

  hudTick += dt;
  if (hudTick > 0.1) { hudTick = 0; updateHUD(); }

  requestAnimationFrame(loop);
}

/* ---------------- hit testing ---------------- */
function getPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * W,
    y: ((e.clientY - r.top) / r.height) * H,
  };
}

function pointInRect(p, r, pad) {
  pad = pad || 0;
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

function hitNode(p, radius) {
  let best = null, bestD = radius || 15;
  for (const id in nodes) {
    const n = nodes[id];
    const d = dist(p.x, p.y, n.x, n.y);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function hitWire(p, radius) {
  let best = null, bestD = radius || 12;
  for (const w of state.wires) {
    const pts = sampleWire(w);
    for (let i = 1; i < pts.length; i++) {
      const d = pointSegDist(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      if (d < bestD) { bestD = d; best = w; }
    }
  }
  if (!best) return null;
  const bp = wireBadgePos(best);
  return { wire: best, badge: !!bp && dist(p.x, p.y, bp.x, bp.y) < 14, dist: bestD };
}

// Если новый провод пересекает старый, инструмент попадает в него при почти равном расстоянии.
function hitWireForWork(p, radius) {
  const best = hitWire(p, radius);
  const last = state.wires.find(w => w.id === state.history[state.history.length - 1]);
  const eligible = last && (state.tool === 'cutters' ? !last.cut : state.tool === 'stripper' ? last.cut && !last.stripped : state.tool === 'screwdriver' ? last.cut && last.stripped && !last.tightened : false);
  if (!eligible) return best;
  const pts = sampleWire(last); let distance = Infinity;
  for (let i=1; i<pts.length; i++) distance = Math.min(distance, pointSegDist(p.x,p.y,pts[i-1].x,pts[i-1].y,pts[i].x,pts[i].y));
  if (distance < radius && (!best || distance <= best.dist + 6)) return {wire:last,dist:distance,badge:false};
  return best;
}

function pick(p, nodeRadius, wireRadius) {
  if (state.hoverWire) {
    const bp = wireBadgePos(state.hoverWire.wire);
    if (bp && dist(p.x, p.y, bp.x, bp.y) < 16) return { wire: state.hoverWire.wire, badge: true, dist: 99 };
  }
  const n = hitNode(p, nodeRadius || 18);
  const wh = hitWire(p, wireRadius || 12);
  if (n && wh) {
    const dn = dist(p.x, p.y, n.x, n.y);
    if (dn <= 6) return { node: n };
    return wh.dist < dn ? wh : { node: n };
  }
  if (n) return { node: n };
  if (wh) return wh;
  return null;
}

function hitPart(p) {
  for (const d of activeDevices) {
    if (d.installed) continue;
    const r = partCardRect(d);
    if (r && pointInRect(p, r, 8)) return d;
  }
  return null;
}

/* ---------------- game actions ---------------- */
function toast(text, kind) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = 'toast show ' + (kind || 'info');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.className = 'toast'; }, 2700);
}

function flashNodes(a, b, color) {
  state.flash = { nodes: [a, b], color: color || '#ef5350', until: nowMs() + 650 };
}

function pairMatch(def, a, b) {
  return (def.from === a && def.to === b) || (def.from === b && def.to === a);
}

function findWireTask(a, b) {
  return state.tasks.find((t) => t.def.type === 'wire' && pairMatch(t.def, a, b));
}

function nodeLabel(id) {
  const n = nodes[id];
  if (!n) return id;
  if (n.devId === 'meter') return 'счётчик ' + n.label;
  if (n.devId === 'nbus' || n.devId === 'pebus') return n.label + '-шина';
  return n.label;
}

function completeTask(task) {
  if (!task || task.done) return;
  task.done = true;
  Sound.connect();
  toast('✓ ' + task.def.text, 'ok');
  renderTasks();
  updateHUD();
  if (state.tasks.every((t) => t.done)) finishGame();
}

function installDevice(deviceId) {
  const d = activeDevices.find((x) => x.id === deviceId);
  if (!d || d.installed) return;
  d.installed = true;
  if (mobileDevice === deviceId) mobileDevice = null;
  neatCache.dirty = true;
  addDeviceNodes(d);
  if (d.kind === 'meter' || d.kind === 'meter3') state.meterMounted = true;
  Sound.mount();
  burst(d.x + devW(d) / 2, DEV_TOP + 66, '#f5a623', 14);
  const t = state.tasks.find((x) => x.def.type === 'install' && x.def.device === deviceId);
  if (t) completeTask(t);
  else { renderTasks(); updateHUD(); }
}

function finishPartDrag() {
  const m = state.dragPart;
  if (!m) return;
  const d = activeDevices.find((x) => x.id === m.deviceId);
  if (d) {
    const slot = { x: d.x, y: DEV_TOP, w: devW(d), h: DEV_BOT - DEV_TOP };
    const cx = m.x + 70, cy = m.y + 32;
    if (pointInRect({ x: cx, y: cy }, slot, 24)) installDevice(d.id);
    else toast('Перетащите деталь в её контур на рейке', 'info');
  }
  state.dragPart = null;
}

function pullWire(aId, bId) {
  if (!aId || !bId || aId === bId) return;
  if (!nodes[aId] || !nodes[bId]) return;

  const task = findWireTask(aId, bId);
  if (!task) {
    state.mistakes++;
    Sound.error();
    flashNodes(aId, bId, '#ef5350');
    toast('Неверное соединение — проверьте задание', 'err');
    updateHUD();
    return;
  }
  if (task.done) { toast('Эта цепь уже подключена', 'info'); return; }

  const colorKey = state.selectedColor === 'auto' ? task.def.color : state.selectedColor;
  if (colorKey !== task.def.color) {
    state.mistakes++;
    Sound.error();
    flashNodes(aId, bId, '#ef5350');
    toast('Нужен ' + COLORS[task.def.color].name.toLowerCase() + ' провод', 'err');
    updateHUD();
    return;
  }
  if (state.wires.some((w) => (w.a === aId && w.b === bId) || (w.a === bId && w.b === aId))) {
    toast('Провод уже проложен', 'info');
    return;
  }

  const A = nodes[aId], B = nodes[bId];
  const wire = {
    id: ++state.wireSeq,
    a: aId, b: bId,
    color: task.def.color,
    lane: defaultLane(A, B),
    cut: false,
    stripped: false,
    tightened: false,
    born: nowMs(),
  };
  state.wires.push(wire);
  state.history.push(wire.id);
  neatCache.dirty = true;

  Sound.connect();
  burst((A.x + B.x) / 2, (A.y + B.y) / 2, COLORS[wire.color].light, 8);
  toast('Провод вставлен в зажимы. Отрежьте кусачками', 'ok');
  pulseTool('cutters');
  renderTasks();
  updateHUD();
}

function cutWire(wire) {
  if (wire.cut) { toast('Провод уже отрезан', 'info'); return; }
  wire.cut = true;
  Sound.snip();
  toast('Отрезано. Зачистите концы стриппером', 'ok');
  pulseTool('stripper');
  checkWire(wire);
  updateHUD();
}

function stripWire(wire) {
  if (wire.stripped) { toast('Концы уже зачищены', 'info'); return; }
  if (!wire.cut) {
    toast('Сначала отрежьте провод кусачками', 'info');
    pulseTool('cutters');
    return;
  }
  wire.stripped = true;
  Sound.strip();
  toast('Концы зачищены', 'ok');
  checkWire(wire);
  updateHUD();
}

function tightenWire(wire) {
  if (wire.tightened) { toast('Клеммы уже затянуты', 'info'); return; }
  if (!wire.cut || !wire.stripped) { toast('Сначала отрежьте и зачистите провод', 'info'); return; }
  wire.tightened = true;
  Sound.ratchet();
  toast('Клеммы затянуты', 'ok');
  checkWire(wire);
  updateHUD();
}

function checkWire(wire) {
  if (!wire.cut || !wire.stripped || !wire.tightened) return;
  const task = findWireTask(wire.a, wire.b);
  if (task && !task.done) {
    const A = nodes[wire.a], B = nodes[wire.b];
    burst((A.x + B.x) / 2, (A.y + B.y) / 2, '#4ade80', 12);
    completeTask(task);
  }
  const replacement = state.tasks.find(t => t.def.type === 'replace' && !t.done && t.def.from && pairMatch(t.def, wire.a, wire.b));
  if (replacement && !wire.broken) completeTask(replacement);
}

// Проверка только одного прямого игрового соединения, а не электрической сети.
function probeAt(id) {
  if (!nodes[id]) return;
  if (!state.probeNode) {
    state.probeNode = id;
    Sound.click();
    toast('Первый щуп установлен. Выберите вторую клемму', 'info');
    return;
  }
  const first = state.probeNode;
  if (first === id) { toast('Выберите другую клемму', 'info'); return; }
  state.probeNode = null;
  const wire = state.wires.find(w => (w.a === first && w.b === id) || (w.b === first && w.a === id));
  if (!wire || !wire.cut || !wire.stripped || !wire.tightened) {
    flashNodes(first, id, '#ef5350');
    toast('Нет контакта: провод отсутствует или не подготовлен', 'err');
    Sound.error();
    return;
  }
  const diagnostic = state.tasks.find(t => t.def.type === 'diagnose' && !t.done && pairMatch(t.def, first, id));
  if (wire.broken) {
    wire.detected = true;
    flashNodes(first, id, '#ef5350');
    Sound.error();
    if (diagnostic) {
      diagnostic.result = 'Обрыв';
      const replacement = state.tasks.find(t => t.def.type === 'replace' && !t.def.from);
      if (replacement) {
        const finalTest = state.tasks.find(t => t.def.type === 'test' && t.def.slot === replacement.def.slot);
        const label = diagnostic.def.text.replace('Проверьте: ', '');
        Object.assign(replacement.def, {from:first, to:id, text:'Замените: ' + label});
        if (finalTest) Object.assign(finalTest.def, {from:first, to:id, text:'Проверьте после замены: ' + label});
      }
      completeTask(diagnostic);
    }
    toast('ОБРЫВ! Выберите «Снять провод», затем замените его.', 'err');
    return;
  }
  flashNodes(first, id, '#4ade80');
  if (diagnostic) {
    diagnostic.result = 'Контакт есть';
    completeTask(diagnostic);
    toast('Контакт есть: провод исправен', 'ok');
    return;
  }
  const task = state.tasks.find(t => t.def.type === 'test' && !t.done && t.def.from && pairMatch(t.def, first, id));
  if (task) {
    const replacement = state.tasks.find(t => t.def.type === 'replace' && t.def.slot === task.def.slot && task.def.slot !== undefined);
    if (replacement && !replacement.done) { toast('Сначала замените провод и затяните клеммы', 'info'); return; }
    completeTask(task);
  } else { Sound.connect(); toast('Контакт есть ✓', 'ok'); }
}

function removeWire(wire, silent) {
  const idx = state.wires.indexOf(wire);
  if (idx < 0) return false;
  if (state.level.mode === 'fault' && wire.initial) {
    const diagnostic = state.tasks.find(t => t.def.type === 'diagnose' && pairMatch(t.def, wire.a, wire.b));
    if (diagnostic && !diagnostic.done) {
      toast('Сначала прозвоните этот провод мультиметром', 'info');
      return false;
    }
  }
  state.wires.splice(idx, 1);
  state.probeNode = null;
  state.history = state.history.filter((id) => id !== wire.id);
  const task = findWireTask(wire.a, wire.b);
  if (task && task.done) task.done = false;
  for (const t of state.tasks) if ((t.def.type === 'test' || t.def.type === 'replace') && pairMatch(t.def, wire.a, wire.b)) t.done = false;
  neatCache.dirty = true;
  if (!silent) { Sound.click(); toast('Провод удалён', 'info'); }
  renderTasks();
  updateHUD();
  return true;
}

function undo() {
  if (state.finished || state.paused) return;
  const id = state.history[state.history.length - 1];
  if (!id) { toast('Нечего отменять', 'info'); return; }
  const wire = state.wires.find((w) => w.id === id);
  if (wire && !removeWire(wire, true)) return;
  Sound.click();
  toast('Последний провод удалён', 'info');
}

function clearWires() {
  if (state.finished || state.paused) return;
  if (!state.wires.length) { toast('Проводов пока нет', 'info'); return; }
  if (state.level.mode === 'fault' && state.tasks.some(t => t.def.type === 'diagnose' && !t.done)) { toast('Сначала прозвоните все линии', 'info'); return; }
  state.wires = [];
  state.history = [];
  state.probeNode = null;
  state.pendingNode = null;
  for (const t of state.tasks) if (t.def.type === 'wire' || t.def.type === 'test' || t.def.type === 'replace') t.done = false;
  neatCache.dirty = true;
  renderTasks();
  updateHUD();
  Sound.click();
  toast('Все провода убраны', 'info');
}

/* ---------------- game flow ---------------- */
function hideOverlay() {
  document.getElementById('overlay').classList.remove('show');
}

function startLevel(index) {
  if (!isLevelUnlocked(index)) { toast('Сначала пройдите предыдущий уровень', 'info'); return; }
  const level = LEVELS[index];
  if (!level) return;
  state.levelIndex = index;
  state.level = level;
  resetGame();
  state.running = true;
  state.paused = false;
  state.finished = false;
  state.startTime = nowMs();
  state.elapsed = 0;
  hideOverlay();
  renderToolBar();
  updateCameraModeUI();
  renderTasks();
  updateHUD();
  toast('Уровень ' + (index + 1) + ' · ' + level.name, 'info');
  if (level.mode === 'repair') toast('Ремонт: затяните готовый провод и завершите щит', 'info');
  else if (level.mode === 'test') toast('Проверка: соберите щит и прозвоните указанные цепи', 'info');
  else if (level.mode === 'fault') toast('Найдите обрыв: прозвоните указанные провода', 'info');
}

function resetGame() {
  buildLevel(state.level);
  state.wires = [];
  state.history = [];
  state.wireSeq = 0;
  state.tasks = (state.level.tasks || []).map((def) => ({ def: {...def}, done: false }));
  state.pendingNode = null;
  state.hoverNode = null;
  state.hoverWire = null;
  state.dragWire = null;
  state.dragPart = null;
  state.meterMounted = false;
  state.selectedColor = 'auto';
  state.tool = 'hand';
  state.mistakes = 0;
  state.hintsUsed = 0;
  state.hint = null;
  state.flash = null;
  state.particles = [];
  state.finished = false;
  state.elapsed = 0;
  state.lastUnlockedTool = null;
  state.probeNode = null;
  mobileDevice = null;
  setPan(false);
  camera.zoom = 2.2; camera.cx = 350; camera.cy = 300;
  document.querySelector('.sidebar').classList.remove('mobile-open');
  for (const id of (state.level.preinstalled || [])) {
    const device = activeDevices.find(d => d.id === id);
    if (device) { device.installed = true; addDeviceNodes(device); }
  }
  const initial = state.level.initialWires || [];
  const faultIndices = new Set();
  if (state.level.mode === 'fault') {
    const shuffled = initial.map((_, i) => i);
    for (let i=shuffled.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
    shuffled.slice(0, state.level.faultCount).forEach(i => faultIndices.add(i));
  }
  for (const [i, def] of initial.entries()) {
    if (!nodes[def.from] || !nodes[def.to]) continue;
    const w = {id:++state.wireSeq,a:def.from,b:def.to,color:def.color,
      lane:defaultLane(nodes[def.from],nodes[def.to]),cut:true,stripped:true,
      tightened:state.level.mode === 'fault', broken:faultIndices.has(i), detected:false, initial:true, born:0};
    state.wires.push(w);
    if (state.level.mode === 'fault') {
      const task = findWireTask(w.a,w.b); if (task) task.done = true;
    } else state.history.push(w.id);
  }
  const modeHelp = document.getElementById('modeHelp');
  modeHelp.hidden = state.level.mode !== 'fault';
  document.body.classList.toggle('fault-mode', state.level.mode === 'fault');
  document.querySelectorAll('#colorChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.color === 'auto'));
  neatCache.dirty = true;
  renderTasks();
  updateHUD();
  renderToolBar();
}

function restartGame() {
  resetGame();
  state.running = true;
  state.paused = false;
  state.finished = false;
  state.startTime = nowMs();
  state.elapsed = 0;
  hideOverlay();
  renderToolBar();
  toast('Новый монтаж — поехали!', 'info');
}

function finishGame() {
  if (state.finished) return;
  state.finished = true;
  state.running = false;
  const neat = getNeatness();
  const timeBonus = Math.max(0, 300 - Math.floor(state.elapsed)) * 2;
  const score = Math.max(0, 800 + Math.round(neat * 1.5) + timeBonus - state.mistakes * 15 - state.hintsUsed * 20);
  const stars = 1 + (state.mistakes === 0 ? 1 : 0) + (neat >= 90 ? 1 : 0);
  const id = state.level.id;
  const prev = progress.levels[id] || { bestScore: 0, bestTime: Infinity, stars: 0, completed: false };
  progress.levels[id] = {
    completed: true,
    bestScore: Math.max(prev.bestScore || 0, score),
    bestTime: Math.min(prev.bestTime || Infinity, state.elapsed),
    stars: Math.max(prev.stars || 0, stars),
  };
  saveProgress();
  Sound.win();
  setTimeout(() => showWin(score, neat, stars), 550);
}

function showWin(score, neat, stars) {
  const nextIndex = state.levelIndex + 1;
  const hasNext = nextIndex < LEVELS.length && isLevelUnlocked(nextIndex);
  const best = progress.levels[state.level.id];
  const overlay = document.getElementById('overlay');
  overlay.innerHTML =
    '<div class="card">' +
      '<div class="card-badge">щит собран</div>' +
      '<h2>Готово! ⚡</h2>' +
      '<div class="stars">' + '★'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>' +
      '<p class="lead">' + (state.mistakes === 0 ? '✓ Без ошибок' : '○ Без ошибок') + ' &nbsp; · &nbsp; ' + (neat >= 90 ? '✓ Аккуратность от 90%' : '○ Аккуратность от 90%') + '</p>' +
      '<div class="result-grid">' +
        '<div><span>Счёт</span><b>' + score + '</b></div>' +
        '<div><span>Лучший</span><b>' + (best ? best.bestScore : score) + '</b></div>' +
        '<div><span>Время</span><b>' + fmtTime(state.elapsed) + '</b></div>' +
        '<div><span>Аккуратность</span><b>' + neat + '%</b></div>' +
      '</div>' +
      '<div class="win-actions" style="margin-top:12px">' +
        (hasNext ? '<button class="btn primary big" id="btnNextLevel">Следующий уровень →</button>' : '') +
        '<div class="row">' +
          '<button class="btn" id="btnAgain">Заново</button>' +
          '<button class="btn" id="btnLevelsWin">К уровням</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  overlay.classList.add('show');
}

function showLevelSelect() {
  if (state.running && !state.finished && !state.paused) state.paused = true;
  state.pendingNode = null;
  state.probeNode = null;
  state.dragPart = null;
  state.dragWire = null;
  renderToolBar();

  const totalStars = LEVELS.reduce((s, _, i) => s + levelStars(i), 0);
  const completed = LEVELS.filter((l) => progress.levels[l.id] && progress.levels[l.id].completed).length;
  const canResume = state.running && !state.finished;

  const cardFor = (l, i) => {
    const unlocked = isLevelUnlocked(i);
    const p = progress.levels[l.id];
    const stars = p ? p.stars || 0 : 0;
    const best = p && p.bestScore ? p.bestScore : null;
    return '<button class="level-card ' + (unlocked ? '' : 'locked ') + (i === state.levelIndex ? 'current' : '') + '" data-level="' + i + '" ' + (unlocked ? '' : 'disabled') + '>' +
      '<div class="level-top"><span class="level-num">' + String(i + 1).padStart(2, '0') + '</span><span class="level-stars">' + '★'.repeat(stars) + '☆'.repeat(3 - stars) + '</span></div>' +
      '<div class="level-name">' + l.name + '</div>' +
      '<div class="level-sub">' + l.subtitle + ' · ' + (l.mode === 'fault' ? '🔎 Обрыв' : l.mode === 'repair' ? '🔧 Ремонт' : l.mode === 'test' ? '🔌 Проверка' : '⚡ Монтаж') + '</div>' +
      '<div class="level-foot"><span class="diff">' + '●'.repeat(l.difficulty) + '○'.repeat(3 - l.difficulty) + '</span><span class="best">' + (unlocked ? (best ? 'лучший ' + best : 'не пройден') : '🔒 закрыт') + '</span></div>' +
    '</button>';
  };
  const groups = ['Основы', 'Город', 'Частный дом', 'Бизнес', 'Инфраструктура', 'Поиск обрыва'];
  const cards = groups.map((name, chapterIndex) => {
    const items = LEVELS.map((l,i) => ({l,i})).filter(({l}) => (l.chapter || 'Основы') === name);
    const count = items.filter(({l}) => progress.levels[l.id] && progress.levels[l.id].completed).length;
    const expanded = state.level ? items.some(({i}) => i === state.levelIndex) : chapterIndex === 0;
    return '<details class="chapter" ' + (expanded ? 'open' : '') + '><summary><span>' + name + '</span><small>' + count + ' / ' + items.length + ' пройдено</small></summary><div class="level-grid">' + items.map(({l,i}) => cardFor(l,i)).join('') + '</div></details>';
  }).join('');

  const overlay = document.getElementById('overlay');
  overlay.innerHTML =
    '<div class="card level-select">' +
      '<div class="card-badge">выберите объект</div>' +
      '<h2>ЩИТОК</h2>' +
      '<p class="lead">' + LEVELS.length + ' заказов · все открыты · результаты сохраняются в браузере.<br>Схемы условные — это игра, не инструкция по электромонтажу.</p>' +
      cards +
      '<div class="profile-row">' +
        '<span>★ <b>' + totalStars + '</b> / ' + (LEVELS.length * 3) + '</span>' +
        '<span>Щитов собрано: <b>' + completed + '</b> / ' + LEVELS.length + '</span>' +
        '<span>Инструментов: <b>' + TOOL_ORDER.filter(isToolUnlocked).length + '</b> / ' + TOOL_ORDER.length + '</span>' +
      '</div>' +
      '<div class="level-actions">' +
        (canResume ? '<button class="btn primary big" id="btnContinue">Продолжить монтаж</button>' : '') +
        '<div class="row"><button class="btn" id="btnResetProgress">Сбросить прогресс</button></div>' +
      '</div>' +
    '</div>';
  overlay.classList.add('show');
}

function resumeGame() {
  if (!state.running || state.finished) { showLevelSelect(); return; }
  state.startTime = nowMs() - state.elapsed * 1000;
  state.paused = false;
  hideOverlay();
}

let resetArmed = false;
function resetProgress() {
  if (!resetArmed) {
    resetArmed = true;
    toast('Нажмите ещё раз, чтобы сбросить прогресс', 'info');
    setTimeout(() => { resetArmed = false; }, 3200);
    return;
  }
  resetArmed = false;
  progress = defaultProgress();
  saveProgress();
  Sound.muted = false;
  document.getElementById('btnSound').textContent = '🔊';
  state.tool = 'hand';
  state.levelIndex = 0;
  state.level = LEVELS[0];
  resetGame();
  state.running = false;
  state.finished = false;
  state.paused = false;
  renderToolBar();
  showLevelSelect();
  toast('Прогресс сброшен', 'info');
}

/* ---------------- UI ---------------- */
const elTime = document.getElementById('statTime');
const elScore = document.getElementById('statScore');
const elNeat = document.getElementById('statNeat');
const elMistakes = document.getElementById('statMistakes');
const elProgress = document.getElementById('taskProgress');
const elTaskList = document.getElementById('taskList');
const elOverlay = document.getElementById('overlay');
const elToolBelt = document.getElementById('toolBelt');
const elSideTitle = document.getElementById('sideTitle');
const hudCache = { time: '', score: -1, neat: -1, mistakes: -1 };

function renderTasks() {
  const visibleTasks = state.tasks.filter(t => state.level.mode !== 'fault' || t.def.type !== 'wire' || !t.done);
  const doneCount = visibleTasks.filter((t) => t.done).length;
  elTaskList.innerHTML = visibleTasks.map((t, i) => {
    const color = t.def.color ? COLORS[t.def.color] : null;
    let meta = '';
    if (t.def.type === 'diagnose') meta = '<div class="task-meta ' + (t.result === 'Обрыв' ? 'fault-result' : '') + '">' + (t.result || '🔌 Проверить мультиметром') + '</div>';
    else if (t.def.type === 'replace') meta = '<div class="task-meta">' + (t.def.from ? 'Снять → новый провод → затянуть' : 'Сначала найдите обрыв') + '</div>';
    else if (t.def.type === 'test') meta = '<div class="task-meta">🔌 Проверка мультиметром</div>';
    else if (t.def.type === 'step') meta = '<div class="task-meta">🔧 Шаг</div>';
    else if (t.def.type === 'install') meta = '<div class="task-meta">🔧 Монтаж</div>';
    else if (color) meta = '<div class="task-meta"><i style="background:' + color.base + '"></i>' + color.name + ' · ✂️ 🧰 🪛</div>';
    return '<li class="task ' + (t.done ? 'done' : '') + (t.result === 'Обрыв' ? ' fault-diagnosed' : '') + '" data-id="' + t.def.id + '">' +
      '<span class="task-num">' + (t.done ? '✓' : (i + 1)) + '</span>' +
      '<div class="task-body">' +
        '<div class="task-text">' + t.def.text + '</div>' + meta +
      '</div>' +
    '</li>';
  }).join('');
  const next = visibleTasks.find(t => !t.done);
  document.getElementById('mobileNextTask').textContent = next ? next.def.text : 'Все задания выполнены';
  document.getElementById('mobileTaskCount').textContent = doneCount + '/' + visibleTasks.length;
  renderMobileParts();
  elProgress.textContent = doneCount + ' / ' + visibleTasks.length;
  if (elSideTitle) elSideTitle.textContent = 'Задание · ' + (state.level ? state.level.name : '');
}

// Небольшие векторные иллюстрации остаются чёткими на Retina и работают офлайн.
const toolArt = {
 hand: '<path d="M24 39V24c0-4 5-4 5 0v-6c0-4 5-4 5 0v5-7c0-4 5-4 5 0v8-5c0-4 5-4 5 0v13c0 8-5 13-12 13h-4c-5 0-8-3-11-7l-4-5c-2-3 1-6 4-4l7 5z"/>',
 cutters: '<circle cx="23" cy="43" r="7"/><circle cx="42" cy="43" r="7"/><path d="M27 38 42 14l5 2-8 18M38 38 23 14l-5 2 8 18M30 29l5 5"/>',
 stripper: '<path d="M18 48 29 33 16 22l3-5 14 10 9-13 5 4-9 14 11 15-5 4-11-14-10 14z"/><circle cx="33" cy="32" r="3"/>',
 screwdriver: '<path d="M14 47 37 24m-3-5 11-8 7 7-8 11-5-5M12 45l5 5-4 4-5-5zM17 42l5 5"/>',
 multimeter: '<rect x="17" y="10" width="29" height="44" rx="4"/><rect x="21" y="14" width="21" height="9" rx="1"/><circle cx="31.5" cy="34" r="6"/><path d="M27 48h2m6 0h2m13-31 4 4v23l-4 6"/>',
 remove: '<path d="m18 18 27 27m0-27L18 45"/><circle cx="31.5" cy="31.5" r="21"/>'
};
function svgArt(body, cls) { return '<svg class="'+cls+'" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round">'+body+'</svg>'; }
function wireArt(color) {
  const c = color === 'L' ? '#bb632c' : color === 'N' ? '#317dc0' : color === 'PE' ? '#8ead35' : '#d7af68';
  return '<svg class="part-art" viewBox="0 0 64 50" aria-hidden="true"><ellipse cx="32" cy="25" rx="23" ry="13" fill="none" stroke="#17212d" stroke-width="11"/><ellipse cx="32" cy="25" rx="23" ry="13" fill="none" stroke="'+c+'" stroke-width="8"/><ellipse cx="32" cy="25" rx="15" ry="7" fill="none" stroke="'+c+'" stroke-width="5"/><path d="M46 35l9-3" stroke="#f3c58c" stroke-width="3" stroke-linecap="round"/></svg>';
}
function deviceArt(d) {
  if (d.kind === 'meter' || d.kind === 'meter3') return '<svg class="part-art" viewBox="0 0 64 50" aria-hidden="true"><rect x="14" y="4" width="36" height="42" rx="4" fill="#dce5ee" stroke="#94a4b6" stroke-width="2"/><rect x="19" y="12" width="26" height="14" rx="2" fill="#344c61"/><path d="M22 19h20" stroke="#7dd7e6" stroke-width="2"/><circle cx="23" cy="37" r="3" fill="#728598"/><circle cx="41" cy="37" r="3" fill="#728598"/></svg>';
  return '<svg class="part-art" viewBox="0 0 64 50" aria-hidden="true"><rect x="20" y="3" width="24" height="44" rx="3" fill="#dde5eb" stroke="#94a4b6" stroke-width="2"/><rect x="24" y="17" width="16" height="12" rx="2" fill="#4c6275"/><rect x="31" y="17" width="7" height="11" fill="#e0a03a"/><circle cx="32" cy="9" r="2" fill="#687a8b"/><circle cx="32" cy="41" r="2" fill="#687a8b"/></svg>';
}
function renderMobileParts() {
  const container = document.getElementById('mobileParts');
  const scrollBefore = container.querySelector('.parts-track')?.scrollLeft || 0;
  const parts = state.assembly ? [] : activeDevices.filter(d => !d.installed);
  const colors = [['auto','Авто'],['L','Провод L'],['N','Провод N'],['PE','Земля']];
  const wireCards = colors.map(([id,label]) => '<button class="part-button wire-choice ' + (state.selectedColor === id ? 'active' : '') + '" data-mobile-color="'+id+'" aria-pressed="'+(state.selectedColor === id)+'">' + wireArt(id) + '<span>'+label+'</span></button>').join('');
  const deviceCards = parts.map(d => '<button class="part-button ' + (mobileDevice === d.id ? 'active' : '') + '" data-mobile-part="' + d.id + '" aria-pressed="'+(mobileDevice===d.id)+'">' + deviceArt(d) + '<span>' + d.label + '</span></button>').join('');
  container.innerHTML = '<div class="parts-heading"><span class="parts-symbol">⬡</span> ДЕТАЛИ <small>ЛИСТАЙТЕ →</small></div><div class="parts-track">' + (parts.length ? deviceCards + wireCards : wireCards) + '</div>';
  container.querySelector('.parts-track').scrollLeft = scrollBefore;
}

function updateHUD() {
  const done = state.tasks.filter((t) => t.done).length;
  const neat = getNeatness();
  const detail = neatnessDetails();
  const detailEl = document.getElementById('neatDetail');
  if (detailEl) detailEl.textContent = detail.overlaps || detail.overDevices ? 'Наложения: ' + detail.overlaps + ' · поверх приборов: ' + detail.overDevices : 'Нет наложений и проходов по приборам';
  const score = Math.max(0, done * 100 + (state.wires.length ? Math.round(neat * 1.5) : 0) - state.mistakes * 15 - state.hintsUsed * 20);
  const goals = document.getElementById('starGoals');
  if (goals) goals.innerHTML = '<b>Цели на звёзды</b><span>★ Завершить заказ</span><span>' + (state.mistakes === 0 ? '☆' : '○') + ' Без ошибок</span><span>' + (neat >= 90 ? '☆' : '○') + ' Аккуратность от 90%</span>';
  const timeStr = fmtTime(state.elapsed);

  if (hudCache.time !== timeStr) { elTime.textContent = timeStr; hudCache.time = timeStr; }
  if (hudCache.score !== score) { elScore.textContent = String(score); hudCache.score = score; }
  if (hudCache.neat !== neat) {
    elNeat.textContent = neat + '%';
    elNeat.className = neat >= 85 ? 'good' : neat >= 60 ? 'warn' : '';
    hudCache.neat = neat;
  }
  if (hudCache.mistakes !== state.mistakes) {
    elMistakes.textContent = String(state.mistakes);
    elMistakes.className = state.mistakes > 0 ? 'warn' : '';
    hudCache.mistakes = state.mistakes;
  }
}

function renderToolBar() {
  const scrollBefore = elToolBelt.scrollLeft;
  if (!isToolUnlocked(state.tool)) state.tool = 'hand';
  elToolBelt.innerHTML = TOOL_ORDER.map((id) => {
    const t = TOOLS[id];
    const unlocked = isToolUnlocked(id);
    const active = state.tool === id;
    const title = unlocked ? t.desc : 'Откроется: ' + (TOOL_UNLOCK[id] ? TOOL_UNLOCK[id].text : '');
    return '<button class="tool ' + (active ? 'active' : '') + ' ' + (unlocked ? '' : 'locked') + '" data-tool="' + id + '" title="' + title + '" ' + (unlocked ? '' : 'disabled') + '>' +
      '<span class="tool-icon">' + (unlocked ? t.icon : '🔒') + '</span>' +
      (unlocked ? svgArt(toolArt[id], 'tool-art') : '') +
      '<span class="tool-name">' + (id === 'stripper' ? 'Зачистка' : t.name) + '</span>' +
    '</button>';
  }).join('');
  elToolBelt.scrollLeft = scrollBefore;
}

function pulseTool(id) {
  const btn = document.querySelector('#toolBelt [data-tool="' + id + '"]');
  if (!btn) return;
  btn.classList.add('pulse');
  setTimeout(() => btn.classList.remove('pulse'), 3200);
}

function updateCameraModeUI() { /* совместимость: камера убрана */ }

function hintTask(task, count) {
  if (state.finished || state.paused) return;
  if (!task) { toast('Все задания уже выполнены', 'info'); return; }
  if (task.def.type === 'step') {
    state.hint = { step: task.def.step, until: nowMs() + 4200 };
    toast(STEP_HINTS[task.def.step] || 'Выполните шаг', 'info');
    return;
  }
  if (task.def.type === 'install') {
    state.hint = { install: task.def.device, until: nowMs() + 4200 };
    const dev = activeDevices.find(d => d.id === task.def.device);
    if (dev) focusCamera(dev.x + devW(dev) / 2, (DEV_TOP + DEV_BOT) / 2);
    toast('Перетащите деталь из лотка в её контур на рейке', 'info');
  } else {
    if ((task.def.type === 'replace' || task.def.type === 'test') && task.def.slot !== undefined && !task.def.from) {
      toast('Сначала прозвоните линии и найдите обрыв', 'info'); return;
    }
    if (!nodes[task.def.from] || !nodes[task.def.to]) {
      toast('Сначала установите детали на рейку', 'info');
      return;
    }
    state.hint = { nodes: [task.def.from, task.def.to], until: nowMs() + 4200 };
    focusCamera((nodes[task.def.from].x + nodes[task.def.to].x) / 2, (nodes[task.def.from].y + nodes[task.def.to].y) / 2);
    toast(task.def.type === 'diagnose' ? 'Выберите мультиметр и нажмите обе подсвеченные клеммы' : task.def.type === 'replace' ? 'Снимите отмеченный провод, соедините эти клеммы и обработайте новый' : task.def.type === 'test' ? 'Мультиметр: нажмите на обе клеммы. Сначала затяните провод.' : 'Подсказка: ' + task.def.text + '. Отрежьте, зачистите и затяните', 'info');
  }
  if (count) { state.hintsUsed++; updateHUD(); }
}

/* ---------------- pointer interaction ---------------- */
let downInfo = null;

function gamePointerDown(e) {
  if (!state.running || state.finished || state.paused) return;
  if (phoneLayout.matches && camera.pan) {
    camera.drag = {id:e.pointerId,x:e.clientX,y:e.clientY};
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault(); return;
  }
  Sound.init();
  const p = getPos(e);
  state.pointer.x = p.x;
  state.pointer.y = p.y;
  state.pointer.inside = true;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const touch = e.pointerType === 'touch';
  const nodeRadius = touch ? 26 : 18;
  const wireRadius = touch ? 18 : 12;

  if (phoneLayout.matches && mobileDevice && !state.assembly) {
    const d = activeDevices.find(x => x.id === mobileDevice && !x.installed);
    if (d && pointInRect(p, {x:d.x, y:DEV_TOP, w:devW(d), h:DEV_BOT-DEV_TOP}, 12)) {
      installDevice(d.id); mobileDevice = null; renderMobileParts();
    } else toast('Нажмите на подсвеченный контур детали на рейке', 'info');
    return;
  }

  if (state.assembly) {
    const a = state.assembly;
    if (state.tool === 'stripper') {
      if (hitBundle(p)) {
        a.stripped = true;
        Sound.strip();
        toast('Коса зачищена', 'ok');
        checkAllSteps();
        return;
      }
      const wh = hitWire(p, wireRadius + 4);
      if (wh) { stripWire(wh.wire); return; }
      toast('Нажмите на косу или провод, чтобы зачистить', 'info');
      return;
    }
    if (state.tool === 'cutters') {
      const bw = hitBundleWire(p);
      if (bw) {
        bw.cut = true;
        Sound.snip();
        toast('Жёлтый провод отрезан', 'ok');
        checkAllSteps();
        return;
      }
      const wh = hitWire(p, wireRadius + 4);
      if (wh) { cutWire(wh.wire); return; }
      toast('Нажмите на жёлтый провод или на готовый провод', 'info');
      return;
    }
    if (state.tool === 'screwdriver') {
      const conn = hitConnector(p);
      if (conn) { tightenAssemblyItem(conn); return; }
      const clamp = hitClamp(p);
      if (clamp) { tightenAssemblyItem({ kind: 'clamp', id: clamp.id }); return; }
      const wh = hitWire(p, wireRadius + 4);
      if (wh) { tightenWire(wh.wire); return; }
      toast('Нажмите на коннектор, зажим или провод', 'info');
      return;
    }
    const hit = pick(p, nodeRadius, wireRadius);
    if (hit && hit.node) {
      const n = hit.node;
      if (state.pendingNode && state.pendingNode !== n.id) {
        const from = state.pendingNode;
        state.pendingNode = null;
        pullWire(from, n.id);
      } else {
        state.pendingNode = n.id;
        Sound.click();
      }
      downInfo = { x: p.x, y: p.y, moved: false };
      return;
    }
    if (hit && hit.wire) {
      state.hoverWire = hit;
      state.dragWire = { wire: hit.wire, startLane: hit.wire.lane, startY: p.y };
      state.pendingNode = null;
      Sound.click();
      downInfo = { x: p.x, y: p.y, moved: false };
      return;
    }
    const item = hitItem(p);
    if (item) {
      const r = itemCardRect(item);
      a.dragItem = { item, x: r.x, y: r.y, dx: p.x - r.x, dy: p.y - r.y };
      Sound.click();
      return;
    }
    const bw = hitBundleWire(p);
    if (bw) {
      a.selectedWire = bw.id;
      Sound.click();
      toast(bw.color === 'L' ? 'Жёлтый выбран. Нажмите на верхний коннектор' : 'Синий выбран. Нажмите на зажим', 'info');
      return;
    }
    const conn = hitConnector(p);
    if (conn) { handleConnectorClick(conn); return; }
    const clamp = hitClamp(p);
    if (clamp) { handleClampClick(clamp); return; }
    if (hitBundle(p)) { handleBundleClick(); return; }
    state.pendingNode = null;
    downInfo = null;
    return;
  }

  if (state.tool === 'remove') {
    // Красная метка приоритетна при пересечении с другим проводом.
    let marked = null, markDistance = touch ? 22 : 16;
    for (const w of state.wires) {
      if (!w.broken || !w.detected) continue;
      const points = wirePoints(w); if (!points) continue;
      const distance = dist(p.x, p.y, (points.A.x + points.B.x) / 2, points.lane);
      if (distance < markDistance) { marked = w; markDistance = distance; }
    }
    const wh = marked ? {wire: marked} : hitWire(p, wireRadius + 4);
    if (wh) removeWire(wh.wire); else toast('Нажмите на провод, который нужно снять', 'info');
    return;
  }
  if (state.tool === 'multimeter') {
    const n = hitNode(p, nodeRadius);
    if (n) probeAt(n.id); else toast('Выберите клемму для щупа', 'info');
    return;
  }
  if (state.tool === 'cutters') {
    const wh = hitWireForWork(p, wireRadius + 4);
    if (wh) cutWire(wh.wire);
    else toast('Наведите на провод, чтобы отрезать', 'info');
    return;
  }
  if (state.tool === 'stripper') {
    const wh = hitWireForWork(p, wireRadius + 4);
    if (wh) stripWire(wh.wire);
    else toast('Наведите на провод, чтобы зачистить', 'info');
    return;
  }
  if (state.tool === 'screwdriver') {
    const wh = hitWireForWork(p, wireRadius + 4);
    if (wh) tightenWire(wh.wire);
    else toast('Наведите на провод, чтобы затянуть', 'info');
    return;
  }

  const part = hitPart(p);
  if (part) {
    const r = partCardRect(part);
    state.dragPart = { deviceId: part.id, x: r.x, y: r.y, dx: p.x - r.x, dy: p.y - r.y };
    state.pendingNode = null;
    Sound.click();
    return;
  }

  const nNear = hitNode(p, touch ? 16 : 10);
  if (!nNear && state.hoverWire) {
    const bp = wireBadgePos(state.hoverWire.wire);
    if (bp && dist(p.x, p.y, bp.x, bp.y) < (touch ? 20 : 14)) {
      removeWire(state.hoverWire.wire);
      state.hoverWire = null;
      return;
    }
  }

  const hit = pick(p, nodeRadius, wireRadius);
  if (hit && hit.node) {
    const n = hit.node;
    if (state.pendingNode && state.pendingNode !== n.id) {
      const from = state.pendingNode;
      state.pendingNode = null;
      pullWire(from, n.id);
    } else {
      state.pendingNode = n.id;
      Sound.click();
    }
    downInfo = { x: p.x, y: p.y, moved: false };
    return;
  }

  if (hit && hit.wire) {
    state.hoverWire = hit;
    state.dragWire = { wire: hit.wire, startLane: hit.wire.lane, startY: p.y };
    state.pendingNode = null;
    Sound.click();
    downInfo = { x: p.x, y: p.y, moved: false };
    return;
  }

  state.pendingNode = null;
  downInfo = null;
}

function gamePointerMove(e) {
  if (camera.drag && camera.drag.id === e.pointerId) {
    camera.cx -= (e.clientX - camera.drag.x) / camera.scale;
    camera.cy -= (e.clientY - camera.drag.y) / camera.scale;
    camera.drag.x = e.clientX; camera.drag.y = e.clientY; fitCanvas();
    e.preventDefault(); return;
  }
  const p = getPos(e);
  state.pointer.x = p.x;
  state.pointer.y = p.y;
  state.pointer.inside = true;
  if (downInfo && dist(p.x, p.y, downInfo.x, downInfo.y) > 6) downInfo.moved = true;
  const touch = e.pointerType === 'touch';

  if (state.dragPart) {
    state.dragPart.x = p.x - state.dragPart.dx;
    state.dragPart.y = p.y - state.dragPart.dy;
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (state.assembly && state.assembly.dragItem) {
    state.assembly.dragItem.x = p.x - state.assembly.dragItem.dx;
    state.assembly.dragItem.y = p.y - state.assembly.dragItem.dy;
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (state.dragWire) {
    const w = state.dragWire.wire;
    w.lane = clamp(Math.round((state.dragWire.startLane + (p.y - state.dragWire.startY)) / 2) * 2, LANE_MIN, LANE_MAX);
    neatCache.dirty = true;
    canvas.style.cursor = 'grabbing';
    return;
  }

  const hit = pick(p, touch ? 26 : 18, touch ? 18 : 12);
  if (hit && hit.node) {
    state.hoverNode = hit.node.id;
    state.hoverWire = null;
  } else if (hit && hit.wire) {
    state.hoverNode = null;
    state.hoverWire = hit;
  } else {
    state.hoverNode = null;
    state.hoverWire = null;
  }

  if (hit && hit.node) canvas.style.cursor = 'pointer';
  else if (hit && hit.wire) canvas.style.cursor = hit.badge ? 'pointer' : 'grab';
  else if (hitPart(p)) canvas.style.cursor = 'grab';
  else canvas.style.cursor = 'default';
}

function endPointer(e) {
  if (camera.drag && (!e || camera.drag.id === e.pointerId)) { camera.drag = null; return; }
  if (state.assembly && state.assembly.dragItem) { finishItemDrag(); downInfo = null; return; }
  if (state.dragPart) { finishPartDrag(); downInfo = null; return; }
  if (state.dragWire) { state.dragWire = null; downInfo = null; return; }
  const p = e ? getPos(e) : { x: state.pointer.x, y: state.pointer.y };
  const n = hitNode(p, 20);
  if (state.pendingNode) {
    if (n && n.id !== state.pendingNode) {
      const from = state.pendingNode;
      state.pendingNode = null;
      pullWire(from, n.id);
    } else if (downInfo && downInfo.moved) {
      state.pendingNode = null;
    }
  }
  downInfo = null;
}

// Одним пальцем — монтаж, двумя одновременно — масштаб и перемещение.
// Для касания ждём отпускания, чтобы второй палец не включал инструмент случайно.
const activeTouches = new Map();
let singleTouch = null, twoFingerGesture = null, gestureBlocked = false;
const gestureStage = document.getElementById('stage');
function touchCopy(e) { return {clientX:e.clientX,clientY:e.clientY,pointerId:e.pointerId,pointerType:'touch'}; }
function rollbackSingleDrag() {
  if (!singleTouch || !singleTouch.started) return;
  if (state.dragWire) { state.dragWire.wire.lane = state.dragWire.startLane; neatCache.dirty = true; }
  state.dragWire = null; state.dragPart = null;
  if (state.assembly) state.assembly.dragItem = null;
  state.pendingNode = singleTouch.pendingNode;
  state.probeNode = singleTouch.probeNode;
  downInfo = null;
}
function beginTwoFinger() {
  rollbackSingleDrag();
  const [a,b] = [...activeTouches.values()];
  const mx = (a.clientX+b.clientX)/2, my = (a.clientY+b.clientY)/2;
  const rect = canvas.getBoundingClientRect();
  twoFingerGesture = {
    distance:Math.max(1,dist(a.clientX,a.clientY,b.clientX,b.clientY)),
    zoom:camera.zoom,
    anchorX:(mx-rect.left)/camera.scale,
    anchorY:(my-rect.top)/camera.scale
  };
  gestureBlocked = true;
}
function moveTwoFinger() {
  if (!twoFingerGesture || activeTouches.size < 2) return;
  const [a,b] = [...activeTouches.values()];
  const mx=(a.clientX+b.clientX)/2, my=(a.clientY+b.clientY)/2;
  camera.zoom=clamp(twoFingerGesture.zoom * dist(a.clientX,a.clientY,b.clientX,b.clientY) / twoFingerGesture.distance, 1, 4.5);
  const r=gestureStage.getBoundingClientRect();
  const scale=Math.min(r.width/W,r.height/H)*camera.zoom;
  camera.cx=twoFingerGesture.anchorX-(mx-(r.left+r.width/2))/scale;
  camera.cy=twoFingerGesture.anchorY-(my-(r.top+r.height/2))/scale;
  fitCanvas();
}
gestureStage.addEventListener('pointerdown', e => {
  if (e.target !== canvas && e.target !== gestureStage) return;
  if (e.pointerType !== 'touch' || !phoneLayout.matches) { if (e.target === canvas) gamePointerDown(e); return; }
  if (!state.running || state.finished || state.paused) return;
  activeTouches.set(e.pointerId,touchCopy(e));
  try { gestureStage.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
  if (activeTouches.size === 1 && !gestureBlocked) {
    singleTouch = {start:touchCopy(e),started:false,moved:false,pendingNode:state.pendingNode,probeNode:state.probeNode};
  } else if (activeTouches.size === 2) beginTwoFinger();
});
gestureStage.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch' || !phoneLayout.matches) { if (e.target === canvas) gamePointerMove(e); return; }
  if (!activeTouches.has(e.pointerId)) return;
  activeTouches.set(e.pointerId,touchCopy(e)); e.preventDefault();
  if (twoFingerGesture) { moveTwoFinger(); return; }
  if (gestureBlocked || !singleTouch) return;
  const first = singleTouch.start;
  if (dist(first.clientX,first.clientY,e.clientX,e.clientY) > 7) singleTouch.moved = true;
  // Для прокладки/укладки проводов оставляем привычное перетаскивание одним пальцем.
  if (singleTouch.moved && !singleTouch.started && state.tool === 'hand' && !mobileDevice) {
    const p = getPos(first), wh = hitWire(p,18);
    const badge = state.hoverWire && dist(p.x,p.y,wireBadgePos(state.hoverWire.wire).x,wireBadgePos(state.hoverWire.wire).y)<20;
    if (!hitNode(p,26) && (wh || hitPart(p)) && !badge) { singleTouch.started=true; gamePointerDown(first); }
  }
  if (singleTouch.started) gamePointerMove(e);
});
gestureStage.addEventListener('pointerup', e => {
  if (e.pointerType !== 'touch' || !phoneLayout.matches) { if (e.target === canvas) endPointer(e); return; }
  if (!activeTouches.has(e.pointerId)) return;
  e.preventDefault();
  activeTouches.delete(e.pointerId);
  if (gestureBlocked) {
    twoFingerGesture = null;
    if (!activeTouches.size) { gestureBlocked=false; singleTouch=null; }
    return;
  }
  if (singleTouch) {
    if (!singleTouch.started) {
      if (!singleTouch.moved) gamePointerDown(e);
      else if (state.tool === 'hand' && !mobileDevice && hitNode(getPos(singleTouch.start),26)) gamePointerDown(singleTouch.start);
    }
    endPointer(e); singleTouch=null;
  }
});
gestureStage.addEventListener('pointercancel', e => {
  if (e.pointerType === 'touch' && phoneLayout.matches) {
    rollbackSingleDrag(); activeTouches.delete(e.pointerId); twoFingerGesture=null;
    gestureBlocked=activeTouches.size>0; if (!activeTouches.size) singleTouch=null;
  } else { state.dragPart=null; state.dragWire=null; state.pendingNode=null; downInfo=null; }
});
canvas.addEventListener('pointerleave', () => {
  state.pointer.inside = false;
  state.hoverNode = null;
  state.hoverWire = null;
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!state.running || state.finished || state.paused) return;
  const p = getPos(e);
  const wh = hitWire(p, 14);
  if (wh) removeWire(wh.wire);
});

/* ---------------- UI events ---------------- */
elOverlay.addEventListener('click', (e) => {
  const levelBtn = e.target.closest('[data-level]');
  if (levelBtn) { startLevel(Number(levelBtn.dataset.level)); return; }
  if (e.target.closest('#btnContinue')) { resumeGame(); return; }
  if (e.target.closest('#btnAgain')) { restartGame(); return; }
  if (e.target.closest('#btnNextLevel')) { startLevel(state.levelIndex + 1); return; }
  if (e.target.closest('#btnLevelsWin')) { showLevelSelect(); return; }
  if (e.target.closest('#btnResetProgress')) { resetProgress(); return; }
});

document.getElementById('btnRestart').addEventListener('click', () => { if (state.level) restartGame(); });
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnClear').addEventListener('click', clearWires);
document.getElementById('btnHint').addEventListener('click', () => {
  const next = state.tasks.find((t) => !t.done);
  hintTask(next, true);
});
document.getElementById('btnLevels').addEventListener('click', showLevelSelect);
document.getElementById('btnSound').addEventListener('click', (e) => {
  Sound.init();
  Sound.muted = !Sound.muted;
  progress.settings.sound = !Sound.muted;
  saveProgress();
  e.currentTarget.textContent = Sound.muted ? '🔇' : '🔊';
  if (!Sound.muted) Sound.click();
});

document.getElementById('colorChips').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  state.selectedColor = btn.dataset.color;
  document.querySelectorAll('#colorChips .chip').forEach((c) => c.classList.toggle('active', c === btn));
  renderMobileParts();
  Sound.click();
});

elToolBelt.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tool]');
  if (!btn) return;
  const id = btn.dataset.tool;
  if (!isToolUnlocked(id)) {
    toast('Инструмент откроется: ' + (TOOL_UNLOCK[id] ? TOOL_UNLOCK[id].text : ''), 'info');
    return;
  }
  state.tool = id;
  mobileDevice = null;
  setPan(false);
  renderMobileParts();
  state.probeNode = null;
  state.pendingNode = null;
  renderToolBar();
  Sound.click();
  if (id === 'remove') toast('Нажмите на провод, чтобы снять его', 'info');
  if (id === 'multimeter') toast('Прозвонка: нажмите на две клеммы готового провода', 'info');
  if (id === 'cutters') toast('Нажмите на провод, чтобы отрезать нужную длину', 'info');
  if (id === 'stripper') toast('Нажмите на провод или косу, чтобы зачистить', 'info');
  if (id === 'screwdriver') toast('Нажмите на коннектор, зажим или провод, чтобы затянуть', 'info');
  if (id === 'hand') toast('Вставьте провод в зажимы или перетащите деталь', 'info');
});

elTaskList.addEventListener('click', (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  const task = state.tasks.find((t) => t.def.id === li.dataset.id);
  if (!task || task.done) return;
  hintTask(task, false);
  if (phoneLayout.matches) document.querySelector('.sidebar').classList.remove('mobile-open');
  document.querySelectorAll('#taskList .task').forEach((el) => el.classList.toggle('active', el === li));
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key === 'Escape') {
    state.pendingNode = null;
    state.probeNode = null;
    state.dragWire = null;
    state.dragPart = null;
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.hoverWire) {
    e.preventDefault();
    removeWire(state.hoverWire.wire);
    state.hoverWire = null;
  }
});


// Крупные элементы управления для телефона.
document.getElementById('openTasks').addEventListener('click', () => document.querySelector('.sidebar').classList.add('mobile-open'));
document.getElementById('closeTasks').addEventListener('click', () => document.querySelector('.sidebar').classList.remove('mobile-open'));
document.getElementById('mobileParts').addEventListener('click', (e) => {
  if (!state.running || state.finished || state.paused) return;
  const color = e.target.closest('[data-mobile-color]');
  if (color) {
    state.selectedColor = color.dataset.mobileColor;
    document.querySelectorAll('#colorChips .chip').forEach(c => c.classList.toggle('active', c.dataset.color === state.selectedColor));
    renderMobileParts(); Sound.click(); return;
  }
  const btn = e.target.closest('[data-mobile-part]');
  if (!btn) return;
  const d = activeDevices.find(d => d.id === btn.dataset.mobilePart && !d.installed);
  if (!d) return;
  mobileDevice = d.id; state.tool = 'hand'; state.pendingNode = null; state.probeNode = null;
  setPan(false); renderToolBar(); renderMobileParts();
  state.hint = {install: d.id, until: nowMs() + 20000};
  focusCamera(d.x + devW(d)/2, (DEV_TOP + DEV_BOT)/2);
  toast('Нажмите на подсвеченный контур «' + d.label + '»', 'info');
});
document.getElementById('zoomIn').addEventListener('click', () => {camera.zoom = clamp(camera.zoom * 1.3, 1, 4.5); fitCanvas();});
document.getElementById('zoomOut').addEventListener('click', () => {camera.zoom = clamp(camera.zoom / 1.3, 1, 4.5); fitCanvas();});
document.getElementById('fitBoard').addEventListener('click', () => {camera.zoom = 1; camera.cx = W/2; camera.cy = H/2; fitCanvas();});
const menu = document.getElementById('mobileMenu');
let menuPausedGame = false;
function setMobileMenu(open) {
  if (open && menu.hidden) {
    menuPausedGame = state.running && !state.finished && !state.paused;
    if (menuPausedGame) { state.elapsed = (nowMs() - state.startTime) / 1000; state.paused = true; }
  } else if (!open && !menu.hidden && menuPausedGame) {
    if (state.running && !state.finished) { state.startTime = nowMs() - state.elapsed * 1000; state.paused = false; }
    menuPausedGame = false;
  }
  menu.hidden = !open;
  document.getElementById('mobileMenuButton').setAttribute('aria-expanded', String(open));
}
document.getElementById('mobileMenuButton').addEventListener('click', () => setMobileMenu(menu.hidden));
document.getElementById('closeMobileMenu').addEventListener('click', () => setMobileMenu(false));
menu.addEventListener('click', e => {
  if (e.target === menu) { setMobileMenu(false); return; }
  const btn = e.target.closest('[data-action]');
  if (btn) { setMobileMenu(false); document.getElementById(btn.dataset.action).click(); }
});

/* ---------------- debug api ---------------- */
window.SHCHITOK = {
  state,
  nodes,
  levels: LEVELS,
  progress,
  tools: TOOLS,
  assembly: () => state.assembly,
  assemblyItems,
  itemCardRect,
  itemSlot,
  activeDevices: () => activeDevices,
  partCardRect,
  installDevice,
  cutWire,
  stripWire,
  tightenWire,
  startLevel,
  resetGame,
  restartGame,
  probeAt,
  removeWire,
  pullWire,
  getNeatness: () => getNeatness(),
  camera, fitCanvas, focusCamera,
  version: '0.3.0',
};

/* ---------------- init ---------------- */
if (!LEVELS.length) {
  document.getElementById('overlay').innerHTML = '<div class="card"><h2>Нет уровней</h2><p class="lead">Проверьте, что levels.js загружается перед game.js.</p></div>';
  return;
}

buildLevel(LEVELS[0]);
resetGame();
document.getElementById('btnSound').textContent = Sound.muted ? '🔇' : '🔊';
renderToolBar();
renderTasks();
updateHUD();
showLevelSelect();
requestAnimationFrame(loop);
setTimeout(fitCanvas, 60);
setTimeout(fitCanvas, 400);

})();
