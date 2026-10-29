import java.util.*;import org.json.*;import catdata.*;import catdata.cql.*;import catdata.cql.exp.*;
/** Executes trusted CQL stages; client inputs are only structured schema, bindings and rows. */
final class SealedPlanRunner {
 static AqlEnv evaluate(String text,JSONArray stages)throws Exception {
  Program<Exp<?>> program=AqlParserFactory.getParser().parseProgram(text);
  AqlEnv env=new AqlEnv(program);env.typing=new AqlTyping(program,false);
  for(String name:program.order){
   long begin=System.nanoTime();Exp<?> expression=program.exps.get(name);
   Object value=expression.eval(env,false);env.defs.put(name,expression.kind(),value);
   if(value instanceof Pragma pragma)pragma.execute();
   JSONObject stage=new JSONObject().put("name",name).put("kind",expression.kind().toString()).put("ms",(System.nanoTime()-begin)/1e6);
   if(value instanceof Instance<?,?,?,?,?,?,?,?,?> instance){
    JSONObject counts=new JSONObject();
    for(Object entity:instance.schema().ens)counts.put(entity.toString(),size(instance,entity));
    stage.put("counts",counts);
   }
   stages.put(stage);System.err.println("recipe_stage "+stage);
  }
  return env;
 }
 @SuppressWarnings({"rawtypes","unchecked"}) static int size(Instance instance,Object entity){return instance.algebra().size(entity);}

 @SuppressWarnings({"rawtypes","unchecked"})
 static void bind(SchemaCompiler nativeSchema,Schema official,JSONObject bindings,String side){
  JSONObject entities=bindings.getJSONObject(side+"Entities"),attributes=bindings.getJSONObject(side+"Attributes"),foreignKeys=bindings.getJSONObject(side+"ForeignKeys");
  if(entities.length()!=official.ens.size()||nativeSchema.tables.size()!=official.ens.size())throw new IllegalArgumentException("Plan entity binding coverage mismatch");
  Set<String> covered=new HashSet<>();
  for(Object entity:official.ens){
   String eid=entities.getString(entity.toString());nativeSchema.entity(eid);
   if(!covered.add(eid))throw new IllegalArgumentException("Duplicate entity binding");
   nativeSchema.symbols.put(eid,entity.toString());
   Map<String,String> boundAttributes=new LinkedHashMap<>(),boundFks=new LinkedHashMap<>();
   for(Object attribute:official.attsFrom(entity)){
    String cid=attributes.getString(attribute.toString());JSONObject column=nativeSchema.findColumn(eid,cid);
    if(side.equals("target")){
     if(SchemaCompiler.hidden(column)&&!transportableKey(nativeSchema,eid,column))throw new UnsupportedOperationException("Plan target attribute cannot bind hidden non-business-key column: "+cid);
     String sort=((Pair)official.atts.get(attribute)).second.toString();
     String expected=Map.of("String","Text","Int","Integer","Real","exactReal","Bool","Bool").get(sort);
     if(!SchemaCompiler.type(column).equals(expected))throw new IllegalArgumentException("Target bound scalar sort differs: "+cid);
    }
    if(boundAttributes.put(cid,attribute.toString())!=null)throw new IllegalArgumentException("Duplicate attribute binding");
   }
   if(side.equals("target")){
    for(String cid:nativeSchema.columns.get(eid).keySet())if(!boundAttributes.containsKey(cid))throw new IllegalArgumentException("Plan attributes do not cover selected native schema: "+eid);
    for(Object key:nativeSchema.tables.get(eid).getJSONArray("primaryKey")){
     JSONObject column=nativeSchema.findColumn(eid,(String)key);
     if(!column.has("generated")&&!boundAttributes.containsKey((String)key))throw new UnsupportedOperationException("Missing explicit recipe target key transport: "+eid+"."+key);
    }
   }
   for(Object fk:official.fksFrom(entity)){
    String fid=foreignKeys.getString(fk.toString());
    if(!nativeSchema.fks.get(eid).containsKey(fid))throw new IllegalArgumentException("Unknown FK binding");
    JSONObject nativeFk=null;
    for(Object o:nativeSchema.foreignKeys(eid)){JSONObject f=(JSONObject)o;if(f.getString("id").equals(fid))nativeFk=f;}
    String officialDest=((Pair)official.fks.get(fk)).second.toString();
    if(!nativeSchema.fkTarget(nativeFk).equals(entities.getString(officialDest)))throw new IllegalArgumentException("Bound FK destination differs");
    boundFks.put(fid,fk.toString());
   }
   if(boundFks.size()!=nativeSchema.fks.get(eid).size())throw new IllegalArgumentException("Plan FK coverage mismatch");
   nativeSchema.columns.put(eid,boundAttributes);nativeSchema.fks.put(eid,boundFks);
  }
  if(attributes.length()!=official.atts.size()||foreignKeys.length()!=official.fks.size())throw new IllegalArgumentException("Extra recipe bindings");
 }

 static boolean transportableKey(SchemaCompiler schema,String entity,JSONObject col){return !col.has("generated")&&"identity".equals(col.optString("storage"))&&schema.tables.get(entity).getJSONArray("primaryKey").toList().contains(col.getString("id"));}
 static Object symbol(Collection<?> symbols,String name){return symbols.stream().filter(x->x.toString().equals(name)).findFirst().orElseThrow(()->new IllegalArgumentException("Unknown sealed bridge symbol: "+name));}
 static void coverage(JSONObject mapping,Collection<?> symbols){Set<String> expected=new HashSet<>();for(Object x:symbols)expected.add(x.toString());if(!mapping.keySet().equals(expected))throw new IllegalArgumentException("Sealed bridge mapping coverage differs");}
 @SuppressWarnings({"rawtypes","unchecked"}) static void validateBridge(Schema source,Schema wanted,JSONObject spec){
  JSONObject entities=spec.getJSONObject("entities"),attributes=spec.getJSONObject("attributes"),foreignKeys=spec.getJSONObject("foreignKeys");
  if(!spec.getString("scalarMode").equals("groundString"))throw new UnsupportedOperationException("Unsupported sealed bridge scalar mode");
  coverage(entities,wanted.ens);coverage(attributes,wanted.atts.keySet());coverage(foreignKeys,wanted.fks.keySet());
  if(new HashSet<>(entities.toMap().values()).size()!=source.ens.size()||entities.length()!=source.ens.size())throw new IllegalArgumentException("Sealed bridge entity bijection required");
  for(Object en:wanted.ens){Object rawEn=symbol(source.ens,entities.getString(en.toString()));
   for(Object att:wanted.attsFrom(en)){Object rawAtt=symbol(source.attsFrom(rawEn),attributes.getString(att.toString()));if(!((Pair)source.atts.get(rawAtt)).second.toString().equals("String")||!((Pair)wanted.atts.get(att)).second.toString().equals("String"))throw new IllegalArgumentException("Ground-string bridge requires String attributes");}
   for(Object fk:wanted.fksFrom(en)){Object rawFk=symbol(source.fksFrom(rawEn),foreignKeys.getString(fk.toString()));Object dest=((Pair)wanted.fks.get(fk)).second,rawDest=((Pair)source.fks.get(rawFk)).second;if(!entities.getString(dest.toString()).equals(rawDest.toString()))throw new IllegalArgumentException("Bridge FK destination differs");}
  }
 }
 @SuppressWarnings({"rawtypes","unchecked"}) static String bridge(Instance input,Schema wanted,JSONObject stage){
  JSONObject spec=stage.getJSONObject("bridge"),entities=spec.getJSONObject("entities"),attributes=spec.getJSONObject("attributes"),foreignKeys=spec.getJSONObject("foreignKeys");
  validateBridge(input.schema(),wanted,spec);
  Map<Object,Map<Object,String>> ids=new HashMap<>();int serial=0;StringBuilder b=new StringBuilder("instance "+stage.getString("inputInstance")+" = literal : "+stage.getString("inputSchema")+" {\ngenerators\n");
  for(Object en:wanted.ens){Object rawEn=symbol(input.schema().ens,entities.getString(en.toString()));Map<Object,String> m=new HashMap<>();for(Object row:input.algebra().en(rawEn)){String id="n"+(serial++);m.put(row,id);b.append(id).append(" : ").append(en).append('\n');}ids.put(en,m);}
  b.append("equations\n");
  for(Object en:wanted.ens){Object rawEn=symbol(input.schema().ens,entities.getString(en.toString()));for(Object row:input.algebra().en(rawEn)){String g=ids.get(en).get(row);
   for(Object att:wanted.attsFrom(en)){Object rawAtt=symbol(input.schema().attsFrom(rawEn),attributes.getString(att.toString()));Object value=input.algebra().att(rawAtt,row).obj();if(!(value instanceof String))throw new IllegalArgumentException("Bridge requires ground string values");b.append(g).append('.').append(att).append(" = ").append(JSONObject.quote((String)value)).append('\n');}
   for(Object fk:wanted.fksFrom(en)){Object rawFk=symbol(input.schema().fksFrom(rawEn),foreignKeys.getString(fk.toString()));Object dest=((Pair)wanted.fks.get(fk)).second,rawDest=((Pair)input.schema().fks.get(rawFk)).second;if(!entities.getString(dest.toString()).equals(rawDest.toString()))throw new IllegalArgumentException("Bridge FK destination differs");String target=ids.get(dest).get(input.algebra().fk(rawFk,row));if(target==null)throw new IllegalStateException("Bridge FK missing");b.append(g).append('.').append(fk).append(" = ").append(target).append('\n');}
  }}return b.append("options interpret_as_algebra = true\n}\n").toString();
 }
 static JSONObject run(JSONObject p)throws Exception{
  long begin=System.nanoTime();JSONObject plan=SealedPlanRegistry.plan(p.getString("recipeId"));JSONArray definitions=plan.getJSONArray("stages"),timings=new JSONArray(),hashes=new JSONArray();
  SchemaCompiler s=new SchemaCompiler(p.getJSONObject("source"),"S"),t=new SchemaCompiler(p.getJSONObject("target"),"T");s.program();t.program();
  if(s.nativeSpec.optJSONArray("equations",new JSONArray()).length()>0||t.nativeSpec.optJSONArray("equations",new JSONArray()).length()>0)throw new UnsupportedOperationException("Sealed plan equations/checks are pinned; additional native equations require a separate reviewed plan");
  JSONObject first=definitions.getJSONObject(0),last=definitions.getJSONObject(definitions.length()-1),bindings=p.getJSONObject("bindings");
  AqlEnv sourceEnv=evaluate(SealedPlanRegistry.asset(first.getString("prefix")),new JSONArray());bind(s,(Schema)sourceEnv.get(Kind.SCHEMA,first.getString("inputSchema")),bindings,"source");
  AqlEnv targetEnv=evaluate(SealedPlanRegistry.asset(last.getString("prefix")),new JSONArray());bind(t,(Schema)targetEnv.get(Kind.SCHEMA,plan.getString("targetSchema")),bindings,"target");
  DataEvaluator data=new DataEvaluator(s,t,p.getJSONObject("data"));AqlEnv previous=null;JSONObject previousStage=null;
  for(Object o:definitions){JSONObject stage=(JSONObject)o;String prefix=SealedPlanRegistry.asset(stage.getString("prefix"));String literal;
   if(previous==null)literal=data.sourceLiteral(stage.getString("inputInstance"),stage.getString("inputSchema"),true);
   else{AqlEnv shape=evaluate(prefix,new JSONArray());literal=bridge((Instance)previous.get(Kind.INSTANCE,previousStage.getString("outputInstance")),(Schema)shape.get(Kind.SCHEMA,stage.getString("inputSchema")),stage);}
   String program=prefix+literal+SealedPlanRegistry.asset(stage.getString("tail"));hashes.put(CqlWorker.digest(program));previous=evaluate(program,timings);previousStage=stage;
  }
  JSONObject result=new JSONObject().put("status","evaluated").put("recipeId",p.getString("recipeId")).put("tables",data.result((Instance)previous.get(Kind.INSTANCE,last.getString("outputInstance")))).put("inputIdentities",data.identityManifest).put("targetSchema",t.nativeSpec).put("manifest",new JSONObject().put("bindings",bindings).put("source",s.manifest()).put("target",t.manifest()).put("plan",plan)).put("stageSha256",hashes).put("timing",new JSONObject().put("totalMs",(System.nanoTime()-begin)/1e6).put("stages",timings)).put("diagnostics",new JSONArray());
  for(int i=0;i<hashes.length();i++)result.put("stage"+(i+1)+"Sha256",hashes.get(i));for(String key:List.of("targetHash","baseRevision","sourceDataDigest"))if(p.has(key))result.put(key,p.get(key));return result;
 }
}
