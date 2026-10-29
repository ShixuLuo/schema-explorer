#!/usr/bin/env python3
"""Small official-CQL regression; does not use the HTTP server or full Evan rows."""
import copy
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
base = json.loads((HERE / 'library-smoke-request.json').read_text())
cases = [base]
for field, value in [('memberName', 'Conflicting Ada'), ('total', 'oops'), ('enabled', '2')]:
    case = copy.deepcopy(base)
    case['payload']['data']['tables']['transactions'][1][field] = value
    cases.append(case)
unknown = copy.deepcopy(base)
unknown['payload']['recipeId'] = '../untrusted.cql'
cases.append(unknown)
run = subprocess.run([str(HERE / 'run-worker.sh')], input=''.join(json.dumps(c) + '\n' for c in cases), text=True, capture_output=True, check=True)
results = [json.loads(line)['result'] for line in run.stdout.splitlines()]
assert len(results) == len(cases), run.stderr
result = results[0]
assert result['status'] == 'evaluated', result
assert result['capabilities']['bundledRecipes'] == ['evan.factor_entities.v1', 'library.factor_entities.v1']
tables = result['tables']
assert {k: len(v) for k, v in tables.items()} == {'loans': 3, 'members': 2, 'branches': 2}
loans = {r['values']['id']: r for r in tables['loans']}
members = {r['id']: r['values'] for r in tables['members']}
branches = {r['id']: r['values'] for r in tables['branches']}
for key, amount, active, member, branch in [('L1', '1.25', True, 'M1', 'B1'), ('L2', '2.50', False, 'M1', 'B2'), ('L3', '3.75', True, 'M2', 'B1')]:
    row = loans[key]
    assert row['values']['total'] == amount and row['values']['enabled'] is active
    assert members[row['foreignKeys']['borrower']]['code'] == member
    assert branches[row['foreignKeys']['office']]['code'] == branch
checks = result['manifest']['plan']['checks']
assert len(checks) == 2
assert set(checks) <= {s['name'] for s in result['timing']['stages'] if s['kind'] == 'command'}
for result, expected in zip(results[1:4], ['Contradictions', 'lexical error', 'Bool requires']):
    assert result['status'] == 'invalid', result
    assert expected in str(result['diagnostics']), result
assert results[4]['status'] == 'inconclusive' and 'Unknown sealed plan' in str(results[4]['diagnostics'])
print('sealed plan smoke passed: Library 3/2/2, explicit renamed bridge, exact real/bool, two official checks, conflicting key payload, invalid real/bool, unknown plan rejected')
