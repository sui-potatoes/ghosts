import { test } from "node:test";
import assert from "node:assert/strict";
import { deploymentLooks, applyDeploymentNames } from "./squad-bridge.ts";
import { initialSquad } from "@ghosts/squad/model";
import { initialUnits } from "./game.ts";
import { escapeHTML } from "./html.ts";

test("fresh playtest showcases all current NYX tiers on Ghosts identities", () => {
  const units=initialUnits(), looks=deploymentLooks(null,units);
  assert.deepEqual(units.filter(u=>!u.enemy).map(u=>looks.get(u.id)!.armorId),['nyx-mid','nyx','nyx-heavy','nyx']);
  applyDeploymentNames(units,looks);
  assert.equal(units[1].full,'Jonas Keller');
  assert.equal(looks.get('g')!.appearance.sex,'male');
});
test("saved equipment, colors, appearance and renamed recruits survive reset mapping", () => {
  const squad=initialSquad();
  squad.recruits[0].equipment.armor='nyx-heavy';
  squad.recruits[0].armorColors.primary='#aabbcc';
  squad.recruits[0].callsign='NOVA';
  squad.recruits[0].appearance.values.noseWidth=.6;
  squad.recruits[1].equipment.armor=null;
  const raw=JSON.stringify(squad),units=initialUnits(),looks=deploymentLooks(squad.recruits,units);
  assert.equal(looks.get('v')!.armorId,'nyx-heavy');
  assert.equal(looks.get('v')!.armorColors.primary,'#aabbcc');
  assert.equal(looks.get('v')!.appearance.values.noseWidth,.6);
  assert.equal(looks.get('g')!.armorId,null);
  applyDeploymentNames(units,looks);
  assert.equal(units[0].name,'NOVA');
  const reset=initialUnits();applyDeploymentNames(reset,looks);assert.equal(reset[0].name,'NOVA');
  assert.equal(JSON.stringify(squad),raw);
});
test("no saved squad falls back to the showcase, and personnel text cannot become markup", () => {
  assert.equal(deploymentLooks([],initialUnits()).get('v')!.armorId,'nyx-mid');
  assert.equal(escapeHTML('<b>"Vex" & Co</b>'),'&lt;b&gt;&quot;Vex&quot; &amp; Co&lt;/b&gt;');
});
