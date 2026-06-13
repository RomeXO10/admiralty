/**
 * Admiralty — P2 entry point.
 *
 * The command layer in action: you are the admiral on the flagship, signalling
 * orders to a consort sailing in company. You don't touch her helm — you hoist a
 * signal, and it must be *seen* across the water, *comprehended* by her captain,
 * and only then *carried out*. Watch the delay: the consort holds her course for
 * a few seconds after each order, then comes round; the order's state on the HUD
 * walks Hoist → EnRoute → Comprehending → Executing, and the acknowledgement
 * lags behind — for a moment you've ordered into a void and don't yet know it
 * landed. Misreads (rare with a steady captain) are telegraphed in the log.
 *
 * Still the same architecture: a deterministic fixed-timestep sim (now sailing +
 * command) stepped under a render/interpolation split. The command layer ticks
 * just before the world so executed orders drive that step's physics.
 */
import { GameLoop } from "@core/loop";
import { Rng } from "@core/rng";
import { wrapAngle } from "@core/math";
import { World } from "@sim/world";
import { Ship } from "@sim/ship";
import { SailSet } from "@sim/shipClass";
import { pointOfSail, type Wind } from "@sim/wind";
import { CommandSystem } from "@command/commandSystem";
import { OrderType } from "@command/order";
import { STEADY_CAPTAIN } from "@command/captain";
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
// The flagship (admiral's own deck) and a consort 75 m off the quarter, both on
// a beam reach so they're making way from the first tick.
const flagship = world.addShip(new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle));
const consort = world.addShip(new Ship(-60, 45, Math.PI / 2, undefined, SailSet.Battle));

// --- Command layer: the admiral signals the consort from the flagship ---
const command = new CommandSystem(world);
command.setFlagship(flagship.id);
command.setCaptain(consort.id, STEADY_CAPTAIN);

// The admiral's *intent* for the consort — what the next signal will order. The
// ship only adopts it after the signal completes its passage.
let intendedHeading = consort.heading;
let intendedSail = consort.sailSet;

// --- Render ---
const view = new SceneView(container);
view.setWind(wind.fromDir);
const shipModels = world.ships.map(() => {
  const model = new ShipModel();
  view.add(model.group);
  return model;
});

// --- Order controls (the admiral's signal book) ---
const HELM_STEP = (15 * Math.PI) / 180; // 15° per key press
window.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowLeft":
    case "a":
      intendedHeading = wrapAngle(intendedHeading - HELM_STEP);
      command.issue(consort.id, { type: OrderType.SteerToHeading, heading: intendedHeading });
      break;
    case "ArrowRight":
    case "d":
      intendedHeading = wrapAngle(intendedHeading + HELM_STEP);
      command.issue(consort.id, { type: OrderType.SteerToHeading, heading: intendedHeading });
      break;
    case "ArrowUp":
    case "w":
      if (intendedSail < SailSet.Full) intendedSail = (intendedSail + 1) as SailSet;
      command.issue(consort.id, { type: OrderType.SetSail, sailSet: intendedSail });
      break;
    case "ArrowDown":
    case "s":
      if (intendedSail > SailSet.Furled) intendedSail = (intendedSail - 1) as SailSet;
      command.issue(consort.id, { type: OrderType.SetSail, sailSet: intendedSail });
      break;
    case "q":
      command.issue(consort.id, { type: OrderType.Tack });
      break;
    case "e":
      command.issue(consort.id, { type: OrderType.Wear });
      break;
    case "h":
      command.issue(consort.id, { type: OrderType.HoldStation });
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
      // Command first: orders that complete this step set the helm/rig before
      // the physics integrates, so execution drives the very next tick.
      command.tick(dt);
      world.tick(dt);
    },
    render: (alpha) => {
      const renderTime = loop.simTime - loop.dt * (1 - alpha);

      for (let i = 0; i < shipModels.length; i++) {
        shipModels[i]!.applyPose(world.interpolatedPose(i, alpha));
      }
      // Keep both ships framed by following the midpoint between them.
      const a = world.interpolatedPose(0, alpha);
      const b = world.interpolatedPose(1, alpha);
      view.follow((a.x + b.x) / 2, (a.z + b.z) / 2);
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

const deg = (rad: number): string => (((rad * RAD2DEG) % 360) + 360).toFixed(0).padStart(3);

/** One line per live signal: which order, where it is in its passage, and ack. */
function signalLines(): string[] {
  const live = command.view().filter((o) => o.recipient === consort.id);
  if (live.length === 0) return ["  (no signals flying)"];
  return live.map((o) => {
    const stage = o.misread ? `${o.stage} (misread!)` : o.stage;
    const ack = o.acknowledged ? "ack ✓" : "ack ···";
    return `  #${o.id} ${o.type.padEnd(14)} ${stage.padEnd(12)} ${ack}`;
  });
}

/** The last few outcomes, newest first — the signal log / after-action trail. */
function reportLines(): string[] {
  const recent = command.reports.filter((r) => r.recipient === consort.id).slice(-4).reverse();
  return recent.map((r) => `  #${r.orderId} ${r.outcome.toUpperCase()} — ${r.detail}`);
}

function telemetry(currentFps: number): string {
  const s = consort;
  const sail = SailSet[s.sailSet];
  const pos =
    s.maneuver !== "none"
      ? s.maneuver === "tack"
        ? "Tacking…"
        : "Wearing…"
      : pointOfSail(s.twa, s.shipClass.nogoAngle, s.inIrons);
  const sog = Math.hypot(s.velocity.x, s.velocity.z) * KNOTS;
  return [
    "ADMIRALTY · P2 command",
    `fps        ${currentFps}`,
    `sim time   ${loop.simTime.toFixed(1)}s`,
    "",
    `wind from  ${deg(wind.fromDir)}°  ${(wind.speed * KNOTS).toFixed(1)} kn`,
    "",
    "— CONSORT —",
    `heading    ${deg(s.heading)}°`,
    `ordered    ${deg(intendedHeading)}°  (intent)`,
    `TWA        ${(s.twa * RAD2DEG).toFixed(0).padStart(3)}°  ${pos}`,
    `speed      ${(s.surge * KNOTS).toFixed(1)} kn  (SOG ${sog.toFixed(1)})`,
    `sail       ${sail}  ${(s.trim * 100).toFixed(0)}%`,
    s.inIrons ? "*** IN IRONS — falling off ***" : "",
    "",
    "— SIGNALS —",
    ...signalLines(),
    "",
    "— LOG —",
    ...reportLines(),
    "",
    "A/D steer · W/S sail · Q tack · E wear · H hold",
    "drag to orbit · scroll to zoom",
  ].join("\n");
}

loop.start();
