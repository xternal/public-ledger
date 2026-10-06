/**
 * Error text that is safe to log. Provider errors can quote the recipient
 * (SES does, for unverified identities), and we never log an address.
 */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
  return raw
    .replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, "[address]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .slice(0, 300);
}
