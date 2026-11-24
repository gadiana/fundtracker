import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../password';

const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : undefined));

export const emailField = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const passwordField = z.string().min(1, 'Required').max(PASSWORD_MAX_LENGTH);

export const personNameFields = {
  firstName: requiredText(100),
  middleName: optionalText(100),
  lastName: requiredText(100),
  suffix: optionalText(20),
};

export const signupSchema = z.object({
  ...personNameFields,
  email: emailField,
  contactNo: optionalText(30),
  password: passwordField,
  consent: z.literal(true, { error: 'You must agree to the data privacy notice' }),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailField,
  password: passwordField,
});
export type LoginInput = z.input<typeof loginSchema>;

export const emailOnlySchema = z.object({ email: emailField });

export const tokenSchema = z.object({ token: z.string().min(16).max(200) });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordField,
});

export const changePasswordSchema = z.object({
  currentPassword: passwordField,
  newPassword: passwordField,
});

export const profileSchema = z.object({
  ...personNameFields,
  contactNo: optionalText(30),
});
export type ProfileInput = z.input<typeof profileSchema>;

// ───────────── two-factor sign-in ─────────────

/** A 6-digit code from the authenticator app, or a one-time recovery code like "k7pm-x2qd". */
const twoFactorCode = z.string().trim().min(6, 'Enter the 6-digit code').max(20);

export const loginTwoFactorSchema = z.object({ challenge: z.string().min(20).max(1000), code: twoFactorCode });
export const twoFactorCodeSchema = z.object({ code: twoFactorCode });
export const twoFactorPasswordSchema = z.object({ password: z.string().min(1, 'Enter your password').max(200), code: twoFactorCode });

export const TWO_FACTOR_MODES = ['off', 'optional', 'required'] as const;
export type TwoFactorMode = (typeof TWO_FACTOR_MODES)[number];
export const TWO_FACTOR_MODE_LABELS: Record<TwoFactorMode, string> = {
  off: 'Off',
  optional: 'Optional: members may turn it on in their profile',
  required: 'Required: every member must set it up before using this academic year',
};
