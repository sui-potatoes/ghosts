import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * The one way to make a GLTFLoader: it can read meshopt-compressed models
 * (the production build compresses every .glb) and plain ones (dev serves
 * the raw sources); the decoder only runs for files that declare
 * EXT_meshopt_compression.
 */
export function createGLTFLoader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
