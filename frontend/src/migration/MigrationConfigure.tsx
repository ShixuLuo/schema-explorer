import { useState } from "react";
import type { SchemaSpec, ForeignKeySpec } from "../model/operations.ts";
import { pathOptions, scalarOptions, termDescription, populationValue, stableDefaults, updateAssignment, nextVariable, scalarType, type Assignment, type Plan, type Term } from "./migration-client.ts";
import { assignmentValue, sourceBindings, equivalent, referenceKeys, compileReferenceMatch, readReferenceMatch, extraQueryChanges } from "./migration-intents.ts";
import { PopulationSummary } from "./PopulationSummary.tsx";
import "./configure.css";
type Props = { source: SchemaSpec; target: SchemaSpec; plan: Plan; assignments: Assignment[]; onChange: (assignments: Assignment[]) => void; onFocus?: (holeId: string) => void };
type Choices = ReturnType<typeof pathOptions>;
function Field({label,current,choices,onChange}: {label:string;current?:Term;choices:Choices;onChange:(term:Term)=>void}) {
  return <label className="configure-field"><span>{label}</span><select value={choices.findIndex(c=>equivalent(c.term,current))} onChange={e=>{const c=choices[Number(e.target.value)];if(c)onChange(c.term);}}><option value={-1}>Choose source field</option>{choices.map((c,i)=><option key={i} value={i}>{c.label}</option>)}</select></label>;
}
export function MigrationConfigure(props: Props) {
  const {source,target,plan,assignments,onChange,onFocus}=props;
  const defaults=stableDefaults(source,target);
  const put=(id:string,value:Assignment["value"])=>onChange(updateAssignment(assignments,target,id,value));
  const value=(id:string)=>assignmentValue(assignments,id);
  const friendly=(choices:Choices,tableId:string)=>choices.map(c=>{
    const binding=sourceBindings(assignments,tableId).find(b=>c.label===b.variable||c.label.startsWith(`${b.variable}.`));
    return {...c,label:c.term.head.startsWith("cast:") ? termDescription(source,sourceBindings(assignments,tableId),c.term) : binding ? (source.tables.find(t=>t.id===binding.entity)?.name??"Source")+c.label.slice(binding.variable.length) : c.label};
  });
  const unresolved=(id:string)=>!value(id) || (plan.holes?.some(h=>h.holeId===id && !h.filled) && !assignments.some(a=>a.holeId===id));
  const changed=(id:string)=>unresolved(id)||!equivalent(value(id),assignmentValue(defaults,id));
  const scalarField=(table:SchemaSpec["tables"][number],id:string,advanced=false)=>{
    const col=table.columns.find(c=>id===`${table.id}.attribute.${c.id}`),hole=plan.holes?.find(h=>h.holeId===id);
    const choices=scalarOptions(source,sourceBindings(assignments,table.id),col?.dataType).filter(c=>col ? c.dataType===col.dataType : !hole?.expectedType||scalarType(c.dataType??"")===hole.expectedType);
    return <div key={id} data-hole-id={id} onFocus={()=>onFocus?.(id)}><Field label={col?.name??"Value"} current={value(id)?.term} choices={advanced?choices:friendly(choices,table.id)} onChange={term=>put(id,{term})}/></div>;
  };
  const allIds=(table:SchemaSpec["tables"][number])=>Array.from(new Set([...(plan.holes??[]).filter(h=>h.kind==="scalarTerm" && h.holeId.startsWith(`${table.id}.attribute.`)).map(h=>h.holeId),...table.columns.filter(c=>!c.generated&&c.storage!=="reference").map(c=>`${table.id}.attribute.${c.id}`)]));
  const extras=(tableId:string)=>extraQueryChanges(source,target,assignments,defaults,tableId);
  const termLabel=(term:Term,tableId:string):string=>{
    if(term.head.startsWith("cast:")) return termDescription(source,sourceBindings(assignments,tableId),term);
    const bindings=sourceBindings(assignments,tableId);
    const choice=friendly([...pathOptions(source,bindings,true),...pathOptions(source,bindings,false)],tableId).find(c=>equivalent(c.term,term));
    if(choice) return choice.label;
    const name=source.tables.flatMap(t=>t.columns).find(c=>c.id===term.head)?.name??source.foreign_keys.find(f=>f.id===term.head)?.name??term.head;
    return term.arguments.length ? `${name}(${term.arguments.map(t=>termLabel(t,tableId)).join(", ")})` : name;
  };
  const visible=target.tables.filter(table=>populationValue(assignments,table.id)||!source.tables.some(t=>t.id===table.id)||allIds(table).some(changed)||target.foreign_keys.some(f=>f.source_table===table.id&&changed(`${table.id}.foreignKey.${f.id}`))||unresolved(`${table.id}.from`)||extras(table.id).sourcesChanged||extras(table.id).equations.length>0);
  return <div className="migration-configure">
    {!visible.length&&<p>No mapping changes needed.</p>}
    {visible.map(table=>populationValue(assignments,table.id)?<section className="configure-table" key={table.id}><h3>{table.name}</h3><PopulationSummary source={source} target={target} entity={table.id} population={populationValue(assignments,table.id)!}/></section>:<section className="configure-table" key={table.id}><h3>{table.name}</h3>
      {unresolved(`${table.id}.from`)&&<label className="configure-field" data-hole-id={`${table.id}.from`}><span>Take records from</span><select value={sourceBindings(assignments,table.id)[0]?.entity??""} onChange={e=>put(`${table.id}.from`,{bindings:[{variable:"x1",entity:e.target.value}]})}><option value="">Choose source table</option>{source.tables.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      {extras(table.id).sourcesChanged&&!unresolved(`${table.id}.from`)&&<p className="configure-query-summary">Source records: {extras(table.id).bindings.map(b=>source.tables.find(t=>t.id===b.entity)?.name??b.entity).join(" × ")||"No source records"}</p>}
      {extras(table.id).equations.map((eq,i)=><p className="configure-query-summary" key={i}>{termLabel(eq.left,table.id)} = {termLabel(eq.right,table.id)}</p>)}
      {allIds(table).filter(changed).map(id=>scalarField(table,id))}
      {target.foreign_keys.filter(f=>f.source_table===table.id&&changed(`${table.id}.foreignKey.${f.id}`)).map(fk=><ReferenceMatch key={fk.id} {...props} fk={fk} choices={friendly(pathOptions(source,sourceBindings(assignments,table.id),true),table.id)}/>)}
    </section>)}
    <details className="configure-advanced"><summary>Advanced · all mappings</summary>
      {target.tables.map(table=>{const population=populationValue(assignments,table.id);if(population)return <section className="configure-table" key={table.id}><h3>{table.name}</h3><PopulationSummary source={source} target={target} entity={table.id} population={population}/><button onClick={()=>onChange(assignments.filter(a=>a.holeId!==`${table.id}.population`))}>Use single-source mappings</button></section>;const bindings=sourceBindings(assignments,table.id),scalar=pathOptions(source,bindings,true),entities=pathOptions(source,bindings,false),equations=value(`${table.id}.where`)?.equations??[];return <section className="configure-table" key={table.id}><h3>{table.name}</h3>
        <h4>Source records and aliases</h4>{bindings.map((b,i)=><div className="configure-row" key={i}><input aria-label="Source alias" value={b.variable} onChange={e=>put(`${table.id}.from`,{bindings:bindings.map((v,j)=>i===j?{...v,variable:e.target.value}:v)})}/><select aria-label="Source table" value={b.entity} onChange={e=>put(`${table.id}.from`,{bindings:bindings.map((v,j)=>i===j?{...v,entity:e.target.value}:v)})}>{source.tables.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select><button onClick={()=>put(`${table.id}.from`,{bindings:bindings.filter((_,j)=>i!==j)})}>Remove</button></div>)}
        <button onClick={()=>put(`${table.id}.from`,{bindings:[...bindings,{variable:nextVariable(bindings),entity:source.tables[0]?.id??""}]})}>Add source</button>
        {allIds(table).map(id=>scalarField(table,id,true))}
        {target.foreign_keys.filter(f=>f.source_table===table.id).map(f=>{const id=`${table.id}.foreignKey.${f.id}`,subs=value(id)?.bindings?.filter(b=>"targetVariable" in b)??[];return <div key={id} data-hole-id={id}><h4>Reference: {f.name??target.tables.find(t=>t.id===f.target_table)?.name}</h4>{populationValue(assignments,f.target_table)&&<label className="configure-field"><span>Source branch</span><select value={value(id)?.branch??(populationValue(assignments,f.target_table)!.branches.length===1?populationValue(assignments,f.target_table)!.branches[0].id:"")} onChange={e=>put(id,{branch:e.target.value,bindings:[]})}><option value="">Choose source branch</option>{populationValue(assignments,f.target_table)!.branches.map(b=><option key={b.id} value={b.id}>{b.id}</option>)}</select></label>}{(populationValue(assignments,f.target_table)?.branches.find(b=>b.id===(value(id)?.branch??(populationValue(assignments,f.target_table)!.branches.length===1?populationValue(assignments,f.target_table)!.branches[0].id:"")))?.bindings??sourceBindings(assignments,f.target_table)).map(b=><Field key={b.variable} label={b.variable} current={subs.find(s=>s.targetVariable===b.variable)?.term} choices={entities.filter(c=>c.entity===b.entity)} onChange={term=>put(id,{...(value(id)?.branch?{branch:value(id)!.branch}:{}),bindings:[...subs.filter(s=>s.targetVariable!==b.variable),{targetVariable:b.variable,term}]})}/>)}<button onClick={()=>put(id,{bindings:[]})}>Use no source records</button></div>;})}
        <h4>Row conditions</h4>{equations.map((eq,i)=><div className="configure-row" key={i}>{(["left","right"] as const).map(side=><Field key={side} label={side} current={eq[side]} choices={[...scalar,...entities]} onChange={term=>put(`${table.id}.where`,{equations:equations.map((e,j)=>i===j?{...e,[side]:term}:e)})}/>)}<button onClick={()=>put(`${table.id}.where`,{equations:equations.filter((_,j)=>i!==j)})}>Remove</button></div>)}<button disabled={!scalar.length} onClick={()=>put(`${table.id}.where`,{equations:[...equations,{left:scalar[0].term,right:scalar[0].term}]})}>Add condition</button>
      </section>;})}
      {plan.program&&<details><summary>CQL plan</summary><pre>{plan.program}</pre></details>}
    </details>
  </div>;
}
function ReferenceMatch({source,target,assignments,onChange,onFocus,fk,choices}:Props&{fk:ForeignKeySpec;choices:Choices}) {
  const keys=referenceKeys(source,target,assignments,fk);
  const inferred=readReferenceMatch(assignments,fk,keys,choices);
  // Only edited cells override current assignments. External updates keep all
  // untouched selections live without discarding unfinished local choices.
  const [draft,setDraft]=useState<{keyIds:string[];terms:Record<string,Term>}|undefined>();
  const localIndex=draft ? keys.findIndex(k=>equivalent(k.columns.map(c=>c.id),draft.keyIds)) : -1;
  const selected=localIndex>=0?localIndex:inferred.selected;
  const key=keys[selected],id=`${fk.source_table}.foreignKey.${fk.id}`,name=target.tables.find(t=>t.id===fk.target_table)?.name??"Referenced records";
  const terms=key?.columns.map((c,i)=>localIndex>=0&&draft?.terms[c.id] ? draft.terms[c.id] : inferred.candidates[selected]?.[i])??[];
  const population=populationValue(assignments,fk.target_table);
  const current=assignmentValue(assignments,id);
  if(population&&current){const branch=population.branches.find(b=>b.id===(current.branch??(population.branches.length===1?population.branches[0].id:"")));return <div className="configure-match" data-hole-id={id}><h4>Reference · {fk.name??name}</h4><p>{name} · {branch?.id??"Choose a source branch in Advanced"}</p></div>;}
  return <div className="configure-match" data-hole-id={id} onFocus={()=>onFocus?.(id)}><h4>Match records · {fk.name??name}</h4>{!key?<p>Configure advanced mapping: the referenced records need a configured, directly mapped key.</p>:<>
    {keys.length>1&&<label className="configure-field"><span>Match using</span><select value={selected} onChange={e=>{const next=keys[Number(e.target.value)];setDraft({keyIds:next.columns.map(c=>c.id),terms:{}});}}>{keys.map((k,i)=><option value={i} key={i}>{k.columns.map(c=>c.name).join(" + ")}</option>)}</select></label>}
    {key.columns.map((c,i)=><div className="configure-match-row" key={c.id}><Field label="Source field" current={terms[i]} choices={choices.filter(o=>o.dataType===c.dataType)} onChange={term=>setDraft(old=>({keyIds:key.columns.map(c=>c.id),terms:{...(old&&equivalent(old.keyIds,key.columns.map(c=>c.id))?old.terms:{}),[c.id]:term}}))}/><span>= {name}.{c.name}</span></div>)}
    <button disabled={!key.columns.every((_,i)=>terms[i])} onClick={()=>{onChange(compileReferenceMatch(assignments,fk,key,terms as Term[]));setDraft(undefined);}}>Use this match</button>
  </>}</div>;
}
export default MigrationConfigure;
