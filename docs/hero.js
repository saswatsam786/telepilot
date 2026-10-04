// telepilot hero: one message, told in 3D.
// A message leaves the phone, reaches the hub, gets worked on by the Mac, and the reply flows back.
// The phone and laptop screens are live canvas textures that follow the same timeline.
// Assets (vendored in assets/):
//   "Studio Small 09" HDRI by Sergej Majboroda, Poly Haven, CC0. https://polyhaven.com/a/studio_small_09
//   "Laptop / MacBook Pro" model by Alex Safayan, CC-BY 3.0, via Poly Pizza. https://poly.pizza/m/27hcX_w47Jb
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const params = new URLSearchParams(location.search);
const FIXED = params.has('t') ? Number(params.get('t')) : null;
const SCROLL = params.has('s') ? Number(params.get('s')) : null; // ?s=0.6 previews the scroll choreography // ?t=4.2 renders one frame (used to record the demo GIF)
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const host = document.getElementById('stage');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: FIXED !== null });
  if (!renderer.getContext()) throw 0;
} catch { host.remove(); throw new Error('no webgl'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.NeutralToneMapping; // keeps the light page colours true
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environmentIntensity = .9;
// painted backdrop that matches the page's soft washes
scene.background = (() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1000; const g = c.getContext('2d');
  g.fillStyle = '#f7f6f3'; g.fillRect(0, 0, 1600, 1000);
  [[.12, .08, 'rgba(31,158,232,.16)'], [.88, .14, 'rgba(226,100,60,.13)'], [.5, .95, 'rgba(122,92,255,.12)']].forEach(([x, y, col]) => {
    const r = g.createRadialGradient(x * 1600, y * 1000, 0, x * 1600, y * 1000, 700); r.addColorStop(0, col); r.addColorStop(1, 'rgba(247,246,243,0)'); g.fillStyle = r; g.fillRect(0, 0, 1600, 1000); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const camera = new THREE.PerspectiveCamera(30, 1, .1, 200);

const C = { sky: new THREE.Color('#1f9ee8'), violet: new THREE.Color('#7a5cff'), coral: new THREE.Color('#e2643c') };
const LOOP = 10; // seconds
const ease = x => 1 - Math.pow(1 - x, 3);
const easeIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const clamp01 = x => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));

// ---------- lights ----------
scene.add(new THREE.HemisphereLight('#ffffff', '#ece7df', .35));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(2, 18, 8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 10; sun.shadow.blurSamples = 24; sun.shadow.bias = -.0005;
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 8, bottom: -8, near: 1, far: 40 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), new THREE.ShadowMaterial({ opacity: .09 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -2.25; ground.receiveShadow = true; scene.add(ground);

// ---------- materials ----------
const titanium = () => new THREE.MeshPhysicalMaterial({ color: '#eceef2', metalness: 1, roughness: .26, clearcoat: .4, clearcoatRoughness: .25 });
const glassScreen = map => new THREE.MeshBasicMaterial({ map, toneMapped: false });
const gloss = c => new THREE.MeshPhysicalMaterial({ color: c, roughness: .18, metalness: .1, clearcoat: 1, clearcoatRoughness: .08 });

// ---------- canvas screens ----------
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return { c, g: c.getContext('2d'), tex }; }
const FONT = '"Inter", -apple-system, system-ui, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

function wrap(g, text, max) { const words = text.split(' '), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line); return lines; }

const phoneScr = makeCanvas(600, 1270);
function drawPhone(t) {
  const { g, c } = phoneScr, W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 70); g.clip();
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#dbe9d3'); bg.addColorStop(.5, '#d3e3ea'); bg.addColorStop(1, '#e3dcef');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // status bar + island
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, 250);
  g.fillStyle = '#0e1015'; g.font = `600 30px ${FONT}`; g.fillText('9:41', 56, 64);
  g.beginPath(); g.roundRect(W / 2 - 90, 26, 180, 52, 26); g.fill();
  // header
  const av = g.createLinearGradient(50, 120, 140, 210); av.addColorStop(0, '#1f9ee8'); av.addColorStop(.5, '#7a5cff'); av.addColorStop(1, '#e2643c');
  g.fillStyle = av; g.beginPath(); g.arc(96, 172, 44, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0e1015'; g.font = `600 34px ${FONT}`; g.fillText('telepilot', 160, 164);
  g.fillStyle = '#1f9ee8'; g.font = `400 25px ${FONT}`; g.fillText(t > 1.5 && t < 8.2 ? 'typing…' : 'bot · online', 160, 202);
  g.fillStyle = 'rgba(15,17,26,.08)'; g.fillRect(0, 249, W, 2);
  // messages (bottom-up)
  const msgs = [
    { me: true, text: '/sessions', at: -1 },
    { me: false, text: '★ api · blog · mac', at: -1 },
    { me: true, text: '@api run the tests and push if green', at: .4 },
    { me: false, text: '→ api', at: 1.9 },
    { me: false, text: '[api] 128/128 tests pass. Pushed to main ✅', at: 8.2, tag: true },
  ].filter(m => t >= m.at);
  g.font = `400 31px ${FONT}`;
  let y = H - 150;
  for (let i = msgs.length - 1; i >= 0 && y > 270; i--) {
    const m = msgs[i], lines = wrap(g, m.text, 380), bw = Math.max(...lines.map(l => g.measureText(l).width)) + 44, bh = lines.length * 42 + 30;
    const a = m.at < 0 ? 1 : ease(clamp01((t - m.at) / .35));
    y -= bh + 16;
    const x = m.me ? W - 28 - bw : 28;
    g.save(); g.globalAlpha = a; g.translate(0, (1 - a) * 24);
    g.shadowColor = 'rgba(15,17,26,.10)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
    g.fillStyle = m.me ? '#e2fdcf' : '#ffffff'; g.beginPath(); g.roundRect(x, y, bw, bh, 26); g.fill();
    g.shadowColor = 'transparent';
    lines.forEach((l, k) => {
      if (m.tag && k === 0) { g.fillStyle = '#e2643c'; g.font = `600 31px ${FONT}`; g.fillText('[api]', x + 22, y + 48); const w = g.measureText('[api] ').width; g.fillStyle = '#0e1015'; g.font = `400 31px ${FONT}`; g.fillText(l.slice(6), x + 22 + w, y + 48); }
      else { g.fillStyle = '#0e1015'; g.fillText(l, x + 22, y + 48 + k * 42); }
    });
    g.restore();
  }
  // input bar
  g.fillStyle = '#fff'; g.fillRect(0, H - 120, W, 120);
  g.fillStyle = '#9aa0aa'; g.font = `400 29px ${FONT}`; g.fillText('Message', 56, H - 52);
  g.restore();
  phoneScr.tex.needsUpdate = true;
}

const macScr = makeCanvas(1000, 640);
function drawMac(t) {
  const { g, c } = macScr, W = c.width, H = c.height;
  g.fillStyle = '#0f1117'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#171a22'; g.fillRect(0, 0, W, 54);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(34 + i * 30, 27, 9, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = '#6b7080'; g.font = `500 22px ${MONO}`; g.fillText('api — claude', 450, 34);
  const L = [
    { at: 3.0, parts: [['❯ ', '#f08a63'], ['[telepilot from=hub] ', '#6b7080'], ['run the tests', '#e9eaee']] },
    { at: 3.5, parts: [['  ● ', '#7a5cff'], ['Running 128 tests…', '#c9ccd6']] },
    { at: 5.4, parts: [['  ✓ ', '#5fd9a0'], ['128 passed', '#e9eaee'], ['  (4.1s)', '#6b7080']] },
    { at: 5.9, parts: [['  ● ', '#7a5cff'], ['git push origin main', '#c9ccd6']] },
    { at: 6.4, parts: [['  ↳ ', '#1f9ee8'], ['reply sent to Telegram', '#e9eaee']] },
  ];
  g.font = `400 27px ${MONO}`;
  L.forEach((l, i) => { if (t < l.at) return; const a = ease(clamp01((t - l.at) / .3)); g.globalAlpha = a; let x = 40; const y = 120 + i * 58;
    l.parts.forEach(([s, col]) => { g.fillStyle = col; g.fillText(s, x, y); x += g.measureText(s).width; }); g.globalAlpha = 1; });
  if (t > 3.5 && t < 5.6) { const p = seg(t, 3.5, 5.3); g.fillStyle = '#232734'; g.beginPath(); g.roundRect(84, 210, 560, 12, 6); g.fill();
    const grd = g.createLinearGradient(84, 0, 644, 0); grd.addColorStop(0, '#1f9ee8'); grd.addColorStop(1, '#7a5cff'); g.fillStyle = grd; g.beginPath(); g.roundRect(84, 210, 560 * p, 12, 6); g.fill(); }
  if (Math.floor(t * 2) % 2 === 0) { g.fillStyle = '#f08a63'; g.fillRect(40, 120 + 5 * 58 - 22, 14, 28); }
  macScr.tex.needsUpdate = true;
}

// ---------- phone ----------
const phone = new THREE.Group();
phone.add(new THREE.Mesh(new RoundedBoxGeometry(1.78, 3.62, .24, 8, .32), titanium()));
const pFace = new THREE.Mesh(new RoundedBoxGeometry(1.7, 3.54, .02, 6, .28), new THREE.MeshPhysicalMaterial({ color: '#0b0c10', roughness: .05, clearcoat: 1 }));
pFace.position.z = .12; phone.add(pFace);
const pScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 3.34), glassScreen(phoneScr.tex));
pScreen.material.transparent = false; pScreen.position.z = .132; phone.add(pScreen);
// side buttons
[[.9, .9, .34], [.9, .45, .2], [-.9, .7, .45]].forEach(([x, y, h]) => { const b = new THREE.Mesh(new RoundedBoxGeometry(.04, h, .1, 2, .02), titanium()); b.position.set(x, y, 0); phone.add(b); });
phone.traverse(m => m.isMesh && (m.castShadow = true));
scene.add(phone);

// ---------- hub ----------
const hub = new THREE.Group();
const orb = new THREE.Mesh(new THREE.SphereGeometry(1.15, 96, 96), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, thickness: 1.6, roughness: .04, ior: 1.45, iridescence: .35, iridescenceIOR: 1.3, clearcoat: 1, attenuationColor: '#efe9ff', attenuationDistance: 4, specularIntensity: 1 }));
orb.castShadow = true; hub.add(orb);
const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.46, 8), new THREE.MeshPhysicalMaterial({ color: '#ffd7c8', roughness: .2, metalness: .2, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [200, 900], clearcoat: 1 }));
hub.add(core);
const rings = [[1.62, C.sky, .5], [1.95, C.coral, -.42], [2.25, C.violet, .15]].map(([r, c, tilt], i) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, i === 2 ? .008 : .016, 16, 240), gloss(c)); m.rotation.set(Math.PI / 2 + tilt, 0, i); m.castShadow = true; hub.add(m); return m; });
scene.add(hub);

// ---------- laptop: real GLTF model, re-materialled, with the live terminal projected on its screen ----------
const mac = new THREE.Group();
mac.rotation.y = -.42;
scene.add(mac);
const macReady = new GLTFLoader().loadAsync(new URL('assets/models/macbook-pro.glb', import.meta.url).href).then(gltf => {
  const m = gltf.scene;
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const k = 3.4 / size.x;
  m.scale.setScalar(k); m.position.set(-ctr.x * k, -box.min.y * k, -ctr.z * k);
  // the model's parts: mat16 aluminium shell, mat15 keyboard deck, mat23 keys/bezel, mat17 display (lid) or keyboard well (base)
  const alu = titanium(), deck = new THREE.MeshPhysicalMaterial({ color: '#e3e5ea', metalness: .85, roughness: .38 });
  const keysMat = new THREE.MeshPhysicalMaterial({ color: '#16171b', roughness: .6 }), bezelMat = new THREE.MeshPhysicalMaterial({ color: '#08090c', roughness: .06, clearcoat: 1 });
  m.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const g = o.geometry; g.computeBoundingBox(); const bb = g.boundingBox, d = bb.getSize(new THREE.Vector3()), upright = d.y > d.x * .5;
    switch (o.material.name) {
      case 'mat16': o.material = alu; break;
      case 'mat15': o.material = deck; break;
      case 'mat23': o.material = upright ? bezelMat : keysMat; break;
      case 'mat17':
        if (upright) { // the display: planar UVs + the live terminal
          const p = g.attributes.position, uv = new Float32Array(p.count * 2);
          for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) - bb.min.x) / d.x; uv[i * 2 + 1] = (p.getY(i) - bb.min.y) / d.y; }
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          o.material = glassScreen(macScr.tex); o.material.side = THREE.DoubleSide; o.castShadow = false;
        } else o.material = keysMat;
        break;
      default: o.material = bezelMat;
    }
  });
  mac.add(m);
});

// ---------- connections: tubes with a flowing shader + a travelling message capsule ----------
const flowMat = (a, b) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uA: { value: a }, uB: { value: b }, uPulse: { value: -1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform float uTime, uPulse; uniform vec3 uA, uB; varying vec2 vUv;
    void main(){
      vec3 col = mix(uA, uB, vUv.x);
      float dash = smoothstep(.55, 1., sin(vUv.x * 46. - uTime * 4.)) * .35;
      float pulse = uPulse < 0. ? 0. : exp(-pow((vUv.x - uPulse) * 9., 2.));
      float ends = smoothstep(0., .06, vUv.x) * smoothstep(1., .94, vUv.x);
      gl_FragColor = vec4(col, (.16 + dash + pulse * .85) * ends);
    }`,
});
const legs = [
  { mat: flowMat(C.sky, C.violet) },
  { mat: flowMat(C.violet, C.coral) },
  { mat: flowMat(C.coral, C.sky) },
].map(l => { l.mesh = new THREE.Mesh(new THREE.BufferGeometry(), l.mat); scene.add(l.mesh); return l; });

const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(.11, .34, 8, 24), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: .12, clearcoat: 1, iridescence: .6, emissive: '#1f9ee8', emissiveIntensity: 2.2 }));
capsule.castShadow = true; scene.add(capsule);
const halo = new THREE.Mesh(new THREE.SphereGeometry(.34, 32, 32), new THREE.MeshBasicMaterial({ color: '#1f9ee8', transparent: true, opacity: .14, depthWrite: false }));
scene.add(halo);

// ---------- layout ----------
let portrait = false;
const P = { phone: new THREE.Vector3(), hub: new THREE.Vector3(), mac: new THREE.Vector3() };
let layout = function () {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); camera.aspect = w / h; portrait = w / h < .85;
  const s = portrait ? .8 : 1;
  if (portrait) { P.phone.set(-2.75, -.1, 0); P.hub.set(0, .55, 0); P.mac.set(3.0, -.85, 0); }
  else { P.phone.set(-6.9, .05, 0); P.hub.set(0, .55, 0); P.mac.set(6.7, -.95, 0); }
  [phone, hub, mac].forEach(o => o.scale.setScalar(s));
  phone.position.copy(P.phone); hub.position.copy(P.hub); mac.position.copy(P.mac);
  ground.position.y = portrait ? -2.1 : -2.25;
  const arc = (a, b, lift, z) => new THREE.CatmullRomCurve3([a, a.clone().lerp(b, .5).add(new THREE.Vector3(0, lift, z)), b], false, 'centripetal');
  const k = s;
  legs[0].curve = arc(P.phone.clone().add(new THREE.Vector3(1.0 * k, .9 * k, .2)), P.hub.clone().add(new THREE.Vector3(-1.2 * k, .15, 0)), 1.6 * k, 1.0);
  legs[1].curve = arc(P.hub.clone().add(new THREE.Vector3(1.2 * k, .15, 0)), P.mac.clone().add(new THREE.Vector3(-1.75 * k, 1.0 * k, .2)), 1.4 * k, .8);
  legs[2].curve = arc(P.mac.clone().add(new THREE.Vector3(-1.0 * k, -.2, 1.0)), P.phone.clone().add(new THREE.Vector3(.75 * k, -1.2 * k, .4)), -.6 * k, 3.0);
  legs.forEach(l => { l.mesh.geometry.dispose(); l.mesh.geometry = new THREE.TubeGeometry(l.curve, 200, portrait ? .028 : .024, 12, false); });
  camera.fov = portrait ? 38 : 30;
  camera.setViewOffset(w, h, 0, -h * (portrait ? .27 : .3), w, h); // keep the headline clear
  camera.updateProjectionMatrix();
}
const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .5, .5, 1.02); // only the bright message capsule blooms
composer.addPass(bloom);
composer.addPass(new OutputPass());
const _layout = layout;
layout = () => { _layout(); composer.setSize(innerWidth, innerHeight); composer.setPixelRatio(renderer.getPixelRatio()); };
addEventListener('resize', layout); layout();

// ---------- motion ----------
const aim = new THREE.Vector2(), mouse = new THREE.Vector2();
addEventListener('pointermove', e => aim.set(e.clientX / innerWidth - .5, e.clientY / innerHeight - .5), { passive: true });
const tan = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
const clock = new THREE.Clock();
let last = -1, sy = 0;

function render(elapsed) {
  const t = elapsed % LOOP;
  const intro = FIXED !== null ? 1 : easeIO(clamp01(elapsed / 2.4));
  mouse.lerp(aim, FIXED !== null ? 1 : .05);
  sy += ((SCROLL ?? Math.min(scrollY / innerHeight, 1.3)) - sy) * (FIXED !== null ? 1 : .08);
  const toMac = easeIO(clamp01(sy / .7));

  // camera: eased entrance, slow drift, damped parallax, scroll dolly
  camera.position.set(Math.sin(elapsed * .09) * .9 + mouse.x * 1.8 + toMac * P.mac.x * .55, 3.4 + (1 - intro) * 2.5 - mouse.y * 1.0 + toMac * .6, (portrait ? 30 : 26.5) + (1 - intro) * 6 - toMac * 9);
  camera.lookAt(toMac * P.mac.x * .8, -.2 + toMac * .2, 0);

  // idle life
  phone.rotation.set(Math.sin(elapsed * .6) * .03, .32 + Math.sin(elapsed * .4) * .08, Math.sin(elapsed * .5) * .02);
  phone.position.y = P.phone.y + Math.sin(elapsed * .9) * .1;
  mac.position.y = P.mac.y + Math.sin(elapsed * .8 + 1) * .06;
  hub.position.y = P.hub.y + Math.sin(elapsed * .85 + 2) * .1;
  rings.forEach((r, i) => { r.rotation.z = elapsed * (i % 2 ? -.22 : .3) + i; });
  core.rotation.set(elapsed * .25, elapsed * .35, 0);

  // the story: message → hub → Mac → reply
  const p0 = seg(t, .6, 1.8), p1 = seg(t, 1.8, 3.0), p2 = seg(t, 6.6, 8.2);
  let leg = -1, prog = 0;
  if (t >= .6 && t < 1.8) { leg = 0; prog = easeIO(p0); } else if (t >= 1.8 && t < 3.0) { leg = 1; prog = easeIO(p1); } else if (t >= 6.6 && t < 8.2) { leg = 2; prog = easeIO(p2); }
  legs.forEach((l, i) => { l.mat.uniforms.uTime.value = elapsed; l.mat.uniforms.uPulse.value = i === leg ? prog : -1; });
  const visible = leg >= 0;
  capsule.visible = halo.visible = visible;
  if (visible) {
    const curve = legs[leg].curve;
    curve.getPointAt(prog, capsule.position); curve.getTangentAt(prog, tan);
    q.setFromUnitVectors(up, tan); capsule.quaternion.copy(q);
    halo.position.copy(capsule.position);
    const col = leg === 2 ? C.coral : leg === 1 ? C.violet : C.sky;
    capsule.material.emissive.copy(col); halo.material.color.copy(col);
    const sc = Math.sin(Math.PI * prog); capsule.scale.setScalar(.6 + .4 * sc); halo.scale.setScalar(.6 + .6 * sc);
  }
  const hit = Math.max(Math.exp(-Math.pow((t - 1.85) * 5, 2)), Math.exp(-Math.pow((t - 3.0) * 5, 2)) * .5);
  core.scale.setScalar(1 + hit * .35); orb.scale.setScalar(1 + hit * .05);

  // screens follow the same clock (redraw ~20fps)
  if (Math.abs(t - last) > .05 || t < last) { drawPhone(t); drawMac(t); last = t; }

  composer.render();
}

const hdr = new RGBELoader().loadAsync(new URL('assets/studio_small_09_1k.hdr', import.meta.url).href);
await document.fonts.ready.catch(() => {});
await macReady.catch(e => console.warn('laptop model failed', e));
hdr.then(tex => { tex.mapping = THREE.EquirectangularReflectionMapping; scene.environment = tex; }).catch(() => { scene.environmentIntensity = 0; })
  .finally(() => {
    if (FIXED !== null) { renderer.setAnimationLoop(() => render(FIXED)); document.title = 'ready'; return; }
    if (reduce) { render(8.6); return; }
    renderer.setAnimationLoop(() => render(clock.getElapsedTime()));
  });
