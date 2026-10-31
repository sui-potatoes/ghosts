// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as THREE from "three";
import type { TitleSurfaces } from "./title-surfaces";

export interface GroundReflection {
    texture: { value: THREE.Texture | null };
    matrix: { value: THREE.Matrix4 };
}

/** Reusable scene-owned primitives and physically lit architectural materials.
 * These textures contain only generated surface wear, never the reference image. */
export function createModelKit(
    scene: THREE.Scene,
    name: string,
    reflection?: GroundReflection,
    surfaces?: TitleSurfaces,
) {
    const root = new THREE.Group();
    root.name = name;
    scene.add(root);
    const textures: THREE.Texture[] = [];
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const instances: THREE.InstancedMesh[] = [];
    const moving: {
        parent: THREE.Object3D;
        local: THREE.Matrix4;
        batch: THREE.InstancedMesh;
        index: number;
    }[] = [];
    const matrix = new THREE.Matrix4();
    let seed = 934713;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    function texture(brick = false) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        const data = ctx.createImageData(256, 256);
        for (let i = 0; i < data.data.length; i += 4) {
            const g = 155 + random() * 92;
            data.data.set([g, g, g, 255], i);
        }
        ctx.putImageData(data, 0, 0);
        ctx.scale(0.5, 0.5);
        if (brick) {
            for (let row = 0; row < 16; row++)
                for (let col = -1; col < 8; col++) {
                    const x = col * 64 + (row % 2) * 32;
                    ctx.fillStyle = `rgba(20,28,31,${0.08 + random() * 0.1})`;
                    ctx.fillRect(x + 2, row * 32 + 2, 60, 28);
                    ctx.fillStyle = "rgba(20,24,26,.45)";
                    ctx.fillRect(x, row * 32, 64, 2);
                    ctx.fillRect(x, row * 32, 2, 32);
                    ctx.fillStyle = "rgba(245,246,240,.12)";
                    ctx.fillRect(x + 2, row * 32 + 2, 60, 1);
                }
        }
        for (let i = 0; i < 45; i++) {
            const x = random() * 512,
                y = random() * 512,
                r = 18 + random() * 90;
            const stain = ctx.createRadialGradient(x, y, 0, x, y, r);
            stain.addColorStop(0, `rgba(25,30,29,${0.15 + random() * 0.3})`);
            stain.addColorStop(1, "rgba(25,30,29,0)");
            ctx.fillStyle = stain;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        for (let i = 0; i < 230; i++) {
            const x = random() * 512,
                y = random() * 512,
                w = 0.3 + random() * 16,
                h = 8 + random() * 290;
            const gradient = ctx.createLinearGradient(x, y, x, y + h);
            gradient.addColorStop(0, `rgba(24,32,35,${random() * 0.35})`);
            gradient.addColorStop(1, "rgba(24,32,35,0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, w, h);
        }
        for (let i = 0; i < 45; i++) {
            ctx.strokeStyle = `rgba(18,25,29,${random() * 0.18})`;
            ctx.lineWidth = 0.4;
            let x = random() * 512,
                y = random() * 512;
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let j = 0; j < 5; j++) {
                x += (random() - 0.5) * 10;
                y += random() * 9;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        const map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.anisotropy = 8;
        textures.push(map);
        return map;
    }
    const grain = texture(),
        bricks = texture(true);
    function material(color: number, roughness = 0.8, metalness = 0.05, brick = false) {
        const m = new THREE.MeshStandardMaterial({
            color,
            roughness,
            metalness,
            map: brick ? bricks : grain,
        });
        // World-space surface coordinates keep brick size and rain streaks
        // consistent across walls, pilasters, window reveals and instances.
        m.onBeforeCompile = (shader) => {
            shader.uniforms.weatherMap = { value: grain };
            shader.vertexShader =
                "varying vec3 architectureWorld;\n" +
                shader.vertexShader.replace(
                    "#include <project_vertex>",
                    `vec4 architecturePosition=vec4(transformed,1.);
                #ifdef USE_INSTANCING
                architecturePosition=instanceMatrix*architecturePosition;
                #endif
                architectureWorld=(modelMatrix*architecturePosition).xyz;
                #include <project_vertex>`,
                );
            shader.fragmentShader =
                "varying vec3 architectureWorld; uniform sampler2D weatherMap;\n" +
                shader.fragmentShader
                    .replace(
                        "#include <map_fragment>",
                        `vec3 aw=abs(normalize(cross(dFdx(architectureWorld),dFdy(architectureWorld))));
                aw=pow(aw,vec3(8.));aw/=max(dot(aw,vec3(1.)),.0001);
                vec3 surfaceGrain=texture2D(map,architectureWorld.yz*.25).rgb*aw.x+texture2D(map,architectureWorld.xz*.25).rgb*aw.y+texture2D(map,architectureWorld.xy*.25).rgb*aw.z;
                vec3 broad=texture2D(map,architectureWorld.yz*vec2(.013,.073)).rgb*aw.x+texture2D(map,architectureWorld.xz*.035).rgb*aw.y+texture2D(map,architectureWorld.xy*vec2(.073,.013)).rgb*aw.z;
                vec3 wear=texture2D(weatherMap,architectureWorld.zy*vec2(.075,.035)).rgb*aw.x+texture2D(weatherMap,architectureWorld.xz*.12).rgb*aw.y+texture2D(weatherMap,architectureWorld.xy*vec2(.075,.035)).rgb*aw.z;
                float damp=smoothstep(.16,.65,broad.r)*wear.r;
                float jointsX=smoothstep(.012,.028,abs(fract(architectureWorld.x/2.4)-.5));
                float jointsY=smoothstep(.007,.02,abs(fract(architectureWorld.y/1.15)-.5));
                float jointsZ=smoothstep(.012,.028,abs(fract(architectureWorld.z/2.4)-.5));
                float seams=mix(jointsY*mix(jointsX,jointsZ,aw.x),1.,aw.y);
                diffuseColor.rgb*=(.55+surfaceGrain*.45)*(.55+broad*.85)*mix(.5,1.,seams)*mix(vec3(.45,.49,.5),vec3(1.35,1.3,1.25),wear);
                float surfaceHeight=surfaceGrain.r*.003+seams*.004;`,
                    )
                    .replace(
                        "#include <roughnessmap_fragment>",
                        `#include <roughnessmap_fragment>
                    roughnessFactor*=mix(.44,1.,damp);
                    #ifdef USE_ROUGHNESSMAP
                    roughnessFactor=roughness*(texture2D(roughnessMap,architectureWorld.yz*.25).r*aw.x+texture2D(roughnessMap,architectureWorld.xz*.25).r*aw.y+texture2D(roughnessMap,architectureWorld.xy*.25).r*aw.z)*mix(.55,1.,damp);
                    roughnessFactor=max(roughness*.65,roughnessFactor);
                    #endif`,
                    )
                    .replace(
                        "#include <normal_fragment_maps>",
                        `
                    #ifdef USE_NORMALMAP
                    vec3 wn=normalize((vec4(normal,0.)*viewMatrix).xyz);
                    vec3 nx=texture2D(normalMap,architectureWorld.yz*.25).xyz*2.-1.;
                    vec3 ny=texture2D(normalMap,architectureWorld.xz*.25).xyz*2.-1.;
                    vec3 nz=texture2D(normalMap,architectureWorld.xy*.25).xyz*2.-1.;
                    nx.xy*=normalScale;ny.xy*=normalScale;nz.xy*=normalScale;
                    vec3 mapped=normalize(vec3(nx.z*sign(wn.x),nx.x,nx.y)*aw.x+vec3(ny.x,ny.z*sign(wn.y),ny.y)*aw.y+vec3(nz.x,nz.y,nz.z*sign(wn.z))*aw.z);
                    normal=normalize((viewMatrix*vec4(mapped,0.)).xyz);
                    #endif
                    vec3 surfaceDx=dFdx(-vViewPosition),surfaceDy=dFdy(-vViewPosition);
                    vec3 r1=cross(surfaceDy,normal),r2=cross(normal,surfaceDx);
                    float det=dot(surfaceDx,r1);
                    vec3 grad=sign(det)*(dFdx(surfaceHeight)*r1+dFdy(surfaceHeight)*r2);
                    normal=normalize(abs(det)*normal-grad);`,
                    );
        };
        if (reflection && roughness < 0.5 && metalness < 0.3) {
            const surface = m.onBeforeCompile;
            m.onBeforeCompile = (shader, renderer) => {
                surface.call(m, shader, renderer);
                shader.uniforms.groundReflection = reflection.texture;
                shader.uniforms.groundReflectionMatrix = reflection.matrix;
                shader.fragmentShader =
                    "uniform sampler2D groundReflection; uniform mat4 groundReflectionMatrix;\n" +
                    shader.fragmentShader;
                shader.fragmentShader = shader.fragmentShader.replace(
                    "#include <opaque_fragment>",
                    `
                    vec4 reflectionUv=groundReflectionMatrix*vec4(architectureWorld,1.);
                    vec2 pavementUv=reflectionUv.xy/reflectionUv.w;
                    pavementUv+=vec2(surfaceGrain.r-.5,surfaceGrain.g-.5)*.0015;
                    vec3 reflected=texture2D(groundReflection,pavementUv).rgb;
                    float puddle=smoothstep(.22,.57,broad.r)*.72;
                    outgoingLight=mix(outgoingLight,reflected,puddle);
                    #include <opaque_fragment>`,
                );
            };
            m.customProgramCacheKey = () => "wet-pavement-v1";
        }
        if (metalness < 0.3) surfaces?.bind(m, brick ? "brick" : "concrete");
        materials.push(m);
        return m;
    }
    const palette = {
        concrete: material(0x69757c, 0.88),
        darkConcrete: material(0x46535a, 0.9),
        paleConcrete: material(0x596168, 0.84),
        brick: material(0x514d46, 0.9, 0.02, true),
        blueBrick: material(0x555b5d, 0.85, 0.04, true),
        steel: material(0x26353c, 0.6, 0.55),
        edge: material(0x59636a, 0.53, 0.6),
        rust: material(0x493d32, 0.9, 0.25),
        pavement: material(0x343d40, 0.26, 0.22),
        curb: material(0x54636b, 0.65, 0.03),
    };
    function glow(color: number, intensity: number) {
        const m = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: intensity,
            roughness: 0.35,
            metalness: 0.12,
        });
        materials.push(m);
        return m;
    }
    function windowGlass(color: number, intensity: number, variant: number) {
        const m = glow(color, intensity);
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const c = canvas.getContext("2d")!;
        const light = c.createLinearGradient(0, 0, 0, 256);
        light.addColorStop(0, "#a8a69a");
        light.addColorStop(0.18, "#fff9e1");
        light.addColorStop(0.48, "#c6bfac");
        light.addColorStop(1, "#5c5b55");
        c.fillStyle = light;
        c.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 5; i++) {
            const x = random() * 240,
                w = 10 + random() * 46;
            c.fillStyle = `rgba(30,32,31,${0.18 + random() * 0.28})`;
            c.fillRect(x, 160 + random() * 55, w, 100);
        }
        c.fillStyle = "#fffde7";
        c.fillRect(28, 26, 150, 6);
        c.fillStyle = "rgba(12,17,19,.3)";
        c.fillRect(0, 70, 256, 5);
        if (variant % 2 === 0)
            for (let i = 0; i < 45; i++) {
                c.fillStyle = `rgba(30,32,29,${0.08 + random() * 0.1})`;
                c.fillRect(i * 6, 0, 2, 256);
            }
        for (let i = 0; i < 1200; i++) {
            c.fillStyle = `rgba(12,18,20,${random() * 0.18})`;
            c.fillRect(random() * 256, random() * 256, 0.4 + random() * 2, 1 + random() * 15);
        }
        const glassMap = new THREE.CanvasTexture(canvas);
        glassMap.colorSpace = THREE.SRGBColorSpace;
        textures.push(glassMap);
        m.map = glassMap;
        m.emissiveMap = glassMap;
        return m;
    }
    const glazing = {
        warm: [
            windowGlass(0xe6b67b, 2.3, 0),
            windowGlass(0xe5af70, 1.8, 1),
            windowGlass(0xf2d3a3, 2.1, 2),
        ],
        cool: [
            windowGlass(0x9fc6cf, 0.8, 3),
            windowGlass(0x657e88, 0.45, 4),
            windowGlass(0xb1d0d4, 0.9, 5),
        ],
        dark: glow(0x16232c, 0.08),
    };
    const cube = new THREE.BoxGeometry(1, 1, 1),
        cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
    geometries.push(cube, cylinder);
    function box(
        name: string,
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        mat: THREE.Material = palette.concrete,
        parent: THREE.Object3D = root,
    ) {
        const m = new THREE.Mesh(cube, mat);
        m.name = name;
        m.position.set(x, y, z);
        m.scale.set(w, h, d);
        m.castShadow = m.receiveShadow = true;
        parent.add(m);
        return m;
    }
    function beam(
        name: string,
        a: THREE.Vector3,
        b: THREE.Vector3,
        w: number,
        d: number,
        mat: THREE.Material = palette.steel,
        parent: THREE.Object3D = root,
    ) {
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const m = box(name, mid.x, mid.y, mid.z, w, a.distanceTo(b), d, mat, parent);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        return m;
    }
    function pipe(
        name: string,
        a: THREE.Vector3,
        b: THREE.Vector3,
        r: number,
        mat: THREE.Material = palette.steel,
        parent: THREE.Object3D = root,
    ) {
        const m = new THREE.Mesh(cylinder, mat);
        m.name = name;
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.scale.set(r, a.distanceTo(b), r);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        m.castShadow = m.receiveShadow = true;
        parent.add(m);
        return m;
    }
    function frame(name: string, origin: THREE.Vector3, tangent: THREE.Vector3) {
        const g = new THREE.Group();
        g.name = name;
        g.position.copy(origin);
        const u = tangent.clone().normalize(),
            up = new THREE.Vector3(0, 1, 0),
            normal = u.clone().cross(up);
        g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, up, normal));
        root.add(g);
        return g;
    }
    function finish() {
        root.updateMatrixWorld(true);
        const groups = new Map<
            string,
            { geometry: THREE.BufferGeometry; material: THREE.Material; meshes: THREE.Mesh[] }
        >();
        root.traverse((o) => {
            if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
            let dynamic = false;
            for (let parent = o.parent; parent && parent !== root; parent = parent.parent)
                dynamic ||= !!parent.userData.animated;
            o.userData.animated = dynamic;
            const key = o.geometry.uuid + o.material.uuid + (dynamic ? "moving" : "static");
            let group = groups.get(key);
            if (!group) {
                group = { geometry: o.geometry, material: o.material, meshes: [] };
                groups.set(key, group);
            }
            group.meshes.push(o);
        });
        for (const { geometry, material, meshes } of groups.values()) {
            const batch = new THREE.InstancedMesh(geometry, material, meshes.length);
            batch.name = name + " / structural parts";
            batch.matrixAutoUpdate = false;
            if (meshes[0].userData.animated) {
                batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                // Moving fittings can leave the bounds of their initial pose.
                batch.frustumCulled = false;
            }
            meshes.forEach((mesh, i) => {
                batch.setMatrixAt(i, mesh.matrixWorld);
                if (mesh.userData.animated && mesh.parent)
                    moving.push({
                        parent: mesh.parent,
                        local: mesh.matrix.clone(),
                        batch,
                        index: i,
                    });
                mesh.removeFromParent();
            });
            batch.castShadow = batch.receiveShadow = true;
            root.add(batch);
            instances.push(batch);
        }
        // Batching leaves empty construction frames behind. Keep only frames
        // that still own lights/sprites or drive animated instances.
        const animatedParents = new Set(moving.map((part) => part.parent));
        function prune(group: THREE.Object3D) {
            for (const child of [...group.children]) {
                prune(child);
                if (
                    child instanceof THREE.Group &&
                    !child.children.length &&
                    !animatedParents.has(child)
                )
                    child.removeFromParent();
            }
        }
        prune(root);
    }
    return {
        root,
        palette,
        glazing,
        random,
        box,
        beam,
        pipe,
        frame,
        finish,
        glow,
        update() {
            root.updateMatrixWorld(true);
            for (const part of moving) {
                part.batch.setMatrixAt(
                    part.index,
                    matrix.multiplyMatrices(part.parent.matrixWorld, part.local),
                );
                part.batch.instanceMatrix.needsUpdate = true;
            }
        },
        dispose() {
            root.removeFromParent();
            instances.forEach((i) => i.dispose());
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
            textures.forEach((t) => t.dispose());
        },
    };
}
