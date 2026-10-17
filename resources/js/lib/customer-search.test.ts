import { describe, expect, it } from "vitest";
import { searchCustomersByPhone } from "./customer-search";
import type { Customer } from "./types";

const customers: Customer[] = [
    {
        id: "local",
        name: "Local format",
        phone: "016-272 6866",
        version: 1,
        created_by: 1,
    },
    {
        id: "international",
        name: "International format",
        phone: "+60162726867",
        version: 1,
        created_by: 1,
    },
    {
        id: "unrelated",
        name: "0162726866 in a name",
        phone: "+60187654321",
        version: 1,
        created_by: 1,
    },
];
describe("invoice customer phone search", () => {
    it("does not show customers before a useful phone number is entered", () => {
        for (const query of ["", " ", "01", "Local", "Name 0162726866"]) {
            expect(searchCustomersByPhone(customers, query)).toEqual([]);
        }
    });
    it("matches local and international formats without matching customer names", () => {
        expect(
            searchCustomersByPhone(customers, "016272").map(
                (customer) => customer.id,
            ),
        ).toEqual(["local", "international"]);
        expect(
            searchCustomersByPhone(customers, "+60 16-272 6866").map(
                (customer) => customer.id,
            ),
        ).toEqual(["local"]);
    });
    it("finds a partial phone number from the customers saved on the device", () => {
        expect(
            searchCustomersByPhone(customers, "2726867").map(
                (customer) => customer.id,
            ),
        ).toEqual(["international"]);
        expect(searchCustomersByPhone(customers, "0191234567")).toEqual([]);
    });
    it("limits the suggestions to eight matching customers", () => {
        const matches = Array.from({ length: 10 }, (_, index) => ({
            ...customers[0]!,
            id: String(index),
        }));

        expect(searchCustomersByPhone(matches, "016272")).toHaveLength(8);
    });
});
