import * as T from 'three';
import { SHOTGUN_RACK, RAT_VENT } from '../shared/catalog.mjs';

export class IncidentView {
  constructor(view) {
    this.v = view; this.effects = new T.Group(); view.scene.add(this.effects); this.tracers = []; this.breaks = []; this.shotTime = -10; this.ratMotion = null;
    this.rat = this.ratModel(); this.rat.visible = false; view.scene.add(this.rat);
    const rack = new T.Group(); rack.position.set(SHOTGUN_RACK.x, SHOTGUN_RACK.y, SHOTGUN_RACK.z - .12); view.scene.add(rack);
    view.box(rack, 2.2, .8, .07, '#586568', 0, 0, .02);
    for (const x of [-.65, .6]) view.box(rack, .06, .17, .2, '#b2aaa0', x, -.19, -.06);
    view.label(rack, '12 GA / СЛУЖЕБНЫЙ', 0, -.61, -.08, 1.85, '#d1d4b3').rotation.y = Math.PI;
    this.wallGun = this.shotgun(); this.wallGun.rotation.y = Math.PI / 2; this.wallGun.scale.setScalar(1.65); rack.add(this.wallGun);
    const pick = view.box(rack, 1.9, .53, .33, new T.MeshBasicMaterial({ visible: false }), 0, 0, -.09);
    view.target(pick, { kind: 'shotgun', label: 'Дробовик / 12 GA' });
    this.held = this.shotgun(); this.held.position.set(.3, -.29, -.57); this.held.scale.setScalar(.75); this.held.visible = false;
    this.held.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } }); view.camera.add(this.held); view.scene.add(view.camera);
    this.flash = view.mesh(this.held, new T.ConeGeometry(.10, .30, 9), new T.MeshBasicMaterial({ color: '#ffe5a0', transparent: true, opacity: .9, depthWrite: false }), 0, .045, -.87); this.flash.rotation.x = -Math.PI / 2; this.flash.visible = false;
    this.light = new T.PointLight('#ffd2a1', 0, 7); this.held.add(this.light); this.light.position.set(0, .05, -.8);
    const vent = new T.Group(); vent.position.set(RAT_VENT.x + 1.25, .47, RAT_VENT.z); view.scene.add(vent);
    view.box(vent, .06, .8, 1.15, '#3e4f4b'); for (let y = -.3; y < .36; y += .1) view.box(vent, .10, .035, 1.0, '#929f97', -.025, y);
  }
  shotgun() {
    const v = this.v, g = new T.Group();
    v.box(g, .11, .13, .31, '#374348', 0, .015, -.05);
    const barrel = v.cylinder(g, .035, .64, '#7a878d', 0, .057, -.46, 32); barrel.rotation.x = Math.PI / 2;
    const magazine = v.cylinder(g, .029, .48, '#323a40', 0, -.025, -.38, 24); magazine.rotation.x = Math.PI / 2;
    v.box(g, .11, .1, .22, '#ab725a', 0, -.029, -.34);
    for (let i = 0; i < 7; i++) v.box(g, .116, .017, .013, '#584e48', 0, .021, -.43 + i * .031);
    const stock = v.box(g, .105, .19, .39, '#9c6558', 0, -.057, .27); stock.rotation.x = -.14;
    v.box(g, .115, .20, .035, '#283338', 0, -.084, .46);
    const guard = v.mesh(g, new T.TorusGeometry(.057, .009, 8, 24), v.material('#87938a'), 0, -.1, .04); guard.rotation.y = Math.PI / 2;
    v.box(g, .015, .057, .02, '#b4bbb4', 0, -.086, .025);
    v.box(g, .018, .035, .035, '#d4c8a9', 0, .10, -.72);
    for (const z of [-.15, .07]) v.cylinder(g, .015, .125, '#aab6af', 0, .045, z, 16).rotation.z = Math.PI / 2;
    const bore = v.mesh(g, new T.CircleGeometry(.027, 24), new T.MeshBasicMaterial({ color: '#111817', side: T.DoubleSide }), 0, .057, -.783); bore.rotation.y = Math.PI;
    return g;
  }
  ratModel() {
    const v = this.v, g = new T.Group(); this.legs = []; this.tail = [];
    const ellipsoid = (parent, color, position, scale) => { const mesh = v.mesh(parent, new T.SphereGeometry(1, 28, 18), v.material(color, .05, .9), ...position); mesh.scale.set(...scale); return mesh; };
    ellipsoid(g, '#9b9c8c', [0, .28, 0], [.25, .24, .43]); ellipsoid(g, '#b6b2a0', [0, .25, .35], [.18, .16, .24]);
    ellipsoid(g, '#b7ad9e', [0, .19, .53], [.105, .085, .15]); ellipsoid(g, '#c88988', [0, .20, .66], [.045, .033, .03]);
    for (const sign of [-1, 1]) {
      ellipsoid(g, '#ada592', [sign * .155, .44, .29], [.09, .125, .055]); ellipsoid(g, '#d4a3a0', [sign * .157, .45, .324], [.061, .081, .025]);
      ellipsoid(g, '#171d1c', [sign * .146, .32, .46], [.029, .033, .035]); ellipsoid(g, '#e5dfc5', [sign * .15, .33, .477], [.009, .01, .012]);
      for (const z of [-.24, .28]) { const leg = new T.Group(); leg.position.set(sign * .18, .14, z); g.add(leg); ellipsoid(leg, '#8e9587', [0, -.025, 0], [.065, .11, .07]); ellipsoid(leg, '#b78f80', [.012 * sign, -.10, .05], [.063, .029, .11]); this.legs.push(leg); }
      for (let i = 0; i < 3; i++) { const geometry = new T.BufferGeometry().setFromPoints([new T.Vector3(sign * .07, .20, .57), new T.Vector3(sign * .30, .21 + i * .025, .48 + i * .08)]); g.add(new T.Line(geometry, new T.LineBasicMaterial({ color: '#d6d9c3' }))); }
    }
    let parent = g;
    for (let i = 0; i < 7; i++) { const joint = new T.Group(); joint.position.set(0, i ? 0 : .16, i ? -.13 : -.37); parent.add(joint); const segment = v.mesh(joint, new T.CylinderGeometry(.029 - i * .0033, .024 - i * .0033, .145, 12), v.material('#b29185', .05, .9), 0, 0, -.065); segment.rotation.x = Math.PI / 2; this.tail.push(joint); parent = joint; }
    return g;
  }
  update(state) {
    const previous = this.state?.rat, next = state.rat, changed = previous?.id !== next?.id; this.state = state; this.wallGun.visible = !state.shotgun;
    if (!next) { this.ratMotion = null; return; }
    const receivedAt = performance.now(), old = this.ratMotion;
    let velocity = { x: 0, z: 0 };
    if (old && old.id === next.id && receivedAt > old.receivedAt + 1 && ['running', 'fleeing'].includes(next.state)) {
      const seconds = (receivedAt - old.receivedAt) / 1000, factor = Math.min(1, .8 / seconds);
      velocity = { x: (next.x - old.x) / seconds * factor, z: (next.z - old.z) / seconds * factor };
    }
    this.ratMotion = { id: next.id, x: next.x, z: next.z, state: next.state, receivedAt, velocity };
    if (changed) this.rat.position.set(next.x, 0, next.z);
  }
  updateBreaks(lab) {
    for (const b of this.breaks) this.v.dispose(b.group); this.breaks = [];
    for (const cable of lab.cables.filter(c => c.damage && c.plugs.every(Boolean))) {
      const group = new T.Group(); group.position.set(...cable.damage.point); this.effects.add(group);
      const arc = new T.Line(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(new Float32Array(27), 3)), new T.LineBasicMaterial({ color: '#bce7ff', transparent: true, opacity: .9, depthTest: true })); group.add(arc);
      const positions = new Float32Array(60), sparks = new T.Points(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3)), new T.PointsMaterial({ color: '#ffd58a', size: .045, transparent: true, depthWrite: false })); group.add(sparks);
      const light = new T.PointLight('#90cfff', 1, 2.2); light.position.y = .2; group.add(light);
      this.breaks.push({ group, arc, sparks, light, seed: Math.random() * 20 });
    }
  }
  fire(direction, hit) {
    const v = this.v; this.shotTime = v.clock;
    const origin = v.camera.position.clone(), points = [];
    for (let i = 0; i < 9; i++) {
      const aim = new T.Vector3(...direction).add(new T.Vector3((Math.random() - .5) * .065, (Math.random() - .5) * .065, (Math.random() - .5) * .065)).normalize();
      points.push(origin.clone().addScaledVector(aim, .8), origin.clone().addScaledVector(aim, 12));
    }
    const mesh = new T.LineSegments(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: hit ? '#ffd4a0' : '#e9cd89', transparent: true, opacity: .8 })); this.effects.add(mesh); this.tracers.push({ mesh, born: v.clock });
  }
  render(dt) {
    const v = this.v, time = v.clock, r = this.state?.rat, shot = time - this.shotTime;
    this.held.visible = !!this.state?.shotgun && v.tool === 'shotgun' && v.mode === 'world' && !v.blocked;
    this.held.position.z = -.57 + (shot < .3 ? Math.exp(-shot * 13) * .14 : 0); this.held.rotation.x = shot < .3 ? Math.exp(-shot * 13) * .12 : 0;
    if (this.state?.reload > 0) this.held.rotation.z = -.55 + Math.sin(time * 7) * .03; else this.held.rotation.z = 0;
    this.flash.visible = shot < .075; this.light.intensity = shot < .075 && this.held.visible ? 10 : 0;
    this.rat.visible = !!r;
    if (r) {
      const motion = this.ratMotion, age = motion ? Math.min(.8, Math.max(0, (performance.now() - motion.receivedAt) / 1000)) : 0;
      const target = motion ? new T.Vector3(motion.x + motion.velocity.x * age, r.state === 'dead' ? -.08 : 0, motion.z + motion.velocity.z * age) : new T.Vector3(r.x, r.state === 'dead' ? -.08 : 0, r.z);
      this.rat.position.lerp(target, Math.min(1, dt * 16)); this.rat.rotation.y = r.yaw; this.rat.rotation.z = r.state === 'dead' ? 1.3 : 0;
      const moving = ['running', 'fleeing'].includes(r.state);
      this.legs.forEach((leg, i) => { leg.rotation.x = moving ? Math.sin(time * 22 + i * Math.PI / 2) * .6 : 0; });
      this.tail.forEach((joint, i) => { joint.rotation.y = r.state === 'dead' ? .12 : Math.sin(time * 5 - i * .6) * .22; });
      if (r.state === 'chewing') this.rat.position.y += Math.sin(time * 25) * .018;
    }
    for (const effect of this.tracers.slice()) { const age = time - effect.born; effect.mesh.material.opacity = Math.max(0, 1 - age / .13); if (age > .13) { v.dispose(effect.mesh); this.tracers.splice(this.tracers.indexOf(effect), 1); } }
    for (const b of this.breaks) {
      const active = Math.sin(time * 19 + b.seed) > -.3; b.arc.visible = active; b.light.intensity = active ? 2 + Math.random() : .1;
      const arc = b.arc.geometry.attributes.position;
      for (let i = 0; i < 9; i++) arc.setXYZ(i, (i / 8 - .5) * .34, i === 0 || i === 8 ? .015 : .05 + Math.random() * .19, (Math.random() - .5) * .14);
      arc.needsUpdate = true;
      const p = b.sparks.geometry.attributes.position;
      for (let i = 0; i < 20; i++) { const t = (time * 1.7 + i / 20 + b.seed) % 1, angle = i * 2.4; p.setXYZ(i, Math.cos(angle) * t * .48, Math.max(-.10, t * 1.1 - t * t * 1.2), Math.sin(angle) * t * .48); } p.needsUpdate = true;
    }
  }
}
