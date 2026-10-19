import * as T from "three";
import { tattooGeometry } from "./tattoo-placement.js";
function tattooCanvas(s) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d");
    x.strokeStyle = x.fillStyle = s.tattooColor;
    x.lineWidth = 9;
    x.lineCap = "round";
    x.lineJoin = "round";
    if (s.tattoo === "bars") {
        for (let i = 0; i < 4; i++) x.fillRect(62 + i * 34, 80 + i * 8, 11, 105 - i * 16);
    }
    if (s.tattoo === "orbit") {
        x.beginPath();
        x.ellipse(128, 128, 62, 36, -0.7, 0, Math.PI * 2);
        x.stroke();
        x.beginPath();
        x.arc(128, 128, 10, 0, Math.PI * 2);
        x.fill();
    }
    if (s.tattoo === "chevrons") {
        for (let y of [80, 130]) {
            x.beginPath();
            x.moveTo(80, y);
            x.lineTo(128, y + 30);
            x.lineTo(176, y);
            x.stroke();
        }
    }
    if (s.tattoo === "cross") {
        x.fillRect(118, 65, 18, 125);
        x.fillRect(78, 102, 100, 18);
    }
    if (s.tattoo === "serial") {
        x.font = "bold 96px monospace";
        x.textAlign = "center";
        x.fillText("07", 128, 160);
    }
    if (s.tattoo === "tear") {
        x.beginPath();
        x.moveTo(128, 55);
        x.bezierCurveTo(100, 100, 55, 160, 128, 190);
        x.bezierCurveTo(200, 160, 156, 100, 128, 55);
        x.fill();
    }
    if (s.tattoo === "diamond") {
        x.beginPath();
        x.moveTo(128, 55);
        x.lineTo(180, 128);
        x.lineTo(128, 200);
        x.lineTo(76, 128);
        x.closePath();
        x.stroke();
    }
    if (s.tattoo === "dots") {
        for (let y of [80, 128, 176]) {
            x.beginPath();
            x.arc(128, y, 10, 0, Math.PI * 2);
            x.fill();
        }
    }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
}
export function nativeTattoo(s, geometry, top, eyes) {
    if (s.tattoo === "none") return null;
    const g = tattooGeometry(s, geometry, eyes);
    if (!g) return null;
    return {
        key: "tattoo",
        g,
        material: new T.MeshStandardMaterial({
            map: tattooCanvas(s),
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            roughness: 0.9,
            opacity: s.tattooOpacity,
        }),
        base: g.attributes.position.array.slice(),
        top,
    };
}
