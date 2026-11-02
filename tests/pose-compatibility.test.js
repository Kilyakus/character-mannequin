import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createCapsuleMannequin } from '../src/index.js';
import { ORIGINAL_BONE_NAMES } from '../demo/bone-names.js';

test('procedural rig maps bijectively to the original Rig Lab bone names and local rest axes',()=>{
  const file=fs.readFileSync(new URL('../reference/rig-lab/public/model/capsule_character.glb',import.meta.url));
  const json=JSON.parse(file.subarray(20,20+file.readUInt32LE(12)).toString());
  const original=json.skins[0].joints.map(i=>json.nodes[i]);
  const body=createCapsuleMannequin({THREE}).build(),byName=new Map(body.skeleton.bones.map(b=>[b.name,b]));
  assert.equal(original.length,85);assert.equal(Object.keys(ORIGINAL_BONE_NAMES).length,85);
  for(const node of original){const name=THREE.PropertyBinding.sanitizeNodeName(node.name),bone=byName.get(name);assert.ok(bone,node.name);assert.equal(ORIGINAL_BONE_NAMES[name],node.name);
    // Hips is the root: FBX and glTF express the global Y-up conversion differently.
    if(node.name!=='Hips'){const q=new THREE.Quaternion().fromArray(node.rotation).normalize();assert.ok(q.angleTo(bone.quaternion.clone().normalize())<.001,node.name)}
  }
});
