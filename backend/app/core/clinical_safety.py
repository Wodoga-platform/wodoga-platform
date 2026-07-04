"""
Wodoga Platform — Clinical Safety Checks
=========================================

WHAT THIS MODULE IS (plain English):
Before a medication is prescribed, this module checks it against the
patient's known allergies and (where data exists) known drug interactions.
It returns a list of safety alerts. An empty list means "no concerns found."

WHY IT EXISTS:
The prescribe flow previously performed NO safety checking. A provider
could prescribe a drug the chart said the patient was allergic to, and the
system said nothing. Allergy-to-prescription checking is a baseline
patient-safety function of any EHR. Its absence is a mechanism for a fatal
medical error. This module closes that gap.

HONEST SCOPE — READ THIS:
This is a FLOOR implementation, deliberately. Real clinical-grade checking
requires a commercial drug database (First Databank, Medi-Span) or at least
RxNorm + the NIH/NLM interaction data, because:
  - Allergy cross-reactivity is real (a cephalosporin can harm a
    penicillin-allergic patient; this module won't catch that).
  - Ingredient-vs-brand-vs-class mapping needs an ontology this doesn't have.
  - True drug-drug interaction severity grading needs curated pharmacology.

What this floor DOES do:
  - Catches the obvious, direct cases: patient allergic to "penicillin",
    prescribed a drug whose name/class contains "penicillin".
  - Provides the override-with-reason scaffolding that clinical workflows
    require (clinicians can override with documented justification).
  - Establishes the integration point so swapping in a real drug DB later
    is a contained change, not a rewrite.

The alternative to shipping this floor is shipping NOTHING, which leaves the
fatal-error path wide open. A floor that catches obvious cases and is honest
about its limits is far better than silence that masquerades as safety.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class AlertSeverity(str, Enum):
    CRITICAL = "critical"   # do not proceed without explicit override + reason
    HIGH = "high"           # strong caution
    MODERATE = "moderate"   # note and consider
    INFO = "info"           # informational


class AlertType(str, Enum):
    ALLERGY = "allergy"
    INTERACTION = "interaction"
    DUPLICATE = "duplicate_therapy"


@dataclass
class SafetyAlert:
    severity: AlertSeverity
    type: AlertType
    message: str
    # The token/drug that triggered it, for UI highlighting and audit
    trigger: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["severity"] = self.severity.value
        d["type"] = self.type.value
        return d


# ── Normalization helpers ────────────────────────────────────────────

def _normalize_tokens(raw) -> list[str]:
    """
    Turn an allergies value (Postgres TEXT[] → Python list, or a stray
    string) into a clean list of lowercased, stripped tokens.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        items = list(raw)
    else:
        # Defensive: a single string with separators
        items = str(raw).replace(";", ",").split(",")
    out = []
    for item in items:
        if item is None:
            continue
        t = str(item).strip().lower()
        if t:
            out.append(t)
    return out


# A very small, deliberately conservative cross-reactivity map. This is NOT
# a substitute for a real drug database — it encodes only a handful of the
# most clinically important, well-established cross-reactivity relationships
# so the floor catches a few non-obvious but high-stakes cases. Expand only
# with clinical review; the real answer is a commercial drug DB.
_CROSS_REACTIVITY: dict[str, list[str]] = {
    # allergy token : [substrings that, if present in the drug, should alert]
    "penicillin": ["amoxicillin", "ampicillin", "penicillin", "augmentin",
                   "piperacillin", "nafcillin", "oxacillin", "dicloxacillin"],
    "sulfa": ["sulfamethoxazole", "bactrim", "septra", "sulfasalazine",
              "sulfadiazine"],
    "aspirin": ["aspirin", "asa", "acetylsalicylic"],
    "nsaid": ["ibuprofen", "naproxen", "ketorolac", "diclofenac", "aspirin"],
    "codeine": ["codeine", "hydrocodone", "oxycodone"],  # opioid cross-sensitivity (conservative)
}


async def check_prescription_safety(
    db: AsyncSession,
    patient_id: str,
    drug_name: str,
    drug_class: Optional[str] = None,
    brand_name: Optional[str] = None,
) -> list[SafetyAlert]:
    """
    Run safety checks for a proposed prescription. Returns a list of
    SafetyAlert (empty = no concerns found by this floor implementation).

    Checks performed:
      1. Direct allergy match (patient allergy token appears in the drug's
         name/brand/class).
      2. Conservative cross-reactivity (via _CROSS_REACTIVITY).
      3. Duplicate active therapy (same drug already active for the patient).

    NOT performed (requires a real drug DB): true drug-drug interaction
    grading, full cross-reactivity, dose-based contraindications.
    """
    alerts: list[SafetyAlert] = []

    haystack = " ".join(
        part.lower() for part in [drug_name, brand_name or "", drug_class or ""] if part
    )

    # ── 1 & 2. Allergy checks ────────────────────────────────────────
    patient = (await db.execute(
        text("SELECT allergies FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(patient_id)},
    )).mappings().first()

    if patient:
        allergy_tokens = _normalize_tokens(patient["allergies"])
        for tok in allergy_tokens:
            # Direct match: the allergy token appears in the drug string
            if tok and tok in haystack:
                alerts.append(SafetyAlert(
                    severity=AlertSeverity.CRITICAL,
                    type=AlertType.ALLERGY,
                    message=(f"Patient has a documented allergy to '{tok}'. "
                             f"{drug_name} appears to match this allergy and may be "
                             f"contraindicated."),
                    trigger=tok,
                ))
                continue  # already alerted on this token

            # Conservative cross-reactivity
            related = _CROSS_REACTIVITY.get(tok, [])
            for related_sub in related:
                if related_sub in haystack:
                    alerts.append(SafetyAlert(
                        severity=AlertSeverity.HIGH,
                        type=AlertType.ALLERGY,
                        message=(f"Patient is allergic to '{tok}'. {drug_name} may "
                                 f"cross-react (matched '{related_sub}'). Verify before "
                                 f"prescribing."),
                        trigger=tok,
                    ))
                    break

    # ── 3. Duplicate active therapy ──────────────────────────────────
    dupes = (await db.execute(
        text("""
            SELECT drug_name FROM medications
            WHERE patient_id = :pid
              AND LOWER(drug_name) = LOWER(:drug)
              AND (end_date IS NULL OR end_date >= CURRENT_DATE)
        """),
        {"pid": str(patient_id), "drug": drug_name},
    )).mappings().all()
    if dupes:
        alerts.append(SafetyAlert(
            severity=AlertSeverity.MODERATE,
            type=AlertType.DUPLICATE,
            message=(f"{drug_name} appears to already be an active medication for "
                     f"this patient. Confirm this is not a duplicate order."),
            trigger=drug_name,
        ))

    return alerts


def has_blocking_alerts(alerts: list[SafetyAlert]) -> bool:
    """True if any alert is severe enough to require an explicit override."""
    return any(a.severity == AlertSeverity.CRITICAL for a in alerts)
