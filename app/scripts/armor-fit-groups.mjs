// Preserve physical assemblies before material batching discards authoring nodes.
import * as T from "three";
const baseName = (name) => name.replace(/\.\d+$/, "");
export function armorFitGroups(nodes, kind) {
    if (kind === "office-worker") return { parts: new Map(), anchors: [] };
    const parts = nodes
        .filter((n) => n.getMesh())
        .map((node) => {
            const world = new T.Matrix4().fromArray(node.getWorldMatrix());
            const points = node
                .getMesh()
                .listPrimitives()
                .flatMap((p) => {
                    const a = p.getAttribute("POSITION");
                    return Array.from({ length: a.getCount() }, (_, i) =>
                        new T.Vector3().fromArray(a.getElement(i, [])).applyMatrix4(world),
                    );
                });
            const box = new T.Box3().setFromPoints(points);
            return {
                node,
                name: baseName(node.getName()),
                points,
                box,
                center: box.getCenter(new T.Vector3()),
            };
        });
    const flexible = (p) =>
        /^(Belt \/ padded webbing|Carrier \/ fitted ballistic shell|Light \/ (knee sleeve|lower knee strap|upper knee strap)|NYX \/ (fitted jacket|fitted shin wrap|forearm bracer|articulated knee sleeve|shoulder cap|shoulder binding|thigh foundation|thigh retention seam|upper arm flex layer))$/.test(
            p.name,
        ) ||
        (p.name.startsWith("Boot /") && !/shin guard|eyelet|outsole|heel counter$/.test(p.name));
    const rigid = parts.filter((p) => !flexible(p));
    const primary = rigid.filter((p) => {
        if (p.name.startsWith("Belt /"))
            return /\/ (magazine pouch|utility pouch|rear medical pouch|quick release buckle)$/.test(
                p.name,
            );
        if (p.name.startsWith("Boot /")) return true;
        return (
            p.name.split(" / ").length === 2 &&
            /(?:shell|shield|tile|plate|segment|overlap|wrap|vambrace|lame|sternum|upper chest|knee pad|magazine sleeve)$/.test(
                p.name,
            )
        );
    });
    if (!primary.length) throw Error(`No rigid assemblies defined for ${kind}`);
    const mapping = new Map();
    const anchors = primary.map((p) => ({ name: p.node.getName(), center: p.center.toArray() }));
    const modules = rigid.filter((p) => p.name.endsWith(" / chamfered housing"));
    const nearest = (p, candidates) => {
        let best = Infinity,
            result;
        for (const candidate of candidates) {
            if (p.name.startsWith("Belt /") !== candidate.name.startsWith("Belt /")) continue;
            if (p.name.startsWith("Boot /") !== candidate.name.startsWith("Boot /")) continue;
            const distance =
                Math.min(...candidate.points.map((q) => q.distanceToSquared(p.center))) +
                0.02 * candidate.center.distanceToSquared(p.center);
            if (distance < best) {
                best = distance;
                result = candidate;
            }
        }
        if (!result) throw Error(`Unassigned armor detail: ${p.name}`);
        return result;
    };
    for (const [i, p] of primary.entries()) mapping.set(p.node, i + 1);
    // Relief housings, their recessed beds and caps are one assembly even when
    // their centers are closest to different overlapping armor panels.
    for (const p of modules) mapping.set(p.node, mapping.get(nearest(p, primary).node));
    const parents = [...primary, ...modules];
    for (const p of rigid) {
        if (mapping.has(p.node)) continue;
        const named = parents.filter((candidate) => {
            const name = candidate.name.replace(" / chamfered housing", "");
            return p.name.startsWith(name + " / ");
        });
        const parent = nearest(p, named.length ? named : parents);
        mapping.set(p.node, mapping.get(parent.node));
    }
    return { parts: mapping, anchors };
}
