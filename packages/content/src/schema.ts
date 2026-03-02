import type { CollectionSchema, SchemaField, ValidationError } from './types.js';

/**
 * Validate data against a collection schema.
 * Returns an array of validation errors (empty if valid).
 */
export function validateSchema(data: Record<string, unknown>, schema: CollectionSchema): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [field, def] of Object.entries(schema)) {
    const value = data[field];

    if (value === undefined || value === null) {
      if (def.required) {
        errors.push({ field, message: `Required field "${field}" is missing` });
      }
      continue;
    }

    const fieldError = validateField(field, value, def);
    if (fieldError) {
      errors.push(fieldError);
    }
  }

  return errors;
}

/**
 * Apply schema defaults to data.
 * Returns a new object with defaults merged in for missing fields.
 */
export function applyDefaults(data: Record<string, unknown>, schema: CollectionSchema): Record<string, unknown> {
  const result = { ...data };

  for (const [field, def] of Object.entries(schema)) {
    if ((result[field] === undefined || result[field] === null) && def.default !== undefined) {
      result[field] = def.default;
    }
  }

  return result;
}

function validateField(field: string, value: unknown, def: SchemaField): ValidationError | null {
  switch (def.type) {
    case 'string':
      if (typeof value !== 'string') {
        return { field, message: `Expected "${field}" to be a string, got ${typeof value}`, value };
      }
      break;

    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return { field, message: `Expected "${field}" to be a number, got ${typeof value}`, value };
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return { field, message: `Expected "${field}" to be a boolean, got ${typeof value}`, value };
      }
      break;

    case 'date': {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          return { field, message: `"${field}" is an invalid date`, value };
        }
      } else if (typeof value === 'string') {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return { field, message: `"${field}" is not a valid date string`, value };
        }
      } else {
        return { field, message: `Expected "${field}" to be a date or date string, got ${typeof value}`, value };
      }
      break;
    }

    case 'array':
      if (!Array.isArray(value)) {
        return { field, message: `Expected "${field}" to be an array, got ${typeof value}`, value };
      }
      if (def.items) {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] !== def.items) {
            return {
              field,
              message: `Expected "${field}[${i}]" to be ${def.items}, got ${typeof value[i]}`,
              value: value[i],
            };
          }
        }
      }
      break;
  }

  return null;
}
