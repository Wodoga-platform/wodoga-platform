"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Created: ${create_date}

${"="*60}
WODOGA MIGRATION CHECKLIST (delete this block before committing):

[ ] This migration is hand-written SQL (we do NOT use autogenerate)
[ ] Every CREATE/ALTER/DROP is reviewed for impact on existing data
[ ] If touching a PHI table, the migration was tested locally first
[ ] If touching RLS policies, the policies are explicitly recreated
    (Postgres does not preserve them across some table changes)
[ ] downgrade() is implemented OR explicitly marked as one-way
    (mark one-way with: raise NotImplementedError("destructive — no auto-rollback"))
[ ] If altering encrypted columns, the data migration is wrapped in a
    transaction and verified with a SELECT before commit
${"="*60}
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: Union[str, Sequence[str], None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    """Apply the migration. Hand-written SQL via op.execute() preferred over
    op.create_table() / op.add_column() helpers, so we keep full control of
    the exact SQL that runs."""
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """Reverse the migration. If reversal is destructive or impossible
    (e.g. dropping encrypted data), raise NotImplementedError with a clear
    explanation."""
    ${downgrades if downgrades else "pass"}
