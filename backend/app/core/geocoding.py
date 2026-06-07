"""
Wodoga Platform — Geocoding helper

Converts a patient's address into latitude/longitude using Azure Maps
(HIPAA-eligible under the Azure BAA). Addresses are geocoded once and the
coordinates cached on the patient record, so the only PHI that ever leaves
our system is a single address lookup per address change.

If Azure Maps isn't configured, geocoding silently returns None and the
patient simply won't appear on the map until a key is added — nothing breaks.
"""

from __future__ import annotations

from typing import Optional, Tuple

import httpx

from app.config import get_settings

settings = get_settings()

_AZURE_MAPS_URL = "https://atlas.microsoft.com/search/address/json"


def is_geocoding_configured() -> bool:
    return bool(settings.azure_maps_key)


def build_address_string(
    address_line1: Optional[str],
    city: Optional[str],
    state: Optional[str],
    zip_code: Optional[str],
) -> str:
    parts = [p for p in [address_line1, city, state, zip_code] if p]
    return ", ".join(parts)


async def geocode_address(address: str) -> Optional[Tuple[float, float]]:
    """Return (latitude, longitude) for an address, or None if it can't be resolved."""
    if not settings.azure_maps_key or not address.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                _AZURE_MAPS_URL,
                params={
                    "api-version": "1.0",
                    "subscription-key": settings.azure_maps_key,
                    "query": address,
                    "limit": 1,
                    "countrySet": "US",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results") or []
            if not results:
                return None
            pos = results[0].get("position") or {}
            lat, lon = pos.get("lat"), pos.get("lon")
            if lat is None or lon is None:
                return None
            return float(lat), float(lon)
    except Exception:
        # Geocoding is best-effort; never let it break a patient save
        return None
