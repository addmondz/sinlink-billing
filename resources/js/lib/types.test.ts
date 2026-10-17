import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, formatPhone, normalizePhone } from "./types";

describe("invoice numbers", () => {
    it.each([
        [1, "00001"],
        [1234, "01234"],
        [99999, "99999"],
        [100000, "100000"],
        ["SL-00001234", "01234"],
        ["00000001", "00001"],
        ["00042", "00042"],
        ["SL-00100000", "100000"],
        [null, null],
    ])("formats %s as %s", (value, expected) => {
        expect(formatInvoiceNumber(value)).toBe(expected);
    });
});

describe("customer phone numbers", () => {
    it.each([
        ["162726866", "+60162726866"],
        ["60162726866", "+60162726866"],
        ["0162726866", "+60162726866"],
        ["+60 16-272 6866", "+60162726866"],
        ["0060 (16) 272.6866", "+60162726866"],
        ["+60 (0)16 2726866", "+60162726866"],
        ["01123456789", "+601123456789"],
        ["1123456789", "+601123456789"],
        ["03-1234 5678", "+60312345678"],
        ["312345678", "+60312345678"],
        ["04-123 4567", "+6041234567"],
        ["41234567", "+6041234567"],
        ["+65 8123 4567", "+6581234567"],
        ["0044 7777 123456", "+447777123456"],
        ["447777123456", "+447777123456"],
        ["+1 (202) 555-0123", "+12025550123"],
        ["+2471234", "+2471234"],
        ["+123456789012345", "+123456789012345"],
    ])(
        "formats %s as %s and uses the same digits for matching",
        (input, expected) => {
            expect(formatPhone(input)).toBe(expected);
            expect(normalizePhone(input)).toBe(expected.slice(1));
        },
    );

    it.each([
        "",
        "   ",
        "0123",
        "123",
        "016272686",
        "16272686",
        "601627268",
        "+6031234567",
        "+60412345678",
        "0000000000",
        "+060162726866",
        "++60162726866",
        "60+162726866",
        "0162726866 ext 9",
        "call 0162726866",
        "0162726866 / 0123456789",
        "+1234567890123456",
    ])("identifies %s as invalid for customer filtering and saving", (input) => {
        expect(formatPhone(input)).toBeNull();
    });
});
