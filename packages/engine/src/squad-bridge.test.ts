// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

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
test("allies get their recruits wherever the hostiles sit among the units", () => {
  const squad=initialSquad();
  squad.recruits[0].callsign='NOVA';
  squad.recruits[1].callsign='ONYX';
  // a game on chain lists units by tile, so the player who goes first comes last
  const units=initialUnits(), hostilesFirst=[...units.filter(u=>u.enemy),...units.filter(u=>!u.enemy)];
  const looks=deploymentLooks(squad.recruits,hostilesFirst), allies=hostilesFirst.filter(u=>!u.enemy);
  assert.equal(looks.get(allies[0].id)!.callsign,'NOVA');
  assert.equal(looks.get(allies[1].id)!.callsign,'ONYX');
  assert.equal(looks.get(allies[0].id)!.armorId,squad.recruits[0].equipment.armor);
});
test("a recruit with the unit's id wins over squad order", () => {
  const squad=initialSquad(), units=initialUnits(), last=squad.recruits.at(-1)!;
  last.id=units[0].id;
  last.callsign='MATCHED';
  assert.equal(deploymentLooks(squad.recruits,units).get(units[0].id)!.callsign,'MATCHED');
});
test("no saved squad falls back to the showcase, and personnel text cannot become markup", () => {
  assert.equal(deploymentLooks([],initialUnits()).get('v')!.armorId,'nyx-mid');
  assert.equal(escapeHTML('<b>"Vex" & Co</b>'),'&lt;b&gt;&quot;Vex&quot; &amp; Co&lt;/b&gt;');
});
