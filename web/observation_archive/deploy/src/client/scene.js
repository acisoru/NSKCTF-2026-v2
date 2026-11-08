import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const canvas = document.querySelector('#scene-canvas');
const loading = document.querySelector('#scene-loading');
const fallback = document.querySelector('#scene-fallback');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const stationViews = {
  overview: { target: [0, 1.74, -.75], position: [0, 4.25, 10.6] },
  ledger: { target: [-4.12, 2.0, -1.56], position: [-4.45, 2.95, 3.75] },
  evidence: { target: [0, 2.1, -2.9], position: [0, 3.05, 2.0] },
  archive: { target: [4.12, 2.0, -1.56], position: [4.45, 2.95, 3.75] },
};

let currentStation = 'overview';
let sceneReady = false;
let renderer, scene, camera, cameraTarget, desiredCamera, desiredTarget;
let raycaster, pointer, rayTargets = [];
let screenCanvases = [];
let lastFrame = 0;
let scheduledFrame = null;
let spinOffset = 0;
let tiltOffset = 0;
let zoomOffset = 0;
let pointerDown = null;
let dragging = false;
let canvasHover = false;

// Palette is deliberately mixed: cool painted steel for the structure, warm
// neutrals for the paperwork and fittings, so the room does not collapse into a
// single sci-fi green hue. Emissive is reserved for parts that genuinely emit.
const C = {
  shell: 0x16211f,
  inner: 0x1d2a28,
  panel: 0x27332f,
  panelLight: 0x33413c,
  steel: 0x7b8783,
  darkSteel: 0x232d2b,
  alu: 0x9aa39d,
  rubber: 0x0d1210,
  concrete: 0x2b312e,
  warmPlastic: 0xc8c2b0,
  label: 0xd8d6c9,
  warning: 0xc7a63f,
  green: 0x74c495,
  amber: 0xcf9a52,
  red: 0xa65f54,
};

const M = {
  shell: new THREE.MeshStandardMaterial({ color: C.shell, metalness: .35, roughness: .62 }),
  inner: new THREE.MeshStandardMaterial({ color: C.inner, metalness: .3, roughness: .68 }),
  panel: new THREE.MeshStandardMaterial({ color: C.panel, metalness: .32, roughness: .6 }),
  panelLight: new THREE.MeshStandardMaterial({ color: C.panelLight, metalness: .34, roughness: .55 }),
  steel: new THREE.MeshStandardMaterial({ color: C.steel, metalness: .82, roughness: .38 }),
  alu: new THREE.MeshStandardMaterial({ color: C.alu, metalness: .74, roughness: .33 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: C.darkSteel, metalness: .62, roughness: .55 }),
  rubber: new THREE.MeshStandardMaterial({ color: C.rubber, metalness: .08, roughness: .86 }),
  concrete: new THREE.MeshStandardMaterial({ color: C.concrete, metalness: .05, roughness: .95 }),
  plastic: new THREE.MeshStandardMaterial({ color: C.warmPlastic, metalness: .04, roughness: .72 }),
  warning: new THREE.MeshStandardMaterial({ color: C.warning, metalness: .1, roughness: .6 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x15211f, metalness: .1, roughness: .22, transparent: true, opacity: .4, clearcoat: .5 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xf2f0e6, emissive: 0xf2efe2, emissiveIntensity: .9, roughness: .5 }),
  green: new THREE.MeshStandardMaterial({ color: C.green, emissive: C.green, emissiveIntensity: .8, roughness: .4 }),
  amber: new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: .7, roughness: .4 }),
  red: new THREE.MeshStandardMaterial({ color: C.red, emissive: C.red, emissiveIntensity: .6, roughness: .4 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xcac6b2, roughness: .96 }),
  manila: new THREE.MeshStandardMaterial({ color: 0xbda06a, roughness: .9 }),
  tape: new THREE.MeshStandardMaterial({ color: 0x8a7c5c, roughness: .84 }),
};

function box(parent, w, h, d, x, y, z, material, radius = 0) {
  const geometry = radius ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cyl(parent, rt, rb, height, x, y, z, material, segments = 32) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, height, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function ring(parent, radius, tube, x, y, z, material, segments = 72) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 7, segments), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function cable(parent, points, radius, material) {
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 24, radius, 7, false), material);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function labelTexture(text, options = {}) {
  const c = document.createElement('canvas');
  c.width = options.width || 512;
  c.height = options.height || 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (options.background) { ctx.fillStyle = options.background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.fillStyle = options.color || '#acd6b8';
  ctx.font = `${options.weight || 600} ${options.size || 36}px monospace`;
  ctx.textAlign = options.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, options.align === 'left' ? 17 : c.width / 2, c.height / 2, c.width - 28);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function labelPlane(parent, text, w, h, x, y, z, options = {}) {
  const texture = labelTexture(text, options);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function seeded(seed) {
  let n = seed >>> 0;
  return () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; };
}

function makeRoom() {
  const room = new THREE.Group();
  scene.add(room);
  box(room, 14.4, .24, 12.2, 0, -.17, -.1, M.concrete);
  box(room, 14.2, .035, 12, 0, -.029, -.1, M.darkSteel);

  const tileA = new THREE.MeshStandardMaterial({ color: 0x2c322f, metalness: .06, roughness: .9 });
  const tileB = new THREE.MeshStandardMaterial({ color: 0x262b29, metalness: .06, roughness: .92 });
  const tileEdge = new THREE.MeshStandardMaterial({ color: 0x3c433f, metalness: .12, roughness: .8 });
  const tileGeom = new THREE.BoxGeometry(.972, .022, .972);
  const tilesA = new THREE.InstancedMesh(tileGeom, tileA, 168);
  const tilesB = new THREE.InstancedMesh(tileGeom, tileB, 168);
  const matrix = new THREE.Matrix4();
  let countA = 0, countB = 0;
  for (let ix = -7; ix < 7; ix++) {
    for (let iz = -6; iz < 6; iz++) {
      const parity = (ix * 7 + iz * 3) % 7;
      matrix.makeTranslation(ix + .5, .01, iz + .5);
      if (parity === 0) tilesB.setMatrixAt(countB++, matrix);
      else tilesA.setMatrixAt(countA++, matrix);
      if ((ix + iz) % 7 === 0) {
        box(room, .75, .008, .015, ix + .5, .026, iz + .15, tileEdge);
        box(room, .75, .008, .015, ix + .5, .026, iz + .85, tileEdge);
      }
    }
  }
  tilesA.count = countA; tilesB.count = countB;
  tilesA.instanceMatrix.needsUpdate = true; tilesB.instanceMatrix.needsUpdate = true;
  room.add(tilesA, tilesB);
  for (let x of [-6.7, -3.2, .3, 3.8, 6.7]) {
    box(room, .065, .055, 11.8, x, .042, -.1, M.steel);
  }
  for (let z of [-5.7, -2.5, .8, 4.1]) {
    box(room, 13.9, .045, .06, 0, .042, z, M.steel);
  }

  // The rear wall is a modelled 2018 equipment wall rather than a backdrop.
  box(room, 14.25, 6.3, .36, 0, 3.08, -6.08, M.shell);
  box(room, 14.0, 4.8, .08, 0, 2.85, -5.87, M.inner);
  for (let i = 0; i < 8; i++) {
    const x = -6.35 + i * 1.82;
    box(room, .055, 5.6, .24, x, 3.12, -5.76, M.steel);
    box(room, 1.55, 1.02, .07, x + .91, 4.55, -5.79, M.panel);
    box(room, 1.55, 1.12, .07, x + .91, 2.36, -5.79, M.panel);
    if (i % 2 === 0) {
      for (let j = 0; j < 5; j++) box(room, 1.14, .025, .012, x + .91, 2.68 - j * .15, -5.73, M.darkSteel);
    }
  }
  for (let y of [.75, 3.48, 5.85]) box(room, 14.2, .08, .22, 0, y, -5.7, M.steel);
  box(room, 14.2, .3, .2, 0, 6.12, -5.75, M.shell);

  for (let side of [-1, 1]) {
    box(room, .27, 6.25, 12.1, side * 7.15, 3.05, -.1, M.shell);
    for (let j = 0; j < 6; j++) {
      box(room, .08, .05, 1.4, side * 6.96, 4.45, -4.7 + j * 1.82, M.panelLight);
      box(room, .08, .05, 1.4, side * 6.96, 2.1, -4.7 + j * 1.82, M.panelLight);
      box(room, .04, 2.24, .04, side * 6.92, 3.3, -4.7 + j * 1.82, M.steel);
    }
    for (let y of [1.15, 5.12]) cable(room, [[side * 6.91, y, -5.3], [side * 6.9, y + .08, -2.9], [side * 6.9, y + .1, .3], [side * 6.87, y, 3.7]], .055, M.darkSteel);
  }
  for (let x of [-6.3, -3.15, 0, 3.15, 6.3]) {
    box(room, .16, .3, 12.1, x, 6.3, -.1, M.steel);
  }
  box(room, 14.3, .2, 12.2, 0, 6.42, -.1, M.shell);

  // Painted safety walkway: two solid hazard lines bordering the operator aisle.
  for (let z of [2.2, 4.1]) {
    box(room, 11.6, .01, .09, 0, .037, z, M.warning);
  }

  // Service cages and wiring trays on the back wall.
  for (let x of [-5.6, 5.6]) {
    box(room, 1.3, 2.2, .28, x, 3.15, -5.48, M.darkSteel);
    box(room, 1.13, 1.84, .05, x, 3.15, -5.3, M.panel);
    for (let i = 0; i < 9; i++) box(room, .84, .026, .015, x, 2.4 + i * .18, -5.26, M.steel);
    cyl(room, .045, .045, .036, x + .46, 3.15, -5.24, M.amber, 12).rotation.x = Math.PI / 2;
  }

  // Rear-wall fittings: a facility clock and a hazard placard, both physical.
  const clock = new THREE.Group(); clock.position.set(-2.55, 5.1, -5.66); room.add(clock);
  cyl(clock, .34, .34, .07, 0, 0, 0, M.shell, 28).rotation.x = Math.PI / 2;
  cyl(clock, .29, .29, .02, 0, 0, .05, M.plastic, 28).rotation.x = Math.PI / 2;
  box(clock, .018, .17, .012, 0, .06, .07, M.darkSteel).rotation.z = .5;
  box(clock, .018, .12, .012, .06, .02, .07, M.darkSteel).rotation.z = -1.2;
  cyl(clock, .02, .02, .02, 0, 0, .07, M.darkSteel, 12).rotation.x = Math.PI / 2;

  const placard = new THREE.Group(); placard.position.set(2.7, 5.0, -5.64); room.add(placard);
  box(placard, .92, .66, .03, 0, 0, 0, M.warning, .02);
  box(placard, .82, .56, .02, 0, 0, .02, M.shell, .015);
  labelPlane(placard, 'ДОСТУП ЗАКРЫТ', .72, .14, 0, .14, .035, { color: '#d8d6c9', size: 40, weight: 700 });
  labelPlane(placard, 'АРХИВ', .72, .12, 0, -.02, .035, { color: '#c7a63f', size: 32, weight: 700 });
  labelPlane(placard, 'ТОЛЬКО ДЛЯ СОТРУДНИКОВ', .74, .08, 0, -.17, .035, { color: '#9aa39d', size: 20 });
  return room;
}

function makeAperture() {
  const g = new THREE.Group();
  g.position.set(0, 3.15, -5.48);
  scene.add(g);
  const frame = box(g, 4.4, 2.8, .3, 0, 0, 0, M.shell, .12);
  frame.castShadow = true;
  box(g, 4.05, 2.45, .03, 0, 0, .18, M.glass, .04);
  for (let side of [-1, 1]) {
    box(g, .08, 2.45, .21, side * 1.78, 0, .19, M.steel);
    box(g, .035, 2.45, .045, side * 1.62, 0, .22, M.green);
  }
  for (let y of [-.97, .97]) box(g, 4.03, .07, .18, 0, y, .19, M.steel);
  const eye = new THREE.Group(); eye.position.z = .28; g.add(eye);
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(.42 + i * .21, .008, 5, 70, Math.PI * 1.28), i % 2 ? M.green : M.steel);
    arc.position.z = i * .008;
    arc.rotation.z = i * .85;
    eye.add(arc);
  }
  cyl(eye, .12, .12, .03, 0, 0, .1, M.green, 24).rotation.x = Math.PI / 2;
  for (let x of [-1.5, 1.5]) {
    for (let y of [-.68, 0, .68]) box(g, .53, .025, .03, x, y, .31, M.steel);
  }
  labelPlane(g, 'ПОСТ НАБЛЮДЕНИЯ', 2.2, .3, 0, -1.6, .28, { color: '#b6dfbd', size: 29 });
}

function createScreenTexture(kind) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 432;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  screenCanvases.push({ kind, c, ctx, tex });
  drawScreen(screenCanvases[screenCanvases.length - 1], 0);
  return tex;
}

function drawScreen(data, t) {
  const { kind, c, ctx, tex } = data;
  const w = c.width, h = c.height;
  ctx.fillStyle = '#051412'; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * .53, h * .52, 20, w * .53, h * .52, w * .68);
  glow.addColorStop(0, 'rgba(31,93,63,.27)'); glow.addColorStop(1, 'rgba(1,14,16,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(112,218,150,.10)'; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (let y = 0; y < h; y += 4) { ctx.fillStyle = 'rgba(0,0,0,.17)'; ctx.fillRect(0, y, w, 2); }
  ctx.strokeStyle = 'rgba(144,225,166,.44)'; ctx.lineWidth = 2;
  ctx.strokeRect(20, 19, w - 40, h - 38);
  ctx.fillStyle = '#b6ecc2'; ctx.font = '600 20px monospace'; ctx.textAlign = 'left';
  const headings = { ledger: 'ЖУРНАЛ ИНЦИДЕНТОВ', evidence: 'КАЛИБРОВКА ОТТИСКА', archive: 'ЗАКРЫТЫЙ РАЗДЕЛ' };
  ctx.fillText(headings[kind], 39, 54);
  ctx.font = '14px monospace'; ctx.fillStyle = '#709982';
  ctx.fillText('ЛАБ X / АРХИВ НАБЛЮДЕНИЙ', 39, 81);
  ctx.fillText('13.10.2019  /  ALICE', w - 273, 54);
  ctx.fillStyle = kind === 'archive' ? '#d0a865' : '#9ee0ae';
  if (kind === 'ledger') {
    const rows = ['A-041  ПЕРИМЕТР ЦЕЛ', 'A-042  ПОЛЕ ОПЕРАТОРА / ?', 'A-043  ПОТОК ПРЕРВАН', 'A-044  ЗАПИСЬ СОХРАНЕНА'];
    rows.forEach((row, i) => {
      ctx.fillStyle = i === 1 ? '#d6b481' : '#9bd1a6';
      ctx.fillText(row, 43, 145 + i * 45);
      ctx.fillStyle = i === 1 ? '#d6b481' : '#688c76';
      ctx.fillRect(565, 132 + i * 45, i === 1 ? 116 : 78, 2);
    });
    ctx.fillStyle = '#547e67'; ctx.font = '13px monospace'; ctx.fillText('АНОМАЛИЙ: 847       ПОИСК: АКТИВЕН', 43, 376);
  } else if (kind === 'evidence') {
    ctx.fillStyle = '#a0d9ad'; ctx.font = '16px monospace';
    ctx.fillText('ПЕЧАТЬ ОТТИСКА / ОЖИДАНИЕ', 43, 145);
    ctx.fillText('ТАБЛИЦА СТИЛЕЙ / НЕ ЗАДАНА', 43, 185);
    ctx.fillStyle = '#6fa083'; ctx.fillText('ОЧЕРЕДЬ ПРОВЕРКИ', 43, 233);
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = `rgba(138,215,156,${.18 + i * .035})`;
      ctx.fillRect(43 + i * 85, 252, 56, 60 + Math.sin(t * 1.4 + i) * 16);
    }
    ctx.fillStyle = '#537d65'; ctx.font = '13px monospace'; ctx.fillText('ВНЕШНИЙ КАНАЛ ЗАКРЫТ', 43, 376);
  } else {
    ctx.strokeStyle = '#c49d5f'; ctx.lineWidth = 3;
    ctx.strokeRect(218, 128, 333, 175);
    ctx.fillStyle = '#cfaa6c'; ctx.font = '700 52px monospace'; ctx.textAlign = 'center';
    ctx.fillText('ЗАКРЫТО', w / 2, 223); ctx.textAlign = 'left';
    ctx.fillStyle = '#897a5c'; ctx.font = '13px monospace'; ctx.fillText('ТРЕБУЕТСЯ КЛЮЧ ДОСТУПА', 43, 376);
  }
  ctx.fillStyle = '#8ee3a2'; ctx.fillRect(w - 62, h - 46, 8, 8);
  tex.needsUpdate = true;
}

function makeTerminal(id, x, z, angle) {
  const group = new THREE.Group(); group.position.set(x, 0, z); group.rotation.y = angle; scene.add(group);
  const accent = id === 'archive' ? M.amber : M.green;
  // pedestal, service vents, cantilevered operator desk
  box(group, 1.25, .2, 1.24, 0, .12, 0, M.shell, .04);
  box(group, 1.02, 1.46, .93, 0, .93, -.21, M.inner, .07);
  box(group, 1.1, .085, 1.17, 0, 1.7, .06, M.steel, .025);
  box(group, 2.6, .17, 1.35, 0, 1.73, .46, M.panel, .06);
  box(group, 2.42, .035, 1.19, 0, 1.84, .47, M.darkSteel, .02);
  box(group, 2.54, .035, .04, 0, 1.79, 1.13, accent);
  for (let i = 0; i < 4; i++) {
    box(group, .31, .02, .05, -1.1 + i * .14, 1.34, .3, M.steel);
    box(group, .31, .02, .05, 1.1 - i * .14, 1.34, .3, M.steel);
  }
  for (let side of [-1, 1]) {
    box(group, .065, .19, 1.3, side * 1.25, 1.72, .46, M.steel);
    box(group, .16, .11, .33, side * 1.06, 1.91, .26, M.shell, .02);
    cyl(group, .034, .034, .028, side * 1.06, 1.978, .26, side === -1 ? M.amber : M.green, 12);
  }
  // Keyboard is a model, with individual keycaps and slim side buttons.
  box(group, 1.53, .065, .49, -.12, 1.885, .74, M.rubber, .025);
  const keyGeom = new THREE.BoxGeometry(.082, .018, .065);
  const keys = new THREE.InstancedMesh(keyGeom, M.steel, 52);
  let keyIndex = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 13; col++) {
      const transform = new THREE.Matrix4().makeTranslation(-.79 + col * .11, 1.929, .55 + row * .102);
      keys.setMatrixAt(keyIndex++, transform);
    }
  }
  keys.instanceMatrix.needsUpdate = true;
  group.add(keys);
  cyl(group, .095, .095, .04, .98, 1.9, .78, M.steel, 32);
  cyl(group, .064, .064, .053, .98, 1.93, .78, accent, 32);

  // Screen assembly: steel support, ceramic frame, glowing glass, physical bezel.
  box(group, .22, .8, .18, 0, 2.18, -.2, M.steel);
  const monitor = new THREE.Group(); monitor.position.set(0, 2.55, -.2); monitor.rotation.x = -.09; group.add(monitor);
  box(monitor, 2.34, 1.52, .2, 0, 0, 0, M.shell, .07);
  box(monitor, 2.18, 1.35, .08, 0, .01, .116, M.steel, .035);
  const texture = createScreenTexture(id);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.07, 1.19), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.position.set(0, .025, .164); monitor.add(screen);
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.51), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  hit.position.z = .185; hit.userData.station = id; monitor.add(hit); rayTargets.push(hit);
  box(monitor, 2.29, .08, .14, 0, .706, .16, M.steel);
  box(monitor, 2.29, .08, .14, 0, -.706, .16, M.steel);
  for (let side of [-1, 1]) box(monitor, .075, 1.37, .14, side * 1.105, 0, .16, M.steel);
  labelPlane(monitor, `АРХИВ / ${id === 'ledger' ? 'ЖУРНАЛ' : id === 'evidence' ? 'ОТТИСК' : 'ДОСТУП'}`, .96, .13, -.52, -.688, .245, { color: '#9ac9a4', size: 28 });
  for (let i = 0; i < 3; i++) {
    cyl(monitor, .012, .012, .025, .82 + i * .105, -.7, .25, i === 0 ? accent : M.steel, 8).rotation.x = Math.PI / 2;
  }
  // A physical paper stack grounds the CGI in the archive's material history.
  for (let i = 0; i < 5; i++) {
    const sheet = box(group, .38, .009, .3, .82 + i * .003, 1.91 + i * .009, .45 + i * .001, M.paper);
    sheet.rotation.y = -.08 + i * .04;
  }
  if (id === 'ledger') {
    box(group, .4, .26, .34, -1.03, 1.98, .47, M.tape, .015);
    labelPlane(group, 'A-042', .26, .095, -1.03, 2.02, .645, { color: '#453e33', size: 42 });
  }
  if (id === 'evidence') {
    const dial = cyl(group, .18, .2, .08, -1.04, 1.9, .44, M.steel, 32);
    dial.rotation.z = .02;
    ring(group, .12, .012, -1.04, 1.95, .44, M.green).rotation.x = Math.PI / 2;
  }
  if (id === 'archive') {
    box(group, .38, .24, .3, -1.03, 1.99, .48, M.shell, .018);
    box(group, .26, .025, .09, -1.03, 2.114, .48, M.amber);
  }
  cable(group, [[-.17, 1.75, -.54], [-.35, 1.45, -.69], [-.39, .45, -.65], [-.38, .09, -.45]], .047, M.rubber);
  return group;
}

function makeCentrepiece() {
  const g = new THREE.Group(); g.position.set(0, 0, 1.5); scene.add(g);
  // Stepped equipment plinth: painted steel base, machined deck, bolt ring.
  cyl(g, 1.84, 1.95, .16, 0, .1, 0, M.shell, 48);
  cyl(g, 1.66, 1.76, .11, 0, .22, 0, M.panel, 48);
  cyl(g, 1.37, 1.47, .08, 0, .31, 0, M.darkSteel, 48);
  const deckRing = ring(g, 1.51, .02, 0, .3, 0, M.steel); deckRing.rotation.x = Math.PI / 2;
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    cyl(g, .028, .028, .03, Math.cos(a) * 1.5, .34, Math.sin(a) * 1.5, M.steel, 10);
  }
  // Rotary record drum: a physical card file that holds the archive's index.
  const drum = new THREE.Group(); drum.position.y = .35; g.add(drum);
  cyl(drum, .14, .16, .5, 0, .3, 0, M.steel, 24);           // central spindle
  cyl(drum, .92, .92, .05, 0, .09, 0, M.darkSteel, 40);     // lower hub plate
  cyl(drum, .92, .92, .05, 0, .54, 0, M.darkSteel, 40);     // upper hub plate
  const cardMat = M.paper, tabMat = M.manila;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const card = new THREE.Group();
    card.position.set(Math.cos(a) * .78, .315, Math.sin(a) * .78);
    card.rotation.y = -a + Math.PI / 2;
    box(card, .012, .34, .22, 0, 0, 0, cardMat);
    if (i % 5 === 0) box(card, .014, .05, .09, 0, .18, .05, tabMat);
    drum.add(card);
  }
  cyl(drum, .2, .2, .06, 0, .6, 0, M.alu, 24);              // top cap
  cyl(drum, .05, .05, .09, 0, .67, 0, M.rubber, 12);        // knob
  // Low glass hood on three posts, dust cover for the drum (powered down).
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3) + .5;
    cyl(g, .025, .025, .95, Math.cos(a) * 1.02, .82, Math.sin(a) * 1.02, M.steel, 10);
  }
  cyl(g, 1.04, 1.04, .9, 0, .82, 0, M.glass, 40);
  cyl(g, 1.08, 1.08, .05, 0, 1.3, 0, M.steel, 40);
  // Two status LEDs on the plinth edge: one live (green), one standby (amber).
  cyl(g, .03, .03, .02, .7, .36, 1.3, M.green, 10).rotation.x = Math.PI / 2;
  cyl(g, .03, .03, .02, -.7, .36, 1.3, M.amber, 10).rotation.x = Math.PI / 2;
  labelPlane(g, 'КАРТОТЕКА / А', .9, .1, 0, .14, 1.45, { color: '#9aa39d', size: 26 });
  // Archive file case and scattered removable media, readable in the scene.
  const caseG = new THREE.Group(); caseG.position.set(-2.65, 0, 2.9); caseG.rotation.y = -.37; scene.add(caseG);
  box(caseG, 1.5, .22, .8, 0, .13, 0, M.shell, .04);
  box(caseG, 1.42, .035, .69, 0, .255, 0, M.steel);
  for (let i = 0; i < 6; i++) {
    box(caseG, .21, .28, .61, -.6 + i * .235, .41, -.01, i % 2 ? M.tape : M.paper, .01);
    labelPlane(caseG, `0${i+1}`, .16, .1, -.6 + i * .235, .435, .31, { color: '#3e4d41', size: 43 });
  }
  const reelG = new THREE.Group(); reelG.position.set(2.57, .14, 2.8); reelG.rotation.y = .25; scene.add(reelG);
  box(reelG, 1.3, .2, .9, 0, 0, 0, M.shell, .05);
  for (let x of [-.37, .37]) {
    cyl(reelG, .26, .26, .03, x, .15, -.02, M.steel, 30);
    ring(reelG, .17, .025, x, .17, -.02, M.darkSteel).rotation.x = Math.PI / 2;
    cyl(reelG, .042, .042, .04, x, .19, -.02, M.rubber, 16);
  }
}

function makeOverhead() {
  const g = new THREE.Group(); g.position.set(0, 5.36, -.56); scene.add(g);
  const outer = ring(g, 3.3, .12, 0, 0, 0, M.shell, 90); outer.rotation.x = Math.PI / 2;
  const inner = ring(g, 2.82, .08, 0, -.03, 0, M.steel, 90); inner.rotation.x = Math.PI / 2;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = Math.cos(a) * 3.02, z = Math.sin(a) * 3.02;
    const seg = box(g, .77, .07, .17, x, -.13, z, M.lamp, .028);
    seg.rotation.y = -a;
    if (i % 4 === 0) cable(g, [[x, .04, z], [x * 1.1, .75, z * 1.1], [x * 1.25, 1.1, z * 1.25]], .035, M.rubber);
  }
  cyl(g, .82, 1.01, .18, 0, .04, 0, M.shell, 32);
  cyl(g, .66, .72, .07, 0, -.1, 0, M.panelLight, 32);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const lamp = cyl(g, .044, .044, .055, Math.cos(a) * .48, -.16, Math.sin(a) * .48, M.lamp, 12);
    lamp.castShadow = false;
  }
}

function makeProps() {
  // One dead camera, deliberately unnumbered, reads as a quiet environmental clue.
  const cameraBody = new THREE.Group(); cameraBody.position.set(-5.4, 5.16, -4.7); cameraBody.rotation.y = .68; cameraBody.rotation.x = -.18; scene.add(cameraBody);
  box(cameraBody, .62, .28, .8, 0, 0, 0, M.steel, .045);
  box(cameraBody, .74, .09, .94, 0, .22, -.03, M.shell);
  cyl(cameraBody, .135, .135, .08, 0, -.025, .46, M.rubber, 32).rotation.x = Math.PI / 2;
  cyl(cameraBody, .085, .085, .07, 0, -.025, .51, M.glass, 32).rotation.x = Math.PI / 2;
  box(cameraBody, .1, .41, .12, 0, .37, -.21, M.steel);
  cable(scene, [[-5.4, 5.42, -4.9], [-5.6, 5.7, -5.3], [-5.9, 5.6, -5.9]], .018, M.rubber);

  // Signal column at the foreground edge.
  for (let x of [-5.95, 5.95]) {
    const pod = new THREE.Group(); pod.position.set(x, 0, 2.3); scene.add(pod);
    cyl(pod, .34, .4, .22, 0, .11, 0, M.shell, 16);
    cyl(pod, .24, .25, 3.5, 0, 1.95, 0, M.inner, 14);
    for (let i = 0; i < 7; i++) {
      box(pod, .44, .065, .12, 0, .55 + i * .42, .2, i === 6 ? M.amber : M.steel);
    }
    cyl(pod, .37, .32, .3, 0, 3.76, 0, M.shell, 16);
    box(pod, .42, .33, .04, 0, 2.88, .26, M.glass);
    box(pod, .28, .02, .015, 0, 2.88, .29, x < 0 ? M.red : M.green);
  }

  // Cable conduit running along the floor from the left wall to the plinth.
  const conduit = new THREE.Group(); scene.add(conduit);
  box(conduit, 2.9, .08, .22, -4.5, .08, 1.1, M.darkSteel, .02);
  for (let i = 0; i < 6; i++) box(conduit, .05, .1, .24, -5.7 + i * .5, .09, 1.1, M.steel);
  cable(scene, [[-3.1, .1, 1.1], [-2.2, .12, 1.3], [-1.3, .12, 1.4], [-.4, .3, 1.5]], .04, M.rubber);

  // An operator stool pushed back from the central desk.
  const stool = new THREE.Group(); stool.position.set(.7, 0, 1.0); stool.rotation.y = .4; scene.add(stool);
  cyl(stool, .22, .24, .07, 0, .55, 0, M.rubber, 20);
  cyl(stool, .05, .05, .5, 0, .3, 0, M.steel, 14);
  cyl(stool, .26, .26, .03, 0, .06, 0, M.darkSteel, 20);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    box(stool, .04, .04, .22, Math.cos(a) * .12, .05, Math.sin(a) * .12, M.steel).rotation.y = -a;
  }
}

function makeLights() {
  // Neutral fluorescent-lit lab: cool white fill from overhead, slightly warm
  // bounce from the floor, with a soft key and modest per-station fills so each
  // console reads clearly. No shadow maps (kept cheap for software rendering).
  scene.add(new THREE.AmbientLight(0xc5ccc8, .55));
  const hemi = new THREE.HemisphereLight(0xcfd6d2, 0x24201a, 1.1); scene.add(hemi);
  const key = new THREE.SpotLight(0xf0f3ee, 70, 24, Math.PI * .3, .6, 1.2);
  key.position.set(-1.2, 7.4, 4.8); key.target.position.set(0, 1.2, -1.2);
  scene.add(key, key.target);
  // Overhead ring fixture spills a cool pool onto the central plinth.
  const ringLamp = new THREE.PointLight(0xe6ece7, 26, 11, 1.8); ringLamp.position.set(0, 5.1, -.4); scene.add(ringLamp);
  // Back-wall equipment glow, low and green from the aperture area.
  const back = new THREE.PointLight(0x6fb98c, 14, 9, 1.6); back.position.set(0, 3.2, -4.9); scene.add(back);
  // Per-station task light; the restricted console reads warm amber.
  for (let x of [-4.12, 0, 4.12]) {
    const lamp = new THREE.PointLight(x > 3 ? 0xd7b277 : 0xd7e4dd, 10, 5.2, 1.6);
    lamp.position.set(x, 3.3, x === 0 ? -1.9 : -.6); scene.add(lamp);
  }
}

function applyStation(name, { focusNav = false } = {}) {
  if (!stationViews[name]) return;
  currentStation = name;
  spinOffset = tiltOffset = zoomOffset = 0;
  document.querySelectorAll('[data-station]').forEach(button => {
    const active = button.dataset.station === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-panel]').forEach(panel => {
    const active = panel.dataset.panel === name;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  const view = stationViews[name];
  if (sceneReady) {
    desiredCamera.set(...view.position);
    desiredTarget.set(...view.target);
    if (reducedMotion.matches) { camera.position.copy(desiredCamera); cameraTarget.copy(desiredTarget); camera.lookAt(cameraTarget); renderer.render(scene, camera); }
    else requestSceneFrame();
  }
  const prompt = document.querySelector('#scene-prompt');
  if (prompt) prompt.hidden = name !== 'overview';
  document.dispatchEvent(new CustomEvent('archive:station', { detail: { station: name } }));
  if (focusNav) document.querySelector(`[data-station="${name}"].station-link`)?.focus();
}

function setupUI() {
  document.querySelectorAll('[data-station]').forEach(button => button.addEventListener('click', () => applyStation(button.dataset.station)));
  document.querySelector('#panel-close')?.addEventListener('click', () => applyStation('overview', { focusNav: true }));
  const help = document.querySelector('#help-dialog');
  document.querySelector('#help-button')?.addEventListener('click', () => help?.showModal());
  document.querySelector('#help-close')?.addEventListener('click', () => help?.close());
  help?.addEventListener('click', event => { if (event.target === help) help.close(); });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input, textarea') || target.isContentEditable)) return;
    if (help?.open) return;
    if (event.key === 'Escape' && !help?.open) applyStation('overview', { focusNav: true });
    if (event.key === '1') applyStation('ledger', { focusNav: true });
    if (event.key === '2') applyStation('evidence', { focusNav: true });
    if (event.key === '3') applyStation('archive', { focusNav: true });
  });
  const clock = document.querySelector('#system-time');
  const tick = () => { if (clock) clock.textContent = new Date().toLocaleTimeString('ru-RU', { hour12: false, timeZone: 'UTC' }); };
  tick(); setInterval(tick, 1000);
  window.observationArchive = { selectStation: applyStation, getStation: () => currentStation };
}

function setupInteraction() {
  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
  canvas.addEventListener('pointerdown', event => {
    pointerDown = { x: event.clientX, y: event.clientY, spin: spinOffset, tilt: tiltOffset };
    dragging = false;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (pointerDown) {
      const dx = event.clientX - pointerDown.x, dy = event.clientY - pointerDown.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) dragging = true;
      if (dragging && !reducedMotion.matches) {
        spinOffset = THREE.MathUtils.clamp(pointerDown.spin + dx * .006, -.55, .55);
        tiltOffset = THREE.MathUtils.clamp(pointerDown.tilt + dy * .005, -.28, .28);
        requestSceneFrame();
      }
      return;
    }
    const hit = pick(event);
    canvasHover = Boolean(hit);
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  });
  canvas.addEventListener('pointerup', event => {
    if (!dragging) {
      const hit = pick(event);
      if (hit) applyStation(hit.userData.station);
    }
    pointerDown = null; dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { pointerDown = null; dragging = false; });
  canvas.addEventListener('wheel', event => {
    if (reducedMotion.matches) return;
    event.preventDefault();
    zoomOffset = THREE.MathUtils.clamp(zoomOffset + Math.sign(event.deltaY) * .45, -2, 3);
    requestSceneFrame();
  }, { passive: false });
  canvas.addEventListener('pointerleave', () => { canvasHover = false; canvas.style.cursor = 'grab'; });
}

function pick(event) {
  if (!sceneReady) return null;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(rayTargets, false)[0]?.object || null;
}

function requestSceneFrame() {
  if (sceneReady && scheduledFrame === null) scheduledFrame = requestAnimationFrame(render);
}

function render(time) {
  scheduledFrame = null;
  if (!sceneReady) return;
  const dt = Math.min(.05, Math.max(.001, (time - lastFrame) * .001)); lastFrame = time;
  const view = stationViews[currentStation];
  const baseTarget = new THREE.Vector3(...view.target);
  if (!reducedMotion.matches) {
    // The only motion is a smooth camera move toward the selected station,
    // adjusted by the user's drag (orbit) and wheel (zoom). Nothing idles.
    const relative = new THREE.Vector3(...view.position).sub(baseTarget);
    relative.applyAxisAngle(new THREE.Vector3(0, 1, 0), spinOffset);
    relative.y += tiltOffset * 3;
    relative.multiplyScalar(1 + zoomOffset * .1);
    desiredCamera.copy(baseTarget).add(relative);
    desiredTarget.copy(baseTarget);
    const k = 1 - Math.exp(-dt * 3.2);
    camera.position.lerp(desiredCamera, k);
    cameraTarget.lerp(desiredTarget, k);
    camera.lookAt(cameraTarget);
  }
  renderer.render(scene, camera);
  if (camera.position.distanceToSquared(desiredCamera) > .0001 || cameraTarget.distanceToSquared(desiredTarget) > .0001) requestSceneFrame();
}

function resize() {
  if (!renderer) return;
  const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (sceneReady) renderer.render(scene, camera);
}

function failScene(message) {
  console.warn('3D-модель архива недоступна:', message);
  fallback.hidden = false;
  canvas.hidden = true;
  loading.classList.add('done');
  const prompt = document.querySelector('#scene-prompt'); if (prompt) prompt.hidden = true;
  document.querySelectorAll('.scene-controls,.scene-label,.scene-crosshair').forEach(el => el.hidden = true);
}

function initScene() {
  if (!canvas || !window.WebGLRenderingContext) { failScene('WebGL недоступен'); return; }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x0c110f, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = false;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c110f); scene.fog = new THREE.FogExp2(0x0d1311, .02);
    camera = new THREE.PerspectiveCamera(44, 1, .1, 80);
    camera.position.set(...stationViews[currentStation].position);
    cameraTarget = new THREE.Vector3(...stationViews[currentStation].target);
    desiredCamera = camera.position.clone(); desiredTarget = cameraTarget.clone();
    camera.lookAt(cameraTarget);
    makeRoom(); makeAperture(); makeCentrepiece(); makeOverhead();
    makeTerminal('ledger', -4.12, -1.56, .2);
    makeTerminal('evidence', 0, -2.94, 0);
    makeTerminal('archive', 4.12, -1.56, -.2);
    makeProps(); makeLights();
    resize(); setupInteraction();
    window.addEventListener('resize', resize, { passive: true });
    new ResizeObserver(resize).observe(document.querySelector('#scene-zone'));
    reducedMotion.addEventListener?.('change', () => { if (reducedMotion.matches) { camera.position.copy(desiredCamera); cameraTarget.copy(desiredTarget); camera.lookAt(cameraTarget); renderer.render(scene, camera); } });
    sceneReady = true;
    renderer.render(scene, camera);
  } catch (error) {
    failScene(error?.message || error);
  }
}

function boot() {
  setupUI();
  canvas?.addEventListener('webglcontextlost', event => { event.preventDefault(); failScene('Графический контекст потерян'); });
  // Show the usable terminals before software WebGL compiles the model.
  requestAnimationFrame(() => {
    loading.classList.add('done');
    setTimeout(initScene, 450);
  });
}

boot();
