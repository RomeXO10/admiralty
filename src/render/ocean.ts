/**
 * Shader-based ocean plane.
 *
 * The vertex shader displaces a subdivided plane using the *same* sum-of-sines
 * field as `sim/waves.ts` (parameters imported, not duplicated), so the water
 * the player sees matches the water the ship floats on. The fragment shader
 * does cheap depth/fresnel-tinted shading with a sky-coloured highlight.
 */
import * as THREE from "three";
import { WAVE_COMPONENTS } from "@sim/waves";

const SIZE = 2000;
const SEGMENTS = 320;

function buildWaveUniformArrays() {
  // Each wave packed as (nx, nz, k, omega) and (amplitude) for the shader.
  const dirK: THREE.Vector4[] = [];
  const amp: number[] = [];
  for (const w of WAVE_COMPONENTS) {
    dirK.push(new THREE.Vector4(w.nx, w.nz, w.k, w.omega));
    amp.push(w.amplitude);
  }
  return { dirK, amp, count: WAVE_COMPONENTS.length };
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform int uWaveCount;
  uniform vec4 uDirK[8];   // (nx, nz, k, omega)
  uniform float uAmp[8];

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    // Work in world space so the field matches sim/waves.ts exactly, regardless
    // of how the plane mesh is oriented. The flat (undisplaced) world position
    // gives us the world X/Z to sample at.
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    float wx = worldPos.x;
    float wz = worldPos.z;

    float h = 0.0;
    float dhdx = 0.0;
    float dhdz = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uWaveCount) break;
      vec4 dk = uDirK[i];
      float phase = (dk.x * wx + dk.y * wz) * dk.z - dk.w * uTime;
      float a = uAmp[i];
      h += sin(phase) * a;
      float d = cos(phase) * a * dk.z;
      dhdx += d * dk.x;
      dhdz += d * dk.y;
    }
    worldPos.y += h;

    vNormal = normalize(vec3(-dhdx, 1.0, -dhdz));
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDir;

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    // Fresnel: more sky reflection at grazing angles.
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
    fresnel = clamp(0.02 + 0.98 * fresnel, 0.0, 1.0);

    // Wave-facing tint between deep and shallow water colours.
    float facing = clamp(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    vec3 water = mix(uDeepColor, uShallowColor, pow(facing, 4.0) * 0.6);

    // Specular sun glint.
    vec3 halfV = normalize(viewDir + normalize(uSunDir));
    float spec = pow(max(dot(normal, halfV), 0.0), 120.0);

    vec3 color = mix(water, uSkyColor, fresnel * 0.65);
    color += spec * vec3(1.0, 0.96, 0.86);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(skyColor: THREE.Color, sunDir: THREE.Vector3) {
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    const { dirK, amp, count } = buildWaveUniformArrays();
    // Pad arrays to the fixed shader length of 8.
    while (dirK.length < 8) dirK.push(new THREE.Vector4());
    while (amp.length < 8) amp.push(0);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaveCount: { value: count },
        uDirK: { value: dirK },
        uAmp: { value: amp },
        uDeepColor: { value: new THREE.Color(0x0a2a3a) },
        uShallowColor: { value: new THREE.Color(0x1f6b7a) },
        uSkyColor: { value: skyColor.clone() },
        uSunDir: { value: sunDir.clone() },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2; // lay the plane flat (XZ)
    this.mesh.receiveShadow = false;
  }

  /** Drive the water animation from the render clock (visual only). */
  update(time: number): void {
    this.material.uniforms.uTime!.value = time;
  }
}
