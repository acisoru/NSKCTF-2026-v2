export class SpatialGrid {
  constructor(size = 32) { this.size = size; this.cells = new Map(); }
  rebuild(objects) {
    this.cells.clear();
    for (const o of objects) {
      const key = `${Math.floor(o.x / this.size)},${Math.floor(o.z / this.size)}`;
      let bucket = this.cells.get(key); if (!bucket) this.cells.set(key, bucket = []); bucket.push(o);
    }
  }
  near(x, z, radius) {
    const found = [], r2 = radius * radius;
    for (let a = Math.floor((x - radius) / this.size); a <= Math.floor((x + radius) / this.size); a++) {
      for (let b = Math.floor((z - radius) / this.size); b <= Math.floor((z + radius) / this.size); b++) {
        for (const o of this.cells.get(`${a},${b}`) ?? []) if ((o.x - x) ** 2 + (o.z - z) ** 2 <= r2) found.push(o);
      }
    }
    return found;
  }
}
