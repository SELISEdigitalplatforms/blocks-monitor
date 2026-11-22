/** Story scene shaders, one source per piece for both themes. Every fragment works out a hue and a strength, and OUT
 *  writes them for the theme:
 *  - dark theme: as light, added onto the dark canvas (additive, hue x strength);
 *  - light theme (LIGHT defined): the same neon photographed in daylight: normal blending, the hue (the light palette:
 *    saturated blue cores, the #2E68FF glow) with the strength as its coverage. Dark's light reaches the screen through
 *    the sRGB encode, which lifts its soft falloffs, so the coverage follows the same curve (pow 1/2.2) and every glow
 *    keeps dark's radius and falloff; uLA scales a glow sleeve's coverage (1 for cores). Artwork from a texture (the
 *    cards, the app screens) is composited as drawn (OUT_TEX).
 *  Fog fades everything into the page canvas colour. */

export const FOG_NEAR = 18;
export const FOG_FAR = 50;

/** light theme: a glow's coverage gain */
const LIGHT_UNIFORMS = /* glsl */ `
  #ifdef LIGHT
    uniform float uLA;
  #endif
`;

/** hue and strength out: light added onto the dark canvas, or (light theme) coloured coverage on the light canvas */
const OUT = /* glsl */ `
  #ifdef LIGHT
    gl_FragColor = vec4(hue, min(1.0, uLA * pow(max(strength, 0.0), 0.4545)));
  #else
    gl_FragColor = vec4(hue * strength, 1.0);
  #endif
  #include <colorspace_fragment>
`;

/** the same for artwork from a texture (light theme: composited as drawn, its alpha as the coverage) */
const OUT_TEX = /* glsl */ `
  #ifdef LIGHT
    gl_FragColor = vec4(hue, clamp(strength, 0.0, 1.0));
  #else
    gl_FragColor = vec4(hue * strength, 1.0);
  #endif
  #include <colorspace_fragment>
`;

/** meshes: uv, fog, and how square-on the surface faces the camera (soft silhouettes for glow sleeves) */
export const SOFT_VERT = /* glsl */ `
  uniform float uFogNear; uniform float uFogFar;
  varying vec2 vUv; varying float vFog; varying float vEdge;
  void main() {
    vUv = uv;
    vec4 p = vec4(position, 1.0);
    vec3 nn = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      nn = mat3(instanceMatrix) * nn;
    #endif
    vec4 mv = modelViewMatrix * p;
    vEdge = abs(dot(normalize(normalMatrix * nn), normalize(-mv.xyz)));
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

/** a ring: neon core or glow sleeve */
export const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uIntensity; uniform float uSoft;
  varying vec2 vUv; varying float vFog; varying float vEdge;
  ${LIGHT_UNIFORMS}
  void main() {
    float edge = mix(1.0, pow(vEdge, 1.8), uSoft);
    vec3 hue = uColor;
    float strength = uIntensity * edge * (1.0 - vFog);
    ${OUT}
  }`;

/** the main beam: wobbly and grainy where the raw material enters, cleaner and brighter after every gate */
export const BEAM_VERT = /* glsl */ `
  uniform float uFogNear; uniform float uFogFar; uniform float uTime; uniform float uWob;
  uniform float uGates[8]; uniform vec3 uN1; uniform vec3 uN2;
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vQ;
  float quality(float u) {
    float q = 0.0;
    for (int i = 0; i < 8; i++) q += smoothstep(uGates[i] - 0.01, uGates[i] + 0.01, u);
    return q / 8.0;
  }
  void main() {
    vUv = uv;
    float u = uv.x;
    float q = quality(u);
    vQ = q;
    float a = uWob * pow(1.0 - q, 1.7) * smoothstep(0.0, 0.05, u);
    vec3 p = position + (uN1 * sin(u * 97.0 - uTime * 6.3) + uN2 * cos(u * 71.0 - uTime * 4.7)) * a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vEdge = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

export const BEAM_FRAG = /* glsl */ `
  uniform vec3 uBeam; uniform vec3 uHot; uniform vec3 uHeadColor;
  uniform float uHead; uniform float uLit; uniform float uDone; uniform float uTail; uniform float uBase;
  uniform float uGain; uniform float uSoft; uniform float uTime;
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vQ;
  ${LIGHT_UNIFORMS}
  void main() {
    float u = vUv.x;
    float d = uHead - u;
    float head = uHead < -0.5 ? 0.0 : (d >= 0.0 ? exp(-d / uTail) : exp(d / 0.005));
    float lit = (1.0 - smoothstep(uLit - 0.003, uLit + 0.003, u)) * uDone;
    float grain = 1.0 - 0.45 * (1.0 - vQ) * (0.5 + 0.5 * sin(u * 470.0 - uTime * 26.0));
    float edge = mix(1.0, pow(vEdge, 2.2), uSoft);
    float body = uBase + lit * (0.16 + 0.84 * vQ * vQ) * grain;
    vec3 hue = mix(uBeam, uHot, clamp(lit * vQ * 0.6, 0.0, 1.0));
    hue = mix(hue, uHeadColor, clamp(head, 0.0, 1.0));
    float strength = (body + head * 1.7) * edge * uGain * (1.0 - vFog);
    ${OUT}
  }`;

/** the automatic send-back: a packet runs the loop from SecOps back to the Developer */
export const ARC_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uHead; uniform float uTrail; uniform float uGain; uniform float uSoft;
  varying vec2 vUv; varying float vFog; varying float vEdge;
  ${LIGHT_UNIFORMS}
  void main() {
    float s = vUv.x;
    float d = uHead - s;
    float pkt = d >= 0.0 ? exp(-d / 0.09) : exp(d / 0.012);
    float trail = (1.0 - smoothstep(uHead - 0.01, uHead + 0.01, s)) * uTrail;
    float edge = mix(1.0, pow(vEdge, 2.0), uSoft);
    vec3 hue = uColor;
    float strength = (0.05 + trail * 0.4 + pkt * 1.5) * edge * uGain * (1.0 - vFog);
    ${OUT}
  }`;

/** flat quads: uv only */
export const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** a glass card that the factory reads: it burns away left to right into light */
export const CARD_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uOpacity; uniform float uCut; uniform vec3 uHot;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float n = hash(floor(vUv * vec2(46.0, 36.0)));
    float v = vUv.x + (n - 0.5) * 0.1;
    float keep = smoothstep(uCut, uCut + 0.025, v);
    float rim = (uCut > -0.05 && uCut < 1.06) ? exp(-abs(v - uCut) * 34.0) * smoothstep(uCut - 0.004, uCut + 0.01, v) : 0.0;
    vec3 hue = mix(t.rgb, uHot, clamp(rim, 0.0, 1.0));
    float strength = (t.a * keep + rim * 0.95) * uOpacity;
    ${OUT_TEX}
  }`;

/** a printed app screen: revealed bottom to top behind a bright scan line, faint hologram lines */
export const SCREEN_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uReveal; uniform float uOpacity; uniform vec3 uHot; uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float y = vUv.y;
    float vis = 1.0 - smoothstep(uReveal - 0.012, uReveal + 0.004, y);
    float scan = (uReveal > 0.0 && uReveal < 1.0) ? exp(-abs(y - uReveal) * 60.0) : 0.0;
    vec3 hue = mix(t.rgb, uHot, clamp(scan, 0.0, 1.0));
    float lines = 0.9 + 0.1 * sin(y * 520.0 - uTime * 4.0);
    float strength = (t.a * vis * lines + scan * 0.6) * uOpacity;
    ${OUT_TEX}
  }`;

/** a neon outline that draws itself (uv.x along the outline, uv.y across it) */
export const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uDraw; uniform float uOpacity;
  varying vec2 vUv;
  ${LIGHT_UNIFORMS}
  void main() {
    float x = vUv.x;
    float shown = 1.0 - smoothstep(uDraw - 0.002, uDraw + 0.002, x);
    float tip = exp(-max(uDraw - x, 0.0) / 0.03) * shown * (1.0 - step(0.999, uDraw));
    float a = abs(vUv.y - 0.5) * 2.0;
    float core = exp(-a * a * 36.0);
    float soft = exp(-a * a * 3.5);
    vec3 hue = mix(uColor, uHot, clamp(core * 0.7 + tip, 0.0, 1.0));
    float strength = (core * 0.95 + soft * 0.26) * shown * (1.0 + tip * 2.2) * uOpacity;
    ${OUT}
  }`;

/** a shaft of light that grows along uv.y (the print riser and the uplink to the cloud) */
export const SHAFT_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot; uniform float uGrow; uniform float uIntensity;
  varying vec2 vUv;
  ${LIGHT_UNIFORMS}
  void main() {
    float x = abs(vUv.x - 0.5) * 2.0;
    float shown = 1.0 - smoothstep(uGrow - 0.03, uGrow, vUv.y);
    float tip = exp(-abs(vUv.y - uGrow) * 14.0) * (1.0 - step(0.999, uGrow)) * step(0.001, uGrow);
    float core = exp(-x * x * 140.0);
    float soft = exp(-x * x * 8.0);
    vec3 hue = mix(uColor, uHot, core);
    float strength = ((core + soft * 0.3) * shown + tip * (soft * 0.8 + core)) * uIntensity;
    ${OUT}
  }`;

/** the material dissolving into streams of light that braid into one bright point */
export const STREAM_VERT = /* glsl */ `
  attribute vec3 aStart; attribute vec4 aSeed;
  uniform float uT; uniform float uTime; uniform vec3 uC; uniform vec3 uP; uniform float uPixel; uniform float uSize;
  varying float vA; varying float vHot;
  void main() {
    float p = clamp((uT - aSeed.x) / aSeed.y, 0.0, 1.0);
    float lift = smoothstep(0.0, 0.32, p);
    float e = smoothstep(0.06, 1.0, p);
    vec3 axis = uP - uC;
    vec3 dir = normalize(axis);
    vec3 n1 = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 n2 = cross(n1, dir);
    float ang = aSeed.z * 2.0944 + e * 10.0 + uTime * 1.1;
    float r = (0.36 + aSeed.w * 0.22) * pow(1.0 - e, 1.25);
    vec3 braid = uC + axis * e + (cos(ang) * n1 + sin(ang) * n2) * r;
    vec3 pos = mix(aStart, braid, lift);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uSize * uPixel * (0.55 + aSeed.w * 0.9) * (1.0 - 0.45 * e) / max(-mv.z, 0.5);
    float alive = step(0.0001, p) * (1.0 - smoothstep(0.9, 1.0, p));
    vA = alive * (0.5 + 0.5 * e);
    vHot = e;
    gl_Position = projectionMatrix * mv;
  }`;

/** soft sparks of light */
export const STREAM_FRAG = /* glsl */ `
  uniform vec3 uBeam; uniform vec3 uHot; uniform float uOpacity;
  varying float vA; varying float vHot;
  ${LIGHT_UNIFORMS}
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float disc = exp(-d * d * 5.0) * (1.0 - smoothstep(0.85, 1.0, d));
    vec3 hue = mix(uBeam, uHot, vHot * 0.8 + 0.2);
    float strength = disc * vA * uOpacity;
    ${OUT}
  }`;

/** the floor: the canvas colour with a fine studio grid that fades out near and far, and a pool of light under the
 *  live app (light: the same grid and fade as blue lines over the canvas, the pool a faint blue tint) */
export const FLOOR_VERT = /* glsl */ `
  varying vec3 vWorld; varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

export const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uBg; uniform vec3 uGrid; uniform float uAmt; uniform vec3 uPool; uniform float uPoolAmt; uniform vec2 uPoolAt;
  varying vec3 vWorld; varying float vDepth;
  float grid(vec2 p, float s, float w) {
    vec2 q = p / s;
    vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * w);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    float fade = smoothstep(7.0, 12.0, vDepth) * (1.0 - smoothstep(16.0, 44.0, vDepth));
    float g = grid(vWorld.xz, 1.0, 1.0) * 0.6 + grid(vWorld.xz, 5.0, 1.3) * 0.4;
    float pool = exp(-pow(length(vWorld.xz - uPoolAt) / 3.2, 2.0));
    #ifdef LIGHT
      float ga = clamp(g * uAmt * fade, 0.0, 1.0);
      float pa = pool * uPoolAmt;
      float a = ga + (1.0 - ga) * pa;
      vec3 col = mix(uPool, uGrid, ga / max(a, 1e-4));
      gl_FragColor = vec4(col, a);
    #else
      vec3 col = mix(uBg, uGrid, g * uAmt * fade);
      col = mix(col, uPool, pool * uPoolAmt);
      gl_FragColor = vec4(col, 1.0);
    #endif
    #include <colorspace_fragment>
  }`;

/** the other lines (scale act): instanced rails and gates, each line with its own pulse phase */
export const PAR_VERT = /* glsl */ `
  attribute float aPhase; attribute float aK; attribute float aGate;
  uniform float uFogNear; uniform float uFogFar;
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vPhase; varying float vK; varying float vGate;
  void main() {
    vUv = uv; vPhase = aPhase; vK = aK; vGate = aGate;
    vec4 p = instanceMatrix * vec4(position, 1.0);
    vec4 mv = modelViewMatrix * p;
    vEdge = abs(dot(normalize(normalMatrix * (mat3(instanceMatrix) * normal)), normalize(-mv.xyz)));
    vFog = smoothstep(uFogNear * 0.8, uFogFar, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const PAR_COMMON = /* glsl */ `
  uniform vec3 uBeam; uniform vec3 uHot; uniform float uTime; uniform float uVis; uniform float uGain; uniform float uSoft;
  varying vec2 vUv; varying float vFog; varying float vEdge; varying float vPhase; varying float vK; varying float vGate;
  ${LIGHT_UNIFORMS}
  float headAt() { return fract(uTime * 0.17 + vPhase) * 1.35 - 0.12; }
  float visK() { return clamp(uVis * 1.7 - vK * 0.7, 0.0, 1.0); }
`;

export const PAR_RAIL_FRAG = /* glsl */ `
  ${PAR_COMMON}
  void main() {
    float u = vUv.x;
    float h = headAt();
    float d = h - u;
    float head = d >= 0.0 ? exp(-d / 0.1) : exp(d / 0.006);
    float lit = (1.0 - step(h, u)) * 0.22;
    float edge = mix(1.0, pow(vEdge, 2.0), uSoft);
    vec3 hue = mix(uBeam, uHot, clamp(head, 0.0, 1.0));
    float strength = (0.1 + lit + head * 1.5) * edge * uGain * visK() * (1.0 - vFog);
    ${OUT}
  }`;

export const PAR_GATE_FRAG = /* glsl */ `
  ${PAR_COMMON}
  void main() {
    float d = headAt() - vGate;
    float flash = d >= 0.0 ? exp(-d / 0.06) : exp(d / 0.02) * 0.4;
    float edge = mix(1.0, pow(vEdge, 1.8), uSoft);
    vec3 hue = mix(uBeam, uHot, clamp(flash, 0.0, 1.0));
    float strength = (0.16 + flash * 1.1) * edge * uGain * visK() * (1.0 - vFog);
    ${OUT}
  }`;

/** points for the other lines: their pulses and the small app glow at each end */
export const PAR_POINT_VERT = /* glsl */ `
  attribute vec3 aOff; attribute float aPhase; attribute float aK;
  uniform vec3 uP0; uniform vec3 uE0; uniform float uTime; uniform float uVis; uniform float uPixel; uniform float uSize;
  uniform float uMode; uniform float uFogNear; uniform float uFogFar;
  varying float vA;
  void main() {
    float h = fract(uTime * 0.17 + aPhase) * 1.35 - 0.12;
    vec3 p;
    float a;
    if (uMode < 0.5) {
      p = mix(uP0, uE0, clamp(h, 0.0, 1.0)) + aOff;
      a = step(0.0, h) * step(h, 1.0);
    } else {
      p = uE0 + aOff + vec3(0.0, 0.72, 0.0);
      float since = h - 1.0;
      a = 0.42 + (since >= 0.0 ? exp(-since / 0.08) * 1.2 : 0.0);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uPixel / max(-mv.z, 0.5);
    float vis = clamp(uVis * 1.7 - aK * 0.7, 0.0, 1.0);
    vA = a * vis * (1.0 - smoothstep(uFogNear * 0.8, uFogFar, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;

export const PAR_POINT_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity;
  varying float vA;
  ${LIGHT_UNIFORMS}
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float disc = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
    vec3 hue = uColor;
    float strength = disc * vA * uOpacity;
    ${OUT}
  }`;

/** drifting specks of light (dark theme only) */
export const DUST_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime; uniform float uSize; uniform float uPixel; uniform float uFogNear; uniform float uFogFar;
  varying float vA;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.11 + aSeed * 40.0) * 0.3;
    p.y += sin(uTime * 0.07 + aSeed * 90.0) * 0.25;
    p.z += cos(uTime * 0.05 + aSeed * 60.0) * 0.3;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uPixel * (0.35 + aSeed) / max(-mv.z, 0.5);
    float tw = 0.4 + 0.6 * pow(sin(uTime * (0.4 + aSeed * 0.8) + aSeed * 30.0) * 0.5 + 0.5, 2.0);
    vA = tw * (1.0 - smoothstep(uFogNear, uFogFar, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;

export const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float disc = 1.0 - smoothstep(0.2, 1.0, d);
    vec3 hue = uColor;
    float strength = disc * vA * uOpacity;
    ${OUT}
  }`;
