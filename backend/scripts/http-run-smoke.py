"""Real HTTP generic evaluation smoke; run against an already running server."""
import hashlib, json, pathlib, time, urllib.request, urllib.error
here = pathlib.Path(__file__).resolve().parent
fixture = here.parent / 'java' / 'smoke.py'
ns = {'__file__': str(fixture)}
exec(fixture.read_text().split('requests=')[0], ns)
schema = ns['schema']
for table in schema['tables']:
    table['primaryKey'] = [table['columns'][0]['id']]
def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
data = {'tables': {'Person': [{'name': 'Alice'}], 'Team': [{'title': 'Alice'}]}}
payload = dict(kind='query', source=schema, target=schema, assignments=ns['assign'], data=data,
               targetSchemaHash=digest(schema), revision=7, sourceDataDigest=digest(data))
base = 'http://127.0.0.1:5185/api/cql/runs'
def post(p):
    return json.load(urllib.request.urlopen(urllib.request.Request(base, json.dumps(p).encode(), {'Content-Type': 'application/json'})))
bad = dict(payload, targetSchemaHash='incorrect')
try:
    post(bad)
    raise AssertionError('stale target accepted')
except urllib.error.HTTPError as e:
    assert e.code == 409
run = post(payload)
for _ in range(200):
    status = json.load(urllib.request.urlopen(base + '/' + run['runId']))
    if status['status'] not in ('queued', 'running'):
        break
    time.sleep(.1)
assert status['status'] == 'succeeded', status
page = json.load(urllib.request.urlopen(base + '/' + run['runId'] + '/tables/Person?offset=0&limit=1'))
assert page['rows'][0]['values']['name'] == 'Alice', page
assert page['rows'][0]['foreignKeys']['team'] == 'r0', page
assert page['bindings']['revision'] == 7
(here / 'http-run-smoke-results.json').write_text(json.dumps({'status': status, 'page': page}, indent=2) + '\n')
print(json.dumps({'runId': run['runId'], 'status': status['status'], 'rows': page['total']}))
