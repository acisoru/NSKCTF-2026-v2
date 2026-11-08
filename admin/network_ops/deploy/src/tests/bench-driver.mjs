import * as T from 'three';
import { VIEWPOINTS, T568B } from '../shared/catalog.mjs';
import { BENCH_TOOLS } from '../client/bench.mjs';

export const wait = async fn => { const end = Date.now() + 6000; while (!fn()) { if (Date.now() > end) throw new Error('Game state timeout'); await new Promise(r => setTimeout(r, 20)); } };
export function benchDriver(page, { stripTravel = .22 } = {}) {
  const project = ([x, y, z]) => {
    const { width, height } = page.viewportSize(), camera = new T.PerspectiveCamera(65, width / height, .04, 120);
    camera.position.set(...VIEWPOINTS.bench.position); camera.lookAt(...VIEWPOINTS.bench.target); camera.updateMatrixWorld();
    const p = new T.Vector3(x, y + 1.14, z + 8).project(camera); return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
  };
  const click = async point => { const p = project(point); await page.mouse.click(p.x, p.y); };
  const drag = async (a, b) => {
    const from = project(a), to = project(b); await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(120);
  };
  const tool = async (name, x, z) => { const [tx, tz] = BENCH_TOOLS[name]; await drag([tx, .19, tz - .19], [x, .19, z - .19]); };
  const cut = async lab => { await tool('cutter', .2375, -.16); await wait(() => !!lab.draft); };
  const strip = async (lab, end) => {
    await tool('stripper', 0, .15);
    await drag([-.13, .38, .25], [-.13, .38, .25 + stripTravel]); await wait(() => lab.draft.ends[end].stripped);
  };
  const craft = async lab => {
    await cut(lab);
    for (const end of [0, 1]) {
      await click([end ? .87 : -.87, .09, .69]); await page.waitForTimeout(120);
      await strip(lab, end);
      for (let pin = 0; pin < 8; pin++) {
        const loose = lab.draft.ends[end].exposed.indexOf(T568B[pin]), fromX = (loose - 3.5) * .18, x = (pin - 3.5) * .18;
        await drag([fromX, .18, -.18 - (loose % 2) * .06], [x, .16, -.72]); await wait(() => lab.draft.ends[end].order[pin] === T568B[pin]);
      }
      await tool('cutter', 0, -.72); await wait(() => lab.draft.ends[end].trimmed);
      await drag([-1.36, .17, .26], [0, .17, -.72]); await wait(() => lab.draft.ends[end].inserted);
      await tool('crimper', 0, -.72);
      await drag([.13, .38, -.61], [.49, .38, -.61]); await wait(() => lab.draft.ends[end].crimped);
    }
  };
  return { project, click, drag, tool, cut, strip, craft };
}
