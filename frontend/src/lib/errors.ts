/**
 * Maps raw invoke error messages to user-friendly messages.
 * Returns the friendly message, or the original if no pattern matches.
 */
export function friendlyInvokeError(raw: string): string {
  const lower = raw.toLowerCase();

  // HTTP 401 or unauthorized
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "This agent requires authentication. Please select a credential or provide a bearer token in the Invoke panel before sending a prompt.";
  }

  // HTTP 403 or forbidden/access denied
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("access denied") || lower.includes("accessdenied")) {
    return "Access was denied. The selected credential may not have the required permissions for this agent. Try a different credential or contact your administrator.";
  }

  // Token errors
  if (lower.includes("token") && (lower.includes("failed") || lower.includes("error") || lower.includes("expired"))) {
    return "The credential token could not be obtained or has expired. Please verify the credential configuration in the Security Admin page and try again.";
  }

  // Missing credential
  if (lower.includes("no credential") || lower.includes("credential not found") || lower.includes("credential_id")) {
    return "A credential is required to invoke this agent. Please select one from the credential dropdown in the Invoke panel.";
  }

  // No match — return original
  return raw;
}
