/**
 * Admiralty — P1 entry point.
 *
 * Wires the deterministic sailing sim to the three.js render layer through the
 * fixed-timestep loop. The sim steps at a fixed rate; the renderer interpolates
 * between ticks. This is the runnable P1 demo: order a heading and watch the
 * ship sail honestly — it refuses to point upwind and must tack to make ground
 * to windward. Keyboard helm stands in for P2's command layer.
 */
import { GameLoop } from "@core/loop";
import { Rng } from "@core/rng";
import { World } from "@sim/world";
import { Ship } from "@sim/ship";
import { SailSet } from "@sim/shipClass";
import { pointOfSail, type Wind } from "@sim/wind";
import { SceneView } from "@render/scene";
import { ShipModel } from "@render/shipModel";

const SEED = 0x5eed;
const KNOTS = 1 / 0.514444; // m/s → knots
const RAD2DEG = 180 / Math.PI;

const container = document.getElementById("app");
const hud = document.getElementById("hud");
if (!container) throw new Error("missing #app container");

// --- Simulation ---
const wind: Wind = { fromDir: 0, speed: 7 };
const world = new World(new Rng(SEED), wind);
// Start on a beam reach so she's making way from the first tick.
const flagship = world.addShip(new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle));

// --- Render ---
const view = new SceneView(container);
view.setWind(wind.fromDir);
const shipModels = world.ships.map(() => {
  const model = new ShipModel();
  view.add(model.group);
  return model;
});

// --- Helm controls (placeholder for P2's order pipeline) ---
const HELM_STEP = (5 * Math.PI) / 180; // 5° per key press
window.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowLeft":
    case "a":
      flagship.nudgeHelm(-HELM_STEP);
      break;
    case "ArrowRight":
    case "d":
      flagship.nudgeHelm(HELM_STEP);
      break;
    case "ArrowUp":
    case "w":
      flagship.makeSail();
      break;
    case "ArrowDown":
    case "s":
      flagship.reduceSail();
      break;
    case "q":
      flagship.tack(wind);
      break;
    case "e":
      flagship.wear(wind);
      break;
    default:
      return;
  }
  e.preventDefault();
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
      const p = world.interpolatedPose(0, alpha);
      view.follow(p.x, p.z);
      view.render(renderTime);

      frames++;
      const now = performance.now();
      if (now - fpsClock >= 500) {
        fps = Math.round((frames * 1000) / (now - fpsClock));
        frames = 0;
        fpsClock = now;
        if (hud) hud.textContent = telemetry(fps);
      }
    },
  },
  { dt: 1 / 60 },
);

function telemetry(currentFps: number): string {
  const s = flagship;
  const sail = SailSet[s.sailSet];
  const pos =
    s.maneuver !== "none"
      ? s.maneuver === "tack"
        ? "Tacking…"
        : "Wearing…"
      : pointOfSail(s.twa, s.shipClass.nogoAngle, s.inIrons);
  const sog = Math.hypot(s.velocity.x, s.velocity.z) * KNOTS;
  return [
    "ADMIRALTY · P1 sailing",
    `fps        ${currentFps}`,
    `sim time   ${loop.simTime.toFixed(1)}s`,
    "",
    `wind from  ${(((wind.fromDir * RAD2DEG) % 360) + 360).toFixed(0).padStart(3)}°  ${(wind.speed * KNOTS).toFixed(1)} kn`,
    `heading    ${(((s.heading * RAD2DEG) % 360) + 360).toFixed(0).padStart(3)}°`,
    `ordered    ${(((s.targetHeading * RAD2DEG) % 360) + 360).toFixed(0).padStart(3)}°`,
    `TWA        ${(s.twa * RAD2DEG).toFixed(0).padStart(3)}°  ${pos}`,
    `speed      ${(s.surge * KNOTS).toFixed(1)} kn  (SOG ${sog.toFixed(1)})`,
    `sail       ${sail}  ${(s.trim * 100).toFixed(0)}%`,
    `rudder     ${s.rudder >= 0 ? " " : ""}${s.rudder.toFixed(2)}`,
    s.inIrons ? "*** IN IRONS — falling off ***" : "",
    "",
    "A/D steer · W/S sail · Q tack · E wear",
    "drag to orbit · scroll to zoom",
  ].join("\n");
}

loop.start();
