"""Bounded supervisor-only test; requires port 5185 to be free. No real CQL execution."""
import json, os, pathlib, signal, subprocess, tempfile, time, urllib.request
here = pathlib.Path(__file__).resolve().parent
binary = here.parent / 'rust/target/debug/cql-http'
reports = []
with tempfile.TemporaryDirectory(prefix='cql-shutdown-') as temp:
    root = pathlib.Path(temp)
    for sig in (signal.SIGINT, signal.SIGTERM):
        pidfile = root / f'pids-{sig}'
        worker = root / 'worker.sh'
        worker.write_text(f'''#!/bin/sh
sleep 30 &
echo "$$ $!" > '{pidfile}'
while read line; do echo '{{"id":"r1","ok":true,"result":{{"status":"ready"}}}}'; done
''')
        worker.chmod(0o700)
        proc = subprocess.Popen([str(binary)], env=dict(os.environ, CQL_WORKER_COMMAND=str(worker)), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:5185/api/cql/health', timeout=.2) as r:
                        assert json.load(r)['worker'] == 'ready'
                    break
                except OSError:
                    time.sleep(.02)
            else:
                raise AssertionError('server did not start')
            pids = [int(p) for p in pidfile.read_text().split()]
            proc.send_signal(sig)
            assert proc.wait(timeout=3) == 0
            for _ in range(100):
                alive = []
                for pid in pids:
                    try:
                        os.kill(pid, 0)
                        alive.append(pid)
                    except ProcessLookupError:
                        pass
                if not alive:
                    break
                time.sleep(.02)
            assert not alive, ('orphan worker/descendant', alive)
            reports.append(dict(signal=sig.name, serverExit=0, workerAndDescendantTerminated=True))
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
(here / 'shutdown-smoke-results.json').write_text(json.dumps(reports, indent=2) + '\n')
print(json.dumps(reports))
