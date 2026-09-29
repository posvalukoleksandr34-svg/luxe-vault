"""custom commands (user-defined macros)

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-29 06:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('custom_commands',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=False, server_default=''),
    sa.Column('triggers', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('steps', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('response', sa.Text(), nullable=False, server_default=''),
    sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
    sa.Column('preapproved', sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column('run_count', sa.Integer(), nullable=False, server_default='0'),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_status', sa.String(length=24), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_custom_commands_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_custom_commands')),
    sa.UniqueConstraint('user_id', 'name', name='uq_custom_commands_user_name')
    )
    op.create_index(op.f('ix_custom_commands_user_id'), 'custom_commands', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_custom_commands_user_id'), table_name='custom_commands')
    op.drop_table('custom_commands')
