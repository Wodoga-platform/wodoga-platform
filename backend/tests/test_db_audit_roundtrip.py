"""
DB-backed integration test for the patient-update + audit-log round trip.

Unlike test_audit_encryption.py (which tests the crypto in isolation), this
spins up a REAL Postgres and runs the actual INSERT/UPDATE statements against
real tables shaped like production after migrations 0007 and 0008. This is the
test that would have caught the JSONB-vs-encrypted-string bug that broke every
patient edit — the crypto was correct in isolation but wrong against the live
column type.

Requires pgserver (pip install pgserver). Skips cleanly if unavailable so the
rest of the suite still runs in environments without it.
"""
import json
import sys

import pytest

pgserver = pytest.importorskip("pgserver")
psycopg = pytest.importorskip("psycopg")

from app.core import phi_crypto as pc


@pytest.fixture(scope="module")
def db_cur(tmp_path_factory):
    d = tmp_path_factory.mktemp("pg")
    server = pgserver.get_server(str(d))
    conn = psycopg.connect(server.get_uri())
    conn.autocommit = True
    cur = conn.cursor()
    # Production shape AFTER migrations 0007 (patients PHI -> TEXT) and
    # 0008 (audit state -> TEXT).
    cur.execute("""
        CREATE TABLE patients (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          first_name TEXT, last_name TEXT, phone TEXT, email TEXT,
          allergies TEXT, insurance_primary TEXT, notes TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          action TEXT, resource_type TEXT, resource_id TEXT, description TEXT,
          previous_state TEXT, new_state TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    yield cur
    server.cleanup()


def test_patient_create_update_audit_roundtrip(db_cur):
    cur = db_cur

    # CREATE with encrypted PHI
    row = pc.encrypt_patient_fields({
        "first_name": "Jane", "last_name": "Doe",
        "phone": "817-555-0142", "email": "jane@example.com",
        "allergies": ["Penicillin"], "insurance_primary": {"provider": "Aetna"},
        "notes": "initial",
    })
    cur.execute("""INSERT INTO patients (first_name,last_name,phone,email,allergies,insurance_primary,notes)
        VALUES (%(first_name)s,%(last_name)s,%(phone)s,%(email)s,%(allergies)s,%(insurance_primary)s,%(notes)s)
        RETURNING id""", row)
    pid = cur.fetchone()[0]

    cur.execute("SELECT phone, allergies FROM patients WHERE id=%s", (pid,))
    raw_phone, raw_all = cur.fetchone()
    assert raw_phone.startswith("enc:v1:")
    assert raw_all.startswith("enc:v1:")

    # UPDATE persists
    updates = {"phone": "817-555-9999", "notes": "updated note"}
    enc_updates = pc.encrypt_patient_fields(dict(updates))
    cur.execute("UPDATE patients SET phone=%(phone)s, notes=%(notes)s WHERE id=%(id)s",
                {**enc_updates, "id": str(pid)})
    cur.execute("SELECT phone FROM patients WHERE id=%s", (pid,))
    assert pc.dec_scalar(cur.fetchone()[0]) == "817-555-9999"

    # Audit INSERT with encrypted state — the bug that broke prod.
    existing = {"phone": "817-555-0142", "notes": "initial", "allergies": ["Penicillin"]}
    changed_before = {k: existing.get(k) for k in updates if k in existing}
    prev_enc = pc.encrypt_audit_state(json.dumps(changed_before, default=str))
    new_enc = pc.encrypt_audit_state(json.dumps(updates, default=str))
    cur.execute("""INSERT INTO audit_logs (action,resource_type,resource_id,description,previous_state,new_state)
        VALUES (%s,%s,%s,%s,%s,%s)""",
        ("PATIENT_UPDATED", "patient", str(pid), "Updated patient: Jane Doe", prev_enc, new_enc))

    # Viewer read path: decrypt + symmetric per-field diff
    cur.execute("SELECT previous_state,new_state FROM audit_logs WHERE resource_id=%s", (str(pid),))
    p_raw, n_raw = cur.fetchone()
    assert p_raw.startswith("enc:v1:")
    prev_dec = json.loads(pc.decrypt_audit_state(p_raw))
    new_dec = json.loads(pc.decrypt_audit_state(n_raw))

    assert set(prev_dec) == set(new_dec) == {"phone", "notes"}
    assert prev_dec["phone"] == "817-555-0142" and new_dec["phone"] == "817-555-9999"
    assert prev_dec["notes"] == "initial" and new_dec["notes"] == "updated note"
    assert "allergies" not in prev_dec  # not the whole row, just changed fields
