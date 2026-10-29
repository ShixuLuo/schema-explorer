import java.util.*;import java.nio.file.*;import org.json.*;
/** Deployment-owned registry and digest-pinned assets; no client CQL or asset paths. */
final class SealedPlanRegistry {
 static Path root(){return Path.of(System.getProperty("cql.recipe.dir"));}
 static String asset(String name)throws Exception{if(!name.matches("[a-zA-Z0-9_-]+[.](cql|json)"))throw new IllegalArgumentException("Invalid sealed asset name");JSONObject hashes=new JSONObject(Files.readString(root().resolve("manifest.json")));if(!hashes.has(name))throw new IllegalArgumentException("Unregistered sealed asset");String text=Files.readString(root().resolve(name));if(!CqlWorker.digest(text).equals(hashes.getString(name)))throw new IllegalStateException("Sealed asset digest mismatch");return text;}
 static JSONObject registry()throws Exception{return new JSONObject(asset("plans.json"));}
 static JSONObject plan(String id)throws Exception{JSONObject registry=registry();if(!registry.has(id))throw new UnsupportedOperationException("Unknown sealed plan");JSONObject plan=registry.getJSONObject(id);if(plan.getJSONArray("stages").isEmpty())throw new IllegalStateException("Empty sealed plan");return plan;}
 static JSONArray ids(){try{return new JSONArray(new TreeSet<>(registry().keySet()));}catch(Exception e){throw new IllegalStateException("Cannot load sealed plan registry",e);}}
}
