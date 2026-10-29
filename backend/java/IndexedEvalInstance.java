import java.util.*;
import catdata.cql.*;
import catdata.cql.fdm.EvalInstance;

/** The official evaluator and validators, with an indexed generator-to-entity lookup. */
@SuppressWarnings({"rawtypes","unchecked"})
final class IndexedEvalInstance extends EvalInstance {
  // No field initializer: the superclass validates through this override in its constructor.
  private Instance.IMap index;
  IndexedEvalInstance(Query query,Instance input,AqlOptions options) { super(query,input,options); }
  @Override public synchronized Instance.IMap gens() {
    if(index==null) {
      Map<Object,Object> entries=new LinkedHashMap<>();
      super.gens().entrySet((generator,entity)->{
        Object old=entries.putIfAbsent(generator,entity);
        if(old!=null&&!old.equals(entity))throw new IllegalArgumentException("Generator belongs to multiple entities");
      });
      index=Instance.mapToIMap(entries);
    }
    return index;
  }
}
