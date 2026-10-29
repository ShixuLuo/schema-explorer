import json, subprocess, pathlib
here=pathlib.Path(__file__).resolve().parent
def col(id):return dict(id=id,name=id,dataType='text',nullable=False)
schema=dict(tables=[dict(id='Person',name='Person',columns=[col('name')],primaryKey=[]),dict(id='Team',name='Team',columns=[col('title')],primaryKey=[])],foreign_keys=[dict(id='team',source_table='Person',source_columns=['name'],target_table='Team',target_columns=['title'])],equations=[])
def term(head,*args):return dict(tag='raw_term',head=head,arguments=list(args),annotation=None)
def a(h,v):return dict(holeId=h,value=v)
assign=[a('Person.from',dict(bindings=[dict(variable='p',entity='Person')])),a('Team.from',dict(bindings=[dict(variable='t',entity='Team')])),a('Person.attribute.name',dict(term=term('name',term('p')))),a('Team.attribute.title',dict(term=term('title',term('t')))),a('Person.foreignKey.team',dict(bindings=[dict(targetVariable='t',term=term('team',term('p')))]))]
requests=[dict(id='schema',op='schema_validate',payload=dict(schema=schema)),dict(id='draft',op='draft',payload=dict(source=schema,target=schema)),dict(id='valid',op='validate',payload=dict(source=schema,target=schema,assignments=assign))]
bad=json.loads(json.dumps(assign));bad[-1]['value']['bindings']=[]
requests.append(dict(id='missing-substitution',op='validate',payload=dict(source=schema,target=schema,assignments=bad)))
bad=json.loads(json.dumps(assign));bad[2]['value']['term']=term('team',term('p'))
requests.append(dict(id='bad-type',op='validate',payload=dict(source=schema,target=schema,assignments=bad)))
p=subprocess.run([str(here/'run-worker.sh')],input=''.join(json.dumps(r)+'\n' for r in requests),capture_output=True,text=True,timeout=40)
results=[json.loads(l) for l in p.stdout.splitlines()]
assert [r['result']['status'] for r in results]==['valid','incomplete','valid','invalid','invalid'],(results,p.stderr)
(here/'smoke-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({r['id']:r['result']['status'] for r in results}))
