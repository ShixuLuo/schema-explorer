import java.nio.file.*;
import java.util.*;
import catdata.Program;
import catdata.cql.*;
import catdata.cql.exp.*;
import org.json.*;

public class CqlOracle {
  @SuppressWarnings({"unchecked", "rawtypes"})
  public static void main(String[] args) {
    try {
      Program<Exp<?>> program = AqlParserFactory.getParser().parseProgram(Files.readString(Path.of(args[0])));
      AqlEnv env = new AqlEnv(program);
      env.typing = new AqlTyping(program, false);
      AqlMultiDriver driver = new AqlMultiDriver(program, env);
      driver.start();
      env = driver.env;
      if (env.exn != null) throw env.exn;
      JSONObject all = new JSONObject();
      for (String name : program.order) {
        if (program.exps.get(name).kind() != Kind.INSTANCE) continue;
        Instance instance = (Instance)env.get(Kind.INSTANCE, name);
        JSONObject tables = new JSONObject();
        for (Object entity : instance.schema().ens) {
          JSONArray rows = new JSONArray();
          for (Object row : instance.algebra().en(entity)) {
            JSONObject cells = new JSONObject();
            cells.put("__id", instance.algebra().printX(entity, row).toString());
            for (Object fk : instance.schema().fksFrom(entity)) {
              Object targetEntity = ((catdata.Pair) instance.schema().fks.get(fk)).second;
              cells.put(fk.toString(), instance.algebra().printX(targetEntity, instance.algebra().fk(fk, row)).toString());
            }
            for (Object attribute : instance.schema().attsFrom(entity)) {
              Term value = instance.algebra().att(attribute, row);
              cells.put(attribute.toString(), value.obj() == null ? value.toString() : value.obj());
            }
            rows.put(cells);
          }
          tables.put(entity.toString(), rows);
        }
        all.put(name, tables);
      }
      System.out.println(all.toString(2));
      System.exit(0);
    } catch (Throwable error) {
      error.printStackTrace();
      System.exit(1);
    }
  }
}
