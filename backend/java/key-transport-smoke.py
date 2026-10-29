"""Small official CQL query: business PK holes, exact text and FK transport."""
import copy, json, pathlib, subprocess
here = pathlib.Path(__file__).resolve().parent
def col(id, storage):
    return dict(id=id, name=id, dataType='text', nullable=False, storage=storage)
def table(id, columns):
    return dict(id=id, name=id, columns=columns, primaryKey=['key'])
schema = dict(tables=[table('Child', [col('key','identity'),col('parentCell','reference')]), table('Parent',[col('key','identity')])], foreign_keys=[dict(id='parent', source_table='Child', source_columns=['parentCell'], target_table='Parent', target_columns=['key'])], equations=[])
def term(head, *args):
    return dict(tag='raw_term',head=head,arguments=list(args),annotation=None)
def a(hole, **value):
    return dict(holeId=hole,value=value)
assign = [a('Child.from',bindings=[dict(variable='c',entity='Child')]),a('Parent.from',bindings=[dict(variable='p',entity='Parent')]),a('Child.attribute.key',term=term('key',term('c'))),a('Parent.attribute.key',term=term('key',term('p'))),a('Child.foreignKey.parent',bindings=[dict(targetVariable='p',term=term('parent',term('c')))])]
payload = dict(source=schema,target=schema,assignments=assign,data=dict(tables=dict(Child=[dict(key='0012',parentCell='0007')],Parent=[dict(key='0007')])))
requests=[dict(id='exact-keys-and-fk',op='evaluate',payload=payload)]
missing=copy.deepcopy(payload);missing['assignments']=[a for a in missing['assignments'] if a['holeId']!='Child.attribute.key']
requests.append(dict(id='missing-key',op='validate',payload=missing))
generated=copy.deepcopy(payload);generated['target']['tables'][0]['columns'][0]['generated']='identity';generated['assignments']=[a for a in generated['assignments'] if a['holeId']!='Child.attribute.key']
requests.append(dict(id='generated-omitted',op='validate',payload=generated))
run=subprocess.run([str(here/'run-worker.sh')],input=''.join(json.dumps(r)+'\n' for r in requests),capture_output=True,text=True,timeout=40,check=True)
results=[json.loads(line)['result'] for line in run.stdout.splitlines()]
assert [r['status'] for r in results]==['evaluated','incomplete','valid'],(results,run.stderr)
child=results[0]['tables']['Child'][0];parent=results[0]['tables']['Parent'][0]
assert child['values']==dict(key='0012') and parent['values']==dict(key='0007')
assert child['foreignKeys']['parent']==parent['id']
hole=next(h for h in results[1]['holes'] if h['holeId']=='Child.attribute.key')
assert hole['role']=='identity' and hole['expectedType']=='Text' and not hole['filled']
assert not any(h['holeId']=='Child.attribute.key' for h in results[2]['holes'])
assert results[0]['targetSchema']==schema
print('key transport passed: exact Text 0012, query FK, missing-key incomplete, generated omitted')
