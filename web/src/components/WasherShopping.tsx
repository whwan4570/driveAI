import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { api, type CareResponse, type WasherShoppingPick } from "../lib/api";

export function WasherShopping({ vehicleId, care, onAskMuse }: { vehicleId: string; care: CareResponse | null; onAskMuse: () => void }) {
  const [shopping, setShopping] = useState<WasherShoppingPick | null>(null);
  const [shoppingError, setShoppingError] = useState(false);
  const [shoppingLoading, setShoppingLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setShoppingLoading(true);
    void api.washerShopping(vehicleId).then((pick) => { if (active) { setShopping(pick); setShoppingError(false); } })
      .catch(() => { if (active) setShoppingError(true); })
      .finally(() => { if (active) setShoppingLoading(false); });
    return () => { active = false; };
  }, [vehicleId]);
  const washerNeedsCheck = care?.recommendations.some((item) => item.component === "washer_fluid" && item.priority !== "ROUTINE") ?? false;
  const lowF = shopping?.forecast_low_c == null ? null : Math.round(shopping.forecast_low_c * 9 / 5 + 32);
  return <div className="washer-shopping">
    <section className="shop-hero" aria-label="Washer fluid shopping help">
      <div className="shop-hero-top"><span className="shop-muse-mark"><Icon name="spark" size={17}/> Muse</span><span className="shop-context">{washerNeedsCheck ? "Washer check suggested" : "For your next refill"}</span></div>
      <h1>Need washer fluid?</h1>
      <p className="shop-hero-prompt">Check the reservoir first. If you need fluid, choose for your vehicle and expected temperatures.</p>
      {shoppingLoading ? <p className="shop-loading" role="status">Checking the forecast…</p> : shoppingError || !shopping ? <div className="shop-unknown"><Icon name="cloud" size={18}/><span>Weather match unavailable right now. Check the freeze rating before buying.</span></div> : <>
        <div className="shop-weather"><Icon name="cloud" size={17}/><span>{lowF === null ? "Forecast unavailable" : `Today's low ${lowF}°F`}</span><small>{lowF === null ? "Check your expected low before buying" : "Open-Meteo forecast"}</small></div>
        <div className="shop-product">
          {shopping.product_name === "Rain-X 2-in-1 Windshield Washer Fluid" ? <div className="shop-product-image"><img src="/images/rainx-2in1-reference.png" alt="Rain-X 2-in-1 washer fluid bottle"/></div> : <div className="shop-product-placeholder"><Icon name="washer" size={33}/></div>}
          <div className="shop-product-copy"><small>{shopping.forecast_low_c === null ? "Example product" : shopping.product_name ? "Weather matched example" : "Choose by freeze rating"}</small><strong>{shopping.product_name || (shopping.kind === "extreme_cold" ? "Fluid rated below the forecast low" : "Check local freeze rating")}</strong><span>{shopping.freeze_rating_f === null ? "Check the bottle's rating" : `Rated to ${shopping.freeze_rating_f}°F`}</span></div>
        </div>
        <p className="shop-reason">{shopping.reason}{shopping.manufacturer_url && <> <a href={shopping.manufacturer_url} target="_blank" rel="noopener noreferrer">Product details ↗</a></>}</p>
        <div className="shop-actions"><a href={shopping.shop_url} target="_blank" rel="noopener noreferrer">View product <Icon name="arrow" size={16}/></a><button type="button" onClick={onAskMuse}>Ask Muse</button></div>
        <p className="shop-disclosure">Check the seller, price and availability before buying.</p>
      </>}
      {(shoppingError || !shopping) && !shoppingLoading && <div className="shop-actions"><a href="https://www.google.com/search?tbm=shop&q=windshield+washer+fluid" target="_blank" rel="noopener noreferrer">View product <Icon name="arrow" size={16}/></a><button type="button" onClick={onAskMuse}>Ask Muse</button></div>}
    </section>
  </div>;
}
