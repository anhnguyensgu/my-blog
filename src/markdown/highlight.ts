// A small lexical highlighter for fenced code: comments, strings, numbers,
// keywords, types, and function calls. It does not parse; it only colors.

import { escapeHtml } from "./escape.ts";

interface LanguageSpec {
  lineComment?: string[];
  blockComment?: [string, string][];
  strings: string[];
  keywords: string;
  types?: string;
}

interface Language {
  pattern: RegExp;
  keywords: Set<string>;
  types: Set<string>;
}

const C_COMMENTS = { lineComment: ["//"], blockComment: [["/*", "*/"]] as [string, string][] };

const SPECS: Record<string, LanguageSpec> = {
  ts: {
    ...C_COMMENTS,
    strings: ['"', "'", "`"],
    keywords:
      "abstract as async await break case catch class const continue debugger default delete do else " +
      "enum export extends false finally for from function get if implements import in instanceof interface " +
      "let new null of private protected public readonly return satisfies set static super switch this throw " +
      "true try type typeof undefined var void while yield",
    types: "string number boolean unknown never any object bigint symbol",
  },
  odin: {
    ...C_COMMENTS,
    strings: ['"', "'", "`"],
    keywords:
      "package import proc struct enum union map dynamic bit_set matrix if else for in not_in do switch " +
      "case break continue fallthrough return defer when where using distinct foreign cast transmute auto_cast " +
      "nil true false context or_return or_else or_break or_continue",
    types:
      "int uint i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f16 f32 f64 bool b8 b16 b32 b64 string cstring " +
      "rune rawptr byte uintptr any typeid",
  },
  zig: {
    lineComment: ["//"],
    strings: ['"', "'"],
    keywords:
      "const var fn pub return if else while for switch break continue defer errdefer try catch orelse " +
      "struct enum union error test comptime inline export extern packed align null undefined true false " +
      "unreachable and or noreturn threadlocal usingnamespace",
    types: "u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f16 f32 f64 bool void anyerror anytype type",
  },
  go: {
    ...C_COMMENTS,
    strings: ['"', "'", "`"],
    keywords: "break case chan const continue default defer else fallthrough for func go goto if import " +
      "interface map package range return select struct switch type var nil true false iota",
    types:
      "bool byte rune int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 " +
      "string error any",
  },
  rust: {
    ...C_COMMENTS,
    strings: ['"'],
    keywords:
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop " +
      "match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    types:
      "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result",
  },
  c: {
    ...C_COMMENTS,
    strings: ['"', "'"],
    keywords:
      "auto break case const continue default do else enum extern for goto if inline register restrict " +
      "return sizeof static struct switch typedef union volatile while class namespace template typename public " +
      "private protected virtual override new delete true false nullptr NULL #include #define #ifdef #endif",
    types:
      "void char short int long float double signed unsigned bool size_t int32_t int64_t uint8_t uint32_t " +
      "uint64_t",
  },
  java: {
    ...C_COMMENTS,
    strings: ['"', "'"],
    keywords:
      "abstract assert break case catch class const continue default do else enum extends final finally " +
      "for if implements import instanceof interface native new package private protected public record return " +
      "sealed static super switch synchronized this throw throws try var void volatile while yield true false " +
      "null fun val when object companion",
    types: "boolean byte char double float int long short",
  },
  python: {
    lineComment: ["#"],
    strings: ['"', "'"],
    keywords:
      "and as assert async await break class continue def del elif else except False finally for from " +
      "global if import in is lambda None nonlocal not or pass raise return True try while with yield self",
    types: "int float str bool list dict set tuple bytes",
  },
  sh: {
    lineComment: ["#"],
    strings: ['"', "'"],
    keywords:
      "if then else elif fi for while until do done case esac in function return export local readonly " +
      "set unset echo cd exit source sudo",
  },
  sql: {
    lineComment: ["--"],
    strings: ["'"],
    keywords:
      "select from where insert into values update set delete create table index view join left right " +
      "inner outer on group by order having limit offset and or not null as distinct primary key references " +
      "SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX VIEW JOIN LEFT RIGHT INNER " +
      "OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET AND OR NOT NULL AS DISTINCT PRIMARY KEY REFERENCES",
  },
  json: { strings: ['"'], keywords: "true false null" },
  yaml: { lineComment: ["#"], strings: ['"', "'"], keywords: "true false null yes no on off" },
  css: { blockComment: [["/*", "*/"]], strings: ['"', "'"], keywords: "" },
};

const ALIASES: Record<string, string> = {
  js: "ts",
  javascript: "ts",
  typescript: "ts",
  tsx: "ts",
  jsx: "ts",
  mjs: "ts",
  rs: "rust",
  h: "c",
  cpp: "c",
  "c++": "c",
  cc: "c",
  kotlin: "java",
  kt: "java",
  py: "python",
  bash: "sh",
  zsh: "sh",
  shell: "sh",
  console: "sh",
  yml: "yaml",
  toml: "yaml",
  scss: "css",
};

const compiled = new Map<string, Language>();

/** Highlight `code` for `lang`, returning escaped HTML. Unknown languages are only escaped. */
export function highlight(code: string, lang: string): string {
  const language = languageFor(lang.toLowerCase());
  if (!language) return escapeHtml(code);

  let out = "";
  let last = 0;
  for (const match of code.matchAll(language.pattern)) {
    const [token, comment, str, num, word] = match;
    const start = match.index;
    out += escapeHtml(code.slice(last, start));
    last = start + token.length;

    let cls = "";
    if (comment) cls = "c";
    else if (str) cls = "s";
    else if (num) cls = "n";
    else if (word) {
      if (language.keywords.has(word)) cls = "k";
      else if (language.types.has(word) || /^[A-Z][a-z]/.test(word)) cls = "t";
      else if (word.startsWith("@") || /^\s*\(/.test(code.slice(last, last + 8))) cls = "f";
    }
    out += cls ? `<span class="tok-${cls}">${escapeHtml(token)}</span>` : escapeHtml(token);
  }
  return out + escapeHtml(code.slice(last));
}

function languageFor(lang: string): Language | null {
  const name = ALIASES[lang] ?? lang;
  const cached = compiled.get(name);
  if (cached) return cached;
  const spec = SPECS[name];
  if (!spec) return null;

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const comments = [
    ...(spec.lineComment ?? []).map((l) => `${esc(l)}[^\\n]*`),
    ...(spec.blockComment ?? []).map(([open, close]) => `${esc(open)}[\\s\\S]*?(?:${esc(close)}|$)`),
  ];
  const strings = spec.strings.map((q) =>
    q === "`" ? "`(?:\\\\[\\s\\S]|[^\\\\`])*`?" : `${esc(q)}(?:\\\\.|[^\\\\${esc(q)}\\n])*${esc(q)}?`
  );
  const pattern = new RegExp(
    [
      comments.length ? `(${comments.join("|")})` : "(\\b\\B)",
      `(${strings.join("|")})`,
      "(\\b\\d[\\w.]*)",
      "([#@]?[A-Za-z_$][\\w$]*)",
    ].join("|"),
    "g",
  );
  const language: Language = {
    pattern,
    keywords: new Set(spec.keywords.split(/\s+/).filter(Boolean)),
    types: new Set((spec.types ?? "").split(/\s+/).filter(Boolean)),
  };
  compiled.set(name, language);
  return language;
}
