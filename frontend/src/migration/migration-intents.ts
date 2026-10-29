import type { SchemaSpec, ForeignKeySpec } from "../model/operations.ts";
import { pathOptions, nextVariable, variableTerm, type Assignment, type Binding, type Term } from "./migration-client.ts";
export const equivalent = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i) => equivalent(v,b[i]));
  const x=a as Record<string,unknown>, y=b as Record<string,unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k => equivalent(x[k],y[k]));
};
export const assignmentValue = (assignments: Assignment[], id: string) => assignments.find(a=>a.holeId===id)?.value;
export const sourceBindings = (assignments: Assignment[], id: string): Binding[] => (assignmentValue(assignments,`${id}.from`)?.bindings ?? []).filter((b): b is Binding => "variable" in b);
const substitute = (term: Term, variables: Map<string,Term>): Term => !term.arguments.length && variables.has(term.head) ? variables.get(term.head)! : {...term,arguments:term.arguments.map(t=>substitute(t,variables))};
export type MatchKey = { columns: { id: string; name: string; dataType: string; term: Term }[] };
export function referenceKeys(source: SchemaSpec, target: SchemaSpec, assignments: Assignment[], fk: ForeignKeySpec): MatchKey[] {
  const table=target.tables.find(t=>t.id===fk.target_table), bindings=sourceBindings(assignments,fk.target_table);
  if (!table || !bindings.length || bindings.some(b=>!source.tables.some(t=>t.id===b.entity))) return [];
  if (assignmentValue(assignments,`${table.id}.where`)?.equations?.length) return [];
  const direct = (t: Term): boolean => t.arguments.length===1 && t.arguments[0].arguments.length===0 && bindings.some(b=>b.variable===t.arguments[0].head && source.tables.some(s=>s.id===b.entity && s.columns.some(c=>c.id===t.head && !c.generated && c.storage!=="reference")));
  return [table.primaryKey,...(table.uniqueKeys??[])].filter(k=>k.length).flatMap(ids=>{
    const columns=ids.map(id=>{const c=table.columns.find(c=>c.id===id),term=assignmentValue(assignments,`${table.id}.attribute.${id}`)?.term;return c && term && direct(term) ? {...c,term}:undefined;});
    return columns.every(c=>c!==undefined) ? [{columns:columns as MatchKey["columns"]}] : [];
  });
}
export function compileReferenceMatch(assignments: Assignment[], fk: ForeignKeySpec, key: MatchKey, sourceTerms: Term[]): Assignment[] {
  if (key.columns.length!==sourceTerms.length) throw new Error("Choose a source field for every key field.");
  const bindings=[...sourceBindings(assignments,fk.source_table)], referenced=sourceBindings(assignments,fk.target_table);
  if (!referenced.length) throw new Error("Configure the referenced records first.");
  const existing=(assignmentValue(assignments,`${fk.source_table}.foreignKey.${fk.id}`)?.bindings??[]).filter((b): b is {targetVariable:string;term:Term}=>"targetVariable" in b);
  const replacements=new Map<string,Term>();
  for(const b of referenced){
    const old=existing.find(s=>s.targetVariable===b.variable)?.term;
    if(old && !old.arguments.length && bindings.some(v=>v.variable===old.head && v.entity===b.entity)) replacements.set(b.variable,old);
    else {const variable=nextVariable(bindings);bindings.push({variable,entity:b.entity});replacements.set(b.variable,variableTerm(variable));}
  }
  const oldVariables=new Map(existing.map(b=>[b.targetVariable,b.term]));
  const oldKeyTerms=key.columns.map(c=>substitute(c.term,oldVariables));
  const equations=(assignmentValue(assignments,`${fk.source_table}.where`)?.equations??[]).filter(e=>!existing.length || !oldKeyTerms.some(t=>equivalent(e.right,t)||equivalent(e.left,t)));
  key.columns.forEach((c,i)=>{const equation={left:sourceTerms[i],right:substitute(c.term,replacements)};if(!equations.some(e=>equivalent(e,equation))) equations.push(equation);});
  const changes: Assignment[]=[{holeId:`${fk.source_table}.from`,value:{bindings}},{holeId:`${fk.source_table}.where`,value:{equations}},{holeId:`${fk.source_table}.foreignKey.${fk.id}`,value:{bindings:referenced.map(b=>({targetVariable:b.variable,term:replacements.get(b.variable)!}))}}];
  return [...assignments.filter(a=>!changes.some(c=>c.holeId===a.holeId)),...changes];
}

/** Read a record match from structured assignments; no CQL text parsing. */
export function readReferenceMatch(assignments: Assignment[], fk: ForeignKeySpec, keys: MatchKey[], choices: {term:Term;dataType?:string}[]) {
  const subs=(assignmentValue(assignments,`${fk.source_table}.foreignKey.${fk.id}`)?.bindings??[]).filter((b): b is {targetVariable:string;term:Term}=>"targetVariable" in b);
  const variables=new Map(subs.map(b=>[b.targetVariable,b.term]));
  const equations=assignmentValue(assignments,`${fk.source_table}.where`)?.equations??[];
  const candidates=keys.map(key=>key.columns.map(column=>{
    const referenced=substitute(column.term,variables);
    const matches=equations.flatMap(e=>equivalent(e.left,referenced)?[e.right]:equivalent(e.right,referenced)?[e.left]:[])
      .filter(term=>choices.some(c=>c.dataType===column.dataType&&equivalent(c.term,term)));
    const unique=matches.filter((term,i)=>matches.findIndex(t=>equivalent(t,term))===i);
    return unique.length===1 ? unique[0] : undefined;
  }));
  const complete=candidates.findIndex(terms=>terms.length>0&&terms.every(Boolean));
  const selected=complete<0?0:complete;
  return {selected,terms:candidates[selected]??[],candidates};
}

/** Changes not already represented by a complete simple record-match control. */
export function extraQueryChanges(source: SchemaSpec, target: SchemaSpec, assignments: Assignment[], defaults: Assignment[], tableId: string) {
  const bindings=sourceBindings(assignments,tableId);
  const baseline=sourceBindings(defaults,tableId);
  const explainedSources=new Set<string>();
  const explainedEquations: {left:Term;right:Term}[]=[];
  for (const fk of target.foreign_keys.filter(f=>f.source_table===tableId)) {
    const keys=referenceKeys(source,target,assignments,fk);
    const match=readReferenceMatch(assignments,fk,keys,pathOptions(source,bindings,true));
    const key=keys[match.selected];
    if (!key || !match.terms.length || !match.terms.every(Boolean)) continue;
    const subs=(assignmentValue(assignments,`${tableId}.foreignKey.${fk.id}`)?.bindings??[]).filter((b): b is {targetVariable:string;term:Term}=>"targetVariable" in b);
    const variables=new Map(subs.map(b=>[b.targetVariable,b.term]));
    for (const sub of subs) if (!sub.term.arguments.length) explainedSources.add(sub.term.head);
    key.columns.forEach((c,i)=>explainedEquations.push({left:match.terms[i]!,right:substitute(c.term,variables)}));
  }
  const unexplainedBindings=bindings.filter(b=>!explainedSources.has(b.variable)||baseline.some(v=>v.variable===b.variable));
  const sourcesChanged=!equivalent(unexplainedBindings,baseline);
  const equations=(assignmentValue(assignments,`${tableId}.where`)?.equations??[]).filter(e=>!explainedEquations.some(x=>(equivalent(e.left,x.left)&&equivalent(e.right,x.right))||(equivalent(e.left,x.right)&&equivalent(e.right,x.left))));
  return {sourcesChanged,bindings:unexplainedBindings,equations};
}
