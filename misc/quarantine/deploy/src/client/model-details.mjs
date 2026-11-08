import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROLES, BOSSES } from '../shared/config.mjs';

const textures = new WeakMap();
export function surface(view, name, color, metalness = .2, roughness = .65, kind = 'paint') {
  const key = `detail/${name}`;
  if (view.materials[key]) return view.materials[key];
  let maps = textures.get(view); if (!maps) { maps = new Map(); textures.set(view, maps); }
  if (!maps.has(kind)) {
    const data = new Uint8Array(128 * 128 * 4); let seed = 2018;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = kind === 'fabric' ? ((x + y) % 4 < 2 ? 24 : -12) : kind === 'steel' ? Math.sin(y * 2.4) * 13 : 0;
      const value = Math.round(186 + grain + seed / 4294967296 * 31), i = (y * 128 + x) * 4; data.set([value, value, value, 255], i);
    }
    const texture = new T.DataTexture(data, 128, 128); texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true;
    texture.repeat.set(kind === 'fabric' ? 4 : 2, kind === 'fabric' ? 4 : 2); texture.anisotropy = Math.min(8, view.renderer?.capabilities.getMaxAnisotropy() ?? 1); texture.needsUpdate = true;
    maps.set(kind, texture);
  }
  return view.materials[key] = new T.MeshStandardMaterial({ color, metalness, roughness, roughnessMap: maps.get(kind), bumpMap: maps.get(kind), bumpScale: kind === 'fabric' ? .002 : .0009 });
}

// Bake rigid details per material, but retain the actual joints and independently animated meshes.
export function batchModel(root, preserve = []) {
  root.updateWorldMatrix(true, true); const inverse = root.matrixWorld.clone().invert(), kept = new Set(preserve.filter(Boolean)), buckets = new Map(), originals = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material)) return;
    for (let at = mesh; at && at !== root; at = at.parent) if (kept.has(at)) return;
    const key = `${mesh.material.uuid}/${mesh.castShadow}/${mesh.receiveShadow}`;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    if (!buckets.has(key)) buckets.set(key, { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, geometries: [] });
    buckets.get(key).geometries.push(geometry); originals.push(mesh);
  });
  for (const mesh of originals) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  for (const { material, cast, receive, geometries } of buckets.values()) {
    const geometry = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
    if (!geometry) throw new Error('Model geometry merge failed');
    geometry.computeBoundingSphere(); const mesh = new T.Mesh(geometry, material); mesh.castShadow = cast; mesh.receiveShadow = receive; root.add(mesh);
  }
  return root;
}

function kit(v) {
  const steel = surface(v, 'steel', '#929eaa', .78, .38, 'steel'), dark = surface(v, 'gunmetal', '#313840', .62, .53, 'steel');
  const rubber = surface(v, 'rubber', '#20262b', 0, .93, 'fabric'), ivory = surface(v, 'ceramic', '#c4c9c4', .32, .52), brass = surface(v, 'brass', '#b9a16c', .72, .38, 'steel');
  const box = (g, w, h, d, mat, x, y, z, r = .025) => v.rounded(g, w, h, d, mat, x, y, z, r);
  const pipe = (g, radius, length, mat, x, y, z, axis = 'z', count = 24) => { const m = v.cylinder(g, radius, radius, length, mat, x, y, z, count); if (axis === 'z') m.rotation.x = Math.PI / 2; if (axis === 'x') m.rotation.z = Math.PI / 2; return m; };
  const bolt = (g, x, y, z, radius = .021, axis = 'z') => { const m = pipe(g, radius, .014, steel, x, y, z, axis, 6); if (axis === 'z') box(g, radius * 1.1, .006, .004, rubber, x, y, z - .009, .001); return m; };
  const wire = (g, points, mat = rubber, radius = .018) => v.mesh(g, new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), 32, radius, 10, false), mat);
  return { steel, dark, rubber, ivory, brass, box, pipe, bolt, wire };
}

function stencil(v, parent, text, width, x, y, z, yaw = 0) {
  if (typeof document === 'undefined') return;
  const key = `stencil/${text}`;
  if (!v.materials[key]) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#becac9'; ctx.font = 'bold 46px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 52, 480);
    ctx.fillStyle = '#7e9194'; for (let i = 0; i < 18; i++) ctx.fillRect(72 + i * 20, 98, i % 3 ? 5 : 11, 10);
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.anisotropy = Math.min(8, v.renderer?.capabilities.getMaxAnisotropy() ?? 1);
    v.materials[key] = new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  }
  const decal = v.mesh(parent, new T.PlaneGeometry(width, width / 4), v.materials[key], x, y, z); decal.rotation.y = yaw; decal.castShadow = false;
}

export function weapon(view, type = 'pistol', { batch = true } = {}) {
  const v = view, g = new T.Group(), k = kit(v), { box, pipe, bolt, steel, dark, rubber, brass } = k;
  g.name = `weapon-${type}`;
  const pistol = type === 'pistol', long = type === 'sniper', admin = type === 'admin';
  const paint = surface(v, `weapon-${type}`, admin ? '#d0ba79' : type === 'shotgun' ? '#735b51' : long ? '#6b7c83' : '#67796d', .3, .59);
  const length = long ? 1.1 : pistol ? .25 : .6, muzzle = -.42 - length;
  box(g, .185, .18, pistol ? .32 : .52, dark, 0, .012, -.29, .03);
  box(g, .15, .075, pistol ? .37 : .54, steel, 0, .116, -.31, .018);
  const grip = new T.Group(); grip.position.set(0, -.125, -.19); grip.rotation.x = -.22; g.add(grip);
  box(grip, .122, .25, .145, rubber, 0, 0, 0, .023);
  for (const side of [-1, 1]) {
    box(grip, .012, .18, .102, paint, side * .062, -.003, .001, .006);
    for (let i = 0; i < 6; i++) box(grip, .014, .009, .10, rubber, side * .070, -.07 + i * .025, .003, .003);
    box(g, .010, .065, .12, rubber, side * .094, .057, -.30, .005);
    bolt(g, side * .097, -.017, -.16, .014, 'x');
  }
  box(grip, .14, .023, .155, steel, 0, -.133, 0, .009);
  box(g, .12, .025, .18, dark, 0, -.167, -.355, .01);
  box(g, .115, .15, .026, dark, 0, -.102, -.436, .008);
  box(g, .017, .071, .025, steel, 0, -.095, -.325, .007);
  for (const x of type === 'shotgun' ? [-.061, .061] : [0]) {
    pipe(g, .039, length, steel, x, .026, -.42 - length / 2, 'z', 32);
    pipe(g, .052, .072, dark, x, .026, muzzle + .035, 'z', 32);
    pipe(g, .027, .004, rubber, x, .026, muzzle - .002, 'z', 24);
    const lip = v.mesh(g, new T.TorusGeometry(.037, .009, 8, 32), steel, x, .026, muzzle - .004); lip.castShadow = false;
  }
  if (pistol) {
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) box(g, .009, .053, .008, dark, side * .077, .127, -.255 + i * .016, .002);
    box(g, .065, .035, .035, dark, 0, .171, -.16, .005); box(g, .014, .037, .023, dark, 0, .172, -.466, .004);
    box(g, .006, .008, .006, v.glow('#c6dec0'), 0, .189, -.46, .001);
    box(g, .045, .055, .08, brass, .098, .045, -.39, .008);
  } else {
    box(g, .15, .15, .33, paint, 0, .0, -.62, .028);
    box(g, .152, .085, .41, dark, 0, .111, -.61, .014);
    for (let i = 0; i < 6; i++) {
      box(g, .171, .015, .012, steel, 0, .16, -.46 - i * .052, .004);
      for (const side of [-1, 1]) box(g, .007, .044, .03, rubber, side * .078, .015, -.49 - i * .05, .008);
    }
    const stock = new T.Group(); stock.position.set(0, -.005, .01); g.add(stock);
    pipe(stock, .041, .22, dark, 0, 0, .02);
    box(stock, .133, .17, .23, paint, 0, -.005, .15, .025); box(stock, .142, .21, .031, rubber, 0, -.015, .28, .014);
    for (const side of [-1, 1]) bolt(g, side * .094, .044, -.16, .016, 'x');
    box(g, .025, .02, .11, steel, .112, .05, -.24, .006);
    if (type !== 'machinegun' && type !== 'shotgun') {
      const magazine = new T.Group(); magazine.name = 'magazine'; magazine.position.set(0, -.16, -.40); magazine.rotation.x = .12; g.add(magazine);
      box(magazine, .102, .235, .12, dark, 0, 0, 0, .015);
      for (let i = 0; i < 3; i++) box(magazine, .108, .012, .123, steel, 0, .05 - i * .055, 0, .004);
    }
  }
  if (long) {
    for (const z of [-.53, -.21]) box(g, .094, .084, .047, dark, 0, .19, z, .01);
    pipe(g, .064, .43, dark, 0, .252, -.37, 'z', 64);
    for (const z of [-.60, -.145]) {
      pipe(g, .092, .07, steel, 0, .252, z, 'z', 64); pipe(g, .073, .006, surface(v, 'optic', '#326f86', .45, .12), 0, .252, z + (z < -.4 ? -.038 : .038), 'z', 64);
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, tooth = box(g, .010, .020, .034, dark, Math.sin(a) * .091, .252 + Math.cos(a) * .091, z, .003); tooth.rotation.z = -a; }
    }
    v.mesh(g, new T.TorusGeometry(.058, .003, 8, 48, Math.PI * .6), v.mat('#85b2c0', .25, .24), 0, .252, -.102);
    pipe(g, .04, .075, dark, 0, .322, -.33, 'y'); pipe(g, .035, .075, dark, .076, .251, -.33, 'x');
    pipe(g, .025, .12, steel, .14, .033, -.12, 'x'); v.mesh(g, new T.SphereGeometry(.038, 16, 12), rubber, .205, .033, -.12);
    for (const side of [-1, 1]) { const leg = box(g, .025, .22, .025, dark, side * .067, -.13, -.80, .006); leg.rotation.z = side * .28; }
  } else if (type === 'shotgun') {
    box(g, .19, .115, .26, paint, 0, -.065, -.64, .035);
    for (let i = 0; i < 6; i++) box(g, .20, .014, .013, rubber, 0, -.095, -.54 - i * .039, .004);
    box(g, .046, .145, .29, dark, -.109, -.003, -.296, .013);
    for (let i = 0; i < 4; i++) {
      const z = -.20 - i * .064;
      pipe(g, .026, .10, surface(v, 'shell', '#985c49', .15, .73), -.147, .005, z, 'y', 20); pipe(g, .026, .022, brass, -.147, -.052, z, 'y', 20);
      for (const y of [-.023, .029]) { const clip = v.mesh(g, new T.TorusGeometry(.028, .008, 8, 24), rubber, -.147, y, z); clip.rotation.x = Math.PI / 2; }
    }
  } else if (type === 'machinegun') {
    box(g, .30, .29, .25, paint, 0, -.205, -.385, .036);
    for (const x of [-.09, .09]) box(g, .024, .26, .26, dark, x, -.20, -.385, .008);
    box(g, .11, .055, .13, dark, -.112, -.008, -.30, .014);
    const belt = new T.Group(); belt.name = 'linked-ammunition'; belt.position.set(-.12, -.020, -.30); belt.rotation.z = Math.atan(.012 / .032); g.add(belt);
    box(belt, .10, .019, .016, dark, -.034, 0, .034, .004);
    for (let i = 0; i < 3; i++) { pipe(belt, .014, .098, brass, -i * .0342, 0, 0, 'z', 16); box(belt, .032, .029, .024, dark, -i * .0342, 0, .014, .004); }
    box(g, .074, .05, .045, dark, -.171, -.05, -.285, .009);
    box(g, .055, .031, .20, dark, 0, .27, -.34, .008); for (const z of [-.43, -.25]) box(g, .04, .13, .035, steel, 0, .21, z, .008);
    for (const side of [-1, 1]) { const leg = box(g, .027, .25, .03, dark, side * .08, -.14, -.79, .006); leg.rotation.z = side * .4; }
  } else if (admin) {
    for (let i = 0; i < 4; i++) { pipe(g, .102, .035, v.glow('#78dcea'), 0, .026, -.5 - i * .12, 'z', 32); pipe(g, .111, .012, dark, 0, .026, -.515 - i * .12, 'z', 32); }
    box(g, .205, .1, .28, paint, 0, .16, -.26, .02); k.wire(g, [[.1, .16, -.22], [.17, .07, -.42], [.10, .03, -.68]], brass, .012);
  }
  stencil(v, g, `LAB X / ${{ pistol: 'P-12', rifle: 'AR-24', shotgun: 'SG-06', sniper: 'SR-05', machinegun: 'MG-60', admin: 'INSP' }[type]}`, .235, -.101, .047, -.28, -Math.PI / 2);
  return batch ? batchModel(g) : g;
}

export function armorDetails(v, g, role) {
  const { box, pipe, bolt, wire, steel, dark, rubber, ivory } = kit(v), accent = surface(v, `role-${role}`, ROLES[role].color, .3, .62);
  const fabric = surface(v, 'fabric', '#303e40', .02, .96, 'fabric');
  for (const side of [-1, 1]) {
    box(g, .057, .43, .025, rubber, side * .22, 1.24, -.307, .008);
    for (let i = 0; i < 3; i++) box(g, .48, .023, .018, dark, 0, 1.03 + i * .08, -.312, .005);
    box(g, .11, .16, .11, fabric, side * .28, .83, -.22, .024);
    box(g, .055, .044, .012, steel, side * .22, 1.40, -.328, .004);
    bolt(g, side * .24, 1.38, -.31, .022);
    const shoulder = box(g, .23, .115, .27, ivory, side * .41, 1.40, -.03, .035); shoulder.rotation.z = side * .2;
    box(g, .20, .025, .29, accent, side * .42, 1.45, -.03, .008);
    pipe(g, .074, .075, dark, side * .323, 1.71, .03, 'x');
    for (let i = 0; i < 3; i++) box(g, .012, .009, .07, steel, side * .361, 1.685 + i * .023, .03, .002);
  }
  box(g, .26, .078, .115, dark, 0, 1.59, -.273, .023);
  stencil(v, g, 'LAB X', .23, 0, 1.435, -.312, Math.PI);
  for (const x of [-.1, .1]) { pipe(g, .043, .025, steel, x, 1.59, -.342); pipe(g, .031, .006, rubber, x, 1.59, -.359); }
  wire(g, [[-.12, 1.57, -.30], [-.32, 1.48, -.21], [-.37, 1.22, .22], [-.20, 1.06, .48]], rubber, .026);
  box(g, .26, .047, .27, ivory, 0, 2.013, .01, .018); box(g, .13, .015, .16, accent, 0, 2.044, .01, .007);
  for (let i = 0; i < 5; i++) box(g, .33, .018, .014, dark, 0, 1.20 - i * .055, .508, .004);
  pipe(g, .017, .43, dark, -.2, 1.66, .40, 'y', 12); v.mesh(g, new T.SphereGeometry(.026, 10, 8), rubber, -.2, 1.88, .40);
  for (const leg of g.userData.legs) {
    for (let i = 0; i < 3; i++) box(leg, .15, .016, .016, dark, 0, -.19 - i * .04, -.189, .004);
    for (const x of [-.11, .11]) pipe(leg, .036, .018, steel, x, -.25, .01, 'x', 16);
    for (let i = 0; i < 4; i++) box(leg, .255, .018, .027, dark, 0, -.66, -.23 + i * .092, .004);
  }
  if (role === 'medic') {
    box(g, .24, .24, .085, ivory, 0, 1.38, .515, .03); box(g, .045, .17, .012, accent, 0, 1.38, .565, .005); box(g, .17, .045, .012, accent, 0, 1.38, .565, .005);
    for (const x of [-.13, 0, .13]) pipe(g, .039, .18, ivory, x, .94, .47, 'y', 20);
  } else if (role === 'guardian') {
    for (const side of [-1, 1]) { const plate = box(g, .25, .31, .14, accent, side * .40, 1.26, .02, .06); plate.rotation.z = side * .15; }
    box(g, .32, .22, .085, dark, 0, 1.29, -.351, .04); box(g, .055, .13, .012, accent, 0, 1.30, -.402, .008);
  } else {
    for (const x of [-.11, .11]) { box(g, .13, .23, .09, dark, x, 1.14, -.365, .018); for (let i = 0; i < 3; i++) box(g, .11, .017, .012, steel, x, 1.07 + i * .057, -.419, .004); }
  }
}

export function handDetails(v, rig, role, type) {
  const { box, wire, steel, rubber } = kit(v), cloth = surface(v, 'sleeves', '#384647', .02, .97, 'fabric');
  for (const side of [-1, 1]) {
    const x = side < 0 ? -.12 : .025, z = side < 0 ? type === 'pistol' ? -.27 : -.64 : -.18;
    box(rig, .17, .033, .09, rubber, x, -.25, z + .04, .013);
    for (let i = 0; i < 3; i++) box(rig, .032, .027, .038, steel, x - .045 + i * .044, -.065, z - .045, .009);
    wire(rig, [[x - .065, -.22, z + .06], [x, -.19, z + .083], [x + .065, -.22, z + .06]], cloth, .005);
  }
  box(rig, .11, .032, .10, steel, -.23, -.32, -.25, .012);
  box(rig, .079, .006, .069, v.glow(ROLES[role].color), -.23, -.300, -.25, .005);
}

export function enemyDetails(v, g, data) {
  const { box, pipe, bolt, wire, steel, dark, rubber, ivory, brass } = kit(v);
  const boss = data.kind === 'boss', color = boss ? BOSSES.find(b => b.id === data.bossId).color : data.kind === 'bomber' ? '#dc7c51' : '#83b9bd';
  const painted = surface(v, `enemy-${data.bossId ?? data.kind}`, boss ? '#798587' : '#657779', .5, .58), accent = surface(v, `enemy-accent-${data.bossId ?? data.kind}`, color, .25, .6);
  if (boss) {
    const core = new T.Group(); core.position.set(0, 2.1, -1.59); g.add(core); g.userData.coreRotor = core;
    v.mesh(core, new T.TorusGeometry(.50, .043, 12, 64), steel);
    pipe(core, .25, .032, dark, 0, 0, -.02, 'z', 40);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, blade = box(core, .075, .20, .037, dark, Math.sin(angle) * .37, Math.cos(angle) * .37, -.012, .018); blade.rotation.z = -angle - .3;
      bolt(core, Math.sin(angle) * .205, Math.cos(angle) * .205, -.043, .027);
    }
    box(core, .22, .047, .009, accent, 0, 0, -.043, .009);
    batchModel(core);
    for (const side of [-1, 1]) {
      const shoulder = box(g, .79, .16, .94, painted, side * 1.50, 2.93, 0, .075); shoulder.rotation.z = side * -.13;
      for (let i = 0; i < 4; i++) box(g, .54, .05, .045, dark, side * 1.51, 2.96, -.30 + i * .2, .013);
      for (const z of [-.43, .43]) bolt(g, side * 1.82, 2.72, z, .061);
      wire(g, [[side * .83, 2.84, .68], [side * 1.51, 2.77, .73], [side * 2.06, 1.65, .40]], rubber, .086);
      wire(g, [[side * 1.13, 1.38, .4], [side * 1.39, .8, .45], [side * .98, .46, .63]], steel, .048);
      for (let i = 0; i < 4; i++) box(g, .83, .068, .095, dark, side, .53, -.50 + i * .32, .013);
      box(g, .31, .63, .07, painted, side * .90, 2.12, -.818, .04);
      for (let i = 0; i < 3; i++) bolt(g, side * .93, 1.91 + i * .2, -.869, .045);
    }
    box(g, 1.25, .18, .13, dark, 0, 2.89, -.72, .03);
    for (let i = 0; i < 9; i++) box(g, .051, .115, .02, brass, (i - 4) * .115, 2.89, -.8, .009);
    if (data.bossId === 'archivist') {
      for (let i = 0; i < 5; i++) { const x = (i - 2) * .45; for (let j = 0; j < 6; j++) box(g, .24, .065, .024, dark, x, 2.0 + j * .22, 1.375, .008); box(g, .21, .13, .025, ivory, x, 3.03, 1.376, .009); }
      box(g, .88, .51, .18, dark, 0, 3.16, -.64, .04); for (const x of [-.20, .20]) pipe(g, .15, .04, brass, x, 3.17, -.75, 'z', 32);
    } else if (data.bossId === 'resonator') {
      for (const side of [-1, 1]) { pipe(g, .20, 1.3, dark, side * .76, 2.40, .87, 'y', 32); for (let i = 0; i < 7; i++) pipe(g, .245, .042, steel, side * .76, 1.87 + i * .16, .87, 'y', 32); }
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, fin = box(g, .18, .13, .36, accent, Math.cos(a) * 1.1, 2.1 + Math.sin(a) * 1.1, -.76, .028); fin.rotation.z = a; }
    } else {
      for (const side of [-1, 1]) { box(g, .73, .82, .18, painted, side * 1.5, 2.67, -.6, .065); for (let i = 0; i < 3; i++) { const stripe = box(g, .076, .46, .022, accent, side * 1.5 + (i - 1) * .18, 2.65, -.707, .009); stripe.rotation.z = -.4; } }
      box(g, 1.0, .25, .15, dark, 0, 3.12, -.63, .035); for (let i = 0; i < 5; i++) box(g, .10, .045, .02, accent, (i - 2) * .17, 3.12, -.719, .008);
    }
  } else if (data.kind === 'pylon') {
    for (const side of [-1, 1]) { box(g, .08, 1.70, .77, dark, side * .35, 1.3, 0, .025); wire(g, [[side * .4, .3, .1], [side * .48, 1.3, .19], [side * .22, 2.26, .1]], accent, .036); }
    for (const x of [-.24, .24]) for (const z of [-.24, .24]) pipe(g, .047, .07, steel, x, .45, z, 'y', 6);
  } else if (data.kind === 'bomber') {
    box(g, .57, .075, .47, painted, 0, 1.377, .05, .04);
    for (const side of [-1, 1]) {
      for (const z of [-.29, .29]) bolt(g, side * .30, 1.39, z, .025, 'y');
      wire(g, [[side * .30, 1.23, -.25], [side * .53, 1.25, -.33], [side * .77, 1.35, -.48]], accent, .021);
      box(g, .031, .30, .51, dark, side * .42, .97, 0, .012);
      for (const z of [-.48, .48]) { pipe(g, .13, .027, steel, side * .78, 1.43, z, 'y'); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; bolt(g, side * .78 + Math.sin(a) * .095, 1.452, z + Math.cos(a) * .095, .012, 'y'); } }
    }
    for (const x of [-.24, 0, .24]) for (const y of [.53, .76]) pipe(g, .087, .01, rubber, x, y, .37, 'z', 20);
    box(g, .16, .047, .21, dark, 0, 1.43, .05, .018); pipe(g, .012, .25, steel, .21, 1.51, .22, 'y', 12);
  } else {
    const size = data.kind === 'sentry' ? .72 : .52;
    const mask = surface(v, 'sensor-armor', '#99a7aa', .28, .62);
    box(g, .30, .085, .19, mask, 0, 1.45, -size + .025, .027);
    box(g, .24, .073, .18, dark, 0, .872, -size + .025, .025);
    for (const side of [-1, 1]) {
      const cheek = box(g, .15, .35, .22, mask, side * size * .53, 1.18, -size + .04, .048); cheek.rotation.z = side * -.14;
      for (const y of [1.06, 1.30]) bolt(g, side * size * .53, y, -size - .084, .023);
      box(g, .073, .033, .014, accent, side * size * .53, 1.18, -size - .082, .006);
      const plate = box(g, .19, .41, .57, painted, side * size * .84, 1.17, .025, .085); plate.rotation.z = side * -.16;
      for (let i = 0; i < 4; i++) box(g, .034, .035, .31, dark, side * .76 + (i - 1.5) * .06, 1.36, .06, .008);
      pipe(g, .258, .09, dark, side * .95, 1.17, .07, 'y', 32);
      wire(g, [[side * .35, 1.25, -.16], [side * .62, 1.13, -.17], [side * .93, 1.10, .06]], accent, .022);
      for (const z of [-.21, .19]) bolt(g, side * .65, 1.38, z, .025, 'y');
      const fan = new T.Group(); fan.position.set(side * .95, .827, .07); g.add(fan); (g.userData.fans ??= []).push(fan);
      for (let i = 0; i < 6; i++) { const blade = box(fan, .26, .014, .061, steel, 0, 0, 0, .006); blade.rotation.y = i * Math.PI / 3; }
      pipe(g, .043, .19, dark, side * .25, .89, -size - .12, 'z'); pipe(g, .025, .004, rubber, side * .25, .89, -size - .218, 'z');
    }
    box(g, .27, .11, .20, painted, 0, 1.1 + size, .03, .035);
    for (let i = 0; i < 4; i++) box(g, .15, .026, .019, dark, 0, 1.21 + i * .068, size * .86, .006);
    if (data.kind === 'sentry') for (const z of [-.51, -.67, -.83]) pipe(g, .102, .035, dark, .3, .95, z, 'z', 24);
  }
}

export function supplyCrate(v, parent, color) {
  const { box, bolt, dark, steel } = kit(v), shell = surface(v, 'crate', '#64817b', .35, .7);
  box(parent, .56, .36, .43, shell, 0, .22, 0, .045); box(parent, .58, .07, .45, dark, 0, .405, 0, .025);
  for (const x of [-.19, .19]) { box(parent, .055, .35, .445, dark, x, .23, 0, .013); box(parent, .065, .09, .023, steel, x, .33, -.24, .008); bolt(parent, x, .18, -.237, .015); }
  box(parent, .13, .06, .012, v.glow(color), 0, .31, -.231, .006);
}

export function lowEnemy(v, data) {
  const g = new T.Group(), metal = v.mat('#586969', .6), dark = v.mat('#283a39'); g.userData.low = true;
  if (data.kind === 'pylon') {
    v.box(g, .65, 2.1, .65, metal, 0, 1.3, 0); v.mesh(g, new T.OctahedronGeometry(.55), v.glow('#ebc96d'), 0, 2.7, 0);
  } else if (data.kind === 'bomber') {
    v.box(g, .85, .38, .8, metal, 0, 1.13, 0); v.box(g, .7, .43, .74, v.mat('#b75442'), 0, .66, 0);
    g.userData.rotors = [];
    for (const x of [-.78, .78]) for (const z of [-.48, .48]) {
      v.box(g, .75, .09, .10, dark, x / 2, 1.18, z); v.cylinder(g, .1, .13, .22, metal, x, 1.28, z, 10);
      const rotor = new T.Group(); rotor.position.set(x, 1.42, z); g.add(rotor); g.userData.rotors.push(rotor);
      v.box(rotor, .65, .024, .06, dark, 0, 0, 0); v.box(rotor, .06, .024, .65, dark, 0, 0, 0); batchModel(rotor);
    }
    g.userData.beacon = v.mesh(g, new T.SphereGeometry(.08, 10, 6), v.glow('#ff8048').clone(), .42, 1.1, -.35);
  } else {
    const size = data.kind === 'sentry' ? .72 : .52;
    v.mesh(g, new T.SphereGeometry(size, 12, 8), metal, 0, 1.1, 0);
    g.userData.eye = v.mesh(g, new T.SphereGeometry(.15, 10, 6), v.glow('#e88b68').clone(), 0, 1.16, -size);
    for (const x of [-.95, .95]) { v.box(g, .8, .14, .4, metal, x * .74, 1.2, 0); v.cylinder(g, .23, .16, .35, dark, x, 1.0, .07, 10); }
    if (data.kind === 'sentry') { const barrel = v.cylinder(g, .07, .1, .6, metal, .3, .95, -.75, 12); barrel.rotation.x = Math.PI / 2; }
  }
  return batchModel(g, [...(g.userData.rotors ?? []), g.userData.eye, g.userData.beacon]);
}
