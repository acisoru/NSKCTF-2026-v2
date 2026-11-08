export const STEP = 1 / 30;
export const PARTY_LIMIT = 10;
export const MOVEMENT = { radius: .48, gravity: 22, jumpSpeed: 7.5, sprintMultiplier: 1.6, staminaMax: 100, sprintDrain: 24, staminaRecovery: 18, jumpCost: 12, climbSpeed: 3 };
export const INTEREST_RADIUS = 128;
export const WEAPONS = {
  admin: { name: 'Инспектор', speed: 220, range: 150, interval: .4, magazine: 1, reload: 0, pellets: 1, spread: 0, scale: 1, move: 1 },
  pistol: { name: 'Пистолет', speed: 55, range: 48, interval: .28, magazine: 12, reload: 1.35, pellets: 1, spread: .012, scale: .9, move: 1 },
  rifle: { name: 'Винтовка', speed: 64, range: 65, interval: .32, magazine: 24, reload: 1.8, pellets: 1, spread: .015, scale: 1, move: 1 },
  shotgun: { name: 'Дробовик', speed: 48, range: 27, interval: .95, magazine: 6, reload: 2.5, pellets: 8, spread: .12, scale: .38, move: .95 },
  sniper: { name: 'Снайперская винтовка', speed: 150, range: 110, interval: 1.4, magazine: 5, reload: 2.8, pellets: 1, spread: .001, scale: 3.8, move: .92 },
  machinegun: { name: 'Пулемёт', speed: 75, range: 62, interval: .1, magazine: 60, reload: 3.3, pellets: 1, spread: .035, scale: .5, move: .82 },
};
export const CAMERA = { pitch: 0, minPitch: -1.48, maxPitch: 1.48, eyeHeight: 1.73, fov: 76, minFov: 36, maxFov: 88, maxRoll: .4 };
export const GUNS = {
  player: { speed: 42, range: 46, interval: .38 },
  drone: { speed: 26, range: 27, burst: 3, gap: .18, windup: .45, reload: 1.6, damage: 14, damagePerLevel: 3 },
  sentry: { speed: 32, range: 31, burst: 4, gap: .14, windup: .5, reload: 1.9, damage: 18, damagePerLevel: 4 },
};
export function hitShape(actor) {
  if (!actor.kind || actor.kind === 'player') return { y: 1.04, box: [.46, 1.02, .46] };
  if (actor.kind === 'pylon') return { y: 1.6, box: [.65, 1.6, .65] };
  if (actor.kind === 'boss') return { y: actor.bossId === 'warden' ? 2.6 : 2, radius: actor.bossId === 'warden' ? 2.8 : 2.35 };
  return { y: (actor.altitude ?? 0) + 1.15, radius: actor.kind === 'bomber' ? 1.05 : actor.kind === 'sentry' ? .95 : .8 };
}
export const WORLD_SCALE = Math.sqrt(10);
export const WORLD = { x: 76 * WORLD_SCALE, z: 83 * WORLD_SCALE };
export const SPAWN = { x: 0, z: 53 * WORLD_SCALE + 5 };
export const ROLES = {
  assault: { name: 'Штурмовик', hp: 140, damage: 16, speed: 6, cooldown: 9, color: '#ed896c', ability: 'Импульс', icon: 'crosshair' },
  medic: { name: 'Медик', hp: 125, damage: 11, speed: 6.3, cooldown: 10, color: '#79ddb0', ability: 'Полевая аптечка', icon: 'heart-pulse' },
  guardian: { name: 'Защитник', hp: 195, damage: 12, speed: 5.6, cooldown: 12, color: '#ebc96d', ability: 'Бастион', icon: 'shield' },
};
export const SAFE_ZONES = [
  { id: 'city', name: 'Поселение «Периметр»', x: 0, z: 53 * WORLD_SCALE, radius: 25, merchant: { x: -6.25, z: 53 * WORLD_SCALE - 1.25 } },
  { id: 'camp', name: 'Торговый пост «Тихий»', x: -48 * WORLD_SCALE, z: 5 * WORLD_SCALE, radius: 16, merchant: { x: -48 * WORLD_SCALE - 1.3, z: 5 * WORLD_SCALE - 1.3 } },
  { id: 'east', name: 'Посёлок «Резерв»', x: 114, z: 85, radius: 18, merchant: { x: 111, z: 84 } },
];
const BASE_BUILDINGS = [
  { x: -12, z: 55, w: 6, d: 10, h: 5, kind: 'town' }, { x: 12, z: 55, w: 6, d: 10, h: 6, kind: 'town' },
  { x: -12, z: 41, w: 6, d: 7, h: 4, kind: 'town' }, { x: 12, z: 41, w: 6, d: 7, h: 5, kind: 'town' },
  { x: -8, z: 67, w: 8, d: 5, h: 3.5, kind: 'town' }, { x: 8, z: 67, w: 8, d: 5, h: 3.5, kind: 'town' },
  { x: -55, z: 6, w: 4, d: 9, h: 3.5, kind: 'camp' }, { x: -48, z: 13, w: 10, d: 4, h: 3, kind: 'camp' },
  { x: -20, z: 18, w: 7, d: 9, h: 6, kind: 'ruin' }, { x: 23, z: 15, w: 9, d: 6, h: 7, kind: 'ruin' },
  { x: -13, z: -8, w: 6, d: 10, h: 8, kind: 'ruin' }, { x: 17, z: -5, w: 6, d: 9, h: 6, kind: 'ruin' },
  { x: -53, z: -30, w: 7, d: 25, h: 9, kind: 'archive' }, { x: -35, z: -46, w: 27, d: 5, h: 9, kind: 'archive' },
  { x: 52, z: -26, w: 8, d: 25, h: 10, kind: 'reactor' }, { x: 35, z: -45, w: 26, d: 5, h: 7, kind: 'reactor' },
  { x: -23, z: -65, w: 5, d: 25, h: 13, kind: 'core' }, { x: 23, z: -65, w: 5, d: 25, h: 13, kind: 'core' },
  { x: 0, z: -79, w: 49, d: 4, h: 12, kind: 'core' },
];
export const BUILDINGS = BASE_BUILDINGS.map(b => {
  const anchor = { town: [0, 53], camp: [-48, 5], archive: [-35, -29], reactor: [35, -28], core: [0, -64] }[b.kind];
  return anchor ? { ...b, x: anchor[0] * WORLD_SCALE + (b.x - anchor[0]) * 1.3, z: anchor[1] * WORLD_SCALE + (b.z - anchor[1]) * 1.3, w: b.w * 1.15, d: b.d * 1.15, h: b.h * 1.2 } : { ...b, x: b.x * WORLD_SCALE, z: b.z * WORLD_SCALE };
});
BUILDINGS.push({ x: 102, z: 89, w: 7, d: 10, h: 5, kind: 'town' }, { x: 125, z: 88, w: 6, d: 12, h: 6, kind: 'town' }, { x: 113, z: 99, w: 12, d: 6, h: 4, kind: 'camp' });
for (let row = 0; row < 8; row++) for (let col = 0; col < 7; col++) {
  const x = (col - 3) * 55 + (row % 2) * 12, z = 125 - row * 43;
  if (Math.abs(x) < 20 || Math.abs(z - 16) < 16 || Math.abs(z + 92) < 17) continue;
  if (SAFE_ZONES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius + 20)) continue;
  if ([[-35, -29], [35, -28], [0, -64]].some(([bx, bz]) => Math.hypot(x - bx * WORLD_SCALE, z - bz * WORLD_SCALE) < 35)) continue;
  if (BUILDINGS.some(b => Math.hypot(x - b.x, z - b.z) < 18)) continue;
  BUILDINGS.push({ x, z, w: 8 + (col % 3) * 3, d: 9 + row % 4, h: 5 + (row + col) % 6, kind: 'ruin' });
}
export const WALLS = [...BUILDINGS, { x: -WORLD.x - 1, z: 0, w: 2, d: WORLD.z * 2 + 4 }, { x: WORLD.x + 1, z: 0, w: 2, d: WORLD.z * 2 + 4 }, { x: 0, z: -WORLD.z - 1, w: WORLD.x * 2 + 4, d: 2 }, { x: 0, z: WORLD.z + 1, w: WORLD.x * 2 + 4, d: 2 }];
export const LADDERS = BUILDINGS.map((b, i) => ({ id: `ladder-${i}`, x: b.x - b.w / 2 + .8, z: b.z + b.d / 2 + .8, top: b.h + .15, exitZ: b.z + b.d / 2 - .8 }));
export const BOSSES = [
  { id: 'archivist', name: 'Архивариус', region: 'Архив', x: -35, z: -29, hp: 2500, level: 3, xp: 260, gold: 120, color: '#efbf72', respawn: 180 },
  { id: 'resonator', name: 'Резонатор', region: 'Нестабильный контур', x: 35, z: -28, hp: 4200, level: 5, xp: 450, gold: 200, color: '#78cad9', respawn: 220 },
  { id: 'warden', name: 'Страж карантина', region: 'Ядро карантина', x: 0, z: -64, hp: 8200, level: 7, xp: 900, gold: 400, color: '#ee775d', respawn: 300 },
].map(b => ({ ...b, x: b.x * WORLD_SCALE, z: b.z * WORLD_SCALE }));
export const MOB_SPAWNS = [
  [-7, 28, 1], [7, 26, 1], [0, 15, 1], [-11, 8, 2], [11, 8, 2], [-28, 8, 2], [-32, -5, 2], [-25, -17, 3],
  [-42, -13, 3], [-43, -34, 3], [-29, -34, 3], [27, 3, 2], [35, -4, 3], [27, -17, 3], [43, -17, 4],
  [42, -35, 4], [26, -34, 4], [-7, -25, 3], [7, -32, 4], [-9, -46, 5], [9, -48, 5], [-9, -69, 5], [9, -69, 5],
].map(([x, z, level]) => [x * WORLD_SCALE, z * WORLD_SCALE, level]);
for (let i = 0; i < 22; i++) {
  const z = SPAWN.z - 38 - i * 15;
  for (const side of [-1, 1]) MOB_SPAWNS.push([side * (7 + (i % 3) * 3), z + side * 3, Math.min(6, 1 + Math.floor(i / 4))]);
}
for (let i = 0; i < 12; i++) {
  const x = -132 + i * 24, z = 16 + (i % 2 ? 7 : -7);
  if (!SAFE_ZONES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius + 6) && !BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2)) MOB_SPAWNS.push([x, z, 2 + i % 3]);
}
for (let i = MOB_SPAWNS.length - 1; i >= 0; i--) {
  const [x, z] = MOB_SPAWNS[i];
  if (SAFE_ZONES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius + 3) || BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1)) MOB_SPAWNS.splice(i, 1);
}
export const BOMBER = {
  sightRange: 16, sightAngle: Math.PI * 2 / 3, hoverHeight: 3.2,
  patrolRadius: 2, patrolSpeed: 1.3, windup: .9, diveSpeed: 23,
  blastRadius: 4.5, damage: 65, damagePerLevel: 7, respawn: 56,
};
export const BOMBER_SPAWNS = [
  [4, SPAWN.z - 46, 1, Math.PI],
  ...MOB_SPAWNS.filter((_, i) => i % 7 === 3).map(([x, z, level]) => [x + (x >= 0 ? 4 : -4), z + 4, level, x >= 0 ? -Math.PI / 2 : Math.PI / 2]),
].filter(([x, z]) =>
  !SAFE_ZONES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius + BOMBER.patrolRadius + 2)
  && !BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 + BOMBER.patrolRadius + 1 && Math.abs(z - b.z) < b.d / 2 + BOMBER.patrolRadius + 1)
  && !BOSSES.some(b => Math.hypot(x - b.x, z - b.z) < 35)
);
export const ITEMS = {
  issue: { name: 'Табельный пистолет', slot: 'weapon', weapon: 'pistol', rarity: 'common', damage: 3, price: 0 },
  suit: { name: 'Костюм ревизора', slot: 'armor', rarity: 'common', armor: 0.03, price: 0 },
  coil: { name: 'Катушка «Разряд»', slot: 'weapon', weapon: 'rifle', rarity: 'uncommon', damage: 10, price: 140 },
  carbine: { name: 'Карабин «Контур»', slot: 'weapon', weapon: 'rifle', rarity: 'rare', damage: 19, price: 360 },
  splitter: { name: 'Расщепитель Фейда', slot: 'weapon', weapon: 'rifle', rarity: 'epic', damage: 28, price: 800 },
  pistol: { name: 'Пистолет «Тихий»', slot: 'weapon', weapon: 'pistol', rarity: 'common', damage: 8, price: 80 },
  shotgun: { name: 'Дробовик «Периметр»', slot: 'weapon', weapon: 'shotgun', rarity: 'uncommon', damage: 9, price: 180 },
  sniper: { name: 'Винтовка «Наблюдатель»', slot: 'weapon', weapon: 'sniper', rarity: 'rare', damage: 21, price: 420 },
  machinegun: { name: 'Пулемёт «Заслон»', slot: 'weapon', weapon: 'machinegun', rarity: 'rare', damage: 13, price: 520 },
  vest: { name: 'Армированный жилет', slot: 'armor', rarity: 'uncommon', armor: .12, price: 120 },
  shell: { name: 'Оболочка изоляции', slot: 'armor', rarity: 'rare', armor: .22, price: 320 },
  aegis: { name: 'Протокол «Бастион»', slot: 'armor', rarity: 'epic', armor: .3, price: 700 },
  capacitor: { name: 'Стабилизатор', slot: 'relic', rarity: 'uncommon', hp: 30, price: 130 },
  memory: { name: 'Фрагмент памяти', slot: 'relic', rarity: 'rare', hp: 65, price: 300 },
  journal: { name: 'Незаписанный результат', slot: 'relic', rarity: 'epic', hp: 100, price: 650 },
};
export const RARITY = { common: '#b6c5bf', uncommon: '#79ddb0', rare: '#78cad9', epic: '#ebc96d' };
export const SHOP = ['potion', 'pistol', 'shotgun', 'sniper', 'machinegun', 'coil', 'vest', 'capacitor', 'carbine', 'shell', 'memory'];
export const CLUE = 'В таблице допуска четыре строки, но отображаются только три. Строка 000: «резервный, не выдан». История входов не пуста.';
export const xpFor = level => 65 + level * 45;
export const safeAt = (x, z) => SAFE_ZONES.find(s => Math.hypot(x - s.x, z - s.z) <= s.radius);
