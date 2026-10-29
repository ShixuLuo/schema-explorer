use serde_json::{json, Value};
use std::{io::{Read, Write, BufRead, BufReader}, net::{TcpListener,TcpStream}, process::{Command,Stdio,Child,ChildStdin}, sync::{Arc,Mutex,mpsc,atomic::{AtomicUsize,Ordering}}, time::Duration};
use std::os::unix::process::CommandExt;
mod runs;
mod http_input;
static SHUTDOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static LIVE_WORKER_PGID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
extern "C" fn shutdown_signal(_:libc::c_int) { SHUTDOWN.store(true, Ordering::SeqCst); }
const MAX_BODY: usize = 16*1024*1024;
const MAX_LINE: usize = 64*1024*1024;
struct Worker { child: Child, input: Option<ChildStdin>, output: mpsc::Receiver<Result<String,()>> }
impl Drop for Worker { fn drop(&mut self) { let _=LIVE_WORKER_PGID.compare_exchange(self.child.id() as i32,0,Ordering::SeqCst,Ordering::SeqCst); let _=Command::new("/bin/kill").args(["-KILL", "--", &format!("-{}",self.child.id())]).stdout(Stdio::null()).stderr(Stdio::null()).status(); let _=self.child.kill(); let _=self.child.wait(); } }
impl Worker {
 fn start(command: &str)->Result<Self,()> {
  let mut child=Command::new(command).process_group(0).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|_|())?;
  let input=child.stdin.take().ok_or(())?; let out=child.stdout.take().ok_or(())?; let err=child.stderr.take().ok_or(())?;
  let(tx,output)=mpsc::sync_channel(1);
  std::thread::spawn(move|| { let mut r=BufReader::new(out); loop {let mut bytes=Vec::new(); let n=r.by_ref().take((MAX_LINE+1) as u64).read_until(b'\n',&mut bytes); if n.is_err()||bytes.is_empty()||bytes.len()>MAX_LINE||!bytes.ends_with(b"\n") {let _=tx.send(Err(()));break} if tx.send(String::from_utf8(bytes).map_err(|_|())).is_err(){break} } });
  // Forward only compiler-owned phase names and numeric durations. Discard raw engine details.
  std::thread::spawn(move|| {
   let mut r=BufReader::new(err);
   loop {
    let mut bytes=Vec::new();let Ok(n)=r.by_ref().take(4097).read_until(b'\n',&mut bytes) else{break};
    if n==0{break} if bytes.len()>4096||!bytes.ends_with(b"\n"){continue}
    let Ok(line)=std::str::from_utf8(&bytes) else{continue};let Some(body)=line.strip_prefix("[cql-stage] ") else{continue};
    let Ok(value)=serde_json::from_str::<Value>(body) else{continue};
    let Some(stage)=value["stage"].as_str() else{continue};let Some(event)=value["event"].as_str() else{continue};
    let known=matches!(stage,"Parse"|"Ty"|"S"|"T"|"O"|"Q"|"Collect"|"Input"|"Occurrences"|"Collected"|"Result")||["SourceRule","TargetRule"].iter().any(|p|stage.strip_prefix(p).is_some_and(|v|v.strip_suffix("Check").unwrap_or(v).chars().all(|c|c.is_ascii_digit())));
    if !known||!matches!(event,"start"|"end"){continue}
    if event=="start"{eprintln!("[cql-stage] {}",json!({"stage":stage,"event":event}));}
    else if let Some(ms)=value["elapsedMs"].as_f64().filter(|ms|ms.is_finite()&&*ms>=0.0){eprintln!("[cql-stage] {}",json!({"stage":stage,"event":event,"elapsedMs":ms}));}
   }
  });
  LIVE_WORKER_PGID.store(child.id() as i32,Ordering::SeqCst); Ok(Self{child,input:Some(input),output})
 }
 fn call(&mut self, v:&Value, timeout:u64)->Result<Value,&'static str>{
  if SHUTDOWN.load(Ordering::SeqCst){return Err("worker_shutdown")}
  let started=std::time::Instant::now(); let mut input=self.input.take().ok_or("worker_io")?; let bytes=format!("{v}\n"); let(tx,rx)=mpsc::sync_channel(1); std::thread::spawn(move|| {let result=input.write_all(bytes.as_bytes()).and_then(|_|input.flush());let _=tx.send((input,result));}); let (input,result)=rx.recv_timeout(Duration::from_millis(timeout)).map_err(|_|"worker_timeout")?; self.input=Some(input); result.map_err(|_|"worker_io")?; let remaining=Duration::from_millis(timeout).saturating_sub(started.elapsed());
  let line=self.output.recv_timeout(remaining).map_err(|e|match e {mpsc::RecvTimeoutError::Timeout=>"worker_timeout",_=>"worker_exit"})?.map_err(|_|"worker_protocol")?;
  let response:Value=serde_json::from_str(&line).map_err(|_|"worker_protocol")?;
  if response.get("id")!=v.get("id") || !response.get("ok").is_some_and(Value::is_boolean){return Err("worker_protocol")}; Ok(response)
 }
}
fn error(code:&str)->Value{json!({"status":"engine-error","error":{"code":code,"message":code.replace('_'," ")}})}
fn respond(s:&mut TcpStream,status:u16,v:Value,origin:Option<&str>){let body=v.to_string(); let cors=origin.map(|o|format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\n")).unwrap_or_default();let _=write!(s,"HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{cors}Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n\r\n{body}",body.len());}
fn handle(mut s:TcpStream,worker:Arc<Mutex<Option<Worker>>>,command:Arc<String>,sequence:Arc<AtomicUsize>,timeout:u64,jobs:Arc<runs::Registry>){
 let _=s.set_read_timeout(Some(Duration::from_secs(5)));let _=s.set_write_timeout(Some(Duration::from_secs(5)));
 let head=match http_input::read_head(&mut s,MAX_BODY){Ok(h)=>h,Err((status,code))=>{respond(&mut s,status,error(code),None);return}};
 let method=head.method.as_str();let path=head.path.as_str();let origin=head.origin.as_deref();
 let allowed=origin.filter(|o|matches!(*o,"http://localhost:5173"|"http://127.0.0.1:5173"|"http://localhost:5183"|"http://127.0.0.1:5183"|"http://localhost:5182"|"http://127.0.0.1:5182"));
 if origin.is_some()&&allowed.is_none(){respond(&mut s,403,error("origin_denied"),None);return}
 if std::env::var_os("CQL_HTTP_TRACE").is_some(){eprintln!("HTTP method={} path={} framing={:?} expectContinue={}",method,path.split('?').next().unwrap_or("").chars().take(128).collect::<String>(),head.framing,head.expect_continue);}
 let body=match http_input::read_body(&mut s,&head,MAX_BODY){Ok(b)=>b,Err((status,code))=>{respond(&mut s,status,error(code),allowed);return}};
 if method=="OPTIONS"{respond(&mut s,200,json!({}),allowed);return}
 if path.starts_with("/api/cql/runs"){runs::handle(&mut s,method,path,&body,allowed,jobs,worker,command,sequence);return}
 let op=match (method,path){("GET","/api/cql/health")=>"health",("POST","/api/cql/schema/validate")=>"schema_validate",("POST","/api/cql/draft")=>"draft",("POST","/api/cql/validate")=>"validate",_=>{respond(&mut s,404,error("not_found"),allowed);return}};
 let payload=if op=="health"{json!({})}else{match serde_json::from_slice::<Value>(&body){Ok(v) if v.is_object()=>v,_=>{respond(&mut s,400,error("invalid_json"),allowed);return}}};
 let Ok(mut guard)=worker.try_lock() else{respond(&mut s,429,error("worker_busy"),allowed);return};
 if guard.is_none(){match Worker::start(&command){Ok(w)=>*guard=Some(w),Err(_)=>{respond(&mut s,503,error("worker_unavailable"),allowed);return}}}
 let id=format!("r{}",sequence.fetch_add(1,Ordering::Relaxed));let req=json!({"id":id,"op":op,"payload":payload});
 match guard.as_mut().unwrap().call(&req,timeout){Ok(v)=>{if op=="health"{respond(&mut s,200,json!({"http":"ready","protocolVersion":1,"worker":if v["ok"]==true{"ready"}else{"unavailable"},"runtime":v.get("result"),"execution":"async-runs"}),allowed)}else{respond(&mut s,200,v,allowed)}},Err(code)=>{*guard=None;respond(&mut s,503,error(code),allowed)}}
}
fn main(){
 // The handler only sets a lock-free flag; process termination/reaping happens in the main loop.
 unsafe {libc::signal(libc::SIGINT,shutdown_signal as *const () as libc::sighandler_t);libc::signal(libc::SIGTERM,shutdown_signal as *const () as libc::sighandler_t);}
 let command=Arc::new(std::env::var("CQL_WORKER_COMMAND").unwrap_or_else(|_|format!("{}/../java/run-worker.sh",env!("CARGO_MANIFEST_DIR"))));let timeout=std::env::var("CQL_WORKER_TIMEOUT_MS").ok().and_then(|s|s.parse::<u64>().ok()).unwrap_or(15000).clamp(50,120000);let listener=TcpListener::bind("127.0.0.1:5185").expect("bind loopback 5185");listener.set_nonblocking(true).expect("nonblocking listener");eprintln!("CQL HTTP listening on 127.0.0.1:5185");let worker=Arc::new(Mutex::new(None));let sequence=Arc::new(AtomicUsize::new(1));let active=Arc::new(AtomicUsize::new(0));let jobs=Arc::new(runs::Registry::new());while !SHUTDOWN.load(Ordering::SeqCst) {if let Ok((mut s,_))=listener.accept(){if active.fetch_add(1,Ordering::SeqCst)>=16{active.fetch_sub(1,Ordering::SeqCst);respond(&mut s,429,error("connection_limit"),None);continue}let(w,c,q,a,j)=(worker.clone(),command.clone(),sequence.clone(),active.clone(),jobs.clone());std::thread::spawn(move||{handle(s,w,c,q,timeout,j);a.fetch_sub(1,Ordering::SeqCst);});}else{std::thread::sleep(Duration::from_millis(20));}}
 // Kill only this supervisor's dedicated worker group before acquiring its mutex,
 // so a running operation cannot delay shutdown or retain an orphan JVM.
 let pid=LIVE_WORKER_PGID.load(Ordering::SeqCst);if pid>0 {unsafe{libc::kill(-pid,libc::SIGKILL);}}
 if let Ok(mut guard)=worker.lock(){*guard=None;}eprintln!("CQL HTTP stopped; owned worker reaped");
}

#[cfg(test)]
mod tests {
 use super::*;
 use std::os::unix::fs::PermissionsExt;
 fn script(name:&str,body:&str)->String {let p=std::env::temp_dir().join(format!("cql-worker-test-{}-{name}",std::process::id()));std::fs::write(&p,format!("#!/bin/sh\n{body}\n")).unwrap();std::fs::set_permissions(&p,std::fs::Permissions::from_mode(0o700)).unwrap();p.to_string_lossy().into_owned()}
 #[test] fn worker_timeout_then_new_process_recovers(){let p=script("timeout","read line\nexec sleep 10");let mut w=Worker::start(&p).unwrap();assert_eq!(w.call(&json!({"id":"a"}),50).unwrap_err(),"worker_timeout");drop(w);std::fs::remove_file(p).unwrap();let p=script("good","while read line; do echo '{\"id\":\"a\",\"ok\":true,\"result\":{\"status\":\"ready\"}}'; done");let mut w=Worker::start(&p).unwrap();assert_eq!(w.call(&json!({"id":"a"}),1000).unwrap()["ok"],true);drop(w);std::fs::remove_file(p).unwrap();}
 #[test] fn worker_protocol_and_start_errors_are_bounded(){assert!(Worker::start("/nonexistent-cql-worker").is_err());let p=script("bad","read line\necho '{\"id\":\"wrong\",\"ok\":true}'");let mut w=Worker::start(&p).unwrap();assert_eq!(w.call(&json!({"id":"a"}),1000).unwrap_err(),"worker_protocol");drop(w);std::fs::remove_file(p).unwrap();}
}
