import { normalizePhone, type Customer } from "./types";

export function searchCustomersByPhone(
    customers: readonly Customer[],
    query: string,
): Customer[] {
    const search = query.trim();
    const digits = search.replace(/\D/g, "");
    if (digits.length < 3 || !/^[+\d\s().-]+$/.test(search)) {
        return [];
    }
    const normalized = normalizePhone(search);
    return customers
        .filter((customer) => {
            const phone = normalizePhone(customer.phone ?? "");
            return phone.includes(normalized) || phone.includes(digits);
        })
        .slice(0, 8);
}
