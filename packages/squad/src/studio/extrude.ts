// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Keeps `ExtrudeGeometry` end caps triangulated from the shape's own outline.
 *
 * Since three r175 the caps are triangulated from the bevelled outline instead.
 * The gear here is extruded with `bevelOffset: -bevelSize`, which insets that
 * outline by the bevel; where a wall is thinner than two bevels (a trigger
 * guard, a thin frame) the inset outline crosses its own hole and the caps come
 * out as stray triangles spanning the opening. The outline itself is always
 * valid, so its triangulation is used for the caps, as it was before r175.
 *
 * This is installed once, on three itself, rather than called at each extrude:
 * the gun builders are hashed into the baked poses, and the geometry they
 * produce does not change. Import this module from anything that extrudes.
 */
import * as T from "three";

type Outline = { contour: T.Vector2[]; holes: T.Vector2[][] };

const INSTALLED = Symbol.for("ghosts.extrude-caps");
const host = T.ShapeUtils as typeof T.ShapeUtils & { [INSTALLED]?: true };

/** Drops a closing point that repeats the first, as the triangulation does. */
function withoutClosingPoint(points: T.Vector2[]) {
    const last = points.length - 1;
    if (points.length > 2 && points[last].equals(points[0])) points.pop();
    return points;
}

if (!host[INSTALLED]) {
    host[INSTALLED] = true;
    /** The outline of the shape being extruded, until its caps are triangulated. */
    let pending: Outline | null = null;

    const extractPoints = T.Shape.prototype.extractPoints;
    T.Shape.prototype.extractPoints = function (divisions) {
        const points = extractPoints.call(this, divisions);
        let contour = points.shape.slice();
        const holes = points.holes.map((hole) => hole.slice());
        // The same winding three settles on before it builds the layers.
        if (!T.ShapeUtils.isClockWise(contour)) {
            contour = contour.reverse();
            holes.forEach((hole, i) => {
                if (T.ShapeUtils.isClockWise(hole)) holes[i] = hole.reverse();
            });
        }
        withoutClosingPoint(contour);
        holes.forEach(withoutClosingPoint);
        pending = { contour, holes };
        return points;
    };

    const triangulate = T.ShapeUtils.triangulateShape;
    T.ShapeUtils.triangulateShape = (contour, holes) => {
        const outline = pending;
        pending = null;
        // Indices must line up with the layer three built; a contour of another
        // size is not the pending shape's, or three merged points of its own.
        const fits =
            outline !== null &&
            outline.contour.length === contour.length &&
            outline.holes.length === holes.length &&
            outline.holes.every((hole, i) => hole.length === holes[i].length);
        return fits
            ? triangulate(outline.contour, outline.holes)
            : triangulate(contour, holes);
    };
}
