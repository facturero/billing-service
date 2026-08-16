import { dinero, subtract, add, multiply, toDecimal, toUnits, allocate } from 'dinero.js';
import type { Dinero } from 'dinero.js';
import { BadRequestError } from './errors.js';

export function createMoney(amount: number, currencyCode: string): Dinero<number> {
  return dinero({ amount, currency: { code: currencyCode, base: 10, exponent: 2 } });
}

export function moneyFromDecimalString(amount: string, currencyCode: string): Dinero<number> {
  const numeric = parseFloat(amount);
  return createMoney(Math.round(numeric * 100), currencyCode);
}

export function moneyToDecimalString(money: Dinero<number>): string {
  return toDecimal(money);
}

export function moneyToCents(money: Dinero<number>): number {
  return money.toJSON().amount;
}

export function moneyAdd(a: Dinero<number>, b: Dinero<number>): Dinero<number> {
  return add(a, b);
}

export function moneySubtract(a: Dinero<number>, b: Dinero<number>): Dinero<number> {
  return subtract(a, b);
}

export function moneyAllocate(money: Dinero<number>, ratios: number[]): Dinero<number>[] {
  return allocate(money, ratios);
}

export function moneyPercentage(rate: number, amount: Dinero<number>): number {
  return (rate / 100) * moneyToCents(amount);
}

export function addCents(a: number, b: number): number {
  return a + b;
}

export function subtractCents(a: number, b: number): number {
  return a - b;
}
