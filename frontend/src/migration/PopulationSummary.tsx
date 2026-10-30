import type { SchemaSpec } from "../model/operations.ts";
import type { Population } from "./assignment-contract.ts";
import { termDescription } from "./migration-client.ts";

export function PopulationSummary({source,target,entity,population,onKeyChange}:{source:SchemaSpec;target:SchemaSpec;entity:string;population:Population;onKeyChange:(keys:string[])=>void}) {
  const table=target.tables.find(t=>t.id===entity)!;
  const key=population.deduplicateBy.map(id=>table.columns.find(c=>c.id===id)?.name??id).join(" + ");
  const fields=table.columns.filter(c=>!c.generated&&c.storage!=="reference");
  return <div className="configure-query-summary">
    <p>{population.branches.length ? `Collect ${population.branches.length} source ${population.branches.length===1?"branch":"branches"}` : "Create an empty table"}</p>
    {!!population.branches.length&&<label className="configure-field">
      <span>Deduplicate by</span>
      <select aria-label={`Deduplicate ${table.name} by`} value={JSON.stringify(population.deduplicateBy)}
        onChange={event=>onKeyChange(JSON.parse(event.target.value) as string[])}>
        <option value="[]">None · keep all records</option>
        {fields.map(column=><option key={column.id} value={JSON.stringify([column.id])}>{column.name}</option>)}
        {population.deduplicateBy.length>1&&<option value={JSON.stringify(population.deduplicateBy)}>{key} (current combination)</option>}
      </select>
    </label>}
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
