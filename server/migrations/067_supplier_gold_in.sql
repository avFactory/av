-- استلام ذهب من المورد إلى الخزنة (يُخصم من رصيده المقدم مثل استلام الخامات)
alter table gold_supplier_entries drop constraint if exists gold_supplier_entries_kind_check;
alter table gold_supplier_entries add constraint gold_supplier_entries_kind_check check (kind in ('gold_out', 'findings_in', 'gold_in', 'opening'));
