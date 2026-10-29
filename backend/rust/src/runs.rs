use super::*;
use sha2::{Digest,Sha256};
fn hash(v:&Value)->String{format!("{:x}",Sha256::digest(v.to_string().as_bytes()))}
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;
struct Job { status: Value, result: Option<Value>, bytes:usize }
pub struct Registry { jobs:Mutex<BTreeMap<String,Job>>, busy:AtomicBool }
impl Registry {pub fn new()->Self{Self{jobs:Mutex::new(BTreeMap::new()),busy:AtomicBool::new(false)}}}
pub fn handle(s:&mut TcpStream,method:&str,path:&str,body:&[u8],origin:Option<&str>,registry:Arc<Registry>,worker:Arc<Mutex<Option<Worker>>>,command:Arc<String>,seq:Arc<AtomicUsize>){
 let (route,query)=path.split_once('?').unwrap_or((path,""));
 if method=="POST" && route=="/api/cql/runs" {
  let Ok(payload)=serde_json::from_slice::<Value>(body) else{respond(s,400,error("invalid_json"),origin);return};
  let kind=payload.get("kind").and_then(Value::as_str).unwrap_or("query");
  if !matches!(kind,"query"|"recipe"){respond(s,400,error("unsupported_run_kind"),origin);return}
  if !payload["source"].is_object()||!payload["target"].is_object()||!payload["data"]["tables"].is_object()||!payload["targetSchemaHash"].is_string()||!payload["sourceDataDigest"].is_string()||!(payload["revision"].is_string()||payload["revision"].is_number()){respond(s,400,error("missing_run_binding"),origin);return}
  if payload["targetSchemaHash"]!=hash(&payload["target"])||payload["sourceDataDigest"]!=hash(&payload["data"]){respond(s,409,error("snapshot_hash_mismatch"),origin);return}
  if registry.busy.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){respond(s,429,error("run_busy"),origin);return}
  let id=format!("run-{:012}",seq.fetch_add(1,Ordering::Relaxed));
  let bindings=json!({"targetSchemaHash":payload["targetSchemaHash"],"revision":payload["revision"],"sourceDataDigest":payload["sourceDataDigest"]});
  let status=json!({"runId":id,"kind":kind,"status":"queued","bindings":bindings,"diagnostics":[],"tables":[]});
  {let mut jobs=registry.jobs.lock().unwrap();while jobs.len()>=8 {let k=jobs.keys().next().cloned().unwrap();jobs.remove(&k);}jobs.insert(id.clone(),Job{status:status.clone(),result:None,bytes:0});}
  respond(s,202,status,origin);
  std::thread::spawn(move||{
   let start=std::time::Instant::now();let mut wire=json!({"source":payload["source"],"target":payload["target"],"assignments":payload.get("assignments").cloned().unwrap_or(json!([])),"data":payload["data"],"targetHash":payload["targetSchemaHash"],"baseRevision":payload["revision"],"sourceDataDigest":payload["sourceDataDigest"]});
   let op=if payload.get("kind").and_then(Value::as_str)==Some("recipe"){wire["recipeId"]=payload["recipeId"].clone();wire["bindings"]=payload["bindings"].clone();wire["targetHash"]=payload["targetSchemaHash"].clone();wire["baseRevision"]=payload["revision"].clone();wire["sourceDataDigest"]=payload["sourceDataDigest"].clone();"evaluate_recipe"}else{"evaluate"};
   registry.jobs.lock().unwrap().get_mut(&id).unwrap().status["status"]=json!("running");
   let outcome=match worker.try_lock(){Ok(mut guard)=>{if guard.is_none(){*guard=Worker::start(&command).ok();}match guard.as_mut(){None=>Err("worker_unavailable"),Some(w)=>{let timeout=std::env::var("CQL_RUN_TIMEOUT_MS").ok().and_then(|s|s.parse::<u64>().ok()).unwrap_or(180000).clamp(50,300000);let v=w.call(&json!({"id":id,"op":op,"payload":wire}),timeout);if v.is_err(){*guard=None;}v}}},Err(_)=>Err("worker_busy")};
   let mut jobs=registry.jobs.lock().unwrap();let job=jobs.get_mut(&id).unwrap();job.status["elapsedMs"]=json!(start.elapsed().as_millis());
   match outcome {
    Ok(v) if v["ok"]==true && v["result"]["status"]=="evaluated"=>{let result=v["result"].clone();let bytes=result.to_string().len();if bytes>64*1024*1024{job.status["status"]=json!("failed");job.status["diagnostics"]=json!([{"code":"result_limit"}]);}else{let tables=result["tables"].as_object().map(|t|t.iter().map(|(id,rows)|json!({"tableId":id,"rowCount":rows.as_array().map(Vec::len).unwrap_or(0)})).collect::<Vec<_>>()).unwrap_or_default();job.status["status"]=json!("succeeded");job.status["tables"]=json!(tables);job.status["timing"]=result["timing"].clone();job.status["programHash"]=result.get("programHash").or(result.get("programSha256")).cloned().unwrap_or(Value::Null);job.status["manifest"]=result["manifest"].clone();job.status["diagnostics"]=result["diagnostics"].clone();job.bytes=bytes;job.result=Some(result);}},
    Ok(v)=>{job.status["status"]=json!("failed");job.status["diagnostics"]=v["result"]["diagnostics"].clone();if job.status["diagnostics"].is_null(){job.status["diagnostics"]=json!([{"code":"evaluation_failed"}]);}},
    Err(code)=>{job.status["status"]=json!("failed");job.status["diagnostics"]=json!([{"code":code,"message":code.replace('_'," ")}]);}
   }
   while jobs.values().map(|j|j.bytes).sum::<usize>()>64*1024*1024 {let old=jobs.keys().find(|k|**k!=id).cloned();if let Some(k)=old{jobs.remove(&k);}else{break}}
   registry.busy.store(false,Ordering::SeqCst);
  });return
 }
 let parts:Vec<_>=route.trim_matches('/').split('/').collect();
 if method!="GET"||parts.len()<4 {respond(s,404,error("not_found"),origin);return}
 let jobs=registry.jobs.lock().unwrap();let Some(job)=jobs.get(parts[3]) else{respond(s,404,error("run_not_found"),origin);return};
 if parts.len()==4 {respond(s,200,job.status.clone(),origin);return}
 if parts.len()!=6||parts[4]!="tables" {respond(s,404,error("not_found"),origin);return}
 let Some(result)=&job.result else{respond(s,409,error("result_not_ready"),origin);return};
 let Some(rows)=result["tables"][parts[5]].as_array() else{respond(s,404,error("table_not_found"),origin);return};
 let mut offset=0;let mut limit=100;for p in query.split('&'){if let Some((k,v))=p.split_once('='){match(k,v.parse::<usize>()){("offset",Ok(n))=>offset=n,("limit",Ok(n))=>limit=n.clamp(1,1000),_=>{respond(s,400,error("invalid_pagination"),origin);return}}}}
 let foreign_keys=result["targetSchema"]["foreign_keys"].as_array().map(|f|f.iter().filter(|f|f["source_table"]==parts[5]).collect::<Vec<_>>()).unwrap_or_default();
 let columns=result["targetSchema"]["tables"].as_array().and_then(|t|t.iter().find(|t|t["id"]==parts[5])).and_then(|t|t.get("columns")).cloned().unwrap_or(json!([]));
 respond(s,200,json!({"runId":parts[3],"tableId":parts[5],"bindings":job.status["bindings"],"offset":offset,"limit":limit,"total":rows.len(),"columns":columns,"foreignKeys":foreign_keys,"rows":rows.iter().skip(offset).take(limit).collect::<Vec<_>>()}),origin);
}

#[cfg(test)] mod tests {use super::*;#[test]fn snapshot_hash_sorts_objects_and_preserves_array_order(){assert_eq!(hash(&serde_json::from_str::<Value>("{\"b\":2,\"a\":1}").unwrap()),hash(&json!({"a":1,"b":2})));assert_ne!(hash(&json!([1,2])),hash(&json!([2,1])));assert_eq!(hash(&json!({})),"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");}}
