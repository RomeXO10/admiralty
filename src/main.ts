/**
 * Admiralty — P3 entry point: a duel.
 *
 * Two frigates run side by side and fight. You are the admiral on the friendly
 * ship: you signal her helm and her guns (still through P2's command layer, so
 * orders take their passage), while the enemy holds her course and fires as her
 * guns bear. Watch the things the gunnery model actually simulates — broadsides
 * only bite when a battery *bears*; round shot holes the hull and floods her,
 * chain brings down masts and cuts her speed, grape sweeps the deck at close
 * range; the reload paces the fire; and crossing her bow or stern to **rake**
 * sends shot down her whole length for a savage bonus. It ends when one ship
 * **strikes her colors** (taken as a prize) or **sinks** — not at a health bar.
 *
 * Same architecture throughout: a deterministic fixed-timestep sim (sailing +
 * command + gunnery) under a render/interpolation split. Damage resolves
 * statistically in `sim/`; the cannon smoke here is pure spectacle.
 */
import { GameLoop } from "@core/loop";
import { Rng } from "@core/rng";
import { wrapAngle } from "@core/math";
import { World } from "@sim/world";
import { Ship, ShipStatus } from "@sim/ship";
import { SailSet } from "@sim/shipClass";
import { pointOfSail, type Wind } from "@sim/wind";
import { BatterySide, ShotType } from "@sim/battery";
import { GunnerySystem, FireControl } from "@sim/gunnery";
import { CommandSystem } from "@command/commandSystem";
import { OrderType } from "@command/order";
import { CRACK_CAPTAIN, STEADY_CAPTAIN } from "@command/captain";
import { SceneView } from "@render/scene";
import { ShipModel } from "@render/shipModel";
import { SmokeField } from "@render/smoke";

const KNOTS = 1 / 0.514444; // m/s → knots
const RAD2DEG = 180 / Math.PI;

// A seed in the URL hash varies the duel while keeping each run reproducible.
const SEED = (parseInt(location.hash.slice(1), 10) || 0) ^ 0x5eed;

const container = document.getElementById("app");
const hud = document.getElementById("hud");
if (!container) throw new Error("missing #app container");

// --- Simulation: two frigates on a beam reach, 44 m apart ---
const wind: Wind = { fromDir: Math.PI / 2, speed: 7 };
const world = new World(new Rng(SEED), wind);
const friendly = world.addShip(new Ship(0, -22, 0, undefined, SailSet.Battle));
const enemy = world.addShip(new Ship(0, 22, 0, undefined, SailSet.Battle));

// --- Command layer: the admiral signals his own frigate ---
const command = new CommandSystem(world);
command.setFlagship(friendly.id);
command.setCaptain(friendly.id, CRACK_CAPTAIN);

// --- Gunnery: both ships armed and firing as their guns bear ---
const gun = new GunnerySystem(world);
gun.arm(friendly.id, {
  target: enemy.id,
  crewQuality: friendly.shipClass.crewQuality,
  nerve: CRACK_CAPTAIN.nerve,
});
gun.arm(enemy.id, {
  target: friendly.id,
  crewQuality: enemy.shipClass.crewQuality,
  nerve: STEADY_CAPTAIN.nerve,
});

// The admiral's *intent* for the friendly ship — adopted only once a signal lands.
let intendedHeading = friendly.heading;
let intendedSail = friendly.sailSet;
let firingFree = true;

// --- Render ---
const view = new SceneView(container);
view.setWind(wind.fromDir);
const smoke = new SmokeField(view.scene);
smoke.setWind(wind.fromDir, wind.speed);
const shipModels = world.ships.map(() => {
  const model = new ShipModel();
  view.add(model.group);
  return model;
});
let smokeSeen = 0; // index into gun.volleys we've already spawned smoke for

// --- Controls: the signal book + the gun deck ---
let paused = false;
const HELM_STEP = (15 * Math.PI) / 180;
window.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowLeft":
    case "a":
      intendedHeading = wrapAngle(intendedHeading - HELM_STEP);
      command.issue(friendly.id, { type: OrderType.SteerToHeading, heading: intendedHeading });
      break;
    case "ArrowRight":
    case "d":
      intendedHeading = wrapAngle(intendedHeading + HELM_STEP);
      command.issue(friendly.id, { type: OrderType.SteerToHeading, heading: intendedHeading });
      break;
    case "ArrowUp":
    case "w":
      if (intendedSail < SailSet.Full) intendedSail = (intendedSail + 1) as SailSet;
      command.issue(friendly.id, { type: OrderType.SetSail, sailSet: intendedSail });
      break;
    case "ArrowDown":
    case "s":
      if (intendedSail > SailSet.Furled) intendedSail = (intendedSail - 1) as SailSet;
      command.issue(friendly.id, { type: OrderType.SetSail, sailSet: intendedSail });
      break;
    case "q":
      command.issue(friendly.id, { type: OrderType.Tack });
      break;
    case "e":
      command.issue(friendly.id, { type: OrderType.Wear });
      break;
    case "h":
      command.issue(friendly.id, { type: OrderType.HoldStation });
      break;
    case "1":
      gun.setShot(friendly.id, ShotType.Round);
      break;
    case "2":
      gun.setShot(friendly.id, ShotType.Chain);
      break;
    case "3":
      gun.setShot(friendly.id, ShotType.Grape);
      break;
    case "f":
      gun.fireBroadside(friendly.id);
      break;
    case "c":
      firingFree = !firingFree;
      gun.setFireControl(friendly.id, firingFree ? FireControl.Free : FireControl.Hold);
      break;
    case " ":
      paused = !paused;
      break;
    case "r":
      location.hash = String((SEED ^ 0x5eed) + 1);
      location.reload();
      break;
    default:
      return;
  }
  e.preventDefault();
});

// --- FPS + frame-time sampling for the HUD and the smoke ---
let frames = 0;
let fps = 0;
let fpsClock = performance.now();
let lastFrame = performance.now();
let simClock = 0;

const loop = new GameLoop(
  {
    update: (dt) => {
      if (paused) return;
      simClock += dt;
      // Order of operations: orders set the helm/rig, the world integrates, then
      // the guns resolve from where the ships have ended up this tick.
      command.tick(dt);
      world.tick(dt);
      gun.tick(dt);
    },
    render: (alpha) => {
      const renderTime = simClock - loop.dt * (1 - alpha);
      const now = performance.now();
      const frameDt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;

      for (let i = 0; i < shipModels.length; i++) {
        const ship = world.ships[i]!;
        shipModels[i]!.applyPose(world.interpolatedPose(i, alpha));
        shipModels[i]!.setCondition(ship.damage.sailEfficiency, ship.status);
      }

      // Spawn smoke for any volleys fired since the last frame.
      for (; smokeSeen < gun.volleys.length; smokeSeen++) {
        const v = gun.volleys[smokeSeen]!;
        const size = v.side === BatterySide.Starboard || v.side === BatterySide.Port ? 1.4 : 0.7;
        smoke.spawn(v.smokeX, v.smokeZ, size);
      }
      smoke.update(paused ? 0 : frameDt);

      const a = world.interpolatedPose(0, alpha);
      const b = world.interpolatedPose(1, alpha);
      view.follow((a.x + b.x) / 2, (a.z + b.z) / 2);
      view.render(renderTime);

      frames++;
      if (now - fpsClock >= 400) {
        fps = Math.round((frames * 1000) / (now - fpsClock));
        frames = 0;
        fpsClock = now;
        if (hud) hud.textContent = telemetry();
      }
    },
  },
  { dt: 1 / 60 },
);

const deg = (rad: number): string => (((rad * RAD2DEG) % 360) + 360).toFixed(0).padStart(3);
const pct = (v: number): string => `${(v * 100).toFixed(0).padStart(3)}%`;

/** The reload state of a ship's two broadside batteries. */
function batteryLine(ship: Ship): string {
  const read = (side: BatterySide): string => {
    const bat = ship.batteries.find((x) => x.side === side);
    if (!bat || bat.effectiveGuns === 0) return "—";
    return bat.ready ? "READY" : `${Math.max(0, bat.reloadTimer).toFixed(0)}s`;
  };
  return `P:${read(BatterySide.Port).padEnd(5)} S:${read(BatterySide.Starboard).padEnd(5)}`;
}

/** A ship's full condition block for the HUD. */
function conditionLines(ship: Ship, label: string): string[] {
  const d = ship.damage;
  const m = d.masts;
  const statusTag =
    ship.status === ShipStatus.Sunk
      ? "  *** SUNK ***"
      : ship.status === ShipStatus.Struck
        ? "  *** STRUCK ***"
        : "";
  return [
    `— ${label} —${statusTag}`,
    `hull   ${pct(d.hull)}   rig ${pct(d.rigging)}   rudder ${pct(d.rudder)}`,
    `masts  fore ${pct(m.fore)} main ${pct(m.main)} miz ${pct(m.mizzen)}`,
    `crew   ${String(d.crew).padStart(3)}/${d.cfg.complement}   morale ${pct(d.morale)}`,
    `flood  ${d.water.toFixed(0)}/${d.cfg.reserveBuoyancy}   guns ${batteryLine(ship)}`,
  ];
}

/** The friendly ship's live orders (reused from P2). */
function signalLines(): string[] {
  const live = command.view().filter((o) => o.recipient === friendly.id);
  if (live.length === 0) return ["  (no signals flying)"];
  return live.map((o) => {
    const stage = o.misread ? `${o.stage} (misread!)` : o.stage;
    const ack = o.acknowledged ? "ack ✓" : "ack ···";
    return `  #${o.id} ${o.type.padEnd(14)} ${stage.padEnd(12)} ${ack}`;
  });
}

/** The recent combat trail: volleys and the reports that ended the fight. */
function combatLines(): string[] {
  const name = (id: number): string => (id === friendly.id ? "FRIENDLY" : "ENEMY");
  const volleys = gun.volleys.slice(-3).reverse().map((v) => {
    const rake = v.rake ? " RAKE!" : "";
    return `  ${name(v.firerId)} ${v.side.padEnd(9)} ${v.shotType} ×${v.hits}${rake}`;
  });
  const reports = gun.reports.slice(-3).reverse().map((r) => `  ${name(r.shipId)} — ${r.detail.toUpperCase()}`);
  return [...reports, ...volleys];
}

/** Banner once the fight is decided. */
function resultBanner(): string {
  if (enemy.status === ShipStatus.Sunk) return "ENEMY SUNK — VICTORY";
  if (enemy.status === ShipStatus.Struck) return "ENEMY STRUCK HER COLORS — PRIZE TAKEN";
  if (friendly.status === ShipStatus.Sunk) return "FRIENDLY SUNK — DEFEAT";
  if (friendly.status === ShipStatus.Struck) return "FRIENDLY STRUCK — DEFEAT";
  return "";
}

function telemetry(): string {
  const s = friendly;
  const range = Math.hypot(friendly.pose.x - enemy.pose.x, friendly.pose.z - enemy.pose.z);
  const pos =
    s.maneuver !== "none"
      ? s.maneuver === "tack"
        ? "Tacking…"
        : "Wearing…"
      : pointOfSail(s.twa, s.shipClass.nogoAngle, s.inIrons);
  const shot = s.batteries.find((b) => b.side === BatterySide.Starboard)?.shotType ?? ShotType.Round;
  const banner = resultBanner();

  return [
    `ADMIRALTY · P3 duel${paused ? "   [PAUSED]" : ""}`,
    banner ? `>>> ${banner} <<<` : "",
    `fps ${fps}   time ${simClock.toFixed(0)}s   range ${range.toFixed(0)} m`,
    `wind from ${deg(wind.fromDir)}°  ${(wind.speed * KNOTS).toFixed(1)} kn`,
    "",
    `— FRIENDLY HELM —`,
    `heading ${deg(s.heading)}°  ordered ${deg(intendedHeading)}°`,
    `${pos}   speed ${(s.surge * KNOTS).toFixed(1)} kn   sail ${SailSet[s.sailSet]}`,
    `shot ${shot}   fire ${firingFree ? "FREE" : "HOLD"}`,
    s.inIrons ? "*** IN IRONS ***" : "",
    "",
    ...conditionLines(friendly, "FRIENDLY"),
    "",
    ...conditionLines(enemy, "ENEMY"),
    "",
    "— SIGNALS —",
    ...signalLines(),
    "",
    "— COMBAT —",
    ...combatLines(),
    "",
    "A/D steer · W/S sail · Q/E tack/wear · H hold",
    "1/2/3 round/chain/grape · F fire · C cease/open · Space pause · R new duel",
  ].join("\n");
}

loop.start();
