schema Ledger = literal : Lexical {
 entities Borrow Patron Office
 foreign_keys borrower : Borrow -> Patron location : Borrow -> Office
 attributes
  borrow_id borrow_member borrow_amount borrow_active : Borrow -> String
  patron_code patron_name : Patron -> String
  office_code office_name : Office -> String
}
query SplitLibrary = literal : RawLibrary -> Ledger {
 entity Borrow -> { from x : Entry attributes borrow_id -> x.raw_id borrow_member -> x.raw_member borrow_amount -> x.raw_amount borrow_active -> x.raw_active foreign_keys borrower -> { x -> x } location -> { x -> x } }
 entity Patron -> { from x : Entry attributes patron_code -> x.raw_member patron_name -> x.raw_member_name }
 entity Office -> { from x : Entry attributes office_code -> x.raw_branch office_name -> x.raw_branch_name }
}
instance Repeated = eval SplitLibrary RawRows
instance UniqueRows = distinct Repeated
instance Collapsed = quotient_query UniqueRows {
 entity Patron -> { from p : Patron q : Patron where p.patron_code = q.patron_code }
 entity Office -> { from p : Office q : Office where p.office_code = q.office_code }
 options quotient_use_chase = true
}
