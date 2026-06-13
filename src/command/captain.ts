/**
 * Captain autonomy & competence (see `docs/command-system.md` §4).
 *
 * Each ship is commanded by a captain with a **visible** profile, so that when a
 * captain is slow to obey or misreads a signal it reads as *character*, not as
 * the game cheating. P2 uses `skill` (comprehension speed + accuracy) and
 * `lookout` (how fast the ship reads a hoist). `aggression`, `nerve`, and
 * `initiative` are carried now but only bite once there's a fight to be brave or
 * shy in (P3): bold-engage, break-under-fire, doctrine fallback.
 *
 * Pure data — no sim or three.js coupling.
 */
export interface CaptainProfile {
  /** Execution speed + comprehension accuracy. ~0.5 (raw) .. ~1.5 (crack). */
  skill: number;
  /** Tendency to engage/close on own initiative. 0..1. (P3) */
  aggression: number;
  /** Resistance to hauling off / striking under damage. 0..1. (P3) */
  nerve: number;
  /** Acts on standing orders in the absence of fresh orders. 0..1. (P3) */
  initiative: number;
  /** Lookout quality: how quickly the ship reads a hoist. ~0.5 .. ~1.5. */
  lookout: number;
}

/** A competent, reliable captain — the default when none is assigned. */
export const STEADY_CAPTAIN: CaptainProfile = {
  skill: 1,
  aggression: 0.5,
  nerve: 0.7,
  initiative: 0.5,
  lookout: 1,
};

/** A crack captain: quick to read signals, quick and faithful to obey. */
export const CRACK_CAPTAIN: CaptainProfile = {
  skill: 1.4,
  aggression: 0.7,
  nerve: 0.85,
  initiative: 0.7,
  lookout: 1.3,
};

/** A raw captain: slow lookouts, slow to comprehend, prone to misreads. */
export const RAW_CAPTAIN: CaptainProfile = {
  skill: 0.65,
  aggression: 0.4,
  nerve: 0.5,
  initiative: 0.3,
  lookout: 0.7,
};
