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

// The ground: asphalt noise, lane paint and the two site circles with their
// letters, drawn on one 1024x768 canvas mapped over the whole yard.
function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const g = canvas.getContext('2d');
  g.fillStyle = '#333d47';
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
  scene.fog = new THREE.Fog(new THREE.Color('#574434'), 36, 120);

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
  box(4.4, 4, 0.4, 3.0, 3.5, wallMat); // south wall, east segment (door gap x -0.8..0.8)
  box(0.4, 4, 7.4, -5.2, 0, wallMat); // west wall
  box(0.4, 4, 7.4, 5.2, 0, wallMat); // east wall
  box(10.8, 0.3, 7.8, 0, 0, material('hairline'), { base: 4.0 }); // roof slab
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
  box(2.4, 2.6, 6, 0, 12, contA);

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

  // Lamp posts: sodium points of light down the lanes (visual poles; the
  // lights themselves are cheap points with distance falloff, no shadows).
  const lampMat = material('hairline', 0.6);
  for (const [x, z] of [[-7, -5.5], [7, -5.5], [-7, 5.5], [7, 5.5], [0, -14.5]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.6, 8), lampMat);
    pole.position.set(x, 2.3, z);
    register(pole, { shoot: false });
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 46, 20, 1.8);
    lamp.position.set(x, 4.5, z);
    scene.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
    bulb.position.set(x, 4.55, z);
    group.add(bulb);
  }

  // Light: a low warm key (the setting sun off the water), a cool fill, and a
  // sky/ground gradient so shadows never go black.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8fa8c8'), new THREE.Color('#3a2a1a'), 1.6));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb37a'), 2.8);
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
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d94b8'), 1.2);
  fill.position.set(14, 10, -12);
  scene.add(fill);

  // Distant silhouettes: two port cranes beyond the north wall, depth for the
  // skyline. No colliders, no bullet stops; pure backdrop.
  const silhouette = new THREE.MeshBasicMaterial({ color: new THREE.Color('#131a24') });
  for (const baseX of [-30, 26]) {
    const legL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 17, 1.2), silhouette);
    legL.position.set(baseX - 5, 8.5, -26);
    const legR = legL.clone();
    legR.position.x = baseX + 5;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(20, 1.2, 1.2), silhouette);
    beam.position.set(baseX, 16.6, -26);
    group.add(legL, legR, beam);
  }

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
    // The crane hook sways a little; the only idle motion in the world.
    step(dt) {
      hookPhase += dt;
      hook.position.x = -13 + Math.sin(hookPhase * 0.4) * 0.8;
    },
  };
}
