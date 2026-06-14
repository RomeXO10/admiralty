/**
 * Formation geometry — where each ship in a squadron is *supposed* to be.
 *
 * This is the deterministic heart of P4's squadron handling (see
 * `docs/fleet-formations.md`). A formation is a rule that, from the reference
 * ship's pose and an interval, gives every member a **station**: a position and
 * a heading to hold. The squadron layer (`squadron.ts`) reads these stations and
 * the station-keeping controller below to keep captains in their place.
 *
 * Conventions match the sim (`sim/ship.ts`): the sea is the XZ plane, a heading
 * ψ points the bow along forward = (cos ψ, sin ψ) with starboard = (−sin ψ,
 * cos ψ). Pure geometry — no three.js, no sim state, deterministic.
 */

/** The squadron shapes available in P4. */
export enum Formation {
  /** Line of battle: a single column, bow to stern, all on one course. */
  LineAhead = "LineAhead",
  /** Line abreast: ships side by side along the beam, all on one course. */
  LineAbreast = "LineAbreast",
}

/** The pose a station is measured from — the reference (usually flag) ship. */
export interface FormationRef {
  x: number;
  z: number;
  /** Course of the whole formation (radians); every station inherits it. */
  heading: number;
}

/** A place to hold in the formation: a spot on the water and a course to steer. */
export interface Station {
  x: number;
  z: number;
  heading: number;
}

/**
 * The station for the ship at column `index` when the reference ship sits at
 * column `refIndex`, given the reference pose and the `interval` (metres) between
 * neighbours. Column order runs van (0) → rear; in {@link Formation.LineAhead}
 * lower indices are *ahead*, in {@link Formation.LineAbreast} they are to *port*.
 */
export function stationFor(
  formation: Formation,
  ref: FormationRef,
  refIndex: number,
  index: number,
  interval: number,
): Station {
  // Signed distance from the reference along the spreading axis: positive means
  // ahead (line ahead) or to starboard (line abreast) of the reference.
  const offset = (refIndex - index) * interval;
  const cos = Math.cos(ref.heading);
  const sin = Math.sin(ref.heading);

  if (formation === Formation.LineAhead) {
    // Spread along the course: forward = (cos, sin).
    return { x: ref.x + cos * offset, z: ref.z + sin * offset, heading: ref.heading };
  }
  // Line abreast: spread along the beam: starboard = (−sin, cos).
  return { x: ref.x - sin * offset, z: ref.z + cos * offset, heading: ref.heading };
}

/**
 * The course a follower should steer to take and hold `station` from `pos`.
 *
 * A pure-pursuit controller: it aims not at the station itself but at a carrot
 * pulled `lookahead` metres *downstream* along the station's course. Far off
 * station she points almost straight at it and closes hard; as she settles the
 * carrot dominates and her course eases onto the formation course, so the line
 * ends up parallel rather than converging. Larger `lookahead` = gentler, less
 * twitchy correction. Returns a heading in radians (atan2 range, (−π, π]).
 */
export function stationKeepingHeading(
  pos: { x: number; z: number },
  station: Station,
  lookahead: number,
): number {
  const dx = station.x - pos.x;
  const dz = station.z - pos.z;
  const carrotX = dx + Math.cos(station.heading) * lookahead;
  const carrotZ = dz + Math.sin(station.heading) * lookahead;
  return Math.atan2(carrotZ, carrotX);
}
