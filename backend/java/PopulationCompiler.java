import java.util.*;
import org.json.*;
import catdata.*;
import catdata.cql.*;
import catdata.cql.exp.*;

/** Generic union of typed query branches, followed by an explicit key quotient. */
final class PopulationCompiler {
  record Branch(String entity,String id,String occurrence,JSONObject from,JSONObject where,Map<String,JSONObject> attributes,Map<String,JSONObject> references) {}
  final SchemaCompiler source,target,raw;
  final Map<String,JSONObject> values=new LinkedHashMap<>();
  final Map<String,List<Branch>> branches=new LinkedHashMap<>();
  final Map<String,List<String>> keys=new LinkedHashMap<>();
  final JSONArray holes=new JSONArray();
  SchemaCompiler occurrences;
  QueryCompiler extraction;
  String definitions;
  final Map<String,Object> attributeSymbols=new HashMap<>(), referenceSymbols=new HashMap<>();
  final Map<String,Map<String,String>> occurrenceReferences=new LinkedHashMap<>();
  static boolean applies(JSONArray assignments){for(Object item:assignments)if(((JSONObject)item).getString("holeId").endsWith(".population"))return true;return false;}
  static JSONObject copy(JSONObject value){return new JSONObject(value.toString());}
  static Map<String,JSONObject> indexed(JSONArray items,String key){Map<String,JSONObject> result=new LinkedHashMap<>();for(Object item:items){JSONObject value=(JSONObject)item;if(result.put(value.getString(key),value)!=null)throw new IllegalArgumentException("Duplicate "+key);}return result;}
  PopulationCompiler(SchemaCompiler s,SchemaCompiler t,JSONArray assignments) {
    source=s;target=t;raw=new SchemaCompiler(t.nativeSpec,t.name,false);
    JSONArray legacy=new JSONArray();
    Set<String> populationIds=new HashSet<>();for(String entity:t.tables.keySet())populationIds.add(entity+".population");
    for(Object item:assignments){JSONObject a=(JSONObject)item;String id=a.getString("holeId");if(values.put(id,a.getJSONObject("value"))!=null)throw new IllegalArgumentException("Duplicate assignment");if(!populationIds.contains(id))legacy.put(a);}
    QueryCompiler defaults=new QueryCompiler(s,t,legacy);
    int serial=0;
    for(String entity:t.tables.keySet()) {
      JSONObject value=values.get(entity+".population");List<Branch> list=new ArrayList<>();branches.put(entity,list);
      List<String> key=new ArrayList<>();keys.put(entity,key);
      if(value==null) {
        Map<String,JSONObject> atts=new LinkedHashMap<>(),refs=new LinkedHashMap<>();
        for(String col:t.columns.get(entity).keySet())atts.put(col,values.get(entity+".attribute."+col));
        for(Object item:t.foreignKeys(entity)){JSONObject fk=(JSONObject)item;refs.put(fk.getString("id"),values.get(entity+".foreignKey."+fk.getString("id")));}
        list.add(new Branch(entity,"default","occ"+(serial++),values.get(entity+".from"),values.get(entity+".where"),atts,refs));
        for(Object item:defaults.holes){JSONObject h=(JSONObject)item;if(ownedIds(entity).contains(h.getString("holeId")))holes.put(h);}
        continue;
      }
      for(String id:ownedIds(entity))if(!id.equals(entity+".population")&&values.containsKey(id))throw new IllegalArgumentException("Population replaces the whole mapping for "+entity+"; remove assignment "+id);
      SchemaCompiler.checkKeys(value,Set.of("population"));JSONObject pop=value.getJSONObject("population");SchemaCompiler.checkKeys(pop,Set.of("deduplicateBy","branches"));
      for(Object item:pop.getJSONArray("deduplicateBy")){String id=(String)item;if(!t.columns.get(entity).containsKey(id)||key.contains(id))throw new IllegalArgumentException("Deduplication keys must be distinct visible target attributes: "+entity);key.add(id);}
      JSONArray input=pop.getJSONArray("branches");if(input.length()>64)throw new IllegalArgumentException("At most 64 population branches per entity");Set<String> names=new HashSet<>();
      for(Object item:input) {
        JSONObject b=(JSONObject)item;SchemaCompiler.checkKeys(b,Set.of("id","bindings","where","attributes","foreignKeys"));String id=b.getString("id");if(id.isBlank()||id.length()>120)throw new IllegalArgumentException("Invalid branch ID");if(!names.add(id))throw new IllegalArgumentException("Duplicate population branch: "+id);
        JSONArray bindings=b.getJSONArray("bindings");if(bindings.length()>16)throw new IllegalArgumentException("At most 16 source bindings per branch");
        Set<String> vars=new HashSet<>();for(Object binding:bindings){JSONObject v=(JSONObject)binding;SchemaCompiler.checkKeys(v,Set.of("variable","entity"));if(!vars.add(QueryCompiler.variable(v.getString("variable"))))throw new IllegalArgumentException("Duplicate source variable");s.entity(v.getString("entity"));}
        Map<String,JSONObject> atts=new LinkedHashMap<>(),refs=new LinkedHashMap<>();
        for(Object attribute:b.getJSONArray("attributes")){JSONObject a=(JSONObject)attribute;SchemaCompiler.checkKeys(a,Set.of("columnId","term"));String col=a.getString("columnId");if(!t.columns.get(entity).containsKey(col)||atts.put(col,new JSONObject().put("term",a.getJSONObject("term")))!=null)throw new IllegalArgumentException("Unknown or duplicate branch attribute: "+col);}
        if(!atts.keySet().equals(t.columns.get(entity).keySet()))throw new IllegalArgumentException("Branch "+entity+"/"+id+" must map every target attribute and nongenerated primary key");
        for(Object reference:b.getJSONArray("foreignKeys")){JSONObject f=(JSONObject)reference;SchemaCompiler.checkKeys(f,Set.of("foreignKeyId","branch","bindings"));String fid=f.getString("foreignKeyId");if(!t.fks.get(entity).containsKey(fid)||refs.put(fid,new JSONObject().put("bindings",f.getJSONArray("bindings")).put("branch",f.opt("branch")))!=null)throw new IllegalArgumentException("Unknown or duplicate branch reference: "+fid);}
        if(!refs.keySet().equals(t.fks.get(entity).keySet()))throw new IllegalArgumentException("Branch "+entity+"/"+id+" must map every target reference");
        list.add(new Branch(entity,id,"occ"+(serial++),new JSONObject().put("bindings",bindings),new JSONObject().put("equations",b.getJSONArray("where")),atts,refs));
      }
      holes.put(new JSONObject().put("holeId",entity+".population").put("kind","populationPlan").put("filled",true));
    }
    for(String id:values.keySet())if(id.endsWith(".population")&&!populationIds.contains(id))throw new IllegalArgumentException("Unknown population entity: "+id);
  }
  Set<String> ownedIds(String entity){Set<String> ids=new HashSet<>(List.of(entity+".population",entity+".from",entity+".where"));for(String col:target.columns.get(entity).keySet())ids.add(entity+".attribute."+col);for(String fk:target.fks.get(entity).keySet())ids.add(entity+".foreignKey."+fk);return ids;}
  boolean complete(){for(Object item:holes)if(!((JSONObject)item).getBoolean("filled"))return false;return true;}
  Branch destination(JSONObject fk,JSONObject assignment) {
    List<Branch> choices=branches.get(target.fkTarget(fk));String id=assignment.optString("branch","");
    if(id.isEmpty()&&choices.size()==1)return choices.get(0);
    return choices.stream().filter(b->b.id().equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("Reference "+fk.getString("id")+" must select an existing destination branch; choices="+choices.stream().map(Branch::id).toList()));
  }
  String definitions() {
    if(definitions!=null)return definitions;
    if(!complete())return SchemaCompiler.TYPES+source.program()+target.program()+"// Missing population or legacy assignments\n";
    JSONArray tables=new JSONArray(),fks=new JSONArray(),expanded=new JSONArray();Map<String,String> fkNative=new LinkedHashMap<>();
    for(List<Branch> list:branches.values())for(Branch branch:list) {
      JSONObject table=copy(target.tables.get(branch.entity())).put("id",branch.occurrence());tables.put(table);
      expanded.put(new JSONObject().put("holeId",branch.occurrence()+".from").put("value",branch.from()));
      if(branch.where()!=null)expanded.put(new JSONObject().put("holeId",branch.occurrence()+".where").put("value",branch.where()));
      for(var attribute:branch.attributes().entrySet())expanded.put(new JSONObject().put("holeId",branch.occurrence()+".attribute."+attribute.getKey()).put("value",attribute.getValue()));
      for(Object item:target.foreignKeys(branch.entity())) {
        JSONObject fk=(JSONObject)item,assignment=branch.references().get(fk.getString("id"));Branch dest=destination(fk,assignment);
        String fid=branch.occurrence()+"_fk"+fks.length();fkNative.put(fid,fk.getString("id"));
        occurrenceReferences.computeIfAbsent(branch.occurrence(),k->new LinkedHashMap<>()).put(fk.getString("id"),fid);
        fks.put(copy(fk).put("id",fid).put("source_table",branch.occurrence()).put("target_table",dest.occurrence()));
        Set<String> required=new HashSet<>();for(Object binding:dest.from().getJSONArray("bindings"))required.add(((JSONObject)binding).getString("variable"));
        Set<String> supplied=new HashSet<>();for(Object binding:assignment.getJSONArray("bindings")){JSONObject sub=(JSONObject)binding;SchemaCompiler.checkKeys(sub,Set.of("targetVariable","term"));if(!supplied.add(sub.getString("targetVariable")))throw new IllegalArgumentException("Duplicate reference substitution");}
        if(!required.equals(supplied))throw new IllegalArgumentException("Reference "+fk.getString("id")+" must bind exactly the destination branch variables "+required);
        expanded.put(new JSONObject().put("holeId",branch.occurrence()+".foreignKey."+fid).put("value",new JSONObject().put("bindings",assignment.getJSONArray("bindings"))));
      }
    }
    occurrences=new SchemaCompiler(new JSONObject().put("tables",tables).put("foreign_keys",fks).put("equations",new JSONArray()),"O",false);
    extraction=new QueryCompiler(source,occurrences,expanded);
    String query=extraction.program();
    StringBuilder b=new StringBuilder(SchemaCompiler.types(extraction.conversionsUsed)+source.program()+raw.program()+occurrences.program()+query);
    b.append("mapping Collect = literal : O -> ").append(raw.name).append(" {\n");
    for(List<Branch> list:branches.values())for(Branch branch:list) {
      b.append("entity ").append(occurrences.entity(branch.occurrence())).append(" -> ").append(raw.entity(branch.entity())).append("\nforeign_keys\n");
      for(var fk:occurrences.fks.get(branch.occurrence()).entrySet())b.append(fk.getValue()).append(" -> ").append(raw.fks.get(branch.entity()).get(fkNative.get(fk.getKey()))).append('\n');
      b.append("attributes\n");
      for(String col:target.columns.get(branch.entity()).keySet())b.append(occurrences.column(branch.occurrence(),col)).append(" -> ").append(raw.column(branch.entity(),col)).append('\n');
    }
    return definitions=b.append("}\n").toString();
  }
  String instances(DataEvaluator data) {
    StringBuilder b=new StringBuilder(data.sourceLiteral("Input",source.name,true)).append(source.checks("Input","SourceRule"));
    b.append("instance Occurrences = eval Q Input\ninstance Collected = ").append("sigma_chase Collect Occurrences { options chase_style = parallel }\n");
    boolean quotient=keys.values().stream().anyMatch(k->!k.isEmpty());
    if(quotient) {
      b.append("instance Result = quotient_query Collected {\n");
      for(String entity:keys.keySet())if(!keys.get(entity).isEmpty()) {
        b.append("entity ").append(raw.entity(entity)).append(" -> { from a : ").append(raw.entity(entity)).append(" b : ").append(raw.entity(entity)).append(" where ");
        for(String key:keys.get(entity))b.append("a.").append(raw.column(entity,key)).append(" = b.").append(raw.column(entity,key)).append(' ');
        b.append("}\n");
      }
      b.append("options quotient_use_chase = false\n}\n");
    } else b.append("instance Result = Collected\n");
    return b.append(raw.checks("Result","TargetRule")).toString();
  }
  @SuppressWarnings({"rawtypes","unchecked"}) Object scalar(Instance instance,Branch branch,String column,Object row) {
    Object value=instance.algebra().att(attributeSymbols.get(occurrences.column(branch.occurrence(),column)),row).obj();
    if(value==null)throw new IllegalArgumentException("Undetermined population value: "+branch.entity()+"."+column);
    return DataEvaluator.canonical(target.findColumn(branch.entity(),column),value instanceof Boolean?value:value.toString());
  }
  @SuppressWarnings("rawtypes") String key(Instance instance,Branch branch,Object row) {
    JSONArray value=new JSONArray();for(String col:keys.get(branch.entity()))value.put(scalar(instance,branch,col,row));return value.toString();
  }
  @SuppressWarnings({"rawtypes","unchecked"}) void checkConflicts(Instance instance) {
    for(Object symbol:instance.schema().atts.keySet())attributeSymbols.put(symbol.toString(),symbol);
    for(Object symbol:instance.schema().fks.keySet())referenceSymbols.put(symbol.toString(),symbol);
    Map<String,Map<Object,Integer>> identities=new LinkedHashMap<>();
    for(List<Branch> list:branches.values())for(Branch branch:list){Map<Object,Integer> ids=new HashMap<>();for(Object row:instance.algebra().en(occurrences.entity(branch.occurrence())))ids.put(row,ids.size());identities.put(branch.occurrence(),ids);}
    for(String entity:target.tables.keySet())if(!keys.get(entity).isEmpty()) {
      Map<String,String> groups=new HashMap<>();
      for(Branch branch:branches.get(entity))for(Object row:instance.algebra().en(occurrences.entity(branch.occurrence()))) {
        JSONArray signature=new JSONArray();for(String col:target.columns.get(entity).keySet())signature.put(scalar(instance,branch,col,row));
        for(Object item:target.foreignKeys(entity)) {
          JSONObject fk=(JSONObject)item;Branch dest=destination(fk,branch.references().get(fk.getString("id")));
          String symbol=occurrences.fks.get(branch.occurrence()).get(occurrenceReferences.get(branch.occurrence()).get(fk.getString("id")));
          Object linked=instance.algebra().fk(referenceSymbols.get(symbol),row);
          signature.put(keys.get(dest.entity()).isEmpty()?dest.occurrence()+":"+identities.get(dest.occurrence()).get(linked):key(instance,dest,linked));
        }
        String k=key(instance,branch,row),previous=groups.putIfAbsent(k,signature.toString());
        if(previous!=null&&!previous.equals(signature.toString()))throw new IllegalArgumentException("Conflicting attributes or references for deduplication key in "+target.tables.get(entity).getString("name")+"; no representative was selected");
      }
    }
  }
  // The closed typeside has ground Java scalars, so typed key hashing supplies a
  // spanning set of exactly the equations denoted by the displayed quotient query.
  // CQL performs the congruence closure and validates the instance. Keep the native
  // instance: the pinned release's SaturatedInstance wrapper can collide row IDs
  // across entities after large quotients. The displayed query uses its safe prover.
  @SuppressWarnings({"rawtypes","unchecked"}) Instance nativeQuotient(Instance input,AqlOptions options) {
    Map<String,Object> symbols=new HashMap<>();for(Object symbol:input.schema().atts.keySet())symbols.put(symbol.toString(),symbol);
    Map<String,Set<Pair<Object,Object>>> pairs=new LinkedHashMap<>();
    for(String entity:target.tables.keySet())if(!keys.get(entity).isEmpty()) {
      Map<List<Object>,Object> groups=new HashMap<>();Set<Pair<Object,Object>> equalities=new LinkedHashSet<>();
      for(Object row:input.algebra().en(raw.entity(entity))) {
        List<Object> key=new ArrayList<>();for(String column:keys.get(entity)) {
          Object value=input.algebra().att(symbols.get(raw.column(entity,column)),row).obj();
          if(value==null)throw new IllegalArgumentException("Undetermined quotient key");
          key.add(value);
        }
        Object representative=groups.putIfAbsent(key,row);if(representative!=null)equalities.add(new Pair<>(representative,row));
      }
      pairs.put(raw.entity(entity),equalities);
    }
    return new catdata.cql.fdm.SigmaChaseAlgebra(Mapping.id(input.schema()),input,pairs,options).theInst;
  }
  @SuppressWarnings({"rawtypes","unchecked"}) AqlEnv evaluate(String program) throws Exception {
    long parsing=System.nanoTime();System.err.println("[cql-stage] {\"stage\":\"Parse\",\"event\":\"start\"}");
    Program<Exp<?>> parsed=AqlParserFactory.getParser().parseProgram(program);AqlEnv env=new AqlEnv(parsed);env.typing=new AqlTyping(parsed,false);
    System.err.println("[cql-stage] "+new JSONObject().put("stage","Parse").put("event","end").put("elapsedMs",(System.nanoTime()-parsing)/1e6));
    Map<String,Integer> counts=new LinkedHashMap<>();
    for(String name:parsed.order) {
      Exp<?> exp=parsed.exps.get(name);
      if(!Set.of(Kind.TYPESIDE,Kind.SCHEMA,Kind.QUERY,Kind.MAPPING,Kind.INSTANCE,Kind.CONSTRAINTS,Kind.PRAGMA).contains(exp.kind()))throw new IllegalArgumentException("Prohibited expression");
      if(name.equals("Result")){Instance collected=(Instance)env.get(Kind.INSTANCE,"Collected");for(String en:target.tables.keySet())if(keys.get(en).isEmpty())counts.put(en,collected.algebra().size(raw.entity(en)));}
      long started=System.nanoTime();System.err.println("[cql-stage] "+new JSONObject().put("stage",name).put("event","start"));
      Object value=name.equals("Occurrences")?new IndexedEvalInstance((Query)env.get(Kind.QUERY,"Q"),(Instance)env.get(Kind.INSTANCE,"Input"),env.defaults):name.equals("Result")&&keys.values().stream().anyMatch(k->!k.isEmpty())?nativeQuotient((Instance)env.get(Kind.INSTANCE,"Collected"),env.defaults):exp.eval(env,false);env.defs.put(name,exp.kind(),value);if(value instanceof Pragma pragma)pragma.execute();
      if(name.equals("Occurrences"))checkConflicts((Instance)value);
      System.err.println("[cql-stage] "+new JSONObject().put("stage",name).put("event","end").put("elapsedMs",(System.nanoTime()-started)/1e6));
      if(name.equals("Result")){Instance result=(Instance)value;for(String en:counts.keySet())if(counts.get(en)!=result.algebra().size(raw.entity(en)))throw new IllegalArgumentException("Deduplication changed non-deduplicated entity "+en);}
    }
    return env;
  }
}
