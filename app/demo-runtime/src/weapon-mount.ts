import { Group, type Object3D } from "three";

/** Preserve the source weapon/hand attachment, including its mirrored scale. */
export function createWeaponMount(rifle: Object3D): Group {
  const mount = new Group();
  mount.name = "WeaponMount";
  mount.position.copy(rifle.position);
  mount.quaternion.copy(rifle.quaternion);
  mount.scale.copy(rifle.scale);
  rifle.parent!.add(mount);
  mount.add(rifle);
  rifle.position.set(0, 0, 0);
  rifle.rotation.set(0, 0, 0);
  rifle.scale.set(1, 1, 1);
  return mount;
}
