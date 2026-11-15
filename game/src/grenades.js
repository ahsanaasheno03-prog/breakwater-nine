// Grenades: two kinds, one physics. A thrown grenade is a small sphere under
// gravity that bounces off the floor and the world's boxes (point against
// colliders widened by its radius, pushed out along the shallowest axis), and
// settles when it is slow. The frag charge detonates on a 1.7 s fuse and pays
// damage by distance with a line-of-sight discount — cover works. The flash
// charge pops 0.9 s after its first bounce and blinds by geometry: a fighter
// is blinded when it can see the pop and is facing it, scaled by distance and
// angle, which is why turning away — or a wall — saves you.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { hasLineOfSight } from './weapons.js';

const RADIUS = 0.09;
const GRAVITY = 18;
const FRAG_FUSE = 1.7;
const FRAG_RADIUS = 5.6;
const FRAG_DAMAGE = 112;
const FLASH_RADIUS = 23;

const fragMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.4 });
const fragBand = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
const flashMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.4, metalness: 0.4 });
const flashBand = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink) });

export function createGrenades(scene) {
  const active = [];
  const group = new THREE.Group();
  scene.add(group);
  const geo = new THREE.SphereGeometry(RADIUS, 12, 10);
  const bandGeo = new THREE.TorusGeometry(RADIUS * 0.92, 0.018, 6, 16);
  const eye = new THREE.Vector3();
  const toPop = new THREE.Vector3();

  function throwGrenade(kind, from, direction, strength = 15, owner = null) {
    const mesh = new THREE.Mesh(geo, kind === 'frag' ? fragMat : flashMat);
    const band = new THREE.Mesh(bandGeo, kind === 'frag' ? fragBand : flashBand);
    band.rotation.x = Math.PI / 2;
    mesh.add(band);
    mesh.position.copy(from);
    group.add(mesh);
    active.push({
      kind,
      owner,
      mesh,
      pos: mesh.position,
      vel: new THREE.Vector3(direction.x * strength, direction.y * strength + 3.2, direction.z * strength),
      fuse: kind === 'frag' ? FRAG_FUSE : Infinity,
      bounced: false,
      flashAt: null,
      dead: false,
    });
  }

  function explodeFrag(g, hooks) {
    hooks.onExplosion(g.pos, FRAG_RADIUS);
    for (const fighter of hooks.fighters) {
      if (!fighter.alive) continue;
      eye.set(fighter.pos.x, fighter.pos.y + fighter.chestHeight, fighter.pos.z);
      const distance = eye.distanceTo(g.pos);
      if (distance > FRAG_RADIUS + 0.4) continue;
      let amount = FRAG_DAMAGE * Math.max(0, 1 - distance / (FRAG_RADIUS + 0.4));
      if (amount <= 0) continue;
      if (!hasLineOfSight(g.pos, eye, hooks.occluders)) amount *= 0.25;
      if (amount >= 1) hooks.applyDamage(fighter, amount, g.owner, 'grenade');
    }
  }

  function popFlash(g, hooks) {
    hooks.onFlash(g.pos);
    for (const fighter of hooks.fighters) {
      if (!fighter.alive) continue;
      eye.set(fighter.pos.x, fighter.pos.y + fighter.eyeHeight, fighter.pos.z);
      const distance = eye.distanceTo(g.pos);
      if (distance > FLASH_RADIUS) continue;
      if (!hasLineOfSight(g.pos, eye, hooks.occluders)) continue;
      toPop.copy(g.pos).sub(eye).normalize();
      // Facing: fighters carry a forward vector; the player passes the camera's.
      const facing = fighter.forward;
      const dot = facing ? facing.dot(toPop) : 1;
      const facingFactor = THREE.MathUtils.clamp((dot + 0.35) / 1.1, 0, 1); // looking away still catches the edge
      const strength = facingFactor * Math.max(0, 1 - distance / FLASH_RADIUS);
      if (strength > 0.05) hooks.applyBlind(fighter, strength);
    }
  }

  function step(dt, world, hooks) {
    for (const g of active) {
      if (g.dead) continue;
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      g.pos.addScaledVector(g.vel, dt);

      // Floor.
      if (g.pos.y < RADIUS) {
        g.pos.y = RADIUS;
        if (Math.abs(g.vel.y) > 1.2) hooks.onBounce(g.pos);
        g.vel.y = Math.abs(g.vel.y) > 1.2 ? -g.vel.y * 0.42 : 0;
        g.vel.x *= 0.72;
        g.vel.z *= 0.72;
        if (g.kind === 'flash' && !g.bounced) {
          g.bounced = true;
          g.flashAt = 0.9;
        }
      }
      // Walls: push out along the shallowest penetration axis, reflect gently.
      for (const c of world.colliders) {
        if (g.pos.x > c.min.x - RADIUS && g.pos.x < c.max.x + RADIUS
          && g.pos.y > c.min.y - RADIUS && g.pos.y < c.max.y + RADIUS
          && g.pos.z > c.min.z - RADIUS && g.pos.z < c.max.z + RADIUS) {
          const dxl = g.pos.x - (c.min.x - RADIUS);
          const dxr = (c.max.x + RADIUS) - g.pos.x;
          const dzl = g.pos.z - (c.min.z - RADIUS);
          const dzr = (c.max.z + RADIUS) - g.pos.z;
          const minX = Math.min(dxl, dxr);
          const minZ = Math.min(dzl, dzr);
          if (minX < minZ) {
            g.pos.x = dxl < dxr ? c.min.x - RADIUS : c.max.x + RADIUS;
            g.vel.x = -g.vel.x * 0.42;
          } else {
            g.pos.z = dzl < dzr ? c.min.z - RADIUS : c.max.z + RADIUS;
            g.vel.z = -g.vel.z * 0.42;
          }
          if (g.kind === 'flash' && !g.bounced) {
            g.bounced = true;
            g.flashAt = 0.9;
          }
        }
      }

      if (g.flashAt !== null) {
        g.flashAt -= dt;
        if (g.flashAt <= 0) {
          popFlash(g, hooks);
          g.dead = true;
        }
      }
      if (g.kind === 'frag' && g.fuse <= 0) {
        explodeFrag(g, hooks);
        g.dead = true;
      }
    }
    // Sweep the dead out of the scene and the list.
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].dead) {
        group.remove(active[i].mesh);
        active.splice(i, 1);
      }
    }
  }

  return { throwGrenade, step, active };
}
