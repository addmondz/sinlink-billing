import Decimal from "decimal.js";
import type { Item } from "./types";
export function calculate(items: Item[]) {
    let total = new Decimal(0),
        quantity = new Decimal(0);
    const lines = items.map((item) => {
        if (
            !/^\d{1,7}(\.\d{1,3})?$/.test(String(item.quantity)) ||
            !/^\d{1,7}(\.\d{1,2})?$/.test(String(item.unit_price))
        )
            throw new Error(
                "Use a positive quantity (up to 3 decimals) and price (up to 2 decimals).",
            );
        const q = new Decimal(item.quantity);
        if (q.lte(0)) throw new Error("Quantity must be greater than zero.");
        const cents = q
            .mul(item.unit_price)
            .mul(100)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        total = total.add(cents);
        quantity = quantity.add(q);
        return { ...item, amount_cents: cents.toNumber() };
    });
    if (total.gt(9999999999))
        throw new Error("Maximum invoice amount is MYR 99,999,999.99.");
    return {
        items: lines,
        total_cents: total.toNumber(),
        subtotal_cents: total.toNumber(),
        total_quantity: quantity.toFixed(3),
    };
}
export const money = (cents: number) =>
    new Intl.NumberFormat("en-MY", {
        style: "currency",
        currency: "MYR",
    }).format(new Decimal(cents).div(100).toNumber());
const amountFormatter = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
export const formatAmount = (amount: string | number): string =>
    amountFormatter.format(new Decimal(amount).toNumber());
const ones = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];
const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
];
function spell(n: number): string {
    if (n < 20) return ones[n]!;
    if (n < 100)
        return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    if (n < 1000)
        return (
            ones[Math.floor(n / 100)] +
            " hundred" +
            (n % 100 ? " and " + spell(n % 100) : "")
        );
    for (const [v, name] of [
        [1000000, "million"],
        [1000, "thousand"],
    ] as const)
        if (n >= v)
            return (
                spell(Math.floor(n / v)) +
                " " +
                name +
                (n % v ? " " + spell(n % v) : "")
            );
    return "";
}
export function amountWords(cents: number): string {
    const ringgit = Math.floor(cents / 100),
        sen = cents % 100;
    return (
        "Ringgit Malaysia " +
        spell(ringgit) +
        (sen ? " and " + spell(sen) + " sen" : "") +
        " only"
    ).toUpperCase();
}
