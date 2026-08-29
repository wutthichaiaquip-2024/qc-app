-- Phase 0: Document numbering infrastructure
-- Format: <PREFIX>-<YYYY>-<00001>, reset yearly per doc_type.
-- Uses an atomic counter table (INSERT ... ON CONFLICT DO UPDATE) instead of
-- MAX(id)+1 so concurrent requests never collide on the same number.

create table document_number_config (
  doc_type text primary key,
  prefix text not null,
  reset_yearly boolean not null default true,
  pad_width smallint not null default 5
);

insert into document_number_config (doc_type, prefix) values
  ('purchase_order', 'PO'),
  ('goods_receipt', 'GR'),
  ('iqc', 'IQC'),
  ('wip_request', 'WR'),
  ('fg_inspection', 'FG'),
  ('sales_order', 'SO'),
  ('picking', 'PK'),
  ('oqc', 'OQC'),
  ('shipment', 'SH'),
  ('forecast', 'FC');

create table document_number_counters (
  doc_type text not null references document_number_config (doc_type),
  period text not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (doc_type, period)
);

create or replace function generate_document_number(p_doc_type text)
returns text
language plpgsql
as $$
declare
  v_config document_number_config%rowtype;
  v_period text;
  v_next integer;
begin
  select * into v_config from document_number_config where doc_type = p_doc_type;
  if not found then
    raise exception 'Unknown document type: %', p_doc_type;
  end if;

  v_period := case when v_config.reset_yearly then to_char(now(), 'YYYY') else 'ALL' end;

  insert into document_number_counters (doc_type, period, last_number)
  values (p_doc_type, v_period, 1)
  on conflict (doc_type, period)
    do update set last_number = document_number_counters.last_number + 1,
                  updated_at = now()
  returning last_number into v_next;

  return v_config.prefix || '-' || v_period || '-' || lpad(v_next::text, v_config.pad_width, '0');
end;
$$;

revoke all on document_number_counters from public;
revoke all on document_number_config from public;
