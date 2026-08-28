const SENSITIVE_KEY = /authorization|cookie|token|secret|password|api[-_]?key|credential/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export interface Redactor {
  value<T>(input: T): T;
  text(input: string): string;
}

export function createRedactor(secrets: string[] = []): Redactor {
  const known = [...new Set(secrets.filter((item) => item.length >= 3))].sort((a, b) => b.length - a.length);

  const variants = [...new Set(known.flatMap((secret) => { const values = [secret]; try { const encoded = [...Buffer.from(secret)].map((byte) => /[A-Za-z0-9._~-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join(""); values.push(encodeURIComponent(secret), encoded, encodeURIComponent(encoded)); } catch {} try { values.push(Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("base64url")); } catch {} return values.filter((item) => item.length >= 3); }))].sort((a, b) => b.length - a.length);
  function text(input: string): string {
    let output = redactUrls(input.replace(BEARER, "Bearer [REDACTED]"));
    for (const secret of variants) output = output.split(secret).join("[REDACTED]");
    return output;
  }

  function walk(input: unknown, seen: WeakSet<object>): unknown {
    if (typeof input === "string") return text(input);
    if (Array.isArray(input)) return input.map((item) => walk(item, seen));
    if (typeof input !== "object" || input === null) return input;
    if (seen.has(input)) return "[CIRCULAR]";
    seen.add(input);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : walk(item, seen);
    }
    return output;
  }

  return {
    value<T>(input: T): T { return walk(input, new WeakSet()) as T; },
    text,
  };
}

function redactUrls(input: string): string { return input.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => { try { const url = new URL(candidate); if (url.username || url.password) { url.username = "REDACTED"; url.password = "REDACTED"; } for (const key of [...url.searchParams.keys()]) if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, "REDACTED"); if (url.hash && SENSITIVE_KEY.test(url.hash)) url.hash = "#REDACTED"; return url.toString(); } catch { return candidate.replace(/\/\/[^/@\s]+@/, "//[REDACTED]@"); } }); }

export function collectTargetSecrets(target: unknown): string[] {
  if (typeof target !== "object" || target === null) return [];
  const record = target as Record<string, unknown>;
  const stores = [record.headers, record.env];
  return stores.flatMap((store) =>
    typeof store === "object" && store !== null ? Object.values(store).filter((value): value is string => typeof value === "string") : [],
  );
}
