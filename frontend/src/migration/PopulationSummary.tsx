import type { SchemaSpec } from "../model/operations.ts";
import type { Population } from "./assignment-contract.ts";
import { termDescription } from "./migration-client.ts";

export function PopulationSummary({source,target,entity,population}:{source:SchemaSpec;target:SchemaSpec;entity:string;population:Population}) {
  const table=target.tables.find(t=>t.id===entity)!;
  const key=population.deduplicateBy.map(id=>table.columns.find(c=>c.id===id)?.name??id).join(" + ");
  return <div className="configure-query-summary">
    <p>{population.branches.length ? `Collect ${population.branches.length} source ${population.branches.length===1?"branch":"branches"}` : "Create an empty table"}{key?` · Deduplicate by ${key}`:""}</p>
    <details><summary>Review collected values</summary>
      {population.branches.map(branch=><section key={branch.id}>
        <h4>{branch.id}</h4>
        <p>Source: {branch.bindings.map(b=>source.tables.find(t=>t.id===b.entity)?.name??b.entity).join(" × ")||"One empty tuple"}</p>
        {branch.where.map((e,i)=><p key={i}>{termDescription(source,branch.bindings,e.left)} = {termDescription(source,branch.bindings,e.right)}</p>)}
        {branch.attributes.map(a=><p key={a.columnId}>{table.columns.find(c=>c.id===a.columnId)?.name??a.columnId} ← {termDescription(source,branch.bindings,a.term)}</p>)}
        {branch.foreignKeys.map(f=><p key={f.foreignKeyId}>{target.foreign_keys.find(k=>k.id===f.foreignKeyId)?.name??"Reference"} → {f.branch??"default"}</p>)}
      </section>)}
    </details>
  </div>;
}
