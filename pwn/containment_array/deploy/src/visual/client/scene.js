import * as THREE from 'three';

const canvas = document.getElementById('scene-canvas');
const stage = document.querySelector('.visual-stage');
const fallback = document.getElementById('scene-fallback');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const materials = {
  floor: new THREE.MeshStandardMaterial({ color: 0x18242a, metalness: .32, roughness: .82 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x1c262b, metalness: .05, roughness: .95 }),
  panel: new THREE.MeshStandardMaterial({ color: 0x2b3a41, metalness: .55, roughness: .62 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x3a4a51, metalness: .88, roughness: .38 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x121d22, metalness: .5, roughness: .62 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0c1317, metalness: .1, roughness: .9 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x2a383e, metalness: .78, roughness: .48 }),
  copper: new THREE.MeshStandardMaterial({ color: 0x7a5236, metalness: .84, roughness: .42 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xf6a257, emissive: 0xc9611d, emissiveIntensity: .85, roughness: .4, metalness: .1 }),
  mint: new THREE.MeshStandardMaterial({ color: 0x8fc8b6, emissive: 0x3f8873, emissiveIntensity: .7, roughness: .4, metalness: .1 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x7d9a94, transparent: true, opacity: .11, metalness: .15, roughness: .14, side: THREE.DoubleSide, depthWrite: false }),
  core: new THREE.MeshStandardMaterial({ color: 0xffbd70, emissive: 0xe9641f, emissiveIntensity: 1.15, metalness: .14, roughness: .24, flatShading: true }),
  wire: new THREE.MeshBasicMaterial({ color: 0xe8a765, wireframe: true, transparent: true, opacity: .4, depthWrite: false }),
};

let scene, camera, renderer, core, coreCage, particles;
let sensorObjects = [], clickable = [], selectedSensor = -1;
let yaw = .48, pitch = .18, distance = 11.7;
const MAX_ORBIT_DISTANCE = 14;
let dragging = false, moved = false, pointerX = 0, pointerY = 0;
let activeUntil = 0, frameQueued = false, previousFrame = 0;
const center = new THREE.Vector3(0, 1.75, 0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function box(parent, size, position, material, cast = false) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  object.position.set(...position);
  object.castShadow = cast;
  parent.add(object);
  return object;
}

function cylinder(parent, top, bottom, height, position, material, segments = 32) {
  const object = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material);
  object.position.set(...position);
  parent.add(object);
  return object;
}

function ring(parent, radius, tube, y, material, segments = 72) {
  const object = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 7, segments), material);
  object.rotation.x = Math.PI / 2;
  object.position.y = y;
  parent.add(object);
  return object;
}

function cable(parent, points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const object = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 6, false), material);
  parent.add(object);
  return object;
}

function label(text, color = '#f6bf80') {
  const canvas2d = document.createElement('canvas');
  canvas2d.width = 256;
  canvas2d.height = 64;
  const ctx = canvas2d.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = '600 32px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(.55, .14), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
}

function buildRoom() {
  scene.background = new THREE.Color(0x0a151a);
  scene.fog = new THREE.FogExp2(0x0a151a, .03);
  box(scene, [30, .24, 30], [0, -.18, 3], materials.concrete);
  // Wide side walls and a taller rear wall surround the permitted camera arc.
  // The rear wall remains close enough to frame the original installation.
  box(scene, [29, 12, .18], [0, 5.8, -7], materials.panel);
  box(scene, [.18, 12, 22], [-14, 5.8, 4], materials.panel);
  box(scene, [.18, 12, 22], [14, 5.8, 4], materials.panel);
  box(scene, [29, 1.1, .1], [0, .55, -6.9], materials.dark);
  const grid = new THREE.GridHelper(29, 29, 0x2e3b40, 0x1d2b30);
  grid.position.y = -.045;
  scene.add(grid);
  // structural I-beam columns and horizontal stringers on the back wall
  for (let i = -6; i <= 6; i++) {
    box(scene, [.14, 11.8, .18], [i * 2.2, 5.8, -6.82], materials.metal);
    box(scene, [.05, 11.8, .3], [i * 2.2, 5.8, -6.82], materials.dark);
  }
  for (let y = .9; y < 11.5; y += 1.7) box(scene, [29, .1, .14], [0, y, -6.8], materials.armor);
  // overhead cable tray runs along the side walls
  for (const side of [-1, 1]) {
    box(scene, [.26, .12, 20], [side * 13.6, 10.4, 3.5], materials.dark);
    for (let i = -9; i <= 9; i++) box(scene, [.3, .04, .06], [side * 13.6, 10.4, 3.5 + i * 1.05], materials.metal);
    box(scene, [.4, .5, .4], [side * 13.6, 4.2, -6.4], materials.panel);
  }
  // floor hazard border tiles
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    const marker = box(scene, [.1, .02, .28], [Math.sin(angle) * 4.05, -.01, Math.cos(angle) * 4.05], i % 4 === 0 ? materials.amber : materials.dark);
    marker.rotation.y = angle;
  }
  // bolted anchor rings embedded in the slab
  for (let i = 0; i < 4; i++) {
    ring(scene, 2.2 + i * .52, .022, -.01, i === 1 ? materials.copper : materials.metal);
  }
  // stepped plinth under the vessel with an access collar and caution trim
  cylinder(scene, 2.55, 2.75, .3, [0, .12, 0], materials.concrete, 48);
  cylinder(scene, 2.3, 2.42, .22, [0, .36, 0], materials.panel, 48);
  cylinder(scene, 2.08, 2.12, .16, [0, .55, 0], materials.armor, 48);
  ring(scene, 2.12, .05, .64, materials.amber);
  ring(scene, 2.44, .035, .02, materials.copper);
  // anchor bolts around the plinth
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    cylinder(scene, .055, .055, .12, [Math.sin(a) * 2.42, .3, Math.cos(a) * 2.42], materials.metal, 8);
  }
}

function buildVessel() {
  cylinder(scene, 1.33, 1.33, 3.26, [0, 2.2, 0], materials.glass, 48);
  for (const y of [.58, .76, 3.63, 3.82]) ring(scene, 1.36, .08, y, materials.metal, 48);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    box(scene, [.09, 3.15, .1], [Math.sin(a) * 1.36, 2.2, Math.cos(a) * 1.36], i % 3 ? materials.armor : materials.copper);
  }
  cylinder(scene, 1.52, 1.52, .22, [0, 3.91, 0], materials.dark, 48);
  cylinder(scene, .35, .46, .42, [0, 4.13, 0], materials.metal, 24);
  ring(scene, 1.77, .035, 4.06, materials.amber);
  const inner = cylinder(scene, .1, .1, 2.35, [0, 2.13, 0], materials.amber, 14);
  inner.material = new THREE.MeshBasicMaterial({ color: 0xf79a47, transparent: true, opacity: .35 });
  core = new THREE.Mesh(new THREE.IcosahedronGeometry(.65, 1), materials.core);
  core.position.set(0, 2.16, 0);
  scene.add(core);
  coreCage = new THREE.Mesh(new THREE.IcosahedronGeometry(.88, 1), materials.wire);
  coreCage.position.copy(core.position);
  scene.add(coreCage);
  for (let helix = 0; helix < 3; helix++) {
    const points = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const a = t * Math.PI * 5 + helix * Math.PI * 2 / 3;
      points.push([Math.cos(a) * (.74 + .06 * Math.sin(t * 9)), .83 + t * 2.65, Math.sin(a) * (.74 + .06 * Math.sin(t * 9))]);
    }
    cable(scene, points, .012, helix === 0 ? materials.amber : materials.copper);
  }
  const positions = [];
  for (let i = 0; i < 95; i++) {
    const angle = Math.random() * Math.PI * 2, radius = Math.sqrt(Math.random()) * 1.05;
    positions.push(Math.cos(angle) * radius, .8 + Math.random() * 2.7, Math.sin(angle) * radius);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xf5b272, size: .035, transparent: true, opacity: .78, sizeAttenuation: true, depthWrite: false }));
  scene.add(particles);
  const coreGlow = new THREE.PointLight(0xf0813c, 7.5, 7, 2);
  coreGlow.position.set(0, 2.2, 0);
  scene.add(coreGlow);
}

function buildSensors() {
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + Math.PI / 8;
    const x = Math.sin(a) * 3.5, z = Math.cos(a) * 3.5;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = a;
    scene.add(group);
    // rubber anti-vibration pad and bolted base plate
    box(group, [.82, .06, .86], [0, .03, 0], materials.rubber);
    box(group, [.73, .2, .78], [0, .14, 0], materials.dark);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder(group, .035, .035, .09, [sx * .31, .19, sz * .33], materials.metal, 6);
    // main instrument column with recessed front face
    box(group, [.56, 1.36, .57], [0, .88, 0], materials.armor);
    box(group, [.42, 1.2, .04], [0, .88, .283], materials.dark);
    // cooling vent slats on the column side
    for (let v = 0; v < 5; v++) box(group, [.5, .025, .04], [0, .55 + v * .1, -.283], materials.dark);
    // instrument head and emitter lamp
    box(group, [.46, .32, .45], [0, 1.66, 0], materials.metal);
    box(group, [.46, .05, .45], [0, 1.82, 0], materials.dark);
    cylinder(group, .19, .21, .08, [0, 1.87, 0], materials.dark, 20);
    const lamp = cylinder(group, .14, .14, .1, [0, 1.93, 0], materials.amber, 20);
    lamp.userData.sensor = i;
    clickable.push(lamp);
    cylinder(group, .04, .04, .06, [0, 2, 0], materials.metal, 10);
    // corner strut rails
    for (const side of [-1, 1]) box(group, [.06, 1.28, .08], [side * .27, .88, .26], materials.copper);
    // readout panel label on the recessed face
    const plate = label(`ДТ·0${i}`);
    plate.position.set(0, 1.22, .306);
    group.add(plate);
    // signal conduit running up the back of the column
    cylinder(group, .035, .035, 1.3, [.16, .85, -.26], materials.dark, 8);
    const touch = box(group, [.75, 1.66, .7], [0, 1, 0], new THREE.MeshBasicMaterial({ visible: false }));
    touch.userData.sensor = i;
    clickable.push(touch);
    sensorObjects.push({ group, lamp });
    cable(scene, [[x, .15, z], [x * .75, .08, z * .75], [x * .52, .25, z * .52]], .045, materials.dark);
  }
}

function buildOverhead() {
  for (const y of [4.55, 4.75]) ring(scene, 3.2, .08, y, materials.metal);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    box(scene, [.08, .16, .9], [Math.sin(a) * 3.15, 4.65, Math.cos(a) * 3.15], i % 3 ? materials.armor : materials.amber).rotation.y = a;
  }
  cylinder(scene, .85, .85, .25, [0, 5.02, 0], materials.dark, 36);
  cylinder(scene, .52, .7, .45, [0, 4.72, 0], materials.copper, 32);
}

function updateCamera() {
  const cp = Math.cos(pitch);
  camera.position.set(center.x + Math.sin(yaw) * cp * distance, center.y + Math.sin(pitch) * distance, center.z + Math.cos(yaw) * cp * distance);
  camera.lookAt(center);
}

function render(now = 0) {
  frameQueued = false;
  if (document.hidden) return;
  if (now - previousFrame < 40 && !reducedMotion.matches) { requestAnimationFrame(render); frameQueued = true; return; }
  previousFrame = now;
  if (!reducedMotion.matches) {
    core.rotation.y += .025;
    core.rotation.x += .008;
    coreCage.rotation.y -= .015;
    coreCage.rotation.z += .01;
    const pulse = 1 + Math.sin(now * .0026) * .075;
    core.scale.setScalar(pulse);
    particles.rotation.y += .002;
  }
  renderer.render(scene, camera);
  if (now < activeUntil && !reducedMotion.matches) { requestAnimationFrame(render); frameQueued = true; }
}

function wake(duration = 3400) {
  activeUntil = performance.now() + duration;
  if (!frameQueued) { frameQueued = true; requestAnimationFrame(render); }
}

function resize() {
  if (!renderer) return;
  const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  wake(500);
}

function selectSensor(index) {
  selectedSensor = index;
  sensorObjects.forEach(({ lamp }, i) => { lamp.material = i === index ? materials.mint : materials.amber; });
  document.dispatchEvent(new CustomEvent('array:sensor', { detail: { index } }));
  wake(1900);
}

function pickSensor(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(clickable, false)[0];
  if (hit) selectSensor(hit.object.userData.sensor);
}

function interactions() {
  canvas.addEventListener('pointerdown', event => { dragging = true; moved = false; pointerX = event.clientX; pointerY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dx = event.clientX - pointerX, dy = event.clientY - pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    yaw = Math.max(-1.2, Math.min(1.2, yaw - dx * .006));
    pitch = Math.max(-.08, Math.min(.62, pitch + dy * .004));
    pointerX = event.clientX; pointerY = event.clientY;
    updateCamera(); wake(1100);
  });
  canvas.addEventListener('pointerup', event => { dragging = false; if (!moved) pickSensor(event); });
  canvas.addEventListener('wheel', event => { event.preventDefault(); distance = Math.max(8, Math.min(MAX_ORBIT_DISTANCE, distance + event.deltaY * .01)); updateCamera(); wake(1200); }, { passive: false });
  addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(700); });
}

function boot() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = false;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, .1, 70);
    // low ambient base so metal reads by its specular, not flat fill
    scene.add(new THREE.AmbientLight(0x5b7577, .55));
    // overhead cool hemisphere approximating the ceiling fixtures and concrete bounce
    scene.add(new THREE.HemisphereLight(0x9fb9bd, 0x1a1512, .75));
    // warm key from the front-right, the dominant source
    const key = new THREE.DirectionalLight(0xffdcb0, 2.1);
    key.position.set(4, 8, 5);
    scene.add(key);
    // cool rim from behind-left for edge separation
    const rim = new THREE.DirectionalLight(0x79b0b2, 1.1);
    rim.position.set(-5, 5, -4);
    scene.add(rim);
    // soft fill from camera side to lift shadow terminators
    const fill = new THREE.DirectionalLight(0x8698a0, .5);
    fill.position.set(2, 3, 7);
    scene.add(fill);
    buildRoom(); buildVessel(); buildSensors(); buildOverhead();
    updateCamera(); resize(); interactions();
    window.arrayVisual = { selectSensor, wake, getSelected: () => selectedSensor };
  } catch (error) {
    console.warn('3D-модель контура недоступна', error);
    fallback.hidden = false;
    canvas.hidden = true;
  }
}

boot();
