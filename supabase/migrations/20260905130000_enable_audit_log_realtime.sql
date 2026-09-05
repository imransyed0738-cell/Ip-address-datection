-- Stream server-written audit entries to authorised admin clients.
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
