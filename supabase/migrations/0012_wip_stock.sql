-- Phase 8: WIP Stock
-- Read-only phase: no new tables, no stock-moving RPC — just a view of
-- what's currently sitting in WIP-zone locations, plus the
-- WIP Lot -> IQC -> Receiving -> PO -> Supplier traceability link.
--
-- Both reads are SECURITY DEFINER functions gated by
-- has_permission('wip_stock', 'view') rather than a plain view, so a
-- user with wip_stock view access doesn't also need separate
-- permissions on receiving/purchase_orders/master_data just to see
-- their own WIP stock and its trace — the wip_stock module permission
-- is the single gate, matching the doc's intent for this screen.

create or replace function get_wip_stock()
returns table (
  lot_id uuid,
  lot_no text,
  item_id uuid,
  part_no text,
  location_id uuid,
  location_code text,
  qty numeric,
  iqc_id uuid,
  iqc_no text,
  iqc_date timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sb.lot_id, l.lot_no, l.item_id, i.part_no,
    sb.location_id, loc.code, sb.qty,
    iqc.id, iqc.iqc_no, iqc.inspected_at
  from stock_balance sb
  join lots l on l.id = sb.lot_id
  join items i on i.id = l.item_id
  join locations loc on loc.id = sb.location_id
  left join lateral (
    select * from iqc_inspections where lot_id = sb.lot_id order by inspected_at desc limit 1
  ) iqc on true
  where loc.zone_type = 'WIP'
    and sb.qty > 0
    and has_permission('wip_stock', 'view');
$$;

create or replace function get_lot_traceability(p_lot_id uuid)
returns table (
  lot_no text,
  part_no text,
  iqc_no text,
  iqc_date timestamptz,
  iqc_qty_pass numeric,
  iqc_qty_hold numeric,
  iqc_qty_ng numeric,
  gr_no text,
  received_date date,
  po_no text,
  po_date date,
  supplier_code text,
  supplier_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.lot_no, i.part_no,
    iqc.iqc_no, iqc.inspected_at, iqc.qty_pass, iqc.qty_hold, iqc.qty_ng,
    gr.gr_no, gr.received_date,
    po.po_no, po.po_date,
    sup.code, sup.name
  from lots l
  join items i on i.id = l.item_id
  left join iqc_inspections iqc on iqc.lot_id = l.id
  left join goods_receipt_lines grl on grl.lot_id = l.id
  left join goods_receipts gr on gr.id = grl.gr_id
  left join purchase_orders po on po.id = gr.po_id
  left join suppliers sup on sup.id = po.supplier_id
  where l.id = p_lot_id
    and has_permission('wip_stock', 'view');
$$;
