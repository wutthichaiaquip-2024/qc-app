-- Phase 17: Stock Transaction & Traceability
-- "ทุก Movement สร้าง Transaction พร้อมรายละเอียดครบถ้วน" is already
-- satisfied by construction — every stock-moving RPC since Phase 6 has
-- written a stock_transactions row (13 txn_types now: RECEIPT,
-- IQC_OUT/PASS/HOLD/NG, WIP_REQUEST_OUT, FG_PASS/HOLD/NG,
-- OQC_OUT/HOLD/NG, SHIPMENT_OUT). This migration adds the two things
-- that weren't already covered:
--
-- 1. Append-only enforced by an actual DB trigger, not just RLS
--    (RLS already denies authenticated by having no mutation policy,
--    but the doc says "บังคับด้วย DB trigger/permission" — a trigger
--    is a second, independent mechanism that blocks UPDATE/DELETE
--    even for a role that somehow bypassed RLS).
-- 2. True bidirectional traceability. The genealogy chain has TWO lot
--    identities, not one: a receiving lot (created in Phase 6) and a
--    separately-created FG lot (created in Phase 10), bridged via
--    wip_requests/fg_inspections. Phase 8's get_lot_traceability()
--    only ever walked backward from one lot. get_lot_genealogy() below
--    walks both directions from *either* lot identity, recursing
--    exactly once across that WIP-lot -> FG-lot bridge (bounded — the
--    schema has no deeper chain than that).

create or replace function prevent_stock_transactions_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_transactions is append-only — % is not allowed', TG_OP;
end;
$$;

create trigger stock_transactions_append_only
  before update or delete on stock_transactions
  for each row execute function prevent_stock_transactions_mutation();

-- ---------------------------------------------------------------------
-- get_lot_genealogy: full forward+backward trace from any lot.
-- ---------------------------------------------------------------------
create or replace function get_lot_genealogy(p_lot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lot record;
  v_upstream_receiving jsonb;
  v_iqc jsonb;
  v_downstream_wip jsonb;
  v_downstream_allocations jsonb;
  v_source_wip_lot_id uuid;
  v_upstream_chain jsonb;
begin
  if not has_permission('traceability', 'view') then
    raise exception 'Permission denied for traceability.view';
  end if;

  select l.id, l.lot_no, l.item_id, i.part_no
  into v_lot
  from lots l
  join items i on i.id = l.item_id
  where l.id = p_lot_id;

  if not found then
    raise exception 'Lot not found';
  end if;

  -- Backward: Receiving -> PO -> Supplier (only present if this is a receiving lot)
  select jsonb_build_object(
    'gr_no', gr.gr_no, 'received_date', gr.received_date,
    'po_no', po.po_no, 'po_date', po.po_date,
    'supplier_code', sup.code, 'supplier_name', sup.name
  )
  into v_upstream_receiving
  from goods_receipt_lines grl
  join goods_receipts gr on gr.id = grl.gr_id
  join purchase_orders po on po.id = gr.po_id
  join suppliers sup on sup.id = po.supplier_id
  where grl.lot_id = p_lot_id;

  -- IQC results recorded directly against this lot
  select coalesce(jsonb_agg(jsonb_build_object(
    'iqc_no', iqc_no, 'inspected_at', inspected_at,
    'qty_pass', qty_pass, 'qty_hold', qty_hold, 'qty_ng', qty_ng
  )), '[]'::jsonb)
  into v_iqc
  from iqc_inspections
  where lot_id = p_lot_id;

  -- Forward: WIP requests cut from this lot -> FG inspections -> new FG lots
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_no', wr.request_no, 'requested_qty', wr.requested_qty,
    'fg_no', fgi.fg_no, 'new_lot_id', fgi.new_lot_id, 'new_lot_no', l2.lot_no,
    'qty_pass', fgi.qty_pass, 'qty_hold', fgi.qty_hold, 'qty_ng', fgi.qty_ng
  )), '[]'::jsonb)
  into v_downstream_wip
  from wip_requests wr
  left join fg_inspections fgi on fgi.wip_request_id = wr.id
  left join lots l2 on l2.id = fgi.new_lot_id
  where wr.wip_lot_id = p_lot_id;

  -- Forward: allocations of this lot -> SO/customer -> picking -> OQC -> shipment
  select coalesce(jsonb_agg(jsonb_build_object(
    'so_no', so.so_no, 'customer_code', c.code, 'qty', a.qty, 'status', a.status,
    'picking_no', pk.picking_no,
    'oqc_no', oi.oqc_no, 'oqc_result', oi.result,
    'shipment_no', sh.shipment_no, 'shipped_at', sh.shipped_at
  )), '[]'::jsonb)
  into v_downstream_allocations
  from allocations a
  join sales_order_lines sol on sol.id = a.so_line_id
  join sales_orders so on so.id = sol.so_id
  join customers c on c.id = so.customer_id
  left join picking_lines pl on pl.allocation_id = a.id
  left join pickings pk on pk.id = pl.picking_id
  left join oqc_inspections oi on oi.picking_id = pk.id
  left join shipment_box_lines sbl on sbl.allocation_id = a.id
  left join shipment_boxes sb on sb.id = sbl.box_id
  left join shipments sh on sh.id = sb.shipment_id
  where a.lot_id = p_lot_id;

  -- If this lot IS an FG-inspection output, pull in its source WIP
  -- lot's full genealogy too (bounded: one recursion, no deeper chain exists).
  select wr.wip_lot_id into v_source_wip_lot_id
  from fg_inspections fgi
  join wip_requests wr on wr.id = fgi.wip_request_id
  where fgi.new_lot_id = p_lot_id;

  if v_source_wip_lot_id is not null then
    v_upstream_chain := get_lot_genealogy(v_source_wip_lot_id);
  end if;

  return jsonb_build_object(
    'lot_id', v_lot.id,
    'lot_no', v_lot.lot_no,
    'part_no', v_lot.part_no,
    'upstream_receiving', v_upstream_receiving,
    'iqc_results', v_iqc,
    'downstream_wip_requests', v_downstream_wip,
    'downstream_allocations', v_downstream_allocations,
    'upstream_source_lot', v_upstream_chain
  );
end;
$$;
