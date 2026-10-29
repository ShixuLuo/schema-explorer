query TypeLibrary = literal : LibraryStrings -> TypedLibrary {
 entity Loan -> { from l : Loan attributes loan_id -> l.loan_id loan_member_code -> l.loan_member_code amount -> decimal(l.amount) active -> decimalBit(l.active) foreign_keys loan_member -> { m -> l.loan_member } loan_branch -> { b -> l.loan_branch } }
 entity Member -> { from m : Member attributes member_code -> m.member_code member_name -> m.member_name }
 entity Branch -> { from b : Branch attributes branch_code -> b.branch_code branch_name -> b.branch_name }
}
instance LibraryResult = eval TypeLibrary LibraryRows
constraints member_consistency = literal : TypedLibrary { forall l:Loan -> where l.loan_member_code = l.loan_member.member_code }
command check_member_consistency = check member_consistency LibraryResult
constraints member_used = literal : TypedLibrary { forall m:Member -> exists l:Loan where l.loan_member = m }
command check_member_used = check member_used LibraryResult
