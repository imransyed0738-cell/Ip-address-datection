/**
 * Deployment-owner configuration. Replace these with the real, verified
 * contact details for your institution before going live.
 */
export const SUPPORT = {
  phone: import.meta.env['VITE_SUPPORT_PHONE'] ?? "+91 99725 98412",
  email: import.meta.env['VITE_SUPPORT_EMAIL'] ?? "imransyed0738@gmail.com",
  emergencyEmail: import.meta.env['VITE_EMERGENCY_SECURITY_EMAIL'] ?? "security@sentinelsecure.example",
} as const;
