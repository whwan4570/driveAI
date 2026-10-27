-- Carmori MVP schema (Supabase Postgres). store.MemoryStore와 같은 모양이다.

create table if not exists vehicles (
  vehicle_id text primary key,
  spec_id text not null,
  year int not null,
  odometer_km int,
  created_at timestamptz not null default now()
);

create table if not exists work_sessions (
  session_id text primary key,
  vehicle_id text not null references vehicles(vehicle_id),
  state jsonb not null,               -- SessionState 전체 (현재 단계·대기 사유·최근 순서)
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_records (
  record_id text primary key,
  vehicle_id text not null references vehicles(vehicle_id),
  task text not null,
  completed_at timestamptz not null,
  completion_source text not null check (completion_source in ('observed_sequence', 'user_voice_confirmed', 'manual_entry')),
  completion_event_id text unique,     -- 중복 저장 방지 키
  session_id text references work_sessions(session_id),
  evidence_frames text[] not null default '{}',
  product_label text,
  flow_observed boolean not null default false,
  model_version text,
  notes text,
  revision int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_records_vehicle_idx
  on maintenance_records (vehicle_id, completed_at desc);

create table if not exists inspection_observations (
  session_id text not null references work_sessions(session_id),
  sequence_id int not null,
  step text not null,
  attempt int not null,
  captured_at timestamptz not null,
  frame_ids text[] not null,
  answer jsonb not null,
  accepted boolean not null,
  reason text not null,
  model_version text,
  primary key (session_id, sequence_id)
);

-- 근거 프레임 이미지는 Storage 버킷 'evidence-frames/{session_id}/{frame_id}.jpg'에 둔다.
