/* ============================================================
   ЩИТОК — уровни v0.3
   Рабочий процесс: детали на рейку → провода в зажимы →
   отрезать → зачистить → готово.
   ============================================================ */
window.LEVELS = [
  /* ---------------- УРОВЕНЬ 1 ---------------- */
  {
    id: 'l1',
    name: 'Квартира · ввод',
    subtitle: 'Зажимы, провода, автоматы',
    difficulty: 1,
    devices: [
      { id: 'qf1', label: 'QF1', sub: 'C16', mods: 2, kind: 'breaker' },
      { id: 'meter', label: 'Счётчик', sub: '', mods: 3, kind: 'meter' },
      { id: 'qf2', label: 'QF2', sub: 'C10', mods: 1, kind: 'breaker' },
    ],
    clamps: [
      { id: 'x1', type: 'L' }, { id: 'x2', type: 'N' },
      { id: 'x3', type: 'L' }, { id: 'x4', type: 'PE' },
    ],
    buses: [
      { id: 'nbus', type: 'N', label: 'N', x: 300, w: 190, nodeOffset: 20 },
      { id: 'pebus', type: 'PE', label: 'PE', x: 520, w: 190, nodeOffset: 95 },
    ],
    tasks: [
      { id: 't1', type: 'install', device: 'qf1', text: 'Установите QF1 на DIN-рейку' },
      { id: 't2', type: 'install', device: 'qf2', text: 'Установите QF2 на DIN-рейку' },
      { id: 't3', type: 'install', device: 'meter', text: 'Смонтируйте счётчик на DIN-рейку' },
      { id: 't4', type: 'wire', from: 'qf1_b2', to: 'm1', color: 'L', text: 'QF1 (2) → счётчик (1)' },
      { id: 't5', type: 'wire', from: 'qf1_b4', to: 'm3', color: 'N', text: 'QF1 (4) → счётчик (3)' },
      { id: 't6', type: 'wire', from: 'm2', to: 'x1', color: 'L', text: 'Счётчик (2) → клемма X1' },
      { id: 't7', type: 'wire', from: 'm4', to: 'x2', color: 'N', text: 'Счётчик (4) → клемма X2' },
      { id: 't8', type: 'wire', from: 'x1', to: 'qf2_t1', color: 'L', text: 'X1 → QF2 (1)' },
      { id: 't9', type: 'wire', from: 'qf2_b2', to: 'x3', color: 'L', text: 'QF2 (2) → клемма X3' },
      { id: 't10', type: 'wire', from: 'x4', to: 'pebus', color: 'PE', text: 'X4 → PE-шина' },
    ],
  },

  /* ---------------- УРОВЕНЬ 2 ---------------- */
  {
    id: 'l2',
    name: 'Дом · щитовая',
    subtitle: 'RCD, больше клемм и линий',
    difficulty: 2,
    devices: [
      { id: 'qf1', label: 'QF1', sub: 'C25', mods: 2, kind: 'breaker' },
      { id: 'meter', label: 'Счётчик', sub: '', mods: 3, kind: 'meter' },
      { id: 'rcd', label: 'RCD', sub: '30 мА', mods: 2, kind: 'rcd' },
      { id: 'qf2', label: 'QF2', sub: 'C16', mods: 1, kind: 'breaker' },
      { id: 'qf3', label: 'QF3', sub: 'C16', mods: 1, kind: 'breaker' },
    ],
    clamps: [
      { id: 'x1', type: 'L' }, { id: 'x2', type: 'N' },
      { id: 'x3', type: 'L' }, { id: 'x4', type: 'N' },
      { id: 'x5', type: 'L' }, { id: 'x6', type: 'PE' },
    ],
    buses: [
      { id: 'nbus', type: 'N', label: 'N', x: 400, w: 190, nodeOffset: 20 },
      { id: 'pebus', type: 'PE', label: 'PE', x: 620, w: 190, nodeOffset: 95 },
    ],
    tasks: [
      { id: 't1', type: 'install', device: 'qf1', text: 'Установите QF1 на DIN-рейку' },
      { id: 't2', type: 'install', device: 'rcd', text: 'Установите RCD на DIN-рейку' },
      { id: 't3', type: 'install', device: 'qf2', text: 'Установите QF2 на DIN-рейку' },
      { id: 't4', type: 'install', device: 'meter', text: 'Смонтируйте счётчик на DIN-рейку' },
      { id: 't5', type: 'wire', from: 'qf1_b2', to: 'm1', color: 'L', text: 'QF1 (2) → счётчик (1)' },
      { id: 't6', type: 'wire', from: 'qf1_b4', to: 'm3', color: 'N', text: 'QF1 (4) → счётчик (3)' },
      { id: 't7', type: 'wire', from: 'm2', to: 'rcd_t1', color: 'L', text: 'Счётчик (2) → RCD (1)' },
      { id: 't8', type: 'wire', from: 'm4', to: 'x2', color: 'N', text: 'Счётчик (4) → клемма X2' },
      { id: 't9', type: 'wire', from: 'rcd_b2', to: 'qf2_t1', color: 'L', text: 'RCD (2) → QF2 (1)' },
      { id: 't10', type: 'wire', from: 'qf2_b2', to: 'x1', color: 'L', text: 'QF2 (2) → клемма X1' },
      { id: 't11', type: 'wire', from: 'x6', to: 'pebus', color: 'PE', text: 'X6 → PE-шина' },
    ],
  },

  /* ---------------- УРОВЕНЬ 3 ---------------- */
  {
    id: 'l3',
    name: 'Мастерская · станок',
    subtitle: 'Контактор и линия станка',
    difficulty: 3,
    devices: [
      { id: 'qf1', label: 'QF1', sub: 'C25', mods: 2, kind: 'breaker' },
      { id: 'meter', label: 'Счётчик', sub: '', mods: 3, kind: 'meter' },
      { id: 'rcd', label: 'RCD', sub: '30 мА', mods: 2, kind: 'rcd' },
      { id: 'qf2', label: 'QF2', sub: 'C16', mods: 1, kind: 'breaker' },
      { id: 'qf3', label: 'QF3', sub: 'C16', mods: 1, kind: 'breaker' },
      { id: 'km1', label: 'KM1', sub: 'контактор', mods: 2, kind: 'contactor' },
    ],
    clamps: [
      { id: 'x1', type: 'L' }, { id: 'x2', type: 'N' },
      { id: 'x3', type: 'L' }, { id: 'x4', type: 'N' },
      { id: 'x5', type: 'L' }, { id: 'x6', type: 'L' },
      { id: 'x7', type: 'N' }, { id: 'x8', type: 'PE' },
    ],
    buses: [
      { id: 'nbus', type: 'N', label: 'N', x: 500, w: 190, nodeOffset: 20 },
      { id: 'pebus', type: 'PE', label: 'PE', x: 710, w: 190, nodeOffset: 95 },
    ],
    tasks: [
      { id: 't1', type: 'install', device: 'qf1', text: 'Установите QF1 на DIN-рейку' },
      { id: 't2', type: 'install', device: 'rcd', text: 'Установите RCD на DIN-рейку' },
      { id: 't3', type: 'install', device: 'qf2', text: 'Установите QF2 на DIN-рейку' },
      { id: 't4', type: 'install', device: 'km1', text: 'Установите контактор KM1' },
      { id: 't5', type: 'install', device: 'meter', text: 'Смонтируйте счётчик на DIN-рейку' },
      { id: 't6', type: 'wire', from: 'qf1_b2', to: 'm1', color: 'L', text: 'QF1 (2) → счётчик (1)' },
      { id: 't7', type: 'wire', from: 'qf1_b4', to: 'm3', color: 'N', text: 'QF1 (4) → счётчик (3)' },
      { id: 't8', type: 'wire', from: 'm2', to: 'rcd_t1', color: 'L', text: 'Счётчик (2) → RCD (1)' },
      { id: 't9', type: 'wire', from: 'm4', to: 'x2', color: 'N', text: 'Счётчик (4) → клемма X2' },
      { id: 't10', type: 'wire', from: 'rcd_b2', to: 'km1_t1', color: 'L', text: 'RCD (2) → KM1 (1)' },
      { id: 't11', type: 'wire', from: 'km1_b2', to: 'x1', color: 'L', text: 'KM1 (2) → клемма X1' },
      { id: 't12', type: 'wire', from: 'x8', to: 'pebus', color: 'PE', text: 'X8 → PE-шина' },
    ],
  },

  /* ---------------- УРОВЕНЬ 4: ГАРАЖ · СТАНОК ---------------- */
  {
    id: 'l4',
    name: 'Гараж · станок',
    subtitle: 'Контактор, тепловое реле, кнопки',
    difficulty: 2,
    devices: [
      { id: 'qf1', label: 'QF1', sub: 'C16', mods: 2, kind: 'breaker' },
      { id: 'km1', label: 'KM1', sub: 'контактор', mods: 2, kind: 'contactor' },
      { id: 'fr1', label: 'FR1', sub: 'тепл. реле', mods: 2, kind: 'thermal' },
      { id: 'sb1', label: 'SB1', sub: 'пуск', mods: 1, kind: 'button' },
      { id: 'sb2', label: 'SB2', sub: 'стоп', mods: 1, kind: 'button' },
      { id: 'm1', label: 'M1', sub: 'двигатель', mods: 2, kind: 'motor' },
    ],
    blocks: [
      { id: 'x1', type: 'L' }, { id: 'x2', type: 'L' },
      { id: 'x3', type: 'N' }, { id: 'x4', type: 'N' },
      { id: 'x5', type: 'L' }, { id: 'x6', type: 'PE' },
    ],
    buses: [
      { id: 'nbus', type: 'N', label: 'N', x: 400, w: 190, nodeOffset: 20 },
      { id: 'pebus', type: 'PE', label: 'PE', x: 620, w: 190, nodeOffset: 95 },
    ],
    tasks: [
      { id: 't1', type: 'install', device: 'qf1', text: 'Установите QF1 на DIN-рейку' },
      { id: 't2', type: 'install', device: 'km1', text: 'Установите контактор KM1' },
      { id: 't3', type: 'install', device: 'fr1', text: 'Установите тепловое реле FR1' },
      { id: 't4', type: 'install', device: 'sb1', text: 'Установите кнопку SB1 «пуск»' },
      { id: 't5', type: 'install', device: 'sb2', text: 'Установите кнопку SB2 «стоп»' },
      { id: 't6', type: 'install', device: 'm1', text: 'Установите двигатель M1' },
      { id: 't7', type: 'wire', from: 'qf1_b2', to: 'km1_b2', color: 'L', text: 'QF1 (2) → KM1 (2)' },
      { id: 't8', type: 'wire', from: 'km1_b4', to: 'fr1_t1', color: 'L', text: 'KM1 (4) → FR1 (1)' },
      { id: 't9', type: 'wire', from: 'fr1_b2', to: 'm1_t1', color: 'L', text: 'FR1 (2) → M1 (1)' },
      { id: 't10', type: 'wire', from: 'sb1_t1', to: 'km1_t1', color: 'L', text: 'SB1 (1) → KM1 (1)' },
      { id: 't11', type: 'wire', from: 'sb2_b2', to: 'km1_t1', color: 'L', text: 'SB2 (2) → KM1 (1)' },
      { id: 't12', type: 'wire', from: 'x6', to: 'pebus', color: 'PE', text: 'X6 → PE-шина' },
    ],
  },

  /* ---------------- УРОВЕНЬ 5: КУХНЯ · РОЗЕТКИ ---------------- */
  {
    id: 'l5',
    name: 'Кухня · розетки',
    subtitle: 'Группа RCD и розетки',
    difficulty: 2,
    devices: [
      { id: 'qf1', label: 'QF1', sub: 'C25', mods: 2, kind: 'breaker' },
      { id: 'rcd', label: 'RCD', sub: '30 мА', mods: 2, kind: 'rcd' },
      { id: 'qf2', label: 'QF2', sub: 'C16', mods: 1, kind: 'breaker' },
      { id: 'qf3', label: 'QF3', sub: 'C16', mods: 1, kind: 'breaker' },
      { id: 'xs1', label: 'XS1', sub: 'розетка', mods: 1, kind: 'socket' },
      { id: 'xs2', label: 'XS2', sub: 'розетка', mods: 1, kind: 'socket' },
    ],
    blocks: [
      { id: 'x1', type: 'L' }, { id: 'x2', type: 'N' },
      { id: 'x3', type: 'L' }, { id: 'x4', type: 'N' },
      { id: 'x5', type: 'L' }, { id: 'x6', type: 'PE' },
    ],
    buses: [
      { id: 'nbus', type: 'N', label: 'N', x: 400, w: 190, nodeOffset: 20 },
      { id: 'pebus', type: 'PE', label: 'PE', x: 620, w: 190, nodeOffset: 95 },
    ],
    tasks: [
      { id: 't1', type: 'install', device: 'qf1', text: 'Установите QF1 на DIN-рейку' },
      { id: 't2', type: 'install', device: 'rcd', text: 'Установите RCD на DIN-рейку' },
      { id: 't3', type: 'install', device: 'qf2', text: 'Установите QF2 на DIN-рейку' },
      { id: 't4', type: 'install', device: 'qf3', text: 'Установите QF3 на DIN-рейку' },
      { id: 't5', type: 'install', device: 'xs1', text: 'Установите розетку XS1' },
      { id: 't6', type: 'install', device: 'xs2', text: 'Установите розетку XS2' },
      { id: 't7', type: 'wire', from: 'qf1_b2', to: 'rcd_t1', color: 'L', text: 'QF1 (2) → RCD (1)' },
      { id: 't8', type: 'wire', from: 'qf1_b4', to: 'rcd_t3', color: 'N', text: 'QF1 (4) → RCD (3)' },
      { id: 't9', type: 'wire', from: 'rcd_b2', to: 'qf2_t1', color: 'L', text: 'RCD (2) → QF2 (1)' },
      { id: 't10', type: 'wire', from: 'rcd_b4', to: 'x2', color: 'N', text: 'RCD (4) → клемма X2' },
      { id: 't11', type: 'wire', from: 'qf2_b2', to: 'xs1_t1', color: 'L', text: 'QF2 (2) → XS1 (1)' },
      { id: 't12', type: 'wire', from: 'qf3_b2', to: 'xs2_t1', color: 'L', text: 'QF3 (2) → XS2 (1)' },
      { id: 't13', type: 'wire', from: 'pebus', to: 'xs1_b2', color: 'PE', text: 'PE-шина → XS1 (2)' },
      { id: 't14', type: 'wire', from: 'pebus', to: 'xs2_b2', color: 'PE', text: 'PE-шина → XS2 (2)' },
    ],
  },

  /* ---------------- УРОВЕНЬ 6: ТРЁХФАЗНЫЙ ВВОД ---------------- */
  {
    id: 'l6',
    name: 'Трёхфазный ввод',
    subtitle: '3 фазы, счётчик 3ф, нагрузка',
    difficulty: 3,
    devices: [
      { id: 'qf1', label: 'QF1', sub: 'C16 3P', mods: 3, kind: 'breaker3' },
      { id: 'meter', label: 'Счётчик 3ф', sub: '', mods: 4, kind: 'meter3' },
      { id: 'qf2', label: 'QF2', sub: 'C16 3P', mods: 3, kind: 'breaker3' },
    ],
    blocks: [
      { id: 'x1', type: 'L' }, { id: 'x2', type: 'L' },
      { id: 'x3', type: 'L' }, { id: 'x4', type: 'N' },
      { id: 'x5', type: 'L' }, { id: 'x6', type: 'L' },
      { id: 'x7', type: 'N' }, { id: 'x8', type: 'PE' },
    ],
    buses: [
      { id: 'nbus', type: 'N', label: 'N', x: 500, w: 190, nodeOffset: 20 },
      { id: 'pebus', type: 'PE', label: 'PE', x: 710, w: 190, nodeOffset: 95 },
    ],
    tasks: [
      { id: 't1', type: 'install', device: 'qf1', text: 'Установите трёхфазный QF1' },
      { id: 't2', type: 'install', device: 'meter', text: 'Смонтируйте трёхфазный счётчик' },
      { id: 't3', type: 'install', device: 'qf2', text: 'Установите трёхфазный QF2' },
      { id: 't4', type: 'wire', from: 'qf1_t1', to: 'm1', color: 'L', text: 'QF1 (1) → счётчик (1)' },
      { id: 't5', type: 'wire', from: 'qf1_t3', to: 'm2', color: 'L', text: 'QF1 (3) → счётчик (2)' },
      { id: 't6', type: 'wire', from: 'qf1_t5', to: 'm3', color: 'L', text: 'QF1 (5) → счётчик (3)' },
      { id: 't7', type: 'wire', from: 'qf1_b2', to: 'qf2_t1', color: 'L', text: 'QF1 (2) → QF2 (1)' },
      { id: 't8', type: 'wire', from: 'qf1_b4', to: 'qf2_t3', color: 'L', text: 'QF1 (4) → QF2 (3)' },
      { id: 't9', type: 'wire', from: 'qf1_b6', to: 'qf2_t5', color: 'L', text: 'QF1 (6) → QF2 (5)' },
      { id: 't10', type: 'wire', from: 'm4', to: 'nbus', color: 'N', text: 'Счётчик (4) → N-шина' },
      { id: 't11', type: 'wire', from: 'x8', to: 'pebus', color: 'PE', text: 'X8 → PE-шина' },
    ],
  },
];

/* Дополнительные заказы. Схемы — игровые, не руководство по электромонтажу. */
(() => {
  const D = (id, label, sub, mods, kind) => ({id, label, sub, mods, kind});
  const templates = [
    { devices: [D('qf1','QF1','C16',2,'breaker'),D('rcd','RCD','30 мА',2,'rcd'),D('qf2','QF2','C16',1,'breaker'),D('qf3','QF3','C10',1,'breaker'),D('xs1','XS1','розетка',1,'socket')],
      wires: [['qf1_b2','rcd_t1','L'],['qf1_b4','rcd_t3','N'],['rcd_b2','qf2_t1','L'],['rcd_b4','x2','N'],['qf2_b2','xs1_t1','L'],['qf3_b2','x1','L'],['pebus','xs1_b2','PE']] },
    { devices: [D('qf1','QF1','C16',2,'breaker'),D('km1','KM1','контактор',2,'contactor'),D('fr1','FR1','реле',2,'thermal'),D('sb1','SB1','пуск',1,'button'),D('sb2','SB2','стоп',1,'button')],
      wires: [['qf1_b2','km1_t1','L'],['qf1_b4','x2','N'],['km1_b2','fr1_t1','L'],['fr1_b2','x1','L'],['sb1_b2','km1_b4','L'],['sb2_b2','km1_t3','L'],['pebus','x6','PE']] },
    { devices: [D('qf1','QF1','C16 3P',3,'breaker3'),D('qf2','QF2','C16 3P',3,'breaker3'),D('qf3','QF3','C10',1,'breaker'),D('xs1','XS1','розетка',1,'socket')],
      wires: [['qf1_b2','qf2_t1','L'],['qf1_b4','qf2_t3','L'],['qf1_b6','qf2_t5','L'],['qf2_b2','x1','L'],['qf2_b4','x3','L'],['qf2_b6','qf3_t1','L'],['qf3_b2','xs1_t1','L'],['pebus','xs1_b2','PE']] },
    { devices: [D('qf1','QF1','C25',2,'breaker'),D('meter','Счётчик','',3,'meter'),D('qf2','QF2','C16',1,'breaker'),D('qf3','QF3','C10',1,'breaker'),D('xs1','XS1','розетка',1,'socket')],
      wires: [['qf1_b2','m1','L'],['qf1_b4','m3','N'],['m2','qf2_t1','L'],['m4','nbus','N'],['qf2_b2','x1','L'],['qf3_b2','xs1_t1','L'],['pebus','xs1_b2','PE']] },
  ];
  const orders = [
    ['Квартира · прихожая','Освещение и розетка',0],['Квартира · ванная','Линия с защитой',0],
    ['Квартира · балкон','Ремонт линии питания',0],['Квартира · спальня','Проверка отходящих линий',3],
    ['Квартира · гостиная','Счётчик и две группы',3],['Квартира · финальная ревизия','Контроль щита',0],
    ['Дом · котельная','Цепь управления насосом',1],['Дом · теплица','Трёхфазное питание',2],
    ['Дом · гараж','Восстановление контактора',1],['Дом · мастерская','Проверка двигателя',1],
    ['Дом · скважина','Счётчик и насос',3],['Дом · ввод','Три фазы и нагрузка',2],
    ['Бизнес · кофейня','Розетки и освещение',0],['Бизнес · пекарня','Линия оборудования',2],
    ['Бизнес · офис','Ремонт после отключения',0],['Бизнес · магазин','Проверка групп',3],
    ['Бизнес · склад','Управление воротами',1],['Бизнес · кухня','Трёхфазный щит',2],
    ['Инфраструктура · насосная','Контактор и защита',1],['Инфраструктура · зарядка','Три линии питания',2],
    ['Инфраструктура · серверная','Восстановление ввода',3],['Инфраструктура · освещение','Ревизия уличной линии',0],
    ['Инфраструктура · вентиляция','Пуск и остановка',1],['Инфраструктура · финал','Проверка трёх фаз',2],
  ];
  const chapters = ['Город','Частный дом','Бизнес','Инфраструктура'];
  orders.forEach(([name, subtitle, profile], i) => {
    const source = templates[profile];
    const mode = i % 6 === 2 ? 'repair' : i % 6 === 3 || i % 6 === 5 ? 'test' : 'build';
    const devices = source.devices.map(d => ({...d}));
    // Перестановка отходящих аппаратов меняет реальную геометрию щита.
    if (i % 2 && devices.length > 3) [devices[devices.length-1], devices[devices.length-2]] = [devices[devices.length-2], devices[devices.length-1]];
    const preinstalled = mode === 'repair' ? source.devices.slice(0, 2).map(d => d.id) : [];
    const tasks = devices.filter(d => !preinstalled.includes(d.id)).map(d => ({type:'install',device:d.id,text:'Установите ' + d.label}));
    const wires = source.wires.map((w,k) => {
      const [from,to,color]=w;
      const label = id => ({nbus:'N-шина',pebus:'PE-шина',m1:'счётчик (1)',m2:'счётчик (2)',m3:'счётчик (3)',m4:'счётчик (4)'})[id] || id.replace(/_t(\d)/,' ($1 верх)').replace(/_b(\d)/,' ($1 низ)').toUpperCase();
      return {type:'wire',from,to,color,text:(mode === 'repair' && k === 0 ? 'Затяните: ' : '') + label(from)+' → '+label(to)};
    });
    tasks.push(...wires);
    if (mode === 'test' || mode === 'repair') {
      const checks = mode === 'test' ? [wires[0], wires[wires.length-1]] : [wires[0]];
      checks.forEach(w => tasks.push({type:'test',from:w.from,to:w.to,text:'Прозвоните: '+w.text.replace('Затяните: ','')}));
    }
    tasks.forEach((t,k) => {t.id='t'+(k+1);});
    window.LEVELS.push({
      id:'l'+(i+7), name, subtitle, chapter:chapters[Math.floor(i/6)],
      mode, difficulty: 1 + (i % 3), devices,
      clamps:[{id:'x1',type:'L'},{id:'x2',type:'N'},{id:'x3',type:'L'},{id:'x4',type:'N'},{id:'x5',type:'L'},{id:'x6',type:'PE'}],
      buses:[{id:'nbus',type:'N',label:'N',x:400,w:190,nodeOffset:20},{id:'pebus',type:'PE',label:'PE',x:620,w:190,nodeOffset:95}],
      preinstalled,
      initialWires: mode === 'repair' ? [{...wires[0]}] : [],
      tasks,
    });
  });

  // Новые диагностические заказы: расположение скрытых обрывов выбирается
  // при каждом запуске, поэтому повторное прохождение не сводится к запоминанию.
  const diagnostics = [
    ['Диспетчер · квартира','Один скрытый обрыв',0,[0,1,2,4],1],
    ['Диспетчер · котельная','Сбой цепи управления',1,[0,2,3,4],1],
    ['Диспетчер · пекарня','Проверка трёх линий',2,[0,1,2,3,6],1],
    ['Диспетчер · ввод','Найти два повреждения',3,[0,1,2,4,6],2],
    ['Диспетчер · мастерская','Два обрыва в управлении',1,[0,2,3,4,5],2],
    ['Диспетчер · магазин','Проверка розеток и защиты',0,[0,1,2,4,6],2],
    ['Диспетчер · серверная','Ревизия счётчика',3,[0,1,2,3,5,6],2],
    ['Диспетчер · финал','Трёхфазная диагностика',2,[0,1,2,3,5,6],2],
  ];
  const nameNode = id => ({nbus:'N-шина',pebus:'PE-шина',m1:'счётчик (1)',m2:'счётчик (2)',m3:'счётчик (3)',m4:'счётчик (4)'})[id] || id.replace(/_t(\d)/,' ($1 верх)').replace(/_b(\d)/,' ($1 низ)').toUpperCase();
  diagnostics.forEach(([name,subtitle,profile,indices,faultCount],i) => {
    const source = templates[profile];
    const wires = indices.map(k => {
      const [from,to,color] = source.wires[k];
      return {from,to,color,label:nameNode(from)+' → '+nameNode(to)};
    });
    const tasks = [];
    wires.forEach(w => tasks.push({type:'diagnose',from:w.from,to:w.to,text:'Проверьте: '+w.label}));
    for (let slot=0; slot<faultCount; slot++) {
      tasks.push({type:'replace',slot,text:'Найдите и замените обрыв '+(slot+1)});
      tasks.push({type:'test',slot,text:'Проверьте новый провод '+(slot+1)});
    }
    wires.forEach(w => tasks.push({type:'wire',from:w.from,to:w.to,color:w.color,text:'Соединение: '+w.label}));
    tasks.forEach((task,k) => {task.id='t'+(k+1);});
    window.LEVELS.push({
      id:'l'+(31+i), name, subtitle, chapter:'Поиск обрыва', mode:'fault', difficulty: i<3 ? 2 : 3,
      devices:source.devices.map(d=>({...d})), preinstalled:source.devices.map(d=>d.id),
      clamps:[{id:'x1',type:'L'},{id:'x2',type:'N'},{id:'x3',type:'L'},{id:'x4',type:'N'},{id:'x5',type:'L'},{id:'x6',type:'PE'}],
      buses:[{id:'nbus',type:'N',label:'N',x:400,w:190,nodeOffset:20},{id:'pebus',type:'PE',label:'PE',x:620,w:190,nodeOffset:95}],
      initialWires:wires, faultCount, tasks
    });
  });
})();
