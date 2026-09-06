-- Keep the configured administrator able to sign in even when the account
-- was created after the original admin-role migration.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'syedimranpasha012@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

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
  VALUES (
    NEW.id,
    CASE
      WHEN lower(NEW.email) = 'syedimranpasha012@gmail.com' THEN 'admin'::public.app_role
      ELSE 'user'::public.app_role
    END
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.security_events (
    user_id, event_type, risk_score, risk_level, status, metadata, created_at
  )
  VALUES (
    NEW.id, 'ACCOUNT_REGISTERED', 0, 'LOW', 'Trusted',
    jsonb_build_object('source', 'registration'), NEW.created_at
  );

  INSERT INTO public.audit_logs (actor_id, actor_role, action, resource, result, created_at)
  VALUES (
    NEW.id,
    CASE WHEN lower(NEW.email) = 'syedimranpasha012@gmail.com' THEN 'admin' ELSE 'user' END,
    'ACCOUNT_REGISTERED',
    'profiles/' || NEW.id::text,
    'success',
    NEW.created_at
  );

  RETURN NEW;
END;
$$;
