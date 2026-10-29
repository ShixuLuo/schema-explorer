import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createAiServer, AI_REQUEST_MAX_BYTES } from './ai-server.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const publicOrigin = process.env.PUBLIC_ORIGIN;
const password = process.env.DEMO_PASSWORD_FILE ? (await readFile(process.env.DEMO_PASSWORD_FILE, 'utf8')).trim() : '';
const expectedAuth = createHash('sha256').update(`demo:${password}`).digest();
const owners = new Map();
let aiDay = '', aiCount = 0;
const aiDailyLimit = Number(process.env.DEMO_AI_DAILY_LIMIT ?? 100);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.wasm':'application/wasm','.data':'application/octet-stream'};

function reply(res, status, error) {
  res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({error}));
}
async function body(req, limit) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if(size>limit) throw Object.assign(Error('Request too large.'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function session(req,res) {
  let id = req.headers.cookie?.match(/(?:^|;\s*)schema_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
  if(!id) {
    id=randomUUID();
    const secure=publicOrigin?.startsWith('https:') ? '; Secure' : '';
    res.setHeader('Set-Cookie',`schema_session=${id}; Path=/; HttpOnly; SameSite=Lax${secure}`);
  }
  return id;
}
async function proxy(req,res,url,id) {
  const ai=url.pathname.startsWith('/api/ai/');
  const target=ai?'http://127.0.0.1:5184':'http://127.0.0.1:5185';
  const run=url.pathname.match(/^\/api\/cql\/runs\/([^/]+)(?:\/|$)/)?.[1];
  if(run && owners.get(decodeURIComponent(run))!==id) return reply(res,404,'Run not found in this browser session.');
  if(ai && req.method==='POST') {
    const today=new Date().toISOString().slice(0,10);
    if(today!==aiDay) {aiDay=today;aiCount=0;}
    if(aiDailyLimit>0 && aiCount>=aiDailyLimit) return reply(res,429,'The demo has reached its daily AI request allowance.');
    aiCount++;
  }
  const payload=['GET','HEAD'].includes(req.method)?undefined:await body(req,ai?AI_REQUEST_MAX_BYTES:16*1024*1024);
  // Forward only application headers. External Host/Origin never impersonate
  // the loopback services; the public origin is checked by this gateway.
  const response=await fetch(target+url.pathname+url.search,{
    method:req.method,headers:{'Content-Type':'application/json'},body:payload,
    signal:AbortSignal.timeout(310000),
  });
  const bytes=Buffer.from(await response.arrayBuffer());
  if(req.method==='POST' && url.pathname==='/api/cql/runs' && response.ok) {
    const created=JSON.parse(bytes.toString());
    if(typeof created.runId==='string') {
      owners.set(created.runId,id);
      while(owners.size>64) owners.delete(owners.keys().next().value);
    }
  }
  res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(bytes);
}
const aiServer=createAiServer();
await new Promise((ok,fail)=>aiServer.once('error',fail).listen(5184,'127.0.0.1',ok));
const childEnv={...process.env};
delete childEnv.OPENAI_API_KEY;
delete childEnv.OPENAI_API_KEY_FILE;
delete childEnv.DEMO_PASSWORD_FILE;
const worker=spawn(process.env.CQL_HTTP_COMMAND??'/app/bin/cql-http',[],{stdio:['ignore','inherit','inherit'],env:childEnv});
let stopping=false;
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/healthz') {
      const health=await fetch('http://127.0.0.1:5185/api/cql/health',{signal:AbortSignal.timeout(5000)});
      const details=health.ok?await health.json():null;
      const ready=health.status===429 || details?.worker==='ready';
      res.writeHead(ready?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ready}));
    }
    if(password) {
      const raw=req.headers.authorization?.startsWith('Basic ')?Buffer.from(req.headers.authorization.slice(6),'base64').toString():'';
      const supplied=createHash('sha256').update(raw).digest();
      if(!timingSafeEqual(expectedAuth,supplied)) {
        res.setHeader('WWW-Authenticate','Basic realm="Schema Explorer demo", charset="UTF-8"');
        return reply(res,401,'Demo access requires authentication.');
      }
    }
    if(req.headers.origin && publicOrigin && req.headers.origin!==publicOrigin) return reply(res,403,'Origin not allowed.');
    const id=session(req,res);
    if(url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/cql/')) return await proxy(req,res,url,id);
    if(!['GET','HEAD'].includes(req.method)) return reply(res,405,'Method not allowed.');
    const pathname=decodeURIComponent(url.pathname);
    if(pathname.split('/').some(segment=>segment.startsWith('.')) || pathname.includes('\0')) return reply(res,404,'Not found.');
    let file=resolve(root,'.'+pathname);
    if(file!==resolve(root) && !file.startsWith(resolve(root)+sep)) return reply(res,404,'Not found.');
    let info=await stat(file).catch(()=>null);
    if(info?.isDirectory()) {file=resolve(file,'index.html');info=await stat(file).catch(()=>null);}
    if(!info?.isFile()) {
      if(extname(pathname)) return reply(res,404,'Not found.');
      file=resolve(root,'index.html');info=await stat(file);
    }
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Length':info.size,'Cache-Control':file.includes('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
    if(req.method==='HEAD') return res.end();
    createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch(error) {
    if(!res.headersSent) reply(res,error.status??502,error.status?error.message:'Service temporarily unavailable.');
    else res.destroy();
  }
});
server.requestTimeout=320000;
server.headersTimeout=10000;
function stop(code=0) {
  if(stopping)return;stopping=true;
  server.close();aiServer.close();worker.kill('SIGTERM');
  setTimeout(()=>{worker.kill('SIGKILL');process.exit(code);},10000).unref();
}
worker.on('error',()=>stop(1));
worker.on('exit',()=>{if(!stopping)stop(1);});
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
server.on('error',()=>stop(1));
server.listen(port,'0.0.0.0',()=>console.log(`Schema Explorer demo listening on port ${port}.`));
