// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { armTo } from "@ghosts/squad/motion/clearance";
import { createHeldWeapon, supportSeat, type HeldGun } from "@ghosts/squad/studio/held-weapons";

const seats = new Map<HeldGun, ReturnType<typeof supportSeat>>();
/** The gun's own support seat (handguard underside and flank at its support
 * station), measured once on the held model. */
export function seatOf(model: HeldGun) {
    let seat = seats.get(model);
    if (!seat) {
        const gun = createHeldWeapon(model);
        seat = supportSeat(gun, model);
        gun.traverse((o) => {
            if (o instanceof T.Mesh) o.geometry.dispose();
        });
        seats.set(model, seat);
    }
    return seat;
}

/** How the support hand closes on a gun's seat, per gun and body. The wrist
 * sits `back` behind the seat, `drop` under the underside and `out` past the
 * left flank; the fingers reach `reach` past the far flank, `lift` above the
 * underside, their middle and end joints curling by `curl2`/`curl3`; the
 * thumb keeps `thumb` from the near flank. Fitted offline against the skinned
 * hands (palm or thumb and fingers within 5 mm of the gun, no crossings)
 * through the 24 held motions. */
export interface SupportFit {
    back: number;
    drop: number;
    out: number;
    reach: number;
    lift: number;
    thumb: number;
    curl2: number;
    curl3: number;
    /** How hard the thumb leans out per metre it comes inside `thumb`. */
    lean?: number;
}
export const SUPPORT_FIT: Record<HeldGun, Record<"female" | "male", SupportFit>> = {
    rifle: {
        female: {
            back: 0.033,
            drop: 0.03,
            out: 0.043,
            reach: 0.027,
            lift: 0.022,
            thumb: 0.012,
            curl2: 0.12,
            curl3: 0.15,
        },
        male: {
            back: 0.044,
            drop: 0.038,
            out: 0.058,
            reach: 0.029,
            lift: 0.021,
            thumb: 0.012,
            curl2: 0.18,
            curl3: 0.15,
        },
    },
    sniper: {
        female: {
            back: 0.041,
            drop: 0.032,
            out: 0.04,
            reach: 0.025,
            lift: 0.032,
            thumb: 0.012,
            curl2: 0,
            curl3: 0.15,
        },
        male: {
            back: 0.056,
            drop: 0.032,
            out: 0.058,
            reach: 0.035,
            lift: 0.027,
            thumb: 0.012,
            curl2: 0.18,
            curl3: 0.15,
        },
    },
    plasma: {
        // Wide forend: straight fingers reach round it, the thumb leans out along it.
        female: {
            back: 0.0455,
            drop: 0.0235,
            out: 0.017,
            reach: 0.055,
            lift: 0.022,
            thumb: 0.01,
            curl2: 0,
            curl3: 0,
            lean: 60,
        },
        male: {
            back: 0.0425,
            drop: 0.0295,
            out: 0.019,
            reach: 0.043,
            lift: 0.022,
            thumb: 0.004,
            curl2: 0.06,
            curl3: 0.06,
            lean: 60,
        },
    },
};

/** Offline support grip around the held gun's handguard (or forend), placed
 * from the gun's measured seat. Weapons and bones retain their scale. */
export function supportGrip(
    root: T.Group,
    weapon: T.Group,
    sex: string,
    model: HeldGun = "rifle",
    fit: Partial<SupportFit> = {},
) {
    const seat = seatOf(model),
        wrist: SupportFit = { ...SUPPORT_FIT[model][sex === "male" ? "male" : "female"], ...fit },
        // Slim handguards get the tighter wrap the old sharpshooter had.
        narrow = seat.half < 0.021;
    const bone = (name: string) => root.getObjectByName(`mixamorigLeft${name}`)!;
    const hand = bone("Hand");
    root.updateMatrixWorld(true);
    // The donor socket has a reflected scale: transform directions with its full
    // matrix, and conjugate rotations instead of discarding the reflection.
    const rotation = weapon.matrixWorld
        .clone()
        .multiply(new T.Matrix4().makeRotationY(0.5))
        .multiply(weapon.matrixWorld.clone().invert());
    const orientation = new T.Quaternion()
        .setFromRotationMatrix(rotation)
        .multiply(hand.getWorldQuaternion(new T.Quaternion()));
    const goal = weapon.localToWorld(
        new T.Vector3(
            seat.contact.x - wrist.back,
            seat.contact.y - wrist.drop,
            seat.half + wrist.out,
        ),
    );
    armTo(bone("Shoulder"), bone("Arm"), bone("ForeArm"), hand, goal);
    hand.quaternion.copy(
        hand.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(orientation),
    );
    hand.updateMatrixWorld(true);
    function aim(name: string, direction: T.Vector3) {
        const joint = bone(name),
            child = joint.children.find((o) => o instanceof T.Bone);
        const from = child
            ? child
                  .getWorldPosition(new T.Vector3())
                  .sub(joint.getWorldPosition(new T.Vector3()))
                  .normalize()
            : new T.Vector3(0, 1, 0).applyQuaternion(joint.getWorldQuaternion(new T.Quaternion()));
        const worldDirection = direction.transformDirection(weapon.matrixWorld);
        const rotation = new T.Quaternion()
            .setFromUnitVectors(from, worldDirection)
            .multiply(joint.getWorldQuaternion(new T.Quaternion()));
        joint.quaternion.copy(
            joint.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation),
        );
        joint.updateMatrixWorld(true);
    }
    for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
        const joint = bone(`Hand${finger}1`);
        const p = weapon.worldToLocal(joint.getWorldPosition(new T.Vector3()));
        // Fingers reach up the far flank, just above the underside.
        aim(
            `Hand${finger}1`,
            new T.Vector3(0, seat.contact.y + wrist.lift - p.y, -(seat.half + wrist.reach) - p.z),
        );
        aim(`Hand${finger}2`, new T.Vector3(0, 1, wrist.curl2));
        aim(`Hand${finger}3`, new T.Vector3(0, 1, wrist.curl3));
    }
    // Keep the metacarpal beside the palm and curl the free thumb joints
    // progressively along the side of the fore-end.
    const angles =
        sex === "female"
            ? narrow
                ? [45, 55, 65]
                : [45, 65, 75]
            : narrow
              ? [45, 45, 55]
              : [35, 35, 45];
    const offset = sex === "male" ? (narrow ? -0.1 : 0.2) : 0;
    angles.forEach((degrees, index) => {
        const angle = T.MathUtils.degToRad(degrees),
            name = `HandThumb${index + 1}`;
        // Lean the thumb out when its joint comes closer to the left flank
        // than a thumb's half-thickness, so it rides along the side.
        const p = weapon.worldToLocal(bone(name).getWorldPosition(new T.Vector3()));
        const inside = Math.max(0, seat.half + wrist.thumb - p.z);
        aim(
            name,
            new T.Vector3(
                Math.sin(angle),
                Math.cos(angle),
                offset - index * 0.08 + (wrist.lean ?? 8) * inside,
            ),
        );
    });
}
