"""accounts, subscriptions, usage, billing events, support reports

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-29 08:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('disabled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('onboarded_at', sa.DateTime(timezone=True), nullable=True))
    # accounts that existed before e-mail verification was introduced were created by the owner: verified
    op.execute("UPDATE users SET email_verified_at = created_at, onboarded_at = created_at")

    op.create_table('auth_tokens',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('purpose', sa.String(length=16), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_auth_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_auth_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_auth_tokens_token_hash'))
    )
    op.create_index(op.f('ix_auth_tokens_user_id'), 'auth_tokens', ['user_id'], unique=False)

    op.create_table('subscriptions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('plan', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('provider', sa.String(length=16), nullable=False),
    sa.Column('customer_id', sa.String(length=128), nullable=True),
    sa.Column('subscription_id', sa.String(length=128), nullable=True),
    sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_subscriptions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscriptions')),
    sa.UniqueConstraint('user_id', name=op.f('uq_subscriptions_user_id')),
    sa.UniqueConstraint('subscription_id', name=op.f('uq_subscriptions_subscription_id'))
    )
    op.create_index(op.f('ix_subscriptions_customer_id'), 'subscriptions', ['customer_id'], unique=False)

    op.create_table('usage_counters',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('period', sa.String(length=7), nullable=False),
    sa.Column('metric', sa.String(length=64), nullable=False),
    sa.Column('value', sa.Float(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_usage_counters_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_usage_counters')),
    sa.UniqueConstraint('user_id', 'period', 'metric', name='uq_usage_user_period_metric')
    )
    op.create_index(op.f('ix_usage_counters_user_id'), 'usage_counters', ['user_id'], unique=False)

    op.create_table('billing_events',
    sa.Column('id', sa.String(length=128), nullable=False),
    sa.Column('provider', sa.String(length=16), nullable=False),
    sa.Column('type', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('summary', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_billing_events'))
    )
    op.create_index(op.f('ix_billing_events_user_id'), 'billing_events', ['user_id'], unique=False)

    op.create_table('support_reports',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('context', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_support_reports_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_support_reports'))
    )
    op.create_index(op.f('ix_support_reports_user_id'), 'support_reports', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_support_reports_user_id'), table_name='support_reports')
    op.drop_table('support_reports')
    op.drop_index(op.f('ix_billing_events_user_id'), table_name='billing_events')
    op.drop_table('billing_events')
    op.drop_index(op.f('ix_usage_counters_user_id'), table_name='usage_counters')
    op.drop_table('usage_counters')
    op.drop_index(op.f('ix_subscriptions_customer_id'), table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_index(op.f('ix_auth_tokens_user_id'), table_name='auth_tokens')
    op.drop_table('auth_tokens')
    op.drop_column('users', 'onboarded_at')
    op.drop_column('users', 'disabled_at')
    op.drop_column('users', 'email_verified_at')
