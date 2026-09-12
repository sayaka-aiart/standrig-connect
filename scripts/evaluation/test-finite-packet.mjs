import assert from 'node:assert/strict';
import {validateFinitePacket} from './finite-packet.ts';
const shared={coordinates:[1,2,3]};
validateFinitePacket({a:shared,b:shared});
for(const n of [NaN,Infinity,-Infinity]) {
 assert.throws(()=>validateFinitePacket({a:[{x:n}]}),/non-finite/);
 shared.coordinates[1]=n;
 assert.throws(()=>validateFinitePacket({a:shared,b:shared}),/non-finite/);
}
shared.coordinates[1]=2;validateFinitePacket(shared);
const extra=[];extra.hiddenNumber=Infinity;
assert.throws(()=>validateFinitePacket(extra),/non-finite/);
validateFinitePacket(Object.create({inherited:Infinity}));
console.log('PASS finite packet: shared references, per-frame mutation, nested and custom enumerable numbers');
