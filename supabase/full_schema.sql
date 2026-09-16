-- FULL SCHEMA SETUP FOR SUPABASE



-- =============================
-- 20260902154038_08ba67c4-8e2e-4416-bcf4-7a3766be7643.sql
-- =============================


-- roles
CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  mobile text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  account_locked boolean NOT NULL DEFAULT false,
  location_consent boolean NOT NULL DEFAULT false,
  location_consent_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_location_label text,
  last_location_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- security events
CREATE TABLE public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  ip_address text,
  user_agent text,
  device_type text,
  browser text,
  os text,
  location_label text,
  latitude double precision,
  longitude double precision,
  risk_score int NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'LOW',
  risk_reasons text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'Trusted',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user_idx ON public.security_events(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read" ON public.security_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- devices
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_key text NOT NULL,
  device_name text,
  device_type text,
  browser text,
  os text,
  trusted boolean NOT NULL DEFAULT false,
  last_ip text,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_key)
);
CREATE INDEX devices_user_idx ON public.devices(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own devices read" ON public.devices FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own devices write" ON public.devices FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own devices delete" ON public.devices FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- alerts / notifications
CREATE TABLE public.security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'INFO',
  category text NOT NULL DEFAULT 'security',
  event_id uuid REFERENCES public.security_events(id) ON DELETE SET NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_alerts_user_idx ON public.security_alerts(user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.security_alerts TO authenticated;
GRANT ALL ON public.security_alerts TO service_role;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own alerts read" ON public.security_alerts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own alerts update" ON public.security_alerts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- audit logs (admin/service written only)
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  resource text,
  ip_address text,
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin audit read" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- profile auto-creation
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
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER PUBLICATION supabase_realtime ADD TABLE public.security_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.security_alerts;


-- =============================
-- 20260902154058_f6bde0d4-f348-4521-93b9-422f1b4a5c8f.sql
-- =============================


REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;


-- =============================
-- 20260903141834_6c31b9fc-e784-4818-af56-36852423fbb2.sql
-- =============================

CREATE TABLE public.security_risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'LOW',
  reasons text[] NOT NULL DEFAULT '{}',
  review_status text NOT NULL DEFAULT 'PENDING',
  reviewed_by_admin_id uuid,
  notes text,
  generated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.security_risk_assessments TO authenticated;
GRANT ALL ON public.security_risk_assessments TO service_role;
ALTER TABLE public.security_risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin risk read" ON public.security_risk_assessments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_risk_user_generated ON public.security_risk_assessments (user_id, generated_at DESC);

CREATE TABLE public.admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_notes TO authenticated;
GRANT ALL ON public.admin_notes TO service_role;
ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin notes read" ON public.admin_notes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS flagged_for_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS require_password_reset boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location_accuracy double precision;

ALTER PUBLICATION supabase_realtime ADD TABLE public.security_risk_assessments;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE lower(email) = 'syedimranpasha012@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- =============================
-- 20260905120000_admin_realtime.sql
-- =============================

-- Keep the administrator views current when user profiles or devices change.
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;

-- =============================
-- 20260905130000_enable_audit_log_realtime.sql
-- =============================

-- Stream server-written audit entries to authorised admin clients.
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;


-- =============================
-- 20260905140000_track_user_registration.sql
-- =============================

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


-- =============================
-- 20260905150000_admin_role_bootstrap.sql
-- =============================

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


-- =============================
-- 20260906110000_user_monitoring_insert_policies.sql
-- =============================

-- Allow the authenticated monitoring functions to write only their own records.
CREATE POLICY "own events insert" ON public.security_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own devices insert" ON public.devices FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own alerts insert" ON public.security_alerts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own audit insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = actor_id);


-- =============================
-- 20260906160000_mobile_tracking_consent.sql
-- =============================

CREATE TABLE public.mobile_tracking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mobile text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'expired')),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mobile_tracking_requests_user_idx
  ON public.mobile_tracking_requests(requester_id, created_at DESC);

GRANT SELECT ON public.mobile_tracking_requests TO authenticated;
GRANT ALL ON public.mobile_tracking_requests TO service_role;
ALTER TABLE public.mobile_tracking_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own mobile tracking requests read"
  ON public.mobile_tracking_requests FOR SELECT TO authenticated
  USING (auth.uid() = requester_id);


-- =============================
-- 20260915190000_reset_password_rpc.sql
-- =============================

CREATE OR REPLACE FUNCTION public.reset_user_password_by_email(
  p_email    text,
  p_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $$
BEGIN
  UPDATE auth.users
  SET
    encrypted_password = crypt(p_password, gen_salt('bf')),
    updated_at         = now()
  WHERE lower(email) = lower(p_email);
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_user_password_by_email(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.reset_user_password_by_email(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_user_password_by_email(text, text) TO service_role;