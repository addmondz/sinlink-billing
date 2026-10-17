export interface User {
    id: number;
    name: string;
    email: string;
    role: "admin" | "staff";
    active: boolean;
    simple_mode?: boolean;
}
export interface Customer {
    id: string;
    name: string;
    phone: string;
    normalized_phone?: string;
    address?: string;
    email?: string;
    notes?: string;
    version: number;
    created_by: number;
    possible_duplicates?: { id: string; name: string; phone: string }[];
}
export interface Company {
    company_name: string;
    registration_number: string;
    address: string;
    phone: string;
    logo: string;
    bank_details?: string;
    paper_size: "A4" | "A5";
    margin_mm: number;
    footer_terms: string;
    signature_left: string;
    signature_right: string;
    version: number;
    business_id: string;
}
export interface Vehicle {
    id: string;
    registration: string;
    normalized_registration: string;
    car_model: string;
    notes?: string;
    customer_ids: string[];
    version: number;
    created_by: number;
}
export const normalizeRegistration = (registration: string) =>
    registration.toUpperCase().replace(/[^A-Z0-9]/g, "");
export interface Item {
    id: string;
    description: string;
    quantity: string;
    unit: string;
    unit_price: string;
    amount_cents: number;
}
export interface Invoice {
    id: string;
    invoice_number: string | null;
    number_value?: number;
    allocation_id?: string;
    status: "draft" | "issued" | "cancelled";
    invoice_date: string;
    customer_id: string;
    customer_snapshot: Partial<Customer>;
    company_snapshot: Company;
    vehicle_registration: string;
    car_model: string;
    notes: string;
    items: Item[];
    total_cents: number;
    subtotal_cents: number;
    total_quantity: string;
    version: number;
    created_by: number;
    creator?: { id: number; name: string };
    device_id: string;
    created_at: string;
    issued_at?: string;
    cancelled_at?: string;
    cancellation_reason?: string;
    cancelled_by?: number;
    replacement_for?: string;
    replacements?: { id: string; invoice_number: string | null; status: string }[];
    events?: {
        id?: number;
        type: string;
        actor?: { name: string };
        reason?: string;
        created_at: string;
        device_action_at?: string;
    }[];
    local_dirty?: boolean;
    local_only?: boolean;
    sync_state?: string;
    local_revision?: string;
    saved_at?: string;
}
export function formatInvoiceNumber(
    value: string | number | null | undefined,
): string | null {
    if (value == null) return null;
    const original = String(value);
    const digits = original.replace(/^SL-/, "");
    return /^\d+$/.test(digits)
        ? digits.replace(/^0+(?=\d)/, "").padStart(5, "0")
        : original;
}
export interface Operation {
    id: string;
    device_id: string;
    actor_id: number;
    entity_id: string;
    type:
        | "customer.save"
        | "vehicle.save"
        | "invoice.save"
        | "invoice.issue"
        | "invoice.cancel";
    payload: Record<string, any>;
    expected_version: number;
    action_at: string;
    state: "pending" | "failed" | "conflict" | "archived";
    attempts: number;
    next_retry: number;
    error?: string;
    server_status?: number;
    created_order: number;
}
export interface Allocation {
    id: string;
    device_id: string;
    start: number;
    end: number;
    next: number;
}
export const uuid = () => crypto.randomUUID();
export const todayKL = () =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
export const normalizePhone = (phone: string) => {
    let n = phone.replace(/\D/g, "");
    if (!phone.trim().startsWith("+")) {
        if (n.startsWith("00")) n = n.slice(2);
        else if (n.startsWith("0")) n = "60" + n.slice(1);
        else if (
            !n.startsWith("60") &&
            /^(?:1[0-9]{8,9}|3[0-9]{8}|[4-9][0-9]{7})$/.test(n)
        )
            n = "60" + n;
    }
    if (n.startsWith("600")) n = "60" + n.slice(3);
    return n;
};
export const formatPhone = (phone: string): string | null => {
    const compact = phone.trim().replace(/[\s().-]/g, "");
    if (phone.length > 80 || !/^\+?[0-9]+$/.test(compact)) return null;
    const number = normalizePhone(compact);
    if (
        !number.startsWith("60") &&
        !compact.startsWith("+") &&
        !compact.startsWith("00") &&
        number.length < 10
    )
        return null;
    const pattern = number.startsWith("60")
        ? /^60(?:1[0-9]{8,9}|3[0-9]{8}|[4-9][0-9]{7})$/
        : /^[1-9][0-9]{6,14}$/;
    return pattern.test(number) ? "+" + number : null;
};
