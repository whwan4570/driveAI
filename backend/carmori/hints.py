"""Short English guidance spoken by the app."""

from __future__ import annotations

from .models import Step

HINTS: dict[str, str] = {
    "inlet_find": "Center the washer fluid inlet in view.",
    "inlet_occluded": "The inlet is blocked. Move your hand aside for a moment.",
    "wrong_part": "That may be a different part. Show the washer cap and its narrow filler neck.",
    "cap_already_open": "The cap is already open. Close it so I can guide you from the start.",
    "open_cap": "Open the cap I marked.",
    "cap_occluded": "I cannot see the cap. Move your hand aside for a moment.",
    "show_product": "Show the product label to the camera.",
    "product_conflict": "This isn't washer fluid. Don't pour it.",
    "product_unknown": "I cannot read the label. Hold it toward the camera.",
    "pour": "Product confirmed. Pour slowly into the inlet.",
    "pour_occluded": "I cannot see the bottle and inlet clearly. Keep them in view while pouring.",
    "bottle_changed": "That is a different bottle. Show its label again.",
    "finish": "When you are done, set the bottle upright and close the cap.",
    "finish_occluded": "I cannot see the cap. Move your hand aside for a moment.",
    "confirm_pour": "The pour was out of view. Did you finish refilling?",
    "pour_again": "Okay. Keep the bottle over the inlet in view while pouring.",
    "recorded_observed": "I saved the refill I observed.",
    "recorded_voice": "I saved the refill you confirmed by voice.",
    "recorded_manual": "I saved the refill you confirmed on screen.",
    "voice_cannot_approve": "I cannot verify that by voice. Show it to the camera again.",
    "paused": "Paused. Say continue when you are ready.",
    "resumed": "I am watching again.",
    "restart": "Starting over. Show the washer fluid inlet.",
}

STEP_ENTRY_HINT: dict[Step, str] = {
    Step.FIND_INLET: "inlet_find",
    Step.OPEN_CAP: "open_cap",
    Step.CONFIRM_PRODUCT: "show_product",
    Step.POUR: "pour",
    Step.FINISH: "finish",
}


def hint_text(key: str) -> str:
    return HINTS[key]
