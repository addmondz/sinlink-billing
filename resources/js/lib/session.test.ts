import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import {
    clearVaultSession,
    createVault,
    directory,
    restoreVaultSession,
    unlockVault,
    type Vault,
} from "./vault";
import { api, ApiError } from "./api";
import { useApp } from "../store";
import { uuid, type Company, type User } from "./types";

vi.mock("./api", async () => ({
    ...(await vi.importActual<any>("./api")),
    api: vi.fn().mockRejectedValue(new TypeError("Offline")),
    send: vi.fn().mockRejectedValue(new TypeError("Offline")),
}));

const password = "Refresh session test password!";
const storageKey = "sinlink-tab-session";
const user: User = {
    id: 42,
    name: "Refresh cashier",
    email: "refresh@example.test",
    role: "staff",
    active: true,
};
let vault: Vault, company: Company;

beforeEach(async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("BroadcastChannel", class {
        onmessage: unknown;
        postMessage() {}
    });
    vi.mocked(api).mockReset().mockRejectedValue(new TypeError("Offline"));
    company = {
        business_id: uuid(),
        version: 1,
        company_name: "Sinlink",
        registration_number: "",
        address: "",
        phone: "",
        logo: "",
        paper_size: "A4",
        margin_mm: 12,
        footer_terms: "",
        signature_left: "",
        signature_right: "",
    };
    vault = await createVault(user, company, password);
    await vault.put("customer", "saved", { name: "Saved customer" });
});

afterEach(async () => {
    await vault.db.delete();
    await directory.profiles.clear();
    await directory.sessions.clear();
    vi.unstubAllGlobals();
});

describe("restoring the current tab after refresh", () => {
    it("restores saved work with a wrapped key and keeps the password out of saved session data", async () => {
        const device = vault.profile.device_id;
        await vault.rememberSession(password);
        const saved = sessionStorage.getItem(storageKey)!;
        const session = (await directory.sessions.toArray())[0]!;
        expect(saved).not.toContain(password);
        expect(saved).not.toContain("Saved customer");
        await expect(crypto.subtle.exportKey("raw", session.key)).rejects.toThrow();
        vault.close();

        const restored = await restoreVaultSession({ user, company });

        expect(restored?.access.user.id).toBe(user.id);
        vault = restored!.vault;
        expect(vault.profile.device_id).toBe(device);
        expect(await vault.get("customer", "saved")).toEqual({ name: "Saved customer" });
    });

    it("opens the saved account during startup when its server session is still valid", async () => {
        await vault.rememberSession(password);
        vault.close();
        vi.mocked(api).mockResolvedValueOnce({ user, company });
        const app = useApp(createPinia());

        await app.init();

        vault = app.vault!;
        expect(app.user?.id).toBe(user.id);
        expect(app.customers).toEqual([{ name: "Saved customer" }]);
        expect(app.needsAuth).toBe(false);
        expect(app.booting).toBe(false);
    });

    it("keeps the current tab open offline while its offline grant is valid", async () => {
        await vault.rememberSession(password);
        vault.close();
        const app = useApp(createPinia());

        await app.init();

        vault = app.vault!;
        expect(app.user?.id).toBe(user.id);
        expect(app.customers).toEqual([{ name: "Saved customer" }]);
        expect(app.online).toBe(false);
        expect(app.needsAuth).toBe(true);
    });

    it.each([401, 403, 419])("does not reopen saved work when the server rejects the session with %s", async (status) => {
        await vault.rememberSession(password);
        vi.mocked(api).mockRejectedValueOnce(new ApiError(status, "Sign in again"));
        const app = useApp(createPinia());

        await app.init();

        expect(app.user).toBeUndefined();
        expect(app.vault).toBeUndefined();
        expect(sessionStorage.getItem(storageKey)).toBeNull();
        expect(await vault.get("customer", "saved")).toEqual({ name: "Saved customer" });
    });

    it.each(["user", "business"])("does not reopen another %s's local data", async (changed) => {
        await vault.rememberSession(password);
        vi.mocked(api).mockResolvedValueOnce({
            user: changed === "user" ? { ...user, id: 99 } : user,
            company: changed === "business" ? { ...company, business_id: uuid() } : company,
        });
        const app = useApp(createPinia());

        await app.init();

        expect(app.user).toBeUndefined();
        expect(app.vault).toBeUndefined();
        expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it("requires sign-in again after an explicit lock and preserves the saved customer", async () => {
        await vault.rememberSession(password);
        const app = useApp(createPinia());
        app.vault = vault;
        app.user = user;

        await app.lock();

        expect(await restoreVaultSession({ user, company })).toBeUndefined();
        expect(await directory.sessions.count()).toBe(0);
        const reopened = await unlockVault(vault.profile, password);
        vault = reopened.vault;
        expect(await vault.get("customer", "saved")).toEqual({ name: "Saved customer" });
    });

    it("requires a password in a new tab that has no saved session envelope", async () => {
        await vault.rememberSession(password);
        sessionStorage.removeItem(storageKey);

        expect(await restoreVaultSession({ user, company })).toBeUndefined();
    });

    it("does not restore expired offline access", async () => {
        const access = await vault.get("meta", "access");
        await vault.put("meta", "access", { ...access, grant_until: Date.now() - 1 });
        await vault.rememberSession(password);

        expect(await restoreVaultSession()).toBeUndefined();
        expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it("expires saved tab keys after seven days", async () => {
        await vault.rememberSession(password);
        const session = (await directory.sessions.toArray())[0]!;
        await directory.sessions.update(session.id, { expires_at: Date.now() - 1 });

        expect(await restoreVaultSession({ user, company })).toBeUndefined();
        expect(await directory.sessions.count()).toBe(0);
    });

    it("discards damaged session data while retaining saved business data", async () => {
        await vault.rememberSession(password);
        const envelope = JSON.parse(sessionStorage.getItem(storageKey)!);
        envelope.wrapped_key[0] ^= 255;
        sessionStorage.setItem(storageKey, JSON.stringify(envelope));

        expect(await restoreVaultSession({ user, company })).toBeUndefined();
        expect(await vault.get("customer", "saved")).toEqual({ name: "Saved customer" });
    });

    it("invalidates remembered keys when the local password changes", async () => {
        await vault.rememberSession(password);

        await vault.useAccountPassword("Changed refresh password!");

        expect(await restoreVaultSession({ user, company })).toBeUndefined();
        expect(await vault.get("customer", "saved")).toEqual({ name: "Saved customer" });
    });

    it("still permits password unlock when tab storage is unavailable", async () => {
        vi.stubGlobal("sessionStorage", undefined);

        await vault.rememberSession(password);
        await clearVaultSession();

        expect(await restoreVaultSession({ user, company })).toBeUndefined();
        const reopened = await unlockVault(vault.profile, password);
        reopened.vault.close();
    });
});
