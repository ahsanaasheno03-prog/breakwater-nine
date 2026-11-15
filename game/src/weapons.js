// The armoury: four guns, one table of numbers, and the per-fighter state of
// owning them. Every gun is hitscan; what separates them is damage, head
// multiplier, cadence, magazine, and how much spread punishes movement — the
// sidearm is free and honest, the SMG forgives running, the carbine rewards
// stopping, the DMR hits like a truck and blooms if you so much as strafe.
// Damage falls away past each gun's falloff start, to a floor of 45%.
//
// The module also builds the first-person view models (boxes in the palette,
// one silhouette per gun) and the shared traceShot every fighter uses, so the
// player's ray and a bot's ray obey exactly the same walls.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  sidearm: {
    id: 'sidearm', name: 'P9 Sidearm', slot: 1, price: 0,
    damage: 30, headMult: 3.4, rpm: 380, auto: false,
    mag: 12, reserve: 48, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.03, falloff: 24, kick: 0.011,
  },
  smg: {
    id: 'smg', name: 'Rook-9 SMG', slot: 2, price: 1400,
    damage: 22, headMult: 3.0, rpm: 800, auto: true,
    mag: 32, reserve: 96, reload: 1.8,
    spreadStill: 0.007, spreadMove: 0.04, falloff: 14, kick: 0.007,
  },
  carbine: {
    id: 'carbine', name: 'VK-7 Carbine', slot: 2, price: 2700,
    damage: 34, headMult: 3.0, rpm: 620, auto: true,
    mag: 30, reserve: 90, reload: 2.1,
    spreadStill: 0.0025, spreadMove: 0.034, falloff: 30, kick: 0.01,
  },
  dmr: {
    id: 'dmr', name: 'Longshot DMR', slot: 2, price: 3100,
    damage: 68, headMult: 1.8, rpm: 150, auto: false,
    mag: 10, reserve: 40, reload: 2.4,
    spreadStill: 0.0008, spreadMove: 0.05, falloff: 55, kick: 0.03,
  },
};

export const ARMOUR_PRICE = 650;
export const GRENADE_PRICES = { frag: 300, flash: 200 };
export const MAX_GRENADES = 2;

// Damage at a distance: full inside the falloff start, easing to 45% at +60 m.
export function damageAt(spec, distance, part) {
  const fall = Math.max(0.45, 1 - Math.max(0, distance - spec.falloff) / 130);
  const base = spec.damage * fall;
  return part === 'head' ? base * spec.headMult : base;
}

// The loadout one fighter carries: owned gun ids, the one in hand, per-gun
// magazine/reserve, grenade counts and armour points. Bots get the same shape
// with simpler contents, so damage and reload rules never fork.
export function createLoadout() {
  return {
    owned: ['sidearm'],
    current: 'sidearm',
    mags: { sidearm: WEAPONS.sidearm.mag },
    reserves: { sidearm: WEAPONS.sidearm.reserve },
    grenades: { frag: 0, flash: 0 },
    grenadeInHand: null, // 'frag' | 'flash' | null (slot 3 holds the last thrown kind)
    armour: 0,
    cooldown: 0,
    reloadLeft: 0,
    triggerHeld: false,
  };
}

export function giveWeapon(loadout, id) {
  if (!loadout.owned.includes(id)) loadout.owned.push(id);
  loadout.mags[id] = WEAPONS[id].mag;
  loadout.reserves[id] = WEAPONS[id].reserve;
}

export function resetLoadout(loadout, keepOwned) {
  if (!keepOwned) {
    loadout.owned = ['sidearm'];
    loadout.grenades = { frag: 0, flash: 0 };
    loadout.armour = 0;
  }
  for (const id of loadout.owned) {
    loadout.mags[id] = WEAPONS[id].mag;
    loadout.reserves[id] = WEAPONS[id].reserve;
  }
  loadout.current = loadout.owned.includes('carbine') ? 'carbine'
    : loadout.owned.includes('dmr') ? 'dmr'
      : loadout.owned.includes('smg') ? 'smg' : 'sidearm';
  loadout.grenadeInHand = null;
  loadout.cooldown = 0;
  loadout.reloadLeft = 0;
}

// Can the gun in hand fire this instant?
export function gunReady(loadout) {
  return loadout.grenadeInHand === null
    && loadout.mags[loadout.current] > 0
    && loadout.cooldown <= 0
    && loadout.reloadLeft <= 0;
}

export function startReload(loadout) {
  const spec = WEAPONS[loadout.current];
  if (loadout.reloadLeft > 0 || loadout.mags[loadout.current] >= spec.mag || loadout.reserves[loadout.current] <= 0) return false;
  loadout.reloadLeft = spec.reload;
  return true;
}

// Per-step bookkeeping shared by the player and the bots: cooldowns and the
// reload landing. Returns true on the step a reload finishes.
export function stepLoadout(loadout, dt) {
  loadout.cooldown = Math.max(0, loadout.cooldown - dt);
  if (loadout.reloadLeft > 0) {
    loadout.reloadLeft = Math.max(0, loadout.reloadLeft - dt);
    if (loadout.reloadLeft === 0) {
      const spec = WEAPONS[loadout.current];
      const take = Math.min(spec.mag - loadout.mags[loadout.current], loadout.reserves[loadout.current]);
      loadout.mags[loadout.current] += take;
      loadout.reserves[loadout.current] -= take;
      return true;
    }
  }
  return false;
}

// Spread in radians for a shot: the gun's still spread plus its movement
// spread scaled by ground speed, tightened by aiming down sights and by
// crouching. Standing still and aimed is the most accurate way to shoot —
// that is the game's central gunplay rule.
export function spreadFor(spec, speed, { aiming = false, crouching = false } = {}) {
  const moveT = Math.min(1, speed / 5.2);
  let spread = spec.spreadStill + moveT * spec.spreadMove;
  if (aiming) spread *= 0.55;
  if (crouching) spread *= 0.8;
  return spread;
}

// --- View models -----------------------------------------------------------

const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.25 });
const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.45, metalness: 0.4 });
const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });

function part(geo, mat, x, y, z) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// One view model per gun, built from boxes: enough silhouette that the player
// can tell at a glance what is in hand. Returns the group plus its muzzle
// anchor; the group is parented to the camera by the caller.
export function buildViewModel(id) {
  const model = new THREE.Group();
  if (id === 'sidearm') {
    model.add(part(new THREE.BoxGeometry(0.055, 0.09, 0.2), darkMat, 0, -0.03, -0.05));
    model.add(part(new THREE.BoxGeometry(0.045, 0.05, 0.24), bodyMat, 0, 0.03, -0.08));
  } else if (id === 'smg') {
    model.add(part(new THREE.BoxGeometry(0.07, 0.11, 0.34), bodyMat, 0, 0, -0.08));
    model.add(part(new THREE.BoxGeometry(0.04, 0.04, 0.2), gripMat, 0, 0.02, -0.32));
    model.add(part(new THREE.BoxGeometry(0.05, 0.16, 0.06), darkMat, 0, -0.12, -0.06));
    model.add(part(new THREE.BoxGeometry(0.06, 0.07, 0.16), gripMat, 0, -0.03, 0.16));
  } else if (id === 'dmr') {
    model.add(part(new THREE.BoxGeometry(0.06, 0.09, 0.5), darkMat, 0, 0, -0.14));
    model.add(part(new THREE.BoxGeometry(0.03, 0.03, 0.34), gripMat, 0, 0.03, -0.52));
    model.add(part(new THREE.BoxGeometry(0.05, 0.07, 0.12), bodyMat, 0, 0.09, -0.1)); // scope block
    model.add(part(new THREE.BoxGeometry(0.05, 0.14, 0.06), gripMat, 0, -0.11, -0.02));
  } else {
    // carbine
    model.add(part(new THREE.BoxGeometry(0.075, 0.1, 0.44), bodyMat, 0, 0, -0.1));
    model.add(part(new THREE.BoxGeometry(0.04, 0.04, 0.3), gripMat, 0, 0.03, -0.42));
    model.add(part(new THREE.BoxGeometry(0.05, 0.15, 0.06), darkMat, 0, -0.12, -0.08));
    model.add(part(new THREE.BoxGeometry(0.065, 0.08, 0.2), gripMat, 0, -0.02, 0.24));
    model.add(part(new THREE.BoxGeometry(0.02, 0.06, 0.02), darkMat, 0, 0.09, -0.3)); // front post
  }
  model.position.set(0.23, -0.19, -0.35);
  return model;
}

export function buildMuzzleFlash() {
  // A radial-gradient sprite (white-hot core fading through orange to
  // transparent), additively blended: reads as a flash bloom, never as a
  // solid card in front of the gun.
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,246,220,1)');
  grad.addColorStop(0.25, 'rgba(255,196,110,0.85)');
  grad.addColorStop(0.6, 'rgba(255,140,58,0.35)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  flash.visible = false;
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  return { flash, light };
}

// --- The shared shot trace -------------------------------------------------

const raycaster = new THREE.Raycaster();
const tmpSphere = new THREE.Sphere();
const tmpOrigin = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

// Cast one hitscan shot. `fighters` are the potential victims (each with
// pos/eye/alive and a team); the shooter's own team is never hit. Fighters are
// tested as two spheres — a head sphere and a chest sphere — against the
// nearest wall hit, so a shot that reaches a wall first stops there. Returns
// { kind: 'wall'|'fighter', fighter?, part?, distance, point } or null.
export function traceShot(origin, direction, maxDistance, occluders, fighters, shooterTeam, out) {
  raycaster.set(origin, direction);
  raycaster.far = maxDistance;
  const wallHit = raycaster.intersectObjects(occluders, false)[0];
  let best = wallHit ? wallHit.distance : maxDistance;
  let result = wallHit ? { kind: 'wall', distance: wallHit.distance, point: wallHit.point } : null;

  for (const fighter of fighters) {
    if (!fighter.alive || fighter.team === shooterTeam) continue;
    // Head sphere.
    tmpSphere.center.set(fighter.pos.x, fighter.pos.y + fighter.headHeight, fighter.pos.z);
    tmpSphere.radius = 0.21;
    let d = rayHitSphere(origin, direction, tmpSphere);
    if (d !== null && d < best) {
      best = d;
      result = { kind: 'fighter', fighter, part: 'head', distance: d, point: tmpOrigin.copy(direction).multiplyScalar(d).add(origin) };
    }
    // Chest sphere.
    tmpSphere.center.set(fighter.pos.x, fighter.pos.y + fighter.chestHeight, fighter.pos.z);
    tmpSphere.radius = 0.37;
    d = rayHitSphere(origin, direction, tmpSphere);
    if (d !== null && d < best) {
      best = d;
      result = { kind: 'fighter', fighter, part: 'torso', distance: d, point: tmpOrigin.copy(direction).multiplyScalar(d).add(origin) };
    }
  }
  if (out && result) Object.assign(out, result);
  return result;
}

const tmpVec = new THREE.Vector3();
function rayHitSphere(origin, direction, sphere) {
  tmpVec.copy(sphere.center).sub(origin);
  const tca = tmpVec.dot(direction);
  if (tca < 0) return null;
  const d2 = tmpVec.lengthSq() - tca * tca;
  const r2 = sphere.radius * sphere.radius;
  if (d2 > r2) return null;
  const t = tca - Math.sqrt(r2 - d2);
  return t >= 0 ? t : null;
}

// Line of sight between two points (eyes, usually): true when no occluder
// blocks the segment. Used by bot perception and grenade flashes.
export function hasLineOfSight(from, to, occluders) {
  tmpDir.copy(to).sub(from);
  const distance = tmpDir.length();
  if (distance < 0.001) return true;
  tmpDir.normalize();
  raycaster.set(from, tmpDir);
  raycaster.far = distance;
  return raycaster.intersectObjects(occluders, false).length === 0;
}
