import json,subprocess,pathlib,copy
here=pathlib.Path(__file__).resolve().parent
repo=here.parent.parent
def term(head,*args):return dict(tag='raw_term',annotation=None,head=head,arguments=list(args))
x=term('x')
def col(cid,name=None,ty='text',**extra):return dict(id=cid,name=name or cid,dataType=ty,nullable=False,**extra)
def table(id,cols):return dict(id=id,name=id,columns=[col(id+'-pk',ty='integer',generated='identity',storage='identity')]+cols,primaryKey=[id+'-pk'])
def schema(tables,fks=[],equations=[]):return dict(tables=tables,foreign_keys=fks,equations=equations)
def assignment(id,**value):return dict(holeId=id,value=value)
source=schema([table('values',[col('number'),col('bit')])]);target=schema([table('values',[col('amount',ty='real'),col('integer',ty='integer'),col('flag',ty='boolean')])])
cast=[assignment('values.from',bindings=[dict(variable='x',entity='values')]),assignment('values.attribute.amount',term=term('cast:real',term('number',x))),assignment('values.attribute.integer',term=term('cast:integer',term('number',x))),assignment('values.attribute.flag',term=term('cast:boolean',term('bit',x)))]
data={'tables':{'values':[{'values-pk':'1','number':'71.00','bit':'1.00'},{'values-pk':'2','number':'-2','bit':'false'}]}}
cases=[('cast-valid',dict(source=source,target=target,assignments=cast,data=data))]
for name,field,value in [('cast-bad-text','number','oops'),('cast-fraction','number','1.25'),('cast-overflow','number','9223372036854775808'),('cast-bad-bool','bit','2')]:
 d=copy.deepcopy(data);d['tables']['values'][0][field]=value;cases.append((name,dict(source=source,target=target,assignments=cast,data=d)))
cols=[col(n) for n in ['fromCode','fromName','fromRegion','toCode','toName','toRegion']]
source=schema([table('trip',cols)])
fks=[dict(id='fromStop',name='fromStop',source_table='trip',source_columns=['fromCarrier'],target_table='stop',target_columns=['stop-pk']),dict(id='toStop',name='toStop',source_table='trip',source_columns=['toCarrier'],target_table='stop',target_columns=['stop-pk']),dict(id='region',name='region',source_table='stop',source_columns=['regionCarrier'],target_table='region',target_columns=['region-pk'])]
eq=dict(id='code-agrees',left=dict(source='trip',arrows=['attribute:fromCode']),right=dict(source='trip',arrows=['reference:fromStop','attribute:code']))
target=schema([table('trip',cols+[col('fromCarrier',ty='integer',storage='reference'),col('toCarrier',ty='integer',storage='reference')]),table('stop',[col('code'),col('label'),col('regionCarrier',ty='integer',storage='reference')]),table('region',[col('regionCode')])],fks,[eq])
a=[assignment('trip.from',bindings=[dict(variable='x',entity='trip')])]+[assignment('trip.attribute.'+c['id'],term=term(c['id'],x)) for c in cols]
a += [assignment('trip.foreignKey.'+fk,branch=branch,bindings=[dict(targetVariable='x',term=x)]) for fk,branch in [('fromStop','start'),('toStop','end')]]
def branch(id,prefix,region=False):
 return dict(id=id,bindings=[dict(variable='x',entity='trip')],where=[],attributes=([dict(columnId='regionCode',term=term(prefix+'Region',x))] if region else [dict(columnId='code',term=term(prefix+'Code',x)),dict(columnId='label',term=term(prefix+'Name',x))]),foreignKeys=[] if region else [dict(foreignKeyId='region',branch=id,bindings=[dict(targetVariable='x',term=x)])])
a += [assignment('stop.population',population=dict(deduplicateBy=['code'],branches=[branch('start','from'),branch('end','to')])),assignment('region.population',population=dict(deduplicateBy=['regionCode'],branches=[branch('start','from',True),branch('end','to',True)]))]
rows=[dict(zip(['trip-pk']+[c['id'] for c in cols],v)) for v in [('1','A','Alpha','N','B','Beta','S'),('2','B','Beta','S','A','Alpha','N'),('3','A','Alpha','N','B','Beta','S')]]
pop=dict(source=source,target=target,assignments=a,data={'tables':{'trip':rows}})
cases.append(('population-valid',pop))
conflict=copy.deepcopy(pop);conflict['data']['tables']['trip'][2]['fromName']='Conflicting';cases.append(('population-conflict',conflict))
badEq=copy.deepcopy(pop);badEq['target']['equations'][0]['right']['arrows'][0]='reference:toStop';cases.append(('population-equation-fails',badEq))
sourceEq=copy.deepcopy(pop);sourceEq['source']['equations']=[dict(id='bad-source',left=dict(source='trip',arrows=['attribute:fromCode']),right=dict(source='trip',arrows=['attribute:toCode']))];cases.append(('source-equation-fails',sourceEq))
combined=copy.deepcopy(pop);combined['target']['equations']=[]
for c in combined['target']['tables'][1]['columns']:
 if c['id']=='code':c['dataType']='integer'
for row in combined['data']['tables']['trip']:
 for field in ['fromCode','toCode']:row[field]={'A':'1.00','B':'2'}[row[field]]
for b in combined['assignments'][-2]['value']['population']['branches']:
 for a in b['attributes']:
  if a['columnId']=='code':a['term']=term('cast:integer',a['term'])
cases.append(('population-with-cast',combined))
refConflict=copy.deepcopy(pop);refConflict['data']['tables']['trip'][2]['fromRegion']='S';cases.append(('population-reference-conflict',refConflict))
empty=dict(source=source,target=schema([table('empty',[col('value')])]),assignments=[assignment('empty.population',population=dict(deduplicateBy=[],branches=[]))],data={'tables':{'trip':rows}})
cases.append(('population-empty',empty))
scaled=copy.deepcopy(combined)
scaled['data']['tables']['trip']=[dict(combined['data']['tables']['trip'][i%3],**{'trip-pk':str(i+1)}) for i in range(500)]
for j in range(20):
 cid='extra'+str(j);scaled['source']['tables'][0]['columns'].append(col(cid));scaled['target']['tables'][0]['columns'].append(col(cid));scaled['assignments'].append(assignment('trip.attribute.'+cid,term=term(cid,x)))
 for row in scaled['data']['tables']['trip']:row[cid]='value'+str(j)
cases.append(('population-wide500',scaled))
business=copy.deepcopy(pop)
stop=business['target']['tables'][1];stop['columns']=[c for c in stop['columns'] if c['id']!='stop-pk'];stop['primaryKey']=['code']
next(c for c in stop['columns'] if c['id']=='code')['storage']='identity'
for fk in business['target']['foreign_keys']:
 if fk['target_table']=='stop':
  fk['target_columns']=['code']
  for cid in fk['source_columns']:next(c for c in business['target']['tables'][0]['columns'] if c['id']==cid)['dataType']='text'
for row in business['data']['tables']['trip']:
 for field in ['fromCode','toCode']:row[field]={'A':'01','B':'02'}[row[field]]
cases.append(('population-business-key',business))
keep=copy.deepcopy(pop);keep['assignments'][-2]['value']['population']['deduplicateBy']=[]
cases.append(('population-keep-all',keep))
requests=''.join(json.dumps(dict(id=name,op='evaluate',payload=p))+'\n' for name,p in cases)
proc=subprocess.run(['sh',str(here/'run-worker.sh')],input=requests,text=True,capture_output=True,timeout=90)
results=[json.loads(line) for line in proc.stdout.splitlines() if line.startswith('{')]
(here/'build/population-smoke-results.json').write_text(json.dumps(results,indent=2))
(here/'build/population-smoke-stderr.log').write_text(proc.stderr)
assert len(results)==len(cases),(proc.returncode,proc.stderr[-2000:])
positive={'cast-valid','population-valid','population-with-cast','population-empty','population-wide500','population-business-key','population-keep-all'}
for r in results:
 q=r.get('result',{});assert q.get('status')==('evaluated' if r['id'] in positive else 'invalid'),(r['id'],q.get('diagnostics'))
 if r['id'].startswith('population-') and r['id'] in positive and r['id']!='population-empty':
  tables=q['tables'];assert {k:len(v) for k,v in tables.items()}=={'trip':500 if r['id']=='population-wide500' else 3,'stop':6 if r['id']=='population-keep-all' else 2,'region':2}
  stops={v['id']:v for v in tables['stop']};regions={v['id']:v for v in tables['region']}
  for row in tables['trip']:
   for ref,prefix in [('fromStop','from'),('toStop','to')]:
    stop=stops[row['foreignKeys'][ref]];code=row['values'][prefix+'Code']
    if r['id'] in ['population-with-cast','population-wide500']:code=str(int(__import__('decimal').Decimal(code)))
    assert stop['values']['code']==code
    assert stop['values']['label']==row['values'][prefix+'Name']
    assert regions[stop['foreignKeys']['region']]['values']['regionCode']==row['values'][prefix+'Region']
   if r['id']=='population-wide500':
    for j in range(20):assert row['values']['extra'+str(j)]=='value'+str(j)
 if r['id']=='cast-valid':
  values={v['values']['amount']:v['values'] for v in q['tables']['values']}
  assert values['71.00']['integer']=='71' and values['71.00']['flag'] is True
 if r['id']=='population-empty':assert q['tables']['empty']==[]
 print(r['id'],'passed')
