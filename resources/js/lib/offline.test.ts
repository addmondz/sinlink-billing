import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
    createVault,
    unlockVault,
    recoverVault,
    directory,
    VaultPasswordError,
    type Vault,
} from "./vault";
import { useApp } from "../store";
import { calculate, amountWords } from "./money";
import { uuid, type Company, type Invoice, type User } from "./types";
import { ApiError, send } from "./api";
vi.mock("./api", async () => {
    const actual = await vi.importActual<any>("./api");
    return {
        ...actual,
        api: vi.fn().mockRejectedValue(new TypeError("Offline")),
        send: vi.fn().mockRejectedValue(new TypeError("Offline")),
    };
});
const user: User = {
    id: 42,
    name: "Offline cashier",
    email: "offline@example.test",
    role: "staff",
    active: true,
};
const company = (): Company => ({
    business_id: uuid(),
    version: 1,
    company_name: "Sinlink Auto Accessories",
    registration_number: "",
    address: "",
    phone: "",
    logo: "",
    paper_size: "A4",
    margin_mm: 12,
    footer_terms: "",
    signature_left: "Authorized signature",
    signature_right: "Customer signature",
});
let vault: Vault, settings: Company;
beforeEach(async () => {
    settings = company();
    vault = await createVault(user, settings, "strong offline phrase");
    setActivePinia(createPinia());
});
afterEach(async () => {
    await vault.db.delete();
    await directory.profiles.clear();
});
function draft(): Invoice {
    return {
        id: uuid(),
        status: "draft",
        invoice_number: null,
        invoice_date: "2026-10-17",
        customer_id: uuid(),
        customer_snapshot: { name: "Customer", phone: "0123456" },
        company_snapshot: settings,
        vehicle_registration: "",
        car_model: "",
        notes: "",
        items: [
            {
                id: uuid(),
                description: "Installation",
                quantity: "1.005",
                unit: "PCS",
                unit_price: "1.00",
                amount_cents: 101,
            },
        ],
        total_cents: 101,
        subtotal_cents: 101,
        total_quantity: "1.005",
        version: 0,
        created_by: user.id,
        device_id: vault.profile.device_id,
        created_at: new Date().toISOString(),
    };
}
function store(v: Vault) {
    const app = useApp(createPinia());
    app.vault = v;
    app.user = user;
    app.company = settings;
    return app;
}
describe("financial and offline guarantees", () => {
    it("shows cars entered on saved invoices offline and merges the synchronized car by registration", async () => {
        const app = store(vault);
        const first = await app.saveCustomer({
            name: "First driver",
            phone: "0162726866",
        });
        const second = await app.saveCustomer({
            name: "Second driver",
            phone: "0123456789",
        });
        for (const [customer, registration] of [
            [first, "vdr 4118"],
            [second, "VDR-4118"],
        ] as const) {
            await app.persistDraft({
                ...draft(),
                customer_id: customer.id,
                vehicle_registration: registration,
                car_model: "MYVI",
            });
        }

        expect(app.vehicles).toHaveLength(1);
        expect(app.vehicles[0]?.normalized_registration).toBe("VDR4118");
        expect(app.vehicles[0]?.customer_ids.sort()).toEqual(
            [first.id, second.id].sort(),
        );
        const canonicalId = uuid();
        await vault.put("vehicle", canonicalId, {
            ...app.vehicles[0],
            id: canonicalId,
            version: 1,
        });
        await app.refresh();

        expect(app.vehicles).toHaveLength(1);
        expect(app.vehicles[0]?.id).toBe(canonicalId);
        expect(app.vehicles[0]?.customer_ids).toHaveLength(2);
    });
    it("links invoice cars to additional customers locally without changing existing car details", async () => {
        const app = store(vault);
        const first = await app.saveCustomer({
            name: "First driver",
            phone: "0162726866",
        });
        const second = await app.saveCustomer({
            name: "Second driver",
            phone: "0123456789",
        });
        const vehicle = await app.saveVehicle({
            registration: "VDR 4118",
            car_model: "MYVI",
            customer_ids: [first.id],
        });

        await app.persistDraft(
            {
                ...draft(),
                customer_id: second.id,
                vehicle_registration: "VDR-4118",
                car_model: "Invoice snapshot",
            },
            true,
        );

        expect(app.vehicles).toHaveLength(1);
        expect(app.vehicles[0]?.id).toBe(vehicle.id);
        expect(app.vehicles[0]?.car_model).toBe("MYVI");
        expect(app.vehicles[0]?.customer_ids).toEqual([first.id, second.id]);
    });
    it("shows a registration without a model and skips incomplete invoices without customers or registrations", async () => {
        const app = store(vault);
        const customer = await app.saveCustomer({
            name: "Driver",
            phone: "0162726866",
        });
        await app.persistDraft({
            ...draft(),
            customer_id: "",
            vehicle_registration: "ABC 1234",
        });
        await app.persistDraft({
            ...draft(),
            customer_id: customer.id,
            vehicle_registration: "",
        });
        expect(app.vehicles).toHaveLength(0);

        await app.persistDraft({
            ...draft(),
            customer_id: customer.id,
            vehicle_registration: "ABC 1234",
        });

        expect(app.vehicles[0]?.car_model).toBe("Unspecified");
        expect(app.vehicles[0]?.customer_ids).toEqual([customer.id]);
    });
    it("keeps one shared car, its customer links and queued operation through backup restore", async () => {
        const app = store(vault);
        const first = await app.saveCustomer({
            name: "First driver",
            phone: "0162726866",
        });
        const second = await app.saveCustomer({
            name: "Second driver",
            phone: "0123456789",
        });
        const vehicle = await app.saveVehicle({
            registration: "vdr 4118",
            car_model: "MYVI",
            customer_ids: [first.id, second.id],
        });
        const backup = await vault.export();

        await vault.remove("vehicle", vehicle.id);
        await vault.import(backup);
        await app.refresh();

        expect(app.vehicles).toHaveLength(1);
        expect(app.vehicles[0]?.customer_ids).toEqual([first.id, second.id]);
        expect(app.vehicles[0]?.registration).toBe("VDR 4118");
        expect(
            (await vault.all("outbox"))
                .map((operation) => operation.type)
                .sort(),
        ).toEqual(["customer.save", "customer.save", "vehicle.save"]);
        await expect(
            app.saveVehicle({
                registration: "VDR-4118",
                car_model: "Other",
                customer_ids: [first.id],
            }),
        ).rejects.toThrow("already exists");
        await app.lock(false);
        expect(app.vehicles).toHaveLength(0);
    });
    it("rejects cars without linked customers before creating local work", async () => {
        const app = store(vault);

        await expect(
            app.saveVehicle({
                registration: "VDR 4118",
                car_model: "MYVI",
                customer_ids: [],
            }),
        ).rejects.toThrow("Select at least one customer");

        expect(await vault.all("vehicle")).toHaveLength(0);
        expect(await vault.all("outbox")).toHaveLength(0);
    });
    it("remembers Simple mode for this account offline and queues the latest preference", async () => {
        const app = store(vault);

        await app.setSimpleMode(true);

        expect(app.user?.simple_mode).toBe(true);
        expect((await vault.get("meta", "access")).user.simple_mode).toBe(true);
        expect(await vault.get("meta", "preferences")).toEqual({
            simple_mode: true,
        });
        await app.setSimpleMode(false);
        const unlocked = await unlockVault(
            vault.profile,
            "strong offline phrase",
        );
        expect(unlocked.access.user.simple_mode).toBe(false);
        expect(await vault.get("meta", "preferences")).toEqual({
            simple_mode: false,
        });
        unlocked.vault.close();
        expect(user.simple_mode).toBeUndefined();
    });
    it.each(["162726866", "60162726866", "0162726866"])(
        "stores and queues %s as an international customer phone number offline",
        async (phone) => {
            const app = store(vault);

            const customer = await app.saveCustomer({
                name: "Local customer",
                phone,
            });

            expect(customer.phone).toBe("+60162726866");
            expect(customer.normalized_phone).toBe("60162726866");
            expect(await vault.get("customer", customer.id)).toMatchObject({
                phone: "+60162726866",
            });
            expect(await vault.all("outbox")).toMatchObject([
                {
                    type: "customer.save",
                    payload: {
                        phone: "+60162726866",
                        normalized_phone: "60162726866",
                    },
                },
            ]);
        },
    );
    it("rejects invalid customer phones before saving or queueing offline", async () => {
        const app = store(vault);

        await expect(
            app.saveCustomer({ name: "Invalid phone", phone: "0123" }),
        ).rejects.toThrow(
            "Enter a valid phone number, for example 0162726866 or +60162726866.",
        );

        expect(await vault.all("customer")).toHaveLength(0);
        expect(await vault.all("outbox")).toHaveLength(0);
    });
    it("creates local storage during sign-in using the account password", async () => {
        await vault.db.delete();
        await directory.profiles.delete(vault.profile.id);
        vi.mocked(send).mockResolvedValueOnce({ user, company: settings });
        const app = useApp();

        await app.login(user.email, "Account password 2026!");

        vault = app.vault!;
        expect(app.user?.id).toBe(user.id);
        expect(vault.profile.credential).toBe("password");
        const reopened = await unlockVault(
            vault.profile,
            "Account password 2026!",
        );
        expect(reopened.access.user.id).toBe(user.id);
        expect(JSON.stringify(await vault.export())).not.toContain(
            "Account password 2026!",
        );
        reopened.vault.close();
    });
    it("opens existing local work immediately after account sign-in", async () => {
        await vault.put("customer", "saved", { name: "Saved customer" });
        vi.mocked(send).mockResolvedValueOnce({ user, company: settings });
        const app = useApp();

        await app.login(user.email, "strong offline phrase");

        vault.close();
        vault = app.vault!;
        expect(app.customers).toEqual([{ name: "Saved customer" }]);
    });
    it("opens saved work through account sign-in when the network is unavailable", async () => {
        await vault.put("customer", "saved", { name: "Saved customer" });
        vi.mocked(send).mockRejectedValueOnce(new TypeError("Offline"));
        const app = useApp();

        await app.login("  OFFLINE@example.test  ", "strong offline phrase");

        vault.close();
        vault = app.vault!;
        expect(app.customers).toEqual([{ name: "Saved customer" }]);
        expect(app.user?.id).toBe(user.id);
        expect(app.online).toBe(false);
        expect(app.needsAuth).toBe(true);
        expect(app.verified).toBeUndefined();
    });
    it("keeps saved work locked when offline sign-in uses an incorrect password", async () => {
        vi.mocked(send).mockRejectedValueOnce(new TypeError("Offline"));
        const app = useApp();

        await expect(
            app.login(user.email, "incorrect password"),
        ).rejects.toBeInstanceOf(VaultPasswordError);

        expect(app.vault).toBeUndefined();
        expect(app.user).toBeUndefined();
    });
    it("requires an internet connection for accounts that are not saved on the device", async () => {
        vi.mocked(send).mockRejectedValueOnce(new TypeError("Offline"));
        const app = useApp();

        await expect(
            app.login("another@example.test", "strong offline phrase"),
        ).rejects.toThrow(
            "Connect to the internet to sign in to this account.",
        );

        expect(app.vault).toBeUndefined();
        expect(app.user).toBeUndefined();
    });
    it("keeps expired offline access locked through account sign-in", async () => {
        const access = await vault.get("meta", "access");
        await vault.put("meta", "access", {
            ...access,
            grant_until: Date.now() - 1,
        });
        vi.mocked(send).mockRejectedValueOnce(new TypeError("Offline"));
        const app = useApp();

        await expect(
            app.login(user.email, "strong offline phrase"),
        ).rejects.toThrow("Offline access expired.");

        expect(app.vault).toBeUndefined();
        expect(app.user).toBeUndefined();
    });
    it("keeps local work locked when the server rejects the account password", async () => {
        vi.mocked(send).mockRejectedValueOnce(
            new ApiError(422, "Invalid login"),
        );
        const app = useApp();
        app.verified = { user, company: settings };

        await expect(
            app.login(user.email, "incorrect password"),
        ).rejects.toThrow("Invalid login");

        expect(app.vault).toBeUndefined();
        expect(app.user).toBeUndefined();
        expect(app.verified).toBeUndefined();
    });
    it("migrates an old device passphrase without changing saved work or device identity", async () => {
        delete vault.profile.credential;
        await directory.profiles.put(vault.profile);
        const app = store(vault);
        const issued = await app.persistDraft(draft());
        await app.saveCustomer({
            name: "Unsynced customer",
            phone: "0123456789",
        });
        const operations = await vault.all("outbox");
        const device = vault.profile.device_id;
        await vault.put("allocation", "reserved", {
            start: 10,
            end: 109,
            next: 15,
        });
        vi.mocked(send).mockResolvedValueOnce({ user, company: settings });

        await expect(
            app.login(user.email, "Account password 2026!"),
        ).rejects.toBeInstanceOf(VaultPasswordError);
        expect(app.vault).toBeUndefined();
        expect(app.user).toBeUndefined();
        await app.open(
            vault.profile,
            "strong offline phrase",
            undefined,
            "Account password 2026!",
        );

        vault = app.vault!;
        expect(vault.profile.device_id).toBe(device);
        expect(vault.profile.credential).toBe("password");
        expect(await vault.get("invoice", issued.id)).toEqual(issued);
        expect(await vault.all("outbox")).toEqual(operations);
        expect((await vault.get("allocation", "reserved")).next).toBe(15);
        const reopened = await unlockVault(
            vault.profile,
            "Account password 2026!",
        );
        expect(await reopened.vault.all("outbox")).toEqual(operations);
        reopened.vault.close();
        await expect(
            unlockVault(vault.profile, "strong offline phrase"),
        ).rejects.toBeInstanceOf(VaultPasswordError);
    });
    it("preserves the old encryption when password migration cannot decrypt a record", async () => {
        await vault.put("customer", "saved", { name: "Retained customer" });
        const damaged = await vault.db.records.get("customer:saved");
        damaged!.cipher = new Uint8Array([0]).buffer;
        await vault.db.records.put(damaged!);

        await expect(
            vault.useAccountPassword("Account password 2026!"),
        ).rejects.toThrow();

        const reopened = await unlockVault(
            vault.profile,
            "strong offline phrase",
        );
        expect(reopened.access.user.id).toBe(user.id);
        reopened.vault.close();
        await expect(
            unlockVault(vault.profile, "Account password 2026!"),
        ).rejects.toBeInstanceOf(VaultPasswordError);
    });
    it("imports an older backup after switching to the account password", async () => {
        await vault.put("customer", "saved", {
            name: "Customer from old backup",
        });
        const backup = await vault.export();
        await vault.useAccountPassword("Account password 2026!");
        await vault.remove("customer", "saved");

        await expect(
            vault.import(backup, "incorrect password"),
        ).rejects.toThrow();
        expect(await vault.get("customer", "saved")).toBeUndefined();
        await vault.import(backup, "strong offline phrase");

        expect(await vault.get("customer", "saved")).toEqual({
            name: "Customer from old backup",
        });
    });
    it("recovers an older backup and opens it with the current account password", async () => {
        await vault.put("customer", "saved", { name: "Recovered customer" });
        const backup = await vault.export();
        await vault.db.delete();
        await directory.profiles.delete(vault.profile.id);
        const app = useApp();
        vi.mocked(send).mockResolvedValueOnce({ user, company: settings });

        await expect(
            app.login(user.email, "Account password 2026!", backup),
        ).rejects.toBeInstanceOf(VaultPasswordError);
        expect(app.user).toBeUndefined();
        await app.open(
            undefined,
            "strong offline phrase",
            backup,
            "Account password 2026!",
        );

        vault = app.vault!;
        const reopened = await unlockVault(
            vault.profile,
            "Account password 2026!",
        );
        expect(await reopened.vault.get("customer", "saved")).toEqual({
            name: "Recovered customer",
        });
        reopened.vault.close();
    });
    it("rounds each decimal line half up and sums sen without floating point drift", () => {
        const d = draft(),
            items = [
                { ...d.items[0]!, quantity: "0.1", unit_price: "0.05" },
                {
                    ...d.items[0]!,
                    id: uuid(),
                    quantity: "0.1",
                    unit_price: "0.05",
                },
            ];
        expect(calculate(items).total_cents).toBe(2);
        expect(calculate(d.items).total_cents).toBe(101);
        expect(amountWords(101)).toBe("RINGGIT MALAYSIA ONE AND ONE SEN ONLY");
    });
    it("encrypts records, rejects wrong unlock, and enforces offline expiry", async () => {
        await vault.put("customer", "c", {
            name: "Sensitive customer",
            phone: "123",
        });
        const raw = JSON.stringify(await vault.export());
        expect(raw).not.toContain("Sensitive customer");
        await expect(
            unlockVault(vault.profile, "wrong passphrase"),
        ).rejects.toThrow("incorrect");
        await vault.put("meta", "access", {
            user,
            company: settings,
            grant_until: Date.now() - 1,
        });
        await expect(
            unlockVault(vault.profile, "strong offline phrase"),
        ).rejects.toThrow("expired");
        const unlocked = await unlockVault(
            vault.profile,
            "strong offline phrase",
            true,
        );
        unlocked.vault.close();
    });
    it("restores a locally autosaved draft after closing and reopening the database", async () => {
        const app = store(vault);
        const saved = await app.persistDraft(draft());
        vault.close();
        const reopened = await unlockVault(
            vault.profile,
            "strong offline phrase",
        );
        vault = reopened.vault;
        expect(
            (await vault.get<Invoice>("invoice", saved.id))!.items[0]!
                .description,
        ).toBe("Installation");
        expect((await vault.all("outbox")).length).toBe(0);
    });
    it("serializes concurrent issuance across two connections, never reusing numbers", async () => {
        const block = {
            id: uuid(),
            device_id: vault.profile.device_id,
            start: 10,
            end: 11,
            next: 10,
        };
        await vault.put("allocation", block.id, block);
        const other = (
            await unlockVault(vault.profile, "strong offline phrase")
        ).vault;
        const a = store(vault),
            b = store(other);
        const [one, two] = await Promise.all([
            a.issue(draft()),
            b.issue(draft()),
        ]);
        expect([one.number_value, two.number_value].sort()).toEqual([10, 11]);
        expect([one.invoice_number, two.invoice_number].sort()).toEqual([
            "00010",
            "00011",
        ]);
        expect(await vault.all("outbox")).toHaveLength(2);
        await expect(a.issue(draft())).rejects.toThrow("No offline numbers");
        const saved = await a.persistDraft(draft());
        expect(saved.status).toBe("draft");
        other.close();
    });
    it("continues offline running numbers beyond five digits without truncating them", async () => {
        const app = store(vault);
        const block = {
            id: uuid(),
            device_id: vault.profile.device_id,
            start: 99999,
            end: 100000,
            next: 99999,
        };
        await vault.put("allocation", block.id, block);

        const first = await app.issue(draft());
        const second = await app.issue(draft());

        expect(first.invoice_number).toBe("99999");
        expect(second.invoice_number).toBe("100000");
        expect(
            (await vault.all("outbox")).map((op) => op.payload.invoice_number),
        ).toEqual(expect.arrayContaining(["99999", "100000"]));
    });
    it("shows saved legacy numbers with five digits without rewriting queued offline operations", async () => {
        const app = store(vault);
        const invoice = {
            ...draft(),
            status: "issued" as const,
            invoice_number: "SL-00000001",
            number_value: 1,
            replacements: [
                { id: uuid(), invoice_number: "SL-00001234", status: "issued" },
            ],
        };
        const operation = {
            id: uuid(),
            device_id: vault.profile.device_id,
            actor_id: user.id,
            entity_id: invoice.id,
            type: "invoice.issue",
            payload: invoice,
            expected_version: 0,
            state: "pending",
            created_order: 1,
        };
        await vault.put("invoice", invoice.id, invoice);
        await vault.put("outbox", operation.id, operation);

        await app.refresh();

        expect(app.invoices[0]!.invoice_number).toBe("00001");
        expect(app.invoices[0]!.replacements![0]!.invoice_number).toBe("01234");
        expect(
            (await vault.get<Invoice>("invoice", invoice.id))!.invoice_number,
        ).toBe("SL-00000001");
        expect(await vault.get("outbox", operation.id)).toEqual(operation);
    });
    it("repeated taps on the same draft produce one issued document and one operation", async () => {
        const app = store(vault),
            block = {
                id: uuid(),
                device_id: vault.profile.device_id,
                start: 1,
                end: 5,
                next: 1,
            };
        await vault.put("allocation", block.id, block);
        const d = draft();
        const [a, b] = await Promise.all([app.issue(d), app.issue(d)]);
        expect(a.invoice_number).toBe(b.invoice_number);
        expect(a.invoice_number).toBe("00001");
        expect(await vault.all("outbox")).toHaveLength(1);
        expect((await vault.get("allocation", block.id)).next).toBe(2);
    });
    it("keeps offline cancellations terminal and preserves immutable invoice content", async () => {
        const app = store(vault),
            d = draft();
        d.status = "issued";
        d.invoice_number = "SL-00000001";
        await vault.put("invoice", d.id, d);
        await app.cancel(d.id, "");
        const row = await vault.get<Invoice>("invoice", d.id);
        expect(row?.status).toBe("cancelled");
        expect(row?.items).toEqual(d.items);
        await expect(
            app.persistDraft({ ...d, status: "draft" }),
        ).rejects.toThrow("issued or cancelled");
        await app.cancel(d.id, "again");
        expect(await vault.all("outbox")).toHaveLength(1);
    });
    it("imports backup missing work without changing operation identities or rewinding ranges", async () => {
        const app = store(vault),
            c = await app.saveCustomer({
                name: "Backup customer",
                phone: "0123456789",
            });
        const block = {
            id: uuid(),
            device_id: vault.profile.device_id,
            start: 1,
            end: 100,
            next: 5,
        };
        await vault.put("allocation", block.id, block);
        const backup = await vault.export(),
            ops = await vault.all("outbox");
        await vault.remove("customer", c.id);
        await vault.put("allocation", block.id, { ...block, next: 30 });
        await vault.import(backup);
        expect((await vault.get("customer", c.id)).name).toBe(
            "Backup customer",
        );
        expect(await vault.all("outbox")).toEqual(ops);
        expect((await vault.get("allocation", block.id)).next).toBe(30);
    });
    it("fresh-device recovery keeps issued numbers and operation identities while discarding old ranges", async () => {
        const app = store(vault),
            device = vault.profile.device_id,
            block = {
                id: uuid(),
                device_id: device,
                start: 80,
                end: 179,
                next: 80,
            };
        await vault.put("allocation", block.id, block);
        const issued = await app.issue(draft()),
            backup = await vault.export(),
            operations = await vault.all("outbox");
        await vault.db.delete();
        await directory.profiles.delete(vault.profile.id);
        vault = await recoverVault(
            backup,
            "strong offline phrase",
            user,
            settings,
        );
        expect(vault.profile.device_id).not.toBe(device);
        expect(await vault.all("allocation")).toHaveLength(0);
        expect(
            (await vault.get<Invoice>("invoice", issued.id))!.invoice_number,
        ).toBe("00080");
        expect(await vault.all("outbox")).toEqual(operations);
    });
    it("rejects a stale tab draft write without replacing the newer saved proposal", async () => {
        const app = store(vault),
            first = await app.persistDraft(draft()),
            newer = await app.persistDraft({ ...first, notes: "New content" });
        await expect(
            app.persistDraft({ ...first, notes: "Stale content" }),
        ).rejects.toThrow("another tab");
        expect((await vault.get<Invoice>("invoice", first.id))!.notes).toBe(
            newer.notes,
        );
    });
});
