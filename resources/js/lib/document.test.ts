import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
    documentModel,
    invoiceFilename,
    invoiceLayout,
    invoicePdf,
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
});
