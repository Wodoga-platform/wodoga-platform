"""
Wodoga Platform — Clinical Operations package.
Path: backend/app/api/v1/clinical/__init__.py

Bundles the four clinical-ops routers into one `clinical_router` so main.py
mounts them with a single include_router line, matching the existing pattern.
"""

from fastapi import APIRouter

from app.api.v1.clinical.alerts import router as _alerts
from app.api.v1.clinical.icd10 import router as _icd10
from app.api.v1.clinical.frequency_orders import router as _freq
from app.api.v1.clinical.patient_profile import router as _profile

clinical_router = APIRouter()
clinical_router.include_router(_alerts)
clinical_router.include_router(_icd10)
clinical_router.include_router(_freq)
clinical_router.include_router(_profile)
