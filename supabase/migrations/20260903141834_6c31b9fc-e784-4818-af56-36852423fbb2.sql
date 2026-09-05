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