// The DOM HUD: everything the player reads. Top centre is the round clock and
// score, top left the minimap, top right the money; health bottom left, the
// gun and grenades bottom right; killfeed, banners, the buy menu and the
// scoreboard over the top. It never touches the simulation — main.js pushes
// values in (each write guarded, so a steady number costs no layout) and
// reads two callbacks out: Play and the buy menu's buttons.
import { PALETTE } from './palette.js';

const OVERLAY_COPY = {
  start: {
    title: 'Breakwater Nine',
    copy: 'Hold the dock. The Runners are coming to plant a breach charge at the Crane Pad or Fuel Row — stop them, or defuse it. First to 7 rounds.',
    action: 'Click to play',
  },
  paused: {
    title: 'Paused',
    copy: 'The round waits for no one, but this menu does. Click to jump back in.',
    action: 'Click to resume',
  },
  matchoverWin: {
    title: 'Match won',
    copy: 'The dock is yours. Final score below — click to play another match.',
    action: 'Play again',
  },
  matchoverLoss: {
    title: 'Match lost',
    copy: 'The Runners took the dock this time. Click to run it back.',
    action: 'Play again',
  },
  matchoverDraw: {
    title: 'Match drawn',
    copy: 'Dead level. Click to settle it with another match.',
    action: 'Play again',
  },
};

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playButton = el('play');
  const buyOverlay = el('buy-overlay');
  const buyItems = el('buy-items');
  const buyMoney = el('buy-money');
  const buyTitle = el('buy-title');
  const buyReady = el('buy-ready');
  const sbOverlay = el('scoreboard-overlay');
  const sbBody = el('scoreboard-body');
  const minimap = el('minimap').getContext('2d');

  const cache = new Map();
  function setText(node, key, value) {
    if (cache.get(key) === value) return;
    cache.set(key, value);
    node.textContent = value;
  }

  let bannerTimer = 0;
  let buyHandler = null;
  let readyHandler = null;
  buyReady.addEventListener('click', () => {
    if (readyHandler) readyHandler();
  });

  return {
    setAmmo(mag, reserve) {
      setText(el('ammo-mag'), 'mag', String(mag));
      setText(el('ammo-reserve'), 'res', `/ ${reserve}`);
      el('ammo').classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      setText(el('weapon-name'), 'wep', name);
    },
    setGrenades(frag, flash, inHand) {
      const parts = [];
      if (frag) parts.push(`Frag ×${frag}`);
      if (flash) parts.push(`Flash ×${flash}`);
      setText(el('grenades-line'), 'nade', inHand ? `${inHand === 'frag' ? 'Frag' : 'Flash'} in hand — G throws` : parts.join(' · '));
    },
    setHealth(hp, armour) {
      const shown = Math.max(0, Math.ceil(hp));
      if (cache.get('hp') !== shown) {
        cache.set('hp', shown);
        el('health-num').innerHTML = `${shown} <small>HP</small>`;
      }
      el('health-fill').style.width = `${Math.max(0, Math.min(100, hp))}%`;
      el('health-fill').style.background = hp <= 30 ? PALETTE.accent : PALETTE.warden;
      setText(el('armour-line'), 'arm', armour > 0 ? `Kevlar ${Math.ceil(armour)}` : '');
    },
    setMoney(money) {
      setText(el('money'), 'money', `$${money}`);
    },
    setClock(match) {
      const planted = match.phase === 'planted';
      const seconds = planted ? match.fuse : match.phase === 'buy' ? match.phaseT : match.timer;
      setText(el('timer'), 'timer', formatClock(seconds));
      el('timer').classList.toggle('low', seconds <= 10 || planted);
      setText(el('round-label'), 'round', match.phase === 'buy' ? `Buy — Round ${match.round}` : `Round ${match.round}`);
      setText(el('score-warden'), 'sw', String(match.score.warden));
      setText(el('score-runner'), 'sr', String(match.score.runner));
    },
    setAlive(wardens, runners) {
      setText(el('alive'), 'alive', `Wardens ${wardens} — Runners ${runners}`);
    },
    hitMarker(killed, holdMs = 90) {
      const marker = el('hitmarker');
      marker.classList.add('on');
      marker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(marker._t);
      marker._t = setTimeout(() => {
        marker.classList.remove('on');
        marker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      const v = el('damage-vignette');
      v.style.opacity = '1';
      clearTimeout(v._t);
      v._t = setTimeout(() => {
        v.style.opacity = '0';
      }, 180);
    },
    setFlash(strength) {
      el('flash-overlay').style.opacity = String(Math.max(0, Math.min(1, strength)));
    },
    banner(title, sub, holdMs = 2600) {
      setText(el('banner-title'), 'bt', title);
      setText(el('banner-sub'), 'bs', sub ?? '');
      el('banner').classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => el('banner').classList.remove('on'), holdMs);
    },
    objective(label, fraction) {
      const box = el('objective');
      if (fraction === null || fraction === undefined) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      setText(el('objective-label'), 'obj', label);
      el('objective-fill').style.width = `${Math.round(fraction * 100)}%`;
    },
    killfeed(html) {
      const feed = el('killfeed');
      const row = document.createElement('div');
      row.innerHTML = html;
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => row.remove(), 4600);
    },
    showOverlay(mode, scoreLine) {
      const text = OVERLAY_COPY[mode];
      if (!text) return;
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = scoreLine ? `${text.copy} ${scoreLine}` : text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
    // The buy menu: main.js owns the shop rules and hands over display rows;
    // a click (or the number keys main routes here) calls back with the key.
    openBuy(round, items, money, onBuy, onReady) {
      buyHandler = onBuy;
      readyHandler = onReady;
      buyTitle.textContent = `Buy — Round ${round}`;
      this.renderBuy(items, money);
      buyOverlay.hidden = false;
    },
    renderBuy(items, money) {
      buyMoney.textContent = `$${money}`;
      buyItems.replaceChildren();
      items.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.disabled = item.disabled;
        const left = document.createElement('span');
        const name = document.createElement('span');
        name.className = 'bname';
        name.textContent = `${index + 1}. ${item.label}`;
        const desc = document.createElement('span');
        desc.className = 'bdesc';
        desc.textContent = item.desc;
        left.append(name, desc);
        const price = document.createElement('span');
        price.className = 'bprice';
        price.textContent = item.owned ? 'Owned' : `$${item.price}`;
        button.append(left, price);
        button.addEventListener('click', () => {
          if (buyHandler) buyHandler(item.key);
        });
        buyItems.append(button);
      });
    },
    buyKey(index) {
      const button = buyItems.children[index];
      if (button && !button.disabled) button.click();
    },
    closeBuy() {
      buyOverlay.hidden = true;
    },
    buyOpen() {
      return !buyOverlay.hidden;
    },
    showScoreboard(rows) {
      sbBody.replaceChildren();
      const head = document.createElement('tr');
      head.innerHTML = '<th>Player</th><th>Team</th><th class="num">K</th><th class="num">D</th><th></th>';
      sbBody.append(head);
      for (const row of rows) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = row.name;
        const team = document.createElement('td');
        team.textContent = row.team === 'warden' ? 'Wardens' : 'Runners';
        team.style.color = row.team === 'warden' ? PALETTE.warden : PALETTE.accent;
        const k = document.createElement('td');
        k.className = 'num';
        k.textContent = String(row.kills);
        const d = document.createElement('td');
        d.className = 'num';
        d.textContent = String(row.deaths);
        const alive = document.createElement('td');
        alive.textContent = row.alive ? '' : 'Down';
        tr.append(name, team, k, d, alive);
        sbBody.append(tr);
      }
      sbOverlay.hidden = false;
    },
    hideScoreboard() {
      sbOverlay.hidden = true;
    },
    // The minimap: colliders as blocks, sites as rings, teammates as teal
    // dots, the player as a white arrow, and recent enemy gunfire as fading
    // orange blips — what a Warden could actually know.
    drawMinimap(world, fighters, player, noiseBlips) {
      const W = 184;
      const H = 148;
      const scale = 4.1;
      const ox = W / 2;
      const oy = H / 2;
      const X = (x) => ox + x * scale;
      const Y = (z) => oy + z * scale;
      minimap.clearRect(0, 0, W, H);
      minimap.fillStyle = 'rgba(13,18,25,0.9)';
      minimap.fillRect(0, 0, W, H);
      minimap.fillStyle = PALETTE.hairline;
      for (const c of world.colliders) {
        if (c.min.y > 1.6) continue;
        minimap.fillRect(X(c.min.x), Y(c.min.z), (c.max.x - c.min.x) * scale, (c.max.z - c.min.z) * scale);
      }
      for (const site of [world.sites.A, world.sites.B]) {
        minimap.strokeStyle = PALETTE.accent;
        minimap.lineWidth = 1.5;
        minimap.beginPath();
        minimap.arc(X(site.pos.x), Y(site.pos.z), site.radius * scale, 0, Math.PI * 2);
        minimap.stroke();
        minimap.fillStyle = PALETTE.accent;
        minimap.font = 'bold 9px system-ui';
        minimap.textAlign = 'center';
        minimap.fillText(site.id, X(site.pos.x), Y(site.pos.z) + 3);
      }
      for (const blip of noiseBlips) {
        minimap.fillStyle = `rgba(255,140,58,${blip.alpha})`;
        minimap.beginPath();
        minimap.arc(X(blip.pos.x), Y(blip.pos.z), 3, 0, Math.PI * 2);
        minimap.fill();
      }
      for (const f of fighters) {
        if (!f.alive || f.isPlayer || f.team !== 'warden') continue;
        minimap.fillStyle = PALETTE.warden;
        minimap.beginPath();
        minimap.arc(X(f.pos.x), Y(f.pos.z), 2.6, 0, Math.PI * 2);
        minimap.fill();
      }
      // The player arrow, pointing where they face.
      minimap.save();
      minimap.translate(X(player.pos.x), Y(player.pos.z));
      minimap.rotate(Math.atan2(player.forward.x, -player.forward.z));
      minimap.fillStyle = PALETTE.ink;
      minimap.beginPath();
      minimap.moveTo(0, -5);
      minimap.lineTo(3.6, 4);
      minimap.lineTo(-3.6, 4);
      minimap.closePath();
      minimap.fill();
      minimap.restore();
    },
  };
}
