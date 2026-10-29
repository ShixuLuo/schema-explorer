import json,subprocess,pathlib
here=pathlib.Path(__file__).resolve().parent
cols=[dict(id=k,name=k,dataType=t,nullable=False) for k,t in [('id','integer'),('money','real'),('active','boolean')]]
s=dict(tables=[dict(id='T',name='T',columns=cols,primaryKey=['id'])],foreign_keys=[],equations=[])
def term(h,*a):return dict(tag='raw_term',head=h,arguments=list(a),annotation=None)
a=[dict(holeId='T.from',value=dict(bindings=[dict(variable='x',entity='T')]))]+[dict(holeId='T.attribute.'+c['id'],value=dict(term=term(c['id'],term('x')))) for c in cols]
r=dict(id='exact',op='evaluate',payload=dict(source=s,target=s,assignments=a,data=dict(tables=dict(T=[dict(id='9223372036854775807',money='123456789.123456789000',active=True)]))))
rs=[r]
for id,col,v in [('overflow','id','9223372036854775808'),('bad-bool','active','1')]:
 x=json.loads(json.dumps(r));x['id']=id;x['payload']['data']['tables']['T'][0][col]=v;rs.append(x)
p=subprocess.run([str(here/'run-worker.sh')],input=''.join(json.dumps(x)+'\n' for x in rs),capture_output=True,text=True,timeout=40)
out=[json.loads(l) for l in p.stdout.splitlines()]
assert [x['result']['status'] for x in out]==['evaluated','invalid','invalid'],(out,p.stderr)
v=out[0]['result']['tables']['T'][0]['values'];assert v==dict(id='9223372036854775807',money='123456789.123456789000',active=True),v
(here/'typed-smoke-results.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({x['id']:x['result']['status'] for x in out}))
