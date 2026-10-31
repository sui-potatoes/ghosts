// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as THREE from "three";

/** A walkable steel bridge. No photograph or projective material is used here. */
export function createTitleBridge(scene: THREE.Scene) {
    const root = new THREE.Group();
    root.name = "Modeled footbridge: deck, two girders, railings and braced columns";
    scene.add(root);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const paint = new THREE.MeshStandardMaterial({
        color: 0x43545e,
        emissive: 0x080e12,
        emissiveIntensity: 0.18,
        roughness: 0.74,
        metalness: 0.35,
    });
    const edge = new THREE.MeshStandardMaterial({
        color: 0x233038,
        roughness: 0.56,
        metalness: 0.78,
    });
    const deckMaterial = new THREE.MeshStandardMaterial({
        color: 0x273238,
        roughness: 0.5,
        metalness: 0.55,
    });
    const lamp = new THREE.MeshBasicMaterial({ color: 0x9bcbd4, toneMapped: false });
    const deckY = 24.25;
    const z = -139;
    const center = -2.1;
    const width = 41.2;
    const depth = 3.4;
    function box(
        name: string,
        x: number,
        y: number,
        dz: number,
        w: number,
        h: number,
        d: number,
        material: THREE.Material = paint,
    ) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.position.set(x, y, dz);
        mesh.scale.set(w, h, d);
        root.add(mesh);
        return mesh;
    }
    function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number) {
        const mesh = box("Welded diagonal brace", 0, 0, 0, w, a.distanceTo(b), d);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            b.clone().sub(a).normalize(),
        );
    }
    box("Continuous walking deck", center, deckY - 0.09, z, width, 0.18, depth, deckMaterial);
    for (const side of [-1, 1]) {
        const sideZ = z + (side * depth) / 2;
        box("Plate girder web", center, deckY - 1.14, sideZ, width, 2.1, 0.12);
        for (const y of [deckY - 0.2, deckY - 2.23])
            box("Girder flange", center, y, sideZ, width + 0.12, 0.08, 0.28, edge);
        for (const y of [deckY + 0.4, deckY + 0.82])
            box("Continuous handrail", 0.325, y, sideZ, 36.35, 0.047, 0.047, edge);
        for (let x = center - width / 2; x <= center + width / 2 + 0.01; x += width / 18) {
            if (x >= -17.85)
                box(
                    "Railing post fixed into deck",
                    x,
                    deckY + 0.425,
                    sideZ,
                    0.045,
                    0.85,
                    0.045,
                    edge,
                );
            box(
                "Girder vertical stiffener",
                x,
                deckY - 1.18,
                sideZ + side * 0.08,
                0.055,
                2.02,
                0.06,
            );
        }
        for (const x of [-12, 16.7]) {
            // I-section columns physically meet the lower girder flange.
            const h = deckY - 2.23;
            box("Column web", x, h / 2, sideZ, 0.13, h, 0.32);
            for (const dx of [-0.18, 0.18])
                box("Column flange", x + dx, h / 2, sideZ, 0.06, h, 0.46, edge);
            box("Column base plate", x, 0.2, sideZ, 0.72, 0.16, 0.7);
            strut(
                new THREE.Vector3(x, h - 1.55, sideZ),
                new THREE.Vector3(x + (x < 0 ? 1.7 : -1.7), h, sideZ),
                0.17,
                0.18,
            );
        }
    }
    for (let x = center - width / 2; x <= center + width / 2; x += 1.6)
        box("Transverse deck bearer", x, deckY - 0.31, z, 0.13, 0.25, depth);
    for (const x of [-0.6, 0.1, 0.8])
        box(
            "Small deck-edge marker",
            x,
            deckY - 0.15,
            z + depth / 2 + 0.075,
            0.42,
            0.045,
            0.025,
            lamp,
        );
    // The lower distant crossing used to exist only in the source photograph.
    // It now shares the main bridge's instanced steel batches.
    const farZ = -238,
        farDeck = 19.1,
        farWidth = 39;
    box("Distant crossing deck", 0, farDeck - 0.12, farZ, farWidth, 0.24, 2.5, deckMaterial);
    for (const side of [-1, 1]) {
        const sideZ = farZ + side * 1.25;
        box("Distant crossing girder", 0, farDeck - 0.7, sideZ, farWidth, 1.3, 0.16);
        for (const y of [farDeck + 0.45, farDeck + 1.05])
            box("Distant crossing handrail", 0, y, sideZ, farWidth, 0.055, 0.055, edge);
        for (let x = -farWidth / 2; x <= farWidth / 2; x += 2)
            box("Distant crossing railing post", x, farDeck + 0.52, sideZ, 0.06, 1.04, 0.06, edge);
        for (const x of [-11, 15]) {
            box(
                "Distant crossing column",
                x,
                (farDeck - 1.35) / 2,
                sideZ,
                0.4,
                farDeck - 1.35,
                0.4,
            );
            strut(
                new THREE.Vector3(x, farDeck - 3.5, sideZ),
                new THREE.Vector3(x + (x < 0 ? 2 : -2), farDeck - 1.35, sideZ),
                0.18,
                0.18,
            );
        }
    }
    // A contact patch follows the boots on the actual top face. It cannot float
    // above a photographed slab or be buried behind a baked-in railing.
    const contactMaterial = new THREE.MeshBasicMaterial({
        color: 0x070c10,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
    });
    const contact = box(
        "Patrol contact shadow",
        0,
        deckY + 0.002,
        z,
        0.52,
        0.004,
        0.35,
        contactMaterial,
    );
    const instances: THREE.InstancedMesh[] = [];
    for (const material of [paint, edge, deckMaterial, lamp]) {
        const parts = root.children.filter(
            (child): child is THREE.Mesh =>
                child instanceof THREE.Mesh && child.material === material,
        );
        const batch = new THREE.InstancedMesh(geometry, material, parts.length);
        batch.name = "Modeled bridge / " + material.type + " structural members";
        parts.forEach((part, i) => {
            part.updateMatrix();
            batch.setMatrixAt(i, part.matrix);
            root.remove(part);
        });
        root.add(batch);
        instances.push(batch);
    }
    return {
        deckY,
        patrolZ: z,
        update(x: number) {
            contact.position.x = x;
        },
        dispose() {
            root.removeFromParent();
            instances.forEach((mesh) => mesh.dispose());
            geometry.dispose();
            [paint, edge, deckMaterial, lamp, contactMaterial].forEach((m) => m.dispose());
        },
    };
}
