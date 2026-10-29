import java.util.*;
import catdata.*;
import catdata.cql.*;
import catdata.cql.exp.*;
public class SubstitutionSmoke {
 @SuppressWarnings({"rawtypes","unchecked"}) static Map<String,String> run(String equations) throws Exception {
  String program="typeside Ty = literal { external_types Text -> \"java.lang.String\" external_parsers Text -> \"x => x\" external_functions bang : Text -> Text = \"x => x+'!'\" }\n"+
    "schema S = literal : Ty { entities E attributes a b c : E -> Text }\n"+
    "instance Input = literal : S { generators x : E equations "+equations+" }\n"+
    "mapping Id = identity S\ninstance Result = sigma_chase Id Input { options chase_style = parallel }\n";
  Program<Exp<?>> parsed=AqlParserFactory.getParser().parseProgram(program);AqlEnv env=new AqlEnv(parsed);env.typing=new AqlTyping(parsed,false);
  for(String name:parsed.order){Exp<?> exp=parsed.exps.get(name);env.defs.put(name,exp.kind(),exp.eval(env,false));}
  Instance result=(Instance)env.get(Kind.INSTANCE,"Result");Object row=result.algebra().en("E").iterator().next();Map<String,String> values=new TreeMap<>();
  for(Object att:result.schema().atts.keySet())values.put(att.toString(),String.valueOf(result.algebra().att(att,row).obj()));return values;
 }
 public static void main(String[] args)throws Exception {
  List<String> chain=List.of("x.a = bang(x.b)","x.b = bang(x.c)","x.c = \"v\"");
  int[][] permutations={{0,1,2},{0,2,1},{1,0,2},{1,2,0},{2,0,1},{2,1,0}};
  for(int[] order:permutations){String eq="";for(int i:order)eq+=chain.get(i)+"\n";if(!run(eq).equals(Map.of("a","v!!","b","v!","c","v")))throw new AssertionError("Dependency chain");}
  if(!run("x.a = x.b x.b = x.c x.c = x.a x.a = \"v\"").equals(Map.of("a","v","b","v","c","v")))throw new AssertionError("Cycle");
  boolean failed=false;try{run("x.a = x.b x.b = \"v\" x.a = \"different\" x.c = \"v\"");}catch(RuntimeException expected){failed=true;}if(!failed)throw new AssertionError("Contradiction accepted");
  System.out.println("Six symbolic dependency orders, grounded cycle and contradiction check passed");
 }
}
