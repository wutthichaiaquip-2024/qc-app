-- Phase 22: Barcode / QR (extension)
-- Extends the Phase 6/14 QR scanning work to label PRINTING: FG Lot,
-- WIP Lot, Location, Shipment/Box. The QR content itself doesn't
-- change (still the versioned JSON payload from src/lib/barcode.ts —
-- {v, type, id, code, part_no, site}, id is always the real lookup
-- key, nothing transient like qty/status ever goes in the code) —
-- this migration only adds a way to read the small set of fields a
-- printed label needs to show, for whichever entity is being labeled.
--
-- One function across all label types, each gated by the single most
-- relevant module permission (not the several underlying tables' own
-- permissions) — same reasoning Phase 8 documented for
-- get_wip_stock(): a WIP Stock user shouldn't also need Receiving or
-- Master Data permissions just to print a label for stock they can
-- already see. LOT covers both WIP and FG lots (one identity, per
-- Phase 17) and is reachable from three different screens, so it
-- accepts any one of their view permissions.
create or replace function get_label_data(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_type = 'LOT' then
    if not (
      has_permission('wip_stock', 'view')
      or has_permission('fg_stock', 'view')
      or has_permission('traceability', 'view')
    ) then
      raise exception 'Permission denied for label type LOT';
    end if;

    select jsonb_build_object('lot_id', l.id, 'lot_no', l.lot_no, 'part_no', i.part_no, 'description', i.description)
    into v_result
    from lots l
    join items i on i.id = l.item_id
    where l.id = p_id;

  elsif p_type = 'LOCATION' then
    if not has_permission('master_data', 'view') then
      raise exception 'Permission denied for label type LOCATION';
    end if;

    select jsonb_build_object(
      'location_id', loc.id, 'code', loc.code, 'name', loc.name,
      'zone_type', loc.zone_type, 'site_code', s.code
    )
    into v_result
    from locations loc
    join sites s on s.id = loc.site_id
    where loc.id = p_id;

  elsif p_type = 'SHIPMENT_BOX' then
    if not has_permission('shipping', 'view') then
      raise exception 'Permission denied for label type SHIPMENT_BOX';
    end if;

    select jsonb_build_object(
      'box_id', sb.id, 'box_no', sb.box_no,
      'shipment_id', sh.id, 'shipment_no', sh.shipment_no,
      'so_no', so.so_no, 'customer_code', c.code
    )
    into v_result
    from shipment_boxes sb
    join shipments sh on sh.id = sb.shipment_id
    join sales_orders so on so.id = sh.so_id
    join customers c on c.id = so.customer_id
    where sb.id = p_id;

  else
    raise exception 'Unknown label type: %', p_type;
  end if;

  if v_result is null then
    raise exception 'Label target not found';
  end if;

  return v_result;
end;
$$;

revoke execute on function get_label_data from public, anon;
grant execute on function get_label_data to authenticated;
