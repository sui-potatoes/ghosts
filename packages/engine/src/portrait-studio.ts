import * as T from "three";
import { portraitFrame, portraitIconPose } from "./portrait-frame";
import { soldier, disposePortrait } from "./humans";
import type { Unit } from "./game";
/** A still-render studio borrowing the battlefield renderer. No RAF or extra WebGL context. */
export function createPortraitStudio(renderer: T.WebGLRenderer, unit: Unit) {
  const rig = soldier(unit),
    scene = new T.Scene();
  rig.gun.visible = false;
  rig.mixer.stopAllAction();
  const action = rig.mixer.clipAction(rig.clips.get("idle_weight_shift")!);
  action.play();
  action.time = 0.1;
  rig.mixer.update(0);
  rig.root.updateMatrixWorld(true);
  rig.model.traverse((o) => {
    if (o instanceof T.SkinnedMesh) o.skeleton.update();
  });
  scene.background = new T.Color("#22272c");
  scene.add(rig.root, new T.HemisphereLight(0xffffff, 0x48434a, 1.4));
  const key = new T.DirectionalLight(0xffedda, 1.8);
  key.position.set(-2, 3, -3);
  scene.add(key);
  const fill = new T.DirectionalLight(0xe1eaff, 0.8);
  fill.position.set(2, 1, -2);
  scene.add(fill);
  const rim = new T.DirectionalLight(0xd8b481, 1.2);
  rim.position.set(1, 2, 2);
  scene.add(rim);
  let eyes: T.Mesh | undefined, head: T.Mesh | undefined;
  rig.model.traverse((o) => {
    if (o instanceof T.Mesh && o.name === "Blackline_Face")
      head = o;
    if (o instanceof T.Mesh && o.name === "MPFB_Eyes") eyes = o;
  });
  if (!eyes || !head) throw new Error("Character face is missing");
  const frame = portraitFrame(head, eyes);
  const camera = new T.PerspectiveCamera(28, 1, 0.01, 10);
  return {
    render() {
      const pose = portraitIconPose(frame);
      const width = 320, height = 320;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.position.copy(pose.position);
      camera.up.copy(pose.up);
      camera.lookAt(pose.target);
      const size = renderer.getSize(new T.Vector2()),
        ratio = renderer.getPixelRatio();
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/jpeg", 0.94);
      } finally {
        renderer.setPixelRatio(ratio);
        renderer.setSize(size.x, size.y, false);
        renderer.shadowMap.needsUpdate = true;
      }
    },
    dispose() {
      disposePortrait(rig);
    },
  };
}
