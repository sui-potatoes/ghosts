// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as THREE from "three";
import { createTitleForeground } from "./title-foreground";
import { createTitleBridge } from "./title-bridge";
import { createTitleOperative } from "./title-operative";
import { createTitleResident } from "./title-resident";
import { createTitleSkyline } from "./title-skyline";
import { createTitleSurfaces } from "./title-surfaces";
import { createTitleStreet } from "./title-street";
import { getSettings, subscribeSettings } from "../settings/store";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

export interface TitleCity {
    dispose(): void;
}

const REFERENCE_ASPECT = 1672 / 941;
const noiseGLSL = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.52+noise(p*2.03)*.26+noise(p*4.01)*.13+noise(p*8.03)*.065;}
`;

/** Fixed-camera set with a distant photographic skyline, modeled foreground architecture,
 * animated foliage and an armored patrol above a live reflecting street. */
export function createTitleCity(
    host: HTMLElement,
    onReady: () => void,
    onError?: () => void,
): TitleCity {
    let shaderWarmup: Promise<unknown> | undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15232c");
    scene.fog = new THREE.FogExp2("#20333e", 0.0045);
    const camera = new THREE.PerspectiveCamera(46, REFERENCE_ASPECT, 0.2, 700);
    camera.position.set(0, 1.65, 2);
    camera.lookAt(0, 1.65, -100);
    const textures = new Set<THREE.Texture>();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const geo = <T extends THREE.BufferGeometry>(g: T) => {
        geometries.add(g);
        return g;
    };
    const mat = <T extends THREE.Material>(m: T) => {
        materials.add(m);
        return m;
    };
    const tex = <T extends THREE.Texture>(t: T) => {
        textures.add(t);
        return t;
    };
    let seed = 2407;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const cylinderGeometry = geo(new THREE.CylinderGeometry(1, 1, 1, 7));
    const dark = mat(
        new THREE.MeshStandardMaterial({ color: "#11191b", roughness: 0.67, metalness: 0.5 }),
    );
    const rod = (
        a: THREE.Vector3,
        b: THREE.Vector3,
        radius: number,
        material: THREE.Material = dark,
        parent: THREE.Object3D = scene,
    ) => {
        const mesh = new THREE.Mesh(cylinderGeometry, material);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.scale.set(radius, a.distanceTo(b), radius);
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            b.clone().sub(a).normalize(),
        );
        parent.add(mesh);
        return mesh;
    };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    scene.add(new THREE.HemisphereLight(0xa4b6be, 0x080a0d, 1.5));
    const moon = new THREE.DirectionalLight(0x7da2bb, 1.8);
    moon.position.set(35, 80, -150);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    Object.assign(moon.shadow.camera, {
        left: -60,
        right: 60,
        top: 65,
        bottom: -65,
        near: 1,
        far: 240,
    });
    moon.target.position.set(0, 10, -65);
    moon.shadow.bias = -0.00015;
    moon.shadow.normalBias = 0.06;
    scene.add(moon.target, moon);
    const fill = new THREE.DirectionalLight(0xb3b6b6, 0.5);
    fill.position.set(-10, 35, 25);
    scene.add(fill);
    const surfaces = createTitleSurfaces(renderer, () => {
        if (!disposed) restart();
    });
    const groundReflection = {
        texture: { value: null as THREE.Texture | null },
        matrix: { value: new THREE.Matrix4() },
    };
    const street = createTitleStreet(scene, groundReflection, surfaces);
    const foreground = createTitleForeground(scene, surfaces);
    const skyline = createTitleSkyline(scene, () => {
        if (!disposed) restart();
    });

    // Wet asphalt reflects the actual scene (including the moving figure and
    // lights). World-space roughness breaks it into irregular, rippled puddles.
    const road = new Reflector(geo(new THREE.PlaneGeometry(34, 500)), {
        textureWidth: 768,
        textureHeight: 384,
        multisample: 0,
        clipBias: 0.003,
        shader: {
            name: "Wet asphalt",
            uniforms: {
                tDiffuse: { value: null },
                color: { value: null },
                textureMatrix: { value: new THREE.Matrix4() },
                time: { value: 0 },
                asphaltColor: { value: null },
                asphaltNormal: { value: null },
                asphaltRough: { value: null },
            },
            vertexShader: `uniform mat4 textureMatrix;varying vec4 refUv;varying vec3 world;
                void main(){world=(modelMatrix*vec4(position,1.)).xyz;refUv=textureMatrix*vec4(position,1.);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
            fragmentShader: `${noiseGLSL} uniform sampler2D tDiffuse,asphaltColor,asphaltNormal,asphaltRough;uniform float time;varying vec4 refUv;varying vec3 world;
                void main(){vec2 p=world.xz;
                    vec3 asphalt=texture2D(asphaltColor,p*.45).rgb;
                    vec3 surfaceNormal=texture2D(asphaltNormal,p*.45).rgb;
                    float rough=texture2D(asphaltRough,p*.45).r;
                    float grain=noise(p*230.);float pools=smoothstep(.40,.58,fbm(p*.5)+noise(p*10.)*.16)*(1.-rough*.18);
                    vec2 uv=refUv.xy/refUv.w;
                    uv+=(surfaceNormal.xy-.5)*.006*(1.-pools)+vec2(noise(p*25.+time*.3)-.5,sin(p.y*90.+time*1.6)*.3)*.0008;
                    vec3 reflection=max(texture2D(tDiffuse,uv).rgb-vec3(.017,.022,.026),vec3(0.));
                    float fresnel=.02+.98*pow(1.-1.685/sqrt(dot(p,p)+2.84),5.);
                    float crack=smoothstep(.035,.07,abs(sin(p.y*1.7+noise(p*2.)*.8)));
                    vec3 base=asphalt*.028*(grain*.7+.4)*crack;
                    vec3 c=base+reflection*(.025+pools*1.2)*(.68+grain*.32)*fresnel;
                    float distanceFog=1.-exp(-length(world.xz)*.003);
                    c=mix(c,vec3(.06,.095,.12),distanceFog*.27);
                    gl_FragColor=vec4(c,1.);
                    #include <colorspace_fragment>
                }`,
        },
    });
    surfaces.applyMaps("asphalt", (maps) => {
        const uniforms = (road.material as THREE.ShaderMaterial).uniforms;
        uniforms.asphaltColor.value = maps.color;
        uniforms.asphaltNormal.value = maps.normal;
        uniforms.asphaltRough.value = maps.rough;
    });
    road.rotation.x = -Math.PI / 2;
    road.position.set(-2, -0.035, -240);
    scene.add(road);
    road.updateMatrixWorld(true);
    const roadInverse = road.matrixWorld.clone().invert();
    const renderReflection = road.onBeforeRender;
    let reflectionStamp = -Infinity;
    road.onBeforeRender = function (...args) {
        const now = performance.now();
        if (now - reflectionStamp < 250) return;
        reflectionStamp = now;
        // Pavement must not sample the same target while the reflected view is
        // being drawn. Restore it for the main camera immediately afterward.
        groundReflection.texture.value = null;
        renderReflection.apply(this, args);
        groundReflection.texture.value = road.getRenderTarget().texture;
        groundReflection.matrix.value
            .copy((road.material as THREE.ShaderMaterial).uniforms.textureMatrix.value)
            .multiply(roadInverse);
    };
    materials.add(road.material as THREE.Material);
    const bridge = createTitleBridge(scene);
    // Branching trees with individual instanced leaves; each crown bends about
    // its trunk, and the leaf shader adds small independent flutter.
    const leafGeometry = geo(new THREE.PlaneGeometry(0.34, 0.15));
    const leafMaterial = mat(
        new THREE.MeshLambertMaterial({
            color: "#07100c",
            side: THREE.DoubleSide,
        }),
    );
    const leafTime = { value: 0 };
    leafMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.windTime = leafTime;
        shader.vertexShader =
            "uniform float windTime;\n" +
            shader.vertexShader.replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
        transformed.z+=sin(windTime*1.4+instanceMatrix[3].x*7.+instanceMatrix[3].z*4.)*.025;`,
            );
    };
    const trees: THREE.Group[] = [];
    const dummy = new THREE.Object3D();
    const treeSurvey = [
        [15.5, -43, 11.8, 3.1],
        [13.8, -60, 10, 2.8],
        [13.8, -80, 9, 2.5],
        [14, -105, 8, 2.3],
        [14, -133, 8.5, 2.3],
        [14, -165, 9, 2.2],
    ];
    for (let i = 0; i < treeSurvey.length; i++) {
        const [x, z, h, spread] = treeSurvey[i];
        const tree = new THREE.Group();
        tree.position.set(x, 0, z);
        scene.add(tree);
        rod(v(0, 0, 0), v(0.12, h * 0.64, 0), 0.085, dark, tree);
        const crown = new THREE.Group();
        crown.position.set(0.12, h * 0.47, 0);
        tree.add(crown);
        trees.push(crown);
        const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, i === 0 ? 6500 : 2800);
        crown.add(leaves);
        const tips: THREE.Vector3[] = [];
        for (let j = 0; j < 11; j++) {
            const angle = j * 2.4;
            const tip = v(
                Math.cos(angle) * spread * (0.6 + random() * 0.4),
                h * 0.38 + random() * 1.1,
                Math.sin(angle) * spread * 0.8,
            );
            tips.push(tip);
            rod(v(0, 0, 0), tip, 0.028, dark, crown);
            for (let k = 0; k < 3; k++) {
                const t = tip.clone().add(v((random() - 0.5) * 0.9, 0.3, (random() - 0.5) * 0.9));
                rod(tip.clone().multiplyScalar(0.65), t, 0.009, dark, crown);
            }
        }
        for (let j = 0; j < leaves.count; j++) {
            const tip = tips[j % tips.length];
            dummy.position
                .copy(tip)
                .add(
                    v(
                        (random() - 0.5) * spread * 1.1,
                        (random() - 0.5) * spread * 0.7,
                        (random() - 0.5) * spread * 1.1,
                    ),
                );
            dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
            dummy.scale.setScalar(0.7 + random());
            dummy.updateMatrix();
            leaves.setMatrixAt(j, dummy.matrix);
        }
        leaves.instanceMatrix.needsUpdate = true;
        const branches = crown.children.filter(
            (child): child is THREE.Mesh =>
                child instanceof THREE.Mesh && child.geometry === cylinderGeometry,
        );
        const branchBatch = new THREE.InstancedMesh(cylinderGeometry, dark, branches.length);
        branches.forEach((branch, j) => {
            branch.updateMatrix();
            branchBatch.setMatrixAt(j, branch.matrix);
            crown.remove(branch);
        });
        crown.add(branchBatch);
        const pit = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.2, 1.3)), dark);
        pit.position.set(x, 0.1, z);
        scene.add(pit);
    }

    const person = new THREE.Group();
    scene.add(person);
    const operative = createTitleOperative(person, () => {
        if (!disposed) restart();
    });
    // Stand close to the factory railing, on the pavement side.
    const foregroundSmoker = new THREE.Group();
    foregroundSmoker.name = "Smoke break on left pavement";
    foregroundSmoker.position.set(-11.92, 0.168, -21);
    foregroundSmoker.rotation.y = THREE.MathUtils.degToRad(54.41);
    scene.add(foregroundSmoker);
    const smoker = createTitleResident(foregroundSmoker, "smoking", () => {
        if (!disposed) restart();
    });

    const benchOperative = new THREE.Group();
    benchOperative.name = "Idle beside right streetlight bench";
    benchOperative.position.set(9.15, 0.168, -43);
    // Stand inside the curb, looking diagonally across the road.
    benchOperative.rotation.y = THREE.MathUtils.degToRad(-65);
    scene.add(benchOperative);
    const idleResident = createTitleResident(benchOperative, "idle", () => {
        if (!disposed) restart();
    });

    const cloudCanvas = document.createElement("canvas");
    cloudCanvas.width = cloudCanvas.height = 256;
    const cc = cloudCanvas.getContext("2d")!,
        cloud = cc.createImageData(256, 256);
    const grid = Array.from({ length: 32 * 32 }, () => random());
    const smooth = (n: number) => n * n * (3 - 2 * n);
    const cloudNoise = (x: number, y: number) => {
        const ix = Math.floor(x),
            iy = Math.floor(y),
            fx = smooth(x - ix),
            fy = smooth(y - iy);
        const at = (a: number, b: number) =>
            grid[(((a % 32) + 32) % 32) + (((b % 32) + 32) % 32) * 32];
        return THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx),
            THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx),
            fy,
        );
    };
    for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
            const r = Math.hypot((x - 128) / 128, (y - 128) / 128);
            const n =
                cloudNoise(x / 47, y / 47) * 0.55 +
                cloudNoise(x / 19, y / 19) * 0.3 +
                cloudNoise(x / 8, y / 8) * 0.15;
            const alpha = Math.pow(Math.max(0, 1 - r), 1.45) * Math.max(0, n - 0.22) * 330;
            cloud.data.set([204, 223, 232, alpha], (y * 256 + x) * 4);
        }
    cc.putImageData(cloud, 0, 0);
    const cloudTexture = tex(new THREE.CanvasTexture(cloudCanvas));
    // Steam drifts from forecourt drains and shop vents, with layered turbulent edges.
    const mistMaterial = mat(
        new THREE.MeshBasicMaterial({
            map: cloudTexture,
            color: 0x9db8c7,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            fog: false,
        }),
    );
    const mistGeometry = geo(new THREE.PlaneGeometry(1, 1));
    const mistBatch = new THREE.InstancedMesh(mistGeometry, mistMaterial, 60);
    mistBatch.name = "Batched steam from drains and service vents";
    mistBatch.frustumCulled = false;
    mistBatch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const mist: {
        x: number;
        y: number;
        z: number;
        width: number;
        height: number;
        phase: number;
    }[] = [];
    const vents = [
        [-24, -45],
        [-17, -66],
        [-10, -95],
        [13, -75],
        [13, -50],
        [14, -115],
    ];
    for (let i = 0; i < 60; i++) {
        const far = i >= 48,
            anchor = vents[Math.floor(i / 8) % vents.length];
        mist.push({
            x: far ? (random() - 0.5) * 18 : anchor[0] + (random() - 0.5) * 4,
            y: far ? 2.5 + random() * 3 : 0.5 + random() * 2.3,
            z: far ? -175 - random() * 55 : anchor[1] + (random() - 0.5) * 8,
            width: far ? 20 : 4 + random() * 5,
            height: far ? 9 : 2 + random() * 4,
            phase: random() * Math.PI * 2,
        });
    }
    scene.add(mistBatch);
    const rainGeometry = geo(new THREE.BufferGeometry());
    const rainPositions = new Float32Array(1400 * 6);
    for (let i = 0; i < 1400; i++) {
        const x = (random() - 0.5) * 50,
            y = random() * 30,
            z = 8 - random() * 100;
        rainPositions.set([x, y, z, x - 0.025, y + 0.2, z], i * 6);
    }
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rainMaterial = mat(
        new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: { time: { value: 0 } },
            vertexShader: `uniform float time;varying float fade;void main(){vec3 p=position;p.y=mod(p.y-time*7.,30.);vec4 mv=modelViewMatrix*vec4(p,1.);fade=.12*exp(-length(mv.xyz)*.025);gl_Position=projectionMatrix*mv;}`,
            fragmentShader: `varying float fade;void main(){gl_FragColor=vec4(.55,.72,.8,fade);}`,
        }),
    );
    const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
    rain.frustumCulled = false;
    scene.add(rain);

    let initialized = false;
    let presented = false;
    let revealUntil = Infinity;
    let disposed = false,
        visible = true,
        failed = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let motion = !reducedMotion.matches && !getSettings().display.reduceMotion;
    let elapsed = 0,
        lastTime = performance.now(),
        deadline = lastTime,
        raf = 0;
    function animate(t: number) {
        (road.material as THREE.ShaderMaterial).uniforms.time.value = t;
        rainMaterial.uniforms.time.value = t;
        leafTime.value = t;
        trees.forEach((tree, i) => {
            tree.rotation.z = Math.sin(t * 0.65 + i * 1.4) * 0.015;
            tree.rotation.x = Math.sin(t * 0.41 + i) * 0.009;
        });
        street.update(t);
        mist.forEach(({ x, y, z, width, height, phase }, i) => {
            dummy.position.set(
                x + Math.sin(t * 0.13 + phase) * 1.7,
                y + Math.sin(t * 0.09 + phase) * 0.18,
                z,
            );
            dummy.rotation.set(0, 0, Math.sin(phase) * 0.18);
            dummy.scale.set(width, height, 1);
            dummy.updateMatrix();
            mistBatch.setMatrixAt(i, dummy.matrix);
        });
        mistBatch.instanceMatrix.needsUpdate = true;
        // Cross, turn smoothly, return: never teleport at a loop boundary.
        const cycle = (t + 14) % 80;
        const outward = cycle < 40;
        const legTime = cycle % 40;
        const travel = Math.min(legTime / 36, 1);
        person.position.set(
            outward ? -12 + travel * 24 : 12 - travel * 24,
            bridge.deckY,
            bridge.patrolZ,
        );
        const turn = THREE.MathUtils.smoothstep(legTime, 36, 40);
        person.rotation.y = (outward ? Math.PI / 2 : -Math.PI / 2) - turn * Math.PI;
        const walking = 1 - THREE.MathUtils.smoothstep(legTime, 35, 36);
        operative.update(t, walking);
        smoker.update(t);
        idleResident.update(t * 0.75);
        bridge.update(person.position.x);
    }
    function render() {
        if (!initialized || disposed || failed || document.hidden || !visible) return;
        const now = performance.now();
        if (now + 0.5 < deadline) {
            raf = requestAnimationFrame(render);
            return;
        }
        // The poster is captured at time zero. Keep that exact pose until the
        // canvas has faded in, then advance only time after the reveal.
        if (motion && presented && now > revealUntil)
            elapsed += Math.min((now - Math.max(lastTime, revealUntil)) / 1000, 0.1);
        lastTime = now;
        animate(elapsed);
        renderer.render(scene, camera);
        if (!presented) {
            presented = true;
            const fadeSeconds = parseFloat(getComputedStyle(host).transitionDuration) || 0;
            revealUntil = performance.now() + fadeSeconds * 1000;
            onReady();
        }
        deadline = Math.max(deadline + 1000 / 30, now);
        if (motion) raf = requestAnimationFrame(render);
    }
    function restart() {
        cancelAnimationFrame(raf);
        lastTime = deadline = performance.now();
        render();
    }
    function resize() {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setPixelRatio(
            Math.min(devicePixelRatio, 1, Math.sqrt(900_000 / (width * height))),
        );
        renderer.setSize(width, height);
        // Match object-fit: cover / object-position: 65% center on the fallback.
        const fullWidth = Math.max(width, height * REFERENCE_ASPECT);
        const fullHeight = Math.max(height, width / REFERENCE_ASPECT);
        camera.aspect = REFERENCE_ASPECT;
        camera.setViewOffset(
            fullWidth,
            fullHeight,
            -fullWidth * 0.258 + (fullWidth - width) * 0.65,
            -fullHeight * 0.253 + (fullHeight - height) * 0.5,
            width,
            height,
        );
        camera.updateProjectionMatrix();
        reflectionStamp = -Infinity;
        renderer.shadowMap.needsUpdate = true;
        restart();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        restart();
    });
    intersection.observe(host);
    const preferenceChanged = () => {
        motion = !reducedMotion.matches && !getSettings().display.reduceMotion;
        restart();
    };
    let savedReduceMotion = getSettings().display.reduceMotion;
    const unsubscribeSettings = subscribeSettings(() => {
        const value = getSettings().display.reduceMotion;
        if (value !== savedReduceMotion) {
            savedReduceMotion = value;
            preferenceChanged();
        }
    });
    reducedMotion.addEventListener("change", preferenceChanged);
    document.addEventListener("visibilitychange", restart);
    const contextLost = (event: Event) => {
        event.preventDefault();
        failed = true;
        presented = false;
        cancelAnimationFrame(raf);
        renderer.domElement.style.visibility = "hidden";
        onError?.();
    };
    const contextRestored = () => {
        failed = false;
        renderer.domElement.style.visibility = "";
        reflectionStamp = -Infinity;
        renderer.shadowMap.needsUpdate = true;
        restart();
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
    resize();
    void Promise.all([
        surfaces.ready(),
        skyline.ready,
        operative.ready,
        smoker.ready,
        idleResident.ready,
    ])
        .then(async () => {
            if (disposed) return;
            animate(0);
            renderer.shadowMap.needsUpdate = true;
            shaderWarmup = renderer.compileAsync(scene, camera);
            await shaderWarmup;
            if (disposed) return;
            initialized = true;
            restart();
        })
        .catch((error) => {
            if (!disposed) {
                failed = true;
                console.warn("Title city initialization failed", error);
                onError?.();
            }
        });
    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            cancelAnimationFrame(raf);
            observer.disconnect();
            intersection.disconnect();
            unsubscribeSettings();
            reducedMotion.removeEventListener("change", preferenceChanged);
            document.removeEventListener("visibilitychange", restart);
            renderer.domElement.removeEventListener("webglcontextlost", contextLost);
            renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
            // Three's asynchronous compiler polls program state. Disposing its
            // materials before that poll completes causes an uncaught isReady error.
            const release = () => {
                operative.dispose();
                smoker.dispose();
                idleResident.dispose();
                bridge.dispose();
                foreground.dispose();
                skyline.dispose();
                street.dispose();
                surfaces.dispose();
                road.getRenderTarget().dispose();
                scene.traverse((object) => {
                    if (object instanceof THREE.InstancedMesh) object.dispose();
                });
                geometries.forEach((g) => g.dispose());
                materials.forEach((m) => m.dispose());
                textures.forEach((t) => t.dispose());
                moon.shadow.dispose();
                renderer.dispose();
            };
            if (shaderWarmup) void shaderWarmup.then(release, release);
            else release();
            renderer.domElement.remove();
        },
    };
}
