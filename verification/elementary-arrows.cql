options
 timeout = 20
 num_threads = 1

typeside Ty = literal {
 types V
 constants v10 v20 n : V
}
schema S = literal : Ty {
 entities A B
 attributes value : A -> V
}
schema T = literal : Ty {
 entities A B
 foreign_keys f : A -> B
 attributes value : A -> V
}
mapping F = literal : S -> T {
 entity A -> A
 attributes value -> value
 entity B -> B
}
instance I = literal : S {
 generators a1 a2 : A b1 b2 : B
 equations a1.value = v10 a2.value = v20
}
instance AddedSigma = sigma F I
instance AddedPi = pi F I
schema WithConstant = literal : Ty {
 entities A B
 attributes value added : A -> V
}
mapping Constant = literal : WithConstant -> S {
 entity A -> A
 attributes value -> value added -> lambda x. n
 entity B -> B
}
instance AddedConstant = delta Constant I

# Both directions exercise incoming X -> A and downstream B -> C.
schema ChainS = literal : Ty {
 entities X A B C
 foreign_keys incoming : X -> A next : B -> C
 attributes value : A -> V xvalue : X -> V
}
schema ChainT = literal : Ty {
 entities X A B C
 foreign_keys incoming : X -> A f : A -> B next : B -> C
 attributes value : A -> V xvalue : X -> V
}
mapping Chain = literal : ChainS -> ChainT {
 entity X -> X
 foreign_keys incoming -> incoming
 attributes xvalue -> xvalue
 entity A -> A
 attributes value -> value
 entity B -> B
 foreign_keys next -> next
 entity C -> C
}
instance ChainInput = literal : ChainS {
 generators x1 x2 : X a1 a2 : A b1 b2 : B c1 : C
 equations
 x1.incoming = a1 x2.incoming = a2
 x1.xvalue = v10 x2.xvalue = v20
 a1.value = v10 a2.value = v20
 b1.next = c1 b2.next = c1
}
instance ChainSigma = sigma Chain ChainInput
instance ChainPi = pi Chain ChainInput
instance DuplicateInput = literal : ChainS {
 generators x1 x2 : X a1 a2 : A b1 : B c1 : C
 equations
 x1.incoming = a1 x2.incoming = a1
 x1.xvalue = v10 x2.xvalue = v10
 a1.value = v10 a2.value = v10
 b1.next = c1
}
instance DuplicateSigma = sigma Chain DuplicateInput
instance DuplicatePi = pi Chain DuplicateInput
instance EmptyTargetInput = literal : ChainS {
 generators x1 : X a1 : A
 equations x1.incoming = a1 x1.xvalue = v10 a1.value = v10
}
instance EmptyTargetSigma = sigma Chain EmptyTargetInput
instance EmptyTargetPi = pi Chain EmptyTargetInput
