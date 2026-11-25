-- Daily check-in: {water: cups, mood: 'good'|'ok'|'tired', back: 'fine'|'stiff'|'pain'}
alter table public.daily_records add column if not exists checkin jsonb;
