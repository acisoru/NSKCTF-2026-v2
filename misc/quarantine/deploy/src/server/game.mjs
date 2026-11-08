import { randomBytes, randomInt } from 'node:crypto';
import * as C from 'cannon-es';
import { STEP, PARTY_LIMIT, CAMERA, GUNS, WEAPONS, MOVEMENT, INTEREST_RADIUS, LADDERS, ROLES, WALLS, SAFE_ZONES, BOSSES, MOB_SPAWNS, BOMBER, BOMBER_SPAWNS, ITEMS, SHOP, CLUE, SPAWN, WORLD, hitShape, xpFor, safeAt } from '../shared/config.mjs';
import { SpatialGrid } from './spatial.mjs';
import { setImmediate as yieldImmediate } from 'node:timers/promises';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const idle = () => ({ x: 0, z: 0, yaw: 0, pitch: 0, aim: null, attack: false, skill: false, sprint: false, jump: false, climb: 0, reload: false, interact: false, potion: false });
const uid = () => randomBytes(12).toString('hex');
function zoneIntersection(from, to, zone) {
  const x = from.x - zone.x, z = from.z - zone.z, dx = to.x - from.x, dz = to.z - from.z;
  const c = x * x + z * z - zone.radius * zone.radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz, b = 2 * (x * dx + z * dz), discriminant = b * b - 4 * a * c;
  if (a < 1e-10 || discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
export class Game {
  constructor({ flag, now = () => Date.now(), maxPlayers = 300, saved = [], isAdmin = () => false, isBanned = () => false } = {}) {
    if (!flag) throw new Error('FLAG required');
    this.flag = flag; this.now = now; this.maxPlayers = maxPlayers; this.sessions = new Map(); this.parties = new Map();
    this.isAdmin = isAdmin; this.isBanned = isBanned;
    this.online = new Map(); this.accounts = new Map(); this.playerGrid = new SpatialGrid(); this.enemyGrid = new SpatialGrid();
    this.time = 0; this.serial = 0; this.enemies = []; this.hazards = []; this.effects = []; this.loot = []; this.projectiles = [];
    this.world = new C.World({ gravity: new C.Vec3(0, 0, 0) }); this.world.defaultContactMaterial.friction = 0;
    this.world.broadphase = new C.SAPBroadphase(this.world);
    for (const w of WALLS) this.world.addBody(new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(w.w / 2, ((w.h ?? 8) + .15) / 2, w.d / 2)), position: new C.Vec3(w.x, ((w.h ?? 8) + .15) / 2, w.z), collisionFilterGroup: 1, collisionFilterMask: 2 }));
    const floor = new C.Body({ mass: 0, shape: new C.Plane(), collisionFilterGroup: 8, collisionFilterMask: 2 }); floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); this.world.addBody(floor);
    for (const record of saved) {
      if (typeof record.token !== 'string' || !/^[a-f0-9]{64}$/.test(record.token) || !Object.hasOwn(ROLES, record.role)) continue;
      const p = this.newPlayer(record.token);
      for (const key of ['name', 'role', 'level', 'xp', 'gold', 'potions', 'inventory', 'equipment', 'marks', 'won', 'id', 'providerId', 'hp']) if (record[key] !== undefined) p[key] = record[key];
      p.registered = record.registered ?? true; this.stats(p); p.hp = Number.isFinite(record.hp) ? clamp(record.hp, 0, p.maxHp) : p.maxHp; if (p.hp === 0) p.dead = 7; this.sessions.set(p.token, p);
      p.characterRevision = Number.isSafeInteger(record.characterRevision) && record.characterRevision >= 0 ? record.characterRevision : 0;
      p.recreateAfter = Number.isFinite(record.recreateAfter) ? record.recreateAfter : 0;
      if (p.providerId) { if (this.accounts.has(p.providerId)) throw new Error('Duplicate provider identity in storage'); this.accounts.set(p.providerId, p); }
    }
    for (const [x, z, level] of MOB_SPAWNS) this.spawn(level % 2 ? 'drone' : 'sentry', x, z, level);
    for (const [x, z, level, yaw] of BOMBER_SPAWNS) {
      const e = this.spawn('bomber', x, z, level); e.homeYaw = yaw; e.yaw = yaw;
    }
    for (const boss of BOSSES) this.spawn('boss', boss.x, boss.z, boss.level, boss.id);
  }
  item(type) { return { id: uid(), type, ...(ITEMS[type].slot === 'weapon' ? { ammo: WEAPONS[ITEMS[type].weapon ?? 'rifle'].magazine } : {}) }; }
  account(providerId) {
    if (!this.accounts.has(providerId)) { if (this.accounts.size >= 50000) throw new Error('Реестр заполнен'); const p = this.newPlayer(); p.providerId = providerId; this.accounts.set(providerId, p); this.sessions.set(p.token, p); }
    return this.accounts.get(providerId);
  }
  migrate(providerId, legacyToken) {
    const old = this.sessions.get(legacyToken), current = this.accounts.get(providerId);
    if (!old || old.providerId || (current && current.registered)) return false;
    if (current) { this.removeActorBodies(current); this.sessions.delete(current.token); this.online.delete(current.id); }
    old.providerId = providerId; this.accounts.set(providerId, old); return true;
  }
  newPlayer(token = randomBytes(32).toString('hex')) {
    const weapon = this.item('issue'), armor = this.item('suit');
    const p = { token, id: uid(), name: 'Ревизор', role: 'assault', registered: false, entered: false, connected: false, party: null, x: SPAWN.x, z: SPAWN.z, yaw: 0, level: 1, xp: 0, gold: 50, potions: 3, marks: [], won: false, inventory: [weapon, armor], equipment: { weapon: weapon.id, armor: armor.id, relic: null }, input: idle(), lastInput: 0, lastSeen: this.now(), dead: 0, ward: 0, dashTime: 0, invulnerable: 0, damage: 0, support: 0, cd: { attack: 0, skill: 0, dash: 0, potion: 0 }, body: null };
    p.pitch = 0;
    p.y = 0; p.grounded = true; p.stamina = MOVEMENT.staminaMax; p.climbing = null; p.jumpHeld = false; p.reloading = null; p.inputSeq = -1; p.corrections = 0;
    p.characterRevision = 0; p.recreateAfter = 0;
    this.stats(p); p.hp = p.maxHp; return p;
  }
  stats(p) {
    const equip = slot => ITEMS[p.inventory.find(i => i.id === p.equipment[slot])?.type] ?? {};
    p.maxHp = ROLES[p.role].hp + (p.level - 1) * 19 + (equip('relic').hp ?? 0);
    p.power = ROLES[p.role].damage + (p.level - 1) * 3 + (equip('weapon').damage ?? 0);
    p.armor = equip('armor').armor ?? 0; p.hp = Math.min(p.hp ?? p.maxHp, p.maxHp);
  }
  body(x, z, radius = .48) {
    const b = new C.Body({ mass: 1, shape: new C.Sphere(radius), position: new C.Vec3(x, .8, z), collisionFilterGroup: 2, collisionFilterMask: 1, linearDamping: 0 });
    b.linearFactor.set(1, 0, 1); b.angularFactor.set(0, 0, 0); this.world.addBody(b); return b;
  }
  playerBody(p) {
    p.body = this.body(p.x, p.z, MOVEMENT.radius); p.body.position.y = p.y + MOVEMENT.radius;
    p.body.linearFactor.y = 1; p.body.collisionFilterMask = 1 | 8; this.hitbox(p);
  }
  weapon(p) {
    if (this.adminActive(p) && p.admin.weapon) return { item: null, type: 'admin', spec: WEAPONS.admin };
    const item = p.inventory.find(i => i.id === p.equipment.weapon), type = ITEMS[item?.type]?.weapon ?? 'pistol', spec = WEAPONS[type];
    if (item && !Number.isFinite(item.ammo)) item.ammo = spec.magazine;
    return { item, type, spec };
  }
  reload(p) {
    const { item, spec } = this.weapon(p);
    if (!p.reloading && item && item.ammo < spec.magazine) p.reloading = { id: item.id, remaining: spec.reload };
  }
  ladderNear(p) {
    return LADDERS.find(l => (Math.hypot(p.x - l.x, p.z - l.z) < 1.5 && p.y < l.top + 1) || (Math.hypot(p.x - l.x, p.z - l.exitZ) < 1.7 && Math.abs(p.y - l.top) < 1));
  }
  adminActive(p) { return !!p?.admin?.enabled && this.isAdmin(p.providerId); }
  adminControl(p, m) {
    if (!this.isAdmin(p.providerId)) throw new Error('Нет прав администратора');
    if (!this.active(p)) throw new Error('Персонаж недоступен');
    if (m.type === 'admin-mode') {
      if (typeof m.enabled !== 'boolean') throw new Error('Некорректный режим');
      if (m.enabled === this.adminActive(p)) return;
      if (m.enabled) {
        p.admin = { enabled: true, weapon: false, following: null, returnPoint: { x: p.x, y: p.y, z: p.z } };
        p.climbing = null; p.reloading = null; p.ward = 0;
        for (const e of this.enemies) e.contributions.delete(p.id);
      } else {
        const point = p.admin.returnPoint; p.admin = null;
        Object.assign(p, point); p.body.position.set(point.x, point.y + MOVEMENT.radius, point.z);
      }
      p.input = idle(); p.body.velocity.set(0, 0, 0); p.body.force.set(0, 0, 0);
      p.body.collisionFilterMask = m.enabled ? 0 : 1 | 8; p.moveStart = null;
      this.projectiles = this.projectiles.filter(shot => shot.source !== p);
      return;
    }
    if (!this.adminActive(p)) throw new Error('Включите режим администратора');
    if (m.type === 'admin-weapon') { if (typeof m.enabled !== 'boolean') throw new Error('Некорректный режим'); p.admin.weapon = m.enabled; return; }
    if (m.type === 'admin-follow') {
      if (m.playerId === null) { p.admin.following = null; return; }
      const target = this.online.get(m.playerId);
      if (!target || target === p || !this.active(target)) throw new Error('Игрок недоступен');
      p.admin.following = target.id; return;
    }
    throw new Error('Неизвестная команда администратора');
  }
  flyAdmin(p, dt) {
    const m = p.input, target = this.online.get(p.admin.following);
    p.body.collisionFilterMask = 0; p.body.force.set(0, 0, 0); p.body.velocity.set(0, 0, 0);
    p.moveStart = null; p.motionTransition = true; p.grounded = false; p.sprinting = false;
    if (p.admin.following && !this.active(target)) p.admin.following = null;
    if (p.admin.following) {
      p.x = target.x - Math.sin(target.yaw) * 5; p.z = target.z + Math.cos(target.yaw) * 5; p.y = target.y + 3;
      p.yaw = target.yaw; p.pitch = -Math.atan2(3, 5);
    } else {
      const lift = m.lift ?? 0, speed = m.sprint ? 36 : 14, length = Math.max(1, Math.hypot(m.x, m.z, lift));
      p.x += m.x / length * speed * dt; p.z += m.z / length * speed * dt; p.y += lift / length * speed * dt;
    }
    p.x = clamp(p.x, -WORLD.x + 1, WORLD.x - 1); p.z = clamp(p.z, -WORLD.z + 1, WORLD.z - 1); p.y = clamp(p.y, .1, 80);
    p.body.position.set(p.x, p.y + MOVEMENT.radius, p.z);
  }
  movePlayer(p, dt) {
    if (this.adminActive(p)) { this.flyAdmin(p, dt); return; }
    const m = p.input, oldJump = p.jumpHeld; p.jumpHeld = m.jump;
    p.motionTransition = false; p.moveStart = { x: p.body.position.x, z: p.body.position.z };
    if (!p.climbing && m.interact) {
      const ladder = this.ladderNear(p);
      if (ladder) { p.climbing = ladder.id; p.body.velocity.set(0, 0, 0); p.motionTransition = true; }
    }
    if (p.climbing) {
      const ladder = LADDERS.find(l => l.id === p.climbing);
      p.body.force.y = 0; p.body.collisionFilterMask = 0; p.body.velocity.set(0, 0, 0);
      p.y = clamp(p.y + m.climb * MOVEMENT.climbSpeed * dt, 0, ladder.top + .03);
      p.body.position.set(ladder.x, p.y + MOVEMENT.radius, ladder.z);
      p.stamina = Math.min(MOVEMENT.staminaMax, p.stamina + MOVEMENT.staminaRecovery * dt);
      if (m.jump && !oldJump || m.climb < 0 && p.y <= 0 || m.climb > 0 && p.y >= ladder.top) {
        if (p.y >= ladder.top && m.climb > 0) { p.body.position.z = ladder.exitZ; p.body.position.y = ladder.top + MOVEMENT.radius + .04; }
        p.climbing = null; p.body.collisionFilterMask = 1 | 8; p.motionTransition = true;
        if (m.jump && !oldJump) p.body.velocity.y = MOVEMENT.jumpSpeed * .7;
      }
      return;
    }
    p.body.collisionFilterMask = 1 | 8; p.body.force.y = -MOVEMENT.gravity;
    const moving = Math.hypot(m.x, m.z) > .01, sprint = m.sprint && moving && p.stamina > 1 && p.grounded;
    p.stamina = clamp(p.stamina + (sprint ? -MOVEMENT.sprintDrain : MOVEMENT.staminaRecovery) * dt, 0, MOVEMENT.staminaMax);
    const speed = ROLES[p.role].speed * this.weapon(p).spec.move * (sprint ? MOVEMENT.sprintMultiplier : 1);
    p.sprinting = sprint; p.moveBudget = speed * dt + .08;
    const len = Math.max(1, Math.hypot(m.x, m.z)); p.body.velocity.x = m.x / len * speed; p.body.velocity.z = m.z / len * speed;
    if (m.jump && !oldJump && p.grounded && p.stamina >= MOVEMENT.jumpCost) { p.body.velocity.y = MOVEMENT.jumpSpeed; p.stamina -= MOVEMENT.jumpCost; p.grounded = false; }
  }
  hitbox(actor) {
    const spec = hitShape(actor), shape = spec.box ? new C.Box(new C.Vec3(...spec.box)) : new C.Sphere(spec.radius);
    const body = new C.Body({ mass: 0, type: C.Body.KINEMATIC, shape, collisionFilterGroup: 4, collisionFilterMask: 2 });
    body.actor = actor; actor.hitbox = body; this.world.addBody(body); this.syncHitbox(actor);
  }
  syncHitbox(actor) {
    if (!actor.hitbox) return;
    actor.hitbox.position.set(actor.body.position.x, (actor.y ?? 0) + hitShape(actor).y, actor.body.position.z);
    actor.hitbox.collisionFilterMask = actor.hp > 0 && (!actor.token || this.active(actor) && !this.adminActive(actor)) ? 2 : 0;
    actor.hitbox.aabbNeedsUpdate = true;
  }
  removeActorBodies(actor) {
    if (actor.body) this.world.removeBody(actor.body);
    if (actor.hitbox) this.world.removeBody(actor.hitbox);
    actor.body = null; actor.hitbox = null;
  }
  fire(source, direction, damage, gun = GUNS.player, sound = true, weaponType = 'rifle') {
    if (this.safe(source) || source.hp <= 0 || this.projectiles.length >= 4096) return;
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (!Number.isFinite(length) || length < .001) return;
    const dir = new C.Vec3(direction.x / length, direction.y / length, direction.z / length);
    const from = new C.Vec3(source.x, (source.y ?? 0) + (source.token ? CAMERA.eyeHeight - .25 : 1.15), source.z);
    const muzzle = from.vadd(dir.scale(source.token ? .9 : .8));
    if (source.token) { muzzle.x += Math.cos(source.yaw) * .35; muzzle.z += Math.sin(source.yaw) * .35; }
    const wall = new C.RaycastResult();
    const blocked = this.world.raycastClosest(from, muzzle, { collisionFilterGroup: 2, collisionFilterMask: 1 }, wall);
    if (sound) this.effect('gunshot', muzzle.x, muzzle.z, { y: muzzle.y, actor: source.id, enemy: !source.token, weapon: weaponType, dx: dir.x, dy: dir.y, dz: dir.z, ttl: .36 });
    if (blocked) { this.effect('bullet-impact', wall.hitPointWorld.x, wall.hitPointWorld.z, { y: wall.hitPointWorld.y, ttl: .3 }); return; }
    this.projectiles.push({ id: ++this.serial, source, adminShot: weaponType === 'admin' && this.adminActive(source) && source.admin.weapon, x: from.x, y: from.y, z: from.z, vx: dir.x * gun.speed, vy: dir.y * gun.speed, vz: dir.z * gun.speed, damage, enemy: !source.token, life: gun.range / gun.speed });
  }
  firePlayer(p) {
    if (this.adminActive(p)) {
      if (!p.admin.weapon || p.admin.following) return;
      p.cd.attack = WEAPONS.admin.interval;
      const aim = p.input.aim;
      const direction = aim ? { x: aim.x - p.x, y: aim.y - (p.y + CAMERA.eyeHeight - .25), z: aim.z - p.z } : { x: Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
      this.fire(p, direction, 1e6, WEAPONS.admin, true, 'admin'); return;
    }
    const { item, type, spec } = this.weapon(p);
    if (p.reloading || !item) return;
    if (item.ammo <= 0) { this.reload(p); return; }
    item.ammo--; p.cd.attack = spec.interval;
    const aim = p.input.aim;
    const direction = aim ? { x: aim.x - p.x, y: aim.y - (p.y + CAMERA.eyeHeight - .25), z: aim.z - p.z } : { x: Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
    const yaw = Math.atan2(direction.x, -direction.z), pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
    for (let i = 0; i < spec.pellets; i++) {
      const spread = spec.spread * (p.sprinting ? 1.8 : 1);
      const a = yaw + (randomInt(20001) / 10000 - 1) * spread, b = pitch + (randomInt(20001) / 10000 - 1) * spread;
      this.fire(p, { x: Math.sin(a) * Math.cos(b), y: Math.sin(b), z: -Math.cos(a) * Math.cos(b) }, p.power * spec.scale, spec, i === 0, type);
    }
  }
  tickGun(e, target, distance) {
    const gun = GUNS[e.kind];
    if (!gun || distance > gun.range || !this.visible(e, target)) { e.burstLeft = 0; e.charging = false; e.cd = Math.max(e.cd, .2); return; }
    if (e.cd > 0) return;
    if (!e.burstLeft) {
      e.burstLeft = gun.burst; e.cd = gun.windup; e.charging = true;
      this.effect('gun-charge', e.x, e.z, { y: 1.15, ttl: gun.windup }); return;
    }
    const lead = Math.min(.55, distance / gun.speed) * .85;
    const tx = target.x + target.body.velocity.x * lead, tz = target.z + target.body.velocity.z * lead;
    this.fire(e, { x: tx - e.x, y: (target.y ?? 0) - .1, z: tz - e.z }, gun.damage + e.level * gun.damagePerLevel, gun);
    e.burstLeft--; e.charging = false; e.cd = e.burstLeft ? gun.gap : gun.reload;
  }
  tickProjectiles(dt) {
    for (const shot of this.projectiles) {
      if (this.safe(shot.source) || shot.adminShot && (!this.adminActive(shot.source) || !shot.source.admin.weapon)) { shot.life = 0; continue; }
      const from = new C.Vec3(shot.x, shot.y, shot.z), step = Math.min(dt, shot.life);
      const to = new C.Vec3(shot.x + shot.vx * step, shot.y + shot.vy * step, shot.z + shot.vz * step);
      const length = from.distanceTo(to); let closest = null;
      // Sweep the whole segment: a fast round cannot jump over a wall or character.
      this.world.raycastAll(from, to, { collisionFilterGroup: 2, collisionFilterMask: 1 | 4, skipBackfaces: false }, hit => {
        const actor = hit.body.actor;
        if (actor === shot.source || (shot.enemy && actor && !actor.token)) return;
        if (!closest || hit.distance < closest.distance) closest = { distance: hit.distance, point: hit.hitPointWorld.clone(), actor };
      });
      const barrier = (fraction) => {
        if (fraction !== null && (!closest || fraction * length < closest.distance)) {
          const point = new C.Vec3(); from.lerp(to, fraction, point);
          closest = { distance: fraction * length, point, actor: null };
        }
      };
      for (const zone of SAFE_ZONES) barrier(zoneIntersection(from, to, zone));
      if (to.y <= .03) barrier(from.y <= .03 ? 0 : (from.y - .03) / (from.y - to.y));
      if (closest) {
        const { point, actor } = closest;
        if (actor) {
          if (actor.token) this.hitPlayer(actor, shot.damage, shot.source, shot.adminShot);
          else this.hitEnemy(shot.source, actor, shot.damage, shot.adminShot);
          this.syncHitbox(actor);
        }
        this.effect('bullet-impact', point.x, point.z, { y: point.y, actor: shot.source.id, enemy: shot.enemy, ttl: .3 }); shot.life = 0;
      } else { shot.x = to.x; shot.y = to.y; shot.z = to.z; shot.life -= step; }
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
  }
  connect(token, send) {
    let p = typeof token === 'string' ? this.sessions.get(token) : null;
    if (p && this.isBanned(p.providerId)) throw new Error('Аккаунт заблокирован');
    if (!p) {
      if (this.sessions.size >= 5000) throw new Error('Реестр заполнен');
      p = this.newPlayer(); this.sessions.set(p.token, p);
    }
    if (!p.connected && this.players().length >= this.maxPlayers) throw new Error('Мир заполнен. Попробуйте позже.');
    p.send = send; p.connected = true; p.lastSeen = this.now(); p.input = idle(); p.inputSeq = -1;
    // A player who has already earned the CTF flag is archived permanently:
    // reconnecting may reveal the reward, but must never put the character
    // back into the live world.
    if (p.won) { p.archived = true; }
    else if (p.registered && !p.entered) { if (!p.body) this.playerBody(p); p.entered = true; }
    if (p.entered) this.online.set(p.id, p);
    this.send(p, { type: 'hello', token: p.token, id: p.id });
    if (p.won) this.send(p, { type: 'reward', reward: { flag: this.flag, clue: CLUE } });
    else if (p.entered) this.send(p, this.snapshot(p));
    return p;
  }
  send(p, data) { p.send?.(data); }
  notify(p, message) { this.send(p, { type: 'notice', message }); }
  archiveWinner(p) {
    p.archived = true; p.input = idle(); p.lastInput = this.now();
    this.send(p, { type: 'reward', reward: { flag: this.flag, clue: CLUE } });
  }
  players() { return [...this.online.values()].filter(p => !p.archived); }
  disconnect(p) { if (this.adminActive(p)) this.adminControl(p, { type: 'admin-mode', enabled: false }); p.connected = false; this.online.delete(p.id); p.input = idle(); p.lastSeen = this.now(); if (p.body) p.body.velocity.set(0, 0, 0); }
  safe(p) { return safeAt(p.x, p.z); }
  shop(p) { return SAFE_ZONES.find(s => dist3(p, s.merchant) < 3.4 && this.safe(p)); }
  active(p) { return !!p && !p.archived && p.connected && p.entered && p.hp > 0; }
  canRecreate(p) { return this.active(p) && !!this.safe(p) && p.grounded && p.y < .5 && !p.climbing && !this.adminActive(p) && !this.isBanned(p.providerId) && this.now() >= p.recreateAfter; }
  recreate(p, m) {
    if (m.confirm !== p.id || m.revision !== p.characterRevision) throw new Error('Подтверждение устарело. Откройте окно заново.');
    if (!Object.hasOwn(ROLES, m.role) || m.role === p.role) throw new Error('Выберите другую специализацию');
    if (this.now() < p.recreateAfter) throw new Error('Пересоздавать персонажа можно не чаще одного раза в минуту');
    if (!this.canRecreate(p)) throw new Error('Пересоздание доступно живому персонажу на земле в зелёной зоне, без режима администратора');
    const fresh = this.newPlayer(p.token);
    Object.assign(fresh, { id: p.id, providerId: p.providerId, name: p.name, role: m.role, registered: true, entered: true, connected: true, send: p.send, sendWorld: p.sendWorld, won: p.won, characterRevision: p.characterRevision + 1, recreateAfter: this.now() + 60000, inputSeq: p.inputSeq, corrections: p.corrections, gold: 0, potions: Math.min(3, p.potions) });
    this.stats(fresh); fresh.hp = fresh.maxHp;
    this.leaveParty(p); this.removeActorBodies(p);
    this.projectiles = this.projectiles.filter(shot => shot.source !== p);
    this.loot = this.loot.filter(drop => drop.owner !== p.id);
    for (const enemy of this.enemies) { enemy.contributions.delete(p.id); if (enemy.attackerId === p.id) enemy.attackerId = null; if (enemy.targetId === p.id && enemy.behavior === 'arming') this.resetBomber(enemy); }
    for (const key of Object.keys(p)) delete p[key]; Object.assign(p, fresh);
    this.playerBody(p); this.syncHitbox(p); this.online.set(p.id, p);
    this.send(p, this.snapshot(p)); return { recreated: true, revision: p.characterRevision, role: p.role };
  }
  handle(p, m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    p.lastSeen = this.now();
    if (p.archived) return;
    if (m.type === 'enter') {
      if (p.won) { this.send(p, { type: 'reward', reward: { flag: this.flag, clue: CLUE } }); return; }
      if (!p.entered && this.players().length >= this.maxPlayers) throw new Error('Мир заполнен. Попробуйте позже.');
      if (!p.registered) {
        p.name = typeof m.name === 'string' ? m.name.replace(/[\p{C}<>]/gu, '').trim().slice(0, 20) || 'Ревизор' : 'Ревизор';
        p.role = Object.hasOwn(ROLES, m.role) ? m.role : 'assault'; p.registered = true; this.stats(p); p.hp = p.maxHp;
      }
      if (!p.body) this.playerBody(p);
      p.entered = true; this.online.set(p.id, p); this.syncHitbox(p); this.send(p, this.snapshot(p)); return;
    }
    if (!p.entered) return;
    if (m.type === 'character-recreate') return this.recreate(p, m);
    if (typeof m.type === 'string' && m.type.startsWith('admin-')) { this.adminControl(p, m); return; }
    if (m.type === 'input') {
      if (m.seq !== undefined) { if (!Number.isSafeInteger(m.seq) || m.seq <= p.inputSeq) return; p.inputSeq = m.seq; }
      const aim = m.aim && ['x', 'y', 'z'].every(k => Number.isFinite(m.aim[k]) && Math.abs(m.aim[k]) <= 2048) ? { x: m.aim.x, y: m.aim.y, z: m.aim.z } : null;
      p.input = { x: Number.isFinite(m.x) ? clamp(m.x, -1, 1) : 0, z: Number.isFinite(m.z) ? clamp(m.z, -1, 1) : 0, yaw: Number.isFinite(m.yaw) ? m.yaw % (Math.PI * 2) : p.yaw, pitch: Number.isFinite(m.pitch) ? clamp(m.pitch, CAMERA.minPitch, CAMERA.maxPitch) : p.pitch, aim, attack: m.attack === true, skill: m.skill === true, sprint: m.sprint === true, jump: m.jump === true, climb: Number.isFinite(m.climb) ? clamp(m.climb, -1, 1) : 0, reload: m.reload === true, interact: m.interact === true, potion: m.potion === true };
      p.input.lift = this.adminActive(p) && Number.isFinite(m.lift) ? clamp(m.lift, -1, 1) : 0;
      p.lastInput = this.now(); return;
    }
    if (m.type === 'party-create') {
      if (p.party) throw new Error('Вы уже в отряде');
      let code; do { code = randomBytes(4).toString('hex').toUpperCase(); } while (this.parties.has(code));
      this.parties.set(code, new Set([p.id])); p.party = code; return;
    }
    if (m.type === 'party-join') {
      if (p.party) throw new Error('Сначала покиньте текущий отряд');
      const code = typeof m.code === 'string' ? m.code.trim().toUpperCase() : '';
      const party = this.parties.get(code);
      if (!party) throw new Error('Отряд не найден');
      if (party.size >= PARTY_LIMIT) throw new Error(`В отряде уже ${PARTY_LIMIT} игроков`);
      party.add(p.id); p.party = code; return;
    }
    if (m.type === 'party-leave') { this.leaveParty(p); return; }
    if (m.type === 'chat' && typeof m.text === 'string') {
      const text = m.text.replace(/\p{C}/gu, '').trim().slice(0, 180);
      if (text) for (const q of this.players()) if (!p.party || q.party === p.party) this.send(q, { type: 'chat', name: p.name, text });
    }
    if (m.type === 'equip' && this.active(p)) {
      const item = p.inventory.find(i => i.id === m.id); if (!item) throw new Error('Предмет не найден');
      p.equipment[ITEMS[item.type].slot] = item.id; this.stats(p);
      if (ITEMS[item.type].slot === 'weapon') p.reloading = null;
    }
    if (m.type === 'buy' || m.type === 'sell') {
      if (this.adminActive(p)) throw new Error('Торговля недоступна в режиме администратора');
      if (!this.active(p) || !this.shop(p)) throw new Error('Торговец слишком далеко');
      if (m.type === 'buy') {
        if (!SHOP.includes(m.item)) throw new Error('Нет такого товара');
        const price = m.item === 'potion' ? 25 : ITEMS[m.item].price;
        if (p.gold < price) throw new Error('Недостаточно кредитов');
        if (m.item === 'potion' ? p.potions >= 15 : p.inventory.length >= 32) throw new Error('Инвентарь заполнен');
        p.gold -= price;
        if (m.item === 'potion') p.potions++; else p.inventory.push(this.item(m.item));
      } else {
        const item = p.inventory.find(i => i.id === m.id);
        if (!item || Object.values(p.equipment).includes(item.id)) throw new Error('Сначала снимите предмет');
        p.gold += Math.max(5, Math.floor(ITEMS[item.type].price * .3)); p.inventory = p.inventory.filter(i => i !== item);
      }
    }
    if (m.type === 'logout') { if (this.adminActive(p)) this.adminControl(p, { type: 'admin-mode', enabled: false }); this.leaveParty(p); p.entered = false; this.online.delete(p.id); this.removeActorBodies(p); this.send(p, { type: 'left' }); }
  }
  leaveParty(p) { const members = this.parties.get(p.party); members?.delete(p.id); if (members?.size === 0) this.parties.delete(p.party); p.party = null; }
  spawn(kind, x, z, level = 1, bossId = null, parent = null) {
    const spec = BOSSES.find(b => b.id === bossId);
    const hp = kind === 'boss' ? spec.hp : kind === 'pylon' ? 260 : 70 + level * 26;
    const e = { id: uid(), kind, bossId, parent, x, z, sx: x, sz: z, level, hp, maxHp: hp, body: this.body(x, z, kind === 'boss' ? 1.6 : .6), cd: 2, phase: 1, attacks: 0, dead: 0, lastCombat: 0, combatTime: 0, contributions: new Map() };
    if (kind === 'bomber') this.resetBomber(e);
    this.enemies.push(e); this.hitbox(e); return e;
  }
  resetBomber(e) {
    e.behavior = 'patrol'; e.homeYaw ??= 0; e.yaw = e.homeYaw;
    e.altitude = BOMBER.hoverHeight; e.flightProgress = 0; e.targetId = null;
    e.aim = null; e.flight = null; e.armTime = 0; e.patrolStart = this.time;
  }
  seesBomber(e, p) {
    if (this.adminActive(p)) return false;
    if (!this.active(p) || this.safe(p) || this.safe(e)) return false;
    const distance = dist(e, p);
    if (distance > BOMBER.sightRange) return false;
    const dot = distance < .001 ? 1 : ((p.x - e.x) * Math.sin(e.yaw) - (p.z - e.z) * Math.cos(e.yaw)) / distance;
    return dot >= Math.cos(BOMBER.sightAngle / 2) && this.visible(e, p);
  }
  tickBomber(e, players, dt) {
    if (e.behavior === 'patrol') {
      const phase = this.time - e.patrolStart;
      e.yaw = e.homeYaw + Math.sin(phase * .5) * .45;
      const target = players.filter(p => this.seesBomber(e, p)).sort((a, b) => dist(a, e) - dist(b, e))[0];
      if (target) {
        e.behavior = 'arming'; e.armTime = BOMBER.windup; e.targetId = target.id;
        e.aim = { x: target.x, z: target.z }; e.body.velocity.set(0, 0, 0);
        this.effect('bomber-lock', e.x, e.z, { ttl: BOMBER.windup, radius: 1 });
        this.notify(target, 'Дрон-подрывник: захват цели.');
      } else {
        const waypoint = { x: e.sx + Math.sin(phase * .45) * BOMBER.patrolRadius, z: e.sz + Math.sin(phase * .7) * .8 };
        const d = dist(e, waypoint), speed = Math.min(BOMBER.patrolSpeed, d / dt);
        e.body.velocity.set(d > .01 ? (waypoint.x - e.x) / d * speed : 0, 0, d > .01 ? (waypoint.z - e.z) / d * speed : 0);
      }
      return;
    }
    if (e.behavior === 'arming') {
      const target = players.find(p => p.id === e.targetId);
      e.body.velocity.set(0, 0, 0);
      if (!target || !this.active(target) || this.safe(target) || dist(e, target) > BOMBER.sightRange * 1.5 || !this.visible(e, target)) { this.resetBomber(e); return; }
      e.yaw = Math.atan2(target.x - e.x, -(target.z - e.z)); e.aim = { x: target.x, z: target.z };
      e.armTime -= dt;
      if (e.armTime > 0) return;
      // Commit to the last visible position; the player can dodge after launch.
      e.behavior = 'diving';
      e.flight = { x: e.x, z: e.z, start: this.time, duration: Math.max(.35, dist(e, e.aim) / BOMBER.diveSpeed) };
    }
    if (e.behavior === 'diving') {
      const f = e.flight;
      e.flightProgress = clamp((this.time - f.start + dt) / f.duration, 0, 1);
      e.altitude = BOMBER.hoverHeight - (BOMBER.hoverHeight + .65) * e.flightProgress ** 1.4;
      const stepFraction = clamp((f.duration - (this.time - f.start)) / dt, 0, 1);
      e.body.velocity.set((e.aim.x - f.x) / f.duration * stepFraction, 0, (e.aim.z - f.z) / f.duration * stepFraction);
    }
  }
  detonateBomber(e) {
    if (e.hp <= 0 || e.behavior !== 'diving') return;
    e.hp = 0; e.dead = BOMBER.respawn; e.behavior = 'spent'; e.body.velocity.set(0, 0, 0);
    e.contributions.clear();
    if (this.safe(e)) { this.effect('destroy', e.x, e.z, { ttl: .5 }); return; }
    this.effect('bomber-blast', e.x, e.z, { radius: BOMBER.blastRadius, ttl: 1.35 });
    for (const p of this.players()) {
      const distance = dist(e, p);
      if (distance < BOMBER.blastRadius && this.visible(e, p)) this.hitPlayer(p, (BOMBER.damage + e.level * BOMBER.damagePerLevel) * (1 - .65 * distance / BOMBER.blastRadius), e);
    }
  }
  effect(kind, x, z, extra = {}) { this.effects.push({ id: ++this.serial, kind, x, z, ttl: .4, ...extra }); }
  hazard(e, x, z, radius, delay, damage, inner = 0) { this.hazards.push({ id: ++this.serial, source: e.id, x, z, radius, delay, duration: delay, damage, inner }); }
  visible(a, b) { return !this.world.raycastClosest(new C.Vec3(a.x, (a.y ?? 0) + 1.05, a.z), new C.Vec3(b.x, (b.y ?? 0) + 1.05, b.z), { collisionFilterGroup: 2, collisionFilterMask: 1 }, new C.RaycastResult()); }
  contribution(e, p, damage = 0, support = 0) {
    if (this.adminActive(p)) return;
    const c = e.contributions.get(p.id) ?? { damage: 0, support: 0, last: this.time };
    c.damage += damage; c.support += support; c.last = this.time; e.contributions.set(p.id, c); e.lastCombat = this.time;
  }
  support(p, target, amount) {
    if (p === target || amount <= 0) return;
    p.support += amount;
    for (const e of this.enemies) if (e.kind === 'boss' && e.hp > 0 && dist(target, e) < 30 && e.contributions.has(target.id)) this.contribution(e, p, 0, amount);
  }
  hitPlayer(p, amount, source, administrative = false) {
    // Check both ends at the instant damage resolves, including delayed attacks.
    if (!this.active(p) || this.adminActive(p) || p.invulnerable > 0 || this.safe(p) || (source && safeAt(source.x, source.z))) return 0;
    if (source?.token && source.party && source.party === p.party) return 0;
    if (administrative && !this.adminActive(source)) return 0;
    const guardian = this.players().find(q => this.active(q) && q.ward > 0 && (q.id === p.id || (q.party && q.party === p.party)) && dist(q, p) < 7);
    if (administrative) amount = p.hp;
    else { if (guardian) { this.support(guardian, p, amount * .6); amount *= .4; } amount *= 1 - p.armor; }
    const actual = Math.min(amount, p.hp); p.hp -= actual; this.effect('hurt', p.x, p.z);
    if (p.hp <= 0) {
      p.dead = 7; p.ward = 0; p.body.velocity.set(0, 0, 0);
      const loss = administrative ? 0 : Math.floor(p.gold * .1); p.gold -= loss;
      if (source?.token && !administrative) { source.gold += loss; this.notify(source, `${p.name} повержен. +${loss} кредитов`); }
      this.notify(p, 'Сигнал потерян. Аварийная эвакуация в поселение.');
    }
    return actual;
  }
  hitEnemy(p, e, amount, administrative = false) {
    if (e.hp <= 0 || this.safe(p) || safeAt(e.x, e.z)) return 0;
    const boss = e.kind === 'boss' ? e : e.parent ? this.enemies.find(b => b.id === e.parent) : null;
    if (administrative) {
      if (!this.adminActive(p)) return 0;
      const actual = e.hp; e.moderated = true; if (boss) boss.moderated = true;
      this.killEnemy(e, p); return actual;
    }
    if (boss && dist(p, { x: boss.sx, z: boss.sz }) >= 30) return 0;
    if (boss?.bossId === 'warden' && (!p.marks.includes('archivist') || !p.marks.includes('resonator'))) return 0;
    if (e.kind === 'boss' && this.enemies.some(t => t.parent === e.id && t.kind === 'pylon' && t.hp > 0)) amount *= .15;
    const actual = Math.min(e.hp, amount); e.hp -= actual; p.damage += actual; this.contribution(e, p, actual);
    e.attackerId = p.id;
    if (boss && boss !== e) this.contribution(boss, p, actual * .4);
    this.effect('hit', e.x, e.z, { amount: Math.round(actual) });
    if (e.hp <= 0) this.killEnemy(e, p);
    return actual;
  }
  xp(p, amount) {
    p.xp += amount;
    while (p.level < 12 && p.xp >= xpFor(p.level)) { p.xp -= xpFor(p.level); p.level++; this.stats(p); this.notify(p, `Уровень ${p.level}. Характеристики повышены.`); }
    if (p.level === 12) p.xp = Math.min(p.xp, xpFor(12));
  }
  drop(p, e, boss = false) {
    let pool = ['pistol', 'shotgun', 'coil', 'vest', 'capacitor'];
    if (boss || e.level >= 4) pool = boss && e.bossId !== 'archivist' ? ['splitter', 'sniper', 'machinegun', 'aegis', 'journal'] : ['carbine', 'sniper', 'machinegun', 'shell', 'memory'];
    this.loot.push({ id: uid(), owner: p.id, x: e.x + (randomInt(101) - 50) / 50, z: e.z + (randomInt(101) - 50) / 50, item: this.item(pool[randomInt(pool.length)]), ttl: 90 });
  }
  killEnemy(e, killer) {
    e.hp = 0; e.body.velocity.set(0, 0, 0); this.effect('destroy', e.x, e.z, { ttl: .8 });
    if (e.kind === 'bomber') { e.behavior = 'disabled'; e.targetId = null; e.aim = null; }
    if (e.kind === 'pylon' || e.parent) { e.dead = 2; return; }
    const spec = BOSSES.find(b => b.id === e.bossId);
    e.dead = spec?.respawn ?? (e.kind === 'bomber' ? BOMBER.respawn : 48);
    if (spec) {
      const winningRaid = new Set(killer.party ? this.parties.get(killer.party) : [killer.id]);
      for (const q of this.sessions.values()) {
        if (e.moderated || this.adminActive(q)) continue;
        const c = e.contributions.get(q.id);
        if (!c || this.time - c.last > 65 || (c.damage < Math.max(80, e.maxHp * .025) && c.support < 100)) continue;
        if (e.bossId === 'warden' && (!q.marks.includes('archivist') || !q.marks.includes('resonator'))) continue;
        this.xp(q, spec.xp); q.gold += spec.gold; this.drop(q, e, true);
        if (!q.marks.includes(e.bossId)) q.marks.push(e.bossId);
        if (e.bossId === 'warden' && winningRaid.has(q.id)) { q.won = true; this.archiveWinner(q); }
        this.notify(q, `${spec.name} уничтожен. +${spec.xp} опыта · +${spec.gold} кредитов`);
      }
      for (const add of this.enemies.filter(a => a.parent === e.id)) { add.hp = 0; add.dead = 1; }
      this.hazards = this.hazards.filter(h => h.source !== e.id);
    } else if (!e.moderated) {
      const eligible = this.players().filter(p => !this.adminActive(p) && dist(p, e) < 26 && (e.contributions.has(p.id) || (killer.party && p.party === killer.party)));
      for (const p of eligible) { this.xp(p, 28 + e.level * 12); p.gold += 12 + e.level * 6; if (randomInt(100) < 55) this.drop(p, e); }
    }
  }
  pylons(boss) { for (const dx of [-7, 7]) this.spawn('pylon', boss.sx + dx, boss.sz - 2, boss.level, null, boss.id); }
  resetEnemy(e) {
    e.hp = e.maxHp; e.x = e.sx; e.z = e.sz; e.body.position.set(e.sx, .8, e.sz); e.body.velocity.set(0, 0, 0); e.cd = 3; e.phase = 1; e.attacks = 0; e.combatTime = 0; e.lastCombat = 0; e.contributions.clear(); e.shieldStarted = false; e.pressure = 7;
    e.burstLeft = 0; e.charging = false; e.attackerId = null; e.moderated = false;
    if (e.kind === 'bomber') this.resetBomber(e);
    for (const a of this.enemies.filter(a => a.parent === e.id)) { a.hp = 0; a.dead = 1; }
    this.hazards = this.hazards.filter(h => h.source !== e.id);
  }
  tick() {
    const dt = STEP; this.time += dt;
    const players = this.players();
    this.effects = this.effects.filter(e => (e.ttl -= dt) > 0);
    this.loot = this.loot.filter(l => (l.ttl -= dt) > 0);
    for (const p of players) {
      p.x = p.body.position.x; p.z = p.body.position.z; p.y = Math.max(0, p.body.position.y - MOVEMENT.radius);
      for (const key of Object.keys(p.cd)) p.cd[key] = Math.max(0, p.cd[key] - dt);
      p.ward -= dt; p.dashTime -= dt; p.invulnerable -= dt;
      if (p.hp <= 0) {
        p.dead -= dt; p.body.velocity.set(0, 0, 0); p.body.force.y = 0; p.moveStart = null;
        if (p.dead <= 0) { p.hp = p.maxHp; p.x = SPAWN.x; p.z = SPAWN.z; p.y = 0; p.climbing = null; p.motionTransition = true; p.body.collisionFilterMask = 1 | 8; p.body.position.set(p.x, MOVEMENT.radius, p.z); p.invulnerable = 2; }
        continue;
      }
      if (this.now() - p.lastInput > 350) p.input = { ...idle(), yaw: p.yaw, pitch: p.pitch };
      const m = p.input; p.yaw = m.yaw; p.pitch = m.pitch;
      this.movePlayer(p, dt);
      if (p.reloading) {
        p.reloading.remaining -= dt;
        if (p.reloading.remaining <= 0) { const { item, spec } = this.weapon(p); if (item?.id === p.reloading.id) item.ammo = spec.magazine; p.reloading = null; }
      }
      if (m.reload) this.reload(p);
      if (m.attack && p.cd.attack === 0 && !this.safe(p) && !p.climbing) {
        this.firePlayer(p);
      }
      if (this.adminActive(p)) continue;
      if (m.skill && p.cd.skill === 0 && (p.role !== 'medic' || p.potions > 0 && players.some(q => q.hp > 0 && q.hp < q.maxHp && (q === p || p.party && q.party === p.party) && dist(p, q) < 9))) {
        p.cd.skill = ROLES[p.role].cooldown;
        if (p.role === 'medic') {
          p.potions--;
          for (const q of players.filter(q => q.hp > 0 && (q === p || (p.party && q.party === p.party)) && dist(p, q) < 9)) {
            const healed = Math.min(q.maxHp - q.hp, 60 + p.level * 7); q.hp += healed; this.support(p, q, healed);
          }
          this.effect('heal', p.x, p.z, { ttl: 1, radius: 9 });
        } else if (p.role === 'guardian') { p.ward = 5; this.effect('ward', p.x, p.z, { ttl: 1, radius: 7 }); }
        else if (!this.safe(p)) {
          for (const e of this.enemies.filter(e => e.hp > 0 && dist(p, e) < 8 && this.visible(p, e))) this.hitEnemy(p, e, p.power * 2.8);
          for (const q of players.filter(q => q !== p && dist(p, q) < 8 && this.visible(p, q))) this.hitPlayer(q, p.power * 2, p);
          this.effect('burst', p.x, p.z, { ttl: .5, radius: 8 });
        }
      }
      if (m.potion && p.potions > 0 && p.cd.potion === 0 && p.hp < p.maxHp) { p.potions--; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * .45); p.cd.potion = 12; this.effect('heal', p.x, p.z, { ttl: .6, radius: 1.5 }); }
      if (m.interact) {
        for (const l of this.loot.filter(l => l.owner === p.id && dist3(p, l) < 3 && l.ttl > 0)) {
          if (p.inventory.length < 32) { p.inventory.push(l.item); l.ttl = 0; this.notify(p, `Получено: ${ITEMS[l.item.type].name}`); }
        }
      }
    }
    for (const e of [...this.enemies]) {
      e.x = e.body.position.x; e.z = e.body.position.z;
      if (e.hp <= 0) {
        e.dead -= dt;
        if (e.dead <= 0) { if (e.parent) { this.removeActorBodies(e); this.enemies = this.enemies.filter(a => a !== e); } else this.resetEnemy(e); }
        continue;
      }
      if (e.kind === 'pylon') continue;
      if (e.kind === 'bomber') { this.tickBomber(e, players, dt); continue; }
      e.cd -= dt;
      const targets = players.filter(p => p.hp > 0 && !this.adminActive(p) && !this.safe(p) && dist(p, { x: e.sx, z: e.sz }) < (e.kind === 'boss' ? 30 : e.attackerId === p.id && this.time - e.lastCombat < 8 ? 44 : 30) && (e.bossId !== 'warden' || (p.marks.includes('archivist') && p.marks.includes('resonator'))));
      const target = targets.sort((a, b) => dist(a, e) - (a.ward > 0 ? 15 : 0) - dist(b, e) + (b.ward > 0 ? 15 : 0))[0];
      if (!target) {
        e.burstLeft = 0; e.charging = false; e.cd = Math.max(e.cd, .2);
        const home = { x: e.sx, z: e.sz }, d = dist(e, home);
        e.body.velocity.set(d > .5 ? (home.x - e.x) / d * 2 : 0, 0, d > .5 ? (home.z - e.z) / d * 2 : 0);
        if (e.hp < e.maxHp && this.time - e.lastCombat > 10) this.resetEnemy(e);
        continue;
      }
      const d = Math.max(.01, dist(e, target)); const speed = e.kind === 'boss' ? 1.2 : 3.1 + e.level * .14;
      e.yaw = Math.atan2(target.x - e.x, -(target.z - e.z));
      const stop = e.kind === 'boss' ? 5 : e.kind === 'sentry' ? 14 : 10;
      const dx = (target.x - e.x) / d, dz = (target.z - e.z) / d;
      const approach = d > stop + 2 ? 1 : e.kind !== 'boss' && d < stop - 2 ? -.55 : 0;
      const strafe = e.kind !== 'boss' && d < stop + 5 ? Math.sin(this.time * .7 + e.sx) * .65 : 0;
      const vx = (dx * approach - dz * strafe) * speed, vz = (dz * approach + dx * strafe) * speed;
      const canMove = !safeAt(e.x + vx * .3, e.z + vz * .3);
      e.body.velocity.set(canMove ? vx : 0, 0, canMove ? vz : 0);
      if (e.kind === 'boss') {
        e.combatTime += dt;
        if (e.bossId === 'warden') {
          e.pressure = (e.pressure ?? 7) - dt;
          if (e.pressure <= 0) {
            e.pressure = 7;
            for (const p of targets) this.hitPlayer(p, 12 + e.combatTime * 1.5, e);
            this.effect('overload', e.x, e.z, { radius: 30, ttl: .8 });
          }
        }
        if (e.bossId !== 'archivist' && !e.shieldStarted) { this.pylons(e); e.shieldStarted = true; }
        const phase = e.hp < e.maxHp * .32 ? 3 : e.hp < e.maxHp * .67 ? 2 : 1;
        if (phase > e.phase) {
          e.phase = phase;
          if (e.bossId !== 'archivist') { for (const t of this.enemies.filter(t => t.kind === 'pylon' && t.parent === e.id)) { t.hp = 0; t.dead = 1; } this.pylons(e); }
          this.spawn('drone', e.sx - 5, e.sz + 5, e.level, null, e.id); this.spawn('drone', e.sx + 5, e.sz + 5, e.level, null, e.id);
        }
        if (e.cd <= 0) {
          const damage = 24 + e.level * 6 + (e.combatTime > 130 ? 45 : 0);
          if (e.bossId === 'resonator' || (e.bossId === 'warden' && e.attacks % 3 === 2)) this.hazard(e, e.x, e.z, 17, 1.9, damage, 5);
          else for (const p of targets) this.hazard(e, p.x, p.z, e.bossId === 'warden' ? 4 : 3, 1.5, damage);
          if (e.bossId === 'warden' && e.phase === 3) this.hazard(e, target.x, target.z, 4, 2.1, damage);
          e.attacks++; e.cd = Math.max(1.7, 3.4 - e.phase * .3 - (e.combatTime > 130 ? .5 : 0));
        }
      } else this.tickGun(e, target, d);
    }
    this.world.step(dt);
    const grounded = new Set();
    for (const contact of this.world.contacts) { if (contact.ni.y < -.5) grounded.add(contact.bi); if (contact.ni.y > .5) grounded.add(contact.bj); }
    for (const p of players) {
      if (p.moveStart && !p.motionTransition && !p.climbing && Math.hypot(p.body.position.x - p.moveStart.x, p.body.position.z - p.moveStart.z) > (p.moveBudget ?? 1) + .15) {
        p.body.position.x = p.moveStart.x; p.body.position.z = p.moveStart.z; p.corrections++;
      }
      p.x = p.body.position.x; p.z = p.body.position.z; p.y = Math.max(0, p.body.position.y - MOVEMENT.radius); p.grounded = grounded.has(p.body) && !p.climbing;
    }
    for (const e of this.enemies) { e.x = e.body.position.x; e.z = e.body.position.z; this.syncHitbox(e); }
    for (const p of this.sessions.values()) if (p.body) this.syncHitbox(p);
    this.world.broadphase.dirty = true;
    this.tickProjectiles(dt);
    for (const e of this.enemies) if (e.kind === 'bomber' && e.hp > 0 && e.behavior === 'diving') {
      e.x = e.body.position.x; e.z = e.body.position.z;
      if (e.flightProgress >= 1 || this.safe(e)) this.detonateBomber(e);
    }
    for (const h of this.hazards) {
      h.delay -= dt;
      if (h.delay <= 0) {
        const source = this.enemies.find(e => e.id === h.source);
        if (source?.hp > 0) for (const p of players) { const d = dist(p, h); if (d < h.radius && d >= h.inner) this.hitPlayer(p, h.damage, source); }
        this.effect('explosion', h.x, h.z, { radius: h.radius, inner: h.inner, ttl: .45 });
      }
    }
    this.hazards = this.hazards.filter(h => h.delay > 0);
  }
  publicPlayer(q) { return { id: q.id, name: q.name, role: q.role, level: q.level, x: q.x, y: q.y, z: q.z, yaw: q.yaw, pitch: q.pitch, hp: q.hp, maxHp: q.maxHp, weapon: this.weapon(q).type, adminMode: this.adminActive(q), sprinting: !!q.sprinting, climbing: q.climbing, grounded: q.grounded, ward: Math.max(0, q.ward), party: false, safe: !!this.safe(q) }; }
  publicEnemies() {
    const shields = new Set(this.enemies.filter(t => t.kind === 'pylon' && t.hp > 0).map(t => t.parent));
    return this.enemies.map(e => ({ id: e.id, kind: e.kind, bossId: e.bossId, parent: e.parent, x: e.body.position.x, z: e.body.position.z, yaw: e.yaw ?? 0, level: e.level, hp: e.hp, maxHp: e.maxHp, phase: e.phase, dead: Math.max(0, e.dead), charging: !!e.charging, behavior: e.behavior, altitude: e.altitude, flightProgress: e.flightProgress, aim: e.aim, shield: shields.has(e.id) }));
  }
  publicProjectiles() { return this.projectiles.map(s => ({ id: s.id, at: this.time, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, enemy: s.enemy, life: s.life })); }
  snapshot(p, personalOnly = false) {
    const party = this.parties.get(p.party), weapon = this.weapon(p);
    const nearby = personalOnly ? [] : this.framePlayers ? this.playerGrid.near(p.x, p.z, INTEREST_RADIUS) : this.players().map(q => this.publicPlayer(q));
    const visible = new Map(nearby.map(q => [q.id, q]));
    if (party) for (const q of this.players()) if (party.has(q.id)) visible.set(q.id, this.framePlayers?.get(q.id) ?? this.publicPlayer(q));
    const members = [...visible.values()].map(q => party?.has(q.id) ? { ...q, party: true } : q);
    const personal = { type: personalOnly ? 'personal' : 'state', time: this.time, status: 'world', self: { ...this.publicPlayer(p), partyIds: party ? [...party] : [], partyPlayers: personalOnly ? members : [], stamina: p.stamina, ladder: this.ladderNear(p)?.id ?? null, weaponType: weapon.type, ammo: weapon.item?.ammo ?? 0, magazine: weapon.spec.magazine, reload: p.reloading?.remaining ?? 0, xp: p.xp, nextXp: xpFor(p.level), gold: p.gold, potions: p.potions, inventory: p.inventory, equipment: p.equipment, power: p.power, armor: p.armor, marks: p.marks, dead: Math.max(0, p.dead), cd: p.cd, partyCode: p.party, damage: Math.round(p.damage), support: Math.round(p.support), shop: this.shop(p)?.id ?? null, zone: this.safe(p)?.name ?? null }, loot: this.loot.filter(l => l.owner === p.id && l.ttl > 0), reward: p.won ? { flag: this.flag, clue: CLUE } : null };
    personal.self.admin = this.isAdmin(p.providerId) ? { enabled: this.adminActive(p), weapon: !!p.admin?.weapon, following: p.admin?.following ?? null } : null;
    personal.self.characterRevision = p.characterRevision; personal.self.canRecreate = this.canRecreate(p); personal.self.recreateWait = Math.max(0, Math.ceil((p.recreateAfter - this.now()) / 1000));
    if (weapon.type === 'admin') personal.self.ammo = 1;
    if (personalOnly) { personal.ownEffects = this.ownStreamEffects?.get(p.id) ?? []; return personal; }
    return { ...personal,
      players: members,
      enemies: (this.frameEnemies ?? this.publicEnemies()).filter(e => e.kind === 'boss' || dist(e, p) < INTEREST_RADIUS),
      projectiles: (this.frameProjectiles ?? this.publicProjectiles()).filter(s => dist(s, p) < INTEREST_RADIUS + 16),
      hazards: this.hazards.filter(h => dist(h, p) < INTEREST_RADIUS).map(({ damage, ...h }) => h), effects: this.effects.filter(e => dist(e, p) < INTEREST_RADIUS), loot: this.loot.filter(l => l.owner === p.id && l.ttl > 0),
      reward: p.won ? { flag: this.flag, clue: CLUE } : null,
    };
  }
  broadcast() {
    const players = this.players(); this.framePlayers = new Map(players.map(p => [p.id, this.publicPlayer(p)])); this.playerGrid.rebuild(this.framePlayers.values());
    this.frameEnemies = this.publicEnemies(); this.frameProjectiles = this.publicProjectiles();
    for (const p of players) this.send(p, this.snapshot(p));
    this.framePlayers = null; this.frameEnemies = null; this.frameProjectiles = null;
  }
  async broadcastWorld(stream) {
    const players = this.players(), publicPlayers = players.map(p => this.publicPlayer(p));
    const enemies = this.publicEnemies(), projectiles = this.publicProjectiles();
    const effects = this.effects.filter(e => e.id > (this.lastStreamEffect ?? 0) && !['hit', 'hurt'].includes(e.kind)).map(e => ({ ...e })), hazards = this.hazards.map(({ damage, ...h }) => h);
    this.lastStreamEffect = this.serial; this.ownStreamEffects = new Map();
    for (const e of effects) if (e.actor) { if (!this.ownStreamEffects.has(e.actor)) this.ownStreamEffects.set(e.actor, []); this.ownStreamEffects.get(e.actor).push(e); }
    const groups = new Map(), time = this.time;
    for (const p of players) { const x = Math.floor(p.x / 64), z = Math.floor(p.z / 64), key = `${x}:${z}`; if (!groups.has(key)) groups.set(key, { x: x * 64 + 32, z: z * 64 + 32, players: [] }); groups.get(key).players.push(p); }
    stream.retain(new Set(groups.keys()));
    for (const [key, group] of groups) {
      const nearby = o => (o.x - group.x) ** 2 + (o.z - group.z) ** 2 < (INTEREST_RADIUS + 46) ** 2;
      const localEffects = effects.filter(nearby);
      const visualEffects = [...localEffects.filter(e => !['gunshot', 'bullet-impact'].includes(e.kind)), ...localEffects.filter(e => e.kind === 'gunshot').slice(-48), ...localEffects.filter(e => e.kind === 'bullet-impact').slice(-48)];
      const frame = { type: 'world', time, self: null, players: publicPlayers.filter(nearby), enemies: enemies.filter(e => e.kind === 'boss' || nearby(e)), projectiles: projectiles.filter(nearby), effects: visualEffects, hazards: hazards.filter(nearby), loot: [] };
      const packets = stream.prepare(key, frame);
      for (const p of group.players) { if (!p.connected) continue; if (p.sendWorld) p.sendWorld(key, packets, this.snapshot(p, true)); else this.send(p, this.snapshot(p)); }
      // Leave the simulation and input handling time between spatial groups.
      await yieldImmediate();
    }
    this.ownStreamEffects = null;
  }
  records() {
    return [...this.sessions.values()].filter(p => p.registered || p.providerId).map(p => Object.fromEntries(['token', 'id', 'providerId', 'registered', 'name', 'role', 'level', 'hp', 'xp', 'gold', 'potions', 'inventory', 'equipment', 'marks', 'won', 'characterRevision', 'recreateAfter'].map(k => [k, p[k]])));
  }
  cleanup() {
    for (const [token, p] of this.sessions) if (!p.connected && this.now() - p.lastSeen > 30 * 60 * 1000) {
      this.leaveParty(p); this.removeActorBodies(p); p.entered = false;
      if (!p.registered && !p.providerId) this.sessions.delete(token);
    }
  }
}
