/**
 * Placeholder ship model for P0.
 *
 * A blocky hull with a deck, two masts, and a bowsprit — enough to read
 * heading, pitch, and roll at a glance. Real ship models come later; this just
 * needs to sit convincingly on the water and bob.
 */
import * as THREE from "three";
import { ShipStatus, type Pose } from "@sim/ship";

export class ShipModel {
  readonly group: THREE.Group;
  /** Sail meshes, so the rig can be shown ragged, furled, or struck. */
  private readonly sails: THREE.Mesh[] = [];
  private readonly sailMat: THREE.MeshStandardMaterial;

  constructor() {
    const group = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x5a3a22,
      roughness: 0.8,
      metalness: 0.05,
    });
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x8a6a40,
      roughness: 0.9,
    });
    const mastMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a18,
      roughness: 0.7,
    });
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xe8e2d0,
      roughness: 0.95,
      side: THREE.DoubleSide,
      transparent: true,
    });
    this.sailMat = sailMat;

    // Hull: a tapered box. Length runs along +X (heading 0).
    const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 3), hullMat);
    hull.position.y = 0.2;
    // Pinch the bow by scaling the +X end inward.
    hull.geometry.translate(0, 0, 0);
    group.add(hull);

    // A simple bow wedge.
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 4), hullMat);
    bow.rotation.z = -Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.scale.set(0.5, 1, 1);
    bow.position.set(5.5, 0.2, 0);
    group.add(bow);

    // Deck.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.3, 2.6), deckMat);
    deck.position.y = 1.35;
    group.add(deck);

    // Masts + sails.
    for (const [mx, mh] of [
      [-1.5, 7],
      [2, 8],
    ] as const) {
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, mh, 8),
        mastMat,
      );
      mast.position.set(mx, 1.5 + mh / 2, 0);
      group.add(mast);

      const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.6, mh * 0.6), sailMat);
      sail.position.set(mx, 1.6 + mh * 0.45, 0);
      sail.rotation.y = Math.PI / 2;
      group.add(sail);
      this.sails.push(sail);
    }

    // Bowsprit.
    const bowsprit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 4, 6),
      mastMat,
    );
    bowsprit.rotation.z = Math.PI / 2.3;
    bowsprit.position.set(6.5, 1.6, 0);
    group.add(bowsprit);

    group.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });

    this.group = group;
  }

  /**
   * Apply an interpolated sim pose to the model transform.
   *
   * Sim conventions (see sim/ship.ts): the hull's forward axis is +X at
   * heading 0, starboard is +Z, +pitch raises the bow, +roll raises starboard.
   * three.js yaw about Y is negated so increasing heading swings the bow from
   * +X toward +Z to match the sim's (cos, sin) forward vector; +roll about the
   * local X axis lowers +Z, so it is negated too.
   */
  applyPose(pose: Pose): void {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.rotation.set(-pose.roll, -pose.yaw, pose.pitch, "YXZ");
  }

  /**
   * Reflect a ship's combat condition in her rig: sails thin out as the rigging
   * is shot away, and come down entirely once she strikes or sinks.
   */
  setCondition(sailEfficiency: number, status: ShipStatus): void {
    const flying = status === ShipStatus.Fighting;
    this.sailMat.opacity = flying ? 0.35 + 0.65 * sailEfficiency : 0.12;
    for (const sail of this.sails) sail.visible = flying;
  }
}
