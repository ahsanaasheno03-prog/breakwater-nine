// The map: Breakwater Nine, a dusk container port. Two sites in the north — the
// Crane Pad (A) and Fuel Row (B) — three lanes south to the Runners' spawn, and a
// warehouse straddling the middle. Everything is boxes and cylinders in the one
// palette; the ground is a single canvas texture painted with lane lines and the
// two site circles, so the layout reads from any angle. Every solid registers a
// collider for movement and a mesh for bullets, and the waypoint graph the bots
// walk is checked against those colliders when it is built, so a node or an
// edge that a crate blocks is dropped here, never discovered mid-round.
import * as THREE from 'three';
import { PALETTE, SKY_TOP, SKY_HORIZON } from './palette.js';

export const BOUNDS = { minX: -22, maxX: 22, minZ: -16, maxZ: 16 };

const MATERIALS = {};
function material(name, rough = 0.9) {
  if (!MATERIALS[name]) {
    MATERIALS[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: rough,
      metalness: 0.04,
    });
  }
  return MATERIALS[name];
}

// A corrugated-steel canvas texture, tinted by the material colour it rides on:
// vertical ribs and a grime gradient, drawn once and reused by every container.
function containerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(x, 0, 3, 128);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x + 3, 0, 2, 128);
  }
  const grime = g.createLinearGradient(0, 84, 0, 128);
  grime.addColorStop(0, 'rgba(30,20,10,0)');
  grime.addColorStop(1, 'rgba(30,20,10,0.35)');
  g.fillStyle = grime;
  g.fillRect(0, 84, 256, 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function containerMaterial(name) {
  const key = `container-${name}`;
  if (!MATERIALS[key]) {
    MATERIALS[key] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: 0.72,
      metalness: 0.22,
      map: containerTexture(),
    });
  }
  return MATERIALS[key];
}

// A soft radial glow, drawn once: lamp halos, the harbour light and the low
// sun all ride on it as additive sprites.
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The yard's name, stencilled across one warehouse wall segment: white and
// sodium letters over the wall's own steel, with a worn accent rule under it.
function signMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const g = canvas.getContext('2d');
  g.fillStyle = PALETTE.surface;
  g.fillRect(0, 0, 512, 384);
  for (let x = 0; x < 512; x += 32) {
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(x, 0, 3, 384);
  }
  g.textAlign = 'center';
  g.fillStyle = PALETTE.ink;
  g.font = 'bold 74px system-ui, sans-serif';
  g.fillText('BREAKWATER', 256, 148);
  g.fillStyle = PALETTE.muted;
  g.font = 'bold 46px system-ui, sans-serif';
  g.fillText('· NINE ·', 256, 214);
  g.fillStyle = PALETTE.accent;
  g.fillRect(56, 248, 400, 9);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0.04 });
}

// The ground: asphalt noise, lane paint and the two site circles with their
// letters, drawn on one 1024x768 canvas mapped over the whole yard.
function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const g = canvas.getContext('2d');
  g.fillStyle = '#3d4956';
  g.fillRect(0, 0, 1024, 768);
  for (let i = 0; i < 9000; i += 1) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2);
  }
  const px = (x) => ((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * 1024;
  const pz = (z) => ((z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ)) * 768;
  const sx = 1024 / (BOUNDS.maxX - BOUNDS.minX);
  g.strokeStyle = 'rgba(236,231,219,0.8)';
  g.lineWidth = 4;
  g.setLineDash([18, 14]);
  for (const laneX of [-14, 0, 14]) {
    g.beginPath();
    g.moveTo(px(laneX), pz(14));
    g.lineTo(px(laneX), pz(-6));
    g.stroke();
  }
  g.setLineDash([]);
  // Yard wear, painted flat but enough to stop the asphalt reading as one
  // clean sheet in the high frames: hatched keep-clear boxes at the warehouse
  // doors, oil stains where trucks idle, puddles holding the sky.
  for (const doorZ of [-3.5, 3.5]) {
    g.save();
    g.beginPath();
    g.rect(px(-2.6), pz(doorZ - 1.7), 5.2 * sx, 3.4 * sx);
    g.clip();
    g.strokeStyle = 'rgba(236,231,219,0.30)';
    g.lineWidth = 3;
    for (let i = -4; i < 9; i += 1) {
      g.beginPath();
      g.moveTo(px(-2.6 + i * 0.9), pz(doorZ + 1.9));
      g.lineTo(px(-2.6 + i * 0.9) + 3.4 * sx, pz(doorZ - 1.9));
      g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(236,231,219,0.4)';
    g.lineWidth = 3;
    g.strokeRect(px(-2.6), pz(doorZ - 1.7), 5.2 * sx, 3.4 * sx);
  }
  for (const [x, z, r, style] of [
    [-8, -1, 1.6, 'rgba(8,10,12,0.50)'], [9, 6, 2.0, 'rgba(8,10,12,0.50)'],
    [-16, 4, 1.3, 'rgba(8,10,12,0.45)'], [4, -13, 1.1, 'rgba(8,10,12,0.45)'],
    [17, -4, 1.5, 'rgba(8,10,12,0.45)'], [-4.5, 9.5, 1.8, 'rgba(168,192,220,0.20)'],
    [11, -1.5, 1.4, 'rgba(168,192,220,0.18)'], [-11.5, -13, 1.2, 'rgba(168,192,220,0.18)'],
  ]) {
    const grad = g.createRadialGradient(px(x), pz(z), 2, px(x), pz(z), r * sx);
    grad.addColorStop(0, style);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px(x), pz(z), r * sx, 0, Math.PI * 2);
    g.fill();
  }
  for (const [siteX, letter] of [[-14, 'A'], [14, 'B']]) {
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(px(siteX), pz(-10.5), 3.4 * sx, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255,140,58,0.95)';
    g.font = 'bold 64px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, px(siteX), pz(-10.5));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  function register(mesh, { collide = true, shoot = true } = {}) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (shoot) shootables.push(mesh);
    return mesh;
  }

  function box(w, h, d, x, z, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, (opts.y ?? h / 2 + (opts.base ?? 0)), z);
    if (opts.base) mesh.position.y = opts.base + h / 2;
    return register(mesh, opts);
  }

  const glowTex = glowTexture();
  function glowSprite(color, scale, opacity) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(color), transparent: true,
      opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sprite.scale.set(scale, scale, 1);
    return sprite;
  }

  // Sky: a big inverted sphere with a two-stop gradient, plus dusk fog.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        horizon: { value: new THREE.Color(SKY_HORIZON) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
    }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(new THREE.Color('#6b5138'), 44, 135);

  // Ground slab.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(46, 0.4, 34),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.96, metalness: 0.02 }),
  );
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // Perimeter walls.
  box(0.5, 5, 34, -22.4, 0, material('surface'));
  box(0.5, 5, 34, 22.4, 0, material('surface'));
  box(45.3, 5, 0.5, 0, -16.4, material('surface'));
  box(45.3, 5, 0.5, 0, 16.4, material('surface'));

  // The warehouse straddling mid: four walls, a door south (centre) and a door
  // north (west), two crates inside. Wall boxes are listed as segments.
  const wallMat = material('surface', 0.85);
  box(3.4, 4, 0.4, -3.5, -3.5, wallMat); // north wall, west segment
  box(4.4, 4, 0.4, 3.0, -3.5, wallMat); // north wall, east segment (door gap x -1.8..0.8)
  box(4.4, 4, 0.4, -3.0, 3.5, wallMat); // south wall, west segment
  box(4.4, 4, 0.4, 3.0, 3.5, signMaterial()); // south wall, east segment: the yard's name (door gap x -0.8..0.8)
  box(0.4, 4, 7.4, -5.2, 0, wallMat); // west wall
  box(0.4, 4, 7.4, 5.2, 0, wallMat); // east wall
  box(10.8, 0.3, 7.8, 0, 0, material('hairline'), { base: 4.0 }); // roof slab
  // Warehouse dressing: roof vents, pilaster strips down both long walls so
  // the flat faces catch the dusk in bands, and a beacon over the roof.
  box(1.2, 0.5, 1.2, -2.5, -1, material('muted'), { base: 4.3, collide: false });
  box(1.2, 0.5, 1.2, 2.5, 1, material('muted'), { base: 4.3, collide: false });
  for (const px2 of [-4.4, -1.2, 1.2, 4.4]) {
    box(0.28, 4, 0.1, px2, 3.72, material('hairline'), { collide: false, shoot: false });
    box(0.28, 4, 0.1, px2, -3.72, material('hairline'), { collide: false, shoot: false });
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
  beacon.position.set(0, 4.55, 0);
  group.add(beacon);
  const beaconGlow = glowSprite(PALETTE.accent, 1.7, 0.55);
  beaconGlow.position.copy(beacon.position);
  group.add(beaconGlow);
  box(1.5, 1.1, 1.5, -2.6, 0.4, material('hairline'));
  box(1.5, 1.1, 1.5, 2.8, -0.6, material('hairline'));

  // Containers: the lanes' bones. Long boxes in the palette's steel.
  const contA = containerMaterial('surface');
  const contB = containerMaterial('hairline');
  const contC = containerMaterial('muted');
  box(6, 2.6, 2.4, -14, -3, contA);
  box(2.4, 2.6, 6, -14, 3.5, contB);
  box(2.4, 2.6, 6, -14, 3.5, contC, { base: 2.6 }); // stacked second level
  box(6, 2.6, 2.4, -19, -9, contB);
  box(2.4, 2.6, 6, -8.5, -10.5, contA);
  box(6, 2.6, 2.4, 14, -3, contA);
  box(2.4, 2.6, 6, 14, 3.5, contB);
  box(2.4, 2.6, 6, 14, 3.5, contC, { base: 2.6 });
  box(6, 2.6, 2.4, 19, -9, contB);
  box(2.4, 2.6, 6, 8.5, -10.5, contA);
  box(6, 2.6, 2.4, -8, 8, contC);
  box(6, 2.6, 2.4, 8, 8, contC);
  box(2.4, 2.6, 6, 0, 12, contC);

  // Crates: crouch-height cover, 1.1 m.
  const crateMat = material('hairline', 0.95);
  for (const [x, z] of [[-4, -8], [4, -8], [-11, -6.8], [11, -6.8], [-3, 6.5], [3, 6.5], [0, -12.8], [-17, 10.5], [17, 10.5], [-20, -1], [20, -1]]) {
    box(1.5, 1.1, 1.5, x, z, crateMat);
  }
  // Low barriers near the spawns.
  box(3.2, 0.55, 0.5, -7, 13.5, material('muted'));
  box(3.2, 0.55, 0.5, 7, 13.5, material('muted'));
  box(3.2, 0.55, 0.5, -7, -14.5, material('muted'));
  box(3.2, 0.55, 0.5, 7, -14.5, material('muted'));

  // Lane dressing: pallet stacks, traffic cones, bollards and a cable coil —
  // low port clutter that gives the long sightlines something to measure
  // against. Every piece is solid, so the waypoint filter below sees the
  // lanes exactly as the players do.
  const palletMat = material('muted', 0.95);
  function palletStack(x, z, levels) {
    for (let i = 0; i < levels; i += 1) {
      box(1.6, 0.14, 1.2, x, z, palletMat, { base: i * 0.34 });
      box(1.5, 0.18, 1.1, x, z, crateMat, { base: i * 0.34 + 0.14 });
    }
  }
  palletStack(-6.5, 10.5, 3);
  palletStack(6.8, 6.8, 2);
  palletStack(-10.5, -1.5, 2);
  palletStack(11, 9, 3);
  const coneMat = material('accent', 0.8);
  for (const [x, z] of [[-1.8, 7.5], [2.2, 7.5], [0.2, 10.8], [-9.5, -12.5], [9.8, -12.2], [-4.5, -5.8]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 10), coneMat);
    cone.position.set(x, 0.21, z);
    register(cone);
  }
  for (const [x, z] of [[-6.2, 4.8], [6.2, 4.8], [-6.2, -4.8], [6.2, -4.8]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.75, 8), material('hairline', 0.6));
    post.position.set(x, 0.38, z);
    register(post);
  }
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.13, 8, 20), material('hairline', 0.9));
  coil.rotation.x = Math.PI / 2;
  coil.position.set(6.1, 0.13, -1.5);
  register(coil);

  // Site A furniture: the crane. Four legs (colliders), beams above (no
  // collider; bullets still stop on them), and a hook block that sways.
  const craneMat = material('accent', 0.6);
  for (const [x, z] of [[-17.2, -13.7], [-10.8, -13.7], [-17.2, -7.3], [-10.8, -7.3]]) {
    box(0.55, 6.4, 0.55, x, z, craneMat);
  }
  box(7.4, 0.5, 0.5, -14, -13.7, craneMat, { collide: false, base: 6.2 });
  box(7.4, 0.5, 0.5, -14, -7.3, craneMat, { collide: false, base: 6.2 });
  box(0.5, 0.5, 6.9, -14, -10.5, craneMat, { collide: false, base: 6.2 });
  const hook = box(0.8, 0.8, 0.8, -13, -10.5, material('hairline'), { collide: false, shoot: false, base: 4.4 });

  // The crane is mid-lift: a container hangs from the bridge beam on four
  // angled cables, over the west edge of Site A. The whole lift hangs from a
  // pivot at the beam so step() can sway it as one piece; it is backdrop and
  // registers no collider, so the site below plays exactly as before.
  const liftPivot = new THREE.Vector3(-14, 6.2, -10.5);
  const liftGroup = new THREE.Group();
  liftGroup.position.copy(liftPivot);
  group.add(liftGroup);
  const slung = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), containerMaterial('muted'));
  slung.position.set(-2.5, -3.2, 0); // centre (-16.5, 3.0, -10.5) in world terms
  slung.castShadow = true;
  slung.receiveShadow = true;
  liftGroup.add(slung);
  const cableMat = material('hairline', 0.6);
  function liftCable(x1, y1, z1, x2, y2, z2) {
    const a = new THREE.Vector3(x1, y1, z1).sub(liftPivot);
    const b = new THREE.Vector3(x2, y2, z2).sub(liftPivot);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, a.distanceTo(b), 6), cableMat);
    cable.position.copy(a).add(b).multiplyScalar(0.5);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    liftGroup.add(cable);
  }
  liftCable(-19.2, 4.3, -11.5, -14.5, 6.2, -11.5);
  liftCable(-13.8, 4.3, -11.5, -13.5, 6.2, -11.5);
  liftCable(-19.2, 4.3, -9.5, -14.5, 6.2, -9.5);
  liftCable(-13.8, 4.3, -9.5, -13.5, 6.2, -9.5);

  // Site B furniture: a horizontal fuel tank and drums.
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.6, 18), material('muted', 0.55));
  tank.rotation.z = Math.PI / 2;
  tank.position.set(14, 1.15, -13.6);
  register(tank);
  const drumMat = material('accent', 0.7);
  for (const [x, z] of [[11.8, -8.6], [16.4, -8.8], [16.2, -12.4]]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 12), drumMat);
    drum.position.set(x, 0.48, z);
    register(drum);
  }
  // Drum clusters down the lanes, in all three drum finishes.
  const drumMats = [drumMat, material('muted', 0.7), material('hairline', 0.7)];
  for (const [x, z, m] of [[5.6, -7.6, 0], [6.3, -7.2, 1], [5.9, -6.6, 2], [-6.2, -13.8, 1], [-5.5, -13.4, 0], [12.5, 5.2, 2], [-12.8, 6.4, 0]]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 12), drumMats[m]);
    drum.position.set(x, 0.48, z);
    register(drum);
  }

  // Lamp posts: sodium points of light down the lanes (visual poles; the
  // lights themselves are cheap points with distance falloff, no shadows).
  const lampMat = material('hairline', 0.6);
  for (const [x, z] of [[-7, -5.5], [7, -5.5], [-7, 5.5], [7, 5.5], [0, -14.5], [-14, -14.5], [14, -14.5]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.6, 8), lampMat);
    pole.position.set(x, 2.3, z);
    register(pole, { shoot: false });
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 46, 20, 1.8);
    lamp.position.set(x, 4.5, z);
    scene.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
    bulb.position.set(x, 4.55, z);
    group.add(bulb);
    const halo = glowSprite(PALETTE.accent, 2.6, 0.5);
    halo.position.set(x, 4.55, z);
    group.add(halo);
  }

  // Dusk air: dust and lamp embers drifting over the yard. One buffer of
  // points, advanced in step() with wrapped heights — no per-frame objects.
  const PARTICLES = 260;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLES * 3);
  const pSeed = new Float32Array(PARTICLES);
  for (let i = 0; i < PARTICLES; i += 1) {
    pPos[i * 3] = -22 + Math.random() * 44;
    pPos[i * 3 + 1] = 0.3 + Math.random() * 5.5;
    pPos[i * 3 + 2] = -16 + Math.random() * 32;
    pSeed[i] = Math.random() * Math.PI * 2;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true,
    opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(particles);

  // Light: a low warm key (the setting sun off the water), a cool fill, and a
  // sky/ground gradient so shadows never go black.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#a8c0dc'), new THREE.Color('#4a3420'), 1.85));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb37a'), 3.1);
  sun.position.set(-18, 16, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d94b8'), 1.4);
  fill.position.set(14, 10, -12);
  scene.add(fill);

  // Distant backdrop, ringing the yard: port cranes north and south, a
  // container ship at anchor beyond the south wall (its lit windows the only
  // bright paint out there), container stacks to the north, and the harbour
  // light on the east horizon. No colliders, no bullet stops; pure depth.
  const silhouette = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1d2c40') });
  const litMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink) });
  function backdropCrane(baseX, baseZ, height) {
    const legL = new THREE.Mesh(new THREE.BoxGeometry(1.2, height, 1.2), silhouette);
    legL.position.set(baseX - 5, height / 2, baseZ);
    const legR = legL.clone();
    legR.position.x = baseX + 5;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(20, 1.2, 1.2), silhouette);
    beam.position.set(baseX, height - 0.4, baseZ);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), silhouette);
    tie.position.set(baseX, height / 2, baseZ);
    group.add(legL, legR, beam, tie);
  }
  backdropCrane(-30, -26, 17);
  backdropCrane(26, -26, 17);
  backdropCrane(-2, -28, 12);
  backdropCrane(-26, 27, 14);
  for (const [x, z, levels] of [[-8, -25, 3], [12, -25.5, 2], [20, 26, 2], [-14, 26.5, 3]]) {
    for (let i = 0; i < levels; i += 1) {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 2.4), silhouette);
      stack.position.set(x, 1.2 + i * 2.4, z);
      group.add(stack);
    }
  }
  // The ship: hull, deckhouses, funnel and deck stacks, riding low and dark.
  const ship = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(27, 3.5, 5), silhouette);
  hull.position.set(0, 1.2, 0);
  ship.add(hull);
  const deckhouse = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 4), silhouette);
  deckhouse.position.set(-9, 4.9, 0);
  ship.add(deckhouse);
  const funnel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3, 1.6), silhouette);
  funnel.position.set(-4.5, 5.4, 0);
  ship.add(funnel);
  for (const cx of [2.5, 9]) {
    const deckStack = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 2.4), silhouette);
    deckStack.position.set(cx, 4, 0);
    ship.add(deckStack);
  }
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), silhouette);
  mast.position.set(13, 6.5, 0);
  ship.add(mast);
  for (let i = 0; i < 6; i += 1) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.06), litMat);
    win.position.set(-11 + i * 3.6, 2.1, -2.53);
    ship.add(win);
  }
  const sternLight = glowSprite(PALETTE.ink, 2.2, 0.5);
  sternLight.position.set(-13.5, 3.4, 0);
  ship.add(sternLight);
  ship.position.set(6, 0, 31);
  group.add(ship);
  // The harbour light, east: a tapered tower with a lit lamp room and halo.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 11, 10), silhouette);
  tower.position.set(31, 5.5, -19);
  group.add(tower);
  const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.1, 10), litMat);
  lampRoom.position.set(31, 11.5, -19);
  group.add(lampRoom);
  const towerGlow = glowSprite(PALETTE.ink, 5, 0.5);
  towerGlow.position.set(31, 11.5, -19);
  group.add(towerGlow);
  // The low sun itself, a soft glow on the south-west horizon.
  const sunGlow = glowSprite(PALETTE.accent, 50, 0.32);
  sunGlow.position.set(-46, 9, 40);
  group.add(sunGlow);

  const sites = {
    A: { id: 'A', name: 'Crane Pad', pos: new THREE.Vector3(-14, 0, -10.5), radius: 3.4 },
    B: { id: 'B', name: 'Fuel Row', pos: new THREE.Vector3(14, 0, -10.5), radius: 3.4 },
  };

  const spawns = {
    warden: [[-5, -14], [-1.8, -14.4], [1.8, -14.4], [5, -14]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    runner: [[-5, 14], [-1.8, 14.4], [1.8, 14.4], [5, 14]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  };

  // Where Warden bots set up: two on A, one on B, one mid (the player roams).
  const holds = {
    A: [new THREE.Vector3(-17.6, 0, -6.2), new THREE.Vector3(-10.6, 0, -13.2)],
    B: [new THREE.Vector3(17.6, 0, -6.2), new THREE.Vector3(10.6, 0, -13.2)],
    mid: [new THREE.Vector3(-5.8, 0, -5.6), new THREE.Vector3(5.8, 0, -5.6)],
  };

  // Waypoints: candidate nodes in open ground, candidate edges between
  // neighbours; both are filtered against the colliders below.
  const nodeList = [
    [-4, 13], [4, 13], [-12, 11.5], [12, 11.5], [-18.5, 7], [18.5, 7],
    [-12, 7], [0, 8], [12, 7], [-7.5, 4.6], [7.5, 4.6], [0, 5.4],
    [-3, 0], [3, 0], [0, 0], [-8, 0.5], [8, 0.5], [-20, -4], [20, -4],
    [-7.5, -4.8], [7.5, -4.8], [0, -5.6], [-11, -5.2], [11, -5.2],
    [-18.5, -5.5], [18.5, -5.5], [-14, -6.2], [14, -6.2], [-5.5, -9], [5.5, -9],
    [-14, -10.5], [14, -10.5], [-14, -14], [14, -14], [0, -11], [-3, -14.2], [3, -14.2],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  const clearRadius = 0.5;
  function pointBlocked(x, z) {
    for (const c of colliders) {
      if (x > c.min.x - clearRadius && x < c.max.x + clearRadius && z > c.min.z - clearRadius && z < c.max.z + clearRadius && c.min.y < 1.6) return true;
    }
    return false;
  }
  function segmentBlocked(a, b) {
    const steps = Math.ceil(a.distanceTo(b) / 0.4);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (pointBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return true;
    }
    return false;
  }

  const nodes = [];
  const nodeIndex = new Map();
  for (const point of nodeList) {
    if (pointBlocked(point.x, point.z)) continue;
    nodeIndex.set(point, nodes.length);
    nodes.push(point);
  }
  const edges = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (nodes[i].distanceTo(nodes[j]) <= 9.5 && !segmentBlocked(nodes[i], nodes[j])) {
        edges[i].push(j);
        edges[j].push(i);
      }
    }
  }

  // Nearest surviving node to a point: the pathfinder's door into the graph.
  function nearestNode(point) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = nodes[i].distanceTo(point);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Breadth-first path over the graph, as a list of points ending at the goal.
  function findPath(from, to) {
    const start = nearestNode(from);
    const goal = nearestNode(to);
    if (start === -1 || goal === -1) return [to.clone()];
    if (start === goal) return [to.clone()];
    const prev = new Array(nodes.length).fill(-1);
    const seen = new Array(nodes.length).fill(false);
    const queue = [start];
    seen[start] = true;
    while (queue.length) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of edges[current]) {
        if (!seen[next]) {
          seen[next] = true;
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (!seen[goal]) return [to.clone()];
    const path = [];
    for (let at = goal; at !== -1; at = prev[at]) path.push(nodes[at]);
    path.reverse();
    path.push(to.clone());
    return path;
  }

  let hookPhase = 0;
  return {
    colliders,
    shootables,
    sites,
    spawns,
    holds,
    nodes,
    findPath,
    pointBlocked,
    group,
    // Idle motion: the crane hook and its suspended load sway, the beacon
    // breathes, and the dusk air drifts upward and wraps around.
    step(dt) {
      hookPhase += dt;
      hook.position.x = -13 + Math.sin(hookPhase * 0.4) * 0.8;
      liftGroup.rotation.z = Math.sin(hookPhase * 0.4) * 0.022;
      liftGroup.rotation.x = Math.cos(hookPhase * 0.31) * 0.016;
      beaconGlow.material.opacity = 0.3 + (0.5 + 0.5 * Math.sin(hookPhase * 2.2)) * 0.45;
      const arr = pGeo.attributes.position.array;
      for (let i = 0; i < PARTICLES; i += 1) {
        arr[i * 3] += Math.sin(hookPhase * 0.5 + pSeed[i]) * dt * 0.12;
        arr[i * 3 + 1] += dt * 0.06 * (0.5 + 0.5 * Math.sin(pSeed[i]));
        if (arr[i * 3 + 1] > 6) arr[i * 3 + 1] = 0.3;
      }
      pGeo.attributes.position.needsUpdate = true;
    },
  };
}
