import { z } from 'zod';

/** Yönetici girişi (F0.3). Oturum iki aşamalıdır: password -> mfa. 2FA (TOTP) zorunludur. */
export const AdminLoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});
export type AdminLogin = z.infer<typeof AdminLoginSchema>;

export const MfaCodeSchema = z.object({
  /** 6 haneli TOTP kodu ya da kurtarma kodu (xxxx-xxxx-xx) */
  code: z.string().trim().min(6).max(20),
});
export type MfaCode = z.infer<typeof MfaCodeSchema>;

/** Giriş sonrası durum: hangi adımın beklendiğini söyler. */
export type AdminSessionStage = 'mfa_setup' | 'mfa_verify' | 'full';

export interface AdminLoginResult {
  stage: AdminSessionStage;
}

export interface MfaSetupResult {
  /** otpauth:// adresi (QR kodu buna göre üretilir) */
  otpauth_url: string;
  /** Elle girmek için base32 sır */
  secret: string;
}

export interface MfaVerifyResult {
  stage: 'full';
  /** Yalnız 2FA ilk kez kurulduğunda bir kez gösterilir */
  recovery_codes?: string[];
}

export interface AdminMe {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
}
