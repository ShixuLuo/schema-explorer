options
 timeout = 240
 num_threads = 1

typeside TypedTy = literal {
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
schema NormalizedStrings = literal : TypedTy {
 entities Ticket Market Coupon Airport State
 foreign_keys
 Ticket_OriginAirport : Ticket -> Airport
 Market_ticket : Market -> Ticket
 Market_OriginAirport : Market -> Airport
 Market_DestAirport : Market -> Airport
 Coupon_market : Coupon -> Market
 Coupon_OriginAirport : Coupon -> Airport
 Coupon_DestAirport : Coupon -> Airport
 Airport_State : Airport -> State
 attributes
 Ticket_ItinID : Ticket -> String
 Ticket_Coupons : Ticket -> String
 Ticket_Year : Ticket -> String
 Ticket_Quarter : Ticket -> String
 Ticket_RoundTrip : Ticket -> String
 Ticket_OnLine : Ticket -> String
 Ticket_DollarCred : Ticket -> String
 Ticket_FarePerMile : Ticket -> String
 Ticket_RPCarrier : Ticket -> String
 Ticket_Passengers : Ticket -> String
 Ticket_ItinFare : Ticket -> String
 Ticket_BulkFare : Ticket -> String
 Ticket_Distance : Ticket -> String
 Ticket_DistanceGroup : Ticket -> String
 Ticket_MilesFlown : Ticket -> String
 Ticket_ItinGeoType : Ticket -> String
 Market_ItinID : Market -> String
 Market_MktID : Market -> String
 Market_MktCoupons : Market -> String
 Market_Year : Market -> String
 Market_Quarter : Market -> String
 Market_AirportGroup : Market -> String
 Market_WacGroup : Market -> String
 Market_TkCarrierChange : Market -> String
 Market_TkCarrierGroup : Market -> String
 Market_OpCarrierChange : Market -> String
 Market_OpCarrierGroup : Market -> String
 Market_RPCarrier : Market -> String
 Market_TkCarrier : Market -> String
 Market_OpCarrier : Market -> String
 Market_BulkFare : Market -> String
 Market_Passengers : Market -> String
 Market_MktFare : Market -> String
 Market_MktDistance : Market -> String
 Market_MktDistanceGroup : Market -> String
 Market_MktMilesFlown : Market -> String
 Market_NonStopMiles : Market -> String
 Market_ItinGeoType : Market -> String
 Market_MktGeoType : Market -> String
 Coupon_MktID : Coupon -> String
 Coupon_SeqNum : Coupon -> String
 Coupon_Coupons : Coupon -> String
 Coupon_Year : Coupon -> String
 Coupon_Quarter : Coupon -> String
 Coupon_Break : Coupon -> String
 Coupon_CouponType : Coupon -> String
 Coupon_TkCarrier : Coupon -> String
 Coupon_OpCarrier : Coupon -> String
 Coupon_RPCarrier : Coupon -> String
 Coupon_Passengers : Coupon -> String
 Coupon_FareClass : Coupon -> String
 Coupon_Distance : Coupon -> String
 Coupon_DistanceGroup : Coupon -> String
 Coupon_Gateway : Coupon -> String
 Coupon_ItinGeoType : Coupon -> String
 Coupon_CouponGeoType : Coupon -> String
 Airport_Code : Airport -> String
 Airport_AirportID : Airport -> String
 Airport_AirportSeqID : Airport -> String
 Airport_CityMarketID : Airport -> String
 Airport_Country : Airport -> String
 State_Fips : State -> String
 State_Code : State -> String
 State_Name : State -> String
 State_Wac : State -> String
}
schema TypedTarget = literal : TypedTy {
 entities Ticket Market Coupon Airport State
 foreign_keys
 Ticket_OriginAirport : Ticket -> Airport
 Market_ticket : Market -> Ticket
 Market_OriginAirport : Market -> Airport
 Market_DestAirport : Market -> Airport
 Coupon_market : Coupon -> Market
 Coupon_OriginAirport : Coupon -> Airport
 Coupon_DestAirport : Coupon -> Airport
 Airport_State : Airport -> State
 attributes
 Ticket_ItinID : Ticket -> Int
 Ticket_Coupons : Ticket -> Int
 Ticket_Year : Ticket -> Int
 Ticket_Quarter : Ticket -> Int
 Ticket_RoundTrip : Ticket -> Bool
 Ticket_OnLine : Ticket -> Bool
 Ticket_DollarCred : Ticket -> Bool
 Ticket_FarePerMile : Ticket -> Real
 Ticket_RPCarrier : Ticket -> String
 Ticket_Passengers : Ticket -> Real
 Ticket_ItinFare : Ticket -> Real
 Ticket_BulkFare : Ticket -> Bool
 Ticket_Distance : Ticket -> Real
 Ticket_DistanceGroup : Ticket -> Int
 Ticket_MilesFlown : Ticket -> Real
 Ticket_ItinGeoType : Ticket -> Int
 Market_ItinID : Market -> Int
 Market_MktID : Market -> Int
 Market_MktCoupons : Market -> Int
 Market_Year : Market -> Int
 Market_Quarter : Market -> Int
 Market_AirportGroup : Market -> String
 Market_WacGroup : Market -> String
 Market_TkCarrierChange : Market -> Bool
 Market_TkCarrierGroup : Market -> String
 Market_OpCarrierChange : Market -> Bool
 Market_OpCarrierGroup : Market -> String
 Market_RPCarrier : Market -> String
 Market_TkCarrier : Market -> String
 Market_OpCarrier : Market -> String
 Market_BulkFare : Market -> Bool
 Market_Passengers : Market -> Real
 Market_MktFare : Market -> Real
 Market_MktDistance : Market -> Real
 Market_MktDistanceGroup : Market -> Int
 Market_MktMilesFlown : Market -> Real
 Market_NonStopMiles : Market -> Real
 Market_ItinGeoType : Market -> Int
 Market_MktGeoType : Market -> Int
 Coupon_MktID : Coupon -> Int
 Coupon_SeqNum : Coupon -> Int
 Coupon_Coupons : Coupon -> Int
 Coupon_Year : Coupon -> Int
 Coupon_Quarter : Coupon -> Int
 Coupon_Break : Coupon -> String
 Coupon_CouponType : Coupon -> String
 Coupon_TkCarrier : Coupon -> String
 Coupon_OpCarrier : Coupon -> String
 Coupon_RPCarrier : Coupon -> String
 Coupon_Passengers : Coupon -> Real
 Coupon_FareClass : Coupon -> String
 Coupon_Distance : Coupon -> Real
 Coupon_DistanceGroup : Coupon -> Int
 Coupon_Gateway : Coupon -> Bool
 Coupon_ItinGeoType : Coupon -> Int
 Coupon_CouponGeoType : Coupon -> Int
 Airport_Code : Airport -> String
 Airport_AirportID : Airport -> Int
 Airport_AirportSeqID : Airport -> Int
 Airport_CityMarketID : Airport -> Int
 Airport_Country : Airport -> String
 State_Fips : State -> String
 State_Code : State -> String
 State_Name : State -> String
 State_Wac : State -> Int
}
