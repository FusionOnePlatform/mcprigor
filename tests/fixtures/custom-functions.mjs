export function calculateTax({ amount, rate }) {
  return Math.round(Number(amount) * Number(rate) * 100) / 100;
}

export function makeLabel({ prefix, value }) {
  return `${prefix}-${value}`;
}
