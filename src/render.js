// Three.js view of the sim. Sim z (forward) maps to world -z.

import * as THREE from 'three';
import { birdX } from './course.js';
import { POWERS } from './powers.js';
import { isFlipped } from './sim.js';

const VIEW_BEHIND = 14, VIEW_AHEAD = 170;
const VIEW_SIDE = 48;   // how far sideways obstacles are drawn (the sky is endless)
const VORTEX_MAX = 16;

export class Renderer {
  constructor(canvas) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.fogColor = new THREE.Color('#f3d9c4');
    this.scene.fog = new THREE.Fog(this.fogColor, 60, 230);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
    this.camPos = new THREE.Vector3(0, 4.5, 9);
    this.shake = 0;
    this.time = 0;
    this.viewer = -1; // 阴阳天眼: which player this screen belongs to (-1 = shared screen, sees both halves)

    this.buildLights();
    this.buildSky();
    this.buildClouds();
    this.buildPeaks();
    this.buildVortices();
    this.buildObstaclePools();
    this.buildRig();
    this.buildTribulation();
    this.buildParticles();
    this.buildSpeedLines();

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 78 : 62;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- world
  buildLights() {
    this.hemi = new THREE.HemisphereLight('#ffe9d2', '#6d84b8', 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d8', 1.6);
    this.sun.position.set(-30, 50, -40);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // the sun is ahead, so riders are seen from their shadowed side; light them from the camera
    this.fill = new THREE.DirectionalLight('#ffe2d0', 1.1);
    this.fill.position.set(10, 30, 40);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uDark: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vP; uniform float uDark;
        void main(){
          float h = vP.y;
          vec3 top = vec3(0.30,0.42,0.78), mid = vec3(0.98,0.80,0.66), low = vec3(0.96,0.88,0.82);
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, low, clamp(-h*3.0,0.,1.));
          vec3 sunDir = normalize(vec3(-0.35,0.18,-1.0));
          float s = max(dot(vP, sunDir), 0.0);
          c += vec3(1.0,0.75,0.45) * (pow(s, 600.0)*2.0 + pow(s, 12.0)*0.35);
          vec3 storm = vec3(0.16,0.12,0.26);
          c = mix(c, storm, uDark);
          gl_FragColor = vec4(c,1.);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
    this.scene.add(this.sky);
  }

  buildClouds() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#fff6ee', emissive: '#d8c2c8', flatShading: true });
    const N = 260;
    this.clouds = new THREE.InstancedMesh(geo, mat, N);
    this.cloudData = [];
    for (let i = 0; i < N; i++) {
      this.cloudData.push({
        x: (Math.random() - 0.5) * 240, y: -20 - Math.random() * 12,
        z: Math.random() * 360, s: 3 + Math.random() * 6, sy: 0.3 + Math.random() * 0.25,
      });
    }
    this.scene.add(this.clouds);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v3 = new THREE.Vector3();
    this.s3 = new THREE.Vector3();
  }

  buildPeaks() {
    this.peaks = [];
    const rockMat = new THREE.MeshLambertMaterial({ color: '#7d8aa8', flatShading: true });
    const grassMat = new THREE.MeshLambertMaterial({ color: '#7fae8a', flatShading: true });
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const h = 18 + Math.random() * 40, r = 6 + Math.random() * 10;
      const top = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), rockMat);
      top.position.y = h / 2;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, h * 0.3, 6), grassMat);
      cap.position.y = h * 0.86;
      const under = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, h * 0.7, 6), rockMat);
      under.rotation.x = Math.PI; under.position.y = -h * 0.35;
      g.add(top, cap, under);
      const side = i % 2 ? 1 : -1;
      g.userData = { x: side * (45 + Math.random() * 110), y: -10 + Math.random() * 14, z: i * 40 + Math.random() * 30 };
      this.peaks.push(g);
      this.scene.add(g);
    }
  }

  // 罡风漩涡: a round, dark swirling downdraft. Sized per vortex (an ellipse rx × half-length).
  buildVortices() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime;
        void main(){
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float a = atan(d.y, d.x);
          float sw = sin(a * 4.0 + r * 10.0 - uTime * 6.0) * 0.5 + 0.5;
          float rim = 1.0 - smoothstep(0.8, 1.0, r);
          float core = 1.0 - smoothstep(0.0, 0.9, r);
          vec3 col = mix(vec3(0.78, 0.66, 0.98), vec3(0.08, 0.04, 0.16), core * 0.85 + sw * 0.15);
          col += vec3(0.5, 0.35, 0.8) * smoothstep(0.7, 0.92, r) * rim * 0.6;
          float alpha = rim * (0.55 + core * 0.45) * (0.65 + sw * 0.35);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.vortexMat = mat;
    this.vortexPool = [];
    const geo = new THREE.CircleGeometry(1, 48);
    geo.rotateX(-Math.PI / 2);
    // a dark funnel dropping away below the swirl, so it reads as a hole from far off
    const funnelGeo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    funnelGeo.rotateX(Math.PI); funnelGeo.translate(0, -0.5, 0);
    const funnelMat = new THREE.MeshBasicMaterial({ color: '#2a1840', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < VORTEX_MAX; i++) {
      const m = new THREE.Group();
      const disc = new THREE.Mesh(geo, mat);
      const funnel = new THREE.Mesh(funnelGeo, funnelMat);
      funnel.scale.y = 6;
      funnel.renderOrder = -1;
      m.add(funnel, disc);
      m.visible = false;
      this.scene.add(m);
      this.vortexPool.push(m);
    }
    // churning cloud puffs that orbit each vortex rim
    this.RIM = 18;
    this.rimPuffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: '#b9a6dc', emissive: '#3a2a5a', flatShading: true }), this.RIM * VORTEX_MAX);
    this.rimPuffs.frustumCulled = false;
    this.scene.add(this.rimPuffs);
  }

  // ---------------------------------------------------------------- obstacles
  buildObstaclePools() {
    this.pools = { rock: [], bar: [], gate: [], bird: [], stone: [], power: [] };
    this.powerMats = {};
    this.active = new Map();
    const rockMat = new THREE.MeshLambertMaterial({ color: '#5b6478', flatShading: true });
    const mossMat = new THREE.MeshLambertMaterial({ color: '#6f9b7c', flatShading: true });
    const runeMat = new THREE.MeshBasicMaterial({ color: '#ff9a5a' });
    this.makers = {
      rock: () => {
        // 浮石: a floating boulder with a jagged underside and orbiting pebbles
        const g = new THREE.Group();
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
        m.scale.set(1.25, 1.35, 1.15); m.position.y = 0.9;
        const under = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.8, 5), rockMat);
        under.rotation.x = Math.PI; under.position.y = -0.6;
        const moss = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.45, 5), mossMat);
        moss.position.y = 2.1;
        const talisman = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.8), runeMat);
        talisman.position.set(0, 0.9, 1.2);
        g.add(m, under, moss, talisman);
        const orbit = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const p = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), rockMat);
          const a = k * 2.1;
          p.position.set(Math.cos(a) * 1.7, 0.4 + k * 0.5, Math.sin(a) * 1.7);
          orbit.add(p);
        }
        g.add(orbit);
        g.userData.orbit = orbit;
        g.userData.look = 'solid';
        g.userData.parts = [];
        g.traverse(c => { if (c.isMesh) { c.userData.base = c.material; g.userData.parts.push(c); } });
        return g;
      },
      bar: () => {
        // 锁灵链: a glowing chain strung between two floating lanterns
        const g = new THREE.Group();
        const linkMat = new THREE.MeshStandardMaterial({ color: '#d8f6ff', emissive: '#3fd0ff', emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3 });
        const links = new THREE.InstancedMesh(new THREE.TorusGeometry(0.15, 0.045, 5, 10), linkMat, 90);
        g.add(links);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(1, 0.35, 0.35),
          new THREE.MeshBasicMaterial({ color: '#4fd8ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.position.y = 0.45; g.add(glow);
        const lanternMat = new THREE.MeshBasicMaterial({ color: '#ffb35a' });
        const capMat = new THREE.MeshLambertMaterial({ color: '#5a2a2a' });
        const lanterns = [-1, 1].map(sd => {
          const l = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 8), lanternMat);
          const top = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.2, 8), capMat); top.position.y = 0.32;
          const bot = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.2, 8), capMat); bot.position.y = -0.32; bot.rotation.x = Math.PI;
          const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.5), runeMat); tag.position.y = -0.7;
          l.add(body, top, bot, tag);
          l.userData.side = sd;
          g.add(l);
          return l;
        });
        g.userData = { links, glow, lanterns, w: -1 };
        return g;
      },
      gate: () => {
        const g = new THREE.Group();
        const swordGeo = swordGeometry(2.2, 0.16);
        const mat = new THREE.MeshStandardMaterial({ color: '#cfe2ff', metalness: 0.8, roughness: 0.25, emissive: '#3060a0', emissiveIntensity: 0.4 });
        const inst = new THREE.InstancedMesh(swordGeo, mat, 40);
        g.add(inst);
        const band = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#ffcf5a' }));
        band.position.y = 1.95; g.add(band);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.2), new THREE.MeshBasicMaterial({ color: '#ff6a3a', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        glow.position.y = 1.0; g.add(glow);
        g.userData = { inst, band, glow, w: -1 };
        return g;
      },
      bird: () => {
        const g = new THREE.Group();
        const bodyMat = new THREE.MeshLambertMaterial({ color: '#5a2433', flatShading: true });
        const wingMat = new THREE.MeshLambertMaterial({ color: '#8c2f3c', flatShading: true, side: THREE.DoubleSide });
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 5), bodyMat);
        body.rotation.x = Math.PI / 2; g.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), bodyMat);
        head.position.z = 0.75; g.add(head);
        const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffe14a' });
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 3), eyeMat);
          eye.position.set(s * 0.13, 0.08, 0.98); g.add(eye);
          const wing = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.7), wingMat);
          wing.geometry.translate(s * 0.75, 0, 0);
          wing.rotation.x = -Math.PI / 2;
          const piv = new THREE.Group(); piv.add(wing); piv.userData.side = s;
          g.add(piv);
        }
        const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9), wingMat);
        tail.rotation.x = -Math.PI / 2; tail.position.z = -0.95; g.add(tail);
        return g;
      },
      power: () => {
        // 锦囊: a glowing talisman showing what it is, inside a spinning ring
        const g = new THREE.Group();
        const sprite = new THREE.Sprite(this.powerMat('shield'));
        sprite.scale.set(2.5, 2.5, 1);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 6, 24),
          new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }));
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6),
          new THREE.MeshBasicMaterial({ map: radialTexture(), color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        g.add(halo, ring, sprite);
        g.userData = { sprite, ring, halo };
        return g;
      },
      stone: () => {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0),
          new THREE.MeshStandardMaterial({ color: '#7dffc8', emissive: '#2ccf95', emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1 }));
        m.scale.y = 1.4;
        return m;
      },
    };
  }

  // Talisman face per kind: gold disc for good, purple for bad, with its glyph.
  powerMat(kind) {
    if (this.powerMats[kind]) return this.powerMats[kind];
    const def = POWERS[kind], col = def.good ? '#ffd36a' : '#8a3cd8', ch = def.glyph;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = col; x.globalAlpha = 0.95;
    x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1; x.lineWidth = 6; x.strokeStyle = '#fff'; x.stroke();
    x.fillStyle = def.good ? '#3a2050' : '#ffffff';
    x.font = 'bold 70px "Ma Shan Zheng", "Noto Serif SC", serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(ch, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return (this.powerMats[kind] = new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  }

  acquire(type) {
    const p = this.pools[type];
    const m = p.pop() || this.makers[type]();
    if (!m.parent) this.scene.add(m);
    m.visible = true;
    return m;
  }

  release(type, m) {
    m.visible = false;
    this.pools[type].push(m);
  }

  // ---------------------------------------------------------------- sword & riders
  buildRig() {
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.swordTilt = new THREE.Group();
    this.rig.add(this.swordTilt);

    const blade = new THREE.Mesh(swordGeometry(3.8, 0.5),
      new THREE.MeshStandardMaterial({ color: '#e8f2ff', metalness: 0.85, roughness: 0.2, emissive: '#5fa8ff', emissiveIntensity: 0.35 }));
    blade.rotation.x = -Math.PI / 2;           // tip forward (-z)
    blade.position.set(0, 0.12, 1.2);
    this.swordTilt.add(blade);
    this.bladeMat = blade.material;

    // glow under the blade
    const glowTex = radialTexture();
    this.swordGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 5.2),
      new THREE.MeshBasicMaterial({ map: glowTex, color: '#7cc8ff', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.swordGlow.rotation.x = -Math.PI / 2;
    this.swordGlow.position.set(0, 0.02, -0.3);
    this.swordTilt.add(this.swordGlow);

    // trail
    this.trail = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6),
      new THREE.MeshBasicMaterial({ map: trailTexture(), color: '#9fd8ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.trail.rotation.x = -Math.PI / 2;
    this.trail.position.set(0, 0.12, 4.3);
    this.swordTilt.add(this.trail);

    // 双修 aura
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffd36a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aura.scale.set(1.1, 1.2, 1.8);
    this.aura.position.y = 1.0;
    this.swordTilt.add(this.aura);

    // 法宝 effects
    this.blade = blade;
    this.shieldBubble = new THREE.Mesh(new THREE.IcosahedronGeometry(2.0, 1),
      new THREE.MeshBasicMaterial({ color: '#ffd36a', wireframe: true, transparent: true, opacity: 0 }));
    this.shieldBubble.position.y = 1.0;
    this.shieldBubble.scale.set(1, 1.05, 1.5);
    this.swordTilt.add(this.shieldBubble);
    this.magnetRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.07, 6, 40),
      new THREE.MeshBasicMaterial({ color: '#7dffc8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.magnetRing.rotation.x = Math.PI / 2;
    this.magnetRing.position.y = 0.5;
    this.swordTilt.add(this.magnetRing);
    // 腾云: a little cloud seat under the sword
    this.cloudSeat = new THREE.Group();
    const puffMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#d8d0e0', flatShading: true });
    for (let k = 0; k < 6; k++) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + (k % 3) * 0.15, 1), puffMat);
      p.position.set((k % 2 ? 1 : -1) * (0.3 + (k % 3) * 0.3), -0.35, 1.6 - k * 0.7);
      p.scale.y = 0.6;
      this.cloudSeat.add(p);
    }
    this.cloudSeat.visible = false;
    this.swordTilt.add(this.cloudSeat);

    // 阴 (female) in front, 阳 (male) behind
    this.riders = [makeCultivator('male'), makeCultivator('female')];
    this.riders[0].position.set(0, 0.17, 0.7);
    this.riders[1].position.set(0, 0.17, -0.55);
    this.swordTilt.add(this.riders[0], this.riders[1]);
    // per-rider markers: a purple 心魔 haze, a golden 剑主 halo and a flipping ⇄ mirror when left/right are swapped
    const flipTex = flipTexture();
    for (const r of this.riders) {
      const curse = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8),
        new THREE.MeshBasicMaterial({ color: '#a050ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      curse.position.y = 1.5; curse.scale.set(1, 1.6, 1);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 20), new THREE.MeshBasicMaterial({ color: '#ffd36a' }));
      halo.rotation.x = Math.PI / 2; halo.position.y = 2.05; halo.visible = false;
      const flip = new THREE.Sprite(new THREE.SpriteMaterial({ map: flipTex, transparent: true, depthTest: false }));
      flip.position.y = 2.55; flip.scale.set(0.9, 0.9, 1); flip.visible = false; flip.renderOrder = 5;
      r.add(curse, halo, flip);
      r.userData.curse = curse; r.userData.halo = halo; r.userData.flip = flip;
    }

    // input arrows on the blade, one per player
    this.arrows = [0, 1].map(i => {
      const col = i === 0 ? '#5aa8ff' : '#ff7ab8';
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 3),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: false }));
      a.renderOrder = 5;
      a.rotation.z = -Math.PI / 2;
      a.position.set(0, 0.25, this.riders[i].position.z);
      this.swordTilt.add(a);
      return a;
    });
  }

  // ---------------------------------------------------------------- tribulation
  buildTribulation() {
    this.trib = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#2a2240', emissive: '#2a1350', flatShading: true });
    this.tribClouds = new THREE.InstancedMesh(geo, mat, 40);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      p.set((Math.random() - 0.5) * 40, 6 + Math.random() * 10, Math.random() * 12);
      const k = 3 + Math.random() * 4;
      s.set(k, k * 0.6, k);
      m.compose(p, q, s);
      this.tribClouds.setMatrixAt(i, m);
    }
    this.trib.add(this.tribClouds);
    this.scene.add(this.trib);

    this.bolts = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#e6d4ff', transparent: true }));
      l.visible = false; l.userData.life = 0; l.frustumCulled = false;
      this.scene.add(l);
      this.bolts.push(l);
    }
    this.flash = 0;
  }

  strike(at) {
    const b = this.bolts.find(b => b.userData.life <= 0) || this.bolts[0];
    const pos = b.geometry.attributes.position.array;
    const x = at.x, z = at.z;
    let px = x, py = at.y + 22;
    for (let i = 0; i < 12; i++) {
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = z;
      px += (Math.random() - 0.5) * 2.2; py -= 22 / 11;
    }
    b.geometry.attributes.position.needsUpdate = true;
    b.userData.life = 0.18; b.visible = true;
    this.flash = 1;
    this.burst(x, at.y + 0.2, z, 18, 0xd8c4ff, 7);
  }

  // ---------------------------------------------------------------- particles
  buildParticles() {
    const N = 500;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pIdx = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.28, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: radialTexture(),
    }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.tmpColor = new THREE.Color();
  }

  burst(x, y, z, n, color, spd = 5) {
    this.tmpColor.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.pIdx; this.pIdx = (this.pIdx + 1) % this.pN;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      const a = Math.random() * 6.283, e = Math.random() * 2 - 0.3;
      this.pVel[i * 3] = Math.cos(a) * spd * Math.random();
      this.pVel[i * 3 + 1] = e * spd * 0.7;
      this.pVel[i * 3 + 2] = Math.sin(a) * spd * Math.random();
      this.pCol[i * 3] = this.tmpColor.r; this.pCol[i * 3 + 1] = this.tmpColor.g; this.pCol[i * 3 + 2] = this.tmpColor.b;
      this.pLife[i] = 0.5 + Math.random() * 0.5;
    }
  }

  updateParticles(dt) {
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -999; continue; }
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 6 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const f = Math.max(0, this.pLife[i]) / 1.0;
      this.pCol[i * 3] *= 0.985; this.pCol[i * 3 + 1] *= 0.985; this.pCol[i * 3 + 2] *= 0.985;
      if (f <= 0) this.pPos[i * 3 + 1] = -999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  buildSpeedLines() {
    const N = 40;
    const g = new THREE.BufferGeometry();
    this.slPos = new Float32Array(N * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.slPos, 3));
    this.speedLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.speedLines.frustumCulled = false;
    this.slData = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 16, y: Math.random() * 7 - 4, z: 2 + Math.random() * 40 }));
    this.camera.add(this.speedLines);
    this.scene.add(this.camera);
  }

  // ---------------------------------------------------------------- path frame
  // The sim lives in path-local coords (x across, y up, z along). The flight path bends left/right/up/down
  // in world space; these helpers map local → world.
  pathFrame(z) {
    const p = this.lastSim.course.path(z, this._pf || (this._pf = {}));
    p.n = Math.sqrt(1 + p.dx * p.dx);
    p.yaw = -Math.atan(p.dx);
    p.pitch = Math.atan(p.dy);
    return p;
  }

  toWorld(x, y, z, out = new THREE.Vector3()) {
    const p = this.pathFrame(z);
    return out.set(p.x + x / p.n, p.y + y, -z + x * p.dx / p.n);
  }

  orient(obj, z, extraYaw = 0) {
    const p = this.pathFrame(z);
    obj.rotation.order = 'YXZ';
    obj.rotation.set(p.pitch, p.yaw + extraYaw, 0);
  }

  // ---------------------------------------------------------------- per frame
  handleEvent(e, s) {
    if (!this.lastSim) return;
    const at = (dy, dz) => this.toWorld(s.x, s.y + dy, s.z + dz, this._ev || (this._ev = new THREE.Vector3()));
    let p;
    switch (e.type) {
      case 'stone': p = at(0.8, 0.5); this.burst(p.x, p.y, p.z, 14, 0x7dffc8, 4); break;
      case 'hit': this.shake = 0.6; p = at(0.8, 1); this.burst(p.x, p.y, p.z, 30, 0xffa060, 7); break;
      case 'fall': this.shake = 0.4; break;
      case 'smash': p = at(1.2, 1.5); this.burst(p.x, p.y, p.z, 34, 0xffd36a, 9); this.shake = 0.25; break;
      case 'leap': p = at(0, 0); this.burst(p.x, p.y, p.z, 20, 0xfff0a0, 4); break;
      case 'dualboost': p = at(1, 0); this.burst(p.x, p.y, p.z, 30, 0xffd36a, 6); break;
      case 'dead': if (e.cause === 'trib') { this.strike(at(0, 0).clone()); this.shake = 1; } break;
      case 'power': p = at(1, 0.5); this.burst(p.x, p.y, p.z, 40, e.good ? 0xffd36a : 0x9a40ff, 6); if (!e.good) this.shake = Math.max(this.shake, 0.25); break;
      case 'shieldBreak': p = at(1, 0.5); this.burst(p.x, p.y, p.z, 45, 0xffd36a, 8); this.shake = 0.35; break;
      case 'near': p = at(0.6, 1); this.burst(p.x, p.y, p.z, 10, 0xffffff, 5); break;
    }
  }

  update(s, dt, view) {
    this.time += dt;
    const t = this.time;
    const close = Math.max(0, 1 - s.tribDist / 18);

    // Obstacle ids are only unique within one course, so drop all meshes when a new run starts.
    if (s !== this.lastSim) {
      this.lastSim = s;
      for (const a of this.active.values()) this.release(a.type, a.m);
      this.active.clear();
      this.smashed?.clear();
    }

    // ---- rig ----
    const shakeTug = s.tug * 0.07;
    this.toWorld(s.x + (Math.random() - 0.5) * shakeTug, s.y + 0.45 + Math.sin(t * 2.2) * 0.06, s.z, this.rig.position);
    this.orient(this.rig, s.z);
    // bank into path curves as well as into our own sideways motion
    const yawNow = this.pathFrame(s.z).yaw, yawAhead = this.pathFrame(s.z + 4).yaw;
    const curveBank = Math.max(-0.5, Math.min(0.5, (yawAhead - yawNow) * s.speed * 0.35));
    this.swordTilt.rotation.z += ((-s.vx * 0.045 + curveBank + (Math.random() - 0.5) * s.tug * 0.12) - this.swordTilt.rotation.z) * Math.min(1, dt * 10);
    this.swordTilt.rotation.x += ((s.grounded ? 0 : Math.max(-0.25, Math.min(0.25, s.vy * 0.02))) - this.swordTilt.rotation.x) * Math.min(1, dt * 8);
    this.rig.visible = !(s.invuln > 0 && Math.floor(t * 14) % 2 === 0) || !s.alive;
    const dual = s.boostMode === 2;
    this.aura.material.opacity += ((dual ? 0.28 + Math.sin(t * 20) * 0.06 : 0) - this.aura.material.opacity) * Math.min(1, dt * 8);
    const trailCol = dual ? '#ffd36a' : s.boostMode === 1 ? '#c8a0ff' : '#9fd8ff';
    this.trail.material.color.set(trailCol);
    this.trail.scale.y = 0.6 + (s.speed / 14) * 0.5 + s.boostMode * 0.4;
    this.trail.position.z = 1.2 + 3 * this.trail.scale.y;
    this.bladeMat.emissiveIntensity = 0.35 + s.tug * 1.2 + s.boostMode * 0.3;
    this.bladeMat.emissive.set(s.tug > 0.3 ? '#ff6040' : '#5fa8ff');
    this.swordGlow.material.color.set(dual ? '#ffd36a' : '#7cc8ff');
    if (s.tug > 0.5 && Math.random() < s.tug * 0.6) {
      const p = this.toWorld(s.x + (Math.random() - 0.5) * 0.4, s.y + 0.5, s.z + (Math.random() - 0.5) * 2, this.v3);
      this.burst(p.x, p.y, p.z, 2, 0xbfe4ff, 4);
    }

    // 法宝 effects
    const fx = s.fx;
    const ease = Math.min(1, dt * 8);
    this.shieldBubble.material.opacity += ((fx.shield > 0 ? 0.35 + Math.sin(t * 6) * 0.1 : 0) - this.shieldBubble.material.opacity) * ease;
    this.shieldBubble.rotation.y = t * 0.6;
    this.magnetRing.material.opacity += ((fx.magnet > 0 ? 0.7 : 0) - this.magnetRing.material.opacity) * ease;
    this.magnetRing.scale.setScalar(1 + Math.sin(t * 8) * 0.08);
    const giant = fx.giant > 0 ? 2.1 : 1;
    this.blade.scale.setScalar(this.blade.scale.x + (giant - this.blade.scale.x) * ease);
    if (fx.giant > 0) { this.bladeMat.emissive.set('#ffb040'); this.bladeMat.emissiveIntensity = 1.2; }
    for (let i = 0; i < 2; i++) {
      const u = this.riders[i].userData;
      const hexed = (fx.curse > 0 && fx.curseWho === i) || fx.swap > 0;
      u.curse.material.opacity += ((hexed ? 0.45 + Math.sin(t * 12) * 0.15 : 0) - u.curse.material.opacity) * ease;
      u.halo.visible = (fx.master > 0 || fx.usurp > 0) && fx.masterWho === i;
      u.flip.visible = isFlipped(fx, i);
      if (u.flip.visible) u.flip.scale.set(0.9 * Math.cos(t * 5), 0.9, 1); // keeps flipping like a mirror turning
      u.halo.rotation.z = t * 3;
    }

    this.cloudSeat.visible = fx.cloud > 0;
    if (fx.cloud > 0) this.cloudSeat.children.forEach((c, k) => { c.position.y = -0.35 + Math.sin(t * 3 + k) * 0.08; });
    if (fx.drunk > 0) this.swordTilt.rotation.z += Math.sin(t * 2.3) * 0.25 * dt * 8;
    const fogK = fx.fog > 0 ? Math.min(1, fx.fog) : 0;
    this.scene.fog.near = 60 - fogK * 54;
    this.scene.fog.far = 230 - fogK * 195;

    // riders turn and lean toward their own input
    for (let i = 0; i < 2; i++) {
      const r = this.riders[i];
      const st = view.steer[i];
      r.rotation.order = 'YXZ';
      r.rotation.y += (-st * 0.75 - r.rotation.y) * Math.min(1, dt * 12);
      r.rotation.z += (-st * 0.45 - r.rotation.z) * Math.min(1, dt * 12);
      const crouch = s.t - s.lastJump[i] < 0.18 ? 0.85 : 1;
      r.scale.y += (crouch - r.scale.y) * Math.min(1, dt * 18);
      animateCultivator(r, t, st, s.boosting[i], s.speed);
      const a = this.arrows[i];
      a.visible = Math.abs(st) > 0.05;
      a.rotation.z = st > 0 ? -Math.PI / 2 : Math.PI / 2;
      a.position.x = st * 0.55;
      a.scale.setScalar(0.6 + Math.abs(st) * 0.6);
    }

    // ---- camera (smoothed in path-local space, then mapped to world) ----
    const portrait = innerWidth < innerHeight;
    const tx = s.x, ty = 5.6 + s.y * 0.45;
    this.camPos.x += (tx - this.camPos.x) * Math.min(1, dt * 5);
    this.camPos.y += (ty - this.camPos.y) * Math.min(1, dt * 4);
    const back = 11 - Math.min(2, (s.speed - 14) * 0.08);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const sh = this.shake * this.shake * 0.6;
    this.toWorld(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y + (Math.random() - 0.5) * sh, s.z - back, this.camera.position);
    this.camera.lookAt(this.toWorld(s.x, 0.8 + s.y * 0.3, s.z + 16, this.v3));
    const baseFov = portrait ? 78 : 62;
    const fov = baseFov + s.boostMode * 5 + Math.min(8, (s.speed - 14) * 0.25);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4); this.camera.updateProjectionMatrix(); }

    const rp = this.rig.position;
    this.sky.position.copy(this.camera.position);
    this.sun.position.set(rp.x - 30, rp.y + 50, rp.z - 40);
    this.sun.target.position.copy(rp);
    this.fill.position.set(rp.x + 10, rp.y + 30, rp.z + 40);
    this.fill.target.position.copy(rp);

    // ---- storm mood as the tribulation closes in ----
    this.flash = Math.max(0, this.flash - dt * 4);
    this.sky.material.uniforms.uDark.value = close * 0.55;
    this.scene.fog.color.copy(this.fogColor).lerp(this.stormColor || (this.stormColor = new THREE.Color('#3a2f55')), close * 0.6);
    this.hemi.intensity = 1.25 - close * 0.4 + this.flash * 1.5;
    if (s.alive && close > 0 && Math.random() < close * close * dt * 2.5) {
      this.strike(this.toWorld(s.x + (Math.random() - 0.5) * 8, 0, s.z + 6 + Math.random() * 18));
      view.onThunder && view.onThunder(close);
    }
    for (const b of this.bolts) {
      if (b.userData.life > 0) { b.userData.life -= dt; b.material.opacity = Math.random() * 0.5 + 0.5; }
      else b.visible = false;
    }
    this.toWorld(s.x * 0.3, 0, s.z - s.tribDist, this.trib.position);
    this.orient(this.trib, s.z - s.tribDist);

    // ---- clouds / peaks: follow the path sideways but stay at a fixed altitude, so climbs and dives show ----
    for (let i = 0; i < this.cloudData.length; i++) {
      const c = this.cloudData[i];
      const zz = s.z + mod(c.z - s.z * 0.97, 360) - 60;
      const p = this.pathFrame(zz);
      this.v3.set(p.x + s.x + mod(c.x - s.x, 240) - 120, c.y, -zz);
      this.s3.set(c.s, c.s * c.sy, c.s);
      this.m4.compose(this.v3, this.q, this.s3);
      this.clouds.setMatrixAt(i, this.m4);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    for (const pk of this.peaks) {
      const d = pk.userData;
      const zz = s.z + mod(d.z - s.z * 0.9, 640) - 80;
      const p = this.pathFrame(zz);
      const side = mod(d.x - s.x, 320) - 160;
      pk.position.set(p.x + s.x + (Math.abs(side) < 70 ? Math.sign(side || 1) * 70 : side), d.y + p.y * 0.4 + Math.sin(t * 0.3 + d.x) * 0.8, -zz);
    }

    // ---- vortices ----
    const z0 = s.z - VIEW_BEHIND, z1 = s.z + VIEW_AHEAD;
    const vort = s.course.vortexesIn(z0, z1, this._vort || (this._vort = []), s.x, VIEW_SIDE);
    this.vortexMat.uniforms.uTime.value = t;
    let k = 0;
    for (const g of vort) {
      if (k >= this.vortexPool.length) break;
      const m = this.vortexPool[k++];
      const zc = (g.z0 + g.z1) / 2, hz = (g.z1 - g.z0) / 2;
      m.visible = true;
      this.toWorld(g.x, -0.35, zc, m.position);
      this.orient(m, zc);
      m.scale.set(g.rx, 1, hz);
      for (let j = 0; j < this.RIM; j++) {
        const a = (j / this.RIM) * 6.283 + t * 1.6;
        const wob = 1 + Math.sin(t * 3 + j * 1.7) * 0.06;
        const rx = g.rx;
        this.toWorld(g.x + Math.cos(a) * rx * wob, -0.2 + Math.sin(t * 4 + j) * 0.12, zc + Math.sin(a) * hz * wob, this.v3);
        const sc = 0.45 + (j % 3) * 0.12;
        this.s3.set(sc * 1.4, sc * 0.7, sc);
        this.m4.compose(this.v3, this.q, this.s3);
        this.rimPuffs.setMatrixAt((k - 1) * this.RIM + j, this.m4);
      }
      if (Math.random() < dt * 14 && g.z0 - s.z < 70) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random());
        const p = this.toWorld(g.x + Math.cos(a) * r * g.rx, -0.2, zc + Math.sin(a) * r * hz, this.v3);
        this.burst(p.x, p.y, p.z, 1, 0x8a70c0, 1.5);
      }
    }
    this.s3.set(0, 0, 0);
    this.m4.compose(this.v3, this.q, this.s3);
    for (let j = k * this.RIM; j < this.rimPuffs.count; j++) this.rimPuffs.setMatrixAt(j, this.m4);
    this.rimPuffs.instanceMatrix.needsUpdate = true;
    for (; k < this.vortexPool.length; k++) this.vortexPool[k].visible = false;

    // ---- obstacles ----
    const list = s.course.obstaclesIn(z0, z1, this._obs || (this._obs = []), s.x, VIEW_SIDE);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (const o of list) {
      if (s.consumed.has(o.id) && (o.type === 'stone' || this.smashed?.has(o.id))) continue;
      seen.add(o.id);
      let a = this.active.get(o.id);
      if (!a) { a = { m: this.acquire(o.type), type: o.type }; this.active.set(o.id, a); }
      const m = a.m;
      const ox = o.type === 'bird' ? birdX(o, s.t) : o.x;
      let y = 0, yaw = 0;
      if (o.type === 'bar') {
        layoutChain(m, o.w, t, this.m4);
      } else if (o.type === 'rock') {
        this.eyeLook(m, o);
        y = Math.sin(t * 1.3 + o.z) * 0.15;
        yaw = (o.id % 7) * 0.9;
        m.scale.setScalar(o.s || 1);
        m.userData.orbit.rotation.y = t * 0.8 + o.z;
      } else if (o.type === 'gate') {
        layoutWall(m, o.w, this.m4);
        y = Math.sin(t * 2 + o.z) * 0.06;
      } else if (o.type === 'bird') {
        y = 1.0 + Math.sin(t * 6 + o.ph) * 0.15;
        yaw = Math.PI + Math.cos(o.freq * s.t + o.ph) * 0.6;
        for (const c of m.children) if (c.userData.side) c.rotation.z = c.userData.side * Math.sin(t * 14 + o.ph) * 0.7;
      } else if (o.type === 'stone') {
        y = o.y + Math.sin(t * 3 + o.z) * 0.12;
        yaw = t * 2.5 + o.z;
      } else if (o.type === 'power') {
        const u = m.userData;
        u.sprite.material = this.powerMat(o.kind);
        const col = POWERS[o.kind].good ? '#ffd36a' : '#a050ff';
        u.ring.material.color.set(col); u.halo.material.color.set(col);
        u.ring.rotation.set(t * 2, t * 1.3, 0);
        u.halo.material.opacity = 0.35 + Math.sin(t * 5 + o.z) * 0.15;
        y = o.y + 0.3 + Math.sin(t * 2.5 + o.z) * 0.2;
      }
      this.toWorld(ox, y, o.z, m.position);
      this.orient(m, o.z, yaw);
    }
    for (const [id, a] of this.active) {
      if (!seen.has(id)) { this.release(a.type, a.m); this.active.delete(id); }
    }

    // ---- speed lines (camera space) ----
    const slOp = Math.max(0, (s.speed - 18) / 20) + s.boostMode * 0.25;
    this.speedLines.material.opacity = Math.min(0.7, slOp);
    if (slOp > 0.01) {
      for (let i = 0; i < this.slData.length; i++) {
        const d = this.slData[i];
        d.z -= s.speed * dt * 1.5;
        if (d.z < 2) { d.z = 40 + Math.random() * 10; d.x = (Math.random() - 0.5) * 16; d.y = Math.random() * 7 - 4; }
        this.slPos.set([d.x, d.y, -d.z, d.x, d.y, -d.z + 2.5 + s.speed * 0.08], i * 6);
      }
      this.speedLines.geometry.attributes.position.needsUpdate = true;
    }

    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  screenPos(i) {
    const v = this.v3.set(0, 2.1, 0);
    this.riders[i].localToWorld(v);
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  // 阴阳天眼: 幻象 (fake) rocks look like ghosts to 师兄, 暗石 (hidden) are invisible to him; 师妹 is the opposite.
  // A shared screen shows both as half-transparent so neither player is cheated.
  eyeLook(m, o) {
    let look = 'solid';
    if (o.fake) look = this.viewer === 1 ? 'solid' : this.viewer === 0 ? 'ghost' : 'half';
    else if (o.hidden) look = this.viewer === 1 ? 'solid' : this.viewer === 0 ? 'gone' : 'half';
    m.visible = look !== 'gone';
    if (look === m.userData.look) return;
    m.userData.look = look;
    for (const c of m.userData.parts) {
      if (look === 'solid') { c.material = c.userData.base; continue; }
      const key = c.userData.base.uuid + look;
      let mat = this.ghostMats?.get(key);
      if (!mat) {
        mat = c.userData.base.clone();
        mat.transparent = true; mat.depthWrite = false;
        mat.opacity = look === 'ghost' ? 0.22 : 0.5;
        if (look === 'ghost') mat.color = new THREE.Color('#c8d8ff');
        (this.ghostMats || (this.ghostMats = new Map())).set(key, mat);
      }
      c.material = mat;
    }
  }

  markSmashed(id) { (this.smashed || (this.smashed = new Set())).add(id); }
}

// ------------------------------------------------------------------ helpers


// Silver mirror disc with ⇄, floated above a rider whose left/right are swapped.
function flipTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(230,240,255,0.92)';
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#a050ff'; g.stroke();
  g.fillStyle = '#6a2ad0'; g.font = 'bold 76px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('⇄', 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Space the hovering swords of a 剑阵 across 2w.
function layoutWall(g, w, m4) {
  const u = g.userData;
  if (u.w === w) return;
  u.w = w;
  const n = Math.min(40, Math.ceil((w * 2) / 0.6));
  u.inst.count = n;
  for (let i = 0; i < n; i++) {
    m4.makeRotationZ(Math.PI + Math.sin(i * 7.1) * 0.12);
    m4.setPosition(-w + (i + 0.5) * (w * 2 / n), 2.2 + Math.sin(i * 3.3) * 0.08, 0);
    u.inst.setMatrixAt(i, m4);
  }
  u.inst.instanceMatrix.needsUpdate = true;
  u.band.scale.x = w * 2 + 0.4;
  u.glow.scale.x = w * 2 + 0.6;
}

// Lay out chain links across 2w and park the lanterns at the ends.
function layoutChain(g, w, t, m4) {
  const { links, glow, lanterns } = g.userData;
  if (g.userData.w !== w) {
    g.userData.w = w;
    const n = Math.min(90, Math.ceil((w * 2) / 0.26));
    links.count = n;
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const x = -w + (i + 0.5) * (w * 2 / n);
      const sag = 0.12 * (1 - (x / w) ** 2);
      p.set(x, 0.45 - sag, 0);
      e.set(i % 2 ? Math.PI / 2 : 0, Math.PI / 2, 0);
      q.setFromEuler(e);
      m4.compose(p, q, sc);
      links.setMatrixAt(i, m4);
    }
    links.instanceMatrix.needsUpdate = true;
    glow.scale.x = w * 2;
  }
  for (const l of lanterns) l.position.set(l.userData.side * (w + 0.3), 0.45 + Math.sin(t * 2 + l.userData.side) * 0.1, 0);
  glow.material.opacity = 0.2 + Math.sin(t * 12) * 0.08;
}

function mod(a, n) { return ((a % n) + n) % n; }

// Flat sword along +y: blade with a pointed tip, guard and hilt. Base at y=0.
function swordGeometry(len, width) {
  const blade = new THREE.BufferGeometry();
  const w = width / 2, th = width * 0.12, L = len * 0.78, tip = len * 0.12;
  const v = [
    -w, 0, 0, w, 0, 0, w, L, 0, -w, L, 0, 0, L + tip, 0,
    0, 0, th, 0, L, th, 0, 0, -th, 0, L, -th,
  ];
  const idx = [
    0, 5, 6, 0, 6, 3, 1, 2, 6, 1, 6, 5, 3, 6, 4, 2, 4, 6,
    0, 3, 8, 0, 8, 7, 1, 7, 8, 1, 8, 2, 3, 4, 8, 2, 8, 4,
  ];
  blade.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  blade.setIndex(idx);
  blade.computeVertexNormals();
  blade.translate(0, len * 0.1, 0);
  const guard = new THREE.BoxGeometry(width * 2.2, len * 0.03, width * 0.5);
  guard.translate(0, len * 0.1, 0);
  const hilt = new THREE.CylinderGeometry(width * 0.18, width * 0.2, len * 0.1, 6);
  hilt.translate(0, len * 0.05, 0);
  return mergeGeos([blade.toNonIndexed(), guard.toNonIndexed(), hilt.toNonIndexed()]);
}

function mergeGeos(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

let _radial;
function radialTexture() {
  if (_radial) return _radial;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (_radial = new THREE.CanvasTexture(c));
}

function trailTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 128);
  const h = x.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = h; x.fillRect(0, 0, 32, 128);
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------------ cultivators

function makeCultivator(gender) {
  const male = gender === 'male';
  const robe = male ? '#eef3ff' : '#f7dcea';
  const trim = male ? '#3d6fb0' : '#b2557f';
  const hairC = '#1b1820';
  const skin = '#f2d2bc';
  const lam = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, male ? 0.34 : 0.38, 0.95, 8), lam(robe));
  skirt.position.y = 0.48; body.add(skirt);
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(male ? 0.345 : 0.385, male ? 0.35 : 0.39, 0.08, 8), lam(trim));
  hem.position.y = 0.05; body.add(hem);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(male ? 0.19 : 0.16, 0.18, 0.46, 8), lam(robe));
  torso.position.y = 1.17; body.add(torso);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.08, 8), lam(trim));
  belt.position.y = 0.96; body.add(belt);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.08, 8), lam(trim));
  collar.position.y = 1.4; body.add(collar);

  const head = new THREE.Group(); head.position.y = 1.58; body.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lam(skin)));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), lam(hairC));
  hair.position.y = 0.02; hair.rotation.x = 0.35; head.add(hair);
  if (male) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), lam(hairC)); bun.position.set(0, 0.2, 0.02); head.add(bun);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.14), lam('#d8b24a')); crown.position.set(0, 0.24, 0.02); head.add(crown);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), lam('#d8b24a')); pin.rotation.z = Math.PI / 2; pin.position.set(0, 0.23, 0.02); head.add(pin);
  } else {
    for (const s of [-1, 1]) {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lam(hairC)); bun.position.set(s * 0.12, 0.14, 0.04); head.add(bun);
    }
    const flower = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), lam('#ff8fb8')); flower.position.set(0.16, 0.16, -0.02); head.add(flower);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.6, 0.06), lam(hairC)); back.position.set(0, -0.28, 0.13); back.rotation.x = 0.12; head.add(back);
  }

  // sleeves (arms) on pivots at the shoulders
  const arms = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.21, 1.33, 0);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.5, 6), lam(robe));
    sleeve.position.y = -0.24; piv.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.05, 6), lam(trim));
    cuff.position.y = -0.48; piv.add(cuff);
    piv.rotation.z = s * 0.25;
    body.add(piv); arms.push(piv);
  }

  // flowing ribbon (披帛 / 发带) — a strip whose vertices wave
  const segs = 10;
  const rg = new THREE.PlaneGeometry(male ? 0.08 : 0.12, male ? 1.0 : 1.6, 1, segs);
  rg.translate(0, -(male ? 0.5 : 0.8), 0);
  const ribbon = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: male ? '#5c8fd6' : '#ff9cc6', side: THREE.DoubleSide }));
  ribbon.position.set(0, male ? 1.72 : 1.3, 0.12);
  ribbon.rotation.x = -1.2;
  body.add(ribbon);
  ribbon.userData.base = Float32Array.from(rg.attributes.position.array);

  g.userData = { arms, ribbon, body, head, male };
  return g;
}

function animateCultivator(g, t, steer, boosting, speed) {
  const { arms, ribbon, body, head } = g.userData;
  // arm toward steer side stretches out like 御剑 hand-seal
  arms[0].rotation.z += ((-0.25 - Math.max(0, -steer) * 1.1) - arms[0].rotation.z) * 0.2;
  arms[1].rotation.z += ((0.25 + Math.max(0, steer) * 1.1) - arms[1].rotation.z) * 0.2;
  const fwd = boosting ? -1.2 : -0.1;
  arms[0].rotation.x += (fwd - arms[0].rotation.x) * 0.15;
  arms[1].rotation.x += (fwd * 0.6 - arms[1].rotation.x) * 0.15;
  body.rotation.x += ((boosting ? -0.22 : -0.05) - body.rotation.x) * 0.15;
  head.rotation.y = Math.sin(t * 0.7 + (g.userData.male ? 0 : 2)) * 0.15;
  const pos = ribbon.geometry.attributes.position;
  const base = ribbon.userData.base;
  const amp = 0.06 + Math.min(0.2, speed * 0.006);
  for (let i = 0; i < pos.count; i++) {
    const y = base[i * 3 + 1];
    const k = -y;
    pos.array[i * 3] = base[i * 3] + Math.sin(t * 9 + k * 5) * amp * k + steer * -0.3 * k;
    pos.array[i * 3 + 2] = Math.sin(t * 7 + k * 4) * amp * 0.6 * k;
  }
  pos.needsUpdate = true;
}
