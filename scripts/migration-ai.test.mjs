import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationAiBase } from '../frontend/src/migration/ai-parameters.ts';
import { generateMigrationParameters } from './migration-ai.mjs';
const source={tables:[{id:'species',name:'Specimens',columns:[],primaryKey:[]}],foreign_keys:[]};
const target={tables:[{id:'archive',name:'Archive',columns:[],primaryKey:[]}],foreign_keys:[]};
const assignments=[{holeId:'archive.from',value:{bindings:[{variable:'r',entity:'species'}]}}];
async function request(){return {protocol:'migration-parameters/v1',requestId:'test',source,target,holes:[{holeId:'archive.from',kind:'sourceEntityBindings',filled:true}],assignments,guidance:'retain all specimens',base:await migrationAiBase(source,target,assignments)}}
const output=changes=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({title:'Keep source rows',changes})}]}]});
test('candidate preserves manual values and must pass actual injected validator',async()=>{
 const req=await request();let checked=false;
 const result=await generateMigrationParameters(req,{structuredImpl:async payload=>{assert.equal(payload.store,false);assert.equal(payload.model,'gpt-6.1-sol');return output([])},validateImpl:async(r,a)=>{checked=true;assert.deepEqual(a,assignments);return {status:'incomplete',holes:[{holeId:'other',filled:false}]}}});
 assert.equal(checked,true);assert.equal(result.missing[0].holeId,'other');assert.deepEqual(result.assignments,assignments);
});
test('rejects stale base before transport',async()=>{const req=await request();req.assignments=[];await assert.rejects(generateMigrationParameters(req),/stale/)});
test('cannot silently overwrite a manual assignment',async()=>{
 const req=await request();await assert.rejects(generateMigrationParameters(req,{structuredImpl:async()=>output([{...assignments[0],replaceExisting:false}])}),/explicit/);
});
test('rejects unknown holes and arbitrary value fields',async()=>{
 const req=await request();for(const change of [{holeId:'invented',value:{term:null},replaceExisting:false},{holeId:'archive.from',value:{sql:'drop'},replaceExisting:true}]) await assert.rejects(generateMigrationParameters(req,{structuredImpl:async()=>output([change])}));
});
test('does not accept model self-reported validity or validator failure',async()=>{
 const req=await request();await assert.rejects(generateMigrationParameters(req,{structuredImpl:async()=>output([]),validateImpl:async()=>({status:'invalid',holes:[]})}),/CQL/);
});
test('supports unary scalar, where and FK substitution DTOs with explicit replacement',async()=>{
 const req=await request(),term={tag:'raw_term',annotation:null,head:'r',arguments:[]};req.holes.push({holeId:'archive.attribute.code',filled:false},{holeId:'archive.foreignKey.parent',filled:false});
 const changes=[{holeId:'archive.from',replaceExisting:true,value:{bindings:[{variable:'r',entity:'species'}],term:null,equations:null}},{holeId:'archive.attribute.code',replaceExisting:false,value:{bindings:null,term:{...term,head:'code',arguments:[term]},equations:null}},{holeId:'archive.where',replaceExisting:false,value:{bindings:null,term:null,equations:[{left:term,right:term}]}},{holeId:'archive.foreignKey.parent',replaceExisting:false,value:{bindings:[{targetVariable:'p',term}],term:null,equations:null}}];
 const result=await generateMigrationParameters(req,{structuredImpl:async()=>output(changes),validateImpl:async()=>({status:'valid',holes:[]})});assert.equal(result.changes.length,4);assert.deepEqual(result.replacedHoleIds,['archive.from']);
});
test('shared transport uses server-only key, budget and store false with fake fetch',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'migration-ai-'));const keyPath=join(dir,'key');await writeFile(keyPath,'fake-test-key',{mode:0o600});
 try {await generateMigrationParameters(await request(),{keyPath,fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer fake-test-key');const payload=JSON.parse(options.body);assert.equal(payload.store,false);assert.equal(payload.max_output_tokens,8000);assert.equal(options.body.includes('fake-test-key'),false);return {ok:true,json:async()=>output([])}},validateImpl:async()=>({status:'valid',holes:[]})});}finally{await rm(dir,{recursive:true,force:true})}
});
