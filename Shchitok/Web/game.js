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
// Вертикальный рабочий щит для телефона; настольная геометрия не меняется.
const compactWorld = window.matchMedia('(max-width:700px), (max-height:500px) and (pointer:coarse)').matches;
const W = compactWorld ? 760 : 1160;
const H = compactWorld ? Math.round(clamp(760 * (window.innerHeight - 305) / Math.max(320, window.innerWidth - 20), 760, 1040)) : 700;
const PANEL = compactWorld ? { x:18, y:16, w:724, h:H-32, r:22 } : { x:40, y:20, w:900, h:660, r:18 };
const RAIL_TOP = compactWorld ? { x:55, y:216, w:650, h:24 } : { x:70, y:132, w:840, h:14 };
const RAIL_BOT = compactWorld ? { x:55, y:H-245, w:420, h:18 } : { x:70, y:470, w:840, h:14 };
const DEV_TOP = compactWorld ? 128 : 64, DEV_BOT = compactWorld ? 338 : 196;
const MOD_W = compactWorld ? 56 : 44, MOD_GAP = 4;
const TERM_TOP = compactWorld ? 145 : 76, TERM_BOT = compactWorld ? 321 : 184;
const TRAY = compactWorld ? { x:780, y:180, w:160, h:480 } : { x:980, y:180, w:160, h:480 };
const LANE_MIN = 24, LANE_MAX = compactWorld ? H-38 : 656;

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
    wallet: 0, owned: ['panel-standard', 'light-none'], equipped: {panel:'panel-standard', light:'light-none'}, challenge: 'standard', records: {wins:0, master:0, expert:0},
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
        // Раньше очки были рекордами, а не балансом: один раз зачисляем лучшие результаты.
        if (!Number.isFinite(p.wallet)) p.wallet = Object.values(p.levels).reduce((sum, l) => sum + (Number.isFinite(l.bestScore) ? Math.max(0, l.bestScore) : 0), 0);
        p.wallet = Math.max(0, Math.floor(p.wallet));
        p.owned = Array.isArray(p.owned) ? Array.from(new Set(['panel-standard','light-none',...p.owned])) : ['panel-standard','light-none'];
        p.equipped = Object.assign({panel:'panel-standard',light:'light-none'}, p.equipped || {});
        for (const slot of ['panel','light']) if (!p.owned.includes(p.equipped[slot])) p.equipped[slot] = slot === 'panel' ? 'panel-standard' : 'light-none';
        p.challenge = ['standard','master','expert'].includes(p.challenge) ? p.challenge : 'standard';
        p.records = Object.assign({wins:0,master:0,expert:0}, p.records || {});
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
  const fullDeviceWidth = activeDevices.reduce((sum,d)=>sum+devW(d), 0) + Math.max(0, activeDevices.length-1)*MOD_GAP;
  let cursor = compactWorld ? Math.max(58, (W-fullDeviceWidth)/2) : 76;
  const orderedDevices = compactWorld ? [...activeDevices].sort((a,b) => Number(b.kind === 'meter' || b.kind === 'meter3') - Number(a.kind === 'meter' || a.kind === 'meter3')) : activeDevices;
  for (const d of orderedDevices) {
    d.x = cursor;
    cursor += devW(d) + MOD_GAP;
  }

  activeClamps = (level.clamps || level.blocks || []).map((b, i) => Object.assign({}, b, {
    x: compactWorld ? 62 + i * 52 : 76 + i * 48, y: compactWorld ? H-295 : 418, w: 44, h: compactWorld ? 86 : 110,
  }));
  activeBuses = level.buses.map((b,i) => Object.assign({}, b, compactWorld ? {x:65+i*335, y:H-120, w:295, h:50, nodeOffset:36} : {y:450,h:40}));

  for (const b of activeClamps) {
    addNode(b.id, b.x + b.w / 2, b.y + 14, { x: 0, y: -1 }, b.type, b.id.toUpperCase(), b.id, false);
  }
  for (const b of activeBuses) {
    addNode(b.id, b.x + (b.nodeOffset || 20), b.y + b.h / 2, { x: 0, y: -1 }, b.type, b.label, b.id, false);
  }
}

function addDeviceNodes(d) {
  if (d.kind === 'meter' || d.kind === 'meter3') {
    const offs = compactWorld ? [0.125,0.375,0.625,0.875].map(v=>v*devW(d)) : [16, 52, 88, 124];
    const types = d.kind === 'meter3' ? ['L', 'L', 'L', 'N'] : ['L', 'L', 'N', 'N'];
    offs.forEach((o, i) => {
      addNode('m' + (i + 1), d.x + o, TERM_BOT, { x: 0, y: 1 }, types[i], String(i + 1), d.id, true);
    });
    return;
  }
  const w = devW(d);
  if (compactWorld && d.mods >= 2) {
    const count = Math.min(d.mods, 3);
    for (let i=0;i<count;i++) {
      const ox = MOD_W/2 + i*(MOD_W+MOD_GAP), top=1+2*i, bottom=2+2*i;
      const type = d.mods === 3 ? 'L' : (i === 0 ? 'L' : 'N');
      addNode(d.id+'_t'+top, d.x+ox, TERM_TOP, {x:0,y:-1}, type, String(top), d.id, true);
      addNode(d.id+'_b'+bottom, d.x+ox, TERM_BOT, {x:0,y:1}, type, String(bottom), d.id, true);
    }
    return;
  }
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
  readyForLaunch: false,
  challenge: 'standard',
  verifiedWireIds: [],
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
const camera = { zoom: compactWorld ? 1 : 2.2, cx: compactWorld ? W/2 : 350, cy: compactWorld ? H/2 : 300, scale: 1, pan: false, drag: null };
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
  if (!compactWorld && camera.zoom < 1.6) camera.zoom = 2.2;
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
  const preferred = compactWorld ? (A.y < 165 && B.y < 165 ? 75 : A.y > H-320 && B.y > H-320 ? H-168 : 360) : (A.y < 100 && B.y < 100 ? 56 : A.y > 400 && B.y > 400 ? 550 : 210);
  const lanes = compactWorld ? [54, 78, 102, 116] : [56, 184];
  if (compactWorld) {
    for (let y = 360; y <= H-320; y += 12) lanes.push(y);
    for (let y = H-182; y <= H-134; y += 12) lanes.push(y);
    for (let y = H-58; y <= H-38; y += 12) lanes.push(y);
  } else {
    for (let y = 210; y <= 410; y += 12) lanes.push(y);
    for (let y = 540; y <= 636; y += 12) lanes.push(y);
  }
  const x1 = Math.min(A.x, B.x), x2 = Math.max(A.x, B.x);
  let best = lanes[0], bestCost = Infinity;
  for (const lane of lanes) {
    let cost = Math.abs(lane - preferred) / 100;
    for (const d of activeDevices) {
      if (d.installed && lane > DEV_TOP + 16 && lane < DEV_BOT - 16 && x2 > d.x && x1 < d.x + devW(d)) cost += 100;
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
        p.lane > DEV_TOP + 16 && p.lane < DEV_BOT - 16 && hi > d.x && lo < d.x + devW(d))) overDevices++;
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

// Телефонная графика: объёмный светлый щит и аппараты в стиле выбранного эскиза.
function mobileMetal(x,y,w,h,r) {
  rr(ctx,x,y,w,h,r); const g=ctx.createLinearGradient(0,y,0,y+h);
  g.addColorStop(0,'#f9fbfd'); g.addColorStop(.38,'#e7ecf1'); g.addColorStop(.75,'#d1dbe5'); g.addColorStop(1,'#a5b3c1');
  ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#798ca0';ctx.lineWidth=2;ctx.stroke();
  rr(ctx,x+3,y+3,w-6,h-6,Math.max(1,r-2));ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=1.5;ctx.stroke();
}
function mobileScrew(x,y,r=10) {
  ctx.save();ctx.shadowColor='rgba(20,34,49,.35)';ctx.shadowBlur=3;ctx.shadowOffsetY=2;
  let g=ctx.createRadialGradient(x-r*.35,y-r*.4,1,x,y,r);g.addColorStop(0,'#eaf4fa');g.addColorStop(.55,'#a6c1d2');g.addColorStop(1,'#49657a');
  ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#40566a';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
  ctx.beginPath();ctx.moveTo(x-r*.48,y-r*.48);ctx.lineTo(x+r*.48,y+r*.48);ctx.moveTo(x+r*.48,y-r*.48);ctx.lineTo(x-r*.48,y+r*.48);
  ctx.strokeStyle='#557285';ctx.lineWidth=2;ctx.lineCap='round';ctx.stroke();
}
function drawMobilePanel() {
  const {x,y,w,h}=PANEL;
  ctx.save();ctx.shadowColor='rgba(0,8,17,.45)';ctx.shadowBlur=24;ctx.shadowOffsetY=9;
  rr(ctx,x,y,w,h,22);let g=ctx.createLinearGradient(x,y,x+w,y+h);const palette=panelPalette();g.addColorStop(0,palette[0]);g.addColorStop(.5,palette[1]);g.addColorStop(1,palette[2]);ctx.fillStyle=g;ctx.fill();ctx.restore();
  rr(ctx,x+2,y+2,w-4,h-4,20);ctx.strokeStyle='#95a7ba';ctx.lineWidth=3;ctx.stroke();
  rr(ctx,x+7,y+7,w-14,h-14,17);ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=2;ctx.stroke();
  ctx.save();rr(ctx,x+8,y+8,w-16,h-16,16);ctx.clip();
  ctx.fillStyle='rgba(93,117,139,.055)';for(let xx=x+35;xx<x+w;xx+=34)for(let yy=y+35;yy<y+h;yy+=34){ctx.beginPath();ctx.arc(xx,yy,1,0,TAU);ctx.fill();}
  const gloss=ctx.createLinearGradient(x,y,x+w,y+h);gloss.addColorStop(0,'rgba(255,255,255,.13)');gloss.addColorStop(.6,'rgba(255,255,255,0)');gloss.addColorStop(1,'rgba(93,113,136,.09)');ctx.fillStyle=gloss;ctx.fillRect(x,y,w,h);ctx.restore();
  for(const [sx,sy] of [[x+24,y+24],[x+w-24,y+24],[x+24,y+h-24],[x+w-24,y+h-24]])mobileScrew(sx,sy,9);
  ctx.textAlign='left';ctx.fillStyle='#718193';ctx.font='bold 11px system-ui,sans-serif';ctx.fillText('РАБОЧАЯ ЗОНА · ЩИТ',x+48,y+31);
}
function drawMobileRail(r) {
  ctx.save();ctx.shadowColor='rgba(34,54,72,.32)';ctx.shadowBlur=6;ctx.shadowOffsetY=4;
  mobileMetal(r.x,r.y,r.w,r.h,3);ctx.restore();
  ctx.fillStyle='rgba(64,87,110,.28)';ctx.fillRect(r.x+3,r.y+r.h*.4,r.w-6,r.h*.27);
  for(let x=r.x+14;x<r.x+r.w-13;x+=38){rr(ctx,x,r.y+5,22,7,2);ctx.fillStyle='#8b9cac';ctx.fill();ctx.strokeStyle='rgba(250,253,255,.7)';ctx.lineWidth=1;ctx.stroke();}
}
function drawMobileDevice(d) {
  const x=d.x,y=DEV_TOP,w=devW(d),h=DEV_BOT-DEV_TOP,cx=x+w/2;
  if(!d.installed){
    ctx.save();ctx.setLineDash([7,6]);rr(ctx,x,y,w,h,10);ctx.fillStyle='rgba(236,242,248,.38)';ctx.fill();ctx.strokeStyle='#a8b7c6';ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);
    ctx.textAlign='center';ctx.fillStyle='#9aabba';ctx.font='bold 15px system-ui,sans-serif';ctx.fillText(d.label,cx,y+h*.58);ctx.font='11px system-ui,sans-serif';ctx.fillText('место для детали',cx,y+h*.58+16);ctx.restore();return;
  }
  ctx.save();ctx.shadowColor='rgba(30,49,68,.42)';ctx.shadowBlur=12;ctx.shadowOffsetX=3;ctx.shadowOffsetY=8;
  rr(ctx,x-1,y+3,w+2,h+2,10);ctx.fillStyle='#7c8a9b';ctx.fill();ctx.restore();
  mobileMetal(x,y,w,h,9);
  if(d.kind==='meter'||d.kind==='meter3'){
    rr(ctx,x+7,y-6,w-14,17,5);ctx.fillStyle='#344b5d';ctx.fill();ctx.strokeStyle='#223a4c';ctx.lineWidth=2;ctx.stroke();
    rr(ctx,x+10,y+32,w-20,h-68,6);let face=ctx.createLinearGradient(0,y+30,0,y+h-30);face.addColorStop(0,'#fbfdff');face.addColorStop(1,'#d6e1ea');ctx.fillStyle=face;ctx.fill();ctx.strokeStyle='#adbccb';ctx.lineWidth=1.5;ctx.stroke();
    const sx=x+18, sy=y+52, sw=w-36, sh=68;
    rr(ctx,sx,sy,sw,sh,5);ctx.fillStyle='#334b5c';ctx.fill();ctx.strokeStyle='#253b4a';ctx.lineWidth=2;ctx.stroke();
    rr(ctx,sx+7,sy+8,sw-14,sh-24,3);const lcd=ctx.createLinearGradient(0,sy,0,sy+sh);lcd.addColorStop(0,'#1b2c35');lcd.addColorStop(1,'#48616d');ctx.fillStyle=lcd;ctx.fill();
    ctx.textAlign='center';ctx.font='bold '+Math.max(14,Math.min(23,w*.17))+'px ui-monospace,monospace';ctx.fillStyle='#a8e2e5';ctx.fillText('220.5 V',cx,sy+36);
    ctx.fillStyle='#d5e8ef';ctx.font='bold '+Math.max(9,Math.min(12,w*.08))+'px system-ui';ctx.fillText('СЧЁТЧИК',cx,sy+60);
    ctx.beginPath();ctx.arc(x+12,y+h-48,4,0,TAU);ctx.fillStyle='#83c36e';ctx.fill();
  } else {
    rr(ctx,x+3,y+44,w-6,h-88,6);const body=ctx.createLinearGradient(x,y,x+w,y+h);body.addColorStop(0,'#f7fafc');body.addColorStop(.52,'#e9eef3');body.addColorStop(1,'#c7d4df');ctx.fillStyle=body;ctx.fill();ctx.strokeStyle='#9aabba';ctx.lineWidth=1.5;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x+6,y+115);ctx.lineTo(x+w-6,y+115);ctx.strokeStyle='#becbd5';ctx.lineWidth=2;ctx.stroke();
    if(d.kind==='socket'){
      ctx.beginPath();ctx.arc(cx,y+84,24,0,TAU);ctx.fillStyle='#c9d5de';ctx.fill();ctx.strokeStyle='#90a2b2';ctx.stroke();
      for(const ox of [-8,8]){ctx.beginPath();ctx.arc(cx+ox,y+83,4,0,TAU);ctx.fillStyle='#495c6b';ctx.fill();}
    } else if(d.kind==='button'){
      ctx.beginPath();ctx.arc(cx,y+84,23,0,TAU);ctx.fillStyle='#778a99';ctx.fill();ctx.beginPath();ctx.arc(cx,y+81,16,0,TAU);ctx.fillStyle=d.sub==='стоп'?'#ca4946':'#55a879';ctx.fill();
    } else if(d.kind==='thermal'||d.kind==='motor'){
      ctx.beginPath();ctx.arc(cx,y+84,23,0,TAU);ctx.fillStyle='#cad8e2';ctx.fill();ctx.strokeStyle='#72899c';ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.moveTo(cx,y+84);ctx.lineTo(cx+12,y+71);ctx.strokeStyle='#466178';ctx.lineWidth=3;ctx.stroke();
    } else {
      rr(ctx,cx-27,y+65,54,40,3);ctx.fillStyle='#536577';ctx.fill();ctx.strokeStyle='#394b5b';ctx.lineWidth=2;ctx.stroke();
      const toggle=ctx.createLinearGradient(0,y+67,0,y+102);toggle.addColorStop(0,'#667581');toggle.addColorStop(.5,'#3a4a58');toggle.addColorStop(1,'#263844');
      rr(ctx,cx-24,y+68,28,34,2);ctx.fillStyle=toggle;ctx.fill();ctx.strokeStyle='#293c4b';ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx-22,y+82);ctx.lineTo(cx+1,y+82);ctx.moveTo(cx-22,y+89);ctx.lineTo(cx+1,y+89);ctx.strokeStyle='#8b9ba7';ctx.lineWidth=1;ctx.stroke();
      rr(ctx,cx+6,y+70,18,30,2);const amber=ctx.createLinearGradient(0,y+70,0,y+100);amber.addColorStop(0,'#eea74b');amber.addColorStop(1,'#bd6727');ctx.fillStyle=d.kind==='contactor'?'#7c8993':amber;ctx.fill();
      ctx.textAlign='center';ctx.fillStyle='#fff4e5';ctx.font='bold 13px system-ui';ctx.fillText('I',cx+15,y+90);
    }
    ctx.textAlign='center';ctx.fillStyle='#4f6273';ctx.font='bold '+Math.min(20,Math.max(14,w*.23))+'px system-ui';ctx.fillText(d.label,cx,y+144);
    ctx.fillStyle='#8b9dad';ctx.font='bold 11px system-ui';ctx.fillText(d.sub||'',cx,y+160);
  }
}
function drawMobileClamp(b){
  ctx.save();ctx.shadowColor='rgba(30,49,68,.24)';ctx.shadowBlur=6;ctx.shadowOffsetY=4;mobileMetal(b.x,b.y,b.w,b.h,5);ctx.restore();
  ctx.fillStyle=COLORS[b.type].base;rr(ctx,b.x+8,b.y+31,b.w-16,7,2);ctx.fill();
  ctx.textAlign='center';ctx.fillStyle='#5e7486';ctx.font='bold 11px system-ui';ctx.fillText(b.id.toUpperCase(),b.x+b.w/2,b.y+b.h-11);
}
function drawMobileBusbar(b){
  ctx.save();ctx.shadowColor='rgba(31,49,66,.3)';ctx.shadowBlur=8;ctx.shadowOffsetY=5;mobileMetal(b.x,b.y,b.w,b.h,8);ctx.restore();
  rr(ctx,b.x+6,b.y+8,39,b.h-16,5);ctx.fillStyle=b.type==='N'?'#2365ab':'#66953e';ctx.fill();ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 15px system-ui';ctx.fillText(b.label,b.x+25,b.y+31);
  const bx=b.x+51, by=b.y+12, bw=b.w-62,bh=b.h-24;rr(ctx,bx,by,bw,bh,4);let copper=ctx.createLinearGradient(0,by,0,by+bh);copper.addColorStop(0,'#f4d3ac');copper.addColorStop(.5,'#cc996c');copper.addColorStop(1,'#ac754c');ctx.fillStyle=copper;ctx.fill();ctx.strokeStyle='#987250';ctx.lineWidth=1;ctx.stroke();
  for(let i=0;i<5;i++)mobileScrew(bx+18+i*(bw-36)/4,by+bh/2,7);
}
function drawMobileNodes(){
  const t=nowMs();
  for(const id in nodes){const n=nodes[id], pending=state.pendingNode===id||state.probeNode===id, hinted=state.hint&&state.hint.nodes&&state.hint.nodes.includes(id)&&t<state.hint.until, flashing=state.flash&&state.flash.nodes.includes(id)&&t<state.flash.until;
    const loose=state.wires.some(w=>(w.a===id||w.b===id)&&(!w.cut||!w.stripped||!w.tightened));
    mobileScrew(n.x,n.y,n.devId==='nbus'||n.devId==='pebus'?8:10);
    if(pending||hinted||flashing||loose){ctx.beginPath();ctx.arc(n.x,n.y,15,0,TAU);ctx.strokeStyle=flashing?state.flash.color:hinted?'#55a8f5':'#eba83c';ctx.lineWidth=3;ctx.stroke();}
    if(n.showLabel){ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 14px system-ui,sans-serif';const ly=n.dir.y<0?n.y-17:n.y+18;ctx.lineJoin='round';ctx.strokeStyle='#eff5fa';ctx.lineWidth=4;ctx.strokeText(n.label,n.x,ly);ctx.fillStyle='#354c60';ctx.fillText(n.label,n.x,ly);ctx.restore();}
  }
}

function drawPanel() {
  if (compactWorld) { drawMobilePanel(); return; }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  rr(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.r);
  const g = ctx.createLinearGradient(PANEL.x, PANEL.y, PANEL.x + PANEL.w, PANEL.y + PANEL.h);
  const palette = panelPalette();
  g.addColorStop(0, palette[0]);
  g.addColorStop(0.45, palette[1]);
  g.addColorStop(1, palette[2]);
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
  if (compactWorld) { drawMobileRail(r); return; }
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
  if (compactWorld) { drawMobileDevice(d); return; }
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
  if (compactWorld) { drawMobileClamp(b); return; }
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
  if (compactWorld) { drawMobileBusbar(bar); return; }
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
    if (compactWorld) {
      const first = Math.min(12, Math.abs(p.lane-p.A.y)/2, Math.abs(p.B.x-p.A.x)/2);
      const second = Math.min(12, Math.abs(p.lane-p.B.y)/2, Math.abs(p.B.x-p.A.x)/2);
      ctx.arcTo(p.p1.x,p.p1.y,p.p2.x,p.p2.y,first);
      ctx.arcTo(p.p2.x,p.p2.y,p.B.x,p.B.y,second);
      ctx.lineTo(p.B.x,p.B.y);
    } else { ctx.lineTo(p.p1.x, p.p1.y); ctx.lineTo(p.p2.x, p.p2.y); ctx.lineTo(p.B.x, p.B.y); }

    ctx.save();
    ctx.translate(2, 3);
    ctx.strokeStyle = 'rgba(15,20,26,0.22)';
    ctx.lineWidth = compactWorld ? 15 : 8;
    ctx.stroke();
    ctx.restore();

    if (compactWorld) { ctx.strokeStyle = c.dark; ctx.lineWidth = 13; ctx.stroke(); }
    ctx.strokeStyle = c.base;
    ctx.lineWidth = compactWorld ? 9 : (hovered ? 7.5 : 6.5);
    ctx.stroke();

    ctx.strokeStyle = c.light;
    ctx.lineWidth = compactWorld ? 3 : 2;
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
  if (compactWorld) { drawMobileNodes(); return; }
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
      ctx.fillStyle = '#34495d';
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
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
  drawPanelLighting();
  drawRail(RAIL_TOP);
  for (const d of activeDevices) drawDevice(d);
  drawRail(RAIL_BOT);
  for (const b of activeClamps) drawClamp(b);
  for (const b of activeBuses) drawBusbar(b);

  drawWires();
  drawNodes();
  if (!compactWorld) drawTray();
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
  if (state.tasks.every((t) => t.done)) { state.readyForLaunch = true; document.getElementById('launchButton').hidden = false; toast('Монтаж готов! Запустите объект ⚡', 'ok'); }
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
  if (!state.verifiedWireIds.includes(wire.id)) state.verifiedWireIds.push(wire.id);
  updateHUD();
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
  state.verifiedWireIds = state.verifiedWireIds.filter(id => id !== wire.id);
  state.probeNode = null;
  state.history = state.history.filter((id) => id !== wire.id);
  const task = findWireTask(wire.a, wire.b);
  if (task && task.done) task.done = false;
  if (state.readyForLaunch) { state.readyForLaunch = false; document.getElementById('launchButton').hidden = true; }
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
  state.verifiedWireIds = [];
  state.readyForLaunch = false;
  document.getElementById('launchButton').hidden = true;
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
  state.readyForLaunch = false;
  state.verifiedWireIds = [];
  state.challenge = progress.challenge;
  document.getElementById('launchButton').hidden = true;
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
  camera.zoom = compactWorld ? 1 : 2.2; camera.cx = compactWorld ? W/2 : 350; camera.cy = compactWorld ? H/2 : 300;
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

// Контракты не блокируют заказы: это добровольная дополнительная цель.
const CHALLENGES = {
  standard:{name:'Обычный', description:'Без дополнительных условий', bonus:0},
  master:{name:'Мастер', description:'Без ошибок и подсказок, проверить 2 разных провода мультиметром', checks:2, bonus:.30},
  expert:{name:'Эталон', description:'Без ошибок и подсказок, 100% аккуратность, проверить 3 разных провода', checks:3, bonus:.60},
};
const SHOP_ITEMS = [
  {id:'panel-standard',slot:'panel',name:'Светлый металл',desc:'Классическая панель',price:0,swatch:'#d9e2eb'},
  {id:'panel-cream',slot:'panel',name:'Тёплый фарфор',desc:'Панель с тёплым оттенком',price:1800,swatch:'#e8d8bc'},
  {id:'panel-blue',slot:'panel',name:'Северная сталь',desc:'Холодная голубая панель',price:2700,swatch:'#b7d2e2'},
  {id:'panel-graphite',slot:'panel',name:'Титановый серый',desc:'Более глубокий оттенок панели',price:3900,swatch:'#9daab7'},
  {id:'light-none',slot:'light',name:'Без подсветки',desc:'Стандартный вид щита',price:0,swatch:'#70818f'},
  {id:'light-warm',slot:'light',name:'Янтарная подсветка',desc:'Тёплый свет по краям щита',price:2200,swatch:'#ffba55'},
  {id:'light-blue',slot:'light',name:'Лазурная подсветка',desc:'Холодный свет по краям щита',price:3000,swatch:'#65d5ff'},
];
function challengePass(id, neat) {
  if (id === 'standard') return true;
  return state.mistakes === 0 && state.hintsUsed === 0 && (id !== 'expert' || neat === 100) && state.verifiedWireIds.length >= (CHALLENGES[id].checks || 0);
}
function panelPalette() {
  return ({'panel-cream':['#fff9ed','#eee2cf','#c9b9a2'], 'panel-blue':['#f1fbff','#d5e9f3','#a9c4d6'], 'panel-graphite':['#edf2f5','#c8d3db','#90a1ae']})[progress.equipped.panel] || ['#f7faff','#e5ebf2','#becbd9'];
}
function drawPanelLighting() {
  if (progress.equipped.light === 'light-none') return;
  const color = progress.equipped.light === 'light-warm' ? '#ffb44f' : '#4cc8ff';
  ctx.save();ctx.shadowColor=color;ctx.shadowBlur=10;ctx.strokeStyle=color;ctx.globalAlpha=.72;ctx.lineWidth=3;
  rr(ctx,PANEL.x+12,PANEL.y+12,PANEL.w-24,PANEL.h-24,14);ctx.stroke();ctx.restore();
}
function challengeSelector() {
  return '<div class="contract-picker"><div class="section-eyebrow">ДОПОЛНИТЕЛЬНЫЙ КОНТРАКТ · НА СЛЕДУЮЩИЙ ЗАКАЗ</div><div class="contract-options">' + Object.entries(CHALLENGES).map(([id,c])=>'<button class="contract-choice '+(progress.challenge===id?'chosen':'')+'" data-challenge="'+id+'" aria-pressed="'+(progress.challenge===id)+'"><b>'+c.name+(c.bonus?' · +'+Math.round(c.bonus*100)+'%':'')+'</b><span>'+c.description+'</span></button>').join('') + '</div><small>Бонус за условия контракта. Если не получилось — обычная награда сохраняется.</small></div>';
}
function careerBadges() {
  const completed=Object.values(progress.levels).filter(l=>l.completed).length;
  const stars=LEVELS.reduce((s,_,i)=>s+levelStars(i),0);
  const badges=[['Первый объект',completed>=1],['5 объектов',completed>=5],['30 звёзд',stars>=30],['Контракт мастера',progress.records.master>0],['Эталон',progress.records.expert>0]];
  return '<div class="career-badges"><div class="section-eyebrow">ДОСТИЖЕНИЯ</div><div class="badge-list">'+badges.map(([name,ok])=>'<span class="career-badge '+(ok?'earned':'')+'">'+(ok?'◆':'◇')+' '+name+'</span>').join('')+'</div></div>';
}
function launchScene() {
  const title = state.level.name;
  const home = /дом|дача|коттедж/i.test(title) || state.level.chapter === 'Частный дом';
  const industrial = /котельн|серверн|мастерск|пекарн|насосн/i.test(title) || state.level.chapter === 'Инфраструктура';
  if (home || industrial) {
    const drawing = home ?
      '<path d="M0 101Q55 76 112 100T220 96T360 96V130H0Z" fill="#34545c"/><path d="M50 108V64l49-33 49 33v44" fill="#5f7c86" stroke="#a7c6c9" stroke-width="2"/><path d="m40 67 59-40 59 40" fill="none" stroke="#d0c5ac" stroke-width="5"/><path d="M120 45V26h12v27" fill="#7897a2"/><path d="M90 108V78h20v30" fill="#2b4556"/><g class="scene-windows" fill="#ffda7a"><rect x="63" y="73" width="17" height="16" rx="2"/><rect x="119" y="73" width="17" height="16" rx="2"/></g><path d="M226 104V73m-18 3 18-33 18 33zM275 106V81m-17 2 17-32 17 32z" fill="#315b57" stroke="#779d86" stroke-width="3"/><circle cx="199" cy="80" r="5" fill="#ffe39b"/><path d="M199 85v22" stroke="#d3c39c" stroke-width="3"/>' :
      '<path d="M0 106h360v24H0z" fill="#294a52"/><path d="M39 109V63l31-16v16l30-16v62M101 109V45h93v64M213 109V66h105v43" fill="#526e7a" stroke="#9ab6bd" stroke-width="2"/><path d="M118 45V24h12v21m35 0V15h15v30" stroke="#b1c4c5" stroke-width="5"/><path d="M237 64V46h54v18" stroke="#93b5c1" stroke-width="4" fill="none"/><g class="scene-windows" fill="#ffda7a"><path d="M111 59h15v13h-15zm24 0h15v13h-15zm24 0h15v13h-15zm-48 21h15v13h-15zm24 0h15v13h-15zm24 0h15v13h-15zM226 78h14v13h-14zm23 0h14v13h-14zm23 0h14v13h-14zm23 0h14v13h-14z"/></g>';
    return '<div class="launch-scene" aria-label="Художественная анимация запущенного объекта"><div class="launch-caption"><span>ОБЪЕКТ ЗАПУЩЕН</span><b>'+title+'</b></div><svg viewBox="0 0 360 130" aria-hidden="true"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#152b48"/><stop offset="1" stop-color="#395f6b"/></linearGradient></defs><rect width="360" height="130" rx="14" fill="url(#sky)"/><circle cx="309" cy="24" r="11" fill="#f6ddb1" opacity=".8"/>'+drawing+'<path d="M0 110h360" stroke="#efbd70" stroke-width="2"/><path class="energy-dash" d="M0 115h360" stroke="#a6fff1" stroke-width="2" stroke-dasharray="6 16"/></svg><small>Художественная визуализация, не проверка реальной цепи</small></div>';
  }
  return '<div class="launch-scene" aria-label="Художественная анимация запущенного объекта"><div class="launch-caption"><span>ОБЪЕКТ ЗАПУЩЕН</span><b>' + state.level.name + '</b></div><svg viewBox="0 0 360 130" aria-hidden="true"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#172c49"/><stop offset="1" stop-color="#27495e"/></linearGradient><linearGradient id="ground" x2="1" y2="0"><stop stop-color="#f4a83b"/><stop offset="1" stop-color="#83e5d5"/></linearGradient></defs><rect width="360" height="130" rx="14" fill="url(#sky)"/><circle cx="305" cy="28" r="12" fill="#e6d6aa" opacity=".8"/><path d="M0 99 42 74 71 87 105 64 136 89 183 71 232 94 281 70 360 92V130H0Z" fill="#263f50"/><path d="M32 110V61l28-17 28 17v49M43 110V78h13v32M68 78h10v11H68z" fill="#668291" stroke="#a9c5ca" stroke-width="2"/><path d="M112 110V39h48v71M171 110V54h43v56M223 110V30h53v80" fill="#405e70" stroke="#9ab6c1" stroke-width="2"/><g class="scene-windows" fill="#ffd46b"><path d="M120 50h10v10h-10zm17 0h10v10h-10zm-17 18h10v10h-10zm17 0h10v10h-10zm-17 18h10v10h-10zm17 0h10v10h-10zM179 64h10v10h-10zm16 0h10v10h-10zm-16 18h10v10h-10zm16 0h10v10h-10zM231 42h10v10h-10zm18 0h10v10h-10zm-18 18h10v10h-10zm18 0h10v10h-10zm-18 18h10v10h-10zm18 0h10v10h-10zM68 78h10v11H68z"/></g><path d="M0 111h360" stroke="url(#ground)" stroke-width="3"/><path class="energy-dash" d="M5 115h350" stroke="#a6fff1" stroke-width="2" stroke-dasharray="6 16"/></svg><small>Художественная визуализация, не проверка реальной цепи</small></div>';
}
function showShop(message = '') {
  if (state.running && !state.finished && !state.paused) state.paused = true;
  state.pendingNode=null;state.probeNode=null;state.dragPart=null;state.dragWire=null;
  const overlay=document.getElementById('overlay');
  const sections=[['panel','Панели'],['light','Подсветка']].map(([slot,title])=>'<h3 class="shop-heading">'+title+'</h3><div class="shop-grid">'+SHOP_ITEMS.filter(i=>i.slot===slot).map(i=>{
    const owned=progress.owned.includes(i.id), active=progress.equipped[slot]===i.id;
    return '<div class="shop-item '+(active?'equipped':'')+'"><span class="shop-swatch" style="--swatch:'+i.swatch+'"></span><div><b>'+i.name+'</b><small>'+i.desc+'</small></div><button class="btn '+(active?'shop-active':'')+'" data-shop-item="'+i.id+'" '+(active?'disabled':'')+'>'+(active?'Выбрано':owned?'Применить':i.price+' ◇')+'</button></div>';
  }).join('')+'</div>').join('');
  overlay.innerHTML='<div class="card shop-card"><div class="card-badge">мастерская</div><h2>Магазин</h2><p class="lead">Баланс: <b class="gold">'+progress.wallet+' ◇</b> · зарабатывайте очки за выполнение заказов. Покупки меняют только внешний вид.</p>'+(message?'<div class="shop-message" role="status">'+message+'</div>':'')+'<button class="btn shop-back-top" id="btnShopBack">← К заказам</button>'+sections+'<button class="btn primary big" id="btnShopBackBottom">← К заказам</button></div>';
  overlay.classList.add('show');
}
function chooseShopItem(id) {
  const item=SHOP_ITEMS.find(i=>i.id===id);if(!item)return;
  if(!progress.owned.includes(id)) {
    if(progress.wallet<item.price){showShop('Не хватает очков: нужно '+item.price+' ◇');return;}
    progress.wallet-=item.price;progress.owned.push(id);
  }
  progress.equipped[item.slot]=id;saveProgress();Sound.click();showShop();
}

function finishGame() {
  if (state.finished) return;
  state.finished = true;
  state.running = false;
  const neat = getNeatness();
  const score = calculateScore(neat);
  const stars = 1 + (state.mistakes === 0 ? 1 : 0) + (neat >= 90 ? 1 : 0);
  const id = state.level.id;
  const challenge = CHALLENGES[state.challenge] || CHALLENGES.standard;
  const passed = challengePass(state.challenge, neat);
  const bonus = passed ? Math.round(score * challenge.bonus) : 0;
  const reward = score + bonus;
  progress.wallet += reward;
  progress.records.wins++;
  if (state.challenge !== 'standard' && passed) progress.records[state.challenge]++;
  document.getElementById('launchButton').hidden = true;
  const prev = progress.levels[id] || { bestScore: 0, bestTime: Infinity, stars: 0, completed: false };
  progress.levels[id] = {
    completed: true,
    bestScore: Math.max(prev.bestScore || 0, score),
    bestTime: Math.min(prev.bestTime || Infinity, state.elapsed),
    stars: Math.max(prev.stars || 0, stars),
  };
  saveProgress();
  Sound.win();
  const finishedLevel = state.level;
  setTimeout(() => { if (state.finished && state.level === finishedLevel && !document.getElementById('overlay').classList.contains('show')) showWin(score, neat, stars, reward, bonus, passed, challenge); }, 650);
}

function showWin(score, neat, stars, reward, bonus, passed, challenge) {
  const nextIndex = state.levelIndex + 1;
  const hasNext = nextIndex < LEVELS.length && isLevelUnlocked(nextIndex);
  const best = progress.levels[state.level.id];
  const overlay = document.getElementById('overlay');
  overlay.innerHTML =
    '<div class="card">' +
      '<div class="card-badge">объект запущен</div>' +
      '<h2>Свет есть! ⚡</h2>' +
      launchScene() +
      '<details class="finished-board"><summary>Посмотреть собранный щит</summary><img alt="Собранный игровой щит" src="' + canvas.toDataURL('image/png') + '"></details>' +
      '<div class="reward-banner"><span>Заработано за заказ</span><strong>+' + reward + ' ◇</strong><small>' + (challenge.bonus ? challenge.name + ': ' + (passed ? 'бонус +' + bonus : 'условия не выполнены, без бонуса') : 'Баланс: ' + progress.wallet + ' ◇') + '</small></div>' +
      '<div class="win-actions" style="margin-top:12px">' +
        (hasNext ? '<button class="btn primary big" id="btnNextLevel">Следующий уровень →</button>' : '') +
        '<div class="row">' +
          '<button class="btn" id="btnAgain">Заново</button>' +
          '<button class="btn" id="btnLevelsWin">К уровням</button>' +
          '<button class="btn" id="btnShopWin">Магазин</button>' +
        '</div>' +
      '</div>' +
      '<div class="stars">' + '★'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>' +
      '<p class="lead">' + (state.mistakes === 0 ? '✓ Без ошибок' : '○ Без ошибок') + ' &nbsp; · &nbsp; ' + (neat >= 90 ? '✓ Аккуратность от 90%' : '○ Аккуратность от 90%') + '</p>' +
      '<div class="result-grid">' +
        '<div><span>Счёт</span><b>' + score + '</b></div>' +
        '<div><span>Лучший</span><b>' + (best ? best.bestScore : score) + '</b></div>' +
        '<div><span>Время</span><b>' + fmtTime(state.elapsed) + '</b></div>' +
        '<div><span>Аккуратность</span><b>' + neat + '%</b></div>' +
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
      (canResume ? '<button class="btn primary big resume-top" id="btnContinue">← Продолжить монтаж</button>' : '') +
      '<p class="lead">' + LEVELS.length + ' заказов · все открыты · результаты сохраняются в браузере.<br>Схемы условные — это игра, не инструкция по электромонтажу.</p>' +
      '<div class="career-bar"><div><small>ВАШ БАЛАНС</small><strong>' + progress.wallet + ' ◇</strong></div><button class="btn" id="btnShopLevels">Магазин →</button></div>' +
      challengeSelector() + careerBadges() + cards +
      '<div class="profile-row">' +
        '<span>★ <b>' + totalStars + '</b> / ' + (LEVELS.length * 3) + '</span>' +
        '<span>Щитов собрано: <b>' + completed + '</b> / ' + LEVELS.length + '</span>' +
        '<span>Инструментов: <b>' + TOOL_ORDER.filter(isToolUnlocked).length + '</b> / ' + TOOL_ORDER.length + '</span>' +
      '</div>' +
      '<div class="level-actions">' +
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
  window.SHCHITOK.progress = progress;
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

// Встроенные фрагменты выбранного эскиза: изображения работают без сети.
const referenceArt = {"L":"data:image/png;base64,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","N":"data:image/png;base64,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","PE":"data:image/png;base64,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","cutters":"data:image/png;base64,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","stripper":"data:image/png;base64,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","screwdriver":"data:image/png;base64,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","multimeter":"data:image/png;base64,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"};
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
  const key = color === 'auto' ? 'L' : color;
  return '<img class="part-art reference-part" src="'+referenceArt[key]+'" alt="">';
}
function deviceArt(d) {
  if (d.kind === 'meter' || d.kind === 'meter3') return '<svg class="part-art" viewBox="0 0 64 50" aria-hidden="true"><rect x="14" y="4" width="36" height="42" rx="4" fill="#dce5ee" stroke="#94a4b6" stroke-width="2"/><rect x="19" y="12" width="26" height="14" rx="2" fill="#344c61"/><path d="M22 19h20" stroke="#7dd7e6" stroke-width="2"/><circle cx="23" cy="37" r="3" fill="#728598"/><circle cx="41" cy="37" r="3" fill="#728598"/></svg>';
  return '<svg class="part-art" viewBox="0 0 64 50" aria-hidden="true"><rect x="20" y="3" width="24" height="44" rx="3" fill="#dde5eb" stroke="#94a4b6" stroke-width="2"/><rect x="24" y="17" width="16" height="12" rx="2" fill="#4c6275"/><rect x="31" y="17" width="7" height="11" fill="#e0a03a"/><circle cx="32" cy="9" r="2" fill="#687a8b"/><circle cx="32" cy="41" r="2" fill="#687a8b"/></svg>';
}
function renderMobileParts() {
  const container = document.getElementById('mobileParts');
  const scrollBefore = container.querySelector('.parts-track')?.scrollLeft || 0;
  const parts = state.assembly ? [] : activeDevices.filter(d => !d.installed);
  const colors = [['L','Провод L'],['N','Провод N'],['PE','Земля'],['auto','Авто']];
  const wireCards = colors.map(([id,label]) => '<button class="part-button wire-choice ' + (state.selectedColor === id ? 'active' : '') + '" data-mobile-color="'+id+'" aria-pressed="'+(state.selectedColor === id)+'">' + wireArt(id) + '<span>'+label+'</span></button>').join('');
  const deviceCards = parts.map(d => '<button class="part-button ' + (mobileDevice === d.id ? 'active' : '') + '" data-mobile-part="' + d.id + '" aria-pressed="'+(mobileDevice===d.id)+'">' + deviceArt(d) + '<span>' + d.label + '</span></button>').join('');
  container.innerHTML = '<div class="parts-heading"><span class="parts-symbol">⬡</span> ДЕТАЛИ <button class="quick-hand ' + (state.tool === 'hand' ? 'active' : '') + '" data-quick-hand aria-pressed="' + (state.tool === 'hand') + '">Рука</button><small>ЛИСТАЙТЕ →</small></div><div class="parts-track">' + (parts.length ? deviceCards + wireCards : wireCards) + '</div>';
  container.querySelector('.parts-track').scrollLeft = scrollBefore;
}

function calculateScore(neat) {
  const done = state.tasks.filter(t => t.done).length;
  const timeBonus = Math.max(0, 300 - Math.floor(state.elapsed)) * 2;
  return Math.max(0, done * 100 + (state.wires.length ? Math.round(neat * 1.5) : 0) + timeBonus - state.mistakes * 15 - state.hintsUsed * 20);
}

function updateHUD() {
  const done = state.tasks.filter((t) => t.done).length;
  const neat = getNeatness();
  const detail = neatnessDetails();
  const detailEl = document.getElementById('neatDetail');
  if (detailEl) detailEl.textContent = detail.overlaps || detail.overDevices ? 'Наложения: ' + detail.overlaps + ' · поверх приборов: ' + detail.overDevices : 'Нет наложений и проходов по приборам';
  const score = calculateScore(neat);
  const launch = document.getElementById('launchButton');
  if (state.readyForLaunch) {
    const c = CHALLENGES[state.challenge];
    const detail = c.bonus ? (challengePass(state.challenge, neat) ? 'Бонус контракта доступен' : 'Пуск без бонуса: проверьте условия') : 'Все задания выполнены';
    launch.innerHTML = '⚡ Запустить объект <span>' + detail + '</span>';
    if (c.bonus && !challengePass(state.challenge, neat)) document.getElementById('mobileNextTask').textContent = 'Контракт: проверки ' + Math.min(state.verifiedWireIds.length,c.checks) + '/' + c.checks + ' · откройте «Задания»';
  }
  const goals = document.getElementById('starGoals');
  if (goals) goals.innerHTML = '<b>Цели на звёзды</b><span>★ Завершить заказ</span><span>' + (state.mistakes === 0 ? '☆' : '○') + ' Без ошибок</span><span>' + (neat >= 90 ? '☆' : '○') + ' Аккуратность от 90%</span>' + (state.challenge !== 'standard' ? '<b>Контракт: ' + CHALLENGES[state.challenge].name + '</b><span>' + CHALLENGES[state.challenge].description + '</span><span>Проверено соединений: ' + Math.min(state.verifiedWireIds.length, CHALLENGES[state.challenge].checks) + ' / ' + CHALLENGES[state.challenge].checks + '</span><span>' + (challengePass(state.challenge, neat) ? '✓ Условия соблюдены' : '○ Условия сейчас не соблюдены') + '</span>' : '');
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
  const visibleOrder = compactWorld ? ['cutters','stripper','screwdriver','multimeter','hand','remove'] : TOOL_ORDER;
  elToolBelt.innerHTML = visibleOrder.map((id) => {
    const t = TOOLS[id];
    const unlocked = isToolUnlocked(id);
    const active = state.tool === id;
    const title = unlocked ? t.desc : 'Откроется: ' + (TOOL_UNLOCK[id] ? TOOL_UNLOCK[id].text : '');
    return '<button class="tool ' + (active ? 'active' : '') + ' ' + (unlocked ? '' : 'locked') + '" data-tool="' + id + '" title="' + title + '" ' + (unlocked ? '' : 'disabled') + '>' +
      '<span class="tool-icon">' + (unlocked ? t.icon : '🔒') + '</span>' +
      (unlocked ? (referenceArt[id] ? '<img class="tool-art reference-tool tool-art-'+id+'" src="'+referenceArt[id]+'" alt="">' : svgArt(toolArt[id], 'tool-art')) : '') +
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
    if (count) { state.hintsUsed++; updateHUD(); }
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
  const contract = e.target.closest('[data-challenge]');
  if (contract) { progress.challenge = contract.dataset.challenge; saveProgress(); showLevelSelect(); return; }
  const item = e.target.closest('[data-shop-item]');
  if (item) { chooseShopItem(item.dataset.shopItem); return; }
  if (e.target.closest('#btnShopLevels, #btnShopWin')) { showShop(); return; }
  if (e.target.closest('#btnShopBack, #btnShopBackBottom')) { showLevelSelect(); return; }
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
document.getElementById('btnShop').addEventListener('click', showShop);
document.getElementById('launchButton').addEventListener('click', () => { if (state.readyForLaunch && state.tasks.every(t => t.done) && state.running && !state.paused) finishGame(); });
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
  hintTask(task, true);
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
  if (e.target.closest('[data-quick-hand]')) { elToolBelt.querySelector('[data-tool="hand"]').click(); return; }
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
  version: '0.4.0',
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
