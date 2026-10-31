// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
// Frame 61 lies inside the sustained folded-arm hold, excluding entry/exit.
const source=JSON.parse(gunzipSync(readFileSync(new URL('./source.bin',import.meta.url))).toString());
const frame=source.actions[0].frames[60], reference={};
for(const [side,suffix] of [['Left','.L'],['Right','.R']]) {
 reference[side]={};
 for(const [native,original] of [['Arm','upper_arm'],['ForeArm','forearm'],['Hand','hand']]) {
  const p=frame[original+suffix].p;
  reference[side][native]=[-p[0],p[1],-p[2]]; // Source faces -Z; native faces +Z.
 }
}
writeFileSync(new URL('../../../packages/squad/src/studio/crossed-arms-reference.ts',import.meta.url),
 '// Derived from Umplix / Cross Arms, CC0. Source frame 61.\n// Regenerate: node app/scripts/crossed-arms/build-reference.mjs\nexport default '+JSON.stringify(reference,null,4)+';\n');
