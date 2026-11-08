import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMERA, WEAPONS, ROLES, BUILDINGS, WALLS, LADDERS, MOVEMENT, SAFE_ZONES, BOSSES, BOMBER, ITEMS, RARITY, WORLD, WORLD_SCALE, SPAWN, hitShape, safeAt } from '../shared/config.mjs';
import { surface, batchModel, weapon as detailedWeapon, armorDetails, handDetails, enemyDetails, lowEnemy, supplyCrate } from './model-details.mjs';
import { projectileModel } from './projectile-model.mjs';
import { LocalPrediction, MotionBuffer } from './motion.mjs';

export class WorldView {
  constructor(canvas) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.scene = new T.Scene(); this.scene.background = new T.Color('#697976'); this.scene.fog = new T.FogExp2('#697976', .012);
    this.camera = new T.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, .05, 165);
    this.camera.position.set(SPAWN.x, 4.2, SPAWN.z + 7); this.camera.lookAt(SPAWN.x, 1.7, SPAWN.z - 9);
    this.cameraPosition = this.camera.position.clone(); this.yaw = 0; this.clock = 0; this.state = null;
    this.materials = {}; this.entities = new Map(); this.hazards = new Map(); this.effects = new Map(); this.drops = new Map(); this.bullets = new Map(); this.seen = new Set(); this.solids = []; this.motion = new MotionBuffer(); this.localPrediction = new LocalPrediction({ correctionRate: 9, deadZone: .08, snapDistance: 3.5 });
    this.scene.add(new T.HemisphereLight('#ccded8', '#323b33', 2.3));
    this.sun = new T.DirectionalLight('#fff0d1', 2.5); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 100 }); this.sun.shadow.normalBias = .045;
    this.scene.add(this.sun, this.sun.target);
    const fill = new T.DirectionalLight('#79cfc9', 1.1); fill.position.set(-30, 15, -20); this.scene.add(fill);
    this.makeWorld(); this.batchArchitecture();
    this.preview = this.avatar('assault'); this.preview.position.set(SPAWN.x, 0, SPAWN.z); this.scene.add(this.preview);
    this.composer = new EffectComposer(this.renderer); this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.viewScene = new T.Scene(); this.viewCamera = new T.PerspectiveCamera(68, innerWidth / innerHeight, .02, 6);
    this.viewScene.add(new T.HemisphereLight('#dce9e3', '#354b40', 2.4));
    const weaponLight = new T.DirectionalLight('#fff0d1', 2.7); weaponLight.position.set(-2, 3, 1); this.viewScene.add(weaponLight);
    // A separate depth buffer keeps the hands out of walls without changing hit detection.
    this.viewPass = new RenderPass(this.viewScene, this.viewCamera); this.viewPass.clear = false; this.viewPass.clearDepth = true; this.viewPass.enabled = false;
    this.composer.addPass(this.viewPass); this.viewRecoil = 0; this.viewSway = new T.Vector2();
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: .035 }, resolution: { value: new T.Vector2(innerWidth, innerHeight) } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float amount; uniform vec2 resolution; varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){vec2 q=vUv*2.-1.;vec2 curved=q*(1.+.038*dot(q,q));vec2 uv=curved*.5+.5;
        float border=(1.-smoothstep(.975,1.,abs(curved.x)))*(1.-smoothstep(.975,1.,abs(curved.y)));
        vec2 shift=vec2(1.15/resolution.x,0.)*(.45+dot(q,q));
        vec3 c=texture2D(tDiffuse,uv).rgb;c.r=texture2D(tDiffuse,uv+shift).r;c.b=texture2D(tDiffuse,uv-shift).b;
        float noise=hash(vUv*resolution+fract(time)*71.)-.5;
        float scan=1.-.07*(.5+.5*sin(uv.y*resolution.y*3.14159265));
        float phosphor=mod(floor(gl_FragCoord.x),3.);vec3 mask=vec3(.96);if(phosphor<1.)mask.r=1.;else if(phosphor<2.)mask.g=1.;else mask.b=1.;
        float roll=exp(-pow((fract(uv.y-time*.055)-.5)*65.,2.))*.018;
        c=(c*scan*mask+noise*amount+roll)*(1.-dot(q,q)*.13);
        gl_FragColor=vec4(c*border,1.);}`,
    });
    this.composer.addPass(this.film); this.resize(); addEventListener('resize', () => this.resize());
  }
  mat(color, metal = .25, rough = .7) {
    const key = `${color}/${metal}/${rough}`;
    return this.materials[key] ??= new T.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
  }
  glow(color) { return this.materials[`g${color}`] ??= new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, roughness: .35 }); }
  mesh(parent, geometry, material, x = 0, y = 0, z = 0) { const m = new T.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
  box(parent, w, h, d, material, x = 0, y = 0, z = 0) { return this.mesh(parent, new T.BoxGeometry(w, h, d), material, x, y, z); }
  rounded(parent, w, h, d, material, x = 0, y = 0, z = 0, radius = .08) { return this.mesh(parent, new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 3, h / 3, d / 3)), material, x, y, z); }
  cylinder(parent, r1, r2, h, material, x = 0, y = 0, z = 0, count = 16) { return this.mesh(parent, new T.CylinderGeometry(r1, r2, h, count), material, x, y, z); }
  ring(parent, radius, tube, color, x = 0, y = .06, z = 0) { const m = this.mesh(parent, new T.TorusGeometry(radius, tube, 6, 96), this.glow(color), x, y, z); m.rotation.x = Math.PI / 2; return m; }
  texture(kind) {
    const c = document.createElement('canvas'); c.width = c.height = 512; const ctx = c.getContext('2d');
    const img = ctx.createImageData(512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (kind === 'road' ? 55 : 105) + Math.random() * 20;
      img.data[i] = v; img.data[i + 1] = v + (kind === 'road' ? 2 : 8); img.data[i + 2] = v + 2; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = '#25352d80'; ctx.lineWidth = 2;
    for (let i = 0; i < 15; i++) { const x = Math.random() * 512, y = Math.random() * 512; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 15, y + 30); ctx.lineTo(x + 8, y + 70); ctx.stroke(); }
    if (kind !== 'road') { ctx.strokeStyle = '#30423560'; ctx.strokeRect(1, 1, 510, 510); }
    const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace; texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.anisotropy = 8; return texture;
  }
  text(text, color = '#d5e7dd', width = 512, size = 50) {
    const c = document.createElement('canvas'); c.width = width; c.height = 128; const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.font = `600 ${size}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width / 2, 64, width - 15);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    return new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: T.DoubleSide });
  }
  sign(text, x, y, z, width, color = '#91e2b9', parent = this.scene) { return this.mesh(parent, new T.PlaneGeometry(width, width / 4), this.text(text, color), x, y, z); }
  makeWorld() {
    const concrete = this.texture('concrete'); concrete.repeat.set(34 * WORLD_SCALE, 36 * WORLD_SCALE);
    this.mesh(this.scene, new T.PlaneGeometry(WORLD.x * 2 + 10, WORLD.z * 2 + 10), new T.MeshStandardMaterial({ map: concrete, roughness: .96 }), 0, -.035, 0).rotation.x = -Math.PI / 2;
    const road = this.texture('road'); road.repeat.set(2, 24);
    const asphalt = new T.MeshStandardMaterial({ map: road, roughness: .9 });
    const roadBox = (width, depth, x, z) => { const mesh = this.box(this.scene, width, .035, depth, asphalt, x, -.005, z); mesh.castShadow = false; return mesh; };
    const mainRoadWidth = 10, crossRoadWidth = WORLD.x * 2 - 50, crossRoadSide = (crossRoadWidth - mainRoadWidth) / 2;
    roadBox(mainRoadWidth, WORLD.z * 2 - 10, 0, -1);
    // Split cross roads around the main road so their coplanar surfaces never z-fight.
    for (const z of [16, -92, 85]) {
      const center = mainRoadWidth / 2 + crossRoadSide / 2;
      roadBox(crossRoadSide, 8, -center, z); roadBox(crossRoadSide, 8, center, z);
    }
    for (let z = -WORLD.z + 8; z < WORLD.z - 8; z += 5) this.box(this.scene, .12, .016, 2.1, this.mat('#c3b775'), 0, .03, z);
    for (const b of BUILDINGS) this.building(b);
    for (const zone of SAFE_ZONES) {
      this.ring(this.scene, zone.radius, .065, '#79ddb0', zone.x, .06, zone.z);
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8, x = zone.x + Math.cos(a) * zone.radius, z = zone.z + Math.sin(a) * zone.radius;
        this.box(this.scene, .18, .8, .18, this.mat('#344d40'), x, .4, z); this.box(this.scene, .2, .18, .2, this.glow('#79ddb0'), x, .83, z);
      }
      this.market(zone);
    }
    const gateZ = SAFE_ZONES[0].z - 20;
    for (const x of [-6.5, 6.5]) this.box(this.scene, .9, 7.5, 1.1, this.mat('#46544e'), x, 3.7, gateZ);
    this.box(this.scene, 14, 1.3, 1.2, this.mat('#2b3933'), 0, 7.1, gateZ);
    this.sign('ЛАБОРАТОРИЯ X', 0, 7.1, gateZ + .64, 11, '#b5ebce');
    this.sign('ПЕРИМЕТР / НЕЙТРАЛЬНЫЙ КОНТУР', 0, 5.95, gateZ + .64, 10, '#c9dac9');
    for (const boss of BOSSES) {
      this.cylinder(this.scene, 13, 13.5, .18, this.mat('#485751', .35), boss.x, .01, boss.z, 64);
      this.ring(this.scene, 12.7, .04, boss.color, boss.x, .12, boss.z);
      this.ring(this.scene, 5.5, .023, boss.color, boss.x, .12, boss.z);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const x = boss.x + Math.cos(a) * 12, z = boss.z + Math.sin(a) * 12; this.box(this.scene, .45, 1.8, .45, this.mat('#38483f'), x, .9, z); this.box(this.scene, .2, .35, .2, this.glow(boss.color), x, 1.95, z); }
      const sign = this.sign(boss.region.toUpperCase(), boss.x, 5, boss.z - 13, 13, boss.color); sign.userData.region = true;
    }
    // Overhead process pipes, service gantries and warning boards connect the districts.
    for (const z of [SAFE_ZONES[0].z - 37, 60, 5, -70, -150]) {
      for (const x of [-8, 8]) { this.box(this.scene, .35, 6, .35, this.mat('#515e58', .75), x, 3, z); this.box(this.scene, 1.1, .2, 1.1, this.mat('#34483d'), x, .1, z); }
      const pipe = this.cylinder(this.scene, .3, .3, 17, this.mat('#758177', .7), 0, 6, z); pipe.rotation.z = Math.PI / 2;
      this.sign(z > 60 ? 'РЕВИЗИЯ ОТКРЫТА' : z > -100 ? '559 СУТОК / ДАННЫЕ ОТСУТСТВУЮТ' : 'КАРАНТИН', 0, 5.5, z + .32, 7, z < -100 ? '#e4a57e' : '#c8d0b7');
    }
    for (let z = -WORLD.z + 15; z <= WORLD.z - 15; z += 20) for (const x of [-6, 6]) this.lamp(x, z);
    for (const side of [-1, 1]) for (let z = -WORLD.z + 15; z < WORLD.z - 15; z += 25) {
      const x = side * (WORLD.x - 7);
      this.box(this.scene, 1.8, 10 + ((z + 60) % 3) * 2, 1.8, this.mat('#56615a'), x, 5, z);
      this.box(this.scene, .4, .5, .4, this.glow('#df8368'), x, 10.3, z);
      const cable = this.cylinder(this.scene, .06, .06, 16, this.mat('#253c30'), x, 8.8, z + 8, 6); cable.rotation.x = Math.PI / 2;
    }
    const debris = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), this.mat('#465449'), 1000); const dummy = new T.Object3D();
    let seed = 39; const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 1000; i++) { const x = (rand() > .5 ? 1 : -1) * (18 + rand() * (WORLD.x - 30)), z = rand() * (WORLD.z * 2 - 20) - WORLD.z + 10; dummy.position.set(x, .1, z); dummy.scale.set(.15 + rand() * .9, .1 + rand() * .25, .15 + rand() * .8); dummy.rotation.set(0, rand() * 6, 0); dummy.updateMatrix(); debris.setMatrixAt(i, dummy.matrix); }
    debris.receiveShadow = true; debris.castShadow = true; this.scene.add(debris);
    for (const [x, z] of [[-62, -52], [61, 28], [53, 64], [-61, 43]].map(([x, z]) => [x * WORLD_SCALE, z * WORLD_SCALE])) {
      for (let i = 0; i < 3; i++) { this.cylinder(this.scene, 1.7, 2, 10 + i * 2, this.mat('#778178', .7), x + i * 4, 5 + i, z); this.ring(this.scene, 1.75, .1, '#b4c7b6', x + i * 4, 8, z); }
    }
    const rainGeo = new T.BufferGeometry(); const positions = [];
    for (let i = 0; i < 170; i++) { const x = Math.random() * 70 - 35, y = Math.random() * 20, z = Math.random() * 70 - 35; positions.push(x, y, z, x - .04, y + .6, z); }
    rainGeo.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); this.rain = new T.LineSegments(rainGeo, new T.LineBasicMaterial({ color: '#c7ddd0', transparent: true, opacity: .17, depthWrite: false })); this.scene.add(this.rain);
  }
  batchArchitecture() {
    this.scene.updateMatrixWorld(true);
    const groups = new Map(), originals = [], retained = new Set(this.solids);
    this.scene.traverse(object => {
      if (!object.isMesh || object.isInstancedMesh || Array.isArray(object.material)) return;
      const p = new T.Vector3().setFromMatrixPosition(object.matrixWorld);
      const key = `${Math.floor(p.x / 48)}:${Math.floor(p.z / 48)}:${object.material.uuid}`;
      let geometry = object.geometry.clone();
      if (geometry.index) { const expanded = geometry.toNonIndexed(); geometry.dispose(); geometry = expanded; }
      geometry.applyMatrix4(object.matrixWorld);
      if (!groups.has(key)) groups.set(key, { material: object.material, geometries: [] });
      groups.get(key).geometries.push(geometry); originals.push(object);
    });
    for (const object of originals) { object.removeFromParent(); if (!retained.has(object)) object.geometry.dispose(); }
    for (const { material, geometries } of groups.values()) {
      const geometry = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
      if (!geometry) throw new Error('Static geometry batching failed');
      geometry.computeBoundingSphere(); const mesh = new T.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    }
  }
  building(b) {
    const group = new T.Group(); group.position.set(b.x, 0, b.z); this.scene.add(group);
    const color = b.kind === 'town' ? '#829288' : b.kind === 'core' ? '#424d48' : '#68786d';
    this.wallTexture ??= this.texture('concrete');
    this.wallTexture.repeat.set(2, 2);
    const wall = this.materials[`wall${color}`] ??= new T.MeshStandardMaterial({ color, map: this.wallTexture, bumpMap: this.wallTexture, bumpScale: .045, metalness: .15, roughness: .93 });
    const base = this.box(group, b.w, b.h, b.d, wall, 0, b.h / 2); this.solids.push(base);
    this.box(group, b.w + .4, .3, b.d + .4, this.mat('#283b31', .5), 0, b.h);
    this.box(group, b.w + .04, .75, b.d + .04, this.mat('#374b3d'), 0, .38);
    for (let x = -b.w / 2 + .7; x < b.w / 2; x += 1.8) {
      this.box(group, .05, b.h, .06, this.mat('#35493b'), x, b.h / 2, b.d / 2 + .04);
      if (b.h > 4) { this.box(group, 1.2, 1.2, .06, this.mat('#182f28', .8, .15), x, b.h - 1.8, b.d / 2 + .05); this.box(group, 1.15, .06, .07, this.glow(b.kind === 'core' ? '#e58b65' : '#9ec7b0'), x, b.h - 1.25, b.d / 2 + .09); }
    }
    this.box(group, 1.6, 2.4, .12, this.mat('#27392f', .75), 0, 1.2, b.d / 2 + .08);
    this.box(group, .06, 2.25, .14, this.glow(b.kind === 'town' ? '#79ddb0' : '#bda376'), -.83, 1.2, b.d / 2 + .12);
    this.box(group, 1.7, .08, .15, this.glow(b.kind === 'town' ? '#79ddb0' : '#bda376'), 0, 2.44, b.d / 2 + .12);
    this.sign(b.kind === 'town' ? 'ПЕРИМЕТР' : b.kind === 'core' ? 'HACKED' : 'LAB · X', 0, Math.min(b.h - .7, 3.4), b.d / 2 + .2, Math.min(4.8, b.w - .5), b.kind === 'core' ? '#eb9573' : '#c5d4ba', group);
    const vent = this.box(group, 1.5, .8, 1.2, this.mat('#3d5344', .7), b.w / 3, b.h + .5, 0);
    for (let i = 0; i < 6; i++) this.box(group, 1.3, .03, .08, this.mat('#a0aba0'), vent.position.x, b.h + .92, -.4 + i * .16);
    this.cylinder(group, .15, .15, b.h + 2, this.mat('#849186', .8), -b.w / 2 + .2, (b.h + 2) / 2, -b.d / 2 + .3);
    for (const dx of [-.38, .38]) this.cylinder(group, .045, .045, b.h, this.mat('#96a89b', .8), -b.w / 2 + dx + .8, b.h / 2, b.d / 2 + .25, 12);
    for (let y = .4; y < b.h; y += .36) this.box(group, .8, .045, .06, this.mat('#9ba99b', .8), -b.w / 2 + .8, y, b.d / 2 + .25);
    const ac = this.rounded(group, 1.8, 1.1, .6, this.mat('#abb2a1', .65), b.w / 2 - 1.1, 1.8, b.d / 2 + .3);
    const fan = this.mesh(group, new T.TorusGeometry(.32, .035, 10, 32), this.mat('#35433c'), ac.position.x, 1.8, b.d / 2 + .64);
    for (let i = 0; i < 5; i++) { const fin = this.box(group, .52, .04, .015, this.mat('#35433c'), ac.position.x, 1.8, b.d / 2 + .65); fin.rotation.z = i * Math.PI / 5; }
    fan.castShadow = false;
    for (const x of [-b.w / 2 + .3, b.w / 2 - .3]) for (let y = 1; y < b.h; y += 1.4) this.mesh(group, new T.SphereGeometry(.055, 10, 8), this.mat('#b3b6a5', .8), x, y, b.d / 2 + .08);
  }
  market(zone) {
    const { x, z } = zone.merchant; const g = new T.Group(); g.position.set(x, 0, z); this.scene.add(g);
    this.box(g, 3, .85, 1.2, this.mat('#465e4e'), 0, .43, 0);
    for (const dx of [-1.4, 1.4]) this.box(g, .1, 3.2, .1, this.mat('#263f30'), dx, 1.6, -.6);
    this.box(g, 3.5, .15, 2.3, this.mat('#71927a'), 0, 3.15, -.1);
    this.sign('ОБМЕН / СНАБЖЕНИЕ', 0, 2.8, 1, 3.3, '#91e2b9', g);
    for (let i = 0; i < 4; i++) { const crate = new T.Group(); crate.position.set(-1 + i * .6, .85, .05); g.add(crate); supplyCrate(this, crate, i % 2 ? '#d6bd82' : '#89c2bd'); }
    const merchant = this.avatar('medic'); merchant.position.set(0, 0, -1.1); merchant.rotation.y = Math.PI; g.add(merchant);
    const light = new T.PointLight('#7cffb5', 15, 10, 2); light.position.set(0, 2.5, 0); g.add(light);
  }
  lamp(x, z) {
    this.cylinder(this.scene, .09, .15, 5.8, this.mat('#304438', .7), x, 2.9, z, 8);
    this.box(this.scene, 1.1, .12, .6, this.mat('#bac7b8'), x + (x < 0 ? .4 : -.4), 5.8, z);
    this.box(this.scene, .9, .03, .45, this.glow('#f6d99c'), x + (x < 0 ? .4 : -.4), 5.7, z);
  }
  weaponModel(type = 'pistol') {
    return detailedWeapon(this, type);
  }
  firstPersonModel(type, role) {
    const rig = new T.Group(), gun = this.weaponModel(type); rig.add(gun); rig.scale.setScalar(.7);
    const sleeve = surface(this, 'sleeves', '#384647', .02, .97, 'fabric'), glove = surface(this, 'gloves', '#263032', .02, .87, 'fabric'), armor = surface(this, `role-${role}`, ROLES[role].color, .3, .62);
    const arm = (from, to) => {
      const a = new T.Vector3(...from), b = new T.Vector3(...to), delta = b.clone().sub(a);
      const mesh = this.mesh(rig, new T.CapsuleGeometry(.085, Math.max(.01, delta.length() - .17), 8, 16), sleeve);
      mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
      this.rounded(rig, .16, .13, .18, armor, ...b.toArray(), .03);
    };
    arm([.15, -.52, .18], [.015, -.24, -.14]);
    const supportZ = type === 'pistol' ? -.27 : -.64;
    arm([-.46, -.51, .12], [-.1, -.15, supportZ]);
    this.rounded(rig, .14, .2, .14, glove, .01, -.17, -.2, .035);
    this.rounded(rig, .2, .11, .19, glove, -.07, -.11, supportZ, .035);
    for (let i = 0; i < 4; i++) this.rounded(rig, .032, .075, .12, glove, -.14 + i * .04, -.045, supportZ - .015, .01);
    handDetails(this, rig, role, type);
    const length = type === 'sniper' ? 1.1 : type === 'pistol' ? .25 : .6;
    const flash = this.mesh(rig, new T.SphereGeometry(.07, 12, 8), new T.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0, depthWrite: false }), 0, .03, -.48 - length);
    flash.scale.set(1, 1, 2.6); rig.userData.flash = flash;
    rig.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    rig.userData.type = type; rig.userData.role = role; return rig;
  }
  avatar(role, type = 'pistol', low = false) {
    if (low) {
      const g = new T.Group();
      this.mesh(g, new T.CapsuleGeometry(.27, .6, 2, 8), this.mat(ROLES[role].color), 0, 1.05);
      this.mesh(g, new T.SphereGeometry(.28, 10, 8), this.mat('#bdc7be'), 0, 1.75);
      g.userData.legs = [];
      for (const x of [-.18, .18]) { const leg = new T.Group(); leg.position.set(x, .68, 0); g.add(leg); this.box(leg, .2, .64, .22, this.mat('#263c36'), 0, -.32); g.userData.legs.push(leg); }
      g.userData.weapon = new T.Group(); g.userData.weapon.position.set(.39, 1.04, -.23); g.add(g.userData.weapon);
      this.box(g.userData.weapon, .1, .15, .6, this.mat('#718779'), 0, 0, -.3);
      g.userData.weaponType = type; g.userData.ward = this.ring(g, .6, .018, ROLES[role].color); g.userData.ward.visible = false; g.userData.low = true; return g;
    }
    const g = new T.Group(), armor = surface(this, 'armor', '#bdc7be', .5, .5), cloth = surface(this, 'fabric', '#303e40', .02, .96, 'fabric'), accent = surface(this, `role-${role}`, ROLES[role].color, .3, .62);
    this.rounded(g, .64, .73, .42, cloth, 0, 1.11);
    this.rounded(g, .58, .4, .11, armor, 0, 1.26, -.24);
    this.rounded(g, .5, .22, .09, armor, 0, .94, -.24);
    this.rounded(g, .61, .08, .5, this.mat('#84948a', .7), 0, .78);
    for (const x of [-.18, .18]) {
      this.rounded(g, .17, .2, .12, accent, x, 1.12, -.31, .025);
      this.rounded(g, .14, .08, .14, this.mat('#c9cab9'), x, 1.24, -.32, .02);
      this.box(g, .055, .04, .04, this.glow(ROLES[role].color), x, 1.12, -.39);
    }
    this.rounded(g, .48, .58, .24, armor, 0, 1.18, .34);
    this.rounded(g, .3, .36, .05, this.mat('#203c32'), 0, 1.18, .48, .025);
    for (const x of [-.23, .23]) {
      this.cylinder(g, .085, .085, .5, this.mat('#8eaa9a', .75), x, 1.14, .39, 24);
      this.ring(g, .086, .012, ROLES[role].color, x, 1.28, .39);
    }
    for (let i = 0; i < 4; i++) this.box(g, .18, .018, .018, this.glow(ROLES[role].color), 0, 1.3 - i * .07, .51);
    this.mesh(g, new T.SphereGeometry(.3, 32, 24), armor, 0, 1.73);
    this.mesh(g, new T.SphereGeometry(.311, 32, 16, Math.PI * 1.15, Math.PI * .7, .98, .58), this.mat('#18534b', .75, .13), 0, 1.75);
    this.rounded(g, .11, .18, .25, accent, -.29, 1.72, .02, .025);
    this.rounded(g, .11, .18, .25, accent, .29, 1.72, .02, .025);
    this.cylinder(g, .16, .2, .08, this.mat('#172f26'), 0, 1.48, 0, 28);
    this.box(g, .045, .045, .07, this.glow('#b9ecd7'), .27, 1.85, -.12);
    for (const x of [-.4, .4]) {
      this.mesh(g, new T.SphereGeometry(.155, 20, 16), accent, x, 1.35);
      const arm = this.mesh(g, new T.CapsuleGeometry(.095, .26, 6, 16), cloth, x, 1.12, -.06); arm.rotation.x = -.18;
      this.mesh(g, new T.SphereGeometry(.11, 16, 12), armor, x, .91, -.1);
      this.rounded(g, .16, .15, .19, cloth, x, .87, -.2, .045);
    }
    const weapon = this.weaponModel(type); weapon.position.set(.39, 1.04, -.23); g.add(weapon); g.userData.weapon = weapon; g.userData.weaponType = type;
    g.userData.legs = [];
    for (const x of [-.18, .18]) {
      const leg = new T.Group(); leg.position.set(x, .7, 0); g.add(leg);
      this.mesh(leg, new T.CapsuleGeometry(.105, .4, 6, 16), cloth, 0, -.23);
      this.rounded(leg, .2, .18, .12, armor, 0, -.25, -.12, .035);
      this.rounded(leg, .19, .2, .13, accent, 0, -.47, -.065, .03);
      this.rounded(leg, .26, .17, .4, this.mat('#20382c'), 0, -.59, -.075, .055);
      this.box(leg, .27, .035, .41, this.mat('#12261d'), 0, -.67, -.075); g.userData.legs.push(leg);
    }
    const ward = this.ring(g, 1.1, .035, '#ebc96d'); ward.visible = false; g.userData.ward = ward;
    armorDetails(this, g, role);
    for (const leg of g.userData.legs) batchModel(leg);
    return batchModel(g, [...g.userData.legs, weapon, ward]);
  }
  enemy(data) {
    if (data.low && data.kind !== 'boss') return lowEnemy(this, data);
    const g = new T.Group(), metal = surface(this, 'chassis', '#46555b', .68, .5), light = this.glow(data.bossId === 'resonator' ? '#7bc7d0' : '#e88b68');
    if (data.kind === 'boss') {
      this.cylinder(g, 1.1, 1.6, .65, metal, 0, .7, 0, 48);
      this.rounded(g, 2.2, 1.7, 1.5, this.mat('#7d8d7c', .6), 0, 2, 0, .22);
      this.mesh(g, new T.IcosahedronGeometry(.68, 3), light, 0, 2.1, -.9);
      const collar = this.mesh(g, new T.TorusGeometry(.79, .14, 16, 56), metal, 0, 2.1, -.95);
      this.rounded(g, 1.2, .45, 1.1, this.mat('#b2b79d'), 0, 3.15, 0, .15);
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; this.mesh(g, new T.SphereGeometry(.065, 12, 8), this.mat('#c8cbb4', .9), Math.cos(a) * .8, 2.1 + Math.sin(a) * .8, -1.11); }
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const piston = this.cylinder(g, .09, .12, 1.3, this.mat('#aebdad', .85), side * (1.1 + i * .2), 1.12, .2, 24); piston.rotation.z = side * .35;
        this.mesh(g, new T.SphereGeometry(.17, 20, 12), metal, side * (1.2 + i * .2), .61, .2);
      }
      collar.castShadow = true;
      for (const side of [-1, 1]) {
        this.rounded(g, .8, .75, .95, metal, side * 1.5, 2.5, 0, .18); this.cylinder(g, .32, .42, 1.6, metal, side * 2, 1.8, 0, 32);
        this.rounded(g, .55, .15, .6, light, side * 2, 1, -.2); this.rounded(g, .8, .45, 1.4, metal, side * 1, .3, 0, .12);
        for (let i = 0; i < 5; i++) this.ring(g, .35, .035, '#a8bbab', side * 2, 1.45 + i * .17, 0);
      }
      g.userData.spin = this.ring(g, 2.3, .06, BOSSES.find(b => b.id === data.bossId).color, 0, 2.8); g.userData.spin.rotation.x = .5;
      g.userData.shield = this.mesh(g, new T.IcosahedronGeometry(3.2, 1), new T.MeshBasicMaterial({ color: '#e8ce85', transparent: true, opacity: .17, wireframe: true, depthWrite: false }), 0, 1.9);
      if (data.bossId === 'warden') { g.scale.setScalar(1.3); for (const x of [-.65, .65]) { this.cylinder(g, .08, .18, 1.3, light, x, 3.9, .2, 24); this.rounded(g, .45, 1.2, .5, metal, x * 2.2, 3.4, .3, .1); } }
      if (data.bossId === 'resonator') for (const tilt of [-.7, .7]) { const ring = this.mesh(g, new T.TorusGeometry(2.25, .12, 16, 72), this.mat('#86b7b6', .8), 0, 2.3); ring.rotation.y = tilt; }
      if (data.bossId === 'archivist') for (let i = 0; i < 5; i++) this.rounded(g, .33, 1.5, .7, this.mat(i % 2 ? '#b0aa80' : '#798879'), (i - 2) * .45, 2.5, 1, .06);
    } else if (data.kind === 'pylon') {
      this.cylinder(g, .85, 1, .3, metal, 0, .2, 0, 32); this.rounded(g, .6, 2, .6, this.mat('#a9b29b'), 0, 1.3, 0, .12);
      this.mesh(g, new T.OctahedronGeometry(.55, 2), this.glow('#ebc96d'), 0, 2.7); this.ring(g, .9, .035, '#ebc96d');
      for (let i = 0; i < 6; i++) this.ring(g, .44, .045, '#c4c7a5', 0, .7 + i * .23, 0);
    } else if (data.kind === 'bomber') {
      this.rounded(g, .85, .4, .8, this.mat('#55655a', .75), 0, 1.13, 0, .14);
      this.mesh(g, new T.SphereGeometry(.14, 20, 16), this.glow('#ef704f'), 0, 1.15, -.43);
      this.mesh(g, new T.TorusGeometry(.19, .04, 12, 32), this.mat('#c7c3a3', .8), 0, 1.15, -.43);
      g.userData.rotors = [];
      for (const x of [-.78, .78]) for (const z of [-.48, .48]) {
        const arm = this.rounded(g, .75, .1, .13, metal, x / 2, 1.18, z, .03);
        arm.rotation.z = x < 0 ? .12 : -.12;
        this.cylinder(g, .09, .13, .23, this.mat('#a5b6a6', .8), x, 1.28, z, 24);
        this.ring(g, .37, .025, '#ceb57e', x, 1.43, z);
        const rotor = new T.Group(); rotor.position.set(x, 1.42, z); g.add(rotor);
        for (const angle of [0, Math.PI / 2]) { const blade = this.rounded(rotor, .65, .025, .065, this.mat('#34473c', .8), 0, 0, 0, .008); blade.rotation.y = angle; }
        g.userData.rotors.push(rotor);
      }
      for (const x of [-.24, 0, .24]) for (const y of [.53, .76]) {
        const stick = this.cylinder(g, .105, .105, .75, this.mat('#bf4938', .18, .78), x, y, -.015, 24); stick.rotation.x = Math.PI / 2;
        const cap = this.cylinder(g, .082, .082, .025, this.mat('#eac391'), x, y, -.405, 20); cap.rotation.x = Math.PI / 2;
      }
      for (const z of [-.2, .2]) this.rounded(g, .79, .46, .08, this.mat('#384238', .5), 0, .65, z, .025);
      const fuse = new T.QuadraticBezierCurve3(new T.Vector3(0, .76, -.42), new T.Vector3(.43, .85, -.65), new T.Vector3(.42, 1.1, -.35));
      this.mesh(g, new T.TubeGeometry(fuse, 12, .018, 8, false), this.mat('#d5b788'));
      const beacon = this.mesh(g, new T.SphereGeometry(.065, 16, 12), this.glow('#ff8048').clone(), .42, 1.1, -.35);
      g.userData.beacon = beacon;
      this.rounded(g, .38, .04, .48, this.mat('#d5b078'), 0, 1.35, .06, .015);
    } else {
      const size = data.kind === 'sentry' ? .72 : .52;
      this.mesh(g, new T.SphereGeometry(size, 28, 20), metal, 0, 1.1);
      g.userData.eye = this.mesh(g, new T.SphereGeometry(.15, 20, 16), light.clone(), 0, 1.16, -size);
      this.mesh(g, new T.TorusGeometry(.21, .045, 12, 32), this.mat('#aeb8a9', .8), 0, 1.16, -size);
      for (const side of [-1, 1]) {
        const wing = this.rounded(g, .8, .15, .42, this.mat('#a1ad96', .6), side * .7, 1.2, 0, .06); wing.rotation.z = side * .2;
        this.cylinder(g, .22, .16, .35, this.mat('#6b8775', .7), side * .95, 1, .07, 24);
        this.ring(g, .23, .04, '#ebaa72', side * .95, .85, .07);
        for (let i = 0; i < 4; i++) this.box(g, .035, .045, .25, metal, side * .7 + (i - 1.5) * .08, 1.3, .03);
      }
      if (data.kind === 'sentry') {
        const barrel = this.cylinder(g, .07, .1, .6, this.mat('#a4b7a6', .8), .3, .95, -.75, 24); barrel.rotation.x = Math.PI / 2;
        this.ring(g, .7, .045, '#94bbc5', 0, 1.1);
      }
    }
    enemyDetails(this, g, data);
    for (const rotor of [...(g.userData.rotors ?? []), ...(g.userData.fans ?? [])]) batchModel(rotor);
    return batchModel(g, [g.userData.spin, g.userData.shield, g.userData.eye, g.userData.beacon, g.userData.coreRotor, ...(g.userData.rotors ?? []), ...(g.userData.fans ?? [])]);
  }
  tag(g, label, color, y = 2.5) {
    const m = this.text(label, color, 512, 40); const sprite = new T.Sprite(new T.SpriteMaterial({ map: m.map, transparent: true, depthTest: true })); m.dispose(); sprite.position.set(0, y, 0); sprite.scale.set(3.5, .875, 1); g.add(sprite); return sprite;
  }
  bomberIndicators(g) {
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(24 * 9), 3));
    const vision = new T.Mesh(geometry, new T.MeshBasicMaterial({ color: '#eac273', transparent: true, opacity: .16, depthWrite: false, side: T.DoubleSide }));
    vision.frustumCulled = false; this.scene.add(vision); g.userData.vision = vision;
    const impact = new T.Mesh(new T.RingGeometry(BOMBER.blastRadius - .07, BOMBER.blastRadius, 64), new T.MeshBasicMaterial({ color: '#ff7351', transparent: true, opacity: .7, depthWrite: false, side: T.DoubleSide }));
    impact.rotation.x = -Math.PI / 2; this.scene.add(impact); g.userData.impact = impact; g.userData.visionTime = -1;
  }
  updateVision(g, d) {
    const { vision, impact } = g.userData;
    vision.visible = d.behavior === 'patrol' || d.behavior === 'arming';
    impact.visible = !!d.aim && ['arming', 'diving'].includes(d.behavior);
    if (impact.visible) { impact.position.set(d.aim.x, .11, d.aim.z); impact.material.opacity = .5 + Math.sin(this.clock * 18) * .2; }
    if (!vision.visible) return;
    vision.position.set(g.position.x, .065, g.position.z);
    vision.material.color.set(d.behavior === 'arming' ? '#f56f45' : '#eac273');
    vision.material.opacity = d.behavior === 'arming' ? .24 : .13;
    if (this.clock - g.userData.visionTime < .12) return;
    g.userData.visionTime = this.clock;
    const rays = [], origin = new T.Vector3(g.position.x, .8, g.position.z);
    for (let i = 0; i <= 24; i++) {
      const angle = d.yaw - BOMBER.sightAngle / 2 + i / 24 * BOMBER.sightAngle;
      const direction = new T.Vector3(Math.sin(angle), 0, -Math.cos(angle));
      const ray = new T.Raycaster(origin, direction, .02, BOMBER.sightRange);
      const hit = ray.intersectObjects(this.solids, false)[0];
      let length = hit ? Math.max(0, hit.distance - .05) : BOMBER.sightRange;
      for (let r = .3; r <= length; r += .3) if (safeAt(origin.x + direction.x * r, origin.z + direction.z * r)) { length = r; break; }
      rays.push([direction.x * length, direction.z * length]);
    }
    const positions = vision.geometry.attributes.position;
    for (let i = 0; i < 24; i++) { positions.setXYZ(i * 3, 0, 0, 0); positions.setXYZ(i * 3 + 1, rays[i][0], 0, rays[i][1]); positions.setXYZ(i * 3 + 2, rays[i + 1][0], 0, rays[i + 1][1]); }
    positions.needsUpdate = true;
  }
  blast(e) {
    const group = new T.Group(); group.position.set(e.x, .15, e.z); group.userData.blast = true;
    const core = this.mesh(group, new T.IcosahedronGeometry(.7, 2), new T.MeshBasicMaterial({ color: '#ffe8b4', transparent: true, opacity: .9, depthWrite: false }), 0, .65, 0);
    core.userData.core = true;
    const wave = this.mesh(group, new T.RingGeometry(.84, 1, 64), new T.MeshBasicMaterial({ color: '#ffae63', transparent: true, opacity: .7, side: T.DoubleSide, depthWrite: false }));
    wave.rotation.x = -Math.PI / 2; wave.userData.wave = true;
    for (let i = 0; i < 16; i++) {
      const smoke = i < 6, angle = i * 2.39996;
      const particle = this.mesh(group, smoke ? new T.IcosahedronGeometry(.4, 1) : new T.TetrahedronGeometry(.09), new T.MeshBasicMaterial({ color: smoke ? '#4a4943' : '#ffaf60', transparent: true, opacity: .7, depthWrite: false }));
      particle.userData.velocity = new T.Vector3(Math.cos(angle) * (smoke ? 2 : 4), smoke ? 1.2 + i * .17 : 1 + i % 4, Math.sin(angle) * (smoke ? 2 : 4));
      particle.userData.smoke = smoke;
    }
    return group;
  }
  gunEffect(e) {
    const group = new T.Group(); group.position.set(e.x, e.y ?? 1.1, e.z); group.userData.gunEffect = e.kind;
    const color = e.enemy ? '#ff794f' : '#ffe5a2';
    const core = this.mesh(group, new T.OctahedronGeometry(e.kind === 'gunshot' ? .22 : .1, 1), new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    if (e.kind === 'gunshot') { core.scale.set(.65, .65, 1.8); group.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(e.dx, e.dy, e.dz).normalize()); }
    else for (let i = 0; i < 5; i++) {
      const spark = this.mesh(group, new T.TetrahedronGeometry(.045), new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
      spark.userData.velocity = new T.Vector3(Math.cos(i * 2.4), .3 + i * .15, Math.sin(i * 2.4));
    }
    return group;
  }
  getAim() {
    if (!this.state) return null;
    this.camera.updateMatrixWorld(true);
    const raycaster = new T.Raycaster(); raycaster.far = 150; raycaster.setFromCamera(new T.Vector2(0, 0), this.camera);
    const ray = raycaster.ray, origin = ray.origin;
    let point = ray.at(150, new T.Vector3()), distance = 150;
    const take = hit => { if (hit && origin.distanceTo(hit) < distance) { point = hit.clone(); distance = origin.distanceTo(hit); } };
    take(raycaster.intersectObjects(this.solids, false)[0]?.point);
    take(ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3()));
    for (const g of this.entities.values()) {
      const actor = g.userData.data;
      if (actor.id === this.state.self.id || actor.hp <= 0) continue;
      const shape = hitShape(actor), center = new T.Vector3(g.position.x, shape.y + (actor.kind === 'player' ? g.position.y : 0), g.position.z);
      const hit = shape.box ? ray.intersectBox(new T.Box3(center.clone().sub(new T.Vector3(...shape.box)), center.clone().add(new T.Vector3(...shape.box))), new T.Vector3()) : ray.intersectSphere(new T.Sphere(center, shape.radius), new T.Vector3());
      take(hit);
    }
    return { x: point.x, y: point.y, z: point.z };
  }
  dispose(g) {
    if (g.userData.vision) this.dispose(g.userData.vision);
    if (g.userData.impact) this.dispose(g.userData.impact);
    g.removeFromParent(); g.traverse(o => { o.geometry?.dispose(); if (o.material && !Object.values(this.materials).includes(o.material)) { o.material.map?.dispose(); o.material.dispose(); } });
  }
  update(state) {
    this.state = state; this.netReceived = performance.now(); this.preview.visible = false;
    const self = state.self; this.localPrediction ??= new LocalPrediction();
    this.localPrediction.update({ id: self.id, x: self.x, y: self.y ?? 0, z: self.z, yaw: self.yaw, pitch: self.pitch, time: Number.isFinite(state.time) ? state.time : performance.now() / 1000, transition: `${self.dead > 0}:${self.climbing ?? ''}:${self.admin?.enabled ? 'admin' : 'normal'}` });
    if (this.viewModel?.userData.type !== state.self.weaponType || this.viewModel?.userData.role !== state.self.role) {
      if (this.viewModel) this.dispose(this.viewModel);
      this.viewModel = this.firstPersonModel(state.self.weaponType, state.self.role); this.viewScene.add(this.viewModel);
    }
    const bullets = (state.projectiles ?? []).filter(p => Math.hypot(p.x - state.self.x, p.z - state.self.z) < 110);
    const bulletIds = new Set(bullets.map(p => p.id));
    for (const [id, mesh] of this.bullets) if (!bulletIds.has(id)) { this.dispose(mesh); this.bullets.delete(id); }
    for (const p of bullets) {
      let mesh = this.bullets.get(p.id);
      if (!mesh) {
        mesh = projectileModel(this, p.enemy);
        this.scene.add(mesh); this.bullets.set(p.id, mesh);
      }
      mesh.userData.data = p; mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(p.vx, p.vy, p.vz).normalize());
    }
    const detailed = new Set([...state.players].sort((a, b) => Math.hypot(a.x - state.self.x, a.z - state.self.z) - Math.hypot(b.x - state.self.x, b.z - state.self.z)).slice(0, 16).map(p => p.id)); detailed.add(state.self.id);
    const closeEnemies = new Set(state.enemies.filter(e => e.hp > 0 && e.kind !== 'boss' && Math.hypot(e.x - state.self.x, e.z - state.self.z) < 45).sort((a, b) => Math.hypot(a.x - state.self.x, a.z - state.self.z) - Math.hypot(b.x - state.self.x, b.z - state.self.z)).slice(0, 12).map(e => e.id));
    const objects = [...state.players.map(p => ({ ...p, kind: 'player', low: !detailed.has(p.id) || p.id !== state.self.id && Math.hypot(p.x - state.self.x, p.z - state.self.z) > 35 })), ...state.enemies.filter(e => e.hp > 0).map(e => ({ ...e, low: e.kind !== 'boss' && !closeEnemies.has(e.id) }))].filter(o => Math.hypot(o.x - state.self.x, o.z - state.self.z) < 128);
    this.motion ??= new MotionBuffer(); this.motion.update(state.time, objects, this.netReceived);
    const ids = new Set(objects.map(o => o.id));
    for (const [id, g] of this.entities) if (!ids.has(id)) { this.dispose(g); this.entities.delete(id); }
    for (const o of objects) {
      let g = this.entities.get(o.id);
      if (g && (!!g.userData.low !== !!o.low || o.kind === 'player' && g.userData.data?.role !== o.role)) { this.dispose(g); this.entities.delete(o.id); g = null; }
      if (!g) {
        g = o.kind === 'player' ? this.avatar(o.role, o.weapon, o.low) : this.enemy(o); g.position.set(o.x, o.y ?? 0, o.z); this.scene.add(g); this.entities.set(o.id, g);
        if (o.kind === 'bomber') { g.position.y = o.altitude; this.bomberIndicators(g); }
        if (o.id !== state.self.id && !o.low) this.tag(g, o.kind === 'player' ? o.name : o.kind === 'boss' ? BOSSES.find(b => b.id === o.bossId).name : o.kind === 'bomber' ? `ПОДРЫВНИК / LV ${o.level}` : `LV ${o.level}`, o.kind === 'player' ? o.party ? '#8cf4bf' : '#f0c897' : '#f3b592', o.kind === 'boss' ? 4.7 : 2.4);
        if (o.id !== state.self.id && !o.low) {
          const root = new T.Group(); root.position.y = o.kind === 'boss' ? 4.2 : 2.12; g.add(root);
          this.mesh(root, new T.PlaneGeometry(1.4, .06), new T.MeshBasicMaterial({ color: '#13271c' }));
          const fill = this.mesh(root, new T.PlaneGeometry(1.4, .06), new T.MeshBasicMaterial({ color: o.kind === 'player' && o.party ? '#9de2b7' : '#e6a080' }), 0, 0, .01);
          g.userData.bar = { root, fill };
        }
      }
      g.userData.data = o; g.visible = o.id !== state.self.id; if (g.userData.shield) g.userData.shield.visible = o.shield;
      if (o.kind === 'player' && !o.low && g.userData.weaponType !== o.weapon) { this.dispose(g.userData.weapon); const weapon = this.weaponModel(o.weapon); weapon.position.set(.39, 1.04, -.23); g.add(weapon); g.userData.weapon = weapon; g.userData.weaponType = o.weapon; }
    }
    const hazardIds = new Set(state.hazards.map(h => h.id));
    for (const [id, mesh] of this.hazards) if (!hazardIds.has(id)) { this.dispose(mesh); this.hazards.delete(id); }
    for (const h of state.hazards) {
      let mesh = this.hazards.get(h.id);
      if (!mesh) { mesh = new T.Mesh(new T.RingGeometry(h.inner || .01, h.radius, 80), new T.MeshBasicMaterial({ color: '#ec5932', transparent: true, opacity: .38, depthWrite: false, side: T.DoubleSide })); mesh.rotation.x = -Math.PI / 2; mesh.position.set(h.x, .18, h.z); this.scene.add(mesh); this.hazards.set(h.id, mesh); }
      mesh.userData.progress = 1 - h.delay / h.duration;
    }
    const lootIds = new Set(state.loot.map(l => l.id));
    for (const [id, mesh] of this.drops) if (!lootIds.has(id)) { this.dispose(mesh); this.drops.delete(id); }
    for (const l of state.loot) if (!this.drops.has(l.id)) {
      const g = new T.Group(); g.position.set(l.x, 0, l.z); const color = RARITY[ITEMS[l.item.type].rarity];
      supplyCrate(this, g, color); this.box(g, .04, 1.5, .04, this.glow(color), 0, 1); this.ring(g, .55, .018, color); batchModel(g); this.scene.add(g); this.drops.set(l.id, g);
    }
    for (const e of state.effects) if (!this.seen.has(e.id)) {
      this.seen.add(e.id); let object;
      if (e.kind === 'gunshot') { const actor = this.entities.get(e.actor); if (actor) actor.userData.recoil = 1; if (e.actor === state.self.id) this.viewRecoil = 1; }
      if (e.kind === 'bomber-blast') object = this.blast(e);
      else if (e.kind === 'gunshot' || e.kind === 'bullet-impact') object = this.gunEffect(e);
      else if (e.kind === 'gun-charge') { object = new T.Mesh(new T.SphereGeometry(.2, 12, 10), new T.MeshBasicMaterial({ color: '#ff673e', transparent: true, opacity: .7 })); object.position.set(e.x, e.y, e.z); }
      else { object = new T.Mesh(new T.RingGeometry(e.inner || .01, e.radius || .8, 48), new T.MeshBasicMaterial({ color: ['heal', 'ward'].includes(e.kind) ? '#79ddb0' : '#f3a572', transparent: true, opacity: .6, depthWrite: false, side: T.DoubleSide })); object.rotation.x = -Math.PI / 2; object.position.set(e.x, .2, e.z); }
      object.userData.life = e.ttl; object.userData.total = e.ttl; this.scene.add(object); this.effects.set(e.id, object);
    }
    if (this.seen.size > 1800) this.seen = new Set(state.effects.map(e => e.id));
  }
  clear() { for (const map of [this.entities, this.hazards, this.effects, this.drops, this.bullets]) { for (const g of map.values()) this.dispose(g); map.clear(); } this.seen.clear(); this.motion?.clear(); this.localPrediction.clear(); this.state = null; this.preview.visible = true; }
  resize() { this.renderer.setSize(innerWidth, innerHeight); this.composer?.setSize(innerWidth, innerHeight); this.film?.uniforms.resolution.value.set(innerWidth, innerHeight); for (const camera of [this.camera, this.viewCamera]) if (camera) { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); } }
  predictLocal(pose, input, dt) {
    const self = this.state?.self;
    if (!self || input.blocked || self.hp <= 0) return;
    if (self.admin?.enabled) {
      const speed = input.sprint ? 36 : 14, length = Math.max(1, Math.hypot(input.x ?? 0, input.z ?? 0, input.lift ?? 0));
      pose.x += (input.x ?? 0) / length * speed * dt; pose.z += (input.z ?? 0) / length * speed * dt; pose.y = Math.max(.1, pose.y + (input.lift ?? 0) / length * speed * dt);
      pose.x = Math.max(-WORLD.x + 1, Math.min(WORLD.x - 1, pose.x)); pose.z = Math.max(-WORLD.z + 1, Math.min(WORLD.z - 1, pose.z)); return;
    }
    if (self.climbing) {
      const ladder = LADDERS.find(l => l.id === self.climbing);
      if (ladder) { pose.x = ladder.x; pose.z = ladder.z; pose.y = Math.max(0, Math.min(ladder.top + .03, pose.y + (input.climb ?? 0) * MOVEMENT.climbSpeed * dt)); }
      return;
    }
    const spec = ROLES[self.role], weapon = WEAPONS[self.weaponType] ?? WEAPONS.rifle, sprint = input.sprint && Math.hypot(input.x ?? 0, input.z ?? 0) > .01;
    const speed = spec.speed * weapon.move * (sprint ? 1.6 : 1), dx = (input.x ?? 0) * speed * dt, dz = (input.z ?? 0) * speed * dt, radius = .48;
    for (const [axis, amount] of [['x', dx], ['z', dz]]) {
      if (Math.abs(amount) < .00001) continue;
      pose[axis] += amount;
      for (const wall of WALLS) {
        // A roof is walkable once the player is above that building. Treating
        // every building as a 2D wall made local prediction fight the
        // authoritative server while moving across rooftops.
        if (Number.isFinite(wall.h) && pose.y >= wall.h + .05) continue;
        if (Math.abs(pose.x - wall.x) >= wall.w / 2 + radius || Math.abs(pose.z - wall.z) >= wall.d / 2 + radius) continue;
        pose[axis] = amount > 0 ? wall[axis] - wall[axis === 'x' ? 'w' : 'd'] / 2 - radius : wall[axis] + wall[axis === 'x' ? 'w' : 'd'] / 2 + radius;
      }
    }
  }
  render(dt, yaw = 0, pitch = CAMERA.pitch, roll = 0, fov = CAMERA.fov, localInput = {}) {
    this.clock += dt; this.yaw = yaw;
    this.motion?.advance(dt);
    const predictiveLocalInput = Number.isFinite(localInput.x) || Number.isFinite(localInput.z);
    const localPose = predictiveLocalInput ? this.localPrediction?.advance(dt, localInput, (pose, seconds, input) => this.predictLocal(pose, input, seconds)) : this.motion?.sample(this.state?.self?.id) ?? this.localPrediction?.sample();
    for (const bullet of this.bullets.values()) {
      const p = bullet.userData.data, elapsed = Math.min(p.life, Math.max(0, (this.state?.time ?? p.at) - (p.at ?? this.state?.time ?? 0)) + Math.min(.11, (performance.now() - this.netReceived) / 1000));
      const origin = new T.Vector3(p.x, p.y, p.z), delta = new T.Vector3(p.vx, p.vy, p.vz).multiplyScalar(elapsed);
      const wall = delta.lengthSq() > .0001 ? new T.Raycaster(origin, delta.clone().normalize(), 0, delta.length()).intersectObjects(this.solids, false)[0] : null;
      bullet.position.copy(wall ? wall.point : origin.add(delta)); bullet.position.y = Math.max(.03, bullet.position.y);
      bullet.visible = !safeAt(bullet.position.x, bullet.position.z);
    }
    for (const g of this.entities.values()) {
      const d = g.userData.data; const before = g.position.clone();
      const pose = d.id === this.state?.self?.id ? localPose : this.motion.sample(d.id);
      if (!pose) continue;
      g.position.set(pose.x, pose.y, pose.z); g.rotation.y = -pose.yaw;
      if (d.kind === 'player') {
        g.rotation.z = d.hp > 0 ? 0 : Math.PI / 2;
        g.userData.legs.forEach((leg, i) => { leg.rotation.x = before.distanceTo(g.position) > .008 && d.hp > 0 ? Math.sin(this.clock * (d.climbing ? 9 : d.sprinting ? 23 : 16) + i * Math.PI) * .5 : 0; });
        g.userData.ward.visible = d.ward > 0;
        g.userData.recoil = Math.max(0, (g.userData.recoil ?? 0) - dt * 12);
        g.userData.weapon.rotation.x = pose.pitch; g.userData.weapon.position.z = -.23 + g.userData.recoil * .12; g.userData.weapon.visible = !d.climbing;
      } else if (d.kind === 'bomber') {
        if (d.behavior !== 'diving') g.position.y += Math.sin(this.clock * 5 + pose.x) * .009;
        g.rotation.x = d.behavior === 'diving' ? -.65 : .035 * Math.sin(this.clock * 3);
        for (const [i, rotor] of g.userData.rotors.entries()) rotor.rotation.y += dt * (d.behavior === 'patrol' ? 65 : 125) * (i % 2 ? 1 : -1);
        g.userData.beacon.material.emissiveIntensity = d.behavior === 'patrol' ? .4 : 1 + Math.sin(this.clock * 28) * .8;
        this.updateVision(g, { ...d, yaw: pose.yaw });
      } else {
        g.position.y = .12 + Math.sin(this.clock * 2 + pose.x) * .12;
        if (g.userData.spin) g.userData.spin.rotation.z += dt * .4;
        if (g.userData.coreRotor) g.userData.coreRotor.rotation.z -= dt * .22;
        if (g.userData.eye) g.userData.eye.material.emissiveIntensity = d.charging ? 2.4 + Math.sin(this.clock * 24) * .8 : 1.1;
        for (const [i, fan] of (g.userData.fans ?? []).entries()) fan.rotation.y += dt * 42 * (i % 2 ? 1 : -1);
      }
      if (g.userData.bar) { const b = g.userData.bar; b.root.quaternion.copy(g.quaternion).invert().multiply(this.camera.quaternion); b.fill.scale.x = Math.max(0, d.hp / d.maxHp); b.fill.position.x = -.7 * (1 - d.hp / d.maxHp); }
    }
    for (const h of this.hazards.values()) h.material.opacity = .25 + h.userData.progress * .4 + Math.sin(this.clock * 15) * .06;
    for (const [id, e] of this.effects) {
      e.userData.life -= dt;
      const progress = 1 - Math.max(0, e.userData.life / e.userData.total);
      if (e.userData.blast) {
        for (const piece of e.children) {
          if (piece.userData.core) { piece.scale.setScalar(1 + progress * 4); piece.material.opacity = Math.max(0, 1 - progress * 4); }
          else if (piece.userData.wave) { piece.scale.setScalar(.5 + progress * BOMBER.blastRadius * 1.3); piece.material.opacity = .7 * (1 - progress); }
          else { piece.position.copy(piece.userData.velocity).multiplyScalar(progress); piece.position.y += piece.userData.smoke ? .5 : .5 - progress * progress * 2; piece.scale.setScalar(piece.userData.smoke ? .7 + progress * 3 : 1); piece.material.opacity = (piece.userData.smoke ? .35 : .9) * (1 - progress); }
        }
      } else if (e.userData.gunEffect) {
        for (const piece of e.children) {
          piece.material.opacity = Math.max(0, 1 - progress * (e.userData.gunEffect === 'gunshot' ? 4 : 1.2));
          if (piece.userData.velocity) piece.position.copy(piece.userData.velocity).multiplyScalar(progress * .8);
        }
      } else e.material.opacity = (1 - progress) * .7;
      if (e.userData.life <= 0) { this.dispose(e); this.effects.delete(id); }
    }
    const me = this.state?.self; const avatar = me ? this.entities.get(me.id) : this.preview;
    const p = avatar?.position ?? this.preview.position;
    const heading = me ? yaw : .1 + Math.sin(this.clock * .13) * .13;
    const elevation = me ? pitch : -.17;
    const forward = new T.Vector3(Math.sin(heading) * Math.cos(elevation), Math.sin(elevation), -Math.cos(heading) * Math.cos(elevation));
    const pivot = p.clone().add(new T.Vector3(0, me?.hp <= 0 ? .65 : CAMERA.eyeHeight, 0));
    if (me) this.cameraPosition.copy(pivot);
    else this.cameraPosition.lerp(pivot.clone().addScaledVector(forward, -6.4).add(new T.Vector3(-1.7, .3, 0)), Math.min(1, dt * 12));
    this.camera.position.copy(this.cameraPosition); this.camera.lookAt(pivot.clone().addScaledVector(forward, 22));
    if (me) this.camera.rotateZ(roll);
    const nextFov = me ? fov : CAMERA.fov;
    if (this.camera.fov !== nextFov) { this.camera.fov = nextFov; this.camera.updateProjectionMatrix(); }
    this.viewPass.enabled = !!me && me.hp > 0 && !me.climbing && (!me.admin?.enabled || me.admin.weapon && !me.admin.following);
    if (this.viewModel && me) {
      const walking = this.lastEye && p.distanceTo(this.lastEye) > .002 && me.grounded;
      const bob = walking ? Math.sin(this.clock * (me.sprinting ? 15 : 10)) * .008 : 0;
      const reload = me.reload > 0 ? Math.sin(Math.PI * (1 - me.reload / WEAPONS[me.weaponType].reload)) : 0;
      const turn = Math.atan2(Math.sin(yaw - (this.lastYaw ?? yaw)), Math.cos(yaw - (this.lastYaw ?? yaw)));
      this.viewSway.lerp(new T.Vector2(T.MathUtils.clamp(turn * 2, -.07, .07), T.MathUtils.clamp((pitch - (this.lastPitch ?? pitch)) * 2, -.05, .05)), Math.min(1, dt * 14));
      this.viewModel.position.set(.24 - this.viewSway.x, -.28 + bob - reload * .2 - (me.sprinting ? .08 : 0), -.42 + this.viewRecoil * .08);
      this.viewModel.rotation.set(this.viewRecoil * .08 - reload * .4, .12 + this.viewSway.x, -.06 - reload * .7 + this.viewSway.y);
      this.viewModel.userData.flash.material.opacity = Math.max(0, (this.viewRecoil - .65) * 2.5);
      this.viewModel.userData.flash.visible = this.viewRecoil > .65;
    }
    this.viewRecoil = Math.max(0, this.viewRecoil - dt * 12); this.lastEye = p.clone(); this.lastYaw = yaw; this.lastPitch = pitch;
    this.sun.position.set(p.x - 22, 35, p.z + 18); this.sun.target.position.set(p.x, 0, p.z);
    this.rain.position.set(p.x, -(this.clock * 5 % 16), p.z);
    this.film.uniforms.time.value = this.clock; this.composer.render(dt);
  }
}
