query PostTyping = literal : NormalizedStrings -> TypedTarget {
 entity Ticket -> { from x:Ticket
 attributes
 Ticket_ItinID -> int64(x.Ticket_ItinID)
 Ticket_Coupons -> int64(x.Ticket_Coupons)
 Ticket_Year -> positive64(x.Ticket_Year)
 Ticket_Quarter -> positive64(x.Ticket_Quarter)
 Ticket_RoundTrip -> decimalBit(x.Ticket_RoundTrip)
 Ticket_OnLine -> decimalBit(x.Ticket_OnLine)
 Ticket_DollarCred -> decimalBit(x.Ticket_DollarCred)
 Ticket_FarePerMile -> decimal(x.Ticket_FarePerMile)
 Ticket_RPCarrier -> x.Ticket_RPCarrier
 Ticket_Passengers -> decimal(x.Ticket_Passengers)
 Ticket_ItinFare -> decimal(x.Ticket_ItinFare)
 Ticket_BulkFare -> decimalBit(x.Ticket_BulkFare)
 Ticket_Distance -> nonnegativeDecimal(x.Ticket_Distance)
 Ticket_DistanceGroup -> int64(x.Ticket_DistanceGroup)
 Ticket_MilesFlown -> nonnegativeDecimal(x.Ticket_MilesFlown)
 Ticket_ItinGeoType -> int64(x.Ticket_ItinGeoType)
 foreign_keys
 Ticket_OriginAirport -> {x -> x.Ticket_OriginAirport}
 }
 entity Market -> { from x:Market
 attributes
 Market_ItinID -> int64(x.Market_ItinID)
 Market_MktID -> int64(x.Market_MktID)
 Market_MktCoupons -> int64(x.Market_MktCoupons)
 Market_Year -> positive64(x.Market_Year)
 Market_Quarter -> positive64(x.Market_Quarter)
 Market_AirportGroup -> x.Market_AirportGroup
 Market_WacGroup -> x.Market_WacGroup
 Market_TkCarrierChange -> decimalBit(x.Market_TkCarrierChange)
 Market_TkCarrierGroup -> x.Market_TkCarrierGroup
 Market_OpCarrierChange -> decimalBit(x.Market_OpCarrierChange)
 Market_OpCarrierGroup -> x.Market_OpCarrierGroup
 Market_RPCarrier -> x.Market_RPCarrier
 Market_TkCarrier -> x.Market_TkCarrier
 Market_OpCarrier -> x.Market_OpCarrier
 Market_BulkFare -> decimalBit(x.Market_BulkFare)
 Market_Passengers -> decimal(x.Market_Passengers)
 Market_MktFare -> decimal(x.Market_MktFare)
 Market_MktDistance -> nonnegativeDecimal(x.Market_MktDistance)
 Market_MktDistanceGroup -> int64(x.Market_MktDistanceGroup)
 Market_MktMilesFlown -> nonnegativeDecimal(x.Market_MktMilesFlown)
 Market_NonStopMiles -> nonnegativeDecimal(x.Market_NonStopMiles)
 Market_ItinGeoType -> int64(x.Market_ItinGeoType)
 Market_MktGeoType -> int64(x.Market_MktGeoType)
 foreign_keys
 Market_ticket -> {x -> x.Market_ticket}
 Market_OriginAirport -> {x -> x.Market_OriginAirport}
 Market_DestAirport -> {x -> x.Market_DestAirport}
 }
 entity Coupon -> { from x:Coupon
 attributes
 Coupon_MktID -> int64(x.Coupon_MktID)
 Coupon_SeqNum -> int64(x.Coupon_SeqNum)
 Coupon_Coupons -> int64(x.Coupon_Coupons)
 Coupon_Year -> positive64(x.Coupon_Year)
 Coupon_Quarter -> positive64(x.Coupon_Quarter)
 Coupon_Break -> x.Coupon_Break
 Coupon_CouponType -> x.Coupon_CouponType
 Coupon_TkCarrier -> x.Coupon_TkCarrier
 Coupon_OpCarrier -> x.Coupon_OpCarrier
 Coupon_RPCarrier -> x.Coupon_RPCarrier
 Coupon_Passengers -> decimal(x.Coupon_Passengers)
 Coupon_FareClass -> x.Coupon_FareClass
 Coupon_Distance -> nonnegativeDecimal(x.Coupon_Distance)
 Coupon_DistanceGroup -> int64(x.Coupon_DistanceGroup)
 Coupon_Gateway -> decimalBit(x.Coupon_Gateway)
 Coupon_ItinGeoType -> int64(x.Coupon_ItinGeoType)
 Coupon_CouponGeoType -> int64(x.Coupon_CouponGeoType)
 foreign_keys
 Coupon_market -> {x -> x.Coupon_market}
 Coupon_OriginAirport -> {x -> x.Coupon_OriginAirport}
 Coupon_DestAirport -> {x -> x.Coupon_DestAirport}
 }
 entity Airport -> { from x:Airport
 attributes
 Airport_Code -> x.Airport_Code
 Airport_AirportID -> int64(x.Airport_AirportID)
 Airport_AirportSeqID -> int64(x.Airport_AirportSeqID)
 Airport_CityMarketID -> int64(x.Airport_CityMarketID)
 Airport_Country -> x.Airport_Country
 foreign_keys
 Airport_State -> {x -> x.Airport_State}
 }
 entity State -> { from x:State
 attributes
 State_Fips -> x.State_Fips
 State_Code -> x.State_Code
 State_Name -> x.State_Name
 State_Wac -> int64(x.State_Wac)
 }
}
instance TypedResult = eval PostTyping NormalizedInput
constraints final_market_ticket_id = literal : TypedTarget { forall m:Market -> where m.Market_ItinID = m.Market_ticket.Ticket_ItinID }
command final_check_market_ticket_id = check final_market_ticket_id TypedResult
constraints final_coupon_market_id = literal : TypedTarget { forall c:Coupon -> where c.Coupon_MktID = c.Coupon_market.Market_MktID }
command final_check_coupon_market_id = check final_coupon_market_id TypedResult
constraints final_rpc_market_ticket = literal : TypedTarget { forall m:Market -> where m.Market_RPCarrier = m.Market_ticket.Ticket_RPCarrier }
command final_check_rpc_market_ticket = check final_rpc_market_ticket TypedResult
constraints final_rpc_coupon_market = literal : TypedTarget { forall c:Coupon -> where c.Coupon_RPCarrier = c.Coupon_market.Market_RPCarrier }
command final_check_rpc_coupon_market = check final_rpc_coupon_market TypedResult
constraints final_rpc_coupon_derived_ticket = literal : TypedTarget { forall c:Coupon -> where c.Coupon_RPCarrier = c.Coupon_market.Market_ticket.Ticket_RPCarrier }
command final_check_rpc_coupon_derived_ticket = check final_rpc_coupon_derived_ticket TypedResult
constraints final_surj_market_ticket = literal : TypedTarget { forall t:Ticket -> exists m:Market where m.Market_ticket = t }
command final_check_surj_market_ticket = check final_surj_market_ticket TypedResult
constraints final_surj_coupon_market = literal : TypedTarget { forall m:Market -> exists c:Coupon where c.Coupon_market = m }
command final_check_surj_coupon_market = check final_surj_coupon_market TypedResult
