options
  timeout = 20
  num_threads = 1

typeside Ty = literal {
  external_types
    TextCell -> "java.lang.String"
    IntegerCell -> "java.lang.String"
  external_parsers
    TextCell -> "x => x"
    IntegerCell -> "x => x"
}
schema Source = literal : Ty {
  entities A B
  attributes
    av : A -> TextCell
    an : A -> IntegerCell
    bv : B -> TextCell
    bn : B -> IntegerCell
}
schema Target = literal : Ty {
  entities T
  attributes
    value : T -> TextCell
    number : T -> IntegerCell
}
mapping F = literal : Source -> Target {
  entity A -> T
  attributes av -> value an -> number
  entity B -> T
  attributes bv -> value bn -> number
}
instance Input = literal : Source {
  generators
    a0 : A
    a1 : A
    a2 : A
    a3 : A
    a4 : A
    a5 : A
    b0 : B
    b1 : B
    b2 : B
    b3 : B
  equations
    a0.av = "vshared"
    a0.an = "v9223372036854775807"
    a1.av = "vshared"
    a1.an = "v9223372036854775807"
    a2.av = "vleft"
    a2.an = "v2"
    a3.av = "v"
    a3.an = "v3"
    a4.av = "n"
    a4.an = "v4"
    a5.av = "vline\n\"quoted\"\\path"
    a5.an = "v5"
    b0.bv = "vshared"
    b0.bn = "v9223372036854775807"
    b1.bv = "vright"
    b1.bn = "v2"
    b2.bv = "v"
    b2.bn = "v3"
    b3.bv = "n"
    b3.bn = "v4"
}
instance Sum = sigma F Input
instance Matched = pi F Input
instance Copies = delta F Matched
instance Mixed = sigma F Copies
