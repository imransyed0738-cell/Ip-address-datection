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
