const collections = ['players', 'enemies', 'projectiles', 'loot', 'effects', 'hazards'];
const rounded = (_, value) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
const cache = new WeakMap();
function normalize(o) { let value = cache.get(o); if (!value) { value = JSON.parse(JSON.stringify(o, rounded)); cache.set(o, value); } return value; }
export class StateEncoder {
  constructor() { this.previous = new Map(); }
  encode(state) {
    const packet = { ...state, delta: true };
    for (const key of collections) {
      const before = this.previous.get(key) ?? new Map(), next = new Map(), upsert = [], remove = [];
      for (const o of state[key] ?? []) {
        const value = normalize(o), previous = before.get(o.id); next.set(o.id, value);
        if (!previous) { upsert.push(value); continue; }
        if (key === 'effects' || key === 'loot' || key === 'projectiles') continue;
        const patch = { id: o.id };
        for (const k of Object.keys(value)) if (typeof value[k] === 'object' ? JSON.stringify(value[k]) !== JSON.stringify(previous[k]) : value[k] !== previous[k]) patch[k] = value[k];
        if (Object.keys(patch).length > 1) upsert.push(patch);
      }
      for (const id of before.keys()) if (!next.has(id)) remove.push(id);
      packet[key] = { upsert, remove }; this.previous.set(key, next);
    }
    packet.time = Math.round(packet.time * 100) / 100;
    packet.self = JSON.parse(JSON.stringify(state.self, rounded));
    return JSON.stringify(packet);
  }
}
export class StateReplica {
  constructor() { this.maps = new Map(collections.map(k => [k, new Map()])); }
  apply(packet) {
    if (!packet.delta) return packet;
    if (packet.reset) this.maps = new Map(collections.map(k => [k, new Map()]));
    const state = { ...packet };
    for (const key of collections) {
      const map = this.maps.get(key), delta = packet[key];
      for (const id of delta.remove) map.delete(id);
      for (const o of delta.upsert) map.set(o.id, { ...map.get(o.id), ...o });
      state[key] = [...map.values()];
    }
    return state;
  }
}
