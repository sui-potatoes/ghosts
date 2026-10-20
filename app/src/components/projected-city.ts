// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as THREE from "three";
import imageUrl from "../assets/menu-night-1672.webp";

export type StudyMode = "scene" | "source" | "geometry";
export interface CityStudy {
    setMode(mode: StudyMode): void;
    setMotion(enabled: boolean): void;
    reset(): void;
    dispose(): void;
}

const aspect = 1672 / 941;
const halfHeight = Math.tan(THREE.MathUtils.degToRad(45 / 2));
const halfWidth = halfHeight * aspect;

/** Reconstruct the visible street and facade planes around the image's vanishing point.
 * Hidden surfaces are intentionally not invented; this is a constrained-camera study.
 */
function distanceAt(u: number, v: number) {
    const horizon = 0.753;
    const vanishingX = 0.758;
    let distance = 115;
    // The street is a plane in camera space. Its sloped horizon accounts for
    // the reference camera looking upward from street level.
    if (v > horizon) distance = Math.min(distance, 2.1 / ((v - horizon) * 2 * halfHeight));
    const leftBoundary = v < 0.37 ? 0.568 : 0.568 + (v - 0.37) * 0.32;
    if (u < leftBoundary && v < 0.86 - u * 0.15) {
        distance = Math.min(distance, 6.8 / (2 * halfWidth * Math.max(0.018, vanishingX - u)));
    }
    const rightBoundary = 0.943 - v * 0.12;
    if (u > rightBoundary && v < 0.81) {
        distance = Math.min(distance, 4.2 / (2 * halfWidth * Math.max(0.018, u - vanishingX)));
    }
    // Towers further down the street have their own depth, not the near walls'.
    if (u > 0.58 && u < 0.68 && v > 0.12 && v < 0.7) distance = Math.min(distance, 65);
    if (u > 0.69 && u < 0.75 && v > 0.02 && v < 0.68) distance = Math.min(distance, 89);
    if (u > 0.785 && u < 0.85 && v > 0.03 && v < 0.7) distance = Math.min(distance, 74);
    // Service crossing visible above the end of the road.
    if (u > 0.65 && u < 0.865 && v > 0.552 && v < 0.592) distance = Math.min(distance, 45);
    return distance;
}

function imagePoint(u: number, v: number, distance: number) {
    return new THREE.Vector3(
        (u - 0.5) * 2 * halfWidth * distance,
        (0.5 - v) * 2 * halfHeight * distance,
        -distance,
    );
}

export function createProjectedCity(host: HTMLElement, onReady: () => void): CityStudy {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x080d12);
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 180);
    const geometry = new THREE.PlaneGeometry(1, 1, 224, 126);
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
        const u = uv.getX(i),
            v = 1 - uv.getY(i);
        const p = imagePoint(u, v, distanceAt(u, v));
        positions.setXYZ(i, p.x, p.y, p.z);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const texture = new THREE.TextureLoader().load(imageUrl, () => {
        if (disposed) {
            texture.dispose();
            return;
        }
        loaded = true;
        onReady();
        restart();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const surfaceMaterial = new THREE.ShaderMaterial({
        uniforms: { image: { value: texture }, time: { value: 0 }, weather: { value: 1 } },
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 imageUv;
            void main(){imageUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `
            uniform sampler2D image;
            uniform float time;
            uniform float weather;
            varying vec2 imageUv;
            void main(){
                vec2 p=imageUv;
                float ground=1.0-smoothstep(.07,.235,p.y);
                float light=smoothstep(.35,.7,p.x);
                float ripple=sin(p.y*1100.+time*2.4+sin(p.x*47.)*3.);
                p.x+=ripple*.00042*ground*light*weather;
                vec4 color=texture2D(image,p);
                gl_FragColor=color;
                #include <colorspace_fragment>
            }`,
    });
    const surface = new THREE.Mesh(geometry, surfaceMaterial);
    scene.add(surface);
    const wireMaterial = new THREE.MeshBasicMaterial({
        color: 0x7fe3ef,
        wireframe: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
    });
    const wire = new THREE.Mesh(geometry, wireMaterial);
    wire.visible = false;
    scene.add(wire);

    // A few soft, genuinely spatial mist wisps sit along the road, rather than
    // horizontal sheets which would cut hard bands through foreground buildings.
    const mistCanvas = document.createElement("canvas");
    mistCanvas.width = mistCanvas.height = 128;
    const context = mistCanvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(170,191,208,.3)");
    gradient.addColorStop(0.5, "rgba(151,175,193,.12)");
    gradient.addColorStop(1, "rgba(151,175,193,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const mistTexture = new THREE.CanvasTexture(mistCanvas);
    mistTexture.colorSpace = THREE.SRGBColorSpace;
    const mistMaterial = new THREE.SpriteMaterial({
        map: mistTexture,
        transparent: true,
        opacity: 0.19,
        depthWrite: false,
    });
    const mist: THREE.Sprite[] = [];
    for (let i = 0; i < 5; i++) {
        const sprite = new THREE.Sprite(mistMaterial);
        const v = 0.772 + i * 0.009;
        sprite.position.copy(
            imagePoint(0.73 + i * 0.027, v, distanceAt(0.73 + i * 0.027, v) - 0.8),
        );
        sprite.userData.originX = sprite.position.x;
        sprite.scale.set(7 + i, 0.7 + i * 0.12, 1);
        scene.add(sprite);
        mist.push(sprite);
    }

    let seed = 91;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const rainGeometry = new THREE.BufferGeometry();
    const rainPositions = new Float32Array(400 * 6);
    const phases = new Float32Array(400 * 2);
    const ends = new Float32Array(400 * 2);
    for (let i = 0; i < 400; i++) {
        const p = imagePoint(random(), random(), 4 + random() * 45);
        rainPositions.set([p.x, p.y, p.z, p.x, p.y, p.z], i * 6);
        phases[i * 2] = phases[i * 2 + 1] = random();
        ends[i * 2 + 1] = 1;
    }
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    rainGeometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
    rainGeometry.setAttribute("end", new THREE.BufferAttribute(ends, 1));
    const rainMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { time: { value: 0 } },
        vertexShader: `uniform float time;attribute float phase;attribute float end;varying float opacity;
            void main(){vec3 p=position;p.y=mod(p.y-time*5.+phase*30.+100.,30.)-15.;
            p.y+=end*.12;p.x-=end*.018;
            vec4 mv=modelViewMatrix*vec4(p,1.);opacity=.11*exp(-length(mv.xyz)*.018);
            gl_Position=projectionMatrix*mv;}`,
        fragmentShader: `varying float opacity;void main(){gl_FragColor=vec4(.62,.75,.86,opacity);}`,
    });
    const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
    rain.frustumCulled = false;
    scene.add(rain);

    let disposed = false,
        loaded = false,
        visible = true;
    let mode: StudyMode = "scene";
    let motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let elapsed = 0,
        lastTime = performance.now(),
        deadline = lastTime,
        raf = 0;
    let dragging = false,
        pointerX = 0,
        pointerY = 0;
    const target = new THREE.Vector2();
    const offset = new THREE.Vector2();
    const render = () => {
        if (disposed || !loaded || document.hidden || !visible || mode === "source") return;
        const now = performance.now();
        if (now + 0.5 < deadline) {
            raf = requestAnimationFrame(render);
            return;
        }
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        if (motion) elapsed += dt;
        offset.lerp(target, 1 - Math.exp(-dt * 8));
        const drift = motion ? Math.sin(elapsed * 0.16) * 0.025 : 0;
        camera.position.set(offset.x + drift, offset.y, 0);
        camera.lookAt(offset.x * 0.65, offset.y * 0.65, -45);
        surfaceMaterial.uniforms.time.value = elapsed;
        rainMaterial.uniforms.time.value = elapsed;
        mist.forEach((sprite, i) => {
            sprite.position.x = sprite.userData.originX + Math.sin(elapsed * 0.12 + i) * 0.25;
        });
        renderer.render(scene, camera);
        deadline += 1000 / 30;
        if (now - deadline >= 1000 / 30) deadline = now + 1000 / 30;
        if (motion || dragging || offset.distanceTo(target) > 0.0001)
            raf = requestAnimationFrame(render);
    };
    const restart = () => {
        cancelAnimationFrame(raf);
        lastTime = deadline = performance.now();
        render();
    };
    const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setPixelRatio(
            Math.min(devicePixelRatio, 1.5, Math.sqrt(1_800_000 / (width * height))),
        );
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.fov = THREE.MathUtils.radToDeg(
            2 * Math.atan(halfHeight * Math.min(1, aspect / camera.aspect)),
        );
        camera.updateProjectionMatrix();
        restart();
    };
    const down = (event: PointerEvent) => {
        dragging = true;
        pointerX = event.clientX;
        pointerY = event.clientY;
        host.setPointerCapture(event.pointerId);
        restart();
    };
    const move = (event: PointerEvent) => {
        if (!dragging) return;
        target.x = THREE.MathUtils.clamp(
            target.x - (event.clientX - pointerX) * 0.0007,
            -0.12,
            0.12,
        );
        target.y = THREE.MathUtils.clamp(
            target.y + (event.clientY - pointerY) * 0.0005,
            -0.065,
            0.065,
        );
        pointerX = event.clientX;
        pointerY = event.clientY;
    };
    const up = () => {
        dragging = false;
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        restart();
    });
    intersectionObserver.observe(host);
    document.addEventListener("visibilitychange", restart);
    resize();
    return {
        setMode(value) {
            mode = value;
            wire.visible = mode === "geometry";
            rain.visible = mode === "scene";
            mist.forEach((sprite) => {
                sprite.visible = mode === "scene";
            });
            surfaceMaterial.uniforms.weather.value = mode === "scene" ? 1 : 0;
            restart();
        },
        setMotion(value) {
            motion = value;
            restart();
        },
        reset() {
            target.set(0, 0);
            offset.set(0, 0);
            elapsed = 0;
            restart();
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(raf);
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
            document.removeEventListener("visibilitychange", restart);
            host.removeEventListener("pointerdown", down);
            host.removeEventListener("pointermove", move);
            host.removeEventListener("pointerup", up);
            host.removeEventListener("pointercancel", up);
            geometry.dispose();
            surfaceMaterial.dispose();
            wireMaterial.dispose();
            texture.dispose();
            rainGeometry.dispose();
            rainMaterial.dispose();
            mistMaterial.dispose();
            mistTexture.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}
