/**
 * Admiralty — P0 entry point.
 *
 * Wires the deterministic sim (World + Ship on a wave field) to the three.js
 * render layer through the fixed-timestep loop. The sim steps at a fixed rate;
 * the renderer interpolates between ticks for smooth motion. This is the
 * runnable P0 demo: a ship bobbing on shader water with an orbit camera.
 */
import { GameLoop } from "@core/loop";
import { Rng } from "@core/rng";
import { World } from "@sim/world";
import { Ship } from "@sim/ship";
import { SceneView } from "@render/scene";
import { ShipModel } from "@render/shipModel";

const SEED = 0x5eed;

const container = document.getElementById("app");
const hud = document.getElementById("hud");
if (!container) throw new Error("missing #app container");

// --- Simulation ---
const world = new World(new Rng(SEED));
world.addShip(new Ship(0, 0, Math.PI * 0.15));

// --- Render ---
const view = new SceneView(container);
const shipModels = world.ships.map(() => {
  const model = new ShipModel();
  view.add(model.group);
  return model;
});

// --- FPS sampling for the HUD ---
let frames = 0;
let fps = 0;
let fpsClock = performance.now();

const loop = new GameLoop(
  {
    update: (dt) => {
      world.tick(dt);
    },
    render: (alpha) => {
      // Time at the interpolated point between previous and current tick, so
      // the water surface the shader draws matches where each hull is sitting.
      const renderTime = loop.simTime - loop.dt * (1 - alpha);

      for (let i = 0; i < shipModels.length; i++) {
        shipModels[i]!.applyPose(world.interpolatedPose(i, alpha));
      }
      view.render(renderTime);

      frames++;
      const now = performance.now();
      if (now - fpsClock >= 500) {
        fps = Math.round((frames * 1000) / (now - fpsClock));
        frames = 0;
        fpsClock = now;
        if (hud) {
          const p = world.interpolatedPose(0, alpha);
          hud.textContent = [
            "ADMIRALTY · P0 foundation",
            `fps        ${fps}`,
            `sim tick   ${loop.tick}`,
            `sim time   ${loop.simTime.toFixed(1)}s`,
            `seed       0x${SEED.toString(16)}`,
            "",
            `heave      ${p.y >= 0 ? " " : ""}${p.y.toFixed(2)} m`,
            `pitch      ${((p.pitch * 180) / Math.PI).toFixed(1)}°`,
            `roll       ${((p.roll * 180) / Math.PI).toFixed(1)}°`,
            "",
            "drag to orbit · scroll to zoom",
          ].join("\n");
        }
      }
    },
  },
  { dt: 1 / 60 },
);

loop.start();
