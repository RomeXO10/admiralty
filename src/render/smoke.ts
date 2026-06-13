/**
 * Powder smoke (P3) — the render-only puffs a broadside throws up.
 *
 * Purely cosmetic: the gunnery sim resolves damage statistically and tells us
 * only *where* a volley's smoke is born (`VolleyResult.smoke{X,Z}`); we spawn a
 * cloud there, let it bloom and drift to leeward with the wind, and fade it out.
 * Nothing here feeds the simulation — in P5 the perception layer will grow its
 * own smoke field that actually blinds ships; this is just spectacle.
 */
import * as THREE from "three";

/** A soft round alpha texture for a single smoke billow, built once. */
function makePuffTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.5, "rgba(225,225,225,0.5)");
  g.addColorStop(1, "rgba(200,200,200,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

interface Puff {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  scale0: number;
  scale1: number;
}

export class SmokeField {
  private readonly group = new THREE.Group();
  private readonly texture = makePuffTexture();
  private readonly puffs: Puff[] = [];
  /** Downwind drift velocity (units/s) the puffs are carried along. */
  private readonly drift = new THREE.Vector2();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Point the drift downwind: `fromDir` is where the wind blows *from*. */
  setWind(fromDir: number, speed: number): void {
    const to = fromDir + Math.PI;
    this.drift.set(Math.cos(to), Math.sin(to)).multiplyScalar(speed * 0.4);
  }

  /** Spawn a billow at a firing point; `size` scales with the weight of metal. */
  spawn(x: number, z: number, size = 1): void {
    // A few overlapping sprites read as a fat, lumpy cloud rather than one disc.
    const billows = 3;
    for (let i = 0; i < billows; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        color: 0xdfe3e6,
      });
      const sprite = new THREE.Sprite(mat);
      const jitter = 1.5;
      sprite.position.set(
        x + (Math.random() - 0.5) * jitter,
        2 + Math.random() * 1.5,
        z + (Math.random() - 0.5) * jitter,
      );
      const scale0 = (2 + Math.random() * 1.5) * size;
      this.group.add(sprite);
      this.puffs.push({
        sprite,
        age: 0,
        life: 3 + Math.random() * 2,
        scale0,
        scale1: scale0 * 3,
      });
    }
  }

  /** Age every puff: drift, bloom, and fade; reap the dead. */
  update(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      p.sprite.position.x += this.drift.x * dt;
      p.sprite.position.z += this.drift.y * dt;
      p.sprite.position.y += dt * 0.4; // smoke rises a little
      const s = p.scale0 + (p.scale1 - p.scale0) * t;
      p.sprite.scale.set(s, s, s);
      p.sprite.material.opacity = 0.7 * (1 - t);
    }
  }
}
