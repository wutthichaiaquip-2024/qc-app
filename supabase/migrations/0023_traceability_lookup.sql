-- Phase 17 (cont.): small lookup so the traceability UI can resolve a
-- scanned/typed lot_no to a lot_id without needing separate
-- permissions on the lots table (same has_permission('traceability',
-- 'view') gate as get_lot_genealogy()).
create or replace function find_lot_by_no(p_lot_no text)
returns table (lot_id uuid, item_id uuid, part_no text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.item_id, i.part_no
  from lots l
  join items i on i.id = l.item_id
  where l.lot_no = p_lot_no
    and has_permission('traceability', 'view');
$$;
