import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
    documentModel,
    invoiceFilename,
    invoiceLayout,
    invoicePdf,
    invoicePdfFile,
} from "./document";
import type { Invoice } from "./types";

function invoice(): Invoice {
    return {
        id: "reference",
        invoice_number: "23434",
        status: "issued",
        invoice_date: "2026-10-09",
        customer_id: "customer",
        customer_snapshot: { name: "", phone: "" },
        company_snapshot: {
            company_name: "SINLINK AUTO ACCESSORIES",
            registration_number: "",
            address: "",
            phone: "",
            logo: "",
            paper_size: "A4",
            margin_mm: 12,
            footer_terms: "",
            signature_left: "Authorized signature",
            signature_right: "Customer signature",
            version: 1,
            business_id: "sinlink",
        },
        vehicle_registration: "VDR 4118",
        car_model: "MYVI",
        notes: "",
        items: [
            {
                id: "item",
                description: "CAR NUMBER PLATE & PANEL CASING",
                quantity: "1",
                unit: "PCS",
                unit_price: "40.00",
                amount_cents: 4000,
            },
        ],
        total_cents: 4000,
        subtotal_cents: 4000,
        total_quantity: "1.000",
        version: 1,
        created_by: 1,
        device_id: "device",
        created_at: "2026-10-09T00:00:00Z",
    };
}
afterEach(() => vi.unstubAllGlobals());
describe("Sinlink cash sales documents", () => {
    it.each([
        ["0.01", 2, "0.01", "0.02"],
        ["12345", 2469000, "12,345.00", "24,690.00"],
        ["12345.67", 2469134, "12,345.67", "24,691.34"],
        ["9999999.99", 1999999998, "9,999,999.99", "19,999,999.98"],
    ])(
        "formats unit price %s, line amounts and totals with commas and two decimals",
        (unitPrice, totalCents, formattedPrice, formattedTotal) => {
            const value = invoice();
            value.items[0] = {
                ...value.items[0]!,
                quantity: "2",
                unit_price: unitPrice,
                amount_cents: totalCents,
            };
            value.subtotal_cents = totalCents;
            value.total_cents = totalCents;
            value.total_quantity = "2.000";

            const text = invoiceLayout(value)
                .flat()
                .filter((element) => element.kind === "text")
                .map((element) => element.text);

            expect(text).toContain(formattedPrice);
            expect(
                text.filter((value) => value === formattedTotal),
            ).toHaveLength(3);
            expect(value.items[0].unit_price).toBe(unitPrice);
            expect(value.total_cents).toBe(totalCents);
        },
    );
    it("aligns the ringgit amount in words and subtotal on the same row", () => {
        const text = invoiceLayout(invoice())
            .flat()
            .filter((element) => element.kind === "text");
        const subtotal = text.find((element) => element.text === "SUBTOTAL :");
        expect(text.find((element) => element.text === "RINGGIT")?.y).toBe(
            subtotal?.y,
        );
        expect(text.find((element) => element.text === "FORTY ONLY")?.y).toBe(
            subtotal?.y,
        );
    });
    it("uses the supplied company details without changing the stored snapshot", () => {
        const original = invoice();
        const model = documentModel(original);
        expect(model.company.bank_details).toBe("PBB BANK: 3223817120");
        expect(model.company.registration_number).toBe("001025932-P");
        expect(model.words).toBe("FORTY ONLY");
        expect(original.company_snapshot.registration_number).toBe("");
    });
    it("keeps long descriptions, remarks and terms when they need additional pages", () => {
        const value = invoice();
        value.items = Array.from({ length: 85 }, (_, index) => ({
            ...value.items[0]!,
            id: String(index),
            description:
                "Installation item " +
                index +
                " with a long description ".repeat(20),
        }));
        value.notes = "Installation remarks ".repeat(200) + "FINAL REMARK";
        value.company_snapshot.footer_terms =
            "Acceptance terms ".repeat(200) + "FINAL TERM";
        const pages = invoiceLayout(value);
        const content = pages
            .flat()
            .filter((element) => element.kind === "text")
            .map((element) => element.text)
            .join(" ");
        expect(pages.length).toBeGreaterThan(1);
        expect(content).toContain("Installation item 84");
        expect(content).toContain("FINAL REMARK");
        expect(content).toContain("FINAL TERM");
        expect(content.match(/TOTAL AMOUNT :/g)).toHaveLength(1);
    });
    it("uses five-digit numbers in documents and filenames, including saved legacy invoices", () => {
        const value = invoice();
        value.invoice_number = "SL-00001234";
        expect(documentModel(value).number).toBe("01234");
        expect(invoiceFilename(value)).toBe("01234.pdf");
        expect(value.invoice_number).toBe("SL-00001234");
        value.invoice_number = "00001";
        expect(documentModel(value).number).toBe("00001");
        expect(invoiceFilename(value)).toBe("00001.pdf");
        value.invoice_number = "100000";
        expect(invoiceFilename(value)).toBe("100000.pdf");
        value.invoice_number = null;
        expect(documentModel(value).number).toBe("Unnumbered draft");
        expect(invoiceFilename(value)).toBe("Sinlink-draft.pdf");
    });
    it("generates the reference A4 document with the fonts embedded for offline downloads", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async (url: string) =>
                    new Response(readFileSync("resources/static" + url)),
            ),
        );
        const doc = await invoicePdf(invoice());
        expect(doc.getNumberOfPages()).toBe(1);
        expect(doc.internal.pageSize.getWidth()).toBeCloseTo(595.28, 1);
        mkdirSync("storage/test-artifacts", { recursive: true });
        writeFileSync(
            "storage/test-artifacts/reference-invoice.pdf",
            Buffer.from(doc.output("arraybuffer")),
        );
    });
    it("creates a PDF attachment with the invoice filename and content type", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async (url: string) =>
                    new Response(readFileSync("resources/static" + url)),
            ),
        );
        const value = invoice();
        value.invoice_number = "SL-00001234";

        const file = await invoicePdfFile(value);

        expect(file.name).toBe("01234.pdf");
        expect(file.type).toBe("application/pdf");
        expect(await file.slice(0, 5).text()).toBe("%PDF-");
    });
    it("explains how to recover when the connection fails while loading PDF fonts", async () => {
        vi.resetModules();
        const { invoicePdfFile: preparePdf } = await import("./document");
        vi.stubGlobal(
            "fetch",
            vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        );
        await expect(preparePdf(invoice())).rejects.toThrow(
            "Connect to the internet and reload this page, then try the PDF again.",
        );
    });
    it("can prepare sharing again after a font download fails", async () => {
        vi.resetModules();
        const { invoicePdfFile: preparePdf } = await import("./document");
        const fetchFont = vi
            .fn()
            .mockResolvedValue(new Response(null, { status: 503 }));
        vi.stubGlobal("fetch", fetchFont);

        await expect(preparePdf(invoice())).rejects.toThrow(
            "Invoice fonts are not available",
        );
        fetchFont.mockImplementation(
            async (url: string) =>
                new Response(readFileSync("resources/static" + url)),
        );

        expect((await preparePdf(invoice())).type).toBe("application/pdf");
    });
});
