import test from 'node:test';
import assert from 'node:assert/strict';
import {historyInfo} from './history.ts';
import type {Checkpoint,UseCase} from '../model/workspace.ts';
import type {Table} from '../model/schema.ts';
const table=(id:string,rowCount:number):Table=>({id,name:id,caseId:'case',fileName:'',bytes:0,rowCount,primaryKey:[id+'key'],columns:[{id:id+'key',name:'id',dataType:'text',nullable:false,index:0}]});
const checkpoint:Checkpoint={id:'migration',name:'CQL migration',createdAt:0,parentId:null,state:{tables:[table('Customer',2),table('Order',3)],relationships:[],positions:{}},provenance:{kind:'cql-result-import',scope:'complete target replacement',resultId:'run',binding:{},equations:'none imported; external contract only'}};
function summary(point:Checkpoint){
 const model:UseCase={id:'case',name:'Sample',createdAt:0,updatedAt:0,modelVersion:6,tableIds:[],positions:{},relationships:[],history:{editing:point.id,checkpoints:[point]}};
 const before=structuredClone(model), result=historyInfo(model).checkpoints[0];
 assert.deepEqual(model,before);
 return result;
}
test('data migration summaries use the saved result, without inventing edit operations',()=>{
 const actual=summary(checkpoint);
 assert.equal(actual.summary,'Data migration · 2 tables · 5 rows');
 assert.equal(actual.operationCount,undefined);
});
test('recorded edits and unknown legacy counts retain distinct meanings',()=>{
 assert.equal(summary({...checkpoint,provenance:undefined,operationCount:2}).summary,'2 operations');
 assert.equal(summary({...checkpoint,provenance:undefined}).summary,'Saved checkpoint');
});
test('an explicitly empty migration reports zero rows, not zero operations',()=>{
 const point={...checkpoint,state:{...checkpoint.state,tables:[table('Empty',0)]}};
 assert.equal(summary(point).summary,'Data migration · 1 table · 0 rows');
});
