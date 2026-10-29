from carmori.shopping import choose_washer_fluid
from carmori.weather import EnvironmentContext


def test_weather_changes_washer_fluid_type_without_price_claim():
    mild = choose_washer_fluid(EnvironmentContext(status="available", forecast_low_c=12))
    freezing = choose_washer_fluid(EnvironmentContext(status="available", forecast_low_c=-3))
    very_cold = choose_washer_fluid(EnvironmentContext(status="available", forecast_low_c=-40))

    assert mild.kind == "all_season" and mild.freeze_rating_f == -25
    assert freezing.kind == "winter" and freezing.freeze_rating_f == -25
    assert very_cold.kind == "extreme_cold" and very_cold.product_name is None
    assert all(not pick.retailer_verified for pick in (mild, freezing, very_cold))
    assert "google.com/search?tbm=shop" in freezing.shop_url


def test_missing_weather_does_not_claim_a_match():
    pick = choose_washer_fluid(EnvironmentContext())
    assert pick.kind == "check_weather"
    assert pick.product_name == "Rain-X 2-in-1 Windshield Washer Fluid"
    assert pick.forecast_low_c is None
