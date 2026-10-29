exec(open(__file__.replace('evaluate-smoke.py','smoke.py')).read().split('requests=')[0])
for t in schema['tables']: t['primaryKey']=[t['columns'][0]['id']]
data=dict(tables=dict(Person=[dict(name='Alice')],Team=[dict(title='Alice')]))
request=dict(id='eval',op='evaluate',payload=dict(source=schema,target=schema,assignments=assign,data=data))
requests=[request]
for id,mutate in [('bad-fk',lambda d:d['tables']['Team'][0].update(title='Else')),('null',lambda d:d['tables']['Person'][0].update(name=None))]:
 r=json.loads(json.dumps(request));r['id']=id;mutate(r['payload']['data']);requests.append(r)
p=subprocess.run([str(here/'run-worker.sh')],input=''.join(json.dumps(r)+'\n' for r in requests),capture_output=True,text=True,timeout=40)
results=[json.loads(l) for l in p.stdout.splitlines()]
assert [r['result']['status'] for r in results]==['evaluated','invalid','inconclusive'],(results,p.stderr)
assert results[0]['result']['tables']['Person'][0]['values']['name']=='Alice'
assert results[0]['result']['tables']['Person'][0]['foreignKeys']['team']=='r0'
(here/'evaluate-smoke-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({r['id']:r['result']['status'] for r in results}))
