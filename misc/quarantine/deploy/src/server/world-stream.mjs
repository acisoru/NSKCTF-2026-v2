import { deflateRawSync } from 'node:zlib';
import { StateEncoder } from '../shared/replica.mjs';

export class WorldStream {
  constructor() { this.cells = new Map(); }
  prepare(key, frame) {
    let cell = this.cells.get(key);
    if (!cell) { cell = { encoder: new StateEncoder() }; this.cells.set(key, cell); }
    const delta = cell.encoder.encode(frame); let full, compressedDelta, compressedFull;
    return {
      packet(reset, compressed) {
        if (reset) { full ??= new StateEncoder().encode({ ...frame, reset: true }); if (!compressed) return full; return compressedFull ??= deflateRawSync(full, { level: 3 }); }
        if (!compressed) return delta;
        return compressedDelta ??= deflateRawSync(delta, { level: 3 });
      },
    };
  }
  retain(keys) { for (const key of this.cells.keys()) if (!keys.has(key)) this.cells.delete(key); }
}
