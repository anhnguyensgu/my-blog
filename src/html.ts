import { escapeHtml } from "./markdown/escape.ts";

/** HTML that is already safe to embed; produced by `html` or explicitly trusted via `raw`. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Trust a string as HTML. Only use for renderer output, never for user-supplied text. */
export function raw(value: string): Html {
  return new Html(value);
}

/**
 * Tagged template that escapes every interpolated value unless it is `Html`.
 * Arrays are concatenated; `null`, `undefined`, and `false` render as nothing.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  for (let k = 0; k < values.length; k++) out += interpolate(values[k]) + strings[k + 1]!;
  return new Html(out);
}

function interpolate(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(String(value));
}
