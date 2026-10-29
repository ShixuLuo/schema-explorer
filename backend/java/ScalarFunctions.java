import java.util.*;
import org.json.JSONObject;

/** Closed, typed operations; no caller-supplied executable functions. */
final class ScalarFunctions {
  record Conversion(String head, String source, String target, String symbol, String body) {}
  static final List<Conversion> ALL = List.of(
    new Conversion("cast:integer", "Text", "Integer", "textToInteger", "x => { if(!/^[+-]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(x)) throw new Error('Invalid integer text'); return new java.math.BigDecimal(x).toBigIntegerExact(); }"),
    new Conversion("cast:real", "Text", "exactReal", "textToReal", "x => { if(!/^[+-]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(x)) throw new Error('Invalid decimal text'); return new java.math.BigDecimal(x); }"),
    new Conversion("cast:boolean", "Text", "Bool", "textToBool", "x => { if(x==='true') return java.lang.Boolean.TRUE; if(x==='false') return java.lang.Boolean.FALSE; if(!/^[+-]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(x)) throw new Error('Invalid boolean text'); var n=new java.math.BigDecimal(x); if(n.compareTo(java.math.BigDecimal.ZERO)===0) return java.lang.Boolean.FALSE; if(n.compareTo(java.math.BigDecimal.ONE)===0) return java.lang.Boolean.TRUE; throw new Error('Boolean requires true, false, or exact 0/1'); }"),
    new Conversion("cast:real", "Integer", "exactReal", "integerToReal", "x => new java.math.BigDecimal(x)"),
    new Conversion("cast:integer", "exactReal", "Integer", "realToInteger", "x => x.toBigIntegerExact()"),
    new Conversion("cast:text", "Integer", "Text", "integerToText", "x => x.toString()"),
    new Conversion("cast:text", "exactReal", "Text", "realToText", "x => x.toPlainString()"),
    new Conversion("cast:text", "Bool", "Text", "boolToText", "x => x.toString()")
  );
  static final Map<String,String> TARGETS=Map.of("cast:integer","Integer","cast:real","exactReal","cast:boolean","Bool","cast:text","Text");
  static String declarations(Set<String> selected) {
    if(selected.isEmpty())return "";
    StringBuilder text=new StringBuilder(" external_functions\n");
    for(Conversion c:ALL)if(selected.contains(c.symbol()))text.append(c.symbol()).append(" : ").append(c.source()).append(" -> ").append(c.target()).append(" = ").append(JSONObject.quote(c.body())).append('\n');
    return text.toString();
  }
  static Conversion conversion(String head,String source) {
    return ALL.stream().filter(c->c.head().equals(head)&&c.source().equals(source)).findFirst().orElseThrow(()->new IllegalArgumentException("Unsupported conversion from "+source+" using "+head));
  }
}
