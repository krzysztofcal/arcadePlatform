-- Storage only. Runtime access is granted by a subsequent, separately reviewed migration.
create table private.play_support_bindings (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  environment text not null check (environment in ('stage', 'production')),
  user_id uuid references auth.users(id) on delete set null,
  unique (environment, user_id),
  unique (id, environment)
);

create table private.play_support_intents (
  id uuid primary key default gen_random_uuid(),
  binding_id text not null references private.play_support_bindings(id),
  sku text not null check (sku in ('supporter_bronze', 'supporter_silver', 'supporter_gold')),
  state text not null check (state in ('PREPARED', 'LAUNCH_UNRESOLVED', 'PLAY_PENDING', 'RECEIPT_LINKED', 'CLOSED')),
  permit_expires_at timestamptz not null,
  native_attempt_id uuid,
  attempt_proof_hash bytea check (octet_length(attempt_proof_hash) = 32),
  created_at timestamptz not null default now(),
  escalated_at timestamptz,
  closed_at timestamptz,
  close_reason text check (close_reason in ('PERMIT_EXPIRED', 'NOT_INVOKED', 'CANCELLED', 'FULFILLED', 'SUPPORT')),
  check ((native_attempt_id is null) = (attempt_proof_hash is null)),
  check (state = 'PREPARED' or state = 'CLOSED' or native_attempt_id is not null),
  check ((closed_at is not null) = (state = 'CLOSED')),
  check ((close_reason is not null) = (state = 'CLOSED')),
  unique (id, binding_id, sku)
);
create unique index play_support_intent_active_slot
  on private.play_support_intents (binding_id, sku) where state <> 'CLOSED';
create unique index play_support_native_attempt_unique
  on private.play_support_intents (native_attempt_id) where native_attempt_id is not null;

create table private.play_support_receipts (
  id uuid primary key default gen_random_uuid(),
  package_name text not null check (package_name in ('pl.kcswh.arcadepoker', 'pl.kcswh.arcadepoker.stage')),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  environment text generated always as
    (case package_name when 'pl.kcswh.arcadepoker.stage' then 'stage' else 'production' end) stored,
  binding_id text,
  intent_id uuid,
  foreign key (binding_id, environment) references private.play_support_bindings(id, environment),
  sku text not null check (sku in ('supporter_bronze', 'supporter_silver', 'supporter_gold')),
  provider_state text not null check (provider_state in ('UNKNOWN', 'PENDING', 'PURCHASED', 'CANCELLED', 'VOID', 'REVOKED')),
  fulfilment text not null default 'NOT_GRANTED'
    check (fulfilment in ('NOT_GRANTED', 'GRANTED', 'REMOVED', 'UNGRANTABLE')),
  ack_state text not null default 'NOT_ELIGIBLE'
    check (ack_state in ('NOT_ELIGIBLE', 'DUE', 'IN_FLIGHT', 'CONFIRMED', 'UNCERTAIN')),
  ack_attempt_id uuid,
  order_id text check (length(order_id) <= 128),
  is_test boolean not null,
  completed_at timestamptz,
  refund_observed_at timestamptz,
  support_required_at timestamptz,
  created_at timestamptz not null default now(),
  check (ack_state <> 'IN_FLIGHT' or ack_attempt_id is not null),
  check (intent_id is null or binding_id is not null),
  foreign key (intent_id, binding_id, sku)
    references private.play_support_intents (id, binding_id, sku) on delete set null (intent_id),
  unique (id, sku)
);
create index play_support_receipts_binding_idx on private.play_support_receipts (binding_id);

-- The access migration must route entitlement insertion through a scoped
-- grant routine: it locks the active binding and checks the receipt state and
-- intent link before advancing fulfillment. Writers get no direct insert here.
create table private.play_support_entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  source_receipt_id uuid not null unique,
  grant_event_id uuid not null unique default gen_random_uuid(),
  granted_at timestamptz not null default now(),
  celebration_claimed_at timestamptz,
  primary key (user_id, sku),
  foreign key (source_receipt_id, sku) references private.play_support_receipts (id, sku)
);

-- Selection validity is checked in the scoped preference/revoke routines.
create table private.play_support_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_sku text check (selected_sku in ('supporter_bronze', 'supporter_silver', 'supporter_gold')),
  visible boolean not null default true
);

-- Opaque provider work can arrive before its receipt is verified.
-- Retain ciphertext here while required by ack, recovery or reconciliation.
-- A matching message ID is advisory; redelivery must still be able to process
-- eligible work. The processor checks recovery owner health at HTTP success.
create table private.play_support_inbox (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  package_name text not null check (package_name in ('pl.kcswh.arcadepoker', 'pl.kcswh.arcadepoker.stage')),
  token_key_version integer,
  token_nonce bytea check (octet_length(token_nonce) = 12),
  token_ciphertext bytea check (octet_length(token_ciphertext) between 1 and 8192),
  token_tag bytea check (octet_length(token_tag) = 16),
  last_message_id text check (length(last_message_id) <= 128),
  last_event_at timestamptz,
  ack_deadline_at timestamptz,
  next_check_at timestamptz,
  lease_until timestamptz,
  generation bigint not null default 0 check (generation >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  last_checked_at timestamptz,
  check (
    (token_key_version is null and token_nonce is null and token_ciphertext is null and token_tag is null)
    or (token_key_version is not null and token_key_version > 0 and token_nonce is not null
        and token_ciphertext is not null and token_tag is not null)
  ),
  check (next_check_at is null or token_ciphertext is not null)
);
create index play_support_inbox_due_idx
  on private.play_support_inbox (next_check_at, token_hash) where next_check_at is not null;

create table private.play_support_reconcile_cursor (
  package_name text primary key check (package_name in ('pl.kcswh.arcadepoker', 'pl.kcswh.arcadepoker.stage')),
  checked_through timestamptz not null,
  window_end timestamptz,
  page_token text check (length(page_token) <= 4096),
  check (window_end is null or window_end >= checked_through),
  check (page_token is null or window_end is not null)
);

revoke all on table private.play_support_bindings, private.play_support_intents,
  private.play_support_receipts, private.play_support_entitlements, private.play_support_preferences,
  private.play_support_inbox, private.play_support_reconcile_cursor
  from public, anon, authenticated, service_role;

alter table private.play_support_bindings enable row level security;
alter table private.play_support_intents enable row level security;
alter table private.play_support_receipts enable row level security;
alter table private.play_support_entitlements enable row level security;
alter table private.play_support_preferences enable row level security;
alter table private.play_support_inbox enable row level security;
alter table private.play_support_reconcile_cursor enable row level security;
