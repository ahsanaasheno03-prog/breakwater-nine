// Breakwater Nine: boot, the one loop, and the wiring. A fixed 60 Hz
// simulation (player, bots, grenades, the match clock) feeds a render at the
// display's rate; everything the modules need from each other passes through
// the context object built here, and all damage in the game lands in
// applyDamage, so armour, kill credit, the killfeed and the charge dropping
// behave the same whoever fired.
//
// ?shot=start|buy|play|end with &seed=N stages a deterministic frame for a
// capture, renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE, TEAM_COLORS } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createAudio } from './audio.js';
import {
  WEAPONS, ARMOUR_PRICE, GRENADE_PRICES, createLoadout, giveWeapon, resetLoadout,
  gunReady, startReload, stepLoadout, spreadFor, damageAt, traceShot,
  buildViewModel, buildMuzzleFlash,
} from './weapons.js';
import { createGrenades } from './grenades.js';
import { createBot, resetBot, stepBot } from './bots.js';
import {
  createMatch, nextRound, stepMatch, plantTick, dropCharge, pickupCharge,
  aliveCount, KILL_MONEY, DEFUSE_TIME, PLANT_TIME,
} from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(shot ? seed : (Math.random() * 1e9) | 0);

// --- Scene -----------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Filmic tone mapping with a gentle exposure lift: the dusk scene keeps its
// mood, but shadow detail and the sodium highlights stop crushing to black.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 260);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const grenades = createGrenades(scene);
const player = createPlayer(world.colliders);

// --- Fighters ----------------------------------------------------------------

const playerFighter = {
  team: 'warden', name: 'You', isPlayer: true,
  pos: player.state.position, yaw: 0, forward: new THREE.Vector3(0, 0, 1),
  eyeHeight: 1.6, headHeight: 1.55, chestHeight: 1.05,
  health: 100, armour: 0, alive: true,
  loadout: createLoadout(), kills: 0, deaths: 0,
};

const WARDEN_NAMES = ['Voss', 'Ibarra', 'Kett'];
const RUNNER_NAMES = ['Marlowe', 'Sable', 'Duarte', 'Fen'];
const bots = [];
for (let i = 0; i < 3; i += 1) bots.push(createBot(scene, { team: 'warden', name: WARDEN_NAMES[i], rng }));
for (let i = 0; i < 4; i += 1) bots.push(createBot(scene, { team: 'runner', name: RUNNER_NAMES[i], rng }));
const fighters = [playerFighter, ...bots];

const match = createMatch(rng);
const noise = [];
let time = 0;
let started = false;
let paused = false;
let playerDiedThisRound = false;
let playerFlash = 0;
let shake = 0;
let buyReadyPressed = false;

// --- View models ---------------------------------------------------------------

const viewModels = {};
let flashParts = buildMuzzleFlash();
let viewFlashT = 0;
let viewKick = 0;
function ensureViewModel(id) {
  if (!viewModels[id]) {
    viewModels[id] = buildViewModel(id);
    camera.add(viewModels[id]);
  }
  return viewModels[id];
}
ensureViewModel('sidearm');
camera.add(flashParts.flash, flashParts.light);
flashParts.flash.position.set(0.23, -0.16, -0.9);
flashParts.light.position.set(0.23, -0.14, -0.7);

function currentViewModel() {
  const loadout = playerFighter.loadout;
  for (const id of Object.keys(viewModels)) viewModels[id].visible = id === loadout.current && !loadout.grenadeInHand;
  if (loadout.grenadeInHand) return null;
  return ensureViewModel(loadout.current);
}

// --- Tracers -------------------------------------------------------------------

const TRACER_COUNT = 24;
const tracerPool = [];
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo.clone(), mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
}
let tracerCursor = 0;
const tmpV = new THREE.Vector3();
function spawnTracer(from, to, team) {
  const slot = tracerPool[tracerCursor];
  tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
  const pos = slot.line.geometry.getAttribute('position');
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  slot.line.material.color.set(team === 'warden' ? PALETTE.warden : PALETTE.accent);
  slot.line.material.opacity = 0.55;
  slot.line.visible = true;
  slot.life = 0.07;
}

// --- Combat --------------------------------------------------------------------

function volAt(pos) {
  const d = camera.position.distanceTo(pos);
  return Math.max(0, 1 - d / 48);
}

function applyDamage(fighter, amount, attacker, part, cause) {
  if (!fighter.alive) return false;
  if (match.phase !== 'live' && match.phase !== 'planted') return false;
  let effective = amount;
  if (fighter.armour > 0) {
    effective = amount * 0.5;
    fighter.armour = Math.max(0, fighter.armour - amount * 0.25);
    if (fighter.isPlayer) fighter.loadout.armour = fighter.armour;
  }
  fighter.health -= effective;
  if (fighter.isPlayer) {
    hud.damageFlash();
    audio.hurt(0.8);
    shake = Math.min(0.5, shake + 0.12);
  }
  if (fighter.health > 0) return false;
  fighter.health = 0;
  fighter.alive = false;
  fighter.deaths += 1;
  if (attacker && attacker !== fighter) {
    attacker.kills += 1;
    if (attacker.isPlayer) match.money += KILL_MONEY;
    const colour = (f) => (f.team === 'warden' ? PALETTE.warden : PALETTE.accent);
    hud.killfeed(`<span style="color:${colour(attacker)}">${attacker.name}</span> ▸ <span style="color:${colour(fighter)}">${fighter.name}</span>${part === 'head' ? ' ⌖ headshot' : ''}${cause === 'grenade' ? ' ✸ frag' : ''}`);
  }
  if (fighter.isPlayer) {
    playerDiedThisRound = true;
  } else if (match.charge.carrier === fighter) {
    dropCharge(match, fighter);
    hud.killfeed('The charge is down');
  }
  return true;
}

function onShot(shooter, from, toPoint, weaponId) {
  spawnTracer(from, toPoint, shooter.team);
  if (!shooter.isPlayer) audio.shot(weaponId, volAt(from) * 0.8);
}

const grenadeHooks = {
  fighters,
  occluders: world.shootables,
  applyDamage: (fighter, amount, attacker, cause) => applyDamage(fighter, amount, attacker, null, cause),
  applyBlind(fighter, strength) {
    if (fighter.isPlayer) playerFlash = Math.max(playerFlash, strength);
    else fighter.blindT = Math.max(fighter.blindT ?? 0, 0.8 + strength * 3.2);
  },
  onExplosion(pos) {
    explosionFx(pos);
  },
  onFlash(pos) {
    audio.flashbang(volAt(pos));
    flashLightAt(pos, 26, 0.25);
  },
  onBounce(pos) {
    audio.bounce(volAt(pos));
  },
};

// A reusable burst of light for explosions and flashes.
const burstLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 30, 1.6);
scene.add(burstLight);
let burstT = 0;
function flashLightAt(pos, intensity, seconds) {
  burstLight.position.set(pos.x, pos.y + 0.6, pos.z);
  burstLight.intensity = intensity;
  burstT = seconds;
}
function explosionFx(pos) {
  audio.explosion(volAt(pos));
  flashLightAt(pos, 60, 0.4);
  const d = camera.position.distanceTo(pos);
  if (d < 13) shake = Math.min(0.7, shake + (1 - d / 13) * 0.5);
}

// --- The bot/round context -------------------------------------------------------

const ctx = {
  world,
  fighters,
  time: 0,
  noise,
  canFight: false,
  charge: match.charge,
  plantTick: (dt) => plantTick(match, dt),
  pickupCharge: (bot) => pickupCharge(match, bot),
  applyDamage,
  onShot,
  playerFighter,
  defuseHeld: false,
  resetPlayer,
};

function resetPlayer() {
  player.placeAt(world.spawns.warden[0], Math.PI);
  playerFighter.health = 100;
  playerFighter.alive = true;
  if (playerDiedThisRound) {
    playerFighter.loadout = createLoadout();
    playerFighter.armour = 0;
  } else {
    resetLoadout(playerFighter.loadout, true);
    playerFighter.armour = playerFighter.loadout.armour;
  }
  playerDiedThisRound = false;
  currentViewModel();
}

// --- The buy shop ------------------------------------------------------------------

function buyItems() {
  const loadout = playerFighter.loadout;
  const money = match.money;
  const totalNades = loadout.grenades.frag + loadout.grenades.flash;
  return [
    { key: 'smg', label: 'Rook-9 SMG', desc: 'Fast fire, forgiving on the move', price: WEAPONS.smg.price, owned: loadout.owned.includes('smg'), disabled: loadout.owned.includes('smg') || money < WEAPONS.smg.price },
    { key: 'carbine', label: 'VK-7 Carbine', desc: 'Accurate and hard-hitting', price: WEAPONS.carbine.price, owned: loadout.owned.includes('carbine'), disabled: loadout.owned.includes('carbine') || money < WEAPONS.carbine.price },
    { key: 'dmr', label: 'Longshot DMR', desc: 'Huge damage, blooms if you strafe', price: WEAPONS.dmr.price, owned: loadout.owned.includes('dmr'), disabled: loadout.owned.includes('dmr') || money < WEAPONS.dmr.price },
    { key: 'armour', label: 'Kevlar vest', desc: 'Halves incoming damage', price: ARMOUR_PRICE, owned: playerFighter.armour >= 100, disabled: playerFighter.armour >= 100 || money < ARMOUR_PRICE },
    { key: 'frag', label: 'Frag charge', desc: 'Clears corners and sites', price: GRENADE_PRICES.frag, owned: false, disabled: loadout.grenades.frag >= 2 || totalNades >= 4 || money < GRENADE_PRICES.frag },
    { key: 'flash', label: 'Flash charge', desc: 'Blinds whoever faces it', price: GRENADE_PRICES.flash, owned: false, disabled: loadout.grenades.flash >= 2 || totalNades >= 4 || money < GRENADE_PRICES.flash },
  ];
}

function buy(key) {
  const loadout = playerFighter.loadout;
  const item = buyItems().find((row) => row.key === key);
  if (!item || item.disabled) return;
  match.money -= item.price;
  if (key === 'armour') {
    playerFighter.armour = 100;
    loadout.armour = 100;
  } else if (key === 'frag' || key === 'flash') {
    loadout.grenades[key] += 1;
  } else {
    giveWeapon(loadout, key);
    loadout.current = key;
    ensureViewModel(key);
    currentViewModel();
  }
  audio.buy();
  hud.renderBuy(buyItems(), match.money);
}

function openBuyMenu() {
  hud.openBuy(match.round, buyItems(), match.money, buy, () => {
    buyReadyPressed = true;
    hud.closeBuy();
  });
}

// --- Input wiring --------------------------------------------------------------------

const input = createInput(renderer.domElement, onLockChange);
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (!started) {
    started = true;
    nextRound(match, ctx);
    openBuyMenu();
  } else if (match.phase === 'matchover') {
    restartMatch();
  }
  hud.hideOverlay();
  input.requestLock();
});

function restartMatch() {
  match.score.warden = 0;
  match.score.runner = 0;
  match.round = 0;
  match.money = 800;
  match.lossStreak = 0;
  match.matchWinner = null;
  for (const f of fighters) {
    f.kills = 0;
    f.deaths = 0;
  }
  playerFighter.loadout = createLoadout();
  playerFighter.armour = 0;
  playerDiedThisRound = true; // resetPlayer reads this as "fresh loadout"
  nextRound(match, ctx);
  openBuyMenu();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    paused = false;
    hud.hideOverlay();
  } else if (started && match.phase !== 'matchover' && match.phase !== 'buy') {
    paused = true;
    hud.showOverlay('paused');
  }
}

// --- Player actions --------------------------------------------------------------------

const camDir = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();
let prevFiring = false;
let dryT = 0;

function playerShoot() {
  const loadout = playerFighter.loadout;
  const spec = WEAPONS[loadout.current];
  loadout.mags[loadout.current] -= 1;
  loadout.cooldown = 60 / spec.rpm;
  camera.getWorldDirection(camDir);
  const spread = spreadFor(spec, player.groundSpeed(), { aiming: input.state.aiming, crouching: player.state.crouching });
  camDir.x += (rng() * 2 - 1) * spread;
  camDir.y += (rng() * 2 - 1) * spread;
  camDir.z += (rng() * 2 - 1) * spread;
  camDir.normalize();
  shotOrigin.copy(camera.position);
  const hit = traceShot(shotOrigin, camDir, 120, world.shootables, fighters, 'warden', null);
  audio.shot(spec.id, 1);
  noise.push({ pos: player.state.position.clone(), team: 'warden', t: time });
  viewFlashT = 0.055;
  viewKick = 0.05 + spec.kick;
  player.recoil(spec.kick + rng() * 0.004, (rng() * 2 - 1) * spec.kick * 0.4);
  if (hit) {
    tmpV.copy(shotOrigin).addScaledVector(camDir, 0.6);
    spawnTracer(tmpV, hit.point, 'warden');
    if (hit.kind === 'fighter') {
      const killed = applyDamage(hit.fighter, damageAt(spec, hit.distance, hit.part), playerFighter, hit.part, 'gun');
      hud.hitMarker(killed, shot ? 4000 : 90);
      audio.hit(killed, 0.9);
    }
  }
}

function throwHeldGrenade() {
  const loadout = playerFighter.loadout;
  const kind = loadout.grenadeInHand ?? (loadout.grenades.frag > 0 ? 'frag' : loadout.grenades.flash > 0 ? 'flash' : null);
  if (!kind || loadout.grenades[kind] <= 0) return;
  loadout.grenades[kind] -= 1;
  if (loadout.grenadeInHand === kind && loadout.grenades[kind] <= 0) loadout.grenadeInHand = null;
  camera.getWorldDirection(camDir);
  shotOrigin.copy(camera.position).addScaledVector(camDir, 0.3);
  grenades.throwGrenade(kind, shotOrigin, camDir, 15.5, playerFighter);
  audio.throwIt();
}

function handlePressed(codes) {
  const loadout = playerFighter.loadout;
  for (const code of codes) {
    if (hud.buyOpen() && match.phase === 'buy') {
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5));
        if (n >= 1 && n <= 6) hud.buyKey(n - 1);
      }
      if (code === 'KeyB' || code === 'Enter') {
        buyReadyPressed = true;
        hud.closeBuy();
      }
      continue;
    }
    if (code === 'Digit1') {
      loadout.current = 'sidearm';
      loadout.grenadeInHand = null;
      currentViewModel();
    } else if (code === 'Digit2') {
      const primary = ['carbine', 'dmr', 'smg'].find((id) => loadout.owned.includes(id));
      if (primary) {
        loadout.current = primary;
        loadout.grenadeInHand = null;
        ensureViewModel(primary);
        currentViewModel();
      }
    } else if (code === 'Digit3') {
      const order = [null, 'frag', 'flash'];
      let at = order.indexOf(loadout.grenadeInHand);
      for (let tries = 0; tries < 3; tries += 1) {
        at = (at + 1) % 3;
        const kind = order[at];
        if (kind === null || loadout.grenades[kind] > 0) {
          loadout.grenadeInHand = kind;
          break;
        }
      }
      currentViewModel();
    } else if (code === 'KeyG') {
      if (playerFighter.alive && (match.phase === 'live' || match.phase === 'planted')) throwHeldGrenade();
    } else if (code === 'KeyR') {
      if (startReload(loadout)) audio.reload();
    } else if (code === 'KeyB' && match.phase === 'buy' && !hud.buyOpen()) {
      openBuyMenu();
    }
  }
}

// --- The charge's visible body -----------------------------------------------------------

const chargeMesh = new THREE.Group();
{
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.16, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.4 }),
  );
  bodyMesh.position.y = 0.08;
  const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
  lampMesh.position.y = 0.2;
  chargeMesh.add(bodyMesh, lampMesh);
  chargeMesh.userData.lamp = lampMesh;
  scene.add(chargeMesh);
}

function syncChargeVisual() {
  const charge = match.charge;
  if (charge.state === 'carried' && charge.carrier) {
    chargeMesh.visible = true;
    chargeMesh.position.set(charge.carrier.pos.x, 0.95, charge.carrier.pos.z);
    chargeMesh.rotation.y = charge.carrier.yaw;
    chargeMesh.userData.lamp.visible = Math.sin(time * 4) > 0;
  } else if (charge.state === 'dropped' || charge.state === 'planted') {
    chargeMesh.visible = true;
    chargeMesh.position.set(charge.pos.x, 0, charge.pos.z);
    chargeMesh.rotation.y = 0;
    const rate = charge.state === 'planted' ? (match.fuse > 10 ? 5 : 10) : 2.5;
    chargeMesh.userData.lamp.visible = Math.sin(time * rate) > -0.2;
  } else {
    chargeMesh.visible = false;
  }
}

// --- Events ---------------------------------------------------------------------------------

const REASON_TEXT = {
  eliminationW: 'Enemy team eliminated',
  eliminationR: 'Your team was eliminated',
  time: 'The clock ran out — the dock holds',
  defuse: 'Charge defused',
  detonation: 'The charge detonated',
};

function drainEvents() {
  for (const event of match.events) {
    switch (event.type) {
      case 'roundStart':
        hud.banner(`Round ${event.round}`, `Defend Site ${event.site} — the charge is coming`, 2200);
        if (started && !shot) openBuyMenu();
        break;
      case 'live':
        hud.closeBuy();
        hud.banner('Round live', '', 1100);
        break;
      case 'plantBeep':
        audio.beep(false, volAt(event.pos));
        break;
      case 'planted':
        hud.banner('CHARGE PLANTED', `Site ${event.site} — defuse it, hold E`, 3000);
        audio.plantDone(volAt(event.pos));
        break;
      case 'chargeBeep':
        audio.beep(event.final, volAt(event.pos));
        break;
      case 'detonate':
        explosionFx(event.pos);
        break;
      case 'chargePickup':
        hud.killfeed('A Runner has the charge');
        break;
      case 'roundEnd': {
        const won = event.winner === 'warden';
        const reason = event.reason === 'elimination' ? (won ? REASON_TEXT.eliminationW : REASON_TEXT.eliminationR) : REASON_TEXT[event.reason];
        hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, 3400);
        audio.roundEnd(won);
        break;
      }
      case 'matchEnd': {
        const mode = event.winner === 'warden' ? 'matchoverWin' : event.winner === 'runner' ? 'matchoverLoss' : 'matchoverDraw';
        hud.showOverlay(mode, `Final score — Wardens ${match.score.warden}, Runners ${match.score.runner}.`);
        if (document.pointerLockElement) document.exitPointerLock();
        break;
      }
      default:
        break;
    }
  }
  match.events.length = 0;
}

// --- The fixed-step simulation -----------------------------------------------------------------

function step(dt) {
  time += dt;
  ctx.time = time;
  const phase = match.phase;
  ctx.canFight = phase === 'live' || phase === 'planted';
  ctx.defuseHeld = input.state.keys.has('KeyE');

  if (buyReadyPressed && phase === 'buy') {
    match.phaseT = Math.min(match.phaseT, 0.05);
  }
  buyReadyPressed = false;

  stepMatch(match, dt, ctx);
  drainEvents();

  // Player body (frozen in the buy phase, gone when down).
  if (playerFighter.alive && phase !== 'buy' && phase !== 'idle') {
    player.step(dt, input.state.keys);
  }
  const ps = player.state;
  playerFighter.yaw = ps.yaw;
  playerFighter.forward.set(-Math.sin(ps.yaw), 0, -Math.cos(ps.yaw));
  playerFighter.eyeHeight = ps.eye;
  playerFighter.headHeight = ps.height - 0.17;
  playerFighter.chestHeight = ps.height * 0.62;
  stepLoadout(playerFighter.loadout, dt);

  // Footstep noise: running is heard, walking is not.
  if (playerFighter.alive && ps.onGround && player.groundSpeed() > 4) {
    step.footAt = (step.footAt ?? 0) + player.groundSpeed() * dt;
    if (step.footAt > 2.4) {
      step.footAt = 0;
      noise.push({ pos: ps.position.clone(), team: 'warden', t: time, quiet: true });
    }
  }

  // Bots think and fight in the live phases; in the buy phase they hold their
  // spawns, and at round's end they mill about under canFight = false.
  if (phase !== 'buy' && phase !== 'idle') {
    for (const bot of bots) stepBot(bot, dt, ctx);
  }
  grenades.step(dt, world, grenadeHooks);
  world.step(dt);

  // Prune the noise table to the last two seconds.
  for (let i = noise.length - 1; i >= 0; i -= 1) {
    if (time - noise[i].t > 2) noise.splice(i, 1);
  }
}

// --- Per-frame work: input, camera, HUD ---------------------------------------------------------

const baseFov = 74;
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let minimapT = 0;

function syncCamera() {
  const ps = player.state;
  if (playerFighter.alive) {
    camera.position.set(ps.position.x, ps.position.y + ps.eye, ps.position.z);
    camera.rotation.set(ps.pitch, ps.yaw, 0, 'YXZ');
  } else {
    // Down: the camera settles at the body's side and watches the squad fight on.
    camera.position.set(ps.position.x, ps.position.y + 0.45, ps.position.z);
    camera.rotation.set(-0.12, ps.yaw, 0.35, 'YXZ');
  }
  if (shake > 0.003) {
    camera.rotation.x += (rng() * 2 - 1) * shake * 0.05;
    camera.rotation.y += (rng() * 2 - 1) * shake * 0.05;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }

  if (!paused && !shot) {
    const look = input.takeLook();
    if (playerFighter.alive && match.phase !== 'idle') player.look(look.x, look.y);
    handlePressed(input.takePressed());

    // Firing: automatic guns follow the held trigger; the sidearm and the DMR
    // need a fresh click each shot. A grenade in hand throws instead.
    const loadout = playerFighter.loadout;
    const spec = WEAPONS[loadout.current];
    const trigger = input.state.firing && (spec.auto || !prevFiring);
    prevFiring = input.state.firing;
    if (input.state.firing && playerFighter.alive && ctx.canFight) {
      if (loadout.grenadeInHand) {
        if (!step.threwAt || time - step.threwAt > 0.4) {
          step.threwAt = time;
          throwHeldGrenade();
        }
      } else if (trigger && gunReady(loadout)) {
        playerShoot();
      } else if (trigger && loadout.mags[loadout.current] <= 0 && loadout.cooldown <= 0) {
        if (time - dryT > 0.3) {
          dryT = time;
          audio.dryFire();
          loadout.cooldown = 0.25;
        }
      }
    }

    // The simulation runs at a fixed step; a downed player's squad fights on
    // at triple speed so the round resolves in view.
    const scale = !playerFighter.alive && (match.phase === 'live' || match.phase === 'planted') ? 3 : 1;
    accumulator += rawDt * scale;
    let steps = 0;
    const maxSteps = scale > 1 ? 16 : 6;
    while (accumulator >= FIXED_STEP && steps < maxSteps) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * maxSteps) accumulator = 0;
  }

  // View model life: flash, kick, aim-down-sights settle.
  const loadout = playerFighter.loadout;
  viewFlashT = Math.max(0, viewFlashT - rawDt);
  flashParts.flash.visible = viewFlashT > 0;
  flashParts.flash.rotation.z = viewFlashT * 26;
  flashParts.light.intensity = viewFlashT > 0 ? 16 : 0;
  viewKick += (0 - viewKick) * Math.min(1, rawDt * 13);
  const vm = currentViewModel();
  if (vm) {
    const aiming = input.state.aiming && playerFighter.alive;
    const tx = aiming ? 0 : 0.23;
    const ty = aiming ? -0.148 : -0.19;
    vm.position.x += (tx - vm.position.x) * Math.min(1, rawDt * 11);
    vm.position.y += (ty - vm.position.y) * Math.min(1, rawDt * 11);
    vm.position.z = -0.35 + viewKick;
    vm.rotation.x = viewKick * 2.4 + (loadout.reloadLeft > 0 ? -0.5 * Math.sin((1 - loadout.reloadLeft / WEAPONS[loadout.current].reload) * Math.PI) : 0);
  }
  const targetFov = input.state.aiming && playerFighter.alive ? (loadout.current === 'dmr' ? 38 : 55) : baseFov;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, rawDt * 10);
    camera.updateProjectionMatrix();
  }

  // Tracers fade.
  for (const slot of tracerPool) {
    if (slot.life > 0) {
      slot.life -= rawDt;
      if (slot.life <= 0) slot.line.visible = false;
    }
  }
  // Explosion/flash light decay.
  if (burstT > 0) {
    burstT -= rawDt;
    if (burstT <= 0) burstLight.intensity = 0;
  }
  shake = Math.max(0, shake - rawDt * 1.4);

  // The flashbang white fades over a couple of seconds.
  if (playerFlash > 0) {
    playerFlash = Math.max(0, playerFlash - rawDt / (0.4 + playerFlash * 2.2));
  }
  hud.setFlash(playerFlash);

  syncCamera();
  syncChargeVisual();

  // HUD numbers.
  hud.setClock(match);
  hud.setMoney(match.money);
  hud.setAlive(aliveCount(fighters, 'warden'), aliveCount(fighters, 'runner'));
  hud.setHealth(playerFighter.health, playerFighter.armour);
  if (loadout.grenadeInHand) {
    hud.setWeapon(loadout.grenadeInHand === 'frag' ? 'Frag charge' : 'Flash charge');
    hud.setAmmo(loadout.grenades[loadout.grenadeInHand], 0);
  } else {
    hud.setWeapon(WEAPONS[loadout.current].name);
    hud.setAmmo(loadout.mags[loadout.current], loadout.reserves[loadout.current]);
  }
  hud.setGrenades(loadout.grenades.frag, loadout.grenades.flash, loadout.grenadeInHand);
  if (match.phase === 'planted') {
    if (match.charge.defuseT > 0.05) hud.objective('Defusing', match.charge.defuseT / DEFUSE_TIME);
    else hud.objective('Charge planted', 1 - match.fuse / 35);
  } else if (match.charge.plantT > 0.05 && match.phase === 'live') {
    hud.objective('Charge planting', match.charge.plantT / PLANT_TIME);
  } else {
    hud.objective(null);
  }
  if (input.state.keys.has('Tab')) {
    hud.showScoreboard(fighters.map((f) => ({ name: f.name, team: f.team, kills: f.kills, deaths: f.deaths, alive: f.alive })));
  } else {
    hud.hideScoreboard();
  }
  minimapT -= rawDt;
  if (minimapT <= 0) {
    minimapT = 0.12;
    const blips = noise.filter((n) => n.team === 'runner').map((n) => ({ pos: n.pos, alpha: Math.max(0, 1 - (time - n.t) / 2) }));
    hud.drawMinimap(world, fighters, { pos: player.state.position, forward: playerFighter.forward }, blips);
  }

  renderer.render(scene, camera);
}

// --- Shot modes --------------------------------------------------------------------------------------

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  const vm = currentViewModel();
  if (vm && viewKick) {
    vm.position.z = -0.35 + viewKick;
    vm.rotation.x = viewKick * 2.4;
  }
  flashParts.flash.visible = viewFlashT > 0;
  flashParts.light.intensity = viewFlashT > 0 ? 16 : 0;
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncChargeVisual();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function stageBot(bot, x, z, yaw, weaponId) {
  resetBot(bot, new THREE.Vector3(x, 0, z), yaw, weaponId, 'hold', new THREE.Vector3(x, 0, z), 50);
  bot.group.position.copy(bot.pos);
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  const wardens = bots.filter((b) => b.team === 'warden');
  const runners = bots.filter((b) => b.team === 'runner');
  // Every bot starts from a real spawn with a real loadout; the featured
  // bots below are then re-staged. (Unstaged bots must never be stepped or
  // rendered with a null loadout.)
  wardens.forEach((b, i) => stageBot(b, world.spawns.warden[i + 1].x, world.spawns.warden[i + 1].z, Math.PI, 'carbine'));
  runners.forEach((b, i) => stageBot(b, world.spawns.runner[i].x, world.spawns.runner[i].z, 0, i === 0 ? 'carbine' : 'smg'));

  if (name === 'start') {
    match.phase = 'live';
    match.round = 1;
    player.placeAt(new THREE.Vector3(0.5, 0, -12.6), Math.PI - 0.15);
    player.state.pitch = 0.05;
    stageBot(wardens[0], -4.5, -9, Math.PI, 'carbine');
    stageBot(wardens[1], 5, -10, Math.PI, 'carbine');
    stageBot(runners[0], -6, 2, 0, 'carbine');
    stageBot(runners[1], 3, 4.5, 0, 'smg');
    stageBot(runners[2], 9, -1, 0.4, 'carbine');
    hud.showOverlay('start');
  } else if (name === 'buy') {
    match.phase = 'buy';
    match.phaseT = 12;
    match.round = 3;
    match.score.warden = 2;
    match.score.runner = 1;
    match.money = 2450;
    giveWeapon(playerFighter.loadout, 'carbine');
    playerFighter.loadout.current = 'carbine';
    playerFighter.loadout.grenades.frag = 1;
    player.placeAt(world.spawns.warden[0], Math.PI - 0.28);
    player.state.pitch = 0.02;
    stageBot(wardens[0], -1.8, -14.4, Math.PI, 'carbine');
    stageBot(runners[0], -5, 14, 0, 'smg');
    hud.openBuy(3, buyItems(), match.money, () => {}, () => {});
  } else if (name === 'play') {
    match.phase = 'live';
    match.round = 5;
    match.score.warden = 3;
    match.score.runner = 2;
    match.timer = 47;
    match.money = 1150;
    playerFighter.health = 72;
    playerFighter.armour = 65;
    giveWeapon(playerFighter.loadout, 'carbine');
    const loadout = playerFighter.loadout;
    loadout.current = 'carbine';
    loadout.mags.carbine = 24;
    loadout.grenades.frag = 1;
    loadout.grenades.flash = 1;
    player.placeAt(new THREE.Vector3(-7.5, 0, -4.2), -Math.PI / 2 + 0.15);
    player.state.pitch = 0.01;
    stageBot(wardens[0], -4.2, -8.6, -Math.PI / 2, 'carbine');
    stageBot(wardens[1], -3, -11, Math.PI, 'dmr');
    const target = runners[0];
    stageBot(target, 0.2, -5.5, Math.PI / 2 - 0.15, 'carbine');
    stageBot(runners[1], 6, 3.5, 0, 'smg');
    match.charge.carrier = runners[1];
    match.charge.pos.copy(runners[1].pos);
    settle(2);
    // One shot, frozen mid-flash with the hit marker up.
    viewFlashT = 4;
    viewKick = 0.06;
    hud.hitMarker(true, 60000);
    hud.banner('Contact — mid', 'Runners pushing mid — hold the lanes', 60000);
  } else {
    // end: the defuse, a breath after the round is won.
    match.phase = 'roundover';
    match.round = 9;
    match.score.warden = 7;
    match.score.runner = 4;
    match.charge.state = 'planted';
    match.charge.site = world.sites.A;
    match.charge.pos.copy(world.sites.A.pos);
    match.timer = 23;
    match.money = 2650;
    playerFighter.health = 41;
    giveWeapon(playerFighter.loadout, 'carbine');
    playerFighter.loadout.current = 'carbine';
    playerFighter.loadout.mags.carbine = 17;
    player.placeAt(new THREE.Vector3(-10.8, 0, -7.4), Math.PI * 0.25);
    player.state.pitch = -0.12;
    stageBot(wardens[0], -15.8, -7.6, Math.PI * 0.6, 'carbine');
    stageBot(wardens[1], -16.5, -12.8, -Math.PI / 2 + 0.4, 'carbine');
    const down = runners[0];
    stageBot(down, -12.6, -9.2, 0, 'smg');
    down.alive = false;
    down.health = 0;
    down.fallT = 1;
    down.group.rotation.x = -1.5;
    hud.banner('ROUND WON', 'Charge defused — Wardens take the match 7–4', 60000);
  }
  syncCamera();
  syncChargeVisual();
  hud.setClock(match);
  hud.setMoney(match.money);
  hud.setHealth(playerFighter.health, playerFighter.armour);
  hud.setAlive(aliveCount(fighters, 'warden'), aliveCount(fighters, 'runner'));
  {
    const lo = playerFighter.loadout;
    hud.setWeapon(WEAPONS[lo.current].name);
    hud.setAmmo(lo.mags[lo.current], lo.reserves[lo.current]);
    hud.setGrenades(lo.grenades.frag, lo.grenades.flash, lo.grenadeInHand);
  }
  // The frame loop never runs in shot mode, so paint the minimap once here —
  // the same call the loop makes — or the dossier frames show an empty box.
  playerFighter.forward.set(-Math.sin(player.state.yaw), 0, -Math.cos(player.state.yaw));
  hud.drawMinimap(world, fighters, { pos: player.state.position, forward: playerFighter.forward }, []);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

currentViewModel();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
