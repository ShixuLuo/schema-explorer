options timeout = 20 num_threads = 1
typeside Lexical = literal { external_types String -> "java.lang.String" external_parsers String -> "x => x" }
schema RawLibrary = literal : Lexical {
 entities Entry
 attributes
  raw_id raw_member raw_member_name raw_branch raw_branch_name raw_amount raw_active : Entry -> String
}
