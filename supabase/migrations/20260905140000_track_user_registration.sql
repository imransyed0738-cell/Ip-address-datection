-- Make registration visible to the administrator security monitor.
-- Repair profiles for users created before the profile trigger was available.
INSERT INTO public.profiles (id, full_name, email, mobile, address, city, state, country, postal_code, created_at)
SELECT
  u.id,
  u.raw_user_meta_data->>'full_name',
  u.email,
  u.raw_user_meta_data->>'mobile',
  u.raw_user_meta_data->>'address',
  u.raw_user_meta_data->>'city',
  u.raw_user_meta_data->>'state',
  u.raw_user_meta_data->>'country',
  u.raw_user_meta_data->>'postal_code',
  u.created_at
FROM auth.users AS u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::public.app_role
FROM auth.users AS u
ON CONFLICT (user_id, role) DO NOTHING;

-- Give existing accounts a historical registration event when one is absent.
INSERT INTO public.security_events (user_id, event_type, risk_score, risk_level, status, metadata, created_at)
SELECT u.id, 'ACCOUNT_REGISTERED', 0, 'LOW', 'Trusted', jsonb_build_object('source', 'registration_backfill'), u.created_at
FROM auth.users AS u
WHERE NOT EXISTS (
  SELECT 1
  FROM public.security_events AS e
  WHERE e.user_id = u.id
    AND e.event_type = 'ACCOUNT_REGISTERED'
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, mobile, address, city, state, country, postal_code)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    NEW.raw_user_meta_data->>'mobile',
    NEW.raw_user_meta_data->>'address',
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'state',
    NEW.raw_user_meta_data->>'country',
    NEW.raw_user_meta_data->>'postal_code'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.security_events (
    user_id, event_type, risk_score, risk_level, status, metadata, created_at
  )
  VALUES (
    NEW.id, 'ACCOUNT_REGISTERED', 0, 'LOW', 'Trusted',
    jsonb_build_object('source', 'registration'), NEW.created_at
  );

  INSERT INTO public.audit_logs (actor_id, actor_role, action, resource, result, created_at)
  VALUES (NEW.id, 'user', 'ACCOUNT_REGISTERED', 'profiles/' || NEW.id::text, 'success', NEW.created_at);

  RETURN NEW;
END;
$$;
