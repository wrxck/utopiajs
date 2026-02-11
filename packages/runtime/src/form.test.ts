// ============================================================================
// form.test.ts — Tests for createForm reactive form validation
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { effect } from '@matthesketh/utopia-core';
import {
  createForm,
  required,
  minLength,
  maxLength,
  min,
  max,
  email,
  pattern,
  validate,
} from './form';

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

describe('validation rules', () => {
  describe('required', () => {
    const rule = required();
    it('fails on empty string', () => expect(rule('')).toBeTruthy());
    it('fails on whitespace-only string', () => expect(rule('  ')).toBeTruthy());
    it('fails on null', () => expect(rule(null)).toBeTruthy());
    it('fails on undefined', () => expect(rule(undefined)).toBeTruthy());
    it('passes on non-empty string', () => expect(rule('hello')).toBeNull());
    it('passes on zero', () => expect(rule(0)).toBeNull());
    it('passes on false', () => expect(rule(false)).toBeNull());
    it('accepts custom message', () => {
      expect(required('fill this in')('')).toBe('fill this in');
    });
  });

  describe('minLength', () => {
    const rule = minLength(3);
    it('fails on short string', () => expect(rule('ab')).toBeTruthy());
    it('passes on exact length', () => expect(rule('abc')).toBeNull());
    it('passes on longer string', () => expect(rule('abcd')).toBeNull());
  });

  describe('maxLength', () => {
    const rule = maxLength(5);
    it('fails on long string', () => expect(rule('abcdef')).toBeTruthy());
    it('passes on exact length', () => expect(rule('abcde')).toBeNull());
    it('passes on shorter string', () => expect(rule('abc')).toBeNull());
  });

  describe('min', () => {
    const rule = min(18);
    it('fails on low number', () => expect(rule(17)).toBeTruthy());
    it('passes on exact', () => expect(rule(18)).toBeNull());
    it('passes on higher', () => expect(rule(25)).toBeNull());
  });

  describe('max', () => {
    const rule = max(100);
    it('fails on high number', () => expect(rule(101)).toBeTruthy());
    it('passes on exact', () => expect(rule(100)).toBeNull());
    it('passes on lower', () => expect(rule(50)).toBeNull());
  });

  describe('email', () => {
    const rule = email();
    it('passes on valid email', () => expect(rule('user@example.com')).toBeNull());
    it('fails on missing @', () => expect(rule('userexample.com')).toBeTruthy());
    it('fails on missing domain', () => expect(rule('user@')).toBeTruthy());
    it('passes on empty string (use required for presence)', () => expect(rule('')).toBeNull());
  });

  describe('pattern', () => {
    const rule = pattern(/^\d+$/, 'Numbers only');
    it('passes on matching', () => expect(rule('123')).toBeNull());
    it('fails on non-matching', () => expect(rule('abc')).toBe('Numbers only'));
    it('passes on empty (use required for presence)', () => expect(rule('')).toBeNull());
  });

  describe('validate (custom)', () => {
    const rule = validate<number>((v) => v % 2 === 0, 'Must be even');
    it('passes when predicate returns true', () => expect(rule(4)).toBeNull());
    it('fails when predicate returns false', () => expect(rule(3)).toBe('Must be even'));
  });
});

// ---------------------------------------------------------------------------
// createForm
// ---------------------------------------------------------------------------

describe('createForm', () => {
  it('creates fields with initial values', () => {
    const form = createForm({
      name: { initial: '' },
      age: { initial: 0 },
    });

    expect(form.fields.name.value()).toBe('');
    expect(form.fields.age.value()).toBe(0);
  });

  it('field.set() updates the value reactively', () => {
    const form = createForm({
      name: { initial: '' },
    });

    form.fields.name.set('Matt');
    expect(form.fields.name.value()).toBe('Matt');
  });

  it('field errors are reactive to value changes', () => {
    const form = createForm({
      name: { initial: '', rules: [required(), minLength(2)] },
    });

    // Initially invalid (empty string)
    expect(form.fields.name.errors()).toEqual([
      'This field is required',
      'Must be at least 2 characters',
    ]);
    expect(form.fields.name.error()).toBe('This field is required');

    form.fields.name.set('A');
    expect(form.fields.name.errors()).toEqual(['Must be at least 2 characters']);

    form.fields.name.set('AB');
    expect(form.fields.name.errors()).toEqual([]);
    expect(form.fields.name.error()).toBeNull();
  });

  it('field.valid is reactive', () => {
    const form = createForm({
      name: { initial: '', rules: [required()] },
    });

    expect(form.fields.name.valid()).toBe(false);
    form.fields.name.set('hello');
    expect(form.fields.name.valid()).toBe(true);
  });

  it('field.dirty tracks changes from initial value', () => {
    const form = createForm({
      name: { initial: 'original' },
    });

    expect(form.fields.name.dirty()).toBe(false);
    form.fields.name.set('changed');
    expect(form.fields.name.dirty()).toBe(true);
    form.fields.name.set('original');
    expect(form.fields.name.dirty()).toBe(false);
  });

  it('field.touched tracks blur state', () => {
    const form = createForm({
      name: { initial: '' },
    });

    expect(form.fields.name.touched()).toBe(false);
    form.fields.name.touch();
    expect(form.fields.name.touched()).toBe(true);
  });

  it('form.valid is true when all fields are valid', () => {
    const form = createForm({
      name: { initial: '', rules: [required()] },
      email: { initial: '', rules: [required(), email()] },
    });

    expect(form.valid()).toBe(false);

    form.fields.name.set('Matt');
    expect(form.valid()).toBe(false); // email still invalid

    form.fields.email.set('matt@example.com');
    expect(form.valid()).toBe(true);
  });

  it('form.dirty is true when any field is dirty', () => {
    const form = createForm({
      name: { initial: '' },
      email: { initial: '' },
    });

    expect(form.dirty()).toBe(false);
    form.fields.name.set('changed');
    expect(form.dirty()).toBe(true);
  });

  it('form.data() returns current values as plain object', () => {
    const form = createForm({
      name: { initial: 'Matt' },
      age: { initial: 25 },
    });

    expect(form.data()).toEqual({ name: 'Matt', age: 25 });

    form.fields.age.set(30);
    expect(form.data()).toEqual({ name: 'Matt', age: 30 });
  });

  it('form.handleSubmit calls callback when valid', () => {
    const form = createForm({
      name: { initial: 'Matt', rules: [required()] },
    });

    const onSubmit = vi.fn();
    form.handleSubmit(onSubmit);

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Matt' });
  });

  it('form.handleSubmit does not call callback when invalid', () => {
    const form = createForm({
      name: { initial: '', rules: [required()] },
    });

    const onSubmit = vi.fn();
    form.handleSubmit(onSubmit);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('form.handleSubmit touches all fields to show errors', () => {
    const form = createForm({
      name: { initial: '', rules: [required()] },
      email: { initial: '', rules: [required()] },
    });

    expect(form.fields.name.touched()).toBe(false);
    expect(form.fields.email.touched()).toBe(false);

    form.handleSubmit(() => {});

    expect(form.fields.name.touched()).toBe(true);
    expect(form.fields.email.touched()).toBe(true);
  });

  it('form.reset() resets all fields', () => {
    const form = createForm({
      name: { initial: '' },
      age: { initial: 0 },
    });

    form.fields.name.set('Matt');
    form.fields.age.set(25);
    form.fields.name.touch();

    form.reset();

    expect(form.fields.name.value()).toBe('');
    expect(form.fields.age.value()).toBe(0);
    expect(form.fields.name.touched()).toBe(false);
    expect(form.fields.name.dirty()).toBe(false);
  });

  it('fields without rules are always valid', () => {
    const form = createForm({
      notes: { initial: '' },
    });

    expect(form.fields.notes.valid()).toBe(true);
    expect(form.fields.notes.errors()).toEqual([]);
  });

  it('integrates with effect() for reactive UI', () => {
    const form = createForm({
      name: { initial: '', rules: [required()] },
    });

    const states: boolean[] = [];
    const dispose = effect(() => {
      states.push(form.valid());
    });

    form.fields.name.set('hello');

    expect(states).toEqual([false, true]);

    dispose();
  });
});
