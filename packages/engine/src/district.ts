// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { cityBlocks } from "./city-blocks";
import { demoAsset } from "./demo-assets";
import * as T from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import {
  STREET,
  districtBuildings,
  footprint,
  surfaceHeight,
} from "./district-plan";
import { storefrontFaces } from "./storefronts";
import type { StreetKind } from "./environment";
import type { SceneryKit } from "./scene/maps";
import { addPuddles, createPuddleExposure } from "./scene/puddles";
import { LOOK } from "./scene/look";
import { paintBox } from "./road-paint";
import { litPanes } from "./scene/street-air";

const textures: Record<string, T.Texture> = {};
export async function loadDistrictTextures(renderer: T.WebGLRenderer) {
  if (textures['asphalt-rough']) return;
  const loader = new KTX2Loader().setTranscoderPath(demoAsset('basis/')).setWorkerLimit(1).detectSupport(renderer);
  try {
    await Promise.all(['asphalt', 'concrete', 'brick'].flatMap(name => ['color', 'normal', 'rough'].map(async type => {
      const t = await loader.loadAsync(demoAsset(`textures/district/${name}-${type}.ktx2`));
      t.colorSpace = type === 'color' ? T.SRGBColorSpace : T.NoColorSpace;
      t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 2;
      textures[`${name}-${type}`] = t;
    })));
  } finally { loader.dispose(); }
}
const rgb = new T.Color();
/** A fixed 0..1 value per index: which windows are lit never changes between loads. */
function pick(i: number) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** A seeded third of the windows are lit: mostly warm rooms, a few cool screens, some curtained. */
function litPane(i: number) {
  const r = pick(i),
    strength = 0.3 + 0.7 * pick(i * 7 + 3);
  return r < 0.07 ? 1 + strength : r < 0.33 ? strength * strength : 0;
}
function material(color: number, roughness = 0.8, metalness = 0.05) {
  return new T.MeshStandardMaterial({ color, roughness, metalness });
}
function pbr(name: string, color: number, roughness: number) {
  return new T.MeshStandardMaterial({ color, map: textures[`${name}-color`], normalMap: textures[`${name}-normal`],
    roughnessMap: textures[`${name}-rough`], roughness, normalScale: new T.Vector2(0.45, 0.45) });
}
/** The street's PBR maps, for anything else (the level editor's floors) that
 * reuses them; null until `loadDistrictTextures` resolves. */
export function districtMaps(name: 'asphalt' | 'concrete') {
  return { map: textures[`${name}-color`] ?? null, normalMap: textures[`${name}-normal`] ?? null,
    roughnessMap: textures[`${name}-rough`] ?? null };
}
/** Metric UVs keep the same texture density on a small curb and a large facade. */
/** `pane` lights a window pane at night (scene/street-air.ts `litPanes`): 0 dark, (0,1] warm, (1,2] cool. */
function block(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  m: T.Material,
  tint?: number,
  pane = 0,
) {
  const geo = new T.BoxGeometry(w, h, d);
  const pos = geo.attributes.position, normal = geo.attributes.normal, uv = geo.attributes.uv;
  if ((m as T.MeshStandardMaterial).map && !(m as T.MeshStandardMaterial).userData.atlas) {
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i));
      uv.setXY(i, (nx > 0.5 ? pos.getZ(i) : pos.getX(i)) / 2, (ny > 0.5 ? pos.getZ(i) : pos.getY(i)) / 2);
    }
  }
  if ((m as T.MeshStandardMaterial).vertexColors) {
    rgb.setHex(tint ?? 0xffffff);
    // Alpha is 1 plus the pane's light, so a fading building's opacity is untouched.
    const colors = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      rgb.toArray(colors, i * 4);
      colors[i * 4 + 3] = 1 + pane;
    }
    geo.setAttribute("color", new T.BufferAttribute(colors, 4));
  }
  const mesh = new T.Mesh(geo, m); mesh.position.set(x, y, z);
  mesh.castShadow = h > 0.3; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function signAtlas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const ctx = c.getContext('2d')!;
  const rows = [
    ['#f1ede1', '#17794f', '7–ELEVEN', 'OPEN 24 HOURS  /  FOOD • COFFEE • DAILY GOODS'],
    ['#12578d', '#ffffff', 'LAWSON', 'STATION  /  OPEN 24 HOURS'],
    ['#b8b1a0', '#2b4548', 'COIN LAUNDRY', 'WASH & DRY   •   24 HOURS'],
    ['#313a3d', '#d3a04f', 'MORI MOTOR WORKS', 'REPAIRS  /  TYRES  /  SERVICE'],
    ['#f1dfb7', '#673b2c', 'FRESH COFFEE', 'HOT MEALS  •  EVERY DAY'],
    ['#e4c16f', '#33373a', 'ROADWORKS', 'LANE CLOSED  /  UTILITY MAINTENANCE'],
    ['#223b47', '#c3d2d2', 'NORTH DOCK', 'MERCER ST.   ↔   STATION ROAD'],
    ['#ded5bd', '#34494e', 'ENTRANCE  /  24H', 'AUTOMATIC DOORS  •  WELCOME'],
  ];
  rows.forEach(([bg, fg, title, sub], i) => {
    const y = i * 128; ctx.fillStyle = bg; ctx.fillRect(0, y, 1024, 128);
    if (i === 0) { ['#ec8a2c', '#cb3432', '#238454'].forEach((v,n)=>{ctx.fillStyle=v;ctx.fillRect(0,y+5+n*8,1024,7);}); }
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.font = 'bold 59px Arial'; ctx.fillText(title, 512, y + 87);
    ctx.font = '17px Arial'; ctx.fillText(sub, 512, y + 115);
  });
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 2;
  const m = new T.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.7 });
  m.userData.atlas = true; return m;
}
function label(g: T.Object3D, m: T.Material, row: number, x: number, y: number, z: number, w: number, h: number, rotation = 0) {
  const geo = new T.PlaneGeometry(w, h), uv = geo.attributes.uv;
  for (let i=0; i<uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / 8);
  const mesh = new T.Mesh(geo,m); mesh.position.set(x,y,z); mesh.rotation.y=rotation; g.add(mesh); return mesh;
}
/** A decorative clone of a catalog prop (scene/prop-assets.ts): no health or
 * physics, and `batchStaticScenery` merges it per shared material. */
function placeProp(kit:SceneryKit,kind:StreetKind,seed:number,parent:T.Object3D,x:number,y:number,z:number) {
  const prop=kit.props.get({id:`decor-${kind}`,kind,x,z,yaw:0,seed}).intact.clone();
  prop.position.set(x,y,z);parent.add(prop);return prop;
}
export function buildDistrict(scene: T.Scene, kit: SceneryKit) {
  const asphalt = pbr("asphalt", 0x737c88, 0.72),
    concrete = pbr("concrete", 0x9c9fa3, 0.9),
    paving = pavementMaterial(),
    brick = pbr("brick", 0x8e7770, 0.9);
  const steel = material(0x30383f, 0.52, 0.65),
    black = material(0x151c23),
    paint = material(0xb8b5a2),
    lane = Object.assign(material(0xb8b5a2), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    curb = material(0x85888b),
    glass = material(0x1b303b, 0.22, 0.65);
  const colored = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
  });
  const glow = new T.MeshStandardMaterial({
    color: 0xe7e5cb,
    emissive: 0xffe4ad,
    emissiveIntensity: 1.5,
  });
  const windows = litPanes(
    new T.MeshStandardMaterial({
      color: 0x81959b,
      emissive: 0xa2bec5,
      emissiveIntensity: 0.15,
      roughness: 0.32,
      metalness: 0.35,
      vertexColors: true,
    }),
  );
  const atlas = signAtlas();
  atlas.emissiveIntensity = LOOK.signs.near;
  for (const m of [glow, windows, atlas])
    m.userData.nightGlow = m.emissiveIntensity;
  // Road paint is a film on the asphalt (road-paint.ts), never a raised slab.
  const film = paintBox();
  const mark = (x:number,z:number,w:number,d:number) => block(scene,x,film.y,z,w,film.height,d,lane);
  const occluders: { group: T.Group; bounds: T.Box3 }[] = [];
  block(scene, 0, -0.11, 0, 90, 0.2, 90, asphalt);
  // Four city blocks: streets stay connected through the whole visible district.
  for(const sx of [-1,1]) for(const sz of [-1,1]) {
    const w=STREET.reach-STREET.avenueHalf,d=STREET.reach-STREET.crossHalf;
    const steps = [0, .25, .5, .75, 1, 1.225, 1.5, 1.75, 2, 2.5, 3, 4, 6, 12, 24];
    const xs=[...steps,w], zs=[...steps,d];
    const geo=new T.PlaneGeometry(w,d,xs.length-1,zs.length-1); geo.rotateX(-Math.PI/2);
    const p=geo.attributes.position,uv=geo.attributes.uv;
    for(let i=0;i<p.count;i++) {
      const col=i%xs.length,row=Math.floor(i/xs.length);
      const x=sx>0?STREET.avenueHalf+xs[col]:-STREET.avenueHalf-xs[xs.length-1-col], z=sz>0?STREET.crossHalf+zs[row]:-STREET.crossHalf-zs[zs.length-1-row];
      p.setXYZ(i,x,surfaceHeight(x,z),z);uv.setXY(i,x/2,z/2);
    }
    geo.computeVertexNormals();const mesh=new T.Mesh(geo,paving);mesh.receiveShadow=true;scene.add(mesh);
    // Segmented curb stones leave the lowered crossing ramps open.
    for(let n=0;n<36;n++) {
      const z=STREET.crossHalf+.5+n*1.1;
      if(Math.abs(z-STREET.cuts.avenue)>.95) block(scene,sx*2.72,.075,sz*z,.16,.15,1.06,curb);
      const x=STREET.avenueHalf+.5+n*1.1;
      if(Math.abs(x-STREET.cuts.cross)>.95) block(scene,sx*x,.075,sz*2.045,1.06,.15,.16,curb);
    }
  }
  // Kerb-side drainage and continuous edge lines, stopping at the junction.
  for(const s of [-1,1]) for(const sign of [-1,1]) {
    mark(s*2.36,sign*23.5,.055,36);
    mark(sign*23.7,s*1.72,36,.055);
    for(let n=0;n<6;n++) {
      const z=sign*(6+n*5);block(scene,s*2.56,.02,z,.22,.025,.65,steel);
      for(let j=0;j<5;j++)block(scene,s*2.56,.037,z-.25+j*.12,.18,.01,.035,black);
    }
  }
  for(let n=-40;n<41;n+=3) if(Math.abs(n)>5) {
    mark(0,n,.07,1.5);
    mark(n,0,1.5,.07);
  }
  // Four short zebra crossings connect actual sidewalk ramps, never whole blocks.
  for(const s of [-1,1]) {
    for(let x=-2.3;x<2.6;x+=.63)mark(x,s*STREET.cuts.avenue,.34,1.25);
    for(let z=-1.7;z<1.9;z+=.62)mark(s*STREET.cuts.cross,z,1.25,.34);
    mark(s*1.35,s*4.35,2.25,.13);
    mark(s*5.0,-s*1.0,.13,1.65);
    for(const r of [-1,1]) {
      block(scene,r*3.1,.165,s*STREET.cuts.avenue,.35,.025,1.15,colored,0xb29b62);
      block(scene,s*STREET.cuts.cross,.165,r*2.42,1.15,.025,.35,colored,0xb29b62);
    }
  }
  // Modest sidewalk joint lines rather than a second tactical checkerboard.
  const seams:number[]=[];
  for(const sx of [-1,1])for(const sz of [-1,1])for(let n=5;n<30;n+=1.35) {
    seams.push(sx*2.82,.166,sz*n,sx*4.65,.166,sz*n);
    seams.push(sx*n,.166,sz*2.15,sx*n,.166,sz*3.8);
  }
  scene.add(new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(seams,3)),new T.LineBasicMaterial({color:0x41484d,transparent:true,opacity:.28})));

  // Two glazed street faces share the same materials and sign atlas.
  function shopfront(parent:T.Group,width:number,door:number,index:number,fasciaShift=0,fasciaExtra=0) {
    const halfDoor=.72;
    for(const [a,b] of [[-width/2+.08,door-halfDoor],[door+halfDoor,width/2-.08]]) {
      block(parent,(a+b)/2,.32,.025,b-a,.04,.04,steel);
      block(parent,(a+b)/2,1.12,.025,b-a,.055,.025,colored,index?0x3b729c:0x438769);
    }
    for(const x of [-width/2+.08,door-halfDoor,door+halfDoor,width/2-.08])block(parent,x,1.4,.025,.055,2.7,.07,steel);
    block(parent,0,2.66,.025,width,.06,.07,steel);
    // Clearly framed sliding doors, distinct from the shop-window bays.
    for(const side of [-1,1]) {
      const x=door+side*.355;
      for(const y of [.14,1.1,2.4])block(parent,x,y,.065,.69,.04,.035,paint);
      block(parent,door+side*.018,1.27,.065,.025,2.28,.035,paint);
      block(parent,door+side*.1,1.12,.09,.035,.3,.035,steel);
    }
    block(parent,door,2.47,.07,1.52,.16,.14,steel);
    label(parent,atlas,7,door,2.47,.145,1.42,.16);
    block(parent,door,.017,.32,1.45,.025,.56,black);
    block(parent,fasciaShift,2.83,.26,width+.16+fasciaExtra,.46,.7,colored,index?0x235d8b:0xe6e2cb);
    label(parent,atlas,index,fasciaShift,2.84,.62,width-.12+fasciaExtra,.53);
    if(index===0)for(const [n,color] of [0xe98631,0xc53d2e,0x218559].entries())block(parent,fasciaShift,3.09+n*.055,.63,width+fasciaExtra,.05,.03,colored,color);
  }
  for(const [index,b] of districtBuildings.entries()) {
    const f=footprint(b),g=new T.Group();g.position.set(f.x,.16,f.z);
    // Both north stores face the junction; south businesses face back toward it.
    if(index>1)g.rotation.y=Math.PI;
    scene.add(g);const w=f.w-.1,d=f.d-.1,h=b.h,front=d/2;
    block(g,0,.06,0,w,.12,d,curb);
    block(g,0,h/2,-d/2+.1,w,h,.2,index%2? concrete:brick);
    const streetSide=index===0?1:-1;
    for(const s of [-1,1]) {
      // Remove the avenue-facing ground-floor wall; retain the structural storey above.
      const corner=index<2 && s===streetSide;
      block(g,s*(w/2-.1),corner?(h+3.15)/2:h/2,0,.2,corner?h-3.15:h,d,index%2?concrete:brick);
    }
    // Upper storeys have a proper facade; the ground floor is genuinely recessed.
    block(g, 0, 3.05, 0, w, 0.25, d, concrete);
    block(
      g,
      0,
      (h + 3.15) / 2,
      front - 0.12,
      w,
      h - 3.15,
      0.24,
      index % 2 ? concrete : brick,
    );
    block(g, 0, h, 0, w + 0.12, 0.18, d + 0.12, steel);
    for (const s of [-1, 1])
      block(g, s * (w / 2 - 0.08), h + 0.18, 0, 0.16, 0.3, d, curb);
    block(g, 0, h + 0.18, -front, w, 0.3, 0.16, curb);
    block(g, -w * 0.22, h + 0.35, -0.4, 1.0, 0.55, 1.4, steel);
    for (let n = 0; n < 7; n++)
      block(
        g,
        -w * 0.22 - 0.38 + n * 0.125,
        h + 0.64,
        -0.4,
        0.045,
        0.025,
        1.15,
        black,
      );
    block(g, w * 0.3, h + 0.3, -0.9, 0.3, 0.6, 0.3, steel);
    for (let x = -w / 2 + 0.65; x < w / 2 - 0.3; x += 1.35) {
      block(g, x, 3.95, front + 0.01, 0.83, 1.05, 0.04, black);
      block(
        g,
        x,
        3.95,
        front + 0.04,
        0.73,
        0.94,
        0.03,
        windows,
        0xffffff,
        litPane(index * 97 + Math.round(x * 10)),
      );
      block(g, x, 3.95, front + 0.07, 0.035, 0.95, 0.04, steel);
      block(g, x, 3.4, front + 0.08, 1, 0.06, 0.18, curb);
    }
    // The frontage is framed glazing with a central accessible door.
    if(index<2) {
      block(g,0,1.5,-front+.25,w-.4,2.65,.12,colored,index?0xbcc6c4:0xc4bca7);
      block(g,0,.08,0,w-.4,.035,d-.3,colored,0xa6a69b);
      // Cooler bank, contrasting doors and shelves visible through the open front.
      for(let n=0;n<4;n++) {
        const x=-w/2+.65+n*.77;
        block(g,x,1.15,-front+.55,.68,2.0,.48,steel);
        block(g,x,1.18,-front+.81,.55,1.65,.025,glass);
        for(let j=0;j<4;j++) {
          block(g,x,.5+j*.36,-front+.85,.55,.04,.15,glow);
          for(let k=0;k<4;k++)block(g,x-.2+k*.13,.61+j*.36,-front+.88,.08,.18,.09,colored,[0xa16b42,0x8caa9e,0xc0b781,0x873d34][(k+j)%4]);
        }
        block(g,x+.22,1.2,-front+.9,.025,.4,.035,paint);
      }
      for(const z of [-.5,.5]) {
        block(g,0,.75,z,w*.32,1.05,.45,colored,0x8c8978);
        for(let shelf=0;shelf<3;shelf++)for(let n=0;n<10;n++)block(g,-w*.145+n*w*.032,.4+shelf*.32,z+.25,.16,.22,.15,colored,[0x9e7046,0x567e7e,0x9eae97,0x9b4d3a][(n+shelf)%4]);
      }
      block(g,-streetSide*w*.3,.62,-.35,w*.2,1.1,.9,colored,0x999989);
      block(g,-streetSide*w*.3,1.21,-.35,w*.23,.08,1,steel);
      block(g,-streetSide*w*.3,1.4,-.35,.32,.28,.18,black);
      block(g,0,2.85,0,w-.4,.04,d-.4,glow);
      const [frontFace, avenueFace] = storefrontFaces(b).map((face) => {
        const group = new T.Group();
        group.position.set(face.x, 0, face.z); group.rotation.y = face.yaw; g.add(group);
        shopfront(group, face.width, face.door, index, face.shift, face.extra);
        return group;
      });
      // Upper windows wrap the corner as well, rather than leaving a blank side wall.
      for (let u = -d / 2 + 0.7; u < d / 2 - 0.4; u += 1.3) {
        block(avenueFace, u, 3.95, 0.025, 0.8, 1.05, 0.04, black);
        block(
          avenueFace,
          u,
          3.95,
          0.055,
          0.7,
          0.94,
          0.025,
          windows,
          0xffffff,
          litPane(index * 193 + Math.round(u * 10) + 50),
        );
        block(avenueFace, u, 3.4, 0.08, 0.94, 0.06, 0.18, curb);
      }
      label(frontFace,atlas,4,-streetSide*w*.3,1.5,.04,.65,.75);
      // The hanging advert stays supported when the glazing below it shatters.
      for (const offset of [-.25,.25])
        block(frontFace,-streetSide*w*.3+offset,2.2675,.04,.012,.785,.012,steel);
      // Recessed recycling bins stay within the non-walkable storefront footprint.
      for(let n=0;n<2;n++) {block(g,-streetSide*(w*.35+n*.32),.38,front-.3,.28,.65,.35,colored,0x83918a);block(g,-streetSide*(w*.35+n*.32),.69,front-.3,.24,.025,.28,black);}
    } else {
      label(g,atlas,index,0,2.74,front+.14,w-.2,.56);
      block(g,0,1.35,front,w-.4,2.3,.08,index===2?glass:steel);
      if(index===2) {
        for(let n=0;n<3;n++) {
          const x=-w/2+.7+n*.95;block(g,x,.8,front-.25,.85,1.2,.6,paint);
          const disc=new T.Mesh(new T.CylinderGeometry(.28,.28,.05,16),glass);disc.rotation.x=Math.PI/2;disc.position.set(x,.85,front+.06);g.add(disc);
        }
        for(const x of [-w/2+.15,0,w/2-.15])block(g,x,1.3,front+.12,.06,2.4,.08,steel);
      } else for(let n=0;n<14;n++)block(g,0,.25+n*.15,front+.06,w-.45,.025,.04,black);
    }
    // Rain pipes and wall-mounted compressors give each frontage depth.
    block(g,index<2?-streetSide*(w/2-.08):-w/2+.08,h/2,front+.12,.065,h,.065,steel);
    block(g,index<2?-streetSide*(w/2+.15):w/2+.15,2.1,0,.3,.6,.85,curb);
    occluders.push({group:g,bounds:new T.Box3(new T.Vector3(f.minX-.4,0,f.minZ-.4),new T.Vector3(f.maxX+.4,h+.8,f.maxZ+.4))});
  }
  const urbanAtlas = neighbourhoodAtlas();
  const urban = litPanes(
    new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      emissive: 0x141414,
    }),
  );
  // The far street's shop signs are unlit paint by day and lit boxes at night (scene/street-air.ts).
  scene.userData.nightSigns = [urbanAtlas];
  for (const [i, b] of cityBlocks().entries()) {
    const g = new T.Group();
    g.position.set(b.x, 0.16, b.z);
    g.rotation.y = b.rotation;
    scene.add(g);
    urbanBuilding(
      g,
      b.w,
      b.d,
      b.h,
      b.style,
      b.shop,
      urban,
      urbanAtlas,
      i,
      b.recess ?? 0,
    );
    const width =
      Math.abs(Math.cos(b.rotation)) * b.w +
      Math.abs(Math.sin(b.rotation)) * b.d;
    const depth =
      Math.abs(Math.cos(b.rotation)) * b.d +
      Math.abs(Math.sin(b.rotation)) * b.w;
    occluders.push({
      group: g,
      bounds: new T.Box3(
        new T.Vector3(b.x - width / 2 - 0.2, 0, b.z - depth / 2 - 0.2),
        new T.Vector3(b.x + width / 2 + 0.2, b.h + 1.2, b.z + depth / 2 + 0.2),
      ),
    });
  }
  streetLife(scene,urban,kit);
  // Two mission-area lamps cast cached static shadows. Distant fixtures remain inexpensive.
  for (const x of [-3.05, 3.05])
    for (const z of [-11, 9, 23, -25, x < 0 ? 5.7 : -5.7]) {
      block(scene, x, 2.1, z, 0.07, 4.2, 0.07, steel);
      block(scene, x - Math.sign(x) * 0.38, 4.18, z, 0.85, 0.08, 0.09, steel);
      const lampX = x - Math.sign(x) * 0.65;
      block(scene, lampX, 4.12, z, 0.45, 0.04, 0.18, glow);
      // Lamp heads, for the light volumes in the air under them (scene/street-air.ts).
      (scene.userData.lamps ??= []).push([
        lampX,
        4.08,
        z,
        x < 0 ? 0xffd3a0 : 0xdce9ff,
      ]);
      if (Math.abs(z) === 5.7) {
        const lamp = new T.SpotLight(
          x < 0 ? 0xffd3a0 : 0xdce9ff,
          95,
          13,
          Math.PI * 0.35,
          0.65,
          2,
        );
        lamp.position.set(lampX, 4.06, z);
        lamp.target.position.set(lampX, 0, z - Math.sign(z) * 1.3);
        lamp.userData.nightIntensity = lamp.intensity;
        lamp.castShadow = true;
        lamp.shadow.mapSize.set(512, 512);
        lamp.shadow.camera.near = 0.2;
        lamp.shadow.camera.far = 13;
        lamp.shadow.normalBias = 0.025;
        lamp.shadow.bias = -0.00015;
        scene.add(lamp, lamp.target);
      }
    }
  // A bulkhead lamp on the laundry's side wall: the south-west footway is in the building's shadow.
  block(scene, -8.71, 2.5, 4.4, 0.09, 0.2, 0.36, glow);
  block(scene, -8.7, 2.63, 4.4, 0.16, 0.05, 0.44, steel);
  const alley = new T.PointLight(
    LOOK.alley.color,
    LOOK.alley.intensity,
    LOOK.alley.reach,
    2,
  );
  alley.userData.nightIntensity = alley.intensity;
  alley.position.set(-8.3, 2.4, 4.4);
  scene.add(alley);
  // Shop light spilling onto the footway. Kept a metre off the storefront glass: closer, each one burns a white star into the door panes.
  for (const [x, z, c] of [
    [-8, -3.7, 0xffd8a3],
    [8, -3.7, 0xb5dbfa],
  ]) {
    const light = new T.PointLight(c, 8, 6, 2);
    light.userData.nightIntensity = light.intensity;
    light.position.set(x, 2.3, z);
    scene.add(light);
  }
  // Crossing signals and street-name signs at the curb, out of tile centres.
  for(const s of [-1,1]) {
    const x=s*2.95,z=-s*2.26;
    block(scene,x,1.6,z,.055,3.2,.055,steel);
    block(scene,x,2.7,z,.22,.6,.21,black);
    block(scene,x,2.86,z+s*.115,.09,.09,.015,colored,0xb74f3e);
    label(scene,atlas,6,x,3.25,z+s*.05,1.2,.3,s>0?Math.PI:0);
  }
  // Parallel-parked delivery van and compact car beyond the combat boundary.
  for(const [x,z,shade] of [[1.65,-15,0xb0b8b5],[-1.65,14,0x625657]]) {
    const g=new T.Group();g.position.set(x,0,z);scene.add(g);
    block(g,0,.58,0,1.6,.72,3.8,colored,shade);block(g,0,1.12,.25,1.48,.6,2.5,colored,shade);
    block(g,0,1.16,-1.04,1.3,.4,.035,glass);
    for(const s of [-1,1]) {block(g,s*.755,1.16,-.58,.025,.38,.75,glass);block(g,s*.56,.62,-1.92,.3,.16,.025,paint);
      for(const z of [-1.2,1.2]) {const tire=new T.Mesh(new T.CylinderGeometry(.32,.32,.18,12),black);tire.rotation.z=Math.PI/2;tire.position.set(s*.78,.33,z);g.add(tire);}}
    block(scene,x,.015,z,2.05,.012,4.5,asphalt);
    for(const s of [-1,1])block(scene,x+s*1.05,.025,z,.06,.012,4.7,paint);
  }
  // Flush temporary steel plates explain why utility work occupies the crossing.
  block(scene,0,.035,-2.7,1.65,.04,2.3,steel);
  for(const side of [-1,1])for(let n=0;n<5;n++) block(scene,side*.78,.062,-3.65+n*.45,.06,.012,.07,colored,0xa88e50);
  block(scene,0,.06,-2.7,.025,.012,2.2,black);
  // Temporary cordon props surround the tactical barricades.
  for(const s of [-1,1]) {
    // The sign and barricade carry the closure; just two spaced cones guide each approach.
    label(scene,atlas,5,s*1.5,.9,s*11.2,1.7,.65,s>0?0:Math.PI);
    for(const x of [s*1.5-.65,s*1.5+.65])block(scene,x,.45,s*11.2,.06,.9,.06,steel);
    block(scene,s*1.4,.73,s*10.8,2.2,.25,.08,colored,0xdccca7);
    for(let j=0;j<7;j++)block(scene,s*1.4-.9+j*.3,.73,s*10.85,.13,.23,.025,colored,0xb46032).rotation.z=-.45;
    for(const x of [s*1.4-.85,s*1.4+.85]) {block(scene,x,.35,s*10.8,.07,.7,.07,steel);block(scene,x,.045,s*10.8,.18,.09,.6,steel);}
    for(let n=0;n<2;n++)placeProp(kit,'cone',0,scene,s*(.45+n*1.05),0,s*(12.1+n*1.5));
  }
  // Roofs keep their ground dry even when the camera fades the buildings away.
  const exposure = createPuddleExposure(occluders.map(({ group }) => group), STREET.reach);
  for (const ground of [asphalt, paving]) addPuddles(ground, exposure);
  paving.addEventListener('dispose', () => exposure.texture.dispose());
  return occluders;
}

/** Deliberately low-contrast, jointed stone slabs; no moss/cloudy albedo on footpaths. */
export function pavementMaterial() {
  const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d')!;
  ctx.fillStyle='#51555c';ctx.fillRect(0,0,512,512);
  for(let y=0;y<8;y++)for(let x=0;x<4;x++) {
    const shade=111+((x*7+y*3)%9);ctx.fillStyle=`rgb(${shade},${shade+2},${shade+5})`;
    ctx.fillRect(x*128+1,y*64+1,126,62);
    ctx.fillStyle='rgba(220,225,231,.07)';ctx.fillRect(x*128+2,y*64+2,124,1);
  }
  const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=2;
  return new T.MeshStandardMaterial({map,color:0xd4d6dc,roughness:.88});
}
function neighbourhoodAtlas() {
  const c=document.createElement('canvas');c.width=1024;c.height=1024;const ctx=c.getContext('2d')!;
  const rows=[
    ['#903e2d','#ffdf9d','らーめん  一番','ICHIBAN  /  RAMEN & GYOZA'],
    ['#183c56','#e8e4cc','青葉書店','AOBA BOOKS  /  SINCE 1978'],
    ['#b4a589','#3e3831','喫茶  月光','COFFEE • JAZZ • UNTIL LATE'],
    ['#19394a','#afd9de','東口駅   →','EAST STATION  /  METRO  240m'],
    ['#dddad0','#a52f2e','薬  くすり','PHARMACY  /  DAILY CARE'],
    ['#223e32','#dfd99a','居酒屋  森','MORI  /  GRILL • SAKE • SMALL PLATES'],
    ['#8a382d','#eddfc7','コインパーキング','P  24H   /   20 MIN  ¥200'],
    ['#244c78','#d4e8ef','DRINKS   つめたい','COLD DRINKS  /  ¥120'],
  ];
  rows.forEach(([bg,fg,title,sub],i)=>{
    const y=i*128;ctx.fillStyle=bg;ctx.fillRect(0,y,1024,128);ctx.strokeStyle=fg;ctx.lineWidth=2;ctx.strokeRect(7,y+7,1010,114);
    ctx.fillStyle=fg;ctx.textAlign='center';ctx.font='bold 59px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';ctx.fillText(title,512,y+80);ctx.font='18px Arial';ctx.fillText(sub,512,y+111);
  });
  const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=2;
  const m=new T.MeshBasicMaterial({map:t,color:0xc5bdaa});m.userData.atlas=true;return m;
}
function urbanBuilding(
  g: T.Group,
  w: number,
  d: number,
  h: number,
  style: number,
  shop: boolean,
  m: T.Material,
  signs: T.Material,
  index: number,
  recess = 0,
) {
  const colors = [
    0x777879, 0x887b6b, 0x656e72, 0x8e8c83, 0x745b51, 0x53616b, 0x969588,
    0x655e5e,
  ];
  const wall = colors[style],
    facade = d / 2,
    front = facade - recess;
  const b = (
    x: number,
    y: number,
    z: number,
    bw: number,
    bh: number,
    bd: number,
    c: number,
    pane = 0,
  ) => block(g, x, y, z, bw, bh, bd, m, c, pane);
  if (recess > 0) {
    b(0, (h + 2.8) / 2, 0, w, h - 2.8, d, wall);
    b(0, 1.4, -recess / 2, w, 2.8, d - recess, wall);
    b(0, 0.025, 0, w + 0.04, 0.05, d + 0.04, 0x45494c);
  } else {
    b(0, h / 2, 0, w, h, d, wall);
    b(0, 0.2, 0, w + 0.04, 0.4, d + 0.04, 0x45494c);
  }
  b(0, h + 0.08, 0, w + 0.16, 0.16, d + 0.16, 0x3b444b);
  b(0, h + 0.17, 0, w - 0.32, 0.04, d - 0.32, 0x252d32);
  const floors = Math.max(2, Math.round(h / 2.9)),
    floorH = h / floors,
    cols = Math.max(2, Math.floor(w / 1.4));
  for (let f = 1; f < floors; f++) {
    const y = f * floorH + floorH * 0.5;
    for (let n = 0; n < cols; n++) {
      const x = -w / 2 + ((n + 0.5) * w) / cols,
        lit = (f * 13 + n * 7 + index * 3) % 9;
      const pane = lit < 3 ? [0xbab18c, 0xc9bea0, 0x94a6ae][lit] : 0x28343d;
      b(x, y, facade + 0.035, (w / cols) * 0.65, 1.25, 0.07, 0x333d43);
      // The pale panes are the lit ones: warm rooms, the bluish ones screens, some dimmed by curtains.
      const light =
        lit < 3
          ? (lit === 2 ? 1 : 0) + 0.3 + 0.7 * pick(index * 131 + f * 17 + n)
          : 0;
      b(x, y, facade + 0.08, (w / cols) * 0.57, 1.12, 0.025, pane, light);
      b(x, y, facade + 0.1, 0.04, 1.15, 0.03, 0x53595b);
      // Side windows and occasional glowing stairwells.
      if (n < Math.floor(d / 1.7))
        for (const s of [-1, 1])
          b(
            s * (w / 2 + 0.02),
            y,
            -d / 2 + 0.85 + n * 1.6,
            0.04,
            1.15,
            0.7,
            lit === 1 ? 0xa9a390 : 0x26333b,
            lit === 1 ? 0.6 : 0,
          );
    }
    if (style % 3 === 0) {
      b(0, y - 0.7, facade + 0.25, w - 0.35, 0.12, 0.65, 0x5c6264);
      b(0, y - 0.25, facade + 0.55, w - 0.4, 0.07, 0.045, 0x9c9c91);
      for (let x = -w / 2 + 0.3; x < w / 2; x += 0.55)
        b(x, y - 0.47, facade + 0.55, 0.025, 0.48, 0.025, 0x727a7d);
    } else b(0, f * floorH, facade + 0.04, w, 0.06, 0.11, 0x444c50);
    if (f % 2 === 1) {
      b(w * 0.3, y - 0.5, facade + 0.23, 0.68, 0.38, 0.36, 0x9a9d98);
      b(w * 0.3, y - 0.5, facade + 0.42, 0.54, 0.26, 0.02, 0x525c61);
    }
    if(style%3===0) {
      b(0,y-.7,facade+.25,w-.35,.12,.65,0x5c6264);
      b(0,y-.25,facade+.55,w-.4,.07,.045,0x9c9c91);
      for(let x=-w/2+.3;x<w/2;x+=.55)b(x,y-.47,facade+.55,.025,.48,.025,0x727a7d);
    } else b(0,f*floorH,facade+.04,w,.06,.11,0x444c50);
    if(f%2===1) {b(w*.3,y-.5,facade+.23,.68,.38,.36,0x9a9d98);b(w*.3,y-.5,facade+.42,.54,.26,.02,0x525c61);}
  }
  b(-w/2+.13,h/2,facade+.1,.055,h,.055,0x4c555c);
  // Roof plant and asymmetric lift housing break the skyline silhouettes.
  b(-w*.23,h+.4,-d*.2,1.1,.7,1.5,0x737b7b);
  if(index%3===0)b(w*.23,h+.7,-d*.25,w*.28,1.4,d*.3,0x646d70);
  if(!shop)return;
  // Distinct small businesses, entrances and upper-floor signs packed onto the street.
  b(0,1.15,front+.04,w-.35,2.1,.08,0x223038);
  for(let n=0;n<3;n++) {
    const x=-w*.33+n*w*.32;
    b(x,1.2,front+.1,w*.29,1.85,.035,index%3===0?0x99856a:0x6e7d81);
    b(x-w*.15,1.2,front+.16,.055,2.1,.07,0x3c4142);
  }
  b(w*.25,1.1,front+.2,.035,.4,.06,0xb0b5b2);
  b(0,2.48,front+.3,w+.12,.53,.65,style%2?0x303e43:0x6c3229);
  label(g,signs,style,0,2.48,front+.64,w-.1,.54);
  // Fabric awnings, with scalloped valance, shade the little shop windows.
  if(style%2===0) {
    const awning=b(0,2.14,front+.5,w-.1,.07,.95,style===0?0x823e32:0x415d50);awning.rotation.x=.12;
    b(0,2.02,front+.96,w-.1,.18,.04,style===0?0x893e31:0x455e50);
  }
  if(style===0||style===5)for(const x of [-w*.32,0,w*.32]) {
    b(x,1.86,front+.44,.36,.55,.32,0xc57c4d);b(x,2.15,front+.44,.22,.04,.22,0x343735);
  }
  if(style===1)for(let n=0;n<3;n++) {b(-w*.3+n*.7,.35,front+.3,.58,.6,.45,0x776957);b(-w*.3+n*.7,.67,front+.3,.55,.04,.42,0xb0a58b);}
  // Vertical blade sign faces down the street. Shared atlas, no added lights.
  b(w/2+.12,4.3,front-.4,.12,2.35,.64,0xc4c0ac);
  const blade=label(g,signs,(style+2)%8,w/2+.19,4.3,front-.4,2.2,.56,Math.PI/2);blade.rotateZ(Math.PI/2);
  if(index%3===1) {label(g,signs,(style+4)%8,0,h-.7,front+.08,w*.85,.7);}
}
function streetLife(scene:T.Scene,m:T.Material,kit:SceneryKit) {
  const b=(g:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,c:number)=>block(g,x,y,z,w,h,d,m,c);
  // Vending machines sit at blank shop walls beyond the combat boundary.
  for(const [x,z,rot] of [[-16.25,-4.9,0],[14.15,-4.9,0]]) {
    const g=new T.Group();g.position.set(x,.16,z);g.rotation.y=rot;scene.add(g);
    // One short-range, unshadowed light per pair, shared by both displays.
    const spill=new T.PointLight(0xc8eeec,5,3.2,2);
    spill.position.set(.46,1.15,.78);spill.userData.dayOffIntensity=spill.intensity;g.add(spill);
    for(let n=0;n<2;n++)placeProp(kit,'vending',n?0:1,g,n*.92,0,0);
  }
  // Bikes are inside the southern shops’ 2.3m-deep parking recesses, beyond the through sidewalk.
  for(const [x,z,rot] of [[-15.2,6.3,Math.PI],[15.2,6.3,Math.PI]]) {
    const g=new T.Group();g.position.set(x,.16,z);g.rotation.y=rot;scene.add(g);
    // Bay markings make the intended parking area explicit.
    for(const x of [-1.65,-.25])b(g,x,.065,2.1,.035,.015,1.9,0xb3b6b1);
    for(const z of [1.15,3.05])b(g,-.95,.065,z,1.4,.015,.035,0xb3b6b1);
    for(let n=0;n<2;n++)placeProp(kit,'bicycle',n?0:1,g,-1.25+n*.55,.05,2.1).rotation.z=.08;
  }
  // Utility poles and restrained sagging bundles enclose the street vertically.
  for (const sx of [-1, 1]) {
    for (const z of [-11.6, 12, 26])
      placeProp(kit, "utility-pole", 0, scene, sx * 3.3, 0, z);
    for (const [z1, z2] of [
      [-11.6, 12],
      [12, 26],
    ])
      for (let k = 0; k < 3; k++) {
        const x = sx * 3.3 - 0.4 + k * 0.4;
        const curve = new T.QuadraticBezierCurve3(
          new T.Vector3(x, 5.72, z1),
          new T.Vector3(x, 4.8, (z1 + z2) / 2),
          new T.Vector3(x, 5.72, z2),
        );
        const geo = new T.TubeGeometry(curve, 12, 0.012, 3, false),
          colors = new Float32Array(geo.attributes.position.count * 4).fill(
            0.065,
          );
        for (let i = 3; i < colors.length; i += 4) colors[i] = 1;
        geo.setAttribute("color", new T.BufferAttribute(colors, 4));
        scene.add(new T.Mesh(geo, m));
      }
  }
  // A busy district temporarily cordoned off: deliveries and business infrastructure remain.
  for(const [x,z] of [[-13.8,-8.8],[13.6,8.9],[4.4,-17]])placeProp(kit,'pallet',0,scene,x,.16,z);
  // Yellow tactile guidance follows the footway and stops before each crossing.
  for(const s of [-1,1])for(const t of [-1,1]) {
    b(scene,s*3.55,.17,t*23,.28,.025,36,0xa6945f);
    b(scene,t*23,.17,s*2.85,36,.025,.28,0xa6945f);
  }
}
