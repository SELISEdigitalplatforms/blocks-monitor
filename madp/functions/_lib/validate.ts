import { isValidEmail } from "../../src/domain/platform";
import { invalidInput, isOpError } from "./errors";

/** A dependency-free validator. Failures are invalid_input { field, rule }; the value is never echoed. */
export interface Validator<T> {
  readonly kind: "mf.validator";
  readonly optional?: boolean;
  parse(raw: unknown, field: string): T;
}

export type Infer<V> = V extends Validator<infer T> ? T : never;

export function isValidator(x: unknown): x is Validator<unknown> {
  return typeof x === "object" && x !== null && (x as { kind?: unknown }).kind === "mf.validator";
}

const make = <T>(parse: (raw: unknown, field: string) => T, optional?: boolean): Validator<T> => ({
  kind: "mf.validator",
  ...(optional ? { optional: true } : {}),
  parse,
});

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

type Shape = Record<string, Validator<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends { readonly optional: true } ? K : never }[keyof S];
type ObjectOf<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
  [K in OptionalKeys<S>]?: Infer<S[K]>;
};

const join = (field: string, key: string): string => (field ? `${field}.${key}` : key);

export const v = {
  object<S extends Shape>(shape: S): Validator<ObjectOf<S>> {
    return make((raw, field) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidInput(field || "args", "type");
      const src = raw as Record<string, unknown>;
      for (const key of Object.keys(src)) {
        if (!Object.prototype.hasOwnProperty.call(shape, key)) throw invalidInput(join(field, key), "unknown");
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        const spec = shape[key];
        const val = src[key];
        if (val === undefined) {
          if (!spec.optional) throw invalidInput(join(field, key), "required");
          continue;
        }
        out[key] = spec.parse(val, join(field, key));
      }
      return out as ObjectOf<S>;
    });
  },

  string(o: { min?: number; max?: number; pattern?: RegExp; trim?: boolean } = {}): Validator<string> {
    const { min = 0, max = 1000, pattern, trim } = o;
    return make((raw, field) => {
      if (typeof raw !== "string") throw invalidInput(field, "type");
      const s = trim ? raw.trim() : raw;
      if (s.length < min) throw invalidInput(field, "min");
      if (s.length > max) throw invalidInput(field, "max");
      if (pattern && !pattern.test(s)) throw invalidInput(field, "pattern");
      return s;
    });
  },

  id(): Validator<string> {
    return make((raw, field) => {
      if (typeof raw !== "string" || raw.length < 1 || raw.length > 100 || !ID_PATTERN.test(raw)) {
        throw invalidInput(field, "id");
      }
      return raw;
    });
  },

  email(): Validator<string> {
    return make((raw, field) => {
      if (typeof raw !== "string") throw invalidInput(field, "type");
      const e = raw.trim().toLowerCase();
      if (e.length > 254 || !isValidEmail(e)) throw invalidInput(field, "email");
      return e;
    });
  },

  enumOf<const T extends readonly string[]>(values: T): Validator<T[number]> {
    return make((raw, field) => {
      if (typeof raw !== "string" || !values.includes(raw)) throw invalidInput(field, "enum");
      return raw as T[number];
    });
  },

  int(o: { min?: number; max?: number } = {}): Validator<number> {
    const { min = -2147483648, max = 2147483647 } = o;
    return make((raw, field) => {
      if (typeof raw !== "number" || !Number.isInteger(raw)) throw invalidInput(field, "int");
      if (raw < min) throw invalidInput(field, "min");
      if (raw > max) throw invalidInput(field, "max");
      return raw;
    });
  },

  number(o: { min?: number; max?: number } = {}): Validator<number> {
    return make((raw, field) => {
      if (typeof raw !== "number" || !Number.isFinite(raw)) throw invalidInput(field, "number");
      if (o.min !== undefined && raw < o.min) throw invalidInput(field, "min");
      if (o.max !== undefined && raw > o.max) throw invalidInput(field, "max");
      return raw;
    });
  },

  bool(): Validator<boolean> {
    return make((raw, field) => {
      if (typeof raw !== "boolean") throw invalidInput(field, "type");
      return raw;
    });
  },

  array<T>(item: Validator<T>, o: { max: number; min?: number }): Validator<T[]> {
    return make((raw, field) => {
      if (!Array.isArray(raw)) throw invalidInput(field, "type");
      if (raw.length < (o.min ?? 0)) throw invalidInput(field, "min");
      if (raw.length > o.max) throw invalidInput(field, "max");
      return raw.map((el, i) => item.parse(el, `${field}[${i}]`));
    });
  },

  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return make((raw, field) => {
      if (raw === undefined) return undefined;
      if (raw === null) throw invalidInput(field, "type");
      return inner.parse(raw, field);
    }, true);
  },

  dateTime(): Validator<string> {
    return make((raw, field) => {
      if (typeof raw !== "string" || !DATE_TIME.test(raw)) throw invalidInput(field, "dateTime");
      const t = new Date(raw);
      if (Number.isNaN(t.getTime())) throw invalidInput(field, "dateTime");
      return t.toISOString();
    });
  },
};

/** Run an op's args spec. A function validator that throws a non-OpError becomes invalid_input { field: "args", rule: "invalid" }. */
export function parseArgs<A>(spec: Validator<A> | ((raw: unknown) => A), raw: unknown): A {
  if (isValidator(spec)) return (spec as Validator<A>).parse(raw, "");
  try {
    return spec(raw);
  } catch (e) {
    if (isOpError(e)) throw e;
    throw invalidInput("args", "invalid");
  }
}
