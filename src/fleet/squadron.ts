/**
 * Squadrons & station-keeping — grouping ships so they move as one (P4).
 *
 * A {@link Squadron} is an ordered column of ships flying the same flag. The flag
 * sets the squadron's course (the admiral signals *her*, through the P2 command
 * layer, like any single ship); every other member then **conforms to the flag**,
 * holding the station the formation assigns her. See `docs/fleet-formations.md`.
 *
 * Station-keeping is captain autonomy, not a signalled order: like falling off
 * when caught in irons, a captain ordered into a formation works his helm
 * continuously to hold his place. So {@link FleetSystem.tick} sets each member's
 * helm directly (the sailing model still has the final say on whether she can
 * make station against the wind). Pure of three.js; deterministic from the
 * world's state.
 */
import { clamp } from "@core/math";
import type { ShipId } from "@command/order";
import { ShipStatus } from "@sim/ship";
import { SailSet } from "@sim/shipClass";
import type { World } from "@sim/world";
import {
  Formation,
  stationFor,
  stationKeepingHeading,
  type FormationRef,
  type Station,
} from "./formation";

/** Default spacing (m) between neighbours — a couple of cables for frigates. */
export const DEFAULT_INTERVAL = 80;
/** Default pursuit look-ahead (m) for station-keeping (see `formation.ts`). */
export const DEFAULT_LOOKAHEAD = 120;
/** Along-track slop (m) inside which a consort just matches the flag's canvas. */
export const DEFAULT_SPACING_BAND = 5;

export class Squadron {
  /** Current formation; the admiral can re-form on the fly. */
  formation: Formation;
  /** Spacing (m) between neighbouring stations. */
  interval: number;

  /**
   * @param flagshipId  the ship the squadron forms on (and the admiral signals).
   * @param memberIds   the column in order, van → rear, *including* the flagship.
   */
  constructor(
    readonly flagshipId: ShipId,
    readonly memberIds: ShipId[],
    formation: Formation = Formation.LineAhead,
    interval: number = DEFAULT_INTERVAL,
  ) {
    this.formation = formation;
    this.interval = interval;
  }

  /** The flagship's place in the column (0 = van); −1 if she isn't a member. */
  get flagIndex(): number {
    return this.memberIds.indexOf(this.flagshipId);
  }

  /**
   * The station every member should hold, keyed by ship id, measured from the
   * flag's pose `ref`. The flag's own station is the flag pose itself.
   */
  stations(ref: FormationRef): Map<ShipId, Station> {
    const flagIndex = this.flagIndex;
    const out = new Map<ShipId, Station>();
    for (let i = 0; i < this.memberIds.length; i++) {
      const id = this.memberIds[i]!;
      out.set(id, stationFor(this.formation, ref, flagIndex, i, this.interval));
    }
    return out;
  }
}

export class FleetSystem {
  private readonly squadrons: Squadron[] = [];

  constructor(
    private readonly world: World,
    /** Pursuit look-ahead (m) handed to the station-keeping controller. */
    public lookahead: number = DEFAULT_LOOKAHEAD,
    /** Spacing dead-band (m): hold the flag's sail when this close on-station. */
    public spacingBand: number = DEFAULT_SPACING_BAND,
  ) {}

  /** Register a squadron whose members will keep station each tick. */
  add(squadron: Squadron): Squadron {
    this.squadrons.push(squadron);
    return squadron;
  }

  /**
   * Hold the line: for every squadron, re-derive each member's station from the
   * flag's live pose and steer her toward it. Call once per sim step, *before*
   * `world.tick`, so the helm she'll integrate this step is the fresh one.
   *
   * A struck or sunk flag leaves her squadron leaderless — members hold their
   * last helm rather than chase a derelict; a struck or sunk member keeps no
   * station.
   *
   * Two controls keep station: the **helm** closes cross-track error (pure
   * pursuit, see `formation.ts`), and the **sail** closes the along-track gap —
   * a consort that has dropped astern makes more canvas to catch up, one that
   * has forereached takes some in, both around the flag's own sail as the datum.
   * Helm-only can't regulate spacing: ships on equal canvas hold whatever gap
   * they start with, so the sail trim is what actually dresses the line.
   */
  tick(): void {
    for (const squadron of this.squadrons) {
      const flag = this.shipOf(squadron.flagshipId);
      if (!flag || flag.status !== ShipStatus.Fighting) continue;

      const stations = squadron.stations({
        x: flag.pose.x,
        z: flag.pose.z,
        heading: flag.heading,
      });

      for (const id of squadron.memberIds) {
        if (id === squadron.flagshipId) continue;
        const ship = this.shipOf(id);
        if (!ship || ship.status !== ShipStatus.Fighting) continue;
        const station = stations.get(id)!;
        ship.setHelm(stationKeepingHeading(ship.pose, station, this.lookahead));
        ship.setSail(this.stationSail(ship, station, flag.sailSet));
      }
    }
  }

  /**
   * The sail a consort should carry to hold her along-track spacing: match the
   * flag inside the dead-band, else step one set up (astern of station, catch
   * up) or down (ahead of it, drop back), saturating at full and furled.
   */
  private stationSail(
    ship: { pose: { x: number; z: number } },
    station: Station,
    flagSail: SailSet,
  ): SailSet {
    // Signed gap along the course: positive means the station is ahead of her,
    // i.e. she has dropped astern and must crack on to close it.
    const along =
      (station.x - ship.pose.x) * Math.cos(station.heading) +
      (station.z - ship.pose.z) * Math.sin(station.heading);
    const step = along > this.spacingBand ? 1 : along < -this.spacingBand ? -1 : 0;
    return clamp(flagSail + step, SailSet.Furled, SailSet.Full) as SailSet;
  }

  private shipOf(id: ShipId) {
    return this.world.ships.find((s) => s.id === id);
  }
}
