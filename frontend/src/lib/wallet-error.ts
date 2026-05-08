export function isUserRejectedError(err: unknown): boolean {
  const message = extractErrorMessage(err).toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request")
  );
}

export function extractErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (err === undefined || err === null) return "";
  return String(err);
}
