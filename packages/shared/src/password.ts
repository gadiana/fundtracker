export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean; // upper- and lowercase letters
  requireNumber: boolean;
  requireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireNumber: true,
  requireSymbol: false,
};

export const PASSWORD_MAX_LENGTH = 128;

/** Returns the unmet requirements; empty means the password is acceptable. */
export function passwordIssues(password: string, policy: PasswordPolicy): string[] {
  const issues: string[] = [];
  if (password.length < policy.minLength) issues.push(`At least ${policy.minLength} characters`);
  if (password.length > PASSWORD_MAX_LENGTH) issues.push(`At most ${PASSWORD_MAX_LENGTH} characters`);
  if (policy.requireUpper && !(/[A-Z]/.test(password) && /[a-z]/.test(password))) {
    issues.push('Both uppercase and lowercase letters');
  }
  if (policy.requireNumber && !/\d/.test(password)) issues.push('At least one number');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push('At least one symbol');
  return issues;
}

export function describePasswordPolicy(policy: PasswordPolicy): string[] {
  const rules = [`At least ${policy.minLength} characters`];
  if (policy.requireUpper) rules.push('Both uppercase and lowercase letters');
  if (policy.requireNumber) rules.push('At least one number');
  if (policy.requireSymbol) rules.push('At least one symbol');
  return rules;
}
