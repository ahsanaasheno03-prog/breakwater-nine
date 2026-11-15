// The bots: eight fighters' worth of teammates and opponents. Each bot is a
// fighter (the same shape the player presents: position, eye/head/chest
// heights, health, a loadout) plus a controller. The controller perceives on a
// staggered 10 Hz think — line of sight through the world's own meshes, a
// facing cone, and the noise of recent enemy gunfire — and acts in modes:
// route along the waypoint graph to a goal, fight a seen enemy (burst fire,
// strafing, the odd crouch), hunt a last-known position, hold a site, plant
// the charge, or fetch it when its carrier drops. Shots are real traces
// through weapons.js, so walls, range and headshots rule bots exactly as
// they rule the player; their damage is scaled to 0.8 to keep fights fair.
import * as THREE from 'three';
import { PALETTE, TEAM_COLORS } from './palette.js';
import { WEAPONS, damageAt, spreadFor, stepLoadout, startReload, traceShot, hasLineOfSight } from './weapons.js';

const EYE = 1.55;
const HEAD = 1.55;
const CHEST = 1.05;
const SPEED_ROUTE = 4.6;
const SPEED_HUNT = 5.0;
const SPEED_STRAFE = 2.0;
const BOT_DAMAGE_SCALE = 0.8;
const BOT_BASE_SPREAD = 0.02;

const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8, metalness: 0.1 });
const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.65, metalness: 0.05 });

function buildBody(team) {
  const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLORS[team]), roughness: 0.6, metalness: 0.1 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_COLORS[team]) });
  const group = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.15, 0.78, 0.17);
  const legL = new THREE.Mesh(legGeo, darkMat);
  legL.position.set(-0.11, 0.39, 0);
  const legR = new THREE.Mesh(legGeo, darkMat);
  legR.position.set(0.11, 0.39, 0);
  const upper = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.72, 0.3), teamMat);
  torso.position.y = 1.14;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.34), trimMat);
  vest.position.y = 1.08;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02), glowMat);
  strip.position.set(0, 1.34, -0.17);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skinMat);
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), teamMat);
  helmet.position.y = 1.74;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.52), trimMat);
  gun.position.set(0.2, 1.3, -0.32);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.2, 1.3, -0.66);
  flash.visible = false;
  upper.add(torso, vest, strip, head, helmet, gun, flash);
  group.add(legL, legR, upper);
  group.traverse((mesh) => {
    if (mesh.isMesh) mesh.castShadow = true;
  });
  return { group, upper, legL, legR, flash };
}

let botSerial = 0;

export function createBot(scene, { team, name, rng }) {
  botSerial += 1;
  const body = buildBody(team);
  scene.add(body.group);
  const bot = {
    team,
    name,
    isPlayer: false,
    serial: botSerial,
    pos: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    forward: new THREE.Vector3(0, 0, -1),
    eyeHeight: EYE,
    headHeight: HEAD,
    chestHeight: CHEST,
    health: 100,
    armour: 0,
    alive: true,
    loadout: null, // set by resetForRound
    kills: 0,
    deaths: 0,
    // controller
    mode: 'hold',
    role: 'hold',
    goal: new THREE.Vector3(),
    path: [],
    pathI: 0,
    seenTarget: null,
    lastSeenPos: new THREE.Vector3(),
    lastSeenT: -99,
    acquiredT: -99,
    thinkT: rng() * 0.1,
    burstLeft: 0,
    burstPauseT: 0,
    reaction: 0.3 + rng() * 0.2,
    strafeDir: 1,
    strafeT: 0,
    crouching: false,
    crouchT: 2 + rng() * 3,
    blindT: 0,
    flashT: 0,
    fallT: 0,
    walkPhase: rng() * 6,
    speedNow: 0,
    scanPhase: rng() * 6,
    holdYaw: 0,
    holdOffset: new THREE.Vector3(),
    group: body.group,
    upper: body.upper,
    legL: body.legL,
    legR: body.legR,
    flashMesh: body.flash,
    rng,
  };
  return bot;
}

// Round setup: full health at a spawn, a fresh loadout around the tier weapon
// the match assigns, and a role ('hold' with a point, 'plant' as the carrier,
// 'escort' toward a site offset).
export function resetBot(bot, spawn, yaw, weaponId, role, goal, armour = 0) {
  bot.pos.copy(spawn);
  bot.yaw = yaw;
  bot.pitch = 0;
  bot.health = 100;
  bot.armour = armour;
  bot.alive = true;
  bot.mode = 'route';
  bot.role = role;
  bot.holdYaw = yaw;
  // Where this bot gathers when a charge is planted: spread along the site's
  // south edge, the side the Wardens defend from.
  bot.holdOffset.set(((bot.serial % 3) - 1) * 2.4, 0, 3.6 + (bot.serial % 2) * 1.6);
  bot.goal.copy(goal);
  bot.path = [];
  bot.pathI = 0;
  bot.seenTarget = null;
  bot.lastSeenT = -99;
  bot.burstLeft = 0;
  bot.burstPauseT = 0;
  bot.blindT = 0;
  bot.flashT = 0;
  bot.fallT = 0;
  bot.crouching = false;
  bot.loadout = {
    owned: ['sidearm', weaponId],
    current: weaponId,
    mags: { sidearm: WEAPONS.sidearm.mag, [weaponId]: WEAPONS[weaponId].mag },
    reserves: { sidearm: WEAPONS.sidearm.reserve, [weaponId]: WEAPONS[weaponId].reserve },
    grenades: { frag: 0, flash: 0 },
    grenadeInHand: null,
    armour,
    cooldown: 0,
    reloadLeft: 0,
    triggerHeld: false,
  };
  bot.group.rotation.set(0, yaw, 0);
  bot.group.position.copy(bot.pos);
  bot.upper.position.y = 0;
  bot.group.visible = true;
}

const tmpEye = new THREE.Vector3();
const tmpChest = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpAim = new THREE.Vector3();

function eyeOf(bot, out) {
  return out.set(bot.pos.x, bot.pos.y + bot.eyeHeight, bot.pos.z);
}

// The 10 Hz think: who can I see, what did I just hear.
function perceive(bot, ctx) {
  const now = ctx.time;
  eyeOf(bot, tmpEye);
  let best = null;
  let bestDist = Infinity;
  for (const enemy of ctx.fighters) {
    if (!enemy.alive || enemy.team === bot.team) continue;
    tmpChest.set(enemy.pos.x, enemy.pos.y + enemy.chestHeight, enemy.pos.z);
    const dist = tmpEye.distanceTo(tmpChest);
    if (dist > 62) continue;
    tmpDir.copy(tmpChest).sub(tmpEye).normalize();
    const facing = bot.forward.dot(tmpDir);
    if (facing < 0.25 && dist > 7) continue; // outside the view cone and not close
    if (!hasLineOfSight(tmpEye, tmpChest, ctx.world.shootables)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = enemy;
    }
  }
  if (best) {
    if (bot.seenTarget !== best) bot.acquiredT = now;
    bot.seenTarget = best;
    bot.lastSeenPos.set(best.pos.x, best.pos.y, best.pos.z);
    bot.lastSeenT = now;
  } else {
    bot.seenTarget = null;
    // Hearing: an enemy shot nearby in the last 1.6 s is worth a look.
    for (const event of ctx.noise) {
      if (event.team !== bot.team && now - event.t < 1.6 && event.pos.distanceTo(bot.pos) < 21) {
        bot.lastSeenPos.copy(event.pos);
        bot.lastSeenT = now;
      }
    }
  }
}

// 2D movement with collision: circle against the world's boxes (only those
// tall enough to matter at ground level), plus a gentle separation from other
// fighters so a squad never stacks into one body.
function move(bot, vx, vz, dt, ctx) {
  bot.pos.x += vx * dt;
  bot.pos.z += vz * dt;
  const r = 0.34;
  for (const c of ctx.world.colliders) {
    if (c.min.y > 1.6) continue;
    const nx = Math.max(c.min.x, Math.min(bot.pos.x, c.max.x));
    const nz = Math.max(c.min.z, Math.min(bot.pos.z, c.max.z));
    const dx = bot.pos.x - nx;
    const dz = bot.pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        bot.pos.x = nx + (dx / d) * r;
        bot.pos.z = nz + (dz / d) * r;
      } else {
        bot.pos.x = c.max.x + r;
      }
    }
  }
  for (const other of ctx.fighters) {
    if (other === bot || !other.alive) continue;
    const dx = bot.pos.x - other.pos.x;
    const dz = bot.pos.z - other.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.49 && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      bot.pos.x += (dx / d) * (0.7 - d) * 0.5;
      bot.pos.z += (dz / d) * (0.7 - d) * 0.5;
    }
  }
  bot.pos.x = Math.max(-21.4, Math.min(21.4, bot.pos.x));
  bot.pos.z = Math.max(-15.4, Math.min(15.4, bot.pos.z));
  bot.speedNow = Math.hypot(vx, vz);
}

function faceToward(bot, point, dt, rate = 10) {
  const want = Math.atan2(-(point.x - bot.pos.x), -(point.z - bot.pos.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += diff * Math.min(1, dt * rate);
}

function followPath(bot, dt, ctx, speed) {
  if (bot.pathI >= bot.path.length) return true;
  const target = bot.path[bot.pathI];
  const dx = target.x - bot.pos.x;
  const dz = target.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.55) {
    bot.pathI += 1;
    return bot.pathI >= bot.path.length;
  }
  faceToward(bot, target, dt);
  move(bot, (dx / dist) * speed, (dz / dist) * speed, dt, ctx);
  return false;
}

function setGoal(bot, ctx, point) {
  if (bot.goal.distanceToSquared(point) < 0.25 && bot.path.length) return;
  bot.goal.copy(point);
  bot.path = ctx.world.findPath(bot.pos, point);
  bot.pathI = 0;
}

// One shot from the bot's gun, traced like the player's.
function botShoot(bot, ctx) {
  const spec = WEAPONS[bot.loadout.current];
  const target = bot.seenTarget;
  bot.loadout.mags[bot.loadout.current] -= 1;
  bot.loadout.cooldown = 60 / spec.rpm;
  bot.flashT = 0.05;
  eyeOf(bot, tmpMuzzle);
  tmpMuzzle.addScaledVector(bot.forward, 0.4);
  tmpMuzzle.y -= 0.12;
  // Aim at the chest, sometimes the head; the shot blooms with the bot's own
  // movement and a fixed skill spread.
  const aimHead = bot.rng() < 0.25;
  tmpAim.set(
    target.pos.x + (bot.rng() * 2 - 1) * 0.12,
    target.pos.y + (aimHead ? target.headHeight : target.chestHeight),
    target.pos.z + (bot.rng() * 2 - 1) * 0.12,
  );
  tmpDir.copy(tmpAim).sub(tmpMuzzle).normalize();
  const spread = spreadFor(spec, bot.speedNow, { crouching: bot.crouching }) + BOT_BASE_SPREAD;
  tmpDir.x += (bot.rng() * 2 - 1) * spread;
  tmpDir.y += (bot.rng() * 2 - 1) * spread;
  tmpDir.z += (bot.rng() * 2 - 1) * spread;
  tmpDir.normalize();
  const hit = traceShot(tmpMuzzle, tmpDir, 90, ctx.world.shootables, ctx.fighters, bot.team, null);
  const end = hit ? hit.point : tmpAim;
  ctx.onShot(bot, tmpMuzzle, end, spec.id);
  if (hit && hit.kind === 'fighter') {
    ctx.applyDamage(hit.fighter, damageAt(spec, hit.distance, hit.part) * BOT_DAMAGE_SCALE, bot, hit.part, 'gun');
  }
  ctx.noise.push({ pos: bot.pos.clone(), team: bot.team, t: ctx.time });
}

export function stepBot(bot, dt, ctx) {
  const now = ctx.time;
  if (!bot.alive) {
    // Death: tip over, then lie still.
    if (bot.fallT < 1) {
      bot.fallT = Math.min(1, bot.fallT + dt / 0.35);
      bot.group.rotation.x = -bot.fallT * 1.5;
      bot.group.position.y = bot.pos.y - bot.fallT * 0.1;
    }
    return;
  }

  stepLoadout(bot.loadout, dt);
  bot.flashT = Math.max(0, bot.flashT - dt);
  bot.flashMesh.visible = bot.flashT > 0;

  bot.thinkT -= dt;
  if (bot.thinkT <= 0) {
    bot.thinkT = 0.1 + bot.rng() * 0.04;
    if (bot.blindT <= 0) perceive(bot, ctx);
  }

  bot.forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
  const fighting = ctx.canFight && bot.seenTarget && now - bot.acquiredT >= 0;
  const freshTarget = bot.seenTarget !== null;
  const targetFresh = now - bot.lastSeenT < 1.4;

  // Crouch rhythm: in a fight, dip now and then; holders stay low.
  bot.crouchT -= dt;
  if (bot.crouchT <= 0) {
    bot.crouching = !bot.crouching && (bot.mode === 'hold' || fighting);
    bot.crouchT = 1.6 + bot.rng() * 2.6;
  }
  const crouchDrop = bot.crouching ? -0.46 : 0;
  bot.upper.position.y += (crouchDrop - bot.upper.position.y) * Math.min(1, dt * 10);
  bot.eyeHeight = bot.crouching ? 1.04 : EYE;
  bot.headHeight = bot.crouching ? 1.02 : HEAD;
  bot.chestHeight = bot.crouching ? 0.72 : CHEST;

  let moving = false;

  if (bot.blindT > 0) {
    bot.blindT -= dt;
    bot.yaw += Math.sin(now * 1.7 + bot.serial) * dt * 0.4; // hands-up confusion, no fire
  } else if (freshTarget && ctx.canFight) {
    // Fight: face the target, strafe across its aim, fire in bursts.
    const target = bot.seenTarget;
    faceToward(bot, target.pos, dt, 14);
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeDir = bot.rng() < 0.5 ? -1 : 1;
      bot.strafeT = 0.6 + bot.rng() * 0.8;
    }
    const px = -bot.forward.z * bot.strafeDir;
    const pz = bot.forward.x * bot.strafeDir;
    move(bot, px * SPEED_STRAFE, pz * SPEED_STRAFE, dt, ctx);
    moving = true;

    if (now - bot.acquiredT >= bot.reaction) {
      if (bot.burstPauseT > 0) {
        bot.burstPauseT -= dt;
      } else if (bot.loadout.mags[bot.loadout.current] <= 0) {
        startReload(bot.loadout);
        bot.burstPauseT = 0.4;
      } else if (bot.loadout.cooldown <= 0 && bot.loadout.reloadLeft <= 0) {
        botShoot(bot, ctx);
        bot.burstLeft -= 1;
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(bot.rng() * 3);
          bot.burstPauseT = 0.45 + bot.rng() * 0.5;
        }
      }
    }
  } else if (targetFresh && ctx.canFight) {
    // Hunt the last place the enemy was seen or heard.
    setGoal(bot, ctx, bot.lastSeenPos);
    moving = !followPath(bot, dt, ctx, SPEED_HUNT);
    if (!moving) bot.lastSeenT = -99;
  } else {
    // Role work.
    const charge = ctx.charge;
    if (bot.team === 'runner' && charge.state === 'dropped' && charge.carrier !== bot) {
      // The nearest living Runner fetches the charge; everyone computes the
      // same answer, so exactly one goes.
      let nearest = null;
      let nearestDist = Infinity;
      for (const f of ctx.fighters) {
        if (f.team === 'runner' && f.alive && !f.isPlayer) {
          const d = f.pos.distanceTo(charge.pos);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = f;
          }
        }
      }
      if (nearest === bot) {
        setGoal(bot, ctx, charge.pos);
        moving = !followPath(bot, dt, ctx, SPEED_HUNT);
        if (!moving || bot.pos.distanceTo(charge.pos) < 0.9) ctx.pickupCharge(bot);
      } else {
        setGoal(bot, ctx, bot.goal);
        moving = !followPath(bot, dt, ctx, SPEED_ROUTE);
      }
    } else if (bot.role === 'plant' && charge.state === 'carried' && charge.carrier === bot) {
      const site = charge.targetSite;
      setGoal(bot, ctx, site.pos);
      const atSite = bot.pos.distanceTo(site.pos) < 1.3;
      if (!atSite) {
        moving = !followPath(bot, dt, ctx, SPEED_ROUTE);
      } else {
        faceToward(bot, { x: site.pos.x, z: site.pos.z - 6 }, dt, 6);
        ctx.plantTick(dt); // rounds.js counts the channel; it may complete the plant
      }
    } else if (charge.state === 'planted' && bot.team === 'warden') {
      // Converge on the planted site and hold its edge.
      tmpAim.copy(charge.site.pos).add(bot.holdOffset);
      setGoal(bot, ctx, tmpAim);
      moving = !followPath(bot, dt, ctx, SPEED_ROUTE);
      bot.mode = moving ? 'route' : 'hold';
    } else {
      setGoal(bot, ctx, bot.goal);
      const arrived = followPath(bot, dt, ctx, SPEED_ROUTE);
      moving = !arrived;
      bot.mode = arrived ? 'hold' : 'route';
      if (arrived) {
        // Hold: scan the lane in a slow sweep.
        bot.scanPhase += dt * 0.5;
        bot.yaw = bot.holdYaw + Math.sin(bot.scanPhase) * 0.55;
        bot.forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      }
    }
  }

  // Walk cycle and body sync.
  if (moving) bot.walkPhase += dt * bot.speedNow * 2.1;
  const swing = moving ? Math.sin(bot.walkPhase) * 0.5 : 0;
  bot.legL.rotation.x = swing;
  bot.legR.rotation.x = -swing;
  bot.group.position.copy(bot.pos);
  bot.group.rotation.y = bot.yaw;
}

export function killBotVisual(bot) {
  bot.fallT = 0;
}
