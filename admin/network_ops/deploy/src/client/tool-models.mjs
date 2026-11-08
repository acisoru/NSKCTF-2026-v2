import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function squeezeTool(group, amount) {
  for (const handle of group.userData.handles ?? []) handle.rotation.y = handle.userData.rest - handle.userData.side * T.MathUtils.clamp(amount, 0, 1) * .28;
}

export class ToolModels {
  constructor(view) { this.v = view; this.textures = new Map(); }
  texture(kind) {
    if (this.textures.has(kind)) return this.textures.get(kind);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(256, 256); let seed = 719;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 4294967296, grain = kind === 'steel' ? Math.sin(y * 2.7) * 12 + noise * 13 : noise * 40;
      const value = Math.round(170 + grain), i = (y * 256 + x) * 4;
      pixels.data.set([value, value, value, 255], i);
    }
    ctx.putImageData(pixels, 0, 0);
    const texture = new T.CanvasTexture(canvas); texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(kind === 'steel' ? 2 : 3, kind === 'steel' ? 1 : 3);
    texture.anisotropy = Math.min(8, this.v.renderer.capabilities.getMaxAnisotropy());
    this.textures.set(kind, texture); return texture;
  }
  material(name, color, metalness = 0, roughness = .7, grain = null) {
    const key = `workshop/${name}`;
    if (!this.v.materials.has(key)) this.v.materials.set(key, new T.MeshStandardMaterial({ color, metalness, roughness, ...(grain ? { roughnessMap: this.texture(grain), bumpMap: this.texture(grain), bumpScale: grain === 'steel' ? .0007 : .0014 } : {}) }));
    return this.v.materials.get(key);
  }
  build(parent, id, pick, depth = 1) {
    const v = this.v, data = { kind: 'bench-tool', tool: id, label: pick.label };
    const steel = this.material('steel', '#b4c0c4', .72, .4, 'steel'), edge = this.material('edge', '#e0e5e4', .8, .27, 'steel');
    const dark = this.material('gunmetal', '#354249', .55, .46, 'steel'), rubber = this.material('rubber', '#252c30', 0, .92, 'rubber');
    const ink = this.material('ink', '#141d20', 0, .88), brass = this.material('brass', '#c9a651', .65, .34);
    const colors = { cutter: '#bc4549', stripper: '#ddb83d', crimper: '#397da6', tester: '#4693aa', certifier: '#d2af34', toner: '#a8bca0', punch: '#a4b16d', console: '#59a3b2', label: '#d2d8d0' };
    const coating = this.material(id, colors[id], .04, .68, 'polymer');
    const mesh = (g, geometry, material, x = 0, y = 0, z = 0, target = data) => {
      const m = v.mesh(g, geometry, material, x, y, z); if (target) v.target(m, target, v.workTargets); return m;
    };
    const box = (g, w, h, d, material, x = 0, y = 0, z = 0, radius = .018) => mesh(g, new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 3, h / 3, d / 3)), material, x, y, z);
    const cylinder = (g, r, h, material, x, y, z, segments = 32, target = data) => mesh(g, new T.CylinderGeometry(r, r, h, segments), material, x, y, z, target);
    const screw = (g, x, y, z, r = .022) => {
      cylinder(g, r * 1.3, .007, dark, x, y - .004, z);
      cylinder(g, r, .012, steel, x, y + .003, z, 6);
      box(g, r * 1.15, .003, .007, ink, x, y + .0105, z, .001);
      box(g, .007, .003, r * 1.15, ink, x, y + .0105, z, .001);
    };
    const text = (g, value, x, y, z, width, color = '#d3dddf') => {
      const m = v.label(g, value, x, y, z, width, color); m.rotation.x = -Math.PI / 2;
      m.material.polygonOffset = true; m.material.polygonOffsetFactor = -1; m.material.polygonOffsetUnits = -1;
      m.material.map.anisotropy = Math.min(8, v.renderer.capabilities.getMaxAnisotropy()); return m;
    };
    const plate = (g, points, material, y = .07, thickness = .06) => {
      const shape = new T.Shape(); points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)); shape.closePath();
      const geometry = new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .007, bevelThickness: .007, curveSegments: 16 });
      geometry.rotateX(-Math.PI / 2); return mesh(g, geometry, material, 0, y, 0);
    };
    const cord = (g, points, material, radius = .018) => mesh(g, new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), 80, radius, 12, false), material);
    const handles = () => {
      parent.userData.handles = [];
      for (const side of [-1, 1]) {
        const g = new T.Group(); g.position.set(side * .035, 0, -.10); parent.add(g); g.rotation.y = side * .16; g.userData = { rest: g.rotation.y, side }; parent.userData.handles.push(g);
        box(g, .082, .058, .44, steel, side * .08, .067, .19, .025);
        box(g, .146, .106, .36, rubber, side * .08, .067, .215, .04);
        box(g, .115, .027, .28, coating, side * .08, .119, .21, .027);
        for (let i = 0; i < 5; i++) box(g, .116, .010, .012, rubber, side * .08, .136, .15 + i * .042, .004);
        box(g, .15, .025, .055, coating, side * .08, .075, .40, .013);
        text(g, id === 'crimper' ? 'RJ45' : 'CrV', side * .08, .137, .34, .079);
      }
      box(parent, .21, .066, .14, steel, 0, .078, -.15);
      cylinder(parent, .062, .028, dark, 0, .126, -.10); screw(parent, 0, .151, -.10, .033);
      const spring = [];
      for (let i = 0; i <= 56; i++) { const t = i / 56; spring.push([-.055 + t * .11, .075 + Math.sin(t * Math.PI * 12) * .018, -.005 + Math.cos(t * Math.PI * 12) * .018]); }
      cord(parent, spring, edge, .005);
    };
    if (['cutter', 'stripper', 'crimper'].includes(id)) {
      handles();
      if (id === 'cutter') {
        for (const s of [-1, 1]) {
          plate(parent, [[s * .012, -.16], [s * .16, -.19], [s * .12, -.36], [s * .035, -.445], [s * .008, -.39]], steel);
          plate(parent, [[s * .009, -.22], [s * .034, -.235], [s * .042, -.4], [s * .011, -.422]], edge, .14, .008);
        }
        text(parent, 'CUT 160', .079, .145, -.25, .105, '#354249');
      } else if (id === 'stripper') {
        box(parent, .32, .075, .18, steel, 0, .094, -.215);
        box(parent, .34, .065, .073, dark, 0, .092, -.365);
        box(parent, .255, .027, .025, edge, 0, .131, -.323);
        for (let i = 0; i < 5; i++) cylinder(parent, .013 + i * .0015, .005, ink, (i - 2) * .049, .134, -.255, 24);
        text(parent, '0.5  1  2  3', 0, .136, -.18, .245, '#283338');
        const dial = new T.Group(); parent.add(dial); dial.position.set(.18, .168, -.22); dial.rotation.y = depth;
        const dialPick = { kind: 'bench-depth', label: 'Глубина ножа' };
        cylinder(dial, .076, .06, rubber, 0, 0, 0, 48, dialPick);
        cylinder(dial, .057, .009, dark, 0, .035, 0, 48, dialPick);
        for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, ridge = mesh(dial, new RoundedBoxGeometry(.016, .055, .016, 2, .004), dark, Math.sin(a) * .074, 0, Math.cos(a) * .074, dialPick); ridge.rotation.y = a; }
        const indicator = mesh(dial, new T.BoxGeometry(.008, .002, .03), coating, 0, .041, -.025, dialPick); indicator.castShadow = false;
        text(parent, `${depth.toFixed(1)} mm`, .51, .035, -.2, .34, '#f0d68a');
      } else {
        box(parent, .35, .085, .12, dark, 0, .10, -.35);
        for (const side of [-1, 1]) box(parent, .065, .085, .16, dark, side * .15, .10, -.22);
        box(parent, .26, .018, .13, ink, 0, .067, -.24);
        box(parent, .27, .026, .037, edge, 0, .11, -.176);
        for (let i = 0; i < 8; i++) box(parent, .016, .035, .064, steel, (i - 3.5) * .028, .125, -.285, .003);
        screw(parent, -.13, .149, -.35, .018); screw(parent, .13, .149, -.35, .018);
        text(parent, '8P / 6P', 0, .145, -.373, .17);
      }
    } else if (['tester', 'certifier', 'toner'].includes(id)) {
      box(parent, .56, .17, .70, rubber, 0, .067, 0, .06);
      box(parent, .49, .13, .635, coating, 0, .10, -.005, .045);
      box(parent, .422, .012, .527, this.material(`face-${id}`, id === 'tester' ? '#d6e0de' : id === 'toner' ? '#c9d5c4' : '#3b454b', .04, .66, 'polymer'), 0, .171, -.008, .025);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 7; i++) box(parent, .021, .039, .012, rubber, side * .248, .113, -.11 + i * .048, .004);
        screw(parent, side * .183, .181, .234, .011);
      }
      box(parent, .36, .012, .243, ink, 0, .184, -.104, .014);
      const key = `workshop/display-${id}`;
      if (!v.materials.has(key)) {
        const canvas = document.createElement('canvas'); canvas.width = 576; canvas.height = 384; const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#152a2e'; ctx.fillRect(0, 0, 576, 384); ctx.strokeStyle = '#718f87'; ctx.lineWidth = 3; ctx.strokeRect(15, 15, 546, 354);
        ctx.fillStyle = '#8ca99c'; ctx.font = '24px monospace'; ctx.fillText('LAB-X / ' + (id === 'certifier' ? 'CERT' : id === 'tester' ? 'WIREMAP' : 'PROBE'), 37, 63);
        ctx.fillStyle = '#cbe9bf'; ctx.font = 'bold 64px monospace'; ctx.fillText(id === 'certifier' ? 'CAT 6' : id === 'tester' ? '1 2 3 4' : '1000 Hz', 37, 162);
        ctx.font = '40px monospace'; ctx.fillText(id === 'tester' ? '5 6 7 8' : id === 'certifier' ? '1000BASE-T' : 'TONE / CONT', 37, 231);
        for (let i = 0; i < 8; i++) { ctx.fillStyle = '#526d63'; ctx.fillRect(40 + i * 62, 280, 42, 22); }
        ctx.fillStyle = '#8ca99c'; ctx.font = '22px monospace'; ctx.fillText('READY', 37, 343);
        const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.anisotropy = Math.min(8, v.renderer.capabilities.getMaxAnisotropy());
        v.materials.set(key, new T.MeshBasicMaterial({ map, toneMapped: false }));
      }
      const screen = mesh(parent, new T.PlaneGeometry(.335, .223), v.materials.get(key), 0, .191, -.104); screen.rotation.x = -Math.PI / 2; screen.castShadow = false;
      cylinder(parent, .043, .027, rubber, 0, .193, .14); cylinder(parent, .028, .006, coating, 0, .210, .14);
      for (const side of [-1, 1]) box(parent, .064, .024, .041, rubber, side * .114, .192, .14, .013);
      text(parent, id === 'certifier' ? 'CERTIFY' : id === 'tester' ? 'TEST' : 'SCAN', 0, .181, .223, .23, id === 'certifier' ? '#c8d8db' : '#334743');
      box(parent, .176, .053, .074, steel, 0, .169, -.321);
      box(parent, .136, .014, .052, ink, 0, .203, -.321);
      for (let i = 0; i < 8; i++) box(parent, .007, .008, .021, brass, (i - 3.5) * .013, .213, -.321, .001);
    } else if (id === 'console') {
      const points = [];
      for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 3.7; points.push([Math.cos(a) * .235, .043 + i * .0008, Math.sin(a) * .19]); }
      points.unshift([-.23, .063, .18]); points.push([.24, .063, .20]); cord(parent, points, coating, .021);
      for (const side of [-1, 1]) {
        const g = new T.Group(); g.position.set(side * .22, .03, .18); g.rotation.y = side * -.24; parent.add(g);
        box(g, .135, .085, .17, rubber, 0, .055, -.005, .025);
        box(g, .105, .071, .12, coating, 0, .066, .001, .02);
        for (let i = 0; i < 4; i++) box(g, .089, .013, .012, rubber, 0, .103, -.055 + i * .032, .003);
        box(g, side < 0 ? .19 : .11, .057, .12, steel, 0, .05, .13, .008);
        box(g, side < 0 ? .144 : .073, .01, .05, ink, 0, .084, .145, .003);
        for (let i = 0; i < (side < 0 ? 4 : 8); i++) box(g, .006, .004, .035, brass, (i - (side < 0 ? 1.5 : 3.5)) * .01, .091, .145, .001);
      }
    } else if (id === 'punch') {
      const g = new T.Group(); parent.add(g); g.rotation.y = .32;
      box(g, .17, .13, .43, rubber, 0, .073, .10, .052);
      box(g, .128, .038, .31, coating, 0, .13, .10, .026);
      for (let i = 0; i < 5; i++) box(g, .13, .008, .011, rubber, 0, .153, .03 + i * .043, .003);
      box(g, .088, .067, .14, steel, 0, .068, -.173, .008);
      box(g, .048, .037, .18, edge, 0, .068, -.318, .006);
      for (const side of [-1, 1]) box(g, .012, .039, .061, edge, side * .018, .068, -.425, .002);
      cylinder(g, .048, .012, dark, 0, .154, .25); text(g, '110', 0, .163, .25, .065);
    } else {
      const g = new T.Group(); parent.add(g); g.rotation.y = .35;
      const barrel = cylinder(g, .052, .48, coating, 0, .065, .04, 48); barrel.rotation.x = Math.PI / 2;
      const cap = cylinder(g, .058, .17, rubber, 0, .065, .24, 48); cap.rotation.x = Math.PI / 2;
      const collar = cylinder(g, .058, .015, steel, 0, .065, -.204, 48); collar.rotation.x = Math.PI / 2;
      box(g, .057, .062, .054, rubber, 0, .064, -.236, .008); box(g, .017, .035, .045, ink, 0, .064, -.284, .004);
      box(g, .019, .012, .15, steel, .032, .119, .23, .006);
      text(g, 'LAB-X', 0, .120, -.023, .085, '#384848');
    }
  }
}
