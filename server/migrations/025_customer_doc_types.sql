-- نوع مستند المنشأة: السجل التجاري / الشهادة الضريبية / العنوان الوطني
alter table customer_documents add column if not exists doc_type text;
