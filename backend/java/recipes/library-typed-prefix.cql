options timeout = 20 num_threads = 1
typeside LibraryTypes = literal {
 external_types
  String -> "java.lang.String"
  Int -> "java.lang.Long"
  Real -> "java.math.BigDecimal"
  Bool -> "java.lang.Boolean"
 external_parsers
  String -> "x => x"
  Int -> "x => java.lang.Long.valueOf(x)"
  Real -> "x => new java.math.BigDecimal(x)"
  Bool -> "x => java.lang.Boolean.valueOf(x)"
 external_functions
  int64 : String -> Int = "x => { if(!/^[+-]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(x)) throw new Error('Int64 lexical error: '+x); return new java.math.BigDecimal(x).longValueExact(); }"
  positive64 : String -> Int = "x => { var n=new java.math.BigDecimal(x).longValueExact(); if(n<=0) throw new Error('positive Int64 required: '+x); return n; }"
  decimal : String -> Real = "x => { if(!/^[+-]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(x)) throw new Error('exact Real lexical error: '+x); return new java.math.BigDecimal(x); }"
  nonnegativeDecimal : String -> Real = "x => { if(!/^[+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(x)) throw new Error('nonnegative Real lexical error: '+x); var n=new java.math.BigDecimal(x); if(n.signum()<0) throw new Error('nonnegative Real required: '+x); return n; }"
  decimalBit : String -> Bool = "x => { var n=new java.math.BigDecimal(x); if(n.compareTo(java.math.BigDecimal.ZERO)==0) return java.lang.Boolean.FALSE; if(n.compareTo(java.math.BigDecimal.ONE)==0) return java.lang.Boolean.TRUE; throw new Error('Bool requires exact numeric 0 or 1: '+x); }"
}
schema LibraryStrings = literal : LibraryTypes {
 entities Loan Member Branch
 foreign_keys loan_member : Loan -> Member loan_branch : Loan -> Branch
 attributes loan_id loan_member_code amount active : Loan -> String
  member_code member_name : Member -> String
  branch_code branch_name : Branch -> String
}
schema TypedLibrary = literal : LibraryTypes {
 entities Loan Member Branch
 foreign_keys loan_member : Loan -> Member loan_branch : Loan -> Branch
 attributes loan_id loan_member_code : Loan -> String
  amount : Loan -> Real active : Loan -> Bool
  member_code member_name : Member -> String
  branch_code branch_name : Branch -> String
}
