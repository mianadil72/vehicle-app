const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat('en-US');

export const formatPrice = (n: number) => currency.format(n);
export const formatMileage = (n: number) => `${number.format(n)} mi`;
