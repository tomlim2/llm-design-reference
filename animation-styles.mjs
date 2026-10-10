// Twenty 3D animation style studies, one Three.js scene each.
// Every study registers { slug, build(ctx) }. build() returns
// { scene, camera, update(t, dt), render?(), resize?(w, h), dispose?(), toneMapping?, exposure? }.
// ctx = { THREE, renderer, pointer: {x, y} (-1..1, smoothed by the host), quality: 'thumb' | 'full', dpr, width, height }
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const STYLES = [];
export function createStyles() { return STYLES; }

// ---------------------------------------------------------------- shared helpers
const TAU = Math.PI * 2;
const PAPER = '#f3efe6';
const INK = '#292824';
const ACCENT = '#b93e29';
const FONT_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => x * x * (3 - 2 * x);
const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
const easeInOutCubic = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const easeOutBack = x => { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const easeOutElastic = x => x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1;
// Deterministic RNG so thumbnails and the full view show the same composition.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const makeScene = background => { const scene = new THREE.Scene(); scene.background = new THREE.Color(background); return scene; };
const perspective = (fov, position, target = [0, 0, 0]) => {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);
  camera.position.set(...position); camera.lookAt(...target); return camera;
};
const orthographic = (position, target = [0, 0, 0]) => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
  camera.position.set(...position); camera.lookAt(...target); return camera;
};
const fitOrthographic = (camera, height, w, h) => {
  const aspect = w / h;
  camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
};
const setAspect = (camera, w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); };

function canvasTexture(w, h, draw, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (options.repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function fullscreenQuad(fragmentShader, uniforms) {
  const material = new THREE.ShaderMaterial({
    uniforms, fragmentShader, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, camera: new THREE.Camera(), material };
}

const makeTarget = (w, h, nearest = false) => new THREE.WebGLRenderTarget(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)), {
  minFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
  magFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
  samples: nearest ? 0 : 4
});

function postProcess(renderer, scene, camera, target, quad) {
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(quad.scene, quad.camera);
}

// Inverted-hull outline: the mesh drawn again, back faces only, pushed out along the normals.
// The hull gets its own geometry with vertices merged and normals averaged, so it stays
// watertight on extruded shapes whose per-face normals would otherwise tear it open at hard edges.
function addOutline(mesh, width, color = '#141414') {
  const source = mesh.geometry.clone();
  source.deleteAttribute('normal');
  source.deleteAttribute('uv');
  const hullGeometry = mergeVertices(source, 1e-4);
  hullGeometry.computeVertexNormals();
  source.dispose();
  const hull = new THREE.Mesh(hullGeometry, new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uWidth: { value: width }, uColor: { value: new THREE.Color(color) } },
    vertexShader: 'uniform float uWidth;\nvoid main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uWidth, 1.0); }',
    fragmentShader: 'uniform vec3 uColor;\nvoid main() {\n gl_FragColor = vec4(uColor, 1.0);\n #include <colorspace_fragment>\n}'
  }));
  mesh.add(hull);
  return hull;
}

const circleSprite = () => canvasTexture(64, 64, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 1, 0, TAU); g.fill(); });
// Points along a rounded rectangle outline, counter-clockwise from the bottom edge.
function roundedRectPoints(w, h, r, steps = 160) {
  return Array.from({ length: steps }, (_, i) => {
    const u = i / steps * 4, side = Math.floor(u), straightW = w - 2 * r, straightH = h - 2 * r;
    let f = u - side;
    if (f < 0.75) {
      const k = f / 0.75;
      return [[-w / 2 + r + k * straightW, -h / 2, 0], [w / 2, -h / 2 + r + k * straightH, 0], [w / 2 - r - k * straightW, h / 2, 0], [-w / 2, h / 2 - r - k * straightH, 0]][side];
    }
    f = (f - 0.75) / 0.25;
    const arc = (cx, cy, a0) => [cx + Math.cos(a0 + f * Math.PI / 2) * r, cy + Math.sin(a0 + f * Math.PI / 2) * r, 0];
    return [arc(w / 2 - r, -h / 2 + r, -Math.PI / 2), arc(w / 2 - r, h / 2 - r, 0), arc(-w / 2 + r, h / 2 - r, Math.PI / 2), arc(-w / 2 + r, -h / 2 + r, Math.PI)][side];
  });
}

// Shared across studies: one PMREM room environment per renderer, one typeface download.
const environments = new WeakMap();
function getEnvironment(renderer) {
  let texture = environments.get(renderer);
  if (!texture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    texture.userData.shared = true;
    pmrem.dispose();
    environments.set(renderer, texture);
  }
  return texture;
}
let fontPromise = null;
function loadFont() {
  if (!fontPromise) {
    fontPromise = new Promise((resolve, reject) => new FontLoader().load(FONT_URL, resolve, undefined, reject));
    fontPromise.catch(() => { fontPromise = null; });
  }
  return fontPromise;
}

// ================================================================ 01 Particles
STYLES.push({
  slug: 'particles',
  build({ pointer, quality, dpr }) {
    const scene = makeScene('#07080f');
    const camera = perspective(50, [0, 0, 7.6]);
    const count = quality === 'full' ? 16000 : 7000;
    const rng = mulberry32(11);
    const sphere = new Float32Array(count * 3), torus = new Float32Array(count * 3), galaxy = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1, theta = rng() * TAU, ring = Math.sqrt(1 - u * u), radius = 2.05 * (0.93 + rng() * 0.14);
      sphere.set([ring * Math.cos(theta) * radius, u * radius, ring * Math.sin(theta) * radius], i * 3);
      const a = rng() * TAU, b = rng() * TAU, tube = 0.62 * (0.75 + rng() * 0.5);
      torus.set([(1.95 + tube * Math.cos(b)) * Math.cos(a), tube * Math.sin(b), (1.95 + tube * Math.cos(b)) * Math.sin(a)], i * 3);
      const arm = Math.floor(rng() * 3), dist = Math.pow(rng(), 0.55) * 3.1;
      const angle = arm * (TAU / 3) + dist * 1.45 + (rng() - 0.5) * (0.5 + dist * 0.25);
      const thick = (rng() - 0.5) * 0.35 * (1.25 - dist / 3.4);
      galaxy.set([Math.cos(angle) * dist, thick + (rng() - 0.5) * 0.08, Math.sin(angle) * dist], i * 3);
      seed[i] = rng();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(sphere, 3));
    geometry.setAttribute('aTorus', new THREE.BufferAttribute(torus, 3));
    geometry.setAttribute('aGalaxy', new THREE.BufferAttribute(galaxy, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixel: { value: dpr } },
      vertexShader: `
        attribute vec3 aTorus; attribute vec3 aGalaxy; attribute float aSeed;
        uniform float uTime, uPixel;
        varying vec3 vColor; varying float vFade;
        void main() {
          float cycle = uTime / 4.8 + aSeed * 0.22;
          float stage = mod(floor(cycle), 3.0);
          float f = smoothstep(0.58, 1.0, fract(cycle));
          f = f * f * (3.0 - 2.0 * f);
          vec3 from = stage < 0.5 ? position : stage < 1.5 ? aTorus : aGalaxy;
          vec3 to = stage < 0.5 ? aTorus : stage < 1.5 ? aGalaxy : position;
          vec3 p = mix(from, to, f);
          p += 0.085 * vec3(sin(p.y * 3.1 + uTime * 1.3 + aSeed * 6.28), sin(p.z * 2.7 + uTime * 1.1 + aSeed * 3.0), sin(p.x * 3.3 + uTime * 1.7));
          float spin = uTime * 0.16 + (stage > 1.5 ? uTime * 0.25 * (1.0 - f) : 0.0);
          float c = cos(spin), s = sin(spin);
          p.xz = mat2(c, -s, s, c) * p.xz;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.5 + aSeed * 2.6) * uPixel * (9.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
          float h = length(p.xz) / 3.0;
          vColor = mix(vec3(0.18, 0.72, 1.0), vec3(1.0, 0.28, 0.66), smoothstep(0.15, 0.85, h + aSeed * 0.12));
          vColor = mix(vColor, vec3(1.0, 0.86, 0.45), smoothstep(0.78, 1.05, h) * 0.85);
          vFade = (0.72 + 0.28 * sin(uTime * 2.2 + aSeed * 31.0)) * (0.55 + 0.45 * smoothstep(-11.0, -4.5, mv.z));
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vFade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r2 = dot(d, d);
          if (r2 > 0.25) discard;
          float a = exp(-r2 * 13.0) * vFade;
          gl_FragColor = vec4(vColor * a * 1.25, a);
        }`
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    return {
      scene, camera,
      update(t) {
        material.uniforms.uTime.value = t;
        points.rotation.x = 0.42 - pointer.y * 0.45;
        points.rotation.y = pointer.x * 0.6;
        camera.position.z = 7.6 + Math.sin(t * 0.3) * 0.35;
      }
    };
  }
});

// ================================================================ 02 Liquid morph
STYLES.push({
  slug: 'liquid-morph',
  build({ pointer, quality }) {
    const balls = Array.from({ length: 5 }, () => new THREE.Vector4());
    const quad = fullscreenQuad(`
      precision highp float;
      uniform float uAspect; uniform int uSteps; uniform vec4 uBalls[5];
      varying vec2 vUv;
      float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
      float map(vec3 p) {
        float d = 1e9;
        for (int i = 0; i < 5; i++) d = smin(d, length(p - uBalls[i].xyz) - uBalls[i].w, 0.6);
        return d;
      }
      vec3 normalAt(vec3 p) {
        vec2 e = vec2(0.0025, 0.0);
        return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
      }
      vec3 studio(vec3 r) {
        float y = r.y * 0.5 + 0.5;
        vec3 c = mix(vec3(0.14, 0.12, 0.11), vec3(0.97, 0.95, 0.9), smoothstep(0.08, 0.92, y));
        c += vec3(1.0) * smoothstep(0.03, 0.0, abs(r.y - 0.52) - 0.09) * smoothstep(0.75, 0.25, abs(r.x)) * 1.3;
        c += vec3(1.0, 0.92, 0.82) * smoothstep(0.03, 0.0, abs(r.y + 0.12) - 0.045) * smoothstep(0.9, 0.1, abs(r.z + 0.5)) * 0.7;
        c += vec3(0.95, 0.32, 0.16) * smoothstep(0.1, -0.8, r.y) * smoothstep(0.3, -0.7, r.x) * 0.55;
        c += vec3(0.2, 0.45, 0.9) * smoothstep(0.1, -0.7, r.y) * smoothstep(-0.3, 0.7, r.x) * 0.25;
        return c;
      }
      void main() {
        vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0);
        vec3 ro = vec3(0.0, 0.0, 6.0);
        vec3 rd = normalize(vec3(uv * 0.9, -1.4));
        float t = 0.0; bool hit = false;
        for (int i = 0; i < 96; i++) {
          if (i >= uSteps) break;
          float d = map(ro + rd * t);
          if (d < 0.0012) { hit = true; break; }
          t += d * 0.92;
          if (t > 13.0) break;
        }
        vec3 paper = vec3(0.955, 0.94, 0.905);
        float shade = 0.0;
        for (int i = 0; i < 5; i++) {
          float depth = 6.0 - uBalls[i].z;
          vec2 sp = uBalls[i].xy * (1.4 / 0.9) / depth;
          float rr = uBalls[i].w * (1.4 / 0.9) / depth;
          shade = max(shade, smoothstep(rr * 2.3, rr * 0.75, length(uv - sp - vec2(0.0, -rr * 0.6))));
        }
        vec3 col = paper * (1.0 - 0.26 * shade);
        if (hit) {
          vec3 p = ro + rd * t;
          vec3 n = normalAt(p);
          vec3 r = reflect(rd, n);
          float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
          vec3 tint = 0.5 + 0.5 * cos(6.2832 * (fresnel * 1.6 + n.y * 0.25 + vec3(0.0, 0.33, 0.67)));
          vec3 metal = studio(r) * mix(vec3(0.82, 0.83, 0.86), vec3(1.0), fresnel) * mix(vec3(1.0), tint, 0.22);
          metal += pow(max(dot(r, normalize(vec3(0.55, 0.8, 0.5))), 0.0), 70.0) * 0.9;
          float ao = clamp(map(p + n * 0.4) / 0.4, 0.0, 1.0);
          col = metal * (0.62 + 0.38 * ao);
        }
        gl_FragColor = vec4(col, 1.0);
      }`, { uAspect: { value: 1 }, uSteps: { value: quality === 'full' ? 84 : 64 }, uBalls: { value: balls } });
    const held = new THREE.Vector3();
    return {
      scene: quad.scene, camera: quad.camera,
      resize: (w, h) => { quad.material.uniforms.uAspect.value = w / h; },
      update(t, dt) {
        for (let i = 0; i < 4; i++) {
          const ph = i * 1.37, b = balls[i];
          b.set(
            1.55 * Math.sin(t * 0.43 + ph) * Math.cos(t * 0.19 + i * 0.7),
            1.05 * Math.sin(t * 0.37 + ph * 1.6),
            0.7 * Math.sin(t * 0.5 + ph * 0.6),
            (i === 0 ? 1.0 : 0.72) + 0.2 * Math.sin(t * 0.6 + i * 2.1)
          );
        }
        held.lerp(new THREE.Vector3(pointer.x * 1.9, pointer.y * 1.3, 0.6), 1 - Math.pow(0.02, dt || 0.016));
        balls[4].set(held.x, held.y, held.z, 0.55 + 0.1 * Math.sin(t * 1.3));
      }
    };
  }
});

// ================================================================ 03 Holographic
STYLES.push({
  slug: 'holographic',
  build({ renderer, pointer, quality }) {
    const scene = makeScene('#090a14');
    scene.environment = getEnvironment(renderer);
    const camera = perspective(30, [0, 0, 10.5]);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(40, 26), new THREE.MeshBasicMaterial({
      map: canvasTexture(512, 320, (g, w, h) => {
        const grad = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6);
        grad.addColorStop(0, '#1d1f3a'); grad.addColorStop(0.55, '#0d0e1c'); grad.addColorStop(1, '#06060c');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
      })
    }));
    backdrop.position.z = -9;
    scene.add(backdrop);
    const thickness = canvasTexture(512, 768, (g, w, h) => {
      const rng = mulberry32(3);
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      g.save(); g.translate(w / 2, h / 2); g.rotate(-0.6);
      for (let x = -w; x < w; x += 6) { const v = Math.round(128 + 110 * Math.sin(x * 0.045) + 40 * Math.sin(x * 0.19)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, -h, 6, h * 2); }
      g.restore();
      g.globalCompositeOperation = 'overlay';
      for (let y = 0; y < h; y += 28) for (let x = 0; x < w; x += 28) {
        g.fillStyle = (x / 28 + y / 28) % 2 ? '#9a9a9a' : '#606060';
        g.beginPath(); g.moveTo(x + 14, y); g.lineTo(x + 28, y + 14); g.lineTo(x + 14, y + 28); g.lineTo(x, y + 14); g.closePath(); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 2600; i++) { const v = Math.round(rng() * 255); g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.fillRect(rng() * w, rng() * h, 2, 2); }
    }, { data: true });
    const face = canvasTexture(512, 768, (g, w, h) => {
      g.fillStyle = '#2b2d3c'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d7dbe8'; g.lineWidth = 6; g.strokeRect(26, 26, w - 52, h - 52);
      g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2 - 40, 150, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(w / 2, h / 2 - 190); g.lineTo(w / 2 + 150, h / 2 - 40); g.lineTo(w / 2, h / 2 + 110); g.lineTo(w / 2 - 150, h / 2 - 40); g.closePath(); g.stroke();
      g.fillStyle = '#d7dbe8'; g.beginPath(); g.arc(w / 2, h / 2 - 40, 34, 0, TAU); g.fill();
      g.font = '700 30px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'center'; g.fillText('HOLOGRAPHIC', w / 2, h - 96);
      g.font = '400 20px "SFMono-Regular",Menlo,monospace'; g.fillText('DESIGN STYLE  Nº 03', w / 2, h - 62);
    });
    const material = new THREE.MeshPhysicalMaterial({
      map: face, color: 0xffffff, metalness: 0.85, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.6,
      iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 800], iridescenceThicknessMap: thickness
    });
    const card = new THREE.Mesh(new RoundedBoxGeometry(3.2, 4.6, 0.09, 4, 0.16), material);
    scene.add(card);
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 4.4), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vView; varying vec3 vNormal;\nvoid main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `
        uniform float uTime; varying vec2 vUv; varying vec3 vView; varying vec3 vNormal;
        void main() {
          float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
          float hue = facing * 2.4 + (vUv.x - vUv.y) * 1.4 + uTime * 0.07;
          vec3 rainbow = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
          float bands = 0.65 + 0.35 * sin((vUv.x + vUv.y) * 38.0 + facing * 14.0);
          float strength = (0.16 + 0.34 * pow(1.0 - facing, 1.4)) * bands;
          gl_FragColor = vec4(rainbow * strength, 1.0);
        }`
    }));
    sheen.position.z = 0.056; card.add(sheen);
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 5, 6); scene.add(key);
    const sweep = new THREE.PointLight(0xffffff, 70, 0, 2); scene.add(sweep);
    const sparkCount = quality === 'full' ? 140 : 70, rng = mulberry32(7);
    const sparkPositions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) sparkPositions.set([(rng() - 0.5) * 9, (rng() - 0.5) * 7, (rng() - 0.5) * 4 - 0.5], i * 3);
    const sparks = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3)),
      new THREE.PointsMaterial({ map: circleSprite(), color: 0xffffff, size: 0.11, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(sparks);
    return {
      scene, camera, toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.1,
      update(t) {
        card.rotation.y = Math.sin(t * 0.5) * 0.6 + pointer.x * 0.55;
        card.rotation.x = Math.sin(t * 0.36) * 0.28 - pointer.y * 0.4;
        card.rotation.z = Math.sin(t * 0.27) * 0.07;
        card.position.y = Math.sin(t * 0.8) * 0.12;
        sheen.material.uniforms.uTime.value = t;
        sparks.rotation.y = t * 0.05; sparks.rotation.x = Math.sin(t * 0.2) * 0.2;
        sparks.material.opacity = 0.5 + 0.4 * Math.sin(t * 3);
        sweep.position.set(Math.cos(t * 0.9) * 4.5, Math.sin(t * 0.7) * 3, 3.5);
      }
    };
  }
});

// ================================================================ 04 Neon glow
STYLES.push({
  slug: 'neon-glow',
  build({ renderer, pointer, quality, dpr, width, height }) {
    const scene = makeScene('#06050a');
    const camera = perspective(36, [0, 0, 12]);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), new THREE.MeshStandardMaterial({
      roughness: 0.92, metalness: 0,
      map: canvasTexture(1024, 640, (g, w, h) => {
        const rng = mulberry32(5);
        g.fillStyle = '#1c181f'; g.fillRect(0, 0, w, h);
        for (let row = 0; row < 20; row++) for (let col = -1; col < 10; col++) {
          const x = col * 110 + (row % 2) * 55, y = row * 32, v = 46 + Math.floor(rng() * 20);
          g.fillStyle = `rgb(${v + 6},${v},${v + 2})`; g.fillRect(x + 3, y + 3, 104, 26);
        }
      }, { repeat: true })
    }));
    wall.material.map.repeat.set(3.4, 2.2);
    wall.position.z = -0.6;
    scene.add(wall);
    const board = new THREE.Mesh(new THREE.BoxGeometry(9.6, 6.4, 0.25), new THREE.MeshStandardMaterial({ color: 0x0c0b10, roughness: 0.6 }));
    board.position.z = -0.3;
    scene.add(board);
    scene.add(new THREE.AmbientLight(0xffffff, 0.16));
    const tubes = [];
    const neon = (points, hex, { closed = false, radius = 0.075 } = {}) => {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', 0.2);
      const color = new THREE.Color(hex);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, closed ? 160 : 90, radius, 10, closed), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.5), toneMapped: false }));
      const light = new THREE.PointLight(color, 48, 0, 2);
      const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      light.position.copy(center).setZ(1.2);
      scene.add(mesh, light);
      const tube = { mesh, light, color, level: 1, baseIntensity: 48 };
      tubes.push(tube);
      return tube;
    };
    const roundedRect = (w, h, r, steps = 160) => Array.from({ length: steps }, (_, i) => {
      const u = i / steps * 4, side = Math.floor(u), straightW = w - 2 * r, straightH = h - 2 * r;
      let f = u - side;
      const arc = (cx, cy, a0) => [cx + Math.cos(a0 + f * Math.PI / 2) * r, cy + Math.sin(a0 + f * Math.PI / 2) * r, 0];
      if (f < 0.75) { const k = f / 0.75; return [[-w / 2 + r + k * straightW, -h / 2, 0], [w / 2, -h / 2 + r + k * straightH, 0], [w / 2 - r - k * straightW, h / 2, 0], [-w / 2, h / 2 - r - k * straightH, 0]][side]; }
      f = (f - 0.75) / 0.25;
      return [arc(w / 2 - r, -h / 2 + r, -Math.PI / 2), arc(w / 2 - r, h / 2 - r, 0), arc(-w / 2 + r, h / 2 - r, Math.PI / 2), arc(-w / 2 + r, -h / 2 + r, Math.PI)][side];
    });
    const frame = neon(roundedRect(8.4, 5.0, 0.7), '#ff2d8f', { closed: true, radius: 0.07 });
    const bolt = neon([[-0.9, 2.1, 0.1], [0.45, 0.35, 0.1], [-0.3, 0.35, 0.1], [0.9, -2.1, 0.1], [-0.45, -0.3, 0.1], [0.3, -0.3, 0.1]], '#fff04a', { radius: 0.08 });
    const ring = neon(Array.from({ length: 24 }, (_, i) => [Math.cos(i / 24 * TAU) * 2.6, Math.sin(i / 24 * TAU) * 2.6, 0.05]), '#2ce4ff', { closed: true });
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), quality === 'full' ? 0.85 : 0.75, 0.5, 0.62);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const setLevel = (tube, level) => {
      tube.level = level;
      tube.mesh.material.color.copy(tube.color).multiplyScalar(0.12 + 1.4 * level);
      tube.light.intensity = tube.baseIntensity * (0.1 + 0.9 * level);
    };
    const flicker = t => {
      const burst = Math.floor(t / 5.5), local = t - burst * 5.5;
      if (local > 0.55) return 1;
      const step = Math.floor(local * 36);
      const r = Math.sin(step * 127.1 + burst * 311.7) * 43758.5453;
      return (r - Math.floor(r)) > 0.42 ? 1 : 0.08;
    };
    return {
      scene, camera,
      resize(w, h) {
        setAspect(camera, w, h); composer.setPixelRatio(dpr); composer.setSize(w, h);
        const half = Math.tan(camera.fov * Math.PI / 360);
        camera.position.z = Math.max(5.6 / (half * camera.aspect), 3.6 / half);
      },
      update(t) {
        setLevel(bolt, flicker(t));
        setLevel(ring, 0.86 + 0.14 * Math.sin(t * 2.1));
        setLevel(frame, 0.95 + 0.05 * Math.sin(t * 7.3));
        camera.position.x = pointer.x * 0.9; camera.position.y = pointer.y * 0.6;
        camera.lookAt(0, 0, 0);
      },
      render() { composer.render(); },
      dispose() { bloom.dispose(); composer.dispose(); }
    };
  }
});

// ================================================================ 05 Wireframe 3D
STYLES.push({
  slug: 'wireframe-3d',
  build({ pointer, dpr, width, height }) {
    const scene = makeScene(PAPER);
    const camera = perspective(38, [0, 2.4, 9.5], [0, 0.3, 0]);
    const paperFill = () => new THREE.MeshBasicMaterial({ color: PAPER, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
    const terrainGeometry = new THREE.PlaneGeometry(18, 11, 44, 27);
    terrainGeometry.rotateX(-Math.PI / 2);
    const terrainBase = terrainGeometry.attributes.position.array.slice();
    const terrainFill = new THREE.Mesh(terrainGeometry, paperFill());
    const terrainLines = new THREE.Mesh(terrainGeometry, new THREE.MeshBasicMaterial({ color: INK, wireframe: true, transparent: true, opacity: 0.55 }));
    terrainFill.position.y = terrainLines.position.y = -1.7;
    terrainLines.renderOrder = 1;
    scene.add(terrainFill, terrainLines);
    const hero = new THREE.Group();
    scene.add(hero);
    const icosa = new THREE.IcosahedronGeometry(1.45, 1);
    const lineMaterial = new LineMaterial({ color: new THREE.Color(INK).getHex(), linewidth: 2.4, worldUnits: false, resolution: new THREE.Vector2(width * dpr, height * dpr) });
    const lines = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(icosa, 1)), lineMaterial);
    lines.renderOrder = 2;
    const fill = new THREE.Mesh(icosa, paperFill());
    const dots = new THREE.Points(icosa, new THREE.PointsMaterial({ color: ACCENT, size: 7, map: circleSprite(), alphaTest: 0.5, sizeAttenuation: false }));
    dots.renderOrder = 3;
    hero.add(fill, lines, dots);
    const ringGeometry = new THREE.TorusGeometry(2.4, 0.08, 6, 36);
    const ring = new THREE.Group();
    ring.add(new THREE.Mesh(ringGeometry, paperFill()), new THREE.LineSegments(new THREE.EdgesGeometry(ringGeometry, 20), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.75 })));
    ring.children[1].renderOrder = 1;
    hero.add(ring);
    const satelliteGeometry = new THREE.OctahedronGeometry(0.42, 0);
    const satellite = new THREE.Group();
    satellite.add(new THREE.Mesh(satelliteGeometry, paperFill()), new THREE.LineSegments(new THREE.EdgesGeometry(satelliteGeometry), new THREE.LineBasicMaterial({ color: ACCENT })));
    satellite.children[1].renderOrder = 2;
    ring.add(satellite);
    const positions = terrainGeometry.attributes.position;
    return {
      scene, camera,
      resize(w, h) { setAspect(camera, w, h); lineMaterial.resolution.set(w * dpr, h * dpr); },
      update(t) {
        for (let i = 0; i < positions.count; i++) {
          const x = terrainBase[i * 3], z = terrainBase[i * 3 + 2];
          positions.setY(i, 0.5 * Math.sin(x * 0.75 + t * 0.8) * Math.cos(z * 0.6 - t * 0.9) + 0.32 * Math.sin((x - z) * 1.1 + t * 1.3) + 0.12 * Math.sin(x * 2.3 + z * 1.7));
        }
        positions.needsUpdate = true;
        hero.position.y = 0.9 + Math.sin(t * 0.9) * 0.2;
        fill.rotation.set(t * 0.22, t * 0.37, 0); lines.rotation.copy(fill.rotation); dots.rotation.copy(fill.rotation);
        ring.rotation.set(Math.PI / 2 + Math.sin(t * 0.4) * 0.5, t * 0.3, 0);
        satellite.position.set(Math.cos(t * 1.1) * 2.4, Math.sin(t * 1.1) * 2.4, 0); satellite.rotation.set(t, t * 0.7, 0);
        const yaw = pointer.x * 0.35, pitch = 0.26 - pointer.y * 0.15;
        camera.position.set(Math.sin(yaw) * 9.8, 2.4 + Math.sin(pitch) * 3, Math.cos(yaw) * 9.8);
        camera.lookAt(0, 0.3, 0);
      }
    };
  }
});

// ================================================================ 06 Glassmorphism
STYLES.push({
  slug: 'glassmorphism',
  build({ renderer, pointer }) {
    const scene = makeScene('#15163a');
    scene.environment = getEnvironment(renderer);
    const camera = perspective(34, [0, 0, 11.5]);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(34, 22), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main() {
          vec2 p = vUv * vec2(1.55, 1.0);
          vec3 col = vec3(0.07, 0.07, 0.2);
          vec2 a = vec2(0.35 + 0.2 * sin(uTime * 0.21), 0.65 + 0.15 * cos(uTime * 0.17));
          vec2 b = vec2(1.15 + 0.2 * cos(uTime * 0.19), 0.3 + 0.2 * sin(uTime * 0.23));
          vec2 c = vec2(0.8 + 0.25 * sin(uTime * 0.13), 0.85 + 0.1 * sin(uTime * 0.29));
          col = mix(col, vec3(0.55, 0.2, 0.75), smoothstep(0.75, 0.0, distance(p, a)));
          col = mix(col, vec3(0.1, 0.45, 0.9), smoothstep(0.8, 0.0, distance(p, b)));
          col = mix(col, vec3(0.95, 0.35, 0.45), smoothstep(0.55, 0.0, distance(p, c)) * 0.7);
          gl_FragColor = vec4(col, 1.0);
        }`
    }));
    backdrop.position.z = -6;
    scene.add(backdrop);
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 6, 7); scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const orbs = [['#ff5f6d', 1.15], ['#ffc371', 0.8], ['#4facfe', 1.05], ['#a18cd1', 0.75], ['#43e97b', 0.6]].map(([color, radius]) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0, envMapIntensity: 0.6 }));
      scene.add(orb); return orb;
    });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: 0.42, thickness: 0.7, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 0.9, specularIntensity: 1 });
    const chrome = (w, h, z, color = 0xffffff, opacity = 0.85) => {
      const bar = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.05, 2, Math.min(w, h) / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity }));
      bar.position.z = z; return bar;
    };
    const card = new THREE.Group();
    card.add(new THREE.Mesh(new RoundedBoxGeometry(3.8, 4.8, 0.26, 4, 0.34), glass));
    const z = 0.16;
    [[-0.95, 1.55, 1.4, 0.34], [-0.55, 0.85, 2.2, 0.2], [-0.4, 0.4, 2.5, 0.2], [-0.75, -0.05, 1.8, 0.2]].forEach(([x, y, w, h]) => { const bar = chrome(w, h, z, 0xffffff, 0.8); bar.position.x = x; bar.position.y = y; card.add(bar); });
    const button = chrome(1.5, 0.5, z, 0xff5f6d, 0.95); button.position.set(-0.9, -1.2, z); card.add(button);
    const avatar = new THREE.Mesh(new THREE.CircleGeometry(0.38, 32), new THREE.MeshBasicMaterial({ color: 0x4facfe, transparent: true, opacity: 0.95 })); avatar.position.set(1.2, 1.55, z); card.add(avatar);
    const edgeLine = (w, h, r, z) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(roundedRectPoints(w, h, r, 96).map(p => new THREE.Vector3(p[0], p[1], z))), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    card.add(edgeLine(3.8, 4.8, 0.34, 0.135));
    card.position.set(-1.2, 0, 1);
    const chip = new THREE.Group();
    chip.add(new THREE.Mesh(new RoundedBoxGeometry(2.7, 1.5, 0.22, 4, 0.3), glass));
    const dot = chrome(0.26, 0.26, 0.14, 0xffffff, 0.9); dot.position.set(-0.95, 0.35, 0.14); chip.add(dot);
    const line = chrome(1.3, 0.16, 0.14, 0xffffff, 0.8); line.position.set(0.05, 0.35, 0.14); chip.add(line);
    const line2 = chrome(1.9, 0.16, 0.14, 0xffffff, 0.6); line2.position.set(0.0, -0.25, 0.14); chip.add(line2);
    chip.add(edgeLine(2.7, 1.5, 0.3, 0.115));
    chip.position.set(2.4, -1.4, 1.6);
    scene.add(card, chip);
    return {
      scene, camera, toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.05,
      resize(w, h) { setAspect(camera, w, h); camera.position.z = Math.max(11.5, 4.2 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect)); },
      update(t) {
        backdrop.material.uniforms.uTime.value = t;
        orbs.forEach((orb, i) => orb.position.set(Math.cos(t * 0.33 + i * 1.3) * 3.6, Math.sin(t * 0.47 + i * 2.1) * 2.2, -1.8 + Math.sin(t * 0.4 + i) * 1.4));
        card.position.y = Math.sin(t * 0.7) * 0.18;
        card.rotation.y = Math.sin(t * 0.45) * 0.22 + pointer.x * 0.35;
        card.rotation.x = Math.sin(t * 0.38) * 0.1 - pointer.y * 0.25;
        chip.position.y = -1.4 + Math.sin(t * 0.9 + 1.5) * 0.22;
        chip.rotation.y = Math.sin(t * 0.5 + 2) * 0.25 + pointer.x * 0.3;
        chip.rotation.x = -pointer.y * 0.2;
      }
    };
  }
});

// ================================================================ 07 Kinetic type
STYLES.push({
  slug: 'kinetic-type',
  build({ pointer }) {
    const scene = makeScene(PAPER);
    const camera = perspective(30, [0, 0.6, 16], [0, 0, 0]);
    let wordWidth = 9.6, aspect = 1;
    const fit = () => { camera.position.z = Math.max(12, (wordWidth / 2 + 1.1) / (Math.tan(camera.fov * Math.PI / 360) * aspect)); camera.lookAt(0, 0, 0); };
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc9bd, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(3, 7, 8); scene.add(key);
    const word = 'MOTION';
    const letters = new THREE.Group();
    scene.add(letters);
    const ringTexture = canvasTexture(2048, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#8f8a80'; g.font = '700 74px "Helvetica Neue",Arial,sans-serif'; g.textBaseline = 'middle';
      const unit = 'KINETIC TYPE  ✦  ', unitWidth = g.measureText(unit).width, n = Math.max(1, Math.round(w / unitWidth));
      g.save(); g.scale(w / (n * unitWidth), 1);
      for (let i = 0; i < n; i++) g.fillText(unit, i * unitWidth, h / 2 + 4);
      g.restore();
    });
    ringTexture.wrapS = THREE.RepeatWrapping;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.7, 96, 1, true), new THREE.MeshBasicMaterial({ map: ringTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = 0.1; ring.position.z = -1.5;
    scene.add(ring);
    let glyphs = [];
    let disposed = false;
    const layout = meshes => {
      const widths = meshes.map(m => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return b.max.x - b.min.x; });
      const gap = 0.26, total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
      let x = -total / 2;
      meshes.forEach((m, i) => { m.geometry.center(); m.userData.x = x + widths[i] / 2; m.position.x = m.userData.x; x += widths[i] + gap; letters.add(m); });
      glyphs = meshes; wordWidth = total; fit();
    };
    const material = index => new THREE.MeshStandardMaterial({ color: index === 2 ? ACCENT : INK, roughness: 0.55, metalness: 0.05 });
    loadFont().then(font => {
      if (disposed) return;
      layout([...word].map((ch, i) => new THREE.Mesh(new TextGeometry(ch, { font, size: 1.6, height: 0.45, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }), material(i))));
    }).catch(() => {
      if (disposed) return;
      layout([...word].map((ch, i) => new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.6, 0.45), new THREE.MeshStandardMaterial({
        map: canvasTexture(256, 324, (g, w, h) => { g.fillStyle = i === 2 ? ACCENT : INK; g.fillRect(0, 0, w, h); g.fillStyle = PAPER; g.font = '900 250px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, w / 2, h / 2 + 14); }),
        roughness: 0.6
      }))));
    });
    const PERIOD = 5.4, FLIP = 1.0, STAGGER = 0.2;
    return {
      scene, camera,
      resize(w, h) { aspect = w / h; setAspect(camera, w, h); fit(); },
      update(t) {
        const local = t % PERIOD, accent = Math.floor(t / PERIOD) % Math.max(1, glyphs.length);
        glyphs.forEach((m, i) => {
          if (!m.material.map) m.material.color.set(i === accent ? ACCENT : INK);
          const p = clamp((local - i * STAGGER) / FLIP, 0, 1);
          const e = easeInOutCubic(p);
          m.rotation.x = e * TAU;
          m.position.y = Math.sin(p * Math.PI) * 0.7 + Math.sin(t * 2.2 + i * 0.6) * 0.12;
          m.position.z = Math.sin(p * Math.PI) * 0.6;
          const squeeze = 1 + 0.1 * Math.sin(p * Math.PI);
          m.scale.set(squeeze, 1 / squeeze, 1);
        });
        const breathe = 1 + 0.025 * Math.sin(t * 1.6);
        letters.scale.setScalar(breathe);
        letters.rotation.y = pointer.x * 0.35;
        letters.rotation.x = -pointer.y * 0.25;
        ring.rotation.y = -t * 0.22;
        ring.position.y = Math.sin(t * 0.5) * 0.3 - 1.2;
      },
      dispose() { disposed = true; }
    };
  }
});

// ================================================================ 08 Isometric
STYLES.push({
  slug: 'isometric',
  build({ pointer, quality }) {
    const scene = makeScene('#efe9dd');
    const camera = orthographic([12, 12, 12]);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9c7b0, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(6, 11, 4); sun.castShadow = true;
    sun.shadow.mapSize.setScalar(quality === 'full' ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const city = new THREE.Group();
    scene.add(city);
    const flat = (color, roughness = 0.95) => new THREE.MeshStandardMaterial({ color, roughness });
    const block = (w, h, d, color, x, y, z, parent = city) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(color));
      mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    block(7.6, 0.5, 7.6, '#f7f1e4', 0, -0.25, 0);
    const N = 7, half = (N - 1) / 2, rng = mulberry32(21);
    const palette = ['#f6c1a3', '#f28c6b', '#ffd98a', '#a8d8d0', '#b8c7f2', '#f5a3b9', '#cfe6a8'];
    const buildings = [], trees = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const x = c - half, z = r - half;
      if (r === 3 || c === 3) {
        block(1, 0.03, 1, '#5b585e', x, 0.015, z);
        if (r === 3 && c !== 3) block(0.3, 0.012, 0.06, '#f3efe6', x, 0.035, z);
        if (c === 3 && r !== 3) block(0.06, 0.012, 0.3, '#f3efe6', x, 0.035, z);
        continue;
      }
      if (r < 2 && c < 2) {
        block(1, 0.04, 1, '#bfe0a3', x, 0.02, z);
        if (rng() > 0.25) { const tree = new THREE.Group(); block(0.1, 0.3, 0.1, '#8a6a4a', 0, 0.15, 0, tree); block(0.42, 0.55, 0.42, '#6cbf7a', 0, 0.55, 0, tree); block(0.26, 0.4, 0.26, '#5aa968', 0, 1.0, 0, tree); tree.position.set(x + (rng() - 0.5) * 0.4, 0.04, z + (rng() - 0.5) * 0.4); city.add(tree); trees.push(tree); }
        continue;
      }
      const height = 0.7 + Math.pow(rng(), 1.4) * 2.8, color = palette[Math.floor(rng() * palette.length)];
      const tower = new THREE.Group(); tower.position.set(x, 0, z); city.add(tower);
      block(0.78, height, 0.78, color, 0, height / 2, 0, tower);
      if (rng() > 0.5) block(0.5, 0.35, 0.5, rng() > 0.7 ? ACCENT : color, 0, height + 0.175, 0, tower);
      else block(0.84, 0.08, 0.84, '#5b585e', 0, height + 0.04, 0, tower);
      buildings.push({ group: tower, delay: (r + c) * 0.11 + rng() * 0.25, phase: rng() * TAU });
    }
    const cars = [[0.22, 1, '#e0412a'], [-0.22, -1, '#2b4bd6'], [0.22, 1, '#f2b705', true], [-0.22, -1, '#2a2a2a', true]].map(([lane, dir, color, vertical], i) => {
      const car = new THREE.Group();
      block(0.42, 0.18, 0.24, color, 0, 0.14, 0, car); block(0.22, 0.13, 0.2, '#f3efe6', -0.02, 0.29, 0, car);
      if (vertical) car.rotation.y = Math.PI / 2;
      city.add(car);
      return { car, lane, dir, vertical, offset: i * 2.3, speed: 1.4 + i * 0.25 };
    });
    const CYCLE = 11;
    return {
      scene, camera,
      resize: (w, h) => fitOrthographic(camera, 11.5, w, h),
      update(t) {
        const local = t % CYCLE;
        buildings.forEach(({ group, delay, phase }) => {
          let s;
          if (local < 7.5) s = easeOutElastic(clamp((local - delay) / 1.3, 0, 1));
          else s = 1 - easeInOutCubic(clamp((local - 7.5 - delay * 0.4) / 0.9, 0, 1));
          group.scale.y = Math.max(0.001, s * (1 + 0.015 * Math.sin(t * 2 + phase)));
        });
        cars.forEach(({ car, lane, dir, vertical, offset, speed }) => {
          const along = ((t * speed + offset) % 9) - 4.5;
          if (vertical) car.position.set(lane, 0.03, along * dir); else car.position.set(along * dir, 0.03, lane);
          car.rotation.y = vertical ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? Math.PI : 0);
        });
        trees.forEach((tree, i) => { tree.rotation.z = Math.sin(t * 1.6 + i * 1.3) * 0.05; tree.rotation.x = Math.cos(t * 1.1 + i) * 0.04; });
        city.rotation.y = t * 0.06 + pointer.x * 0.22;
        city.position.y = pointer.y * 0.3;
      }
    };
  }
});

// ================================================================ 09 Clay 3D
STYLES.push({
  slug: 'clay-3d',
  build({ pointer, quality }) {
    const background = '#f4d9c6';
    const scene = makeScene(background);
    const camera = perspective(32, [0, 3.4, 11.5], [0, 0.9, 0]);
    scene.add(new THREE.HemisphereLight(0xfff6ee, 0xe3b9a0, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(4, 8, 5); sun.castShadow = true;
    sun.shadow.mapSize.setScalar(quality === 'full' ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const bump = canvasTexture(256, 256, (g, w, h) => {
      const rng = mulberry32(9);
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const v = 90 + Math.floor(rng() * 80); g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.beginPath(); g.arc(rng() * w, rng() * h, 1 + rng() * 2.5, 0, TAU); g.fill(); }
    }, { data: true, repeat: true });
    bump.repeat.set(3, 3);
    const clay = color => new THREE.MeshStandardMaterial({ color, roughness: 0.96, metalness: 0, bumpMap: bump, bumpScale: 0.02 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: background, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const shaded = mesh => { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };
    const character = new THREE.Group();
    const body = shaded(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), clay('#ff9d9d'))); body.scale.set(1, 0.94, 1);
    character.add(body);
    const eyes = [];
    [-0.33, 0.33].forEach(x => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), clay('#3b2b2b')); eye.position.set(x, 0.26, 0.86); character.add(eye); eyes.push(eye);
      const foot = shaded(new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), clay('#e9868d'))); foot.position.set(x * 1.3, -0.86, 0.2); foot.scale.set(1, 0.6, 1.2); character.add(foot);
      const blush = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), clay('#f26b7c')); blush.position.set(x * 1.75, -0.05, 0.74); blush.scale.set(1, 0.65, 0.35); character.add(blush);
    });
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 10, 20, Math.PI), clay('#3b2b2b'));
    mouth.position.set(0, -0.08, 0.95); mouth.rotation.z = Math.PI; character.add(mouth);
    character.position.y = 1;
    scene.add(character);
    const donut = shaded(new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.28, 28, 56), clay('#9fd3ff')));
    donut.position.set(-2.7, 0.86, 0.2); scene.add(donut);
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 0.42 : 0.95; i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const star = shaded(new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 4 }), clay('#ffd36e')));
    star.position.set(2.7, 1.1, 0); scene.add(star);
    const stepped = t => Math.floor(t * 12) / 12;
    const jitter = (frame, salt) => { const v = Math.sin(frame * 12.9898 + salt * 78.233) * 43758.5453; return (v - Math.floor(v) - 0.5) * 0.02; };
    return {
      scene, camera,
      resize(w, h) { setAspect(camera, w, h); camera.position.z = Math.max(11.5, 4.1 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect)); },
      update(t) {
        const q = stepped(t), frame = Math.round(q * 12);
        const hop = (q % 1.3) / 1.3, air = Math.sin(hop * Math.PI);
        const squash = hop < 0.12 || hop > 0.88 ? 0.82 : 1 + air * 0.12;
        character.position.set(jitter(frame, 1), 1 + air * 1.5 - (1 - squash) * 0.9, jitter(frame, 2));
        character.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        const blink = (q % 3.25) < 0.17 ? 0.12 : 1;
        eyes.forEach(eye => eye.scale.set(1, blink, 1));
        character.rotation.y = Math.sin(q * 1.1) * 0.45 + pointer.x * 0.4;
        character.rotation.z = Math.sin(q * 2.4) * 0.08;
        donut.rotation.set(Math.PI / 2 + Math.sin(q * 1.5) * 0.4, 0, q * 1.2 + jitter(frame, 3) * 5);
        donut.position.y = 0.86 + Math.abs(Math.sin(q * 2.4)) * 0.5;
        star.rotation.z = Math.floor(q * 1.6) * 0.3 + jitter(frame, 4) * 4;
        star.rotation.y = Math.sin(q * 0.9) * 0.6;
        star.position.y = 1.1 + Math.sin(q * 2.0 + 1) * 0.25;
        camera.position.x = pointer.x * 1.2; camera.position.y = 3.4 + pointer.y * 0.8; camera.lookAt(0, 0.9, 0);
      }
    };
  }
});

// ================================================================ 10 ASCII art
STYLES.push({
  slug: 'ascii-art',
  build({ renderer, pointer, dpr, width, height }) {
    const sub = makeScene('#000000');
    const subCamera = perspective(40, [0, 0, 6.4]);
    sub.add(new THREE.AmbientLight(0xffffff, 0.12));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 3, 4); sub.add(key);
    const sweep = new THREE.PointLight(0xffffff, 40, 0, 2); sub.add(sweep);
    const donut = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.64, 48, 96), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }));
    sub.add(donut);
    const ramp = ' .,:;i1tfLCG08@';
    const atlas = canvasTexture(ramp.length * 32, 64, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = '700 46px "SFMono-Regular",Menlo,Consolas,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      [...ramp].forEach((ch, i) => g.fillText(ch, i * 32 + 16, h / 2 + 3));
    }, { data: true });
    atlas.minFilter = THREE.LinearFilter; atlas.magFilter = THREE.LinearFilter; atlas.generateMipmaps = false;
    const grid = new THREE.Vector2(1, 1);
    const target = makeTarget(64, 32, true);
    const quad = fullscreenQuad(`
      uniform sampler2D uScene, uAtlas; uniform vec2 uGrid; uniform float uLevels;
      varying vec2 vUv;
      void main() {
        vec2 cell = floor(vUv * uGrid);
        vec3 c = texture2D(uScene, (cell + 0.5) / uGrid).rgb;
        float lum = pow(clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0), 0.7);
        float index = floor(lum * (uLevels - 0.001));
        vec2 f = fract(vUv * uGrid);
        float glyph = texture2D(uAtlas, vec2((index + f.x) / uLevels, f.y)).r;
        vec3 ink = mix(vec3(0.1, 0.55, 0.25), vec3(0.6, 1.0, 0.65), lum);
        vec3 col = mix(vec3(0.01, 0.025, 0.015), ink, glyph) * (0.55 + 0.7 * lum);
        col += vec3(0.05, 0.13, 0.07) * (1.0 - smoothstep(0.05, 0.1, length(f - 0.5))) * step(index, 0.5);
        gl_FragColor = vec4(col, 1.0);
      }`, { uScene: { value: target.texture }, uAtlas: { value: atlas }, uGrid: { value: grid }, uLevels: { value: ramp.length } });
    const instance = {
      scene: sub, camera: subCamera,
      resize(w, h) {
        const cols = Math.max(40, Math.round(w / 7)), rows = Math.max(20, Math.round(h / 14));
        grid.set(cols, rows); target.setSize(cols, rows); setAspect(subCamera, w, h);
      },
      update(t) {
        donut.rotation.x = t * 0.7 - pointer.y * 0.8;
        donut.rotation.y = t * 0.45 + pointer.x * 0.9;
        sweep.position.set(Math.cos(t * 1.1) * 3.5, Math.sin(t * 0.8) * 2.5, 2.5);
      },
      render() { postProcess(renderer, sub, subCamera, target, quad); },
      dispose() { target.dispose(); }
    };
    instance.resize(width, height);
    return instance;
  }
});

// ================================================================ 11 Gradient mesh
STYLES.push({
  slug: 'gradient-mesh',
  build({ pointer }) {
    const quad = fullscreenQuad(`
      precision highp float;
      uniform float uTime, uAspect; uniform vec2 uPointer;
      varying vec2 vUv;
      vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        float a = dot(hash2(i) - 0.5, f), b = dot(hash2(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
        float c = dot(hash2(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0)), d = dot(hash2(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0;
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.55; for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 1.9 + vec2(1.7, 9.2); a *= 0.45; } return v; }
      void main() {
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float t = uTime * 0.08;
        vec2 m = uPointer * vec2(uAspect, 1.0) * 0.5;
        float ripple = 0.08 * sin(distance(p, m) * 9.0 - uTime * 2.5) * smoothstep(0.9, 0.0, distance(p, m));
        vec2 q = vec2(fbm(p * 0.8 + vec2(0.0, t)), fbm(p * 0.8 + vec2(5.2, 1.3) - t));
        vec2 r = vec2(fbm(p * 0.8 + 1.8 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p * 0.8 + 1.8 * q + vec2(8.3, 2.8) - t * 0.4));
        float f = fbm(p * 0.8 + 2.0 * r) + ripple;
        vec3 stops[5] = vec3[5](vec3(1.0, 0.47, 0.42), vec3(1.0, 0.87, 0.5), vec3(0.99, 0.94, 0.88), vec3(0.45, 0.78, 1.0), vec3(0.6, 0.42, 0.95));
        float v = clamp(0.5 + f * 1.4 + r.x * 0.5 + 0.12 * sin(uTime * 0.09), 0.0, 0.999);
        float seg = v * 4.0; int i0 = int(floor(seg)); float k = smoothstep(0.0, 1.0, fract(seg));
        vec3 col = mix(stops[i0], stops[min(i0 + 1, 4)], k);
        col = mix(col, stops[1], smoothstep(0.25, 0.6, q.y) * 0.35);
        vec2 dir = vec2(cos(uTime * 0.11), sin(uTime * 0.11));
        col += 0.07 * smoothstep(0.45, 0.0, abs(dot(p, dir) - 0.2 * sin(uTime * 0.23) + 0.15 * f));
        float grain = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        col += (grain - 0.5) * 0.035;
        gl_FragColor = vec4(col, 1.0);
      }`, { uTime: { value: 0 }, uAspect: { value: 1 }, uPointer: { value: new THREE.Vector2() } });
    return {
      scene: quad.scene, camera: quad.camera,
      resize: (w, h) => { quad.material.uniforms.uAspect.value = w / h; },
      update(t) { quad.material.uniforms.uTime.value = t; quad.material.uniforms.uPointer.value.set(pointer.x, pointer.y); }
    };
  }
});

// ================================================================ 12 Comic book
STYLES.push({
  slug: 'comic-book',
  build({ pointer }) {
    const scene = makeScene('#ffd84a');
    const camera = perspective(40, [0, 0, 9]);
    const ramp = new THREE.DataTexture(new Uint8Array([60, 150, 255]), 3, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.8); key.position.set(3, 4, 5); scene.add(key);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), new THREE.ShaderMaterial({
      uniforms: { uA: { value: new THREE.Color('#ffd84a') }, uB: { value: new THREE.Color('#ff4b3a') }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uA, uB; uniform float uTime; varying vec2 vUv;
        void main() {
          vec2 st = (vUv - 0.5) * vec2(1.66, 1.0);
          float a = 0.6; mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
          vec2 g = R * st * 70.0; vec2 f = fract(g) - 0.5;
          float dist = length(st) * 1.9;
          float radius = 0.08 + 0.5 * smoothstep(0.1, 1.0, dist) + 0.04 * sin(uTime * 2.0);
          float dot = 1.0 - smoothstep(radius - 0.08, radius + 0.08, length(f));
          float rays = step(0.5, fract(atan(st.y, st.x) * 14.0 / 6.2832 + uTime * 0.1));
          vec3 col = mix(uA, uB, dot);
          col = mix(col, col * 0.86, rays * smoothstep(0.35, 1.0, dist));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    }));
    backdrop.position.z = -5;
    scene.add(backdrop);
    const toon = color => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    const boltShape = new THREE.Shape();
    [[-0.45, 1.4], [0.35, 0.25], [-0.1, 0.25], [0.5, -1.4], [-0.5, -0.1], [0.0, -0.1]].forEach(([x, y], i) => i ? boltShape.lineTo(x, y) : boltShape.moveTo(x, y));
    boltShape.closePath();
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 0.5 : 1.1; i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const extrude = { depth: 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 };
    const objects = [
      [new THREE.SphereGeometry(1.05, 48, 32), '#e63946', -2.6, 0.2, 0.06],
      [new THREE.ExtrudeGeometry(boltShape, extrude), '#ffe14f', 0.1, 0.3, 0.07],
      [new THREE.ExtrudeGeometry(starShape, extrude), '#1d6fe5', 2.7, -0.4, 0.07]
    ].map(([geometry, color, x, y, width]) => {
      geometry.center();
      const mesh = new THREE.Mesh(geometry, toon(color)); mesh.position.set(x, y, 0); addOutline(mesh, width); scene.add(mesh);
      return { mesh, x, y };
    });
    const words = ['POW!', 'BAM!', 'ZAP!', 'WOW!'];
    const burstTextures = words.map((word, w) => canvasTexture(512, 512, (g, W, H) => {
      const rng = mulberry32(31 + w);
      g.translate(W / 2, H / 2);
      g.beginPath();
      for (let i = 0; i < 26; i++) { const a = i / 26 * TAU, r = (i % 2 ? 150 : 230) + (rng() - 0.5) * 36; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 15; g.lineJoin = 'round'; g.strokeStyle = '#141414'; g.stroke();
      g.rotate(-0.14); g.font = 'italic 900 148px "Arial Black",Impact,"Helvetica Neue",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 18; g.strokeStyle = '#141414'; g.strokeText(word, 0, 8); g.fillStyle = ['#e63946', '#1d6fe5', '#ff8a2b', '#e63946'][w]; g.fillText(word, 0, 8);
    }));
    const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: burstTextures[0], transparent: true }));
    burst.position.set(1.3, 1.9, 1.5);
    scene.add(burst);
    const CYCLE = 2.6;
    return {
      scene, camera,
      resize(w, h) { setAspect(camera, w, h); camera.position.z = Math.max(9, 4.4 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect)); },
      update(t) {
        backdrop.material.uniforms.uTime.value = t;
        objects.forEach(({ mesh, x, y }, i) => {
          const bounce = Math.abs(Math.sin(t * 2.2 + i * 1.1));
          mesh.position.set(x, y + bounce * 0.6, 0);
          mesh.rotation.set(Math.sin(t * 0.9 + i) * 0.4 - pointer.y * 0.5, t * 0.6 + i * 2 + pointer.x * 0.8, 0);
          const squash = 1 - (1 - bounce) * 0.12;
          mesh.scale.set(1 / Math.sqrt(squash), squash, 1);
        });
        const k = Math.floor(t / CYCLE) % words.length, local = (t % CYCLE) / CYCLE;
        burst.material.map = burstTextures[k];
        const anchor = objects[k % objects.length].mesh, offset = [[1.2, 1.5], [0.0, 2.1], [-1.2, 1.5]][k % objects.length];
        burst.position.set(anchor.position.x + offset[0], anchor.position.y + offset[1], 1.5);
        let s = 0;
        if (local < 0.18) s = easeOutBack(local / 0.18);
        else if (local < 0.78) s = 1 + 0.04 * Math.sin(t * 14);
        else if (local < 0.86) s = 1 - (local - 0.78) / 0.08;
        burst.scale.setScalar(Math.max(0.0001, s) * 3.4);
        burst.material.rotation = Math.sin(t * 6) * 0.08 + (k % 2 ? 0.14 : -0.1);
      }
    };
  }
});

// ================================================================ 13 Split-flap
STYLES.push({
  slug: 'split-flap',
  build({ pointer }) {
    const COLS = 11, ROWS = 3, CW = 1, CH = 1.42, HH = CH / 2;
    const GLYPHS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:→';
    const ATLAS_COLS = 8, ATLAS_ROWS = Math.ceil(GLYPHS.length / ATLAS_COLS);
    const scene = makeScene('#e9e4d8');
    const camera = perspective(30, [0, 0, 16]);
    scene.add(new THREE.HemisphereLight(0xfff3e0, 0x9a948a, 0.9));
    const lamp = new THREE.DirectionalLight(0xfff1d6, 2.2); lamp.position.set(2, 6, 8); scene.add(lamp);
    const atlas = canvasTexture(ATLAS_COLS * 128, ATLAS_ROWS * 192, (g) => {
      [...GLYPHS].forEach((ch, i) => {
        const x = (i % ATLAS_COLS) * 128, y = Math.floor(i / ATLAS_COLS) * 192;
        g.fillStyle = '#23211e'; g.fillRect(x, y, 128, 192);
        g.fillStyle = '#f4eee2'; g.font = '700 146px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(ch, x + 64, y + 100);
        g.fillStyle = '#0c0b0a'; g.fillRect(x, y + 93, 128, 6);
      });
    });
    const board = new THREE.Group();
    scene.add(board);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(COLS * CW + 0.7, ROWS * CH + 1.5, 0.5, 2, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2825, roughness: 0.5, metalness: 0.6 }));
    frame.position.set(0, 0.4, -0.3); board.add(frame);
    const header = new THREE.Mesh(new THREE.PlaneGeometry(COLS * CW, 0.5), new THREE.MeshStandardMaterial({
      map: canvasTexture(2048, 94, (g, w, h) => {
        g.fillStyle = '#1b1917'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#d9b245'; g.font = '700 54px "Helvetica Neue",Arial,sans-serif'; g.textBaseline = 'middle'; g.fillText('DEPARTURES', 40, h / 2 + 2);
        g.fillStyle = '#9a948a'; g.font = '500 40px "SFMono-Regular",Menlo,monospace'; g.textAlign = 'right'; g.fillText('DESIGN STYLE COLLECTION  ·  13 / 20', w - 40, h / 2 + 2);
      }), roughness: 0.7
    }));
    header.position.set(0, (ROWS * CH) / 2 + 0.42, 0.01); board.add(header);
    const face = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55, metalness: 0.05 });
    const halfGeometry = () => new THREE.PlaneGeometry(CW - 0.08, HH - 0.015);
    const setUV = (geometry, glyph, top, back) => {
      const col = glyph % ATLAS_COLS, row = Math.floor(glyph / ATLAS_COLS);
      const u0 = col / ATLAS_COLS, u1 = (col + 1) / ATLAS_COLS, vTop = 1 - row / ATLAS_ROWS, vBottom = 1 - (row + 1) / ATLAS_ROWS, vMid = (vTop + vBottom) / 2;
      const [hi, lo] = top ? [vTop, vMid] : [vMid, vBottom], uv = geometry.attributes.uv;
      if (back) { uv.setXY(0, u1, lo); uv.setXY(1, u0, lo); uv.setXY(2, u1, hi); uv.setXY(3, u0, hi); }
      else { uv.setXY(0, u0, hi); uv.setXY(1, u1, hi); uv.setXY(2, u0, lo); uv.setXY(3, u1, lo); }
      uv.needsUpdate = true;
    };
    const cells = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = new THREE.Group();
      cell.position.set((c - (COLS - 1) / 2) * CW, ((ROWS - 1) / 2 - r) * CH, 0);
      board.add(cell);
      const top = new THREE.Mesh(halfGeometry(), face), bottom = new THREE.Mesh(halfGeometry(), face);
      const pivot = new THREE.Group(), front = new THREE.Mesh(halfGeometry(), face), back = new THREE.Mesh(halfGeometry(), face);
      top.position.y = HH / 2; bottom.position.y = -HH / 2; pivot.position.z = 0.012;
      front.position.y = HH / 2; back.position.set(0, HH / 2, -0.004); back.rotation.y = Math.PI;
      pivot.add(front, back); cell.add(top, bottom, pivot);
      const state = { glyph: 0, next: 0, target: 0, progress: -1, delay: 0, bump: 0, col: c, row: r, group: cell, top, bottom, front, back, pivot };
      state.rest = () => { setUV(top.geometry, state.glyph, true); setUV(bottom.geometry, state.glyph, false); setUV(front.geometry, state.glyph, true); pivot.rotation.x = 0; };
      state.rest();
      cells.push(state);
    }
    const center = text => { const padStart = Math.floor((COLS - text.length) / 2); return (' '.repeat(padStart) + text).padEnd(COLS, ' '); };
    const messages = [['NOW', 'BOARDING', 'GATE 20'], ['DESIGN', 'STYLE', 'COLLECTION'], ['SPLIT-FLAP', 'DISPLAY', '13 OF 20'], ['THREE.JS', 'LIVE', 'RENDER'], ['SHIP IT', '→', 'TODAY']].map(lines => lines.map(center));
    let messageIndex = -1, nextChange = 0;
    return {
      scene, camera,
      resize(w, h) {
        setAspect(camera, w, h);
        const half = Math.tan(camera.fov * Math.PI / 360);
        camera.position.z = Math.max((ROWS * CH + 2.6) / 2 / half, (COLS * CW + 1.6) / 2 / (half * camera.aspect));
        camera.position.y = 0.4; camera.lookAt(0, 0.4, 0);
      },
      update(t, dt) {
        if (t >= nextChange) {
          messageIndex = (messageIndex + 1) % messages.length;
          nextChange = t + 6.5;
          cells.forEach(cell => {
            cell.target = Math.max(0, GLYPHS.indexOf(messages[messageIndex][cell.row][cell.col]));
            cell.delay = cell.col * 0.06 + cell.row * 0.1 + Math.random() * 0.12;
          });
        }
        cells.forEach(cell => {
          if (cell.progress < 0) {
            if (cell.glyph === cell.target) return;
            cell.delay -= dt;
            if (cell.delay > 0) return;
            cell.next = (cell.glyph + 1) % GLYPHS.length;
            setUV(cell.top.geometry, cell.next, true); setUV(cell.bottom.geometry, cell.glyph, false);
            setUV(cell.front.geometry, cell.glyph, true); setUV(cell.back.geometry, cell.next, false, true);
            cell.progress = 0;
          }
          cell.progress += dt / 0.1;
          cell.pivot.rotation.x = smooth(Math.min(cell.progress, 1)) * Math.PI;
          if (cell.progress >= 1) { cell.glyph = cell.next; cell.progress = -1; cell.bump = 1; cell.rest(); }
        });
        cells.forEach(cell => { if (cell.bump > 0.001) { cell.group.rotation.x = -cell.bump * 0.07; cell.bump *= 0.7; } else cell.group.rotation.x = 0; });
        board.rotation.y += (pointer.x * 0.28 - board.rotation.y) * 0.1;
        board.rotation.x += (-pointer.y * 0.18 - board.rotation.x) * 0.1;
      }
    };
  }
});

// ================================================================ 14 Retro VHS
STYLES.push({
  slug: 'retro-vhs',
  build({ renderer, pointer, width, height }) {
    const sub = makeScene('#1a0b3b');
    const camera = perspective(58, [0, 1.5, 5.5], [0, 1.3, 0]);
    sub.fog = new THREE.Fog('#1a0b3b', 9, 34);
    sub.add(camera);
    sub.background = canvasTexture(8, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#12062b'); grad.addColorStop(0.5, '#6a1a78'); grad.addColorStop(0.78, '#ff4f8b'); grad.addColorStop(1, '#ff9e4f');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    });
    const sun = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, fog: false,
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main() {
          float y = vUv.y;
          float band = step(0.5, fract(y * 13.0 - uTime * 0.35));
          float keep = y < 0.5 ? mix(1.0, band, smoothstep(0.5, 0.05, y)) : 1.0;
          if (keep < 0.5) discard;
          vec3 col = mix(vec3(1.0, 0.18, 0.6), vec3(1.0, 0.9, 0.35), smoothstep(0.1, 0.9, y));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    }));
    sun.position.set(0, 3.2, -16); sub.add(sun);
    const grid = new THREE.GridHelper(70, 70, 0xff2fb3, 0xff2fb3); sub.add(grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({ color: 0x1a0b3b }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; sub.add(floor);
    const mountains = new THREE.Group(); sub.add(mountains);
    for (let i = 0; i < 9; i++) {
      const h = 2.5 + ((i * 7) % 5) * 0.9;
      const peak = new THREE.Mesh(new THREE.ConeGeometry(2.6, h, 4), new THREE.MeshBasicMaterial({ color: 0x24104a }));
      peak.position.set(-18 + i * 4.5 + (i % 2) * 1.3, h / 2, -20 - (i % 3) * 2); mountains.add(peak);
      peak.add(new THREE.LineSegments(new THREE.EdgesGeometry(peak.geometry), new THREE.LineBasicMaterial({ color: 0xff57c7, transparent: true, opacity: 0.55 })));
    }
    sub.add(new THREE.AmbientLight(0xffffff, 0.5));
    const lamp = new THREE.DirectionalLight(0xffa6ff, 2.4); lamp.position.set(2, 4, 3); sub.add(lamp);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x2de2e6, emissive: 0x0a4d58, roughness: 0.3, metalness: 0.6 }));
    cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0xffffff })));
    cube.position.set(0, 1.8, -1.5); sub.add(cube);
    const overlayCanvas = document.createElement('canvas'); overlayCanvas.width = 1024; overlayCanvas.height = 256;
    const overlayContext = overlayCanvas.getContext('2d');
    const overlayTexture = new THREE.CanvasTexture(overlayCanvas); overlayTexture.colorSpace = THREE.SRGBColorSpace;
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true, depthTest: false, fog: false }));
    overlay.renderOrder = 10; camera.add(overlay);
    const drawOverlay = t => {
      const g = overlayContext;
      g.clearRect(0, 0, 1024, 256);
      g.font = '700 64px "Courier New",Courier,monospace'; g.fillStyle = '#d8ffd0'; g.textBaseline = 'top';
      if (Math.floor(t * 1.4) % 2 === 0) g.fillText('PLAY ►', 24, 20);
      const total = Math.floor(t + 872), hh = String(Math.floor(total / 3600)).padStart(2, '0'), mm = String(Math.floor(total / 60) % 60).padStart(2, '0'), ss = String(total % 60).padStart(2, '0');
      g.font = '700 52px "Courier New",Courier,monospace'; g.fillText(hh + ':' + mm + ':' + ss, 24, 110);
      g.textAlign = 'right'; g.fillText('SP   OCT. 09 2026', 1000, 110); g.textAlign = 'left';
    };
    const target = makeTarget(Math.round(width * 0.6), Math.round(height * 0.6));
    const quad = fullscreenQuad(`
      uniform sampler2D uScene; uniform float uTime; uniform vec2 uRes;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec3 yiq(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
      vec3 rgb(vec3 y) { return vec3(y.x + 0.956 * y.y + 0.621 * y.z, y.x - 0.272 * y.y - 0.647 * y.z, y.x - 1.106 * y.y + 1.703 * y.z); }
      void main() {
        vec2 uv = vUv;
        float band = fract(-uTime * 0.11);
        float inBand = smoothstep(0.1, 0.0, abs(uv.y - band));
        float jitter = hash(vec2(floor(uTime * 24.0), floor(uv.y * 40.0))) - 0.5;
        uv.x += inBand * (0.025 * sin(uv.y * 140.0 + uTime * 40.0) + 0.02 * jitter) + 0.0012 * sin(uv.y * 4.0 + uTime * 1.5) + 0.0006 * jitter;
        uv.y += 0.012 * sin(uTime * 41.0) * step(0.93, hash(vec2(floor(uTime * 2.5), 2.0)));
        vec3 luma = yiq(texture2D(uScene, uv).rgb);
        vec3 chroma = vec3(0.0);
        for (int i = -3; i <= 3; i++) chroma += yiq(texture2D(uScene, uv + vec2(float(i) * 1.6 / uRes.x, 0.0)).rgb);
        chroma /= 7.0;
        vec3 col = rgb(vec3(luma.x, chroma.y * 1.15, chroma.z * 1.15));
        col.r = rgb(yiq(texture2D(uScene, uv + vec2(1.4 / uRes.x, 0.0)).rgb)).r;
        col *= 0.9 + 0.1 * sin(vUv.y * uRes.y * 3.14159);
        col += (hash(uv * uRes + uTime) - 0.5) * 0.08 + inBand * 0.25 * hash(vec2(uv.y * 80.0, uTime * 7.0));
        float tear = smoothstep(0.04, 0.0, vUv.y) * step(0.5, hash(vec2(floor(vUv.y * 200.0), floor(uTime * 30.0))));
        col = mix(col, vec3(0.75), tear * 0.6);
        float row = floor(vUv.y * uRes.y * 0.5), frameId = floor(uTime * 12.0);
        float streak = step(0.985, hash(vec2(row, frameId))) * step(0.6, hash(vec2(frameId, 9.0))) * step(vUv.x, hash(vec2(row, 3.0))) * step(hash(vec2(row, 5.0)) * 0.5, vUv.x);
        col = mix(col, vec3(0.92), streak * 0.8);
        col *= 1.0 - 0.4 * pow(length(vUv - 0.5) * 1.2, 2.5);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`, { uScene: { value: target.texture }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(target.width, target.height) } });
    return {
      scene: sub, camera,
      resize(w, h) {
        const rw = Math.max(2, Math.round(w * 0.6)), rh = Math.max(2, Math.round(h * 0.6));
        target.setSize(rw, rh); quad.material.uniforms.uRes.value.set(rw, rh);
        setAspect(camera, w, h);
        const dist = 4, half = Math.tan(camera.fov * Math.PI / 360) * dist;
        overlay.position.set(-half * camera.aspect + 2.25, half - 0.75, -dist);
      },
      update(t) {
        grid.position.z = (t * 2.4) % 1;
        sun.material.uniforms.uTime.value = t;
        cube.rotation.set(t * 0.6, t * 0.9, 0); cube.position.y = 1.8 + Math.sin(t * 1.5) * 0.25;
        camera.position.x = pointer.x * 0.5; camera.lookAt(pointer.x * 0.3, 1.3 + pointer.y * 0.3, 0);
        drawOverlay(t); overlayTexture.needsUpdate = true;
        quad.material.uniforms.uTime.value = t;
      },
      render() { postProcess(renderer, sub, camera, target, quad); },
      dispose() { target.dispose(); }
    };
  }
});

// ================================================================ 15 Halftone
STYLES.push({
  slug: 'halftone',
  build({ pointer, dpr }) {
    const scene = makeScene(PAPER);
    const camera = perspective(38, [0, 0, 9]);
    const halftone = () => new THREE.ShaderMaterial({
      uniforms: { uPaper: { value: new THREE.Color(PAPER) }, uInk: { value: new THREE.Color('#1c1b19') }, uAccent: { value: new THREE.Color(ACCENT) }, uCell: { value: 8 * dpr }, uLight: { value: new THREE.Vector3(-0.45, 0.7, 0.6).normalize() } },
      vertexShader: 'varying vec3 vNormal;\nvoid main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uPaper, uInk, uAccent, uLight; uniform float uCell; varying vec3 vNormal;
        float dots(vec2 frag, float angle, float coverage) {
          mat2 R = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
          vec2 f = fract(R * frag / uCell) - 0.5;
          float d = length(f), r = sqrt(max(coverage, 0.0)) * 0.64, aa = fwidth(d) * 0.9 + 0.002;
          return 1.0 - smoothstep(r - aa, r + aa, d);
        }
        void main() {
          float light = clamp(dot(normalize(vNormal), uLight) * 0.5 + 0.5, 0.0, 1.0);
          float shadow = smoothstep(0.75, 0.05, light);
          float mid = smoothstep(1.0, 0.25, light) * 0.85;
          float black = dots(gl_FragCoord.xy, 0.785, shadow);
          float red = dots(gl_FragCoord.xy + vec2(0.3, -0.22) * uCell, 0.262, mid);
          vec3 col = mix(uPaper, uAccent, red);
          col = mix(col, uInk, black);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.3, 64), new THREE.ShaderMaterial({
      uniforms: { uPaper: { value: new THREE.Color(PAPER) }, uAccent: { value: new THREE.Color(ACCENT) }, uCell: { value: 8 * dpr }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uPaper, uAccent; uniform float uCell, uTime; varying vec2 vUv;
        void main() {
          float a = 0.262; mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
          vec2 f = fract(R * gl_FragCoord.xy / uCell) - 0.5;
          float dist = length(vUv - 0.5) * 2.0;
          float coverage = smoothstep(1.0, 0.0, dist) * (0.55 + 0.1 * sin(uTime * 1.5));
          float d = length(f), r = sqrt(coverage) * 0.64, aa = fwidth(d) * 0.9 + 0.002;
          gl_FragColor = vec4(mix(uPaper, uAccent, (1.0 - smoothstep(r - aa, r + aa, d)) * 0.55), 1.0);
          #include <colorspace_fragment>
        }`
    }));
    disc.position.set(0.4, 0.3, -2.5); scene.add(disc);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.45, 64, 48), halftone());
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.46, 48, 96), halftone());
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.0, 64), halftone());
    [sphere, torus, cone].forEach(mesh => addOutline(mesh, 0.028, '#1c1b19'));
    const group = new THREE.Group(); group.add(sphere, torus, cone); scene.add(group);
    return {
      scene, camera,
      resize(w, h) { setAspect(camera, w, h); camera.position.z = Math.max(9, 4.4 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect)); },
      update(t) {
        disc.material.uniforms.uTime.value = t;
        sphere.position.set(Math.cos(t * 0.45) * 2.6, Math.sin(t * 0.7) * 0.7, Math.sin(t * 0.45) * 0.8);
        torus.position.set(Math.cos(t * 0.45 + 2.1) * 2.6, Math.sin(t * 0.7 + 2.1) * 0.7, Math.sin(t * 0.45 + 2.1) * 0.8); torus.rotation.set(t * 0.7, t * 0.4, 0);
        cone.position.set(Math.cos(t * 0.45 + 4.2) * 2.6, Math.sin(t * 0.7 + 4.2) * 0.7, Math.sin(t * 0.45 + 4.2) * 0.8); cone.rotation.set(Math.sin(t * 0.8) * 0.5, 0, t * 0.5);
        group.rotation.y = pointer.x * 0.35; group.rotation.x = -pointer.y * 0.25;
      }
    };
  }
});

// ================================================================ 16 Bauhaus
STYLES.push({
  slug: 'bauhaus',
  build({ pointer, quality }) {
    const scene = makeScene('#efe6d2');
    const camera = orthographic([6, 7, 10], [0, 0.3, 0]);
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 9, 6); sun.castShadow = true;
    sun.shadow.mapSize.setScalar(quality === 'full' ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 40 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const stage = new THREE.Group(); scene.add(stage);
    const flat = color => new THREE.MeshLambertMaterial({ color });
    const solid = (geometry, color, x, y, z) => { const m = new THREE.Mesh(geometry, flat(color)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; stage.add(m); return m; };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshLambertMaterial({ color: '#efe6d2' }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; stage.add(floor);
    const sphere = solid(new THREE.SphereGeometry(0.75, 48, 32), '#d62e1f', -2.6, 0.75, 1.2);
    const cube = solid(new THREE.BoxGeometry(1.3, 1.3, 1.3), '#f2b705', 0.2, 0.65, -0.4);
    const cylinder = solid(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 48), '#1f4aa8', 2.6, 0.75, 0.6);
    const cone = solid(new THREE.ConeGeometry(0.62, 1.4, 48), '#141414', -0.9, 0.7, 2.4);
    const bar = solid(new THREE.BoxGeometry(3.6, 0.12, 0.12), '#141414', 1.4, 0.06, 2.9);
    const post = solid(new THREE.BoxGeometry(0.12, 3.2, 0.12), '#141414', -3.6, 1.6, -1.6);
    const ring = solid(new THREE.TorusGeometry(0.9, 0.06, 12, 64), '#141414', 3.2, 0.9, -2.2);
    const disc = solid(new THREE.CircleGeometry(1.6, 64), '#1f4aa8', -3.2, 0.01, -1.0); disc.rotation.x = -Math.PI / 2; disc.castShadow = false;
    const stripe = solid(new THREE.BoxGeometry(16, 0.02, 0.5), '#f2b705', 0, 0.011, -3.4); stripe.castShadow = false;
    const PERIOD = 8, ACT = 0.5;
    // Progress of the move scheduled on `beat` within the current 8-beat cycle: 0 before, eased 0..1 during, 1 after.
    const move = (t, beat) => ({ count: Math.floor(t / PERIOD), p: easeInOutCubic(clamp(((t % PERIOD) - beat) / ACT, 0, 1)) });
    return {
      scene, camera,
      resize: (w, h) => fitOrthographic(camera, Math.max(7.4, 9.4 / (w / h)), w, h),
      update(t) {
        const turnA = move(t, 0), turnB = move(t, 4);
        cube.rotation.y = (turnA.count + turnB.count + turnA.p + turnB.p) * Math.PI / 2;
        cube.position.y = 0.65 + Math.sin(turnB.p * Math.PI) * 0.6;
        const rollOut = move(t, 1).p, rollBack = move(t, 5).p, roll = (rollOut - rollBack) * 1.6;
        sphere.position.x = -2.6 + roll; sphere.rotation.z = -roll / 0.75;
        const hop = move(t, 2);
        cylinder.position.y = 0.75 + Math.sin(hop.p * Math.PI) * 1.3; cylinder.rotation.y = (hop.count + hop.p) * Math.PI;
        const pivot = move(t, 3);
        cone.rotation.z = Math.sin(pivot.p * Math.PI) * 0.45; cone.rotation.y = (pivot.count + pivot.p) * Math.PI / 2;
        const spin = move(t, 6);
        bar.rotation.y = (spin.count + spin.p) * Math.PI / 2;
        ring.rotation.y = (spin.count + spin.p) * Math.PI / 2 + Math.PI / 2;
        const pulse = Math.sin(move(t, 7).p * Math.PI);
        [sphere, cube, cylinder, cone].forEach(m => m.scale.setScalar(1 + pulse * 0.12));
        post.scale.y = 1 + pulse * 0.08;
        stage.rotation.y = pointer.x * 0.2;
      }
    };
  }
});

// ================================================================ 17 Pixel art
STYLES.push({
  slug: 'pixel-art',
  build({ renderer, pointer, width, height }) {
    const sub = new THREE.Scene();
    sub.background = canvasTexture(8, 256, (g, w, h) => { const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#3f8fe8'); grad.addColorStop(0.6, '#7fc8ff'); grad.addColorStop(1, '#d8f0ff'); g.fillStyle = grad; g.fillRect(0, 0, w, h); });
    const camera = orthographic([10, 8.5, 10]);
    sub.add(new THREE.HemisphereLight(0xffffff, 0x9bbbd0, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(6, 10, 3); sun.castShadow = true; sun.shadow.mapSize.setScalar(1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    sun.shadow.bias = -0.001;
    sub.add(sun);
    const palette = ['#7fc8ff', '#5fbf4a', '#4aa23a', '#8a5a3c', '#6d4530', '#8c8c99', '#3a8cff', '#5a3a22', '#2f9a3a', '#45b84e', '#f2e3c6', '#d9422f', '#ffffff', '#ff6fa3', '#ffd24a', '#1b1b2a', '#3f8fe8', '#d8f0ff'];
    const C = { sky: 0, grass: 1, grassDark: 2, dirt: 3, dirtDark: 4, stone: 5, water: 6, trunk: 7, leaf: 8, leafLight: 9, wall: 10, roof: 11, cloud: 12, flower: 13, flower2: 14, door: 15 };
    const voxels = [];
    const add = (x, y, z, color, tag = '') => voxels.push({ x, y, z, color, tag });
    const rng = mulberry32(17);
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
      const d = Math.hypot(x, z) + (rng() - 0.5) * 0.9;
      if (d > 5.4) continue;
      const pond = x >= 1 && x <= 2 && z >= -3 && z <= -2;
      add(x, 2, z, pond ? C.water : (rng() > 0.8 ? C.grassDark : C.grass), pond ? 'water' : 'top');
      add(x, 1, z, C.dirt); add(x, 0, z, rng() > 0.5 ? C.dirt : C.dirtDark);
      if (d < 4.3) add(x, -1, z, C.dirtDark);
      if (d < 3.0) add(x, -2, z, rng() > 0.4 ? C.stone : C.dirtDark);
      if (d < 1.6) add(x, -3, z, C.stone);
      if (!pond && rng() > 0.9) add(x, 3, z, rng() > 0.5 ? C.flower : C.flower2, 'flower');
    }
    for (let y = 3; y <= 5; y++) add(-2, y, 1, C.trunk);
    for (let x = -3; x <= -1; x++) for (let z = 0; z <= 2; z++) for (let y = 5; y <= 6; y++) if (!(Math.abs(x + 2) === 1 && Math.abs(z - 1) === 1 && y === 6)) add(x, y, z, (x + z + y) % 2 ? C.leaf : C.leafLight);
    add(-2, 7, 1, C.leafLight); add(-2, 7, 2, C.leaf); add(-3, 7, 1, C.leaf);
    for (let x = 1; x <= 3; x++) for (let z = 0; z <= 2; z++) for (let y = 3; y <= 4; y++) add(x, y, z, x === 1 && z === 1 && y === 3 ? C.door : C.wall);
    for (let x = 0; x <= 4; x++) for (let z = -1; z <= 3; z++) add(x, 5, z, C.roof);
    for (let x = 1; x <= 3; x++) for (let z = 0; z <= 2; z++) add(x, 6, z, C.roof);
    add(2, 7, 1, C.roof);
    const cloudVoxels = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [1, 1, 0], [2, 1, 0], [1, 0, 1], [2, 0, 1], [0, 0, 1]];
    cloudVoxels.forEach(([x, y, z]) => add(x, 8 + y, z - 4, C.cloud, 'cloud'));
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]].forEach(([x, y]) => add(-6 + x, 7.5 + y, 1, C.flower2, 'sun'));
    const island = new THREE.Group(); sub.add(island);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 1 }), voxels.length);
    mesh.castShadow = mesh.receiveShadow = true;
    island.add(mesh);
    const colors = palette.map(c => new THREE.Color(c));
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
    voxels.forEach((v, i) => mesh.setColorAt(i, colors[v.color]));
    mesh.instanceColor.needsUpdate = true;
    const target = makeTarget(256, 144, true);
    const quad = fullscreenQuad(`
      uniform sampler2D uScene; uniform vec2 uRes; uniform vec3 uPalette[18];
      varying vec2 vUv;
      float bayer(vec2 p) {
        int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
        float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
        return m[i] / 16.0 - 0.5;
      }
      void main() {
        vec3 c = texture2D(uScene, vUv).rgb + bayer(floor(vUv * uRes)) * 0.09;
        float best = 1e9; vec3 pick = c;
        for (int i = 0; i < 18; i++) { float d = distance(c, uPalette[i]); if (d < best) { best = d; pick = uPalette[i]; } }
        gl_FragColor = vec4(pick, 1.0);
        #include <colorspace_fragment>
      }`, { uScene: { value: target.texture }, uRes: { value: new THREE.Vector2(256, 144) }, uPalette: { value: colors } });
    return {
      scene: sub, camera,
      resize(w, h) { const pw = Math.round(144 * w / h); target.setSize(pw, 144); quad.material.uniforms.uRes.value.set(pw, 144); fitOrthographic(camera, 20, w, h); },
      update(t) {
        island.position.y = Math.sin(t * 0.7) * 0.35 - 1.5;
        island.rotation.y = t * 0.18 + pointer.x * 0.4;
        const cloudX = ((t * 0.9) % 22) - 11, step = Math.floor(t * 6);
        voxels.forEach((v, i) => {
          let y = v.y, sy = 1;
          if (v.tag === 'cloud' || v.tag === 'sun') { position.set(v.tag === 'cloud' ? v.x + cloudX : v.x, y - island.position.y, v.z).applyAxisAngle(UP, -island.rotation.y); }
          else {
            if (v.tag === 'water') sy = ((step + v.x * 2 + v.z) % 4) === 0 ? 0.8 : 1;
            if (v.tag === 'flower') y += ((step + v.x + v.z * 3) % 6) === 0 ? 0.25 : 0;
            position.set(v.x, y - (1 - sy) / 2, v.z);
          }
          scale.set(1, sy, 1);
          mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
        });
        mesh.instanceMatrix.needsUpdate = true;
      },
      render() { postProcess(renderer, sub, camera, target, quad); },
      dispose() { target.dispose(); }
    };
  }
});

// ================================================================ 18 Blueprint
STYLES.push({
  slug: 'blueprint',
  build({ pointer }) {
    const scene = makeScene('#1b4fae');
    const camera = perspective(30, [7, 5.5, 9], [0, 1.6, 0]);
    const line = (hex = '#eaf2ff', opacity = 0.95) => new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({
      transparent: true,
      map: canvasTexture(256, 256, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = 'rgba(190,215,255,0.22)'; g.lineWidth = 1;
        for (let i = 0; i <= 4; i++) { const p = i * 64 + 0.5; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
        g.strokeStyle = 'rgba(210,228,255,0.55)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
      }, { repeat: true })
    }));
    grid.material.map.repeat.set(13, 13);
    grid.rotation.x = -Math.PI / 2; grid.position.y = -0.2;
    scene.add(grid);
    const assembly = new THREE.Group(); scene.add(assembly);
    const edges = (geometry, threshold = 20, hex, opacity) => new THREE.LineSegments(new THREE.EdgesGeometry(geometry, threshold), line(hex, opacity));
    const gearShape = (teeth, outer, inner, hole) => {
      const shape = new THREE.Shape(), step = TAU / teeth;
      for (let i = 0; i < teeth; i++) {
        [[inner, 0], [outer, 0.18], [outer, 0.42], [inner, 0.6]].forEach(([radius, k], j) => {
          const a = (i + k) * step, x = Math.cos(a) * radius, y = Math.sin(a) * radius;
          i === 0 && j === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
        });
      }
      shape.closePath();
      const path = new THREE.Path(); path.absarc(0, 0, hole, 0, TAU, true); shape.holes.push(path);
      return shape;
    };
    const part = (object, rest, lift) => { object.userData = { rest, lift }; object.position.y = rest; assembly.add(object); return object; };
    const base = new THREE.Group();
    base.add(edges(new THREE.BoxGeometry(4.2, 0.3, 4.2)));
    [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]].forEach(([x, z]) => { const hole = edges(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 16), 30, '#8fd3ff'); hole.position.set(x, 0, z); base.add(hole); });
    part(base, 0.15, 0);
    const bearing = edges(new THREE.TorusGeometry(1.25, 0.24, 8, 40), 25); bearing.rotation.x = Math.PI / 2;
    part(bearing, 0.6, 0.9);
    const gear = edges(new THREE.ExtrudeGeometry(gearShape(14, 1.7, 1.38, 0.42), { depth: 0.42, bevelEnabled: false, curveSegments: 16 }), 25);
    gear.rotation.x = -Math.PI / 2;
    const gearGroup = new THREE.Group(); gearGroup.add(gear);
    part(gearGroup, 1.0, 1.8);
    const shaft = edges(new THREE.CylinderGeometry(0.36, 0.36, 3.4, 20), 30);
    part(shaft, 2.0, 2.7);
    const cap = new THREE.Group();
    cap.add(edges(new THREE.CylinderGeometry(0.95, 0.95, 0.36, 28), 30));
    const knurl = edges(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 10), 30, '#8fd3ff'); knurl.position.y = 0.28; cap.add(knurl);
    part(cap, 3.1, 3.7);
    const parts = assembly.children;
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, 11, 0)]), new THREE.LineDashedMaterial({ color: '#9cc9ff', dashSize: 0.28, gapSize: 0.14, transparent: true, opacity: 0.8 }));
    axis.computeLineDistances(); scene.add(axis);
    const label = (text, w = 1.6) => new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTexture(256, 64, (g, W, H) => { g.clearRect(0, 0, W, H); g.font = '500 40px "SFMono-Regular",Menlo,monospace'; g.fillStyle = '#eaf2ff'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, W / 2, H / 2 + 2); }),
      transparent: true, depthTest: false
    }));
    const dimension = (x, z) => {
      const group = new THREE.Group();
      const positions = new Float32Array(3 * 2 * 7);
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
      group.add(new THREE.LineSegments(geometry, line('#8fd3ff', 0.9)));
      const tag = label('0.00'); tag.scale.set(1.1, 0.275, 1); group.add(tag);
      group.position.set(x, 0, z); scene.add(group);
      return {
        set(y0, y1) {
          const a = 0.18, p = positions;
          p.set([0, y0, 0, 0, y1, 0, -0.5, y0, 0, 0.2, y0, 0, -0.5, y1, 0, 0.2, y1, 0, 0, y0, 0, -a * 0.5, y0 + a, 0, 0, y0, 0, a * 0.5, y0 + a, 0, 0, y1, 0, -a * 0.5, y1 - a, 0, 0, y1, 0, a * 0.5, y1 - a, 0]);
          geometry.attributes.position.needsUpdate = true;
          tag.position.set(0.95, (y0 + y1) / 2, 0);
          const canvas = tag.material.map.image; const g = canvas.getContext('2d');
          g.clearRect(0, 0, canvas.width, canvas.height); g.font = '500 40px "SFMono-Regular",Menlo,monospace'; g.fillStyle = '#eaf2ff'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText((y1 - y0).toFixed(2), canvas.width / 2, canvas.height / 2 + 2);
          tag.material.map.needsUpdate = true;
        }
      };
    };
    const callouts = [['BASE PLATE', 2.1], ['BEARING', 1.5], ['GEAR', 1.7], ['SHAFT', 0.36], ['CAP', 0.95]].map(([name, radius]) => {
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const leader = new THREE.Line(geometry, line('#8fd3ff', 0.85)); scene.add(leader);
      const tag = label(name); tag.scale.set(1.5, 0.375, 1); scene.add(tag);
      return { leader, tag, radius };
    });
    const viewDirection = new THREE.Vector3(), viewRight = new THREE.Vector3(), anchor = new THREE.Vector3(), tip = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    const height = dimension(-2.7, 2.6);
    const width = label('4.20'); width.scale.set(1.1, 0.275, 1); width.position.set(0, -0.05, 2.9); scene.add(width);
    const widthLine = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.1, 0, 2.6), new THREE.Vector3(2.1, 0, 2.6), new THREE.Vector3(-2.1, 0, 2.2), new THREE.Vector3(-2.1, 0, 2.8), new THREE.Vector3(2.1, 0, 2.2), new THREE.Vector3(2.1, 0, 2.8)]), line('#8fd3ff', 0.9));
    scene.add(widthLine);
    const titleBlock = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.458), new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false,
      map: canvasTexture(720, 220, (g, w, h) => {
        g.clearRect(0, 0, w, h); g.strokeStyle = '#eaf2ff'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
        g.beginPath(); g.moveTo(2, 74); g.lineTo(w - 2, 74); g.moveTo(2, 146); g.lineTo(w - 2, 146); g.moveTo(400, 74); g.lineTo(400, h - 2); g.stroke();
        g.fillStyle = '#eaf2ff'; g.font = '700 34px "Helvetica Neue",Arial,sans-serif'; g.fillText('GEAR ASSEMBLY — EXPLODED VIEW', 18, 48);
        g.font = '500 24px "SFMono-Regular",Menlo,monospace'; g.fillText('DRAWING NO. 018', 18, 118); g.fillText('SCALE 1:4', 418, 118); g.fillText('DESIGN STYLE COLLECTION', 18, 190); g.fillText('SHEET 1 / 1', 418, 190);
      })
    }));
    titleBlock.renderOrder = 5; camera.add(titleBlock); scene.add(camera);
    const CYCLE = 10;
    return {
      scene, camera,
      resize(w, h) {
        setAspect(camera, w, h);
        const dist = 6, half = Math.tan(camera.fov * Math.PI / 360) * dist;
        titleBlock.position.set(-half * camera.aspect + 0.87, -half + 0.35, -dist);
      },
      update(t) {
        const local = t % CYCLE;
        parts.forEach((p, i) => {
          let k;
          if (local < 5.2) k = easeInOutCubic(clamp((local - i * 0.22) / 1.7, 0, 1));
          else k = 1 - easeInOutCubic(clamp((local - 5.6 - (parts.length - 1 - i) * 0.22) / 1.7, 0, 1));
          p.position.y = p.userData.rest + p.userData.lift * k;
        });
        gearGroup.rotation.y = t * 0.5; shaft.rotation.y = t * 0.5; cap.rotation.y = t * 0.5;
        height.set(0, cap.position.y + 0.18);
        camera.getWorldDirection(viewDirection); viewRight.crossVectors(viewDirection, UP).normalize();
        callouts.forEach((callout, i) => {
          const part = parts[i];
          anchor.copy(part.position).addScaledVector(viewRight, callout.radius);
          tip.copy(part.position).addScaledVector(viewRight, 1.9); tip.y += 0.35;
          const positions = callout.leader.geometry.attributes.position;
          positions.set([anchor.x, anchor.y, anchor.z, tip.x, tip.y, tip.z]); positions.needsUpdate = true;
          callout.tag.position.copy(tip).addScaledVector(viewRight, 0.8);
        });
        axis.material.opacity = 0.5 + 0.3 * Math.sin(t * 2);
        const yaw = 0.66 + Math.sin(t * 0.15) * 0.3 + pointer.x * 0.5, pitch = 0.5 - pointer.y * 0.25;
        camera.position.set(Math.sin(yaw) * Math.cos(pitch) * 15, Math.sin(pitch) * 15 + 1.5, Math.cos(yaw) * Math.cos(pitch) * 15);
        camera.lookAt(0, 2.6, 0);
      }
    };
  }
});

// ================================================================ 19 Art deco
STYLES.push({
  slug: 'art-deco',
  build({ renderer, pointer }) {
    const scene = makeScene('#0a0806');
    scene.environment = getEnvironment(renderer);
    const camera = perspective(32, [0, 1.6, 16], [0, 1.0, 0]);
    const gold = new THREE.MeshStandardMaterial({ color: '#d9b245', metalness: 1, roughness: 0.26, envMapIntensity: 1.1 });
    const goldMatte = new THREE.MeshStandardMaterial({ color: '#a37a26', metalness: 0.9, roughness: 0.5, envMapIntensity: 0.7 });
    const lacquer = new THREE.MeshPhysicalMaterial({ color: '#0c0a08', metalness: 0.3, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.2, envMapIntensity: 0.7 });
    const wallLacquer = new THREE.MeshStandardMaterial({ color: '#0b0908', metalness: 0.2, roughness: 0.6, envMapIntensity: 0.4 });
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xfff1cc, 3.2); key.position.set(0, 6, 8); scene.add(key);
    const fill = new THREE.SpotLight(0xffe2a8, 70, 30, 0.5, 0.6, 1.6); fill.position.set(0, 7, 9); fill.target.position.set(0, 0.5, 0); scene.add(fill, fill.target);
    const warm = new THREE.PointLight(0xffb35c, 60, 0, 2); warm.position.set(0, 3, 4); scene.add(warm);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), wallLacquer); back.position.set(0, 4, -4.5); scene.add(back);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), lacquer); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6; scene.add(floor);
    const rays = (count, length, width, z, material) => {
      const group = new THREE.Group();
      for (let i = 0; i < count; i++) {
        const ray = new THREE.Mesh(new THREE.BoxGeometry(width, length, 0.05), material);
        ray.position.y = length / 2; ray.rotation.z = -Math.PI / 2 + (i + 0.5) / count * Math.PI;
        const pivot = new THREE.Group(); pivot.rotation.z = ray.rotation.z; ray.rotation.z = 0; pivot.add(ray); group.add(pivot);
      }
      group.position.set(0, -1.55, z); scene.add(group); return group;
    };
    const raysA = rays(26, 11, 0.16, -4.2, goldMatte), raysB = rays(14, 8.5, 0.3, -4.1, goldMatte);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.36, 2.4), gold); plinth.position.set(0, -1.42, 0.2); scene.add(plinth);
    const arcs = [3.3, 4.0, 4.7, 5.4].map(radius => { const arc = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 10, 96, Math.PI), gold); arc.position.set(0, -1.55, -3.2); scene.add(arc); return arc; });
    const steps = [6.2, 5.0, 3.8, 2.6, 1.4].map((w, i) => { const step = new THREE.Mesh(new THREE.BoxGeometry(w, 0.56, 1.6 - i * 0.16), i === 2 ? lacquer : gold); step.position.set(0, -1.24 + 0.28 + i * 0.56, 0.2); scene.add(step); return step; });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), gold); gem.scale.y = 1.7; gem.position.set(0, 2.8, 0.2); scene.add(gem);
    const chevronShape = new THREE.Shape();
    [[-0.9, 0], [0, 0.55], [0.9, 0], [0.9, 0.3], [0, 0.85], [-0.9, 0.3]].forEach(([x, y], i) => i ? chevronShape.lineTo(x, y) : chevronShape.moveTo(x, y));
    chevronShape.closePath();
    const chevronGeometry = new THREE.ExtrudeGeometry(chevronShape, { depth: 0.2, bevelEnabled: false });
    const chevrons = [];
    [-4.4, 4.4].forEach(x => { for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(chevronGeometry, i % 2 ? goldMatte : gold); c.position.set(x, -1.2 + i * 1.0, -0.5); scene.add(c); chevrons.push({ mesh: c, base: c.position.y, phase: i * 0.6 + (x > 0 ? 0.3 : 0) }); } });
    const fans = [-5.4, 5.4].map(x => {
      const fan = new THREE.Group();
      for (let i = 0; i < 7; i++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 0.06), gold); blade.position.y = 1.05; const pivot = new THREE.Group(); pivot.add(blade); pivot.rotation.z = Math.sign(x) * (i / 6) * Math.PI / 2; fan.add(pivot); }
      fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 24), gold).rotateX(Math.PI / 2));
      fan.position.set(x, -1.4, 0.6); scene.add(fan); return fan;
    });
    const groundLine = new THREE.Mesh(new THREE.BoxGeometry(17, 0.05, 0.05), gold); groundLine.position.set(0, -1.57, 1.3); scene.add(groundLine);
    const columns = [-6.3, 6.3].map(x => { const column = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 7, 14, 1), new THREE.MeshStandardMaterial({ color: '#d9b245', metalness: 1, roughness: 0.3, flatShading: true, envMapIntensity: 1.1 })); column.position.set(x, 1.9, -1.5); scene.add(column); return column; });
    columns.forEach(column => { const capital = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), gold); capital.position.y = 3.6; column.add(capital); });
    return {
      scene, camera, toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.15,
      update(t) {
        raysA.rotation.z = Math.sin(t * 0.12) * 0.12; raysB.rotation.z = -Math.sin(t * 0.1) * 0.1;
        steps.forEach((step, i) => { const k = easeOutCubic(clamp((t - 0.3 - i * 0.35) / 1.0, 0, 1)); step.scale.set(k, 1, 1); step.visible = k > 0.001; });
        gem.rotation.y = t * 0.7; gem.position.y = 2.85 + Math.sin(t * 1.1) * 0.12; gem.visible = t > 2.2;
        chevrons.forEach(({ mesh, base, phase }) => { mesh.position.y = base + Math.sin(t * 0.9 + phase) * 0.12; });
        fans.forEach((fan, i) => { fan.children.forEach((pivot, j) => { if (j < 7) pivot.rotation.z = Math.sign(fan.position.x) * (j / 6) * Math.PI / 2 * (0.9 + 0.1 * Math.sin(t * 0.8 + i)); }); });
        arcs.forEach((arc, i) => { arc.scale.setScalar(1 + 0.012 * Math.sin(t * 1.4 + i * 0.7)); });
        key.position.x = Math.sin(t * 0.35) * 9; warm.position.x = -Math.sin(t * 0.35) * 5;
        camera.position.x = pointer.x * 1.6; camera.position.y = 1.6 + pointer.y * 0.9; camera.lookAt(0, 1.0, 0);
      }
    };
  }
});

// ================================================================ 20 Neo-brutalism
STYLES.push({
  slug: 'neo-brutalism',
  build({ pointer }) {
    const scene = makeScene('#ffd23f');
    const camera = perspective(28, [0, 0, 15]);
    const dots = canvasTexture(64, 64, (g, w, h) => { g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.fillStyle = '#e0a800'; g.beginPath(); g.arc(w / 2, h / 2, 3.2, 0, TAU); g.fill(); }, { repeat: true });
    dots.repeat.set(30, 18);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), new THREE.MeshBasicMaterial({ map: dots })); backdrop.position.z = -1.5; scene.add(backdrop);
    const ui = new THREE.Group(); scene.add(ui);
    const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const heavy = '900 {size}px "Arial Black",Impact,"Helvetica Neue",Arial,sans-serif';
    const labelTexture = (w, h, lines, options = {}) => canvasTexture(Math.round(w * 160), Math.round(h * 160), (g, W, H) => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = options.color || '#111'; g.textBaseline = 'middle'; g.textAlign = options.align || 'left';
      lines.forEach(([text, size, y, color]) => { g.font = heavy.replace('{size}', size); g.fillStyle = color || options.color || '#111'; g.fillText(text, options.align === 'center' ? W / 2 : W * 0.08, H * y); });
    });
    const block = (w, h, color, x, y, z, lines, options = {}) => {
      const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.z = options.rotation || 0;
      const shadow = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.1), black); shadow.position.set(0.3, -0.3, -0.35);
      const body = new THREE.Group();
      body.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.42), black));
      body.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), new THREE.MeshBasicMaterial({ color })));
      if (lines) { const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: labelTexture(w, h, lines, options), transparent: true })); face.position.z = 0.26; body.add(face); }
      group.add(shadow, body); ui.add(group);
      return { group, body };
    };
    const panel = block(5.6, 2.7, 0xffffff, -1.3, 1.75, 0, [['SHIP IT.', 150, 0.42], ['NO GRADIENTS · NO BLUR · JUST BORDERS', 26, 0.8]]);
    const button = block(2.9, 0.95, 0xff4fa3, -2.2, -0.05, 0.6, [['CLICK ME', 60, 0.52]], { align: 'center' });
    const stat = block(3.2, 2.1, 0x4fe0e6, -1.4, -2.3, 0.3, [['98%', 130, 0.4], ['FASTER', 56, 0.78]]);
    const star = block(1.7, 1.7, 0xff8a2b, 2.8, -2.0, 0.5, [['★', 160, 0.56]], { align: 'center' });
    const badge = block(1.6, 0.95, 0xff4fa3, 3.3, 2.2, 0.8, [['NEW!', 60, 0.54]], { align: 'center', rotation: 0.18 });
    const arrow = block(1.1, 1.1, 0x4fe0e6, 2.5, 0.35, 0.4, [['→', 120, 0.56]], { align: 'center' });
    const marqueeTexture = canvasTexture(2048, 128, (g, w, h) => {
      g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd23f'; g.font = heavy.replace('{size}', '64'); g.textBaseline = 'middle';
      const unit = 'NEO-BRUTALISM  ✦  RAW  ✦  LOUD  ✦  ', unitWidth = g.measureText(unit).width, n = Math.max(1, Math.round(w / unitWidth));
      g.save(); g.scale(w / (n * unitWidth), 1); for (let i = 0; i < n; i++) g.fillText(unit, i * unitWidth, h / 2 + 4); g.restore();
    }, { repeat: true });
    marqueeTexture.repeat.set(1.8, 1);
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.66, 0.4), [black, black, black, black, new THREE.MeshBasicMaterial({ map: marqueeTexture }), black]);
    marquee.position.set(0.2, -3.95, 0.2); ui.add(marquee);
    const cursor = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTexture(128, 128, g => {
        g.beginPath(); g.moveTo(22, 12); g.lineTo(22, 104); g.lineTo(44, 84); g.lineTo(60, 116); g.lineTo(76, 108); g.lineTo(60, 76); g.lineTo(90, 76); g.closePath();
        g.lineWidth = 10; g.lineJoin = 'round'; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#111'; g.fill();
      }), transparent: true, depthTest: false
    }));
    cursor.scale.set(0.9, 0.9, 1); cursor.renderOrder = 20; ui.add(cursor);
    const fit = (w, h) => { setAspect(camera, w, h); camera.position.z = Math.max(15, 4.9 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect)); };
    const pressAt = (t, period, down = 0.08, hold = 0.22, up = 0.4) => {
      const local = t % period;
      if (local < down) return local / down;
      if (local < down + hold) return 1;
      if (local < down + hold + up) return 1 - easeOutBack((local - down - hold) / up);
      return 0;
    };
    return {
      scene, camera,
      resize: fit,
      update(t) {
        marqueeTexture.offset.x = (t * 0.09) % 1;
        const press = pressAt(t + 0.6, 2.4);
        button.body.position.set(0.3 * press, -0.3 * press, -0.3 * press);
        const cl = (t + 0.6) % 2.4;
        const reach = cl < 0.3 ? 1 : cl < 1.0 ? 1 - easeInOutCubic((cl - 0.3) / 0.7) : cl < 1.9 ? 0 : easeInOutCubic((cl - 1.9) / 0.5);
        const idle = cl >= 1.0 && cl < 1.9 ? Math.sin(t * 5) * 0.03 : 0;
        cursor.position.set(lerp(0.9, -1.9, reach) + idle + 0.3 * press, lerp(-1.25, -0.42, reach) - 0.3 * press, 1.3);
        const lift = pressAt(t, 3.6, 0.1, 0.9, 0.5);
        stat.body.position.set(-0.18 * lift, 0.18 * lift, 0.15 * lift);
        const starStep = Math.floor(t / 0.7), starLocal = (t % 0.7) / 0.7;
        star.body.rotation.z = -(starStep + easeOutCubic(clamp(starLocal / 0.18, 0, 1))) * Math.PI / 4;
        const wig = (t % 2.8) < 0.5 ? Math.sin((t % 2.8) * 38) * 0.12 * (1 - (t % 2.8) / 0.5) : 0;
        badge.group.rotation.z = 0.18 + wig;
        const hopStep = Math.floor(t / 0.5), hop = pressAt(t, 1.0, 0.1, 0.1, 0.3);
        arrow.body.position.x = hopStep % 2 ? 0.22 * hop : 0; arrow.body.position.y = 0.1 * hop;
        panel.body.position.y = Math.round(Math.sin(t * 0.8) * 2) * 0.03;
        ui.rotation.y += (pointer.x * 0.22 - ui.rotation.y) * 0.12;
        ui.rotation.x += (-pointer.y * 0.14 - ui.rotation.x) * 0.12;
      }
    };
  }
});
