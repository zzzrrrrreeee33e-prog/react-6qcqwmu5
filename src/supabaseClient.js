import { createClient } from "@supabase/supabase-js";

// anon key آمن للاستخدام هنا في المتصفح — الحماية الفعلية تأتي من RLS
// في قاعدة البيانات (ملفات supabase/migrations). لا تضع هنا أبداً
// أي مفتاح اسمه "service_role".
const SUPABASE_URL = "https://hzkwqtiexdwcorzvcwdc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6a3dxdGlleGR3Y29yenZjd2RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MzU5MTMsImV4cCI6MjA5NDAxMTkxM30.7jvs_yhpgD2O4yPrgVdAo9ULIdEM9ICQeFF17ueTFo0";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);