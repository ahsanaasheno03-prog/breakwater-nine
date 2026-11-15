// The match: rounds, the clock, the charge and the money. One state object,
// stepped once per fixed step, owning every rule that decides who won and
// why — elimination, the round clock, the plant channel (counted here, driven
// by the carrier bot), the defuse, the detonation, and the economy that pays
// for the buy menu. It talks to the rest of the game through events (main.js
// drains them for sound, banners and the killfeed) and through the context it
// is handed each step, so this file never touches the DOM or the renderer.
import * as THREE from 'three';
import { resetBot } from './bots.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const FUSE_TIME = 35;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 4;
export const WIN_MONEY = 1400;
export const LOSS_MONEY = 1000;
export const KILL_MONEY = 300;
export const DEFUSE_MONEY = 300;

const RUNNER_TIERS = [
  ['smg', 'sidearm', 'smg', 'sidearm'],
  ['carbine', 'smg', 'carbine', 'sidearm'],
  ['carbine', 'carbine', 'dmr', 'smg'],
];
const WARDEN_TIERS = [
  ['sidearm', 'smg', 'sidearm'],
  ['carbine', 'smg', 'carbine'],
  ['carbine', 'dmr', 'carbine'],
];
const ESCORT_OFFSETS = [[4.2, 2.6], [-4.2, 2.6], [0, 6.0]];

export function aliveCount(fighters, team) {
  let count = 0;
  for (const f of fighters) if (f.alive && f.team === team) count += 1;
  return count;
}

export function createMatch(rng) {
  return {
    rng,
    phase: 'idle', // buy | live | planted | roundover | matchover
    phaseT: 0,
    round: 0,
    winsNeeded: 7,
    maxRounds: 12,
    score: { warden: 0, runner: 0 },
    timer: ROUND_TIME,
    fuse: FUSE_TIME,
    money: 800,
    lossStreak: 0,
    defusedByPlayer: false,
    matchWinner: null,
    lastReason: '',
    events: [],
    charge: {
      state: 'carried', // carried | dropped | planted | done
      carrier: null,
      pos: new THREE.Vector3(),
      site: null,
      targetSite: null,
      plantT: 0,
      defuseT: 0,
      beepT: 0,
    },
  };
}

// Set up one round: spawns, roles, tier weapons, the carrier, the clock.
// ctx.resetPlayer() puts the player back on their spawn with full health;
// their bought weapons and armour are the buy menu's business, kept in main.
export function nextRound(match, ctx) {
  const { world, fighters } = ctx;
  match.round += 1;
  match.phase = 'buy';
  match.phaseT = BUY_TIME;
  match.timer = ROUND_TIME;
  match.fuse = FUSE_TIME;
  match.defusedByPlayer = false;

  const site = match.rng() < 0.5 ? world.sites.A : world.sites.B;
  const charge = match.charge;
  charge.state = 'carried';
  charge.site = null;
  charge.targetSite = site;
  charge.plantT = 0;
  charge.defuseT = 0;
  charge.beepT = 0;

  const tier = Math.min(2, match.round - 1);
  const bots = fighters.filter((f) => !f.isPlayer);
  const wardens = bots.filter((f) => f.team === 'warden');
  const runners = bots.filter((f) => f.team === 'runner');

  ctx.resetPlayer();
  wardens.forEach((bot, i) => {
    const holdPoints = [world.holds.A[0], world.holds.A[1], world.holds.B[0]];
    resetBot(bot, world.spawns.warden[i + 1], Math.PI, WARDEN_TIERS[tier][i], 'hold', holdPoints[i], tier === 2 ? 50 : 0);
  });
  runners.forEach((bot, i) => {
    if (i === 0) {
      resetBot(bot, world.spawns.runner[0], 0, RUNNER_TIERS[tier][0], 'plant', site.pos, tier === 2 ? 50 : 0);
      charge.carrier = bot;
      charge.pos.copy(bot.pos);
    } else {
      const [ox, oz] = ESCORT_OFFSETS[i - 1];
      const goal = new THREE.Vector3(site.pos.x + ox, 0, site.pos.z + oz);
      resetBot(bot, world.spawns.runner[i], 0, RUNNER_TIERS[tier][i], 'escort', goal, tier === 2 ? 50 : 0);
    }
  });

  match.events.push({ type: 'roundStart', round: match.round, site: site.id });
}

// The carrier's plant channel, ticked by bots.js while it stands on the site.
export function plantTick(match, dt) {
  const charge = match.charge;
  if (match.phase !== 'live' || charge.state !== 'carried') return;
  charge.plantT += dt;
  charge.beepT -= dt;
  if (charge.beepT <= 0) {
    charge.beepT = 0.85;
    match.events.push({ type: 'plantBeep', pos: charge.targetSite.pos });
  }
  if (charge.plantT >= PLANT_TIME) {
    charge.state = 'planted';
    charge.site = charge.targetSite;
    charge.pos.copy(charge.site.pos);
    match.phase = 'planted';
    match.fuse = FUSE_TIME;
    charge.beepT = 0;
    match.events.push({ type: 'planted', site: charge.site.id, pos: charge.pos });
  }
}

export function dropCharge(match, bot) {
  const charge = match.charge;
  if (charge.state !== 'carried' || charge.carrier !== bot) return;
  charge.state = 'dropped';
  charge.carrier = null;
  charge.pos.copy(bot.pos);
  charge.plantT = 0;
  match.events.push({ type: 'chargeDropped', pos: charge.pos.clone() });
}

export function pickupCharge(match, bot) {
  const charge = match.charge;
  if (charge.state !== 'dropped') return;
  charge.state = 'carried';
  charge.carrier = bot;
  bot.role = 'plant';
  match.events.push({ type: 'chargePickup', pos: charge.pos.clone() });
}

function endRound(match, winner, reason) {
  match.score[winner] += 1;
  match.lastReason = reason;
  if (winner === 'warden') {
    match.money += WIN_MONEY + (reason === 'defuse' && match.defusedByPlayer ? DEFUSE_MONEY : 0);
    match.lossStreak = 0;
  } else {
    match.money += LOSS_MONEY + Math.min(600, match.lossStreak * 150);
    match.lossStreak += 1;
  }
  match.charge.state = match.charge.state === 'planted' && reason === 'detonation' ? 'done' : match.charge.state;
  match.phase = 'roundover';
  match.phaseT = 5;
  match.events.push({ type: 'roundEnd', winner, reason, score: { ...match.score } });
}

export function stepMatch(match, dt, ctx) {
  const { fighters } = ctx;
  switch (match.phase) {
    case 'buy': {
      match.phaseT -= dt;
      if (match.phaseT <= 0) {
        match.phase = 'live';
        match.events.push({ type: 'live' });
      }
      break;
    }
    case 'live': {
      match.timer -= dt;
      if (aliveCount(fighters, 'runner') === 0) endRound(match, 'warden', 'elimination');
      else if (aliveCount(fighters, 'warden') === 0) endRound(match, 'runner', 'elimination');
      else if (match.timer <= 0) endRound(match, 'warden', 'time');
      break;
    }
    case 'planted': {
      match.fuse -= dt;
      const charge = match.charge;
      charge.beepT -= dt;
      if (charge.beepT <= 0) {
        charge.beepT = match.fuse > 10 ? 1 : 0.45;
        match.events.push({ type: 'chargeBeep', pos: charge.pos, final: match.fuse <= 3 });
      }
      // The defuse: the player, alive, close, holding E.
      const player = ctx.playerFighter;
      if (ctx.defuseHeld && player.alive && player.pos.distanceTo(charge.pos) < 1.8) {
        charge.defuseT += dt;
        if (charge.defuseT >= DEFUSE_TIME) {
          match.defusedByPlayer = true;
          charge.state = 'done';
          endRound(match, 'warden', 'defuse');
          break;
        }
      } else {
        charge.defuseT = Math.max(0, charge.defuseT - dt * 2);
      }
      if (match.phase === 'planted' && match.fuse <= 0) {
        match.events.push({ type: 'detonate', pos: charge.pos.clone() });
        endRound(match, 'runner', 'detonation');
      }
      break;
    }
    case 'roundover': {
      match.phaseT -= dt;
      if (match.phaseT <= 0) {
        const decided = match.score.warden >= match.winsNeeded
          || match.score.runner >= match.winsNeeded
          || match.round >= match.maxRounds;
        if (decided) {
          match.phase = 'matchover';
          match.matchWinner = match.score.warden === match.score.runner
            ? 'draw'
            : match.score.warden > match.score.runner ? 'warden' : 'runner';
          match.events.push({ type: 'matchEnd', winner: match.matchWinner });
        } else {
          nextRound(match, ctx);
        }
      }
      break;
    }
    default:
      break;
  }
  // The carried charge rides on its carrier.
  const charge = match.charge;
  if (charge.state === 'carried' && charge.carrier) charge.pos.copy(charge.carrier.pos);
}
