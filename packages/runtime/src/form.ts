// ============================================================================
// @matthesketh/utopia-runtime — Reactive form validation
// ============================================================================
//
// Provides createForm() — a first-class reactive form primitive with
// declarative validation, dirty/touched tracking, and type-safe field access.
//
// Usage:
//   const form = createForm({
//     name: { initial: '', rules: [required(), minLength(2)] },
//     email: { initial: '', rules: [required(), email()] },
//     age: { initial: 0, rules: [required(), min(18)] },
//   });
//
//   form.fields.name.value()    // current value
//   form.fields.name.error()    // first error message or null
//   form.fields.name.errors()   // all error messages
//   form.fields.name.touched()  // has the field been blurred?
//   form.fields.name.dirty()    // has the value changed from initial?
//   form.fields.name.set('Matt')
//   form.valid()                // is the entire form valid?
//   form.data()                 // { name: 'Matt', email: '', age: 0 }
//   form.handleSubmit(fn)       // validates all, calls fn if valid
// ============================================================================

import { signal, computed, batch, type Signal, type ReadonlySignal } from '@matthesketh/utopia-core';

// ---------------------------------------------------------------------------
// Validation rule types
// ---------------------------------------------------------------------------

/** A validation rule returns null if valid, or an error message string. */
export type ValidationRule<T = any> = (value: T) => string | null;

/** Field configuration. */
export interface FieldConfig<T> {
  /** Initial value. */
  initial: T;
  /** Validation rules to apply. */
  rules?: ValidationRule<T>[];
}

// ---------------------------------------------------------------------------
// Reactive field state
// ---------------------------------------------------------------------------

/** Reactive state for a single form field. */
export interface FormField<T> {
  /** Current field value (reactive signal). */
  value: ReadonlySignal<T>;
  /** Set the field value. */
  set(newValue: T): void;
  /** First validation error or null. */
  error: ReadonlySignal<string | null>;
  /** All validation errors. */
  errors: ReadonlySignal<string[]>;
  /** Whether the field has been touched (blurred). */
  touched: ReadonlySignal<boolean>;
  /** Mark the field as touched. */
  touch(): void;
  /** Whether the value differs from the initial value. */
  dirty: ReadonlySignal<boolean>;
  /** Whether the field is valid. */
  valid: ReadonlySignal<boolean>;
  /** Reset the field to its initial value and clear touched state. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

/** Maps field config to reactive field state. */
export type FormFields<T extends Record<string, FieldConfig<any>>> = {
  [K in keyof T]: FormField<T[K]['initial']>;
};

/** Extracts the data type from field configs. */
export type FormData<T extends Record<string, FieldConfig<any>>> = {
  [K in keyof T]: T[K]['initial'];
};

/** The reactive form instance. */
export interface Form<T extends Record<string, FieldConfig<any>>> {
  /** Reactive field accessors. */
  fields: FormFields<T>;
  /** Whether all fields are valid (reactive). */
  valid: ReadonlySignal<boolean>;
  /** Whether any field is dirty (reactive). */
  dirty: ReadonlySignal<boolean>;
  /** Extract current form data as a plain object. */
  data(): FormData<T>;
  /** Validate all fields, touch them all, and call onSubmit if valid. */
  handleSubmit(onSubmit: (data: FormData<T>) => void | Promise<void>): void;
  /** Reset all fields to their initial values. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// createForm()
// ---------------------------------------------------------------------------

/**
 * Create a reactive form with declarative validation.
 *
 * ```ts
 * const form = createForm({
 *   name: { initial: '', rules: [required(), minLength(2)] },
 *   email: { initial: '', rules: [required(), email()] },
 * });
 * ```
 */
export function createForm<T extends Record<string, FieldConfig<any>>>(
  config: T,
): Form<T> {
  const fieldEntries: [string, FormField<any>][] = [];

  for (const [key, fieldConfig] of Object.entries(config)) {
    fieldEntries.push([key, createField(fieldConfig)]);
  }

  const fields = Object.fromEntries(fieldEntries) as FormFields<T>;

  const valid = computed(() => {
    for (const [, field] of fieldEntries) {
      if (!field.valid()) return false;
    }
    return true;
  });

  const dirty = computed(() => {
    for (const [, field] of fieldEntries) {
      if (field.dirty()) return true;
    }
    return false;
  });

  return {
    fields,
    valid,
    dirty,

    data(): FormData<T> {
      const result: Record<string, any> = {};
      for (const [key, field] of fieldEntries) {
        result[key] = field.value();
      }
      return result as FormData<T>;
    },

    handleSubmit(onSubmit) {
      // Touch all fields to show errors.
      batch(() => {
        for (const [, field] of fieldEntries) {
          field.touch();
        }
      });

      if (valid()) {
        onSubmit(this.data());
      }
    },

    reset() {
      batch(() => {
        for (const [, field] of fieldEntries) {
          field.reset();
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// createField() — internal
// ---------------------------------------------------------------------------

function createField<T>(config: FieldConfig<T>): FormField<T> {
  const _value = signal<T>(config.initial);
  const _touched = signal(false);
  const rules = config.rules ?? [];

  const errors = computed<string[]>(() => {
    const val = _value();
    const errs: string[] = [];
    for (const rule of rules) {
      const result = rule(val);
      if (result !== null) {
        errs.push(result);
      }
    }
    return errs;
  });

  const error = computed<string | null>(() => {
    const errs = errors();
    return errs.length > 0 ? errs[0] : null;
  });

  const dirty = computed(() => !Object.is(_value(), config.initial));
  const valid = computed(() => errors().length === 0);

  return {
    value: _value,
    set(newValue: T) {
      _value.set(newValue);
    },
    error,
    errors,
    touched: _touched,
    touch() {
      _touched.set(true);
    },
    dirty,
    valid,
    reset() {
      _value.set(config.initial);
      _touched.set(false);
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in validation rules
// ---------------------------------------------------------------------------

/** Field must have a non-empty value. */
export function required(message = 'This field is required'): ValidationRule {
  return (value) => {
    if (value === '' || value === null || value === undefined) return message;
    if (typeof value === 'string' && value.trim() === '') return message;
    return null;
  };
}

/** String must be at least `n` characters. */
export function minLength(n: number, message?: string): ValidationRule<string> {
  return (value) => {
    if (typeof value === 'string' && value.length < n) {
      return message ?? `Must be at least ${n} characters`;
    }
    return null;
  };
}

/** String must be at most `n` characters. */
export function maxLength(n: number, message?: string): ValidationRule<string> {
  return (value) => {
    if (typeof value === 'string' && value.length > n) {
      return message ?? `Must be at most ${n} characters`;
    }
    return null;
  };
}

/** Number must be at least `n`. */
export function min(n: number, message?: string): ValidationRule<number> {
  return (value) => {
    if (typeof value === 'number' && value < n) {
      return message ?? `Must be at least ${n}`;
    }
    return null;
  };
}

/** Number must be at most `n`. */
export function max(n: number, message?: string): ValidationRule<number> {
  return (value) => {
    if (typeof value === 'number' && value > n) {
      return message ?? `Must be at most ${n}`;
    }
    return null;
  };
}

/** String must match a valid email format. */
export function email(message = 'Invalid email address'): ValidationRule<string> {
  return (value) => {
    if (typeof value !== 'string') return null;
    if (value === '') return null; // Use required() for presence check.
    // Simple but practical email regex.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return message;
    return null;
  };
}

/** String must match the given regex pattern. */
export function pattern(
  regex: RegExp,
  message = 'Invalid format',
): ValidationRule<string> {
  return (value) => {
    if (typeof value !== 'string' || value === '') return null;
    if (!regex.test(value)) return message;
    return null;
  };
}

/** Custom validation rule from a predicate function. */
export function validate<T>(
  predicate: (value: T) => boolean,
  message = 'Invalid value',
): ValidationRule<T> {
  return (value) => {
    if (!predicate(value)) return message;
    return null;
  };
}
