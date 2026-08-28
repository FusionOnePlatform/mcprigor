export function readPath(value: unknown, path: string | undefined): unknown {
  if (!path || path === "$") return value;
  if (!path.startsWith("$.")) throw new Error(`JSON path must start with $.: ${path}`);

  const tokens = path
    .slice(2)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let current: unknown = value;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

export function replaceVariables(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\$\{([^}]+)\}$/);
    if (exact) {
        let resolved = variable(exact[1]!, variables);
      const seen = new Set<string>([value]);
      while (typeof resolved === "string" && /^\$\{[^}]+\}$/.test(resolved) && !seen.has(resolved)) {
        seen.add(resolved);
        resolved = replaceVariables(resolved, variables);
      }
      return resolved;
    }
    return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => String(variable(name, variables)));
  }
  if (Array.isArray(value)) return value.map((item) => replaceVariables(item, variables));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceVariables(item, variables)]),
    );
  }
  return value;
}

function variable(name: string, variables: Record<string, unknown>): unknown {
  if (name.startsWith("env.")) {
    const result = process.env[name.slice(4)];
    if (result === undefined) throw new Error(`Environment variable not found: ${name.slice(4)}`);
    return result;
  }
  if (name in variables) return variables[name];
  const [root, ...parts] = name.split(".");
  if (!(root! in variables)) throw new Error(`Captured variable not found: ${name}`);
  let current: unknown = variables[root!];
  for (const part of parts) {
    if (typeof current !== "object" || current === null) throw new Error(`Captured variable not found: ${name}`);
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) throw new Error(`Captured variable not found: ${name}`);
  return current;
}
