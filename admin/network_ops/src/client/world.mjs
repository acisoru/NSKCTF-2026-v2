import * as T from 'three';
import * as C from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COLORS, ROOM, TRAYS, VIEWPOINTS, portPosition, installedCablePoints } from '../shared/catalog.mjs';
import { cablePath } from './cable-path.mjs';
import { CableBench } from './bench.mjs';
import { IncidentView } from './incidents.mjs';
import { REACH } from '../shared/workshop.mjs';
import { PositionReconciler } from './reconcile.mjs';

export class NetworkView {
  constructor(canvas, interact, hover) {
    this.canvas = canvas; this.interact = interact; this.onHover = hover; this.materials = new Map(); this.clock = 0; this.yaw = 0; this.pitch = -.13; this.mode = 'world'; this.end = 0; this.tool = 'hand'; this.selectedCable = null;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.scene = new T.Scene(); this.scene.background = new T.Color('#263635'); this.scene.fog = new T.FogExp2('#263635', .016);
    this.camera = new T.PerspectiveCamera(65, innerWidth / innerHeight, .04, 120); this.camera.position.set(0, 1.7, 11);
    this.scene.add(new T.HemisphereLight('#d9e5df', '#47564b', 2.6));
    const key = new T.DirectionalLight('#e8f7f0', 3.4); key.position.set(5, 12, 8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 40 }); key.shadow.normalBias = .04; this.scene.add(key);
    const fill = new T.PointLight('#77c7d6', 45, 22); fill.position.set(-10, 4, -4); this.scene.add(fill);
    this.physics = new C.World({ gravity: new C.Vec3(0, 0, 0) }); this.physics.broadphase = new C.SAPBroadphase(this.physics); this.physics.defaultContactMaterial.friction = 0;
    this.body = new C.Body({ mass: 1, shape: new C.Sphere(.34), position: new C.Vec3(0, .5, 11), linearDamping: 0 }); this.body.linearFactor.set(1, 0, 1); this.body.angularFactor.set(0, 0, 0); this.physics.addBody(this.body);
    this.baseTargets = []; this.deviceTargets = []; this.workTargets = []; this.colliders = []; this.reconciler = new PositionReconciler();
    this.architecture(); this.bench = new CableBench(this); this.deviceRoot = new T.Group(); this.scene.add(this.deviceRoot); this.wireRoot = new T.Group(); this.scene.add(this.wireRoot); this.incidents = new IncidentView(this);
    this.composer = new EffectComposer(this.renderer); this.composer.addPass(new RenderPass(this.scene, this.camera)); this.composer.addPass(new OutputPass());
    this.film = new ShaderPass({ uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: .026 }, resolution: { value: new T.Vector2(innerWidth, innerHeight) } }, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: `uniform sampler2D tDiffuse;uniform float time;uniform float amount;uniform vec2 resolution;varying vec2 vUv;void main(){vec2 p=vUv*2.-1.;vec2 uv=p*(1.+dot(p,p)*.024)*.5+.5;vec2 shift=vec2(.65/resolution.x,0.);vec3 c=texture2D(tDiffuse,uv).rgb;c.r=texture2D(tDiffuse,uv+shift).r;c.b=texture2D(tDiffuse,uv-shift).b;float n=fract(sin(dot(gl_FragCoord.xy+time,vec2(12.9898,78.233)))*43758.5453)-.5;float scan=1.-.045*(.5+.5*sin(uv.y*resolution.y*3.14159));float border=(1.-smoothstep(.98,1.,abs(uv.x*2.-1.)))*(1.-smoothstep(.98,1.,abs(uv.y*2.-1.)));gl_FragColor=vec4((c*scan+n*amount)*(1.-dot(p,p)*.08)*border,1.);}` });
    this.composer.addPass(this.film); this.pointer = new T.Vector2(); this.ray = new T.Raycaster(); this.keys = new Set(); this.resize(); addEventListener('resize', () => this.resize());
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => this.down(e)); canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e)); canvas.addEventListener('pointercancel', () => this.clearInput());
    document.addEventListener('mousemove', e => { if (this.locked && this.mode === 'world' && !this.blocked) this.look(e.movementX, e.movementY); });
    document.addEventListener('pointerlockchange', () => {
      this.lockPending = false; this.clearInput();
      if (this.locked && (this.mode !== 'world' || this.blocked)) { this.releasePointer(); return; }
      document.body.classList.toggle('pointer-locked', this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed());
    addEventListener('keydown', e => {
      if (e.code === 'Escape') { this.releasePointer(); this.clearInput(); if (!this.blocked && this.mode !== 'world') this.focus('world'); return; }
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || this.blocked) return;
      if (this.mode === 'world' && !e.repeat && e.code === 'KeyQ') this.interact({ kind: 'toggle-shotgun' });
      if (this.mode === 'world' && !e.repeat && e.code === 'KeyR' && this.tool === 'shotgun') this.interact({ kind: 'reload' });
      if (e.repeat && !this.locked && !this.looking) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) { this.keys.add(e.code); e.preventDefault(); }
      if (e.code === 'KeyE' && !e.repeat) { const hit = this.mode === 'world' ? this.pick() : null; if (hit) this.activate(hit.object.userData.pick, hit.distance); else if (this.mode !== 'world' && this.hovered) this.activate(this.hovered, this.hoveredDistance); }
    });
    addEventListener('keyup', e => this.keys.delete(e.code)); addEventListener('blur', () => { this.releasePointer(); this.clearInput(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.releasePointer(); this.clearInput(); } });
  }
  get locked() { return document.pointerLockElement === this.canvas; }
  lockFailed() { if (!this.lockPending) return; this.lockPending = false; this.interact({ kind: 'pointer-error' }); }
  requestPointer() {
    if (this.locked || this.lockPending || this.blocked || this.mode !== 'world') return;
    this.lockPending = true;
    try { const pending = this.canvas.requestPointerLock(); pending?.catch(() => this.lockFailed()); }
    catch { this.lockFailed(); }
  }
  releasePointer() { if (this.locked) document.exitPointerLock(); }
  clearInput() {
    if (this.drag?.wire) this.interact({ kind: 'gesture', phase: 'cancel' });
    this.bench?.cancel();
    this.keys.clear(); this.looking = false; this.drag = null; this.hovered = null; this.hoveredDistance = Infinity;
    this.hoverLabel = ''; this.onHover('');
    if (this.pointerId !== undefined && this.canvas.hasPointerCapture(this.pointerId)) this.canvas.releasePointerCapture(this.pointerId);
    this.pointerId = undefined;
    if (this.dragGhost) { this.dispose(this.dragGhost); this.dragGhost = null; }
  }
  setBlocked(blocked) { if (blocked && (!this.blocked || this.locked)) { this.releasePointer(); this.clearInput(); } this.blocked = blocked; }
  reconcile(pose) {
    const result = this.reconciler.setTarget(this.body.position, pose);
    if (result.snap) { this.body.position.x = result.x; this.body.position.z = result.z; this.body.velocity.setZero(); }
  }
  confirmPosition() { this.reconciler.clear(); }
  look(dx, dy, sensitivity = .0032) { if (!Number.isFinite(dx) || !Number.isFinite(dy)) return; this.yaw += dx * sensitivity; this.pitch = T.MathUtils.clamp(this.pitch - dy * sensitivity, -1.4, 1.4); }
  material(color, metal = .25, roughness = .65) { const key = `${color}/${metal}/${roughness}`; if (!this.materials.has(key)) this.materials.set(key, new T.MeshStandardMaterial({ color, metalness: metal, roughness })); return this.materials.get(key); }
  glow(color) { const key = `glow-${color}`; if (!this.materials.has(key)) this.materials.set(key, new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 })); return this.materials.get(key); }
  mesh(parent, geometry, material, x = 0, y = 0, z = 0) { const mesh = new T.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; }
  box(parent, w, h, d, color, x = 0, y = 0, z = 0, radius = .025) { return this.mesh(parent, new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 4, h / 4, d / 4)), typeof color === 'string' ? this.material(color) : color, x, y, z); }
  cylinder(parent, r, h, color, x = 0, y = 0, z = 0, segments = 24) { return this.mesh(parent, new T.CylinderGeometry(r, r, h, segments), typeof color === 'string' ? this.material(color, .6) : color, x, y, z); }
  label(parent, text, x, y, z, width = 1.5, color = '#d3e5d8', bg = null) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 144; const ctx = canvas.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 768, 144); } ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 60px monospace'; ctx.fillText(text, 384, 72, 740);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const mesh = this.mesh(parent, new T.PlaneGeometry(width, width * 144 / 768), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), x, y, z); mesh.castShadow = false; return mesh;
  }
  cable(parent, points, color, radius = .025) { return this.mesh(parent, new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), Math.max(16, points.length * 8), radius, 8, false), this.material(color, .08, .85)); }
  target(mesh, data, list = this.baseTargets) { mesh.userData.pick = data; list.push(mesh); return mesh; }
  collider(x, z, w, d, list = null) { const body = new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(w / 2, 3, d / 2)), position: new C.Vec3(x, .5, z) }); this.physics.addBody(body); list?.push(body); }
  architecture() {
    const noise = document.createElement('canvas'); noise.width = noise.height = 256; const ctx = noise.getContext('2d'), pixels = ctx.createImageData(256, 256);
    for (let i = 0; i < pixels.data.length; i += 4) { const n = 80 + Math.random() * 30; pixels.data[i] = n; pixels.data[i + 1] = n + 9; pixels.data[i + 2] = n + 5; pixels.data[i + 3] = 255; } ctx.putImageData(pixels, 0, 0); ctx.strokeStyle = '#293c34'; ctx.strokeRect(1, 1, 254, 254);
    const texture = new T.CanvasTexture(noise); texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(20, 18); texture.colorSpace = T.SRGBColorSpace;
    this.mesh(this.scene, new T.PlaneGeometry(30, 28), new T.MeshStandardMaterial({ map: texture, roughness: .95 }), 0, -.01, 0).rotation.x = -Math.PI / 2;
    for (const x of [-15, 15]) { this.box(this.scene, .3, 6, 28, '#61706b', x, 3, 0); this.collider(x, 0, .3, 28); }
    for (const z of [-14, 14]) { this.box(this.scene, 30, 6, .3, '#66736c', 0, 3, z); this.collider(0, z, 30, .3); }
    for (const x of [-12, -4, 4, 12]) {
      this.box(this.scene, 3.2, .09, .6, this.glow('#dbe9de'), x, 5.7, 0); this.box(this.scene, .12, 5.7, .12, '#344c43', x, 2.85, -13.6);
      for (let z = -11; z < 12; z += .45) this.box(this.scene, 2.1, .055, .06, '#6b8175', x, 3.9, z);
      for (const dx of [-1.05, 1.05]) this.box(this.scene, .055, .18, 24, '#8b9b8d', x + dx, 3.96, 0);
    }
    this.label(this.scene, 'ЛАБОРАТОРИЯ X', 0, 4.4, -13.78, 8, '#d9e4c9'); this.label(this.scene, 'СЕТЕВАЯ СМЕНА / РЕВИЗИЯ', 0, 3.6, -13.77, 7, '#91cfc1');
    for (const x of [-8, 8]) { this.box(this.scene, 4.2, 2, .06, '#1e332d', x, 3.1, -13.7); this.label(this.scene, x < 0 ? 'ПЕРИМЕТР ЦЕЛ' : 'АРХИВ / СВЯЗЬ', x, 3.2, -13.65, 3.6, '#a8c9bd'); }
    const bench = new T.Group(); bench.position.set(0, 0, 8); this.scene.add(bench);
    this.target(this.box(bench, 5.6, .16, 3.25, '#85917b', 0, 1, 0), { kind: 'bench', label: 'Монтажный верстак' });
    for (const x of [-2.3, 2.3]) for (const z of [-1.2, 1.2]) this.box(bench, .1, 1, .1, '#344a43', x, .5, z);
    this.label(bench, 'Т568B / CAT6 / RJ45', 0, .77, 1.65, 2.3, '#cddcca'); this.collider(0, 8, 5.6, 3.25);
    this.label(this.scene, 'РАСХОДНЫЕ МАТЕРИАЛЫ', 8, 2.7, 12.8, 3.6, '#c6d8c2');
    for (let i = 0; i < 3; i++) { this.box(this.scene, 3.4, .12, .9, '#62766a', 8, .7 + i * .65, 13); for (let j = 0; j < 5; j++) this.box(this.scene, .45, .37, .6, j % 2 ? '#50808a' : '#949980', 6.7 + j * .61, .93 + i * .65, 13); }
    for (const t of TRAYS) { const ring = this.mesh(this.scene, new T.TorusGeometry(.17, .025, 8, 32), this.glow('#d2ad63'), t.x, t.y, t.z); this.target(ring, { kind: 'tray', id: t.id, label: `Лоток / ${t.id}` }); }
  }
  rack(d) {
    const g = new T.Group(); g.position.set(d.x, 0, d.z); this.deviceRoot.add(g);
    this.box(g, 1.75, 2.65, 1.1, '#243b34', 0, 1.34); this.box(g, 1.57, 2.4, .05, '#101e1c', 0, 1.37, .57);
    for (const x of [-.71, .71]) { this.box(g, .055, 2.3, .09, '#8e9c8c', x, 1.34, .6); for (let i = 0; i < 20; i++) this.box(g, .065, .025, .03, '#182c26', x, .27 + i * .11, .654); }
    for (let u = 0; u < 6; u++) { this.box(g, 1.36, .21, .2, u === 3 ? '#778c85' : '#3b5149', 0, .42 + u * .3, .46); for (let v = 0; v < 12; v++) this.box(g, .014, .075, .01, '#162b24', -.56 + v * .1, .42 + u * .3, .57); }
    this.label(g, d.name.toUpperCase(), 0, 2.3, .625, 1.35, '#cbe7d8');
    for (const x of [-.34, .34]) { const fan = this.cylinder(g, .14, .06, '#153d36', x, .82, .6, 32); fan.rotation.x = Math.PI / 2; for (let i = 0; i < 5; i++) { const blade = this.box(g, .06, .23, .02, '#4e6b60', x, .82, .645); blade.rotation.z = i * Math.PI / 5; } }
    const power = this.cylinder(g, .075, .045, this.glow('#6cb897'), .57, 2.08, .64); power.rotation.x = Math.PI / 2;
    if (d.kind !== 'server') this.target(power, { kind: 'power', device: d.id, label: `Питание / ${d.id.toUpperCase()}` }, this.deviceTargets);
    power.userData.power = d.id;
    const serial = this.box(g, .17, .095, .035, '#49929e', -.51, 2.07, .644);
    if (d.kind !== 'server') this.target(serial, { kind: 'console', device: d.id, label: `CONSOLE / ${d.id.toUpperCase()}` }, this.deviceTargets);
    this.label(g, 'CONSOLE', -.49, 1.93, .644, .48, '#8fcbd0'); this.collider(d.x, d.z, 1.75, 1.1, this.colliders);
  }
  buildDevices(spec) {
    this.disposeChildren(this.deviceRoot); this.deviceTargets = [];
    for (const b of this.colliders) this.physics.removeBody(b); this.colliders = [];
    for (const d of spec.devices) {
      if (['switch', 'router', 'server'].includes(d.kind)) this.rack(d);
      else {
        const g = new T.Group(); g.position.set(d.x, 0, d.z); this.deviceRoot.add(g);
        this.box(g, 1.6, .12, .85, '#9da88e', 0, .76); this.box(g, .11, .76, .1, '#3a5145', -.65, .38); this.box(g, .11, .76, .1, '#3a5145', .65, .38);
        this.box(g, 1.05, .7, .11, '#162d29', 0, 1.2, -.15); this.box(g, .92, .56, .018, this.glow(d.kind === 'camera' ? '#5e8490' : '#4b776b'), 0, 1.2, -.078);
        this.label(g, d.kind === 'camera' ? 'REC / СЕТЬ' : 'ТЕРМИНАЛ', 0, 1.23, -.064, .79, '#c1e4ce'); this.box(g, .8, .025, .25, '#304b41', 0, .84, .15);
        const target = this.box(g, .12, .09, .06, '#4a9ca4', .6, 1.0, .2); if (d.kind !== 'camera') this.target(target, { kind: 'console', device: d.id, label: 'Локальная консоль станции' }, this.deviceTargets);
        this.collider(d.x, d.z, 1.6, .85, this.colliders);
      }
    }
    for (const d of spec.passive) {
      const cabinet = d.kind === 'panel';
      this.box(this.deviceRoot, cabinet ? 1.6 : .75, cabinet ? 2.25 : 1.65, cabinet ? 1 : .2, '#3b5148', d.x, cabinet ? 1.125 : .825, d.z + (cabinet ? .02 : -.1));
      this.collider(d.x, d.z, cabinet ? 1.6 : .75, cabinet ? 1 : .2, this.colliders);
      this.box(this.deviceRoot, d.kind === 'panel' ? 1.3 : .58, d.kind === 'panel' ? .65 : .28, .17, '#a6afa2', d.x, d.kind === 'panel' ? 1.47 : .95, d.z + (d.kind === 'panel' ? .47 : .1));
      this.label(this.deviceRoot, d.id === 'panel' ? 'PP-01' : 'ЛИНИЯ A / B', d.x, d.kind === 'panel' ? 1.78 : 1.2, d.z + (d.kind === 'panel' ? .58 : .21), .9, '#334f42');
      if (d.kind === 'panel') this.target(this.box(this.deviceRoot, .95, .2, .05, '#59756a', d.x, 1.15, d.z + .65), { kind: 'panel', label: 'PP-01 / разделка жил' }, this.deviceTargets);
    }
    for (const d of [...spec.devices, ...spec.passive]) for (const port of d.ports) {
      const endpoint = `${d.id}:${port}`, p = portPosition(spec, endpoint);
      const socket = this.box(this.deviceRoot, .19, .14, .06, '#142b24', p.x, p.y, p.z);
      this.target(socket, { kind: 'port', port: endpoint, label: `${d.id.toUpperCase()} / ${port}` }, this.deviceTargets);
      this.box(this.deviceRoot, .2, .15, .02, '#8c9e8e', p.x, p.y, p.z - .03);
      const led = this.box(this.deviceRoot, .025, .025, .02, this.glow('#547062'), p.x + .12, p.y + .08, p.z + .01); led.userData.portLed = endpoint;
      this.label(this.deviceRoot, port, p.x, p.y - .14, p.z + .04, .25, '#c3d2c3');
    }
  }
  assembly(lab) {
    if (this.workRoot) this.dispose(this.workRoot); this.workTargets = [];
    const panel = this.mode === 'panel';
    this.workRoot = new T.Group(); this.workRoot.position.set(...(panel ? [-12, 1.46, -6.38] : [0, 1.14, 8]));
    if (panel) { this.workRoot.rotation.x = Math.PI / 2; this.workRoot.scale.setScalar(.58); }
    this.scene.add(this.workRoot); const g = this.workRoot;
    if (!panel) { this.bench.build(this.mode === 'bench' ? lab : { ...lab, draft: null }); return; }
    this.box(g, 1.58, .13, .37, '#d0d4ba', 0, .08, -.74);
    this.target(this.cable(g, [[-.8, .05, .7], [-.4, .05, .56], [0, .05, .35]], '#6596a0', .085), { kind: 'jacket', label: 'Оболочка / CAT6' }, this.workTargets);
    for (let i = 0; i < 8; i++) {
      const x = (i - 3.5) * .18;
      const slot = this.box(g, .11, .025, .22, '#d5b25d', x, .165, -.72);
      this.target(slot, { kind: 'pin', pin: i, label: `Контакт ${i + 1}` }, this.workTargets);
      this.label(g, String(i + 1), x, .02, -.99, .11, '#e3e8d6').rotation.x = -Math.PI / 2;
    }
    const order = lab.panel;
    for (const [i, color] of COLORS.entries()) {
      const assigned = order.indexOf(color.id), x = ((assigned >= 0 ? assigned : i) - 3.5) * .18, z = assigned >= 0 ? -.62 : -.14;
      const points = [[(i - 3.5) * .012, .06, .36], [(i - 3.5) * .07, .085, .18], [x, .11, z + .17], [x, .14, z]];
      const wire = this.cable(g, points, color.stripe ? '#e6e8d6' : color.color, .024); this.target(wire, { kind: 'wire', wire: color.id, label: color.name }, this.workTargets);
      if (color.stripe) this.cable(g, points.map(p => [p[0], p[1] + .021, p[2]]), color.color, .009);
      const tip = this.mesh(g, new T.SphereGeometry(.047, 14, 10), this.material(color.color), x, .14, z); this.target(tip, { kind: 'wire', wire: color.id, label: color.name }, this.workTargets);
    }
  }
  update(lab, end = 0, preserveWork = false, mode = this.mode) {
    const changed = !this.lab || this.lab.level !== lab.level;
    this.lab = lab; this.end = end;
    if (changed) { this.reconciler.clear(); this.body.position.set(lab.incident?.pose.x ?? 0, .5, lab.incident?.pose.z ?? 11); this.yaw = 0; this.pitch = -.13; this.buildDevices(lab.spec); }
    if (changed || this.mode !== mode) { preserveWork = false; this.focus(mode, false); }
    if (lab.incident) this.incidents.update(lab.incident);
    this.deviceRoot.traverse(o => { if (o.userData.power) o.material = this.glow(lab.power[o.userData.power] ? '#75cd9c' : '#8c4e44'); if (o.userData.portLed) o.material = this.glow(lab.portLights[o.userData.portLed] ? '#7cce91' : '#3c5148'); });
    this.disposeChildren(this.wireRoot);
    for (const c of lab.cables) if (c.plugs[0] && c.plugs[1]) {
      const a = portPosition(lab.spec, c.plugs[0]), b = portPosition(lab.spec, c.plugs[1]);
      const pts = installedCablePoints(lab.spec, c), paths = [pts];
      if (c.damage) {
        const cut = new T.Vector3(...c.damage.point), along = new T.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        paths.splice(0, 1, [pts[0], pts[1], cut.clone().addScaledVector(along, -.16).toArray()], [cut.clone().addScaledVector(along, .16).toArray(), pts.at(-2), pts.at(-1)]);
        for (const sign of [-1, 1]) for (let i = 0; i < 5; i++) { const p = cut.clone().addScaledVector(along, sign * .12); this.cable(this.wireRoot, [p.toArray(), [p.x + (i - 2) * .018, p.y + .015, p.z + .06]], '#dfb174', .007); }
      }
      for (const points of paths) this.mesh(this.wireRoot, new T.TubeGeometry(cablePath(points), 160, .028, 10, false), this.material(c.damage ? '#716867' : c.handmade ? '#68c3d0' : '#c5ad6b', .08, .85));
      for (const p of [a, b]) { this.box(this.wireRoot, .11, .07, .15, c.handmade ? '#74b1bb' : '#b2a670', p.x, p.y, p.z + .075); this.label(this.wireRoot, c.label, p.x, p.y + .19, p.z + .15, .52, '#203b30', '#c4d4c0'); }
    }
    if (!preserveWork) this.assembly(lab);
    this.incidents.updateBreaks(lab);
  }
  focus(mode, notify = true) { if (notify) return this.interact({ kind: 'focus-request', mode }); this.mode = mode; this.releasePointer(); this.clearInput(); if (this.lab) this.assembly(this.lab); this.interact({ kind: 'focus', mode }); }
  pick(e) {
    // Server replies may replace geometry between animation frames.
    this.camera.updateMatrixWorld(true);
    if (this.mode === 'world') { this.deviceRoot.updateWorldMatrix(true, true); for (const target of this.baseTargets) target.updateWorldMatrix(true, false); }
    else this.workRoot?.updateWorldMatrix(true, true);
    if (this.locked || !e) this.pointer.set(0, 0);
    else { const rect = this.canvas.getBoundingClientRect(); this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1); }
    this.ray.setFromCamera(this.pointer, this.camera); return this.ray.intersectObjects(this.mode === 'world' ? [...this.baseTargets, ...this.deviceTargets] : this.workTargets, false)[0];
  }
  down(e) {
    e.preventDefault();
    if (this.blocked) return;
    // Acquiring mouse look must not also open the object under the first click.
    if (this.mode === 'world' && e.button === 0 && !this.locked) { this.requestPointer(); return; }
    if (!this.locked) { this.pointerId = e.pointerId; this.canvas.setPointerCapture(e.pointerId); }
    if (e.button === 2) { if (!this.locked && this.mode === 'world') { this.looking = true; this.lastPointer = [e.clientX, e.clientY]; } return; }
    if (e.button !== 0) return;
    if (this.mode === 'world' && this.tool === 'shotgun' && this.locked) { this.interact({ kind: 'shoot', direction: this.camera.getWorldDirection(new T.Vector3()).toArray() }); return; }
    const hit = this.pick(e); if (!hit) return;
    const target = hit.object.userData.pick;
    if (this.mode === 'bench' && this.bench.down(target, e)) return;
    if (target.kind === 'wire' && (this.mode === 'bench' && !this.lab.draft?.ends[this.end].inserted || this.mode === 'panel' && ['wires', 'punch'].includes(this.tool))) {
      const normal = new T.Vector3(0, 1, 0).applyQuaternion(this.workRoot.quaternion), point = this.workRoot.localToWorld(new T.Vector3(0, .16, 0));
      this.drag = { wire: target.wire, plane: new T.Plane().setFromNormalAndCoplanarPoint(normal, point), start: [e.clientX, e.clientY] };
      const from = this.ray.ray.intersectPlane(this.drag.plane, new T.Vector3());
      if (from) { const local = this.workRoot.worldToLocal(from); this.interact({ kind: 'gesture', phase: 'begin', gesture: 'wire', tool: this.mode === 'panel' ? 'punch' : 'hand', point: { x: local.x, z: local.z } }); }
      this.onHover(target.label); return;
    }
    this.activate(target, hit.distance);
  }
  move(e) {
    if (this.blocked || this.locked) return;
    if (this.looking && this.mode === 'world') { this.look(e.clientX - this.lastPointer[0], e.clientY - this.lastPointer[1], .005); this.lastPointer = [e.clientX, e.clientY]; return; }
    if (this.mode === 'bench' && this.bench.move(e)) return;
    if (this.drag?.wire) {
      this.pick(e); const point = this.ray.ray.intersectPlane(this.drag.plane, new T.Vector3());
      if (point) {
        const local = this.workRoot.worldToLocal(point); this.drag.local = local;
        if (performance.now() - (this.wireSampleAt ?? 0) > 100) { this.wireSampleAt = performance.now(); this.interact({ kind: 'gesture', phase: 'sample', point: { x: local.x, z: local.z } }); }
        if (this.dragGhost) this.dispose(this.dragGhost);
        this.dragGhost = this.cable(this.workRoot, [[0, .08, .35], [local.x * .5, .2, local.z * .5], local.toArray()], COLORS.find(c => c.id === this.drag.wire).color, .033);
      }
      return;
    }
    this.updateHover(e);
  }
  updateHover(e) {
    const hit = this.pick(e); this.hovered = hit?.object.userData.pick ?? null; this.hoveredDistance = hit?.distance ?? Infinity;
    const label = this.hovered ? this.mode === 'world' && hit.distance > 4.5 ? `${this.hovered.label} / ${hit.distance.toFixed(1)} м` : this.hovered.label : '';
    if (this.mode === 'bench') this.canvas.style.cursor = this.hovered ? ['bench-tool', 'bench-connector', 'wire', 'bench-measure', 'bench-depth', 'bench-mounted'].includes(this.hovered.kind) ? 'grab' : 'pointer' : '';
    if (label !== this.hoverLabel) { this.hoverLabel = label; this.onHover(label); }
  }
  up(e) {
    this.looking = false;
    if (this.mode === 'bench' && this.bench.up(e)) return;
    if (this.drag?.wire) {
      this.pick(e); const point = this.ray.ray.intersectPlane(this.drag.plane, new T.Vector3()), local = point ? this.workRoot.worldToLocal(point) : null;
      this.interact(local ? { kind: 'gesture', phase: 'end', point: { x: local.x, z: local.z } } : { kind: 'gesture', phase: 'cancel' });
    }
    if (this.dragGhost) { this.dispose(this.dragGhost); this.dragGhost = null; }
    this.drag = null;
  }
  activate(target, distance = 0) {
    if (this.mode === 'world' && distance > REACH) { this.onHover(`${target.label} / ${distance.toFixed(1)} м`); return; }
    if (target.kind === 'bench') { this.focus('bench'); return; }
      if (target.kind === 'panel' && this.tool === 'certifier') { this.focus('panel'); return; }
    this.interact(target);
  }
  dispose(g) { g.removeFromParent(); g.traverse(o => { o.geometry?.dispose(); if (o.material && ![...this.materials.values()].includes(o.material)) { o.material.map?.dispose(); o.material.dispose(); } }); }
  disposeChildren(g) { for (const child of [...g.children]) this.dispose(child); }
  resize() { this.renderer.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.composer?.setSize(innerWidth, innerHeight); this.film?.uniforms.resolution.value.set(innerWidth, innerHeight); }
  render(dt) {
    this.clock += dt;
    if (this.mode === 'world') {
      let x = 0, z = 0;
      if (!this.blocked) { x = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')); z = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')); }
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 6.5 : 4, length = Math.max(1, Math.hypot(x, z));
      this.body.velocity.set((Math.cos(this.yaw) * x + Math.sin(this.yaw) * z) * speed / length, 0, (Math.sin(this.yaw) * x - Math.cos(this.yaw) * z) * speed / length);
      this.physics.step(1 / 60, dt, 4); this.body.position.x = T.MathUtils.clamp(this.body.position.x, -ROOM.x + .5, ROOM.x - .5); this.body.position.z = T.MathUtils.clamp(this.body.position.z, -ROOM.z + .5, ROOM.z - .5);
      const corrected = this.reconciler.step(this.body.position, dt); if (corrected) { this.body.position.x = corrected.x; this.body.position.z = corrected.z; this.body.velocity.setZero(); }
      this.camera.position.lerp(new T.Vector3(this.body.position.x, 1.7, this.body.position.z), Math.min(1, dt * 13));
      const look = new T.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); this.camera.lookAt(this.camera.position.clone().add(look));
    } else {
      const view = VIEWPOINTS[this.mode]; this.camera.position.lerp(new T.Vector3(...view.position), Math.min(1, dt * 10)); this.camera.lookAt(...view.target);
    }
    if (this.locked && this.mode === 'world' && !this.blocked) this.updateHover();
    this.incidents.render(dt); this.film.uniforms.time.value = this.clock; this.composer.render(dt);
  }
}
