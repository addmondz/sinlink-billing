import { jsPDF } from "jspdf";
import { amountWords } from "./money";
import { formatInvoiceNumber, type Invoice } from "./types";

export const referenceCompany = {
    company_name: "SINLINK AUTO ACCESSORIES",
    registration_number: "001025932-P",
    address: "NO: 36, JALAN USJ 8/2A UEP\nSUBANG JAYA 47610 SELANGOR",
    phone: "012-2533656",
    bank_details: "PBB BANK: 3223817120",
    footer_terms:
        "BEFORE ACCEPTANCE, PLEASE INSPECT THE GOODS AS WE WILL NOT BE RESPONSIBLE FOR ANY DEFECTS AFTER ACCEPTANCE.\nNO CLAIMS OR WHATSOEVER WILL BE ENTERTAINED UNLESS WITH OFFICIAL WRITTEN ADVICE TO US WITHIN 7 DAYS OF CHOP\nSIGN OF RECEIPT OF GOODS.",
};
export function documentModel(invoice: Invoice) {
    const company = { ...invoice.company_snapshot };
    if (/^sinlink auto accessories$/i.test(company.company_name.trim())) {
        company.registration_number ||= referenceCompany.registration_number;
        company.address ||= referenceCompany.address;
        company.phone ||= referenceCompany.phone;
        company.bank_details ||= referenceCompany.bank_details;
        company.footer_terms ||= referenceCompany.footer_terms;
    }
    return {
        invoice,
        company,
        customer: invoice.customer_snapshot,
        title: "CASH SALES",
        label:
            invoice.status === "draft"
                ? "DRAFT"
                : invoice.status === "cancelled"
                  ? "CANCELLED"
                  : "",
        number: formatInvoiceNumber(invoice.invoice_number) ?? "Unnumbered draft",
        words: amountWords(invoice.total_cents).replace(
            /^RINGGIT MALAYSIA /,
            "",
        ),
    };
}
export interface TextElement {
    kind: "text";
    text: string;
    x: number;
    y: number;
    size: number;
    bold: boolean;
    align: "left" | "center" | "right";
    color?: string;
}
export interface LineElement {
    kind: "line";
    x: number;
    y: number;
    end: number;
}
export type DocumentElement = TextElement | LineElement;
export const documentWidth = 595.2756;
export const documentHeight = 841.8898;
type Measure = (text: string, size: number, bold: boolean) => number;
export function invoiceLayout(
    invoice: Invoice,
    measure: Measure = (value, size) => value.length * size * 0.55,
): DocumentElement[][] {
    const m = documentModel(invoice),
        c = m.company;
    const pages: DocumentElement[][] = [];
    let elements: DocumentElement[],
        y = 241;
    const text = (
        value: string | undefined,
        x: number,
        baseline: number,
        size = 8,
        bold = false,
        align: TextElement["align"] = "left",
        color?: string,
    ) => {
        elements.push({
            kind: "text",
            text: value ?? "",
            x,
            y: baseline,
            size,
            bold,
            align,
            color,
        });
    };
    const line = (x: number, baseline: number, end: number) =>
        elements.push({ kind: "line", x, y: baseline, end });
    const wrap = (
        value: string,
        width: number,
        size = 8,
        bold = false,
    ): string[] => {
        const lines: string[] = [];
        for (const paragraph of value.split("\n")) {
            let current = "";
            for (const word of paragraph.split(/\s+/)) {
                const candidate = current ? current + " " + word : word;
                if (current && measure(candidate, size, bold) > width) {
                    lines.push(current);
                    current = "";
                }
                if (measure(word, size, bold) > width) {
                    for (const character of word) {
                        if (
                            current &&
                            measure(current + character, size, bold) > width
                        ) {
                            lines.push(current);
                            current = "";
                        }
                        current += character;
                    }
                } else current = current ? current + " " + word : word;
            }
            lines.push(current);
        }
        return lines;
    };
    const date = invoice.invoice_date
        .slice(0, 10)
        .split("-")
        .reverse()
        .join("/");
    const customerLines = wrap(
        [
            m.customer.name,
            m.customer.phone,
            m.customer.address,
            m.customer.email,
        ]
            .filter(Boolean)
            .join("\n"),
        315,
    );
    const terms = wrap(c.footer_terms, 545, 5.7);
    const newPage = () => {
        elements = [];
        pages.push(elements);
        text(
            c.company_name.toUpperCase(),
            documentWidth / 2,
            24,
            14,
            true,
            "center",
        );
        text(c.registration_number, documentWidth / 2, 34, 7, true, "center");
        const address = wrap(c.address, 400, 8, true);
        address
            .slice(0, 3)
            .forEach((value, index) =>
                text(
                    value,
                    documentWidth / 2,
                    47 + index * 12,
                    8,
                    true,
                    "center",
                ),
            );
        text(
            [c.phone ? "TEL: " + c.phone : "", c.bank_details]
                .filter(Boolean)
                .join("   "),
            documentWidth / 2,
            47 + Math.max(2, address.length) * 12,
            8,
            true,
            "center",
        );
        text(m.title, documentWidth / 2, 108, 14, true, "center");
        if (m.label) text(m.label, 577, 108, 10, true, "right", "#a22f2f");
        text("TO :", 65, 139, 8, true);
        customerLines
            .slice(0, 6)
            .forEach((value, index) => text(value, 95, 139 + index * 9, 8));
        for (const [label, value, baseline] of [
            ["NO.", m.number, 139],
            ["DATE", date, 166],
            ["PAGE", String(pages.length), 193],
        ] as const) {
            text(label, 430, baseline, 8, true);
            text(":", 480, baseline);
            text(
                value,
                490,
                baseline,
                Math.min(9, (86 / Math.max(1, measure(value, 9, false))) * 9),
            );
        }
        text("VEHICLE NO :", 28, 194, 7, true);
        text(invoice.vehicle_registration, 84, 194, 8);
        text("CAR MODEL :", 28, 207, 7, true);
        text(invoice.car_model, 84, 207, 8);
        line(18, 215, 577);
        text("NO.", 24, 225, 7, true);
        text("DESCRIPTION", 46, 225, 7, true);
        text("QUANTITY", 350, 225, 8, true, "center");
        text("U.PRICE", 451, 225, 8, true, "center");
        text("AMOUNT", 545, 225, 8, true, "center");
        line(18, 230, 577);
        y = 241;
    };
    newPage();
    invoice.items.forEach((item, index) => {
        const lines = wrap(item.description, 275);
        let first = true;
        for (const value of lines) {
            if (y > 557) newPage();
            if (first) {
                text(String(index + 1), 25, y, 8);
                text(
                    Number(item.quantity).toString() + "  " + item.unit,
                    350,
                    y,
                    9,
                    false,
                    "center",
                );
                text(
                    Number(item.unit_price).toFixed(2),
                    461,
                    y,
                    9,
                    false,
                    "right",
                );
                text(
                    (item.amount_cents / 100).toFixed(2),
                    565,
                    y,
                    9,
                    false,
                    "right",
                );
                first = false;
            }
            text(value, 46, y, 8);
            y += 11;
        }
        y += 3;
    });
    for (const paragraph of [
        invoice.notes ? "Remarks: " + invoice.notes : "",
        customerLines.length > 6
            ? "Customer details continued: " + customerLines.slice(6).join("\n")
            : "",
        terms.length > 5
            ? "Additional terms: " + terms.slice(5).join("\n")
            : "",
    ].filter(Boolean)) {
        y += 12;
        for (const value of wrap(paragraph, 530, 7)) {
            if (y > 557) newPage();
            text(value, 28, y, 7);
            y += 10;
        }
    }
    text("RINGGIT", 28, 592, 8);
    wrap(m.words, 350).forEach((value, index) =>
        text(value, 74, 592 + index * 10, 8),
    );
    line(437, 579, 577);
    text("SUBTOTAL :", 425, 592, 8, true);
    text(
        (invoice.subtotal_cents / 100).toFixed(2),
        566,
        592,
        9,
        false,
        "right",
    );
    line(22, 620, 577);
    text("TOTAL QUANTITY :", 183, 636, 8, true);
    text(Number(invoice.total_quantity).toString(), 303, 636, 9);
    text("TOTAL AMOUNT :", 412, 636, 8, true);
    text((invoice.total_cents / 100).toFixed(2), 566, 636, 10, true, "right");
    line(22, 641, 577);
    terms
        .slice(0, 5)
        .forEach((value, index) => text(value, 26, 651 + index * 8, 5.7));
    text(
        c.company_name.toUpperCase(),
        33,
        Math.max(692, 659 + Math.min(5, terms.length) * 8),
        8,
        true,
    );
    line(33, 745, 165);
    line(340, 745, 472);
    text(
        c.signature_left && c.signature_left !== "Authorized signature"
            ? c.signature_left
            : "ISSUED BY",
        99,
        758,
        9,
        false,
        "center",
    );
    text(
        c.signature_right && c.signature_right !== "Customer signature"
            ? c.signature_right
            : "RECEIVED BY",
        406,
        758,
        9,
        false,
        "center",
    );
    if (invoice.status === "cancelled")
        text(
            "CANCELLED · " +
                (invoice.cancellation_reason || "No reason supplied"),
            28,
            793,
            8,
            true,
            "left",
            "#a22f2f",
        );
    return pages;
}
let fontPromise: Promise<[string, string, string]> | undefined;
function fonts() {
    return (fontPromise ??= Promise.all(
        [
            "DejaVuSans-Regular.ttf",
            "DejaVuSans-Bold.ttf",
            "NotoSans-Regular.ttf",
        ].map(async (name) => {
            const response = await fetch("/fonts/" + name);
            if (!response.ok)
                throw new Error(
                    "Invoice fonts are not available. Connect once to finish setup.",
                );
            const bytes = new Uint8Array(await response.arrayBuffer());
            let value = "";
            for (let i = 0; i < bytes.length; i += 8192)
                value += String.fromCharCode(...bytes.subarray(i, i + 8192));
            return btoa(value);
        }),
    ) as Promise<[string, string, string]>);
}
export async function invoicePdf(invoice: Invoice): Promise<jsPDF> {
    const doc = new jsPDF({
        unit: "pt",
        format: invoice.company_snapshot.paper_size.toLowerCase(),
        orientation: "portrait",
    });
    const data = await fonts();
    for (const [index, name, family, style] of [
        [0, "DejaVuSans-Regular.ttf", "Invoice", "normal"],
        [1, "DejaVuSans-Bold.ttf", "Invoice", "bold"],
        [2, "NotoSans-Regular.ttf", "NotoSans", "normal"],
    ] as const) {
        doc.addFileToVFS(name, data[index]);
        doc.addFont(name, family, style);
    }
    const selectFont = (value: string, bold: boolean) =>
        doc.setFont(
            /[^\x20-\x7e]/.test(value) ? "NotoSans" : "Invoice",
            /[^\x20-\x7e]/.test(value) ? "normal" : bold ? "bold" : "normal",
        );
    const pages = invoiceLayout(invoice, (value, size, bold) => {
        selectFont(value, bold);
        doc.setFontSize(size);
        return doc.getTextWidth(value);
    });
    const scale = doc.internal.pageSize.getWidth() / documentWidth;
    pages.forEach((page, index) => {
        if (index) doc.addPage();
        for (const element of page) {
            if (element.kind === "line") {
                doc.setDrawColor(0);
                doc.setLineWidth(0.4 * scale);
                doc.line(
                    element.x * scale,
                    element.y * scale,
                    element.end * scale,
                    element.y * scale,
                );
            } else {
                selectFont(element.text, element.bold);
                doc.setFontSize(element.size * scale);
                doc.setTextColor(element.color ?? "#000000");
                doc.text(element.text, element.x * scale, element.y * scale, {
                    align: element.align,
                });
            }
        }
    });
    return doc;
}
export function invoiceFilename(invoice: Invoice): string {
    return (
        (formatInvoiceNumber(invoice.invoice_number) ?? "Sinlink-draft").replace(
            /[<>:"/\\|?*\x00-\x1f]/g,
            "_",
        ) + ".pdf"
    );
}
export async function downloadPdf(invoice: Invoice) {
    const doc = await invoicePdf(invoice);
    doc.save(invoiceFilename(invoice));
}
