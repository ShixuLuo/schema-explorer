import test from "node:test";
import assert from "node:assert/strict";
import { createObjectOperations, humanCommandOperations, BUSINESS_KEY_TYPES, type NewObjectKey } from "./human-commands.ts";
import { humanActionOperations, validateAiAction } from "../ai/ai-capabilities.ts";
import { translateCommand } from "../model/database-commands.ts";
import { pathOptions } from "../migration/migration-client.ts";
import { materializeLive, type LiveResult } from "./cql-live.ts";
import type { SchemaSpec, TableSpec } from "../model/operations.ts";
import type { Table } from "../model/schema.ts";

const empty: SchemaSpec = { tables: [], foreign_keys: [] };
const ids = () => { let n = 0; return () => `new${++n}`; };
const asTable = (spec: TableSpec): Table => ({ ...spec, caseId: "test", fileName: "", bytes: 0, rowCount: 0, columns: spec.columns.map((c,index)=>({...c,index})) });

test("human and AI create the same generated or supplied key without allocating business values", () => {
  const choices: NewObjectKey[] = [{mode:"generated"}, ...BUSINESS_KEY_TYPES.map(dataType=>({mode:"business" as const,dataType}))];
  for (const key of choices) {
    const command = {kind:"create_object" as const,name:"Item",keyName:"code",key};
    const manual=createObjectOperations(command.name,command.keyName,key,ids());
    assert.deepEqual(humanActionOperations(command,empty,ids()),manual);
    assert.deepEqual(humanCommandOperations(empty,command,ids()),manual);
    const schema=manual.reduce((s,op)=>translateCommand(s,op).after,empty),table=schema.tables[0],column=table.columns[0];
    assert.deepEqual(table.primaryKey,[column.id]);
    assert.equal(column.nullable,false);
    assert.equal(column.generated,key.mode==="generated"?"identity":undefined);
    assert.equal(column.dataType,key.mode==="generated"?"integer":key.dataType);
    const sources=pathOptions(schema,[{variable:"x",entity:table.id}],true);
    assert.equal(sources.some(p=>p.term.head===column.id),key.mode==="business");
  }
});

test("key policy rejects missing business names and unsupported or contradictory choices", () => {
  for(const key of [{mode:"other"},{mode:"business",dataType:"date"},{mode:"business",dataType:"boolean"},{mode:"business",dataType:"real"},{mode:"generated",dataType:"text"}])
    assert.throws(()=>validateAiAction({kind:"create_object",name:"Item",keyName:"code",key},empty));
  assert.throws(()=>validateAiAction({kind:"create_object",name:"Item",keyName:"",key:{mode:"business",dataType:"text"}},empty));
  assert.throws(()=>createObjectOperations("Item"," ",{mode:"business",dataType:"integer"}));
  const [generated]=createObjectOperations("Item","");
  assert.equal(generated.op,"create_table");
  if(generated.op==="create_table")assert.equal(generated.table.columns[0].name,"_id");
});

test("provided key values, including leading zeros, supply foreign keys and reject duplicates or nulls", () => {
  const schema=createObjectOperations("Vendor","code",{mode:"business",dataType:"text"},ids()).reduce((s,op)=>translateCommand(s,op).after,empty);
  const vendor=schema.tables[0],key=vendor.primaryKey[0];
  const order:TableSpec={id:"order",name:"Order",primaryKey:["oid"],columns:[{id:"oid",name:"_id",dataType:"integer",nullable:false,generated:"identity"},{id:"vendorRef",name:"vendor",dataType:"text",nullable:false,storage:"reference"}]};
  const target:SchemaSpec={tables:[vendor,order],foreign_keys:[{id:"fk",name:"vendor",source_table:"order",source_columns:["vendorRef"],target_table:vendor.id,target_columns:[key]}]};
  const result:Pick<LiveResult,"target"|"rows">={target,rows:{[vendor.id]:[{id:"v1",values:{[key]:"001"},foreignKeys:{}},{id:"v2",values:{[key]:"002"},foreignKeys:{}}],order:[{id:"o1",values:{},foreignKeys:{fk:"v2"}}]}};
  const materialize=(value:typeof result)=>materializeLive(value,target.tables.map(asTable),target.foreign_keys);
  const actual=materialize(result);
  assert.deepEqual(actual[0].rows,[["001"],["002"]]);
  assert.deepEqual(actual[1].rows,[["1","002"]]);
  const duplicate=structuredClone(result);duplicate.rows[vendor.id][1].values[key]="001";
  assert.throws(()=>materialize(duplicate),/Duplicate/);
  const missing=structuredClone(result);delete missing.rows[vendor.id][0].values[key];
  assert.throws(()=>materialize(missing),/Missing/);
  const nullable=structuredClone(result);nullable.rows[vendor.id][0].values[key]=null;
  assert.throws(()=>materialize(nullable),/Required/);
});
