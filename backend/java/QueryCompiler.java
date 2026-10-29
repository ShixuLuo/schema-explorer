import java.util.*;
import org.json.*;

final class QueryCompiler {
  final SchemaCompiler s,t;
  final Map<String,JSONObject> values=new LinkedHashMap<>();
  final JSONArray holes=new JSONArray();
  final Set<String> conversionsUsed=new LinkedHashSet<>();
  QueryCompiler(SchemaCompiler source,SchemaCompiler target,JSONArray assignments) {
    s=source;t=target;
    for(Object o:assignments){JSONObject a=(JSONObject)o;if(values.put(a.getString("holeId"),a.getJSONObject("value"))!=null)throw new IllegalArgumentException("Duplicate assignment");}
    for(var en:t.tables.entrySet()) {
      String id=en.getKey();hole(id+".from","sourceEntityBindings",null);
      for(Object o:en.getValue().getJSONArray("columns")) {
        JSONObject c=(JSONObject)o;if(SchemaCompiler.hidden(c))continue;
        hole(id+".attribute."+c.getString("id"),"scalarTerm",SchemaCompiler.type(c));
        if(en.getValue().getJSONArray("primaryKey").toList().contains(c.getString("id")))holes.getJSONObject(holes.length()-1).put("role","identity");
      }
      for(Object o:t.foreignKeys(id)){JSONObject f=(JSONObject)o;hole(id+".foreignKey."+f.getString("id"),"blockSubstitution",t.fkTarget(f));}
    }
    Set<String> allowed=new HashSet<>();for(Object o:holes)allowed.add(((JSONObject)o).getString("holeId"));
    for(String id:t.tables.keySet())allowed.add(id+".where");
    for(String id:values.keySet())if(!allowed.contains(id))throw new UnsupportedOperationException("Unknown hole ID: "+id);
  }
  void hole(String id,String kind,String expected){JSONObject h=new JSONObject().put("holeId",id).put("kind",kind).put("filled",values.containsKey(id));if(expected!=null)h.put("expectedType",expected);holes.put(h);}
  boolean complete(){for(Object o:holes)if(!((JSONObject)o).getBoolean("filled"))return false;return true;}
  static String variable(String v){if(!v.matches("[a-zA-Z_][a-zA-Z_0-9]*"))throw new IllegalArgumentException("Invalid variable");return v;}
  record Term(String text,String entity,String scalar){}
  Term term(JSONObject x,Map<String,String> vars){return term(x,vars,0);}
  Term term(JSONObject x,Map<String,String> vars,int depth) {
    SchemaCompiler.checkKeys(x,Set.of("tag","annotation","head","arguments"));
    if(depth>8||!x.getString("tag").equals("raw_term")||!x.isNull("annotation"))throw new UnsupportedOperationException("Only bounded unannotated terms supported");
    String h=x.getString("head");JSONArray args=x.getJSONArray("arguments");
    if(args.isEmpty()){if(!vars.containsKey(h))throw new IllegalArgumentException("Unbound variable: "+h);return new Term(variable(h),vars.get(h),null);}
    if(args.length()!=1)throw new UnsupportedOperationException("Only unary paths and registered conversions supported");
    Term base=term(args.getJSONObject(0),vars,depth+1);
    if(base.entity()==null) {
      if(!ScalarFunctions.TARGETS.containsKey(h))throw new IllegalArgumentException("Cannot traverse scalar: "+h);
      if(ScalarFunctions.TARGETS.get(h).equals(base.scalar()))return base;
      ScalarFunctions.Conversion conversion=ScalarFunctions.conversion(h,base.scalar());
      conversionsUsed.add(conversion.symbol());
      return new Term(conversion.symbol()+"("+base.text()+")",null,conversion.target());
    }
    String symbol=s.columns.get(base.entity()).get(h);
    if(symbol!=null)return new Term(symbol+"("+base.text()+")",null,SchemaCompiler.type(s.findColumn(base.entity(),h)));
    symbol=s.fks.get(base.entity()).get(h);
    if(symbol==null)throw new IllegalArgumentException("Unknown path: "+h);
    for(Object o:s.foreignKeys(base.entity())){JSONObject f=(JSONObject)o;if(f.getString("id").equals(h))return new Term(symbol+"("+base.text()+")",s.fkTarget(f),null);}
    throw new IllegalArgumentException("Unknown reference: "+h);
  }
  String program() {
    StringBuilder b=new StringBuilder("query Q = literal : "+s.name+" -> "+t.name+" {\n");
    for(var entry:t.tables.entrySet()) {
      String id=entry.getKey();b.append("entity ").append(t.entity(id)).append(" -> {\nfrom ");
      Map<String,String> vars=new LinkedHashMap<>();JSONObject from=values.get(id+".from");
      if(from==null)b.append("__HOLE__ : __SOURCE__\n");
      else for(Object o:from.getJSONArray("bindings")){JSONObject x=(JSONObject)o;String v=variable(x.getString("variable")),en=x.getString("entity");if(vars.put(v,en)!=null)throw new IllegalArgumentException("Duplicate variable");b.append(v).append(" : ").append(s.entity(en)).append(' ');}
      JSONObject where=values.get(id+".where");
      if(where!=null&&!where.getJSONArray("equations").isEmpty()){b.append("\nwhere\n");for(Object o:where.getJSONArray("equations")){JSONObject e=(JSONObject)o;b.append(term(e.getJSONObject("left"),vars).text()).append(" = ").append(term(e.getJSONObject("right"),vars).text()).append('\n');}}
      b.append("\nattributes\n");
      for(Object o:entry.getValue().getJSONArray("columns")){JSONObject c=(JSONObject)o;if(SchemaCompiler.hidden(c))continue;JSONObject a=values.get(id+".attribute."+c.getString("id"));b.append(t.column(id,c.getString("id"))).append(" -> ").append(a==null?"__HOLE__":term(a.getJSONObject("term"),vars).text()).append('\n');}
      b.append("foreign_keys\n");
      for(Object o:t.foreignKeys(id)) {
        JSONObject f=(JSONObject)o,a=values.get(id+".foreignKey."+f.getString("id"));b.append(t.fks.get(id).get(f.getString("id"))).append(" -> { ");
        if(a==null)b.append("__HOLE__ -> __HOLE__");
        else for(Object q:a.getJSONArray("bindings")){JSONObject sub=(JSONObject)q;b.append(variable(sub.getString("targetVariable"))).append(" -> ").append(term(sub.getJSONObject("term"),vars).text()).append(' ');}
        b.append("}\n");
      }
      b.append("}\n");
    }
    return b.append("}\n").toString();
  }
}
