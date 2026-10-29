import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationAiBase, migrationProposalIsCurrent } from './ai-parameters.ts';
import type { MigrationAiProposal } from './ai-parameters.ts';
import type { SchemaSpec } from '../model/operations.ts';
const schema: SchemaSpec={tables:[],foreign_keys:[]};
test('proposal binds schemas and manual assignments independently of object key order',async()=>{
 const base=await migrationAiBase(schema,schema,[]);
 const proposal={base} as MigrationAiProposal;
 assert.equal(await migrationProposalIsCurrent(proposal,{foreign_keys:[],tables:[]},schema,[]),true);
 assert.equal(await migrationProposalIsCurrent(proposal,schema,schema,[{holeId:'new.from',value:{bindings:[]}}]),false);
 assert.equal(await migrationProposalIsCurrent(proposal,schema,{...schema,equations:[]},[]),false);
});
