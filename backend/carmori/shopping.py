"""Weather-grounded washer-fluid choices; retailer prices are intentionally unverified."""

from __future__ import annotations

from typing import Literal
from urllib.parse import quote_plus

from pydantic import BaseModel

from .weather import EnvironmentContext


class WasherShoppingPick(BaseModel):
    kind: Literal["all_season", "winter", "extreme_cold", "check_weather"]
    product_name: str | None
    freeze_rating_f: int | None
    forecast_low_c: float | None
    weather_as_of: str | None
    reason: str
    manufacturer_url: str | None
    shop_url: str
    retailer_verified: bool = False


def choose_washer_fluid(environment: EnvironmentContext) -> WasherShoppingPick:
    low = environment.forecast_low_c if environment.status == "available" else None
    if low is None:
        return WasherShoppingPick(
            kind="check_weather", product_name="Rain-X 2-in-1 Windshield Washer Fluid", freeze_rating_f=-25,
            forecast_low_c=None, weather_as_of=None,
            reason="Weather is unavailable. Check the lowest temperature where you will drive against the bottle's -25°F rating.",
            manufacturer_url="https://www.rainx.com/product/rain-x-2-in-1-windshield-washer-fluid/",
            shop_url="https://www.google.com/search?tbm=shop&q=" + quote_plus("Rain-X 2-in-1 Windshield Washer Fluid -25F 1 gallon"),
        )

    fahrenheit = low * 9 / 5 + 32
    if fahrenheit < -30:
        return WasherShoppingPick(
            kind="extreme_cold", product_name=None, freeze_rating_f=None,
            forecast_low_c=round(low, 1), weather_as_of=environment.last_successful_update.isoformat() if environment.last_successful_update else None,
            reason=f"Today's forecast low is {fahrenheit:.0f}°F. Choose a fluid rated below your expected driving temperature; the listed examples may not be sufficient.",
            manufacturer_url=None,
            shop_url="https://www.google.com/search?tbm=shop&q=" + quote_plus("windshield washer fluid below -30F"),
        )

    if fahrenheit < -25:
        name = "Rain-X -30°F Extreme Temperature De-Icer"
        rating = -30
        kind = "extreme_cold"
        url = "https://www.rainx.com/product/rain-x-30f-extreme-temperature-de-icer-windshield-washer-fluid/"
    elif fahrenheit <= 32:
        name = "Rain-X 2-in-1 Windshield Washer Fluid"
        rating = -25
        kind = "winter"
        url = "https://www.rainx.com/product/rain-x-2-in-1-windshield-washer-fluid/"
    else:
        name = "Rain-X 2-in-1 Windshield Washer Fluid"
        rating = -25
        kind = "all_season"
        url = "https://www.rainx.com/product/rain-x-2-in-1-windshield-washer-fluid/"

    return WasherShoppingPick(
        kind=kind, product_name=name, freeze_rating_f=rating,
        forecast_low_c=round(low, 1), weather_as_of=environment.last_successful_update.isoformat() if environment.last_successful_update else None,
        reason=f"Today's forecast low is {fahrenheit:.0f}°F. This example is labeled for temperatures down to {rating}°F; check the bottle and conditions along your route.",
        manufacturer_url=url,
        shop_url="https://www.google.com/search?tbm=shop&q=" + quote_plus(name + f" {rating}F 1 gallon"),
    )
