"""
Wodoga Platform — Clinical Operations constants.
Path: backend/app/api/v1/clinical/constants.py

Audit action labels for the clinical-ops entities. The audit_logs.action
column is free TEXT (no enum constraint), and AuditLogger.log() takes a str,
so these plug into the existing audit pipeline without touching audit.py.
Named in the same UPPER_SNAKE style as app.core.audit.AuditAction.
"""

# ── Audit action labels ──────────────────────────────────────────────────────
DX_ADDED            = "PATIENT_DIAGNOSIS_ADDED"
DX_RESOLVED         = "PATIENT_DIAGNOSIS_RESOLVED"
FREQ_ORDER_CREATED  = "FREQUENCY_ORDER_CREATED"
FREQ_ORDER_UPDATED  = "FREQUENCY_ORDER_STATUS_CHANGED"
CONTACT_ADDED       = "PATIENT_CONTACT_ADDED"
CONTACT_UPDATED     = "PATIENT_CONTACT_UPDATED"
CONTACT_REMOVED     = "PATIENT_CONTACT_DEACTIVATED"
CODE_STATUS_SET     = "PATIENT_CODE_STATUS_SET"
HOLD_STARTED        = "PATIENT_HOLD_STARTED"
HOLD_ENDED          = "PATIENT_HOLD_ENDED"
PAYER_SET           = "PATIENT_PAYER_SET"
PHARMACY_ADDED      = "PHARMACY_ADDED"
PREF_PHARMACY_SET   = "PATIENT_PREFERRED_PHARMACY_SET"
ICD_IMPORTED        = "ICD10_CODE_SET_IMPORTED"

# ── visit_type → discipline mapping ──────────────────────────────────────────
# The visits table types visits by `visit_type`, not by clinical discipline.
# Frequency orders are written per discipline (SN/PT/OT). This CASE expression
# is the single source of truth for that mapping and is used by the alert
# engine. physical/occupational therapy map directly; every other clinical
# visit_type counts toward Skilled Nursing (the discipline those activities
# are delivered under in home health). ST/MSW/HHA are not representable until
# visits can express them — see the migration comment on frequency_orders.
VISIT_TYPE_TO_DISCIPLINE_SQL = """
    CASE visit_type
        WHEN 'physical_therapy'     THEN 'PT'
        WHEN 'occupational_therapy' THEN 'OT'
        ELSE 'SN'
    END
"""
