import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import { api, send, ApiError, clearCsrf } from "./lib/api";
import {
    Vault,
    directory,
    createVault,
    unlockVault,
    recoverVault,
    restoreVaultSession,
    clearVaultSession,
    type Profile,
    type VaultAccess,
} from "./lib/vault";
import {
    uuid,
    normalizePhone,
    formatPhone,
    normalizeRegistration,
    formatInvoiceNumber,
    type Vehicle,
    type User,
    type Company,
    type Customer,
    type Invoice,
    type Operation,
    type Allocation,
} from "./lib/types";
import { calculate } from "./lib/money";
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let channel: BroadcastChannel | undefined;
export const useApp = defineStore("app", () => {
    const vault = shallowRef<Vault>(),
        user = ref<User>(),
        company = ref<Company>(),
        profiles = ref<Profile[]>([]);
    const invoices = ref<Invoice[]>([]),
        customers = ref<Customer[]>([]),
        vehicles = ref<Vehicle[]>([]),
        operations = ref<Operation[]>([]);
    const online = ref(false),
        needsAuth = ref(false),
        syncing = ref(false),
        lastSync = ref<string>(),
        syncMessage = ref(""),
        remaining = ref(0),
        notice = ref("");
    const verified = ref<{ user: User; company: Company }>(),
        booting = ref(true);
    let draftFlusher: (() => Promise<void>) | undefined;
    const setDraftFlusher = (fn?: () => Promise<void>) => {
        draftFlusher = fn;
    };
    const flushDraft = async () => {
        await draftFlusher?.();
    };
    const v = () => {
        if (!vault.value) throw new Error("Unlock the device first.");
        return vault.value;
    };
    async function init() {
        profiles.value = await directory.profiles.toArray();
        let canRestore = false;
        try {
            verified.value = await api("/me");
            online.value = true;
            canRestore = true;
        } catch (e) {
            if (e instanceof ApiError && [401, 419, 403].includes(e.status)) {
                needsAuth.value = true;
                await clearVaultSession();
            } else if (
                e instanceof TypeError ||
                (e instanceof DOMException && e.name === "TimeoutError")
            ) {
                canRestore = true;
            }
        }
        window.addEventListener("online", () => {
            void sync();
        });
        window.addEventListener("offline", () => {
            online.value = false;
        });
        channel = new BroadcastChannel("sinlink-events");
        channel.onmessage = (e) => {
            if (e.data === "locked") {
                void lock(false);
                return;
            }
            if (vault.value) void refresh();
        };
        try {
            if (canRestore) {
                const saved = await restoreVaultSession(verified.value);
                if (saved) await activateVault(saved.vault, saved.access);
            }
        } finally {
            booting.value = false;
        }
    }
    async function login(email: string, password: string, recovery?: any) {
        // Do not send credentials while another account's data remains in memory.
        if (vault.value) await lock(false);
        else await clearVaultSession();
        verified.value = undefined;
        clearCsrf();
        try {
            verified.value = await send("/login", { email, password });
        } catch (error) {
            if (
                !(error instanceof TypeError) &&
                !(
                    error instanceof DOMException &&
                    error.name === "TimeoutError"
                )
            ) {
                throw error;
            }
            online.value = false;
            profiles.value = await directory.profiles.toArray();
            const matchingProfiles = profiles.value.filter(
                (profile) =>
                    profile.user.email.toLowerCase() ===
                    email.trim().toLowerCase(),
            );
            if (matchingProfiles.length !== 1) {
                throw new Error(
                    "Connect to the internet to sign in to this account.",
                );
            }
            await open(matchingProfiles[0], password);
            return;
        }
        clearCsrf();
        online.value = true;
        needsAuth.value = false;
        profiles.value = await directory.profiles.toArray();
        const profile = profiles.value.find(
            (p) =>
                p.user.id === verified.value!.user.id &&
                p.business_id === verified.value!.company.business_id,
        );
        await open(profile, password, recovery, password);
    }
    async function open(
        profile: Profile | undefined,
        password: string,
        recovery?: any,
        accountPassword?: string,
    ) {
        let access: any;
        let opened: Vault;
        if (recovery) {
            if (!verified.value)
                throw new Error("Sign in online before recovery.");
            opened = await recoverVault(
                recovery,
                password,
                verified.value.user,
                verified.value.company,
            );
            access = await opened.get("meta", "access");
        } else if (!profile) {
            if (!verified.value)
                throw new Error("First device setup requires online login.");
            opened = await createVault(
                verified.value.user,
                verified.value.company,
                password,
            );
            access = await opened.get("meta", "access");
        } else {
            const result = await unlockVault(
                profile,
                password,
                verified.value?.user.id === profile.user.id &&
                    verified.value?.company.business_id === profile.business_id,
            );
            opened = result.vault;
            access = result.access;
        }
        if (
            accountPassword &&
            (opened.profile.credential !== "password" ||
                password !== accountPassword)
        ) {
            channel?.postMessage("locked");
            try {
                await opened.useAccountPassword(accountPassword);
            } catch (e) {
                opened.close();
                throw e;
            }
        }
        await opened.rememberSession(accountPassword ?? password);
        await activateVault(opened, access);
    }
    async function activateVault(opened: Vault, access: VaultAccess) {
        vault.value = opened;
        profiles.value = await directory.profiles.toArray();
        if (vault.value !== opened) return;
        user.value = access.user;
        company.value = access.company;
        if (
            verified.value?.user.id === user.value?.id &&
            verified.value?.company.business_id === company.value?.business_id
        ) {
            user.value = verified.value!.user;
            company.value = verified.value!.company;
            await opened.put("meta", "access", {
                user: plain(user.value),
                company: plain(company.value),
                verified_at: Date.now(),
                grant_until: Date.now() + 7 * 86400000,
            });
            needsAuth.value = false;
        } else needsAuth.value = true;
        if (vault.value !== opened) return;
        await refresh();
        void navigator.storage?.persist?.();
        void sync();
    }
    async function refresh() {
        if (!vault.value) return;
        const db = v();
        const [ins, cus, cars, ops, allocs, meta] = await Promise.all([
            db.all<Invoice>("invoice"),
            db.all<Customer>("customer"),
            db.all<Vehicle>("vehicle"),
            db.all<Operation>("outbox"),
            db.all<Allocation>("allocation"),
            db.get("meta", "sync"),
        ]);
        if (vault.value !== db) return;
        invoices.value = ins.map((invoice) => ({
            ...invoice,
            invoice_number: formatInvoiceNumber(invoice.invoice_number),
            replacements: invoice.replacements?.map((replacement) => ({
                ...replacement,
                invoice_number: formatInvoiceNumber(replacement.invoice_number),
            })),
        }));
        customers.value = cus;
        vehicles.value = cars;
        operations.value = ops.sort(
            (a, b) => a.created_order - b.created_order,
        );
        remaining.value = allocs.reduce(
            (sum, a) => sum + Math.max(0, a.end - a.next + 1),
            0,
        );
        lastSync.value = meta?.last_sync;
    }
    function broadcast() {
        channel?.postMessage("changed");
    }
    async function saveCustomer(input: Partial<Customer>) {
        const db = v(),
            actor = user.value!;
        const phone = formatPhone(input.phone ?? "");
        if (!phone)
            throw new Error(
                "Enter a valid phone number, for example 0162726866 or +60162726866.",
            );
        const id = input.id ?? uuid();
        await db.transaction(async () => {
            const old = await db.get<Customer>("customer", id);
            if (old && input.version !== old.version)
                throw new Error(
                    "This customer changed in another tab. Reload before editing.",
                );
            const row = {
                ...plain(input),
                phone,
                id,
                version: (old?.version ?? 0) + 1,
                created_by: old?.created_by ?? actor.id,
                normalized_phone: normalizePhone(phone),
            } as Customer;
            await db.put("customer", id, row);
            await enqueue("customer.save", id, row, old?.version ?? 0);
        });
        await refresh();
        broadcast();
        void sync();
        return customers.value.find((c) => c.id === id)!;
    }
    async function setSimpleMode(enabled: boolean) {
        const db = v();
        user.value = { ...user.value!, simple_mode: enabled };
        await db.put("meta", "preferences", { simple_mode: enabled });
        const access = await db.get("meta", "access");
        if (access)
            await db.put("meta", "access", {
                ...access,
                user: plain(user.value),
            });
        broadcast();
        void sync();
    }
    async function saveVehicle(input: Partial<Vehicle>) {
        const db = v(),
            id = input.id ?? uuid();
        const registration = (input.registration ?? "").trim().toUpperCase();
        if (
            !/^[A-Z0-9][A-Z0-9 -]{0,39}$/.test(registration) ||
            !input.car_model?.trim()
        )
            throw new Error("Enter a registration number and car model.");
        if (
            !input.customer_ids?.length ||
            input.customer_ids.some(
                (customerId) =>
                    !customers.value.some(
                        (customer) => customer.id === customerId,
                    ),
            )
        )
            throw new Error("Select at least one customer linked to this car.");
        const normalized = normalizeRegistration(registration);
        await db.transaction(async () => {
            const old = await db.get<Vehicle>("vehicle", id);
            if (old && input.version !== old.version)
                throw new Error(
                    "This car changed in another tab. Reload before editing.",
                );
            if (
                (await db.all<Vehicle>("vehicle")).some(
                    (car) =>
                        car.id !== id &&
                        normalizeRegistration(car.registration) === normalized,
                )
            )
                throw new Error(
                    "This registration already exists. Edit that car to link additional customers.",
                );
            const row = {
                ...plain(input),
                id,
                registration,
                normalized_registration: normalized,
                car_model: input.car_model!.trim(),
                customer_ids: [...new Set(input.customer_ids)],
                version: (old?.version ?? 0) + 1,
                created_by: old?.created_by ?? user.value!.id,
            } as Vehicle;
            await db.put("vehicle", id, row);
            await enqueue("vehicle.save", id, row, old?.version ?? 0);
        });
        await refresh();
        broadcast();
        void sync();
        return vehicles.value.find((car) => car.id === id)!;
    }
    async function enqueue(
        type: Operation["type"],
        id: string,
        payload: any,
        version: number,
    ) {
        const db = v();
        const order =
            ((await db.get<number>("meta", "operation_order")) ?? 0) + 1;
        await db.put("meta", "operation_order", order);
        const op: Operation = {
            id: uuid(),
            device_id: db.profile.device_id,
            actor_id: user.value!.id,
            entity_id: id,
            type,
            payload: plain(payload),
            expected_version: version,
            action_at: new Date().toISOString(),
            state: "pending",
            attempts: 0,
            next_retry: 0,
            created_order: order,
        };
        await db.put("outbox", op.id, op);
    }
    async function persistDraft(input: Invoice, queue = false) {
        const db = v();
        let saved!: Invoice;
        await db.transaction(async () => {
            const old = await db.get<Invoice>("invoice", input.id);
            if (old?.status && old.status !== "draft")
                throw new Error(
                    "This invoice has already been issued or cancelled.",
                );
            if (
                old?.local_revision &&
                input.local_revision !== old.local_revision
            )
                throw new Error(
                    "This draft changed in another tab. Reopen it to keep both tabs from overwriting work.",
                );
            if (
                old &&
                old.created_by !== user.value!.id &&
                user.value!.role !== "admin"
            )
                throw new Error(
                    "Only the creator or an administrator can edit this draft.",
                );
            saved = {
                ...plain(input),
                version: old?.version ?? 0,
                status: "draft",
                invoice_number: null,
                saved_at: new Date().toISOString(),
                local_revision: uuid(),
                local_only: old?.local_only ?? true,
                local_dirty: !queue,
            } as Invoice;
            if (queue) {
                validateInvoice(saved);
                const computed = calculate(saved.items);
                saved = { ...saved, ...computed, version: saved.version + 1 };
                await enqueue(
                    "invoice.save",
                    saved.id,
                    saved,
                    saved.version - 1,
                );
            }
            await db.put("invoice", saved.id, saved);
        });
        await refresh();
        broadcast();
        if (queue) void sync();
        return saved;
    }
    function validateInvoice(invoice: Invoice) {
        if (
            !invoice.customer_id ||
            !invoice.customer_snapshot?.name ||
            !invoice.customer_snapshot?.phone
        )
            throw new Error("Select a customer before saving or issuing.");
        if (
            !invoice.items.length ||
            invoice.items.some((i) => !i.description.trim())
        )
            throw new Error(
                "Add at least one item and enter every description.",
            );
        if (!invoice.invoice_date) throw new Error("Choose the invoice date.");
    }
    async function issue(input: Invoice) {
        validateInvoice(input);
        const db = v();
        let issued!: Invoice;
        await db.transaction(async () => {
            const old = await db.get<Invoice>("invoice", input.id);
            if (old && old.status !== "draft") {
                issued = old;
                return;
            }
            if (
                old?.local_revision &&
                old.local_revision !== input.local_revision
            )
                throw new Error(
                    "Draft changed in another tab. Reopen before issuing.",
                );
            if (
                old &&
                old.created_by !== user.value!.id &&
                user.value!.role !== "admin"
            )
                throw new Error(
                    "You cannot issue another staff member’s draft.",
                );
            const allocations = await db.all<Allocation>("allocation");
            const block = allocations
                .sort((a, b) => a.start - b.start)
                .find((a) => a.next <= a.end);
            if (!block)
                throw new Error(
                    "No offline numbers remain. Save this as a draft and connect to obtain more numbers.",
                );
            const number = block.next++;
            await db.put("allocation", block.id, block);
            issued = {
                ...plain(input),
                ...calculate(input.items),
                version: (old?.version ?? 0) + 1,
                status: "issued",
                invoice_number: formatInvoiceNumber(number),
                number_value: number,
                allocation_id: block.id,
                issued_at: new Date().toISOString(),
                saved_at: new Date().toISOString(),
                local_revision: uuid(),
                local_only: true,
                local_dirty: false,
            } as Invoice;
            await enqueue(
                "invoice.issue",
                issued.id,
                issued,
                issued.version - 1,
            );
            await db.put("invoice", issued.id, issued);
        });
        await refresh();
        broadcast();
        void sync();
        return issued;
    }
    async function cancel(id: string, reason: string) {
        const db = v();
        await db.transaction(async () => {
            const old = await db.get<Invoice>("invoice", id);
            if (!old || old.status === "draft")
                throw new Error("Only issued invoices can be cancelled.");
            if (old.status === "cancelled") return;
            await enqueue("invoice.cancel", id, { reason }, old.version);
            await db.put("invoice", id, {
                ...old,
                status: "cancelled",
                version: old.version + 1,
                cancelled_at: new Date().toISOString(),
                cancelled_by: user.value!.id,
                cancellation_reason: reason,
                events: [
                    ...(old.events ?? []),
                    {
                        type: "cancelled (pending sync)",
                        actor: { name: user.value!.name },
                        created_at: new Date().toISOString(),
                        reason,
                    },
                ],
            });
        });
        await refresh();
        broadcast();
        void sync();
    }
    async function reserve() {
        const db = v(),
            allocs = await db.all<Allocation>("allocation");
        if (
            allocs.reduce((s, a) => s + Math.max(0, a.end - a.next + 1), 0) >=
            20
        )
            return;
        let request = await db.get("meta", "reservation");
        if (!request) {
            request = { id: uuid(), device_id: db.profile.device_id };
            await db.put("meta", "reservation", request);
        }
        const allocation = await send<Allocation>(
            "/number-allocations",
            request,
        );
        await db.transaction(async () => {
            if (!(await db.get("allocation", allocation.id)))
                await db.put("allocation", allocation.id, {
                    ...allocation,
                    next: allocation.start,
                });
            await db.remove("meta", "reservation");
        });
    }
    let syncAgain = false;
    async function sync() {
        if (!vault.value || !vault.value.db.isOpen()) return;
        if (syncing.value) {
            syncAgain = true;
            return;
        }
        syncing.value = true;
        const db = v();
        const run = async () => {
            if (vault.value !== db) return;
            try {
                const me = await api<{ user: User; company: Company }>("/me");
                online.value = true;
                if (
                    me.user.id !== user.value?.id ||
                    me.company.business_id !== company.value?.business_id
                ) {
                    needsAuth.value = true;
                    syncMessage.value =
                        "Sign in as the original account to sync this device.";
                    return;
                }
                needsAuth.value = false;
                const preferences = await db.get<{ simple_mode: boolean }>(
                    "meta",
                    "preferences",
                );
                if (preferences) {
                    me.user = await send<User>(
                        "/preferences",
                        preferences,
                        "PUT",
                    );
                    const latest = await db.get<{ simple_mode: boolean }>(
                        "meta",
                        "preferences",
                    );
                    if (latest?.simple_mode === preferences.simple_mode)
                        await db.remove("meta", "preferences");
                    else if (latest) me.user.simple_mode = latest.simple_mode;
                }
                user.value = me.user;
                company.value = me.company;
                await db.put("meta", "access", {
                    user: me.user,
                    company: me.company,
                    verified_at: Date.now(),
                    grant_until: Date.now() + 7 * 86400000,
                });
                await send("/devices", {
                    id: db.profile.device_id,
                    name: "Shop device · " + navigator.platform,
                });
                await db.put("meta", "device", { registered: true });
                // Synchronize customers before the cars that reference them.
                const priority = (operation: Operation) =>
                    operation.type.startsWith("customer")
                        ? 0
                        : operation.type.startsWith("vehicle")
                          ? 1
                          : 2;
                const list = (await db.all<Operation>("outbox")).sort(
                    (a, b) =>
                        priority(a) - priority(b) ||
                        a.created_order - b.created_order,
                );
                const blocked = new Set<string>();
                for (const op of list) {
                    if (vault.value !== db) return;
                    if (op.state === "archived") continue;
                    if (op.state !== "pending" || op.next_retry > Date.now()) {
                        blocked.add(op.entity_id);
                        continue;
                    }
                    if (
                        blocked.has(op.entity_id) ||
                        blocked.has(op.payload.customer_id) ||
                        (op.type === "vehicle.save" &&
                            Array.isArray(op.payload.customer_ids) &&
                            op.payload.customer_ids.some((id: string) =>
                                blocked.has(id),
                            ))
                    )
                        continue;
                    const wire = {
                        id: op.id,
                        device_id: op.device_id,
                        actor_id: op.actor_id,
                        entity_id: op.entity_id,
                        type: op.type,
                        payload: op.payload,
                        expected_version: op.expected_version,
                        action_at: op.action_at,
                    };
                    let result: any;
                    try {
                        result = (
                            await send("/sync/push", { operations: [wire] })
                        ).results[0];
                    } catch (e) {
                        op.attempts++;
                        op.next_retry =
                            Date.now() +
                            Math.min(
                                300000,
                                2000 * 2 ** Math.min(op.attempts, 7),
                            );
                        op.error =
                            e instanceof Error ? e.message : "Request failed";
                        await db.put("outbox", op.id, op);
                        throw e;
                    }
                    await db.transaction(async () => {
                        if (result.ok) {
                            await db.remove("outbox", op.id); // Only after a durable server receipt.
                            const rest = (
                                await db.all<Operation>("outbox")
                            ).some(
                                (o) =>
                                    o.entity_id === op.entity_id &&
                                    o.state !== "archived",
                            );
                            const kind = result.entity_type,
                                local = await db.get(kind, op.entity_id);
                            if (!rest && !local?.local_dirty)
                                await db.put(kind, op.entity_id, {
                                    ...result.entity,
                                    local_only: false,
                                });
                        } else {
                            op.attempts++;
                            op.server_status = result.status;
                            op.error =
                                Object.values(result.errors ?? {})
                                    .flat()
                                    .join(" ") || result.error;
                            op.state =
                                result.status === 409
                                    ? "conflict"
                                    : result.status >= 500
                                      ? "pending"
                                      : "failed";
                            op.next_retry =
                                Date.now() +
                                Math.min(
                                    300000,
                                    2000 * 2 ** Math.min(op.attempts, 7),
                                );
                            await db.put("outbox", op.id, op);
                            blocked.add(op.entity_id);
                        }
                    });
                }
                let more = true;
                while (more && vault.value === db) {
                    const cursor =
                        (await db.get<number>("meta", "cursor")) ?? 0;
                    const pull = await api("/sync/pull?cursor=" + cursor);
                    await db.transaction(async () => {
                        const pending = await db.all<Operation>("outbox");
                        for (const change of pull.changes) {
                            if (change.entity_type === "company") {
                                company.value = change.data;
                                continue;
                            }
                            const local = await db.get(
                                change.entity_type,
                                change.entity_id,
                            );
                            if (
                                pending.some(
                                    (o) =>
                                        o.entity_id === change.entity_id &&
                                        o.state !== "archived",
                                ) ||
                                local?.local_dirty
                            )
                                continue;
                            // Pull must never restore a terminal local cancellation.
                            if (
                                change.entity_type === "invoice" &&
                                local?.status === "cancelled" &&
                                change.data.status !== "cancelled"
                            )
                                continue;
                            await db.put(change.entity_type, change.entity_id, {
                                ...change.data,
                                local_only: false,
                            });
                        }
                        await db.put("meta", "cursor", pull.cursor);
                    });
                    more = pull.has_more;
                }
                let refillMessage = "";
                try {
                    await reserve();
                } catch (e) {
                    refillMessage =
                        e instanceof Error
                            ? e.message
                            : "Number refill failed.";
                }
                const date = new Date().toISOString();
                await db.put("meta", "sync", { last_sync: date });
                lastSync.value = date;
                syncMessage.value = refillMessage;
                await refresh();
                broadcast();
            } catch (e) {
                if (e instanceof ApiError) {
                    online.value = true;
                    if ([401, 419, 403].includes(e.status))
                        needsAuth.value = true;
                    syncMessage.value = e.message;
                } else {
                    online.value = false;
                    syncMessage.value =
                        "Server unreachable. Changes are saved on this device.";
                }
            }
        };
        try {
            if (navigator.locks)
                await navigator.locks.request(
                    "sinlink-sync-" + db.profile.id,
                    { ifAvailable: true },
                    async (lock) => {
                        if (lock) await run();
                    },
                );
            else {
                const owner = uuid();
                let acquired = false;
                await db.transaction(async () => {
                    const lease = await db.get("meta", "sync_lease");
                    if (!lease || lease.until < Date.now()) {
                        await db.put("meta", "sync_lease", {
                            owner,
                            until: Date.now() + 60000,
                        });
                        acquired = true;
                    }
                });
                if (acquired) {
                    const timer = setInterval(() => {
                        void db.put("meta", "sync_lease", {
                            owner,
                            until: Date.now() + 60000,
                        });
                    }, 10000);
                    try {
                        await run();
                    } finally {
                        clearInterval(timer);
                        await db.remove("meta", "sync_lease");
                    }
                }
            }
        } catch (e) {
            if (vault.value === db) {
                syncMessage.value =
                    e instanceof Error
                        ? e.message
                        : "Sync was interrupted; queued work is retained.";
            }
        } finally {
            syncing.value = false;
            if (syncAgain && vault.value === db) {
                syncAgain = false;
                queueMicrotask(() => {
                    void sync();
                });
            }
        }
    }
    async function retry(id: string) {
        const op = await v().get<Operation>("outbox", id);
        if (!op) return;
        await v().put("outbox", id, { ...op, state: "pending", next_retry: 0 });
        await refresh();
        void sync();
    }
    async function archive(id: string) {
        const db = v();
        await db.transaction(async () => {
            const op = await db.get<Operation>("outbox", id);
            if (!op) return;
            const dependents = (await db.all<Operation>("outbox")).filter(
                (o) => o.entity_id === op.entity_id && o.state !== "archived",
            );
            for (const o of dependents)
                await db.put("outbox", o.id, { ...o, state: "archived" });
            await db.remove(op.type.split(".")[0]!, op.entity_id);
        });
        await refresh();
        broadcast();
        void sync();
    }
    async function adoptServer(
        id: string,
        kind: "invoice" | "customer" | "vehicle" = "invoice",
    ) {
        const record = await api("/" + kind + "s/" + id);
        await v().put(kind, id, record);
        await refresh();
    }
    async function lock(broadcastLock = true) {
        // A lock clears the key and every decrypted business record from memory.
        if (broadcastLock) channel?.postMessage("locked");
        const profileId = vault.value?.profile.id;
        vault.value?.close();
        vault.value = undefined;
        user.value = undefined;
        company.value = undefined;
        invoices.value = [];
        customers.value = [];
        vehicles.value = [];
        operations.value = [];
        verified.value = undefined;
        remaining.value = 0;
        lastSync.value = undefined;
        await clearVaultSession(profileId);
        profiles.value = await directory.profiles.toArray();
    }
    async function logout() {
        try {
            await send("/logout", {});
        } catch {}
        clearCsrf();
        await lock();
    }
    setInterval(() => {
        if (vault.value) void sync();
    }, 30000);
    return {
        setDraftFlusher,
        flushDraft,
        vault,
        user,
        company,
        profiles,
        invoices,
        customers,
        vehicles,
        operations,
        online,
        needsAuth,
        syncing,
        lastSync,
        syncMessage,
        remaining,
        notice,
        verified,
        booting,
        init,
        login,
        open,
        refresh,
        saveCustomer,
        saveVehicle,
        setSimpleMode,
        persistDraft,
        issue,
        cancel,
        sync,
        retry,
        archive,
        adoptServer,
        lock,
        logout,
    };
});
