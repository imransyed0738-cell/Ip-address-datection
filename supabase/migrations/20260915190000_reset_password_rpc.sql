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