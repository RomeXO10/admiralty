/**
 * The three.js render context: renderer, scene, camera, sky, lighting, and an
 * orbit camera. Reads sim state and draws; never mutates the sim.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { Ocean } from "./ocean";

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly ocean: Ocean;

  private readonly sunDir = new THREE.Vector3();
  private readonly windArrow: THREE.ArrowHelper;
  private readonly followTarget = new THREE.Vector3(0, 0, 0);

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.6;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      5000,
    );
    this.camera.position.set(18, 12, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.5, 0);
    this.controls.maxPolarAngle = Math.PI * 0.495; // don't drop below the horizon
    this.controls.minDistance = 8;
    this.controls.maxDistance = 200;

    // Sky + sun.
    const sky = new Sky();
    sky.scale.setScalar(10000);
    this.scene.add(sky);

    const sunElevation = 18; // degrees above horizon
    const sunAzimuth = 135;
    const phi = THREE.MathUtils.degToRad(90 - sunElevation);
    const theta = THREE.MathUtils.degToRad(sunAzimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    const skyUniforms = sky.material.uniforms;
    skyUniforms.turbidity!.value = 8;
    skyUniforms.rayleigh!.value = 2;
    skyUniforms.mieCoefficient!.value = 0.005;
    skyUniforms.mieDirectionalG!.value = 0.8;
    skyUniforms.sunPosition!.value.copy(this.sunDir);

    // Lighting.
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
    sun.position.copy(this.sunDir).multiplyScalar(100);
    this.scene.add(sun);

    const hemi = new THREE.HemisphereLight(0x9cc4e4, 0x10303a, 0.6);
    this.scene.add(hemi);

    // Approximate sky tint for the water shader's fresnel reflection.
    const skyColor = new THREE.Color(0x86b6d6);
    this.ocean = new Ocean(skyColor, this.sunDir);
    this.scene.add(this.ocean.mesh);

    // Wind indicator: an arrow pointing the way the wind blows (downwind),
    // floating above the flagship so the player can read the breeze at a glance.
    this.windArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 12, 0),
      9,
      0xffd27f,
      3,
      2,
    );
    this.scene.add(this.windArrow);

    window.addEventListener("resize", this.onResize);
  }

  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  /**
   * Keep the camera framed on a moving target by translating both the camera
   * and the orbit pivot by the target's displacement — so the ship stays
   * centred while the user can still orbit and zoom freely.
   */
  follow(x: number, z: number): void {
    const dx = x - this.followTarget.x;
    const dz = z - this.followTarget.z;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
    this.controls.target.x += dx;
    this.controls.target.z += dz;
    this.followTarget.set(x, 0, z);
    this.windArrow.position.set(x, 12, z);
  }

  /** Orient the wind indicator: `fromDir` is where the wind blows *from*. */
  setWind(fromDir: number): void {
    // The arrow shows the direction the wind travels (downwind = fromDir + π).
    const to = fromDir + Math.PI;
    this.windArrow.setDirection(
      new THREE.Vector3(Math.cos(to), 0, Math.sin(to)).normalize(),
    );
  }

  /** Render a frame. `time` drives the (visual-only) water animation. */
  render(time: number): void {
    this.ocean.update(time);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
