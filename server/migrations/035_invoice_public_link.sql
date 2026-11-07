-- رابط عام لكل فاتورة (عرض فقط) يُطبع كرمز QR على الفاتورة
alter table invoices add column if not exists public_token text default encode(gen_random_bytes(16), 'hex');
create unique index if not exists invoices_public_token_idx on invoices(public_token);
