"""Transport-only HTTP regression. All POST bodies fail before worker dispatch."""
import json, pathlib, socket, time
here = pathlib.Path(__file__).resolve().parent
reports = []
body = json.dumps({'padding': 'x' * (2 * 1024 * 1024)}, separators=(',', ':')).encode()
def run(name, port, data=b'{}', chunked=False, expect=False, delay=False, headers=None, truncate=False):
    conn = socket.create_connection(('127.0.0.1', port), timeout=10)
    conn.settimeout(10)
    head = ['POST /api/cql/runs HTTP/1.1', f'Host: localhost:{port}', 'Origin: http://localhost:5183', 'Content-Type: application/json', 'Connection: close']
    if headers is None:
        head += ['Transfer-Encoding: chunked' if chunked else f'Content-Length: {len(data)}']
    else:
        head += headers
    if expect:
        head += ['Expect: 100-continue']
    conn.sendall(('\r\n'.join(head) + '\r\n\r\n').encode())
    reader = conn.makefile('rb')
    if expect:
        interim = reader.readline()
        assert interim.startswith(b'HTTP/1.1 100 '), (name, interim)
        while reader.readline() != b'\r\n':
            pass
    if delay:
        time.sleep(.1)
    if headers is None:
        if chunked:
            for offset in range(0, len(data), 65536):
                chunk = data[offset:offset+65536]
                conn.sendall(f'{len(chunk):x};ordinary=json\r\n'.encode() + chunk + b'\r\n')
            conn.sendall(b'0\r\nX-Test-Trailer: bounded\r\n\r\n')
        else:
            conn.sendall(data[:-1] if truncate else data)
    if truncate:
        conn.shutdown(socket.SHUT_WR)
    line = reader.readline()
    assert line.startswith(b'HTTP/1.1 '), (name, 'empty/non-HTTP response', line)
    status = int(line.split()[1])
    length = None
    while True:
        header = reader.readline()
        if header == b'\r\n':
            break
        assert header, (name, 'truncated response headers')
        if header.lower().startswith(b'content-length:'):
            length = int(header.split(b':', 1)[1])
    assert length is not None, name
    value = json.loads(reader.read(length))
    code = value['error']['code']
    assert status in (400, 413), (name, status, value)
    reports.append(dict(name=name, port=port, bytes=len(data), status=status, code=code, completeJson=True))
    reader.close()
    conn.close()
for port in (5185, 5183):
    run('delayed-content-length', port, delay=True)
    run('large-content-length', port, data=body)
    run('large-chunked', port, data=body, chunked=True)
    run('expect-continue', port, data=body, expect=True)
run('ambiguous-length-and-transfer', 5185, headers=['Content-Length: 2', 'Transfer-Encoding: chunked'])
run('body-limit-before-upload', 5185, headers=['Content-Length: 16777217'])
run('truncated-content-length', 5185, truncate=True)
(here / 'http-framing-smoke-results.json').write_text(json.dumps(reports, indent=2) + '\n')
print(json.dumps(reports))
