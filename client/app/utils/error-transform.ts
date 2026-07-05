type ErrorRecord = Record<string, string | string[]>;

function formatFieldName(fieldPath: string): string {
  const lastPart = fieldPath.split(".").pop() || fieldPath;
  return lastPart.charAt(0).toUpperCase() + lastPart.slice(1).replace(/_/g, " ");
}

export function ErrorTransformer(error: unknown): ErrorRecord {
  const fallback = { non_field_error: "Something went wrong" };

  if (!error || typeof error !== "object") {
    return fallback;
  }

  const maybeError = error as { errors?: unknown };
  const errors = maybeError.errors;

  if (!errors || typeof errors !== "object") {
    return fallback;
  }

  const detail = (errors as { detail?: unknown }).detail;
  if (typeof detail === "string") {
    return { non_field_error: detail };
  }

  if (!Array.isArray(detail)) {
    return errors as ErrorRecord;
  }

  const result: ErrorRecord = {};
  for (const entry of detail) {
    if (typeof entry === "string") {
      result.non_field_error = result.non_field_error
        ? Array.isArray(result.non_field_error)
          ? [...result.non_field_error, entry]
          : [result.non_field_error, entry]
        : entry;
      continue;
    }

    if (!entry || typeof entry !== "object") continue;
    const loc = (entry as { loc?: unknown }).loc;
    const msg = (entry as { msg?: unknown }).msg;
    if (!Array.isArray(loc) || typeof msg !== "string") continue;

    const fieldPath = loc.filter((item) => !["body", "query", "path"].includes(String(item))).join(".");
    if (!fieldPath) continue;

    const normalizedMessage = msg === "field required" ? `${formatFieldName(fieldPath)} is required` : msg;
    if (!result[fieldPath]) {
      result[fieldPath] = normalizedMessage;
    } else if (Array.isArray(result[fieldPath])) {
      result[fieldPath].push(normalizedMessage);
    } else {
      result[fieldPath] = [result[fieldPath], normalizedMessage];
    }
  }

  return Object.keys(result).length ? result : fallback;
}
