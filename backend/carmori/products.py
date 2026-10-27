"""제품 라벨 대조. Spark는 라벨 글자와 분류만 주고, 판정은 여기서 한다."""

from __future__ import annotations

import re
from enum import Enum

from .models import ProductClass
from .vehicles import VehicleSpec


class ProductVerdict(str, Enum):
    MATCH = "MATCH"
    CONFLICT = "CONFLICT"
    UNKNOWN = "UNKNOWN"


def normalize_label(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def evaluate_product(
    label_text: str | None, product_class: ProductClass, spec: VehicleSpec
) -> ProductVerdict:
    if product_class in (ProductClass.COOLANT, ProductClass.OIL):
        return ProductVerdict.CONFLICT
    if not label_text or product_class is ProductClass.UNREADABLE:
        return ProductVerdict.UNKNOWN

    label = normalize_label(label_text)
    if any(normalize_label(term) in label for term in spec.forbidden_label_terms):
        return ProductVerdict.CONFLICT

    has_washer_term = any(normalize_label(term) in label for term in spec.washer_label_terms)
    if product_class is ProductClass.WASHER_FLUID and has_washer_term:
        return ProductVerdict.MATCH
    if product_class is ProductClass.OTHER and not has_washer_term:
        return ProductVerdict.CONFLICT
    # 라벨과 분류가 엇갈리면 승인하지 않는다.
    return ProductVerdict.UNKNOWN
