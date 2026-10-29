schema O = literal : Ty { entities Ticket Market Coupon TOAirport TOState MOAirport MOState MDAirport MDState COAirport COState CDAirport CDState
 foreign_keys
TOAirport_state : TOAirport -> TOState
Ticket_origin : Ticket -> TOAirport
MOAirport_state : MOAirport -> MOState
Market_origin : Market -> MOAirport
MDAirport_state : MDAirport -> MDState
Market_dest : Market -> MDAirport
COAirport_state : COAirport -> COState
Coupon_origin : Coupon -> COAirport
CDAirport_state : CDAirport -> CDState
Coupon_dest : Coupon -> CDAirport
Market_ticket : Market -> Ticket
Coupon_market : Coupon -> Market
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
TOAirport_Code : TOAirport -> String
TOAirport_AirportID : TOAirport -> String
TOAirport_AirportSeqID : TOAirport -> String
TOAirport_CityMarketID : TOAirport -> String
TOAirport_Country : TOAirport -> String
TOState_Fips : TOState -> String
TOState_Code : TOState -> String
TOState_Name : TOState -> String
TOState_Wac : TOState -> String
MOAirport_Code : MOAirport -> String
MOAirport_AirportID : MOAirport -> String
MOAirport_AirportSeqID : MOAirport -> String
MOAirport_CityMarketID : MOAirport -> String
MOAirport_Country : MOAirport -> String
MOState_Fips : MOState -> String
MOState_Code : MOState -> String
MOState_Name : MOState -> String
MOState_Wac : MOState -> String
MDAirport_Code : MDAirport -> String
MDAirport_AirportID : MDAirport -> String
MDAirport_AirportSeqID : MDAirport -> String
MDAirport_CityMarketID : MDAirport -> String
MDAirport_Country : MDAirport -> String
MDState_Fips : MDState -> String
MDState_Code : MDState -> String
MDState_Name : MDState -> String
MDState_Wac : MDState -> String
COAirport_Code : COAirport -> String
COAirport_AirportID : COAirport -> String
COAirport_AirportSeqID : COAirport -> String
COAirport_CityMarketID : COAirport -> String
COAirport_Country : COAirport -> String
COState_Fips : COState -> String
COState_Code : COState -> String
COState_Name : COState -> String
COState_Wac : COState -> String
CDAirport_Code : CDAirport -> String
CDAirport_AirportID : CDAirport -> String
CDAirport_AirportSeqID : CDAirport -> String
CDAirport_CityMarketID : CDAirport -> String
CDAirport_Country : CDAirport -> String
CDState_Fips : CDState -> String
CDState_Code : CDState -> String
CDState_Name : CDState -> String
CDState_Wac : CDState -> String
}
schema N = literal : Ty { entities Ticket Market Coupon Airport State
 foreign_keys
Airport_state : Airport -> State
Ticket_origin : Ticket -> Airport
Market_origin : Market -> Airport
Market_dest : Market -> Airport
Coupon_origin : Coupon -> Airport
Coupon_dest : Coupon -> Airport
Market_ticket : Market -> Ticket
Coupon_market : Coupon -> Market
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
query Extract = literal : S -> O {
entity Ticket -> { from t : Ticket attributes
Ticket_ItinID -> t.Ticket_ItinID
Ticket_Coupons -> t.Ticket_Coupons
Ticket_Year -> t.Ticket_Year
Ticket_Quarter -> t.Ticket_Quarter
Ticket_RoundTrip -> t.Ticket_RoundTrip
Ticket_OnLine -> t.Ticket_OnLine
Ticket_DollarCred -> t.Ticket_DollarCred
Ticket_FarePerMile -> t.Ticket_FarePerMile
Ticket_RPCarrier -> t.Ticket_RPCarrier
Ticket_Passengers -> t.Ticket_Passengers
Ticket_ItinFare -> t.Ticket_ItinFare
Ticket_BulkFare -> t.Ticket_BulkFare
Ticket_Distance -> t.Ticket_Distance
Ticket_DistanceGroup -> t.Ticket_DistanceGroup
Ticket_MilesFlown -> t.Ticket_MilesFlown
Ticket_ItinGeoType -> t.Ticket_ItinGeoType
 foreign_keys
Ticket_origin -> { x -> t }
}
entity Market -> { from m : Market t : Ticket where m.Market_ItinID = t.Ticket_ItinID attributes
Market_ItinID -> m.Market_ItinID
Market_MktID -> m.Market_MktID
Market_MktCoupons -> m.Market_MktCoupons
Market_Year -> m.Market_Year
Market_Quarter -> m.Market_Quarter
Market_AirportGroup -> m.Market_AirportGroup
Market_WacGroup -> m.Market_WacGroup
Market_TkCarrierChange -> m.Market_TkCarrierChange
Market_TkCarrierGroup -> m.Market_TkCarrierGroup
Market_OpCarrierChange -> m.Market_OpCarrierChange
Market_OpCarrierGroup -> m.Market_OpCarrierGroup
Market_RPCarrier -> m.Market_RPCarrier
Market_TkCarrier -> m.Market_TkCarrier
Market_OpCarrier -> m.Market_OpCarrier
Market_BulkFare -> m.Market_BulkFare
Market_Passengers -> m.Market_Passengers
Market_MktFare -> m.Market_MktFare
Market_MktDistance -> m.Market_MktDistance
Market_MktDistanceGroup -> m.Market_MktDistanceGroup
Market_MktMilesFlown -> m.Market_MktMilesFlown
Market_NonStopMiles -> m.Market_NonStopMiles
Market_ItinGeoType -> m.Market_ItinGeoType
Market_MktGeoType -> m.Market_MktGeoType
 foreign_keys
Market_origin -> { x -> m }
Market_dest -> { x -> m }
Market_ticket -> { t -> t }
}
entity Coupon -> { from c : Coupon m : Market t : Ticket where c.Coupon_MktID = m.Market_MktID c.Coupon_ItinID = t.Ticket_ItinID m.Market_ItinID = t.Ticket_ItinID attributes
Coupon_MktID -> c.Coupon_MktID
Coupon_SeqNum -> c.Coupon_SeqNum
Coupon_Coupons -> c.Coupon_Coupons
Coupon_Year -> c.Coupon_Year
Coupon_Quarter -> c.Coupon_Quarter
Coupon_Break -> c.Coupon_Break
Coupon_CouponType -> c.Coupon_CouponType
Coupon_TkCarrier -> c.Coupon_TkCarrier
Coupon_OpCarrier -> c.Coupon_OpCarrier
Coupon_RPCarrier -> c.Coupon_RPCarrier
Coupon_Passengers -> c.Coupon_Passengers
Coupon_FareClass -> c.Coupon_FareClass
Coupon_Distance -> c.Coupon_Distance
Coupon_DistanceGroup -> c.Coupon_DistanceGroup
Coupon_Gateway -> c.Coupon_Gateway
Coupon_ItinGeoType -> c.Coupon_ItinGeoType
Coupon_CouponGeoType -> c.Coupon_CouponGeoType
 foreign_keys
Coupon_origin -> { x -> c }
Coupon_dest -> { x -> c }
Coupon_market -> { m -> m t -> t }
}
entity TOAirport -> { from x : Ticket attributes
TOAirport_Code -> x.Ticket_Origin
TOAirport_AirportID -> x.Ticket_OriginAirportID
TOAirport_AirportSeqID -> x.Ticket_OriginAirportSeqID
TOAirport_CityMarketID -> x.Ticket_OriginCityMarketID
TOAirport_Country -> x.Ticket_OriginCountry
 foreign_keys TOAirport_state -> { x -> x } }
entity TOState -> { from x : Ticket attributes
TOState_Fips -> x.Ticket_OriginStateFips
TOState_Code -> x.Ticket_OriginState
TOState_Name -> x.Ticket_OriginStateName
TOState_Wac -> x.Ticket_OriginWac
}
entity MOAirport -> { from x : Market attributes
MOAirport_Code -> x.Market_Origin
MOAirport_AirportID -> x.Market_OriginAirportID
MOAirport_AirportSeqID -> x.Market_OriginAirportSeqID
MOAirport_CityMarketID -> x.Market_OriginCityMarketID
MOAirport_Country -> x.Market_OriginCountry
 foreign_keys MOAirport_state -> { x -> x } }
entity MOState -> { from x : Market attributes
MOState_Fips -> x.Market_OriginStateFips
MOState_Code -> x.Market_OriginState
MOState_Name -> x.Market_OriginStateName
MOState_Wac -> x.Market_OriginWac
}
entity MDAirport -> { from x : Market attributes
MDAirport_Code -> x.Market_Dest
MDAirport_AirportID -> x.Market_DestAirportID
MDAirport_AirportSeqID -> x.Market_DestAirportSeqID
MDAirport_CityMarketID -> x.Market_DestCityMarketID
MDAirport_Country -> x.Market_DestCountry
 foreign_keys MDAirport_state -> { x -> x } }
entity MDState -> { from x : Market attributes
MDState_Fips -> x.Market_DestStateFips
MDState_Code -> x.Market_DestState
MDState_Name -> x.Market_DestStateName
MDState_Wac -> x.Market_DestWac
}
entity COAirport -> { from x : Coupon attributes
COAirport_Code -> x.Coupon_Origin
COAirport_AirportID -> x.Coupon_OriginAirportID
COAirport_AirportSeqID -> x.Coupon_OriginAirportSeqID
COAirport_CityMarketID -> x.Coupon_OriginCityMarketID
COAirport_Country -> x.Coupon_OriginCountry
 foreign_keys COAirport_state -> { x -> x } }
entity COState -> { from x : Coupon attributes
COState_Fips -> x.Coupon_OriginStateFips
COState_Code -> x.Coupon_OriginState
COState_Name -> x.Coupon_OriginStateName
COState_Wac -> x.Coupon_OriginWac
}
entity CDAirport -> { from x : Coupon attributes
CDAirport_Code -> x.Coupon_Dest
CDAirport_AirportID -> x.Coupon_DestAirportID
CDAirport_AirportSeqID -> x.Coupon_DestAirportSeqID
CDAirport_CityMarketID -> x.Coupon_DestCityMarketID
CDAirport_Country -> x.Coupon_DestCountry
 foreign_keys CDAirport_state -> { x -> x } }
entity CDState -> { from x : Coupon attributes
CDState_Fips -> x.Coupon_DestStateFips
CDState_Code -> x.Coupon_DestState
CDState_Name -> x.Coupon_DestStateName
CDState_Wac -> x.Coupon_DestWac
}
}
instance Occurrences = eval Extract Input
mapping Collect = literal : O -> N {
entity Ticket -> Ticket
 foreign_keys
Ticket_origin -> Ticket_origin
 attributes
Ticket_ItinID -> Ticket_ItinID
Ticket_Coupons -> Ticket_Coupons
Ticket_Year -> Ticket_Year
Ticket_Quarter -> Ticket_Quarter
Ticket_RoundTrip -> Ticket_RoundTrip
Ticket_OnLine -> Ticket_OnLine
Ticket_DollarCred -> Ticket_DollarCred
Ticket_FarePerMile -> Ticket_FarePerMile
Ticket_RPCarrier -> Ticket_RPCarrier
Ticket_Passengers -> Ticket_Passengers
Ticket_ItinFare -> Ticket_ItinFare
Ticket_BulkFare -> Ticket_BulkFare
Ticket_Distance -> Ticket_Distance
Ticket_DistanceGroup -> Ticket_DistanceGroup
Ticket_MilesFlown -> Ticket_MilesFlown
Ticket_ItinGeoType -> Ticket_ItinGeoType
entity Market -> Market
 foreign_keys
Market_origin -> Market_origin
Market_dest -> Market_dest
Market_ticket -> Market_ticket
 attributes
Market_ItinID -> Market_ItinID
Market_MktID -> Market_MktID
Market_MktCoupons -> Market_MktCoupons
Market_Year -> Market_Year
Market_Quarter -> Market_Quarter
Market_AirportGroup -> Market_AirportGroup
Market_WacGroup -> Market_WacGroup
Market_TkCarrierChange -> Market_TkCarrierChange
Market_TkCarrierGroup -> Market_TkCarrierGroup
Market_OpCarrierChange -> Market_OpCarrierChange
Market_OpCarrierGroup -> Market_OpCarrierGroup
Market_RPCarrier -> Market_RPCarrier
Market_TkCarrier -> Market_TkCarrier
Market_OpCarrier -> Market_OpCarrier
Market_BulkFare -> Market_BulkFare
Market_Passengers -> Market_Passengers
Market_MktFare -> Market_MktFare
Market_MktDistance -> Market_MktDistance
Market_MktDistanceGroup -> Market_MktDistanceGroup
Market_MktMilesFlown -> Market_MktMilesFlown
Market_NonStopMiles -> Market_NonStopMiles
Market_ItinGeoType -> Market_ItinGeoType
Market_MktGeoType -> Market_MktGeoType
entity Coupon -> Coupon
 foreign_keys
Coupon_origin -> Coupon_origin
Coupon_dest -> Coupon_dest
Coupon_market -> Coupon_market
 attributes
Coupon_MktID -> Coupon_MktID
Coupon_SeqNum -> Coupon_SeqNum
Coupon_Coupons -> Coupon_Coupons
Coupon_Year -> Coupon_Year
Coupon_Quarter -> Coupon_Quarter
Coupon_Break -> Coupon_Break
Coupon_CouponType -> Coupon_CouponType
Coupon_TkCarrier -> Coupon_TkCarrier
Coupon_OpCarrier -> Coupon_OpCarrier
Coupon_RPCarrier -> Coupon_RPCarrier
Coupon_Passengers -> Coupon_Passengers
Coupon_FareClass -> Coupon_FareClass
Coupon_Distance -> Coupon_Distance
Coupon_DistanceGroup -> Coupon_DistanceGroup
Coupon_Gateway -> Coupon_Gateway
Coupon_ItinGeoType -> Coupon_ItinGeoType
Coupon_CouponGeoType -> Coupon_CouponGeoType
entity TOAirport -> Airport
 foreign_keys TOAirport_state -> Airport_state
 attributes
TOAirport_Code -> Airport_Code
TOAirport_AirportID -> Airport_AirportID
TOAirport_AirportSeqID -> Airport_AirportSeqID
TOAirport_CityMarketID -> Airport_CityMarketID
TOAirport_Country -> Airport_Country
entity TOState -> State
 attributes
TOState_Fips -> State_Fips
TOState_Code -> State_Code
TOState_Name -> State_Name
TOState_Wac -> State_Wac
entity MOAirport -> Airport
 foreign_keys MOAirport_state -> Airport_state
 attributes
MOAirport_Code -> Airport_Code
MOAirport_AirportID -> Airport_AirportID
MOAirport_AirportSeqID -> Airport_AirportSeqID
MOAirport_CityMarketID -> Airport_CityMarketID
MOAirport_Country -> Airport_Country
entity MOState -> State
 attributes
MOState_Fips -> State_Fips
MOState_Code -> State_Code
MOState_Name -> State_Name
MOState_Wac -> State_Wac
entity MDAirport -> Airport
 foreign_keys MDAirport_state -> Airport_state
 attributes
MDAirport_Code -> Airport_Code
MDAirport_AirportID -> Airport_AirportID
MDAirport_AirportSeqID -> Airport_AirportSeqID
MDAirport_CityMarketID -> Airport_CityMarketID
MDAirport_Country -> Airport_Country
entity MDState -> State
 attributes
MDState_Fips -> State_Fips
MDState_Code -> State_Code
MDState_Name -> State_Name
MDState_Wac -> State_Wac
entity COAirport -> Airport
 foreign_keys COAirport_state -> Airport_state
 attributes
COAirport_Code -> Airport_Code
COAirport_AirportID -> Airport_AirportID
COAirport_AirportSeqID -> Airport_AirportSeqID
COAirport_CityMarketID -> Airport_CityMarketID
COAirport_Country -> Airport_Country
entity COState -> State
 attributes
COState_Fips -> State_Fips
COState_Code -> State_Code
COState_Name -> State_Name
COState_Wac -> State_Wac
entity CDAirport -> Airport
 foreign_keys CDAirport_state -> Airport_state
 attributes
CDAirport_Code -> Airport_Code
CDAirport_AirportID -> Airport_AirportID
CDAirport_AirportSeqID -> Airport_AirportSeqID
CDAirport_CityMarketID -> Airport_CityMarketID
CDAirport_Country -> Airport_Country
entity CDState -> State
 attributes
CDState_Fips -> State_Fips
CDState_Code -> State_Code
CDState_Name -> State_Name
CDState_Wac -> State_Wac
}
instance Interned = distinct Occurrences
instance Collected = sigma_chase Collect Interned { options chase_style = parallel }
instance Result = quotient_query Collected {
entity Airport -> { from a : Airport b : Airport where a.Airport_AirportSeqID = b.Airport_AirportSeqID }
entity State -> { from a : State b : State where a.State_Fips = b.State_Fips }
 options quotient_use_chase = true
}
