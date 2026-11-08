import * as T from 'three';
import { COLORS } from '../shared/catalog.mjs';
import { BENCH_TOOLS, TRIM_LENGTH_MM } from '../shared/workshop.mjs';
import { ToolModels, squeezeTool } from './tool-models.mjs';
export { BENCH_TOOLS } from '../shared/workshop.mjs';

const clamp = T.MathUtils.clamp;
export class CableBench {
  constructor(view) { this.v = view; this.models = new ToolModels(view); this.length = 25; this.depth = 1; this.measurement = 'CAT6 / READY'; }
  label(g, text, x, z, width = .6, color = '#d1ddd8', y = .035) { const m = this.v.label(g, text, x, y, z, width, color); m.rotation.x = -Math.PI / 2; return m; }
  target(mesh, data) { return this.v.target(mesh, data, this.v.workTargets); }
  begin(kind, p, tool) { this.v.interact({ kind: 'gesture', phase: 'begin', gesture: kind, point: { x: p.x, z: p.z }, tool }); }
  sample(p) { if (performance.now() - (this.sampleAt ?? 0) > 100) { this.sampleAt = performance.now(); this.v.interact({ kind: 'gesture', phase: 'sample', point: { x: p.x, z: p.z } }); } }
  tool(id, x, z, label) {
    const v = this.v, g = new T.Group(); g.position.set(x, .05, z); v.workRoot.add(g); this.tools[id] = g;
    this.models.build(g, id, { label }, this.depth);
    this.label(v.workRoot, label, x, id === 'console' ? z - .05 : Math.min(z + .43, 1.45), id === 'console' ? .32 : .60, '#c2d2ca');
  }
  build(lab) {
    const v = this.v, g = v.workRoot, d = lab.draft, e = d?.ends[v.end]; this.tools = {}; this.mounted = null; this.guide = null;
    v.box(g, 5.25, .02, 3.04, '#637f7e', 0, -.025, 0);
    v.box(g, 2.37, .014, 2.05, '#285b50', 0, -.004, -.15);
    for (let x = -1.1; x <= 1.11; x += .1) v.box(g, .004, .003, 1.96, '#43756a', x, .006, -.15);
    for (let z = -1.1; z <= .85; z += .1) v.box(g, 2.27, .003, .004, '#43756a', 0, .006, z);
    for (const [id, [x, z, name]] of Object.entries(BENCH_TOOLS)) this.tool(id, x, z, name);
    this.label(g, 'CAT6 / 23AWG / UTP', 0, -1.37, 1.8);
    const spool = new T.Group(); spool.position.set(-1.37, .2, -.78); g.add(spool);
    v.cylinder(spool, .24, .26, '#72acb5'); for (const y of [-.15, .15]) v.cylinder(spool, .3, .035, '#c2c7b1', 0, y);
    for (let i = 0; i < 6; i++) { const ring = v.mesh(spool, new T.TorusGeometry(.25, .015, 8, 36), v.material('#4a99a8'), 0, -.1 + i * .04); ring.rotation.x = Math.PI / 2; }
    this.target(v.box(g, .6, .08, .4, '#456259', .24, .04, 1.14), { kind: 'bench-stow', label: 'Готовые патч-корды' });
    this.label(g, 'ГОТОВО', .24, 1.14, .47, '#cbe6bc', .09);
    this.target(v.box(g, .36, .16, .44, '#783f42', 2.35, .08, .96), { kind: 'bench-bin', label: 'Обрезки / утилизация' });
    this.label(g, 'X', 2.35, .96, .17, '#f3bdb3', .18);
    this.label(g, this.measurement, 1.88, -1.38, 1.35, '#d6e8bc');
    // A small laminated wiring reference stays on the work surface.
    for (const [i, color] of COLORS.entries()) {
      const x = -.63 + i * .18;
      v.box(g, .12, .008, .09, color.stripe ? '#e0e6d5' : color.color, x, .013, -1.15);
      if (color.stripe) v.box(g, .03, .005, .09, color.color, x, .02, -1.15);
    }
    if (!d) {
      v.box(g, 2.13, .025, .27, '#ccd0bd', 0, .035, .05);
      for (let i = 0; i <= 40; i++) {
        const x = -.95 + i * .0475; v.box(g, .008, .008, i % 5 ? .04 : .1, '#2d4b45', x, .053, .1);
        if (!(i % 5)) this.label(g, String(i), x, .035, .12, '#294a43', .052);
      }
      const x = -.95 + this.length * .0475;
      v.cable(g, [[-1.37, .1, -.55], [-1.0, .10, -.16], [x, .10, -.16]], '#6fbfca', .048);
      this.target(v.box(g, .18, .10, .16, '#e8bb6e', x, .1, -.16), { kind: 'bench-measure', label: `${this.length} м / бухта` });
      v.box(g, .016, .012, .40, '#e4ba71', x, .054, -.11);
      this.label(g, `${this.length} m`, 0, -.43, .55, '#f1db9c');
      return;
    }
    for (let end = 0; end < 2; end++) {
      const x = end ? .87 : -.87, color = end === v.end ? '#e3c077' : '#758f85';
      this.target(v.box(g, .35, .07, .26, color, x, .05, .69), { kind: 'bench-end', end, label: `Конец ${end ? 'B' : 'A'}` });
      this.label(g, `${end ? 'B' : 'A'}${d.ends[end].crimped ? ' / OK' : ''}`, x, .69, .31, '#223b35', .093);
    }
    this.target(v.cable(g, [[-.6, .11, .58], [-.35, .11, .55], [0, .11, .25]], '#70b9c3', .08), { kind: 'bench-jacket', label: 'Оболочка CAT6' });
    if (!e.stripped) this.target(v.box(g, .16, .14, .40, '#70b9c3', 0, .10, .1), { kind: 'bench-jacket', label: 'Оболочка CAT6' });
    // Pin guides are not a connector. The loose RJ45 must be fitted after trimming.
    for (let pin = 0; pin < 8; pin++) {
      const x = (pin - 3.5) * .18;
      this.target(v.box(g, .14, .022, .24, e.inserted ? '#cea85c' : '#a3b9a0', x, .025, -.72), { kind: 'pin', pin, label: `Контакт ${pin + 1}` });
      this.label(g, String(pin + 1), x, -.96, .13);
    }
    this.label(g, `${TRIM_LENGTH_MM} mm`, .92, -.69, .35, '#d7e5d3');
    if (e.stripped) for (const [i, wire] of (e.exposed ?? COLORS.map(c => c.id)).entries()) {
      const color = COLORS.find(c => c.id === wire);
      const assigned = e.order.indexOf(color.id), x = ((assigned >= 0 ? assigned : i) - 3.5) * .18;
      const z = assigned >= 0 ? -.72 : -.18 - (i % 2) * .06;
      const points = [[(i - 3.5) * .012, .10, .26], [(i - 3.5) * .075, .13, .05], [x, .14, z + .12], [x, .14, z]];
      const data = { kind: 'wire', wire: color.id, label: color.name };
      this.target(v.cable(g, points, color.stripe ? '#e4e5d3' : color.color, .026), data);
      if (color.stripe) v.cable(g, points.map(p => [p[0], p[1] + .023, p[2]]), color.color, .012);
      this.target(v.box(g, .11, .055, .09, color.stripe ? '#eceddc' : color.color, x, .15, z), data);
      if (color.stripe) v.box(g, .027, .008, .092, color.color, x, .182, z);
    }
    const connector = new T.Group(); connector.position.set(e.inserted ? 0 : -1.36, .08, e.inserted ? -.74 : .26); g.add(connector); this.connector = connector;
    const shell = v.box(connector, e.inserted ? 1.58 : .46, .15, .34, new T.MeshPhysicalMaterial({ color: '#dfebe7', transparent: true, opacity: .55, roughness: .18 }));
    if (!e.inserted) this.target(shell, { kind: 'bench-connector', label: 'Разъём RJ45' });
    for (let i = 0; i < 8; i++) v.box(connector, e.inserted ? .1 : .025, .018, .18, e.crimped ? '#d8b86e' : '#87968b', (i - 3.5) * (e.inserted ? .18 : .048), .09, -.03);
    this.label(g, `${d.length} m / ${v.end ? 'B' : 'A'}`, 0, .7, .65, '#cde5c8');
  }
  local(e) {
    this.v.pick(e);
    const plane = new T.Plane(new T.Vector3(0, 1, 0), -(this.v.workRoot.position.y + .15));
    const p = this.v.ray.ray.intersectPlane(plane, new T.Vector3()); return p ? this.v.workRoot.worldToLocal(p) : null;
  }
  down(target, e) {
    const v = this.v, p = this.local(e); if (!p) return false;
    if (target.kind === 'bench-end') { v.interact({ kind: 'bench-end', end: target.end }); return true; }
    if (target.kind === 'bench-bin') { v.interact({ kind: 'bench-action', type: 'discard' }); return true; }
    if (target.kind === 'bench-stow') { v.interact({ kind: 'bench-action', type: 'finish' }); return true; }
    if (target.kind === 'bench-depth') {
      this.drag = { kind: 'depth', start: p, depth: this.depth }; this.begin('depth', p, 'stripper'); return true;
    }
    if (target.kind === 'bench-measure') { this.drag = { kind: 'measure', start: p }; this.begin('measure', p, 'hand'); return true; }
    if (target.kind === 'bench-mounted') { this.drag = { kind: this.mounted, start: p, travel: 0 }; this.begin(this.mounted, p, this.mounted); return true; }
    if (target.kind === 'bench-tool' || target.kind === 'bench-connector') {
      const object = target.tool ? this.tools[target.tool] : this.connector;
      this.drag = { kind: target.tool ? 'tool' : 'connector', tool: target.tool, start: p, object, origin: object.position.clone() };
      this.begin(target.tool ? 'tool' : 'connector', p, target.tool ?? 'hand');
      const end = v.lab.draft?.ends[v.end];
      const z = target.kind === 'bench-connector' || target.tool === 'crimper' || target.tool === 'cutter' && end?.stripped && !end.inserted ? -.72 : .13;
      if (['cutter', 'stripper', 'crimper', 'tester', 'certifier'].includes(target.tool) || target.kind === 'bench-connector') {
        const x = !v.lab.draft && target.tool === 'cutter' ? -.95 + this.length * .0475 : 0;
        this.guide = v.mesh(v.workRoot, new T.RingGeometry(.19, .21, 48), new T.MeshBasicMaterial({ color: '#e7d098', side: T.DoubleSide, depthTest: false, transparent: true, opacity: .8 }), x, .17, !v.lab.draft ? -.16 : z);
        this.guide.rotation.x = -Math.PI / 2;
      }
      v.canvas.style.cursor = 'grabbing'; return true;
    }
    return false;
  }
  move(e) {
    if (!this.drag) return false;
    const p = this.local(e); if (!p) return true;
    this.sample(p);
    const d = this.drag, v = this.v;
    if (d.kind === 'measure') {
      this.length = clamp(Math.round((p.x + .95) / .0475), 1, 40); v.assembly(v.lab);
      v.onHover(`${this.length} м`);
    } else if (d.kind === 'depth') {
      this.depth = Math.round(clamp(d.depth + (p.x - d.start.x) * 2, .2, 3) * 10) / 10;
      v.onHover(`${this.depth.toFixed(1)} мм`);
    } else if (d.object) d.object.position.set(d.origin.x + p.x - d.start.x, .24, d.origin.z + p.z - d.start.z);
    else if (d.kind === 'stripper') {
      d.travel = clamp(p.z - d.start.z, 0, .9); this.tools.stripper.position.z = .13 + d.travel;
      v.onHover(`${Math.round(d.travel * 45)} мм`);
    } else if (d.kind === 'crimper') {
      d.travel = clamp(Math.abs(p.x - d.start.x), 0, .5); squeezeTool(this.tools.crimper, d.travel * 2.5);
      v.onHover(`${Math.round(d.travel * 250)} %`);
    }
    return true;
  }
  mount(id) {
    const v = this.v, g = this.tools[id]; this.mounted = id;
    if (this.guide) { v.dispose(this.guide); this.guide = null; }
    g.position.set(0, .24, id === 'stripper' ? .13 : -.49);
    if (id === 'crimper') g.rotation.y = Math.PI;
    g.traverse(o => { if (o.userData.pick) o.userData.pick = { kind: 'bench-mounted', label: id === 'stripper' ? 'Стриппер / оболочка' : 'Кримпер / рукоятки' }; });
    const gauge = new T.Group(); v.workRoot.add(gauge);
    if (id === 'stripper') {
      v.box(gauge, .14, .012, .76, '#ccd6c5', .53, .016, .52);
      v.box(gauge, .14, .006, .54, '#569e73', .53, .026, .58);
      for (let mm = 0; mm <= 30; mm += 5) {
        const z = .19 + mm / 45; v.box(gauge, .05, .006, .008, '#284b44', .53, .031, z);
        this.label(gauge, String(mm), .7, z, .12, '#d7e5d3');
      }
    } else {
      v.box(gauge, .61, .016, .1, '#a2b8aa', .12, .022, -.12);
      v.box(gauge, .12, .008, .1, '#6bb389', .36, .034, -.12);
      this.label(gauge, '0', -.22, -.12, .11); this.label(gauge, '100%', .56, -.12, .25);
    }
  }
  up(e) {
    if (!this.drag) return false;
    const p = this.local(e), v = this.v; this.drag = null; v.canvas.style.cursor = '';
    v.interact(p ? { kind: 'gesture', phase: 'end', point: { x: p.x, z: p.z } } : { kind: 'gesture', phase: 'cancel' }); return true;
  }
  cancel() { if (this.drag) this.v.interact({ kind: 'gesture', phase: 'cancel' }); if (this.drag || this.mounted) { this.drag = null; if (this.v.lab && this.v.mode === 'bench') this.v.assembly(this.v.lab); } this.v.canvas.style.cursor = ''; }
}
