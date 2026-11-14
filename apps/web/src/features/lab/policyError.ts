/** The server's error code in plain words; unknown codes show as the code itself. */
export function policyErrorText(code: string | undefined, status: number): string {
  switch (code) {
    case "FORBIDDEN":
      return "Only an admin can change the policy.";
    case "UNAUTHORIZED":
      return "Your session has ended. Sign in again, then apply.";
    case "BAD_REQUEST":
      return "The server refused this policy as invalid. Nothing was changed.";
    case "STORAGE_UNAVAILABLE":
      return "The change could not be recorded, so nothing was applied. Try again in a moment.";
    case undefined:
      return `The server answered ${status}. Nothing was changed.`;
    default:
      return code;
  }
}
