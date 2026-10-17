import Dexie, { type Table } from "dexie";
import type { User, Company } from "./types";
interface Box {
    id: string;
    kind: string;
    iv: number[];
    cipher: ArrayBuffer;
}
export interface Profile {
    id: string;
    user: User;
    business_id: string;
    salt: number[];
    device_id: string;
    credential?: "password";
}
export class VaultPasswordError extends Error {}
export interface VaultAccess {
    user: User;
    company: Company;
    verified_at: number;
    grant_until: number;
}
interface SessionKey {
    id: string;
    profile_id: string;
    key: CryptoKey;
    expires_at: number;
}
interface SessionEnvelope {
    id: string;
    iv: number[];
    wrapped_key: number[];
}
const sessionStorageKey = "sinlink-tab-session";
class Directory extends Dexie {
    profiles!: Table<Profile, string>;
    sessions!: Table<SessionKey, string>;
    constructor() {
        super("sinlink-directory");
        this.version(1).stores({ profiles: "id" });
        this.version(2).stores({
            profiles: "id",
            sessions: "id,profile_id,expires_at",
        });
    }
}
export const directory = new Directory();
class VaultDB extends Dexie {
    records!: Table<Box, string>;
    constructor(name: string) {
        super(name);
        this.version(1).stores({ records: "id,kind" });
    }
}
const enc = new TextEncoder(),
    dec = new TextDecoder();
async function derive(password: string, salt: number[], extractable = false) {
    const material = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: new Uint8Array(salt),
            iterations: 310000,
            hash: "SHA-256",
        },
        material,
        { name: "AES-GCM", length: 256 },
        extractable,
        ["encrypt", "decrypt"],
    );
}
export class Vault {
    db: VaultDB;
    constructor(
        public profile: Profile,
        private key: CryptoKey,
    ) {
        this.db = new VaultDB("sinlink-" + profile.id);
    }
    private async seal(id: string, kind: string, value: unknown): Promise<Box> {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv,
                additionalData: enc.encode(id + "|" + kind),
            },
            this.key,
            enc.encode(JSON.stringify(value)),
        );
        return { id, kind, iv: [...iv], cipher };
    }
    private async open<T>(box: Box): Promise<T> {
        return JSON.parse(
            dec.decode(
                await crypto.subtle.decrypt(
                    {
                        name: "AES-GCM",
                        iv: new Uint8Array(box.iv),
                        additionalData: enc.encode(box.id + "|" + box.kind),
                    },
                    this.key,
                    box.cipher,
                ),
            ),
        );
    }
    async get<T = any>(kind: string, id: string): Promise<T | undefined> {
        const b = await this.db.records.get(kind + ":" + id);
        return b ? Dexie.waitFor(this.open<T>(b)) : undefined;
    }
    async all<T = any>(kind: string): Promise<T[]> {
        const boxes = await this.db.records
            .where("kind")
            .equals(kind)
            .toArray();
        return Dexie.waitFor(Promise.all(boxes.map((b) => this.open<T>(b))));
    }
    async put(kind: string, id: string, value: unknown) {
        const b = await Dexie.waitFor(this.seal(kind + ":" + id, kind, value));
        await this.db.records.put(b);
    }
    async remove(kind: string, id: string) {
        await this.db.records.delete(kind + ":" + id);
    }
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        return this.db.transaction("rw", this.db.records, fn);
    }
    close() {
        this.db.close();
    }
    async useAccountPassword(password: string) {
        const key = await derive(password, this.profile.salt);
        const updated = new Vault(
            { ...this.profile, credential: "password" },
            key,
        );
        await this.transaction(async () => {
            const boxes = await this.db.records.toArray();
            const encrypted = await Dexie.waitFor(
                Promise.all(
                    boxes.map(async (box) =>
                        updated.seal(box.id, box.kind, await this.open(box)),
                    ),
                ),
            );
            await this.db.records.bulkPut(encrypted);
        });
        this.key = key;
        this.profile = updated.profile;
        await directory.profiles.put(JSON.parse(JSON.stringify(this.profile)));
        await directory.sessions
            .where("profile_id")
            .equals(this.profile.id)
            .delete();
    }
    async rememberSession(password: string): Promise<void> {
        let id: string | undefined;
        try {
            if (typeof sessionStorage === "undefined") return;
            await clearVaultSession();
            await directory.sessions
                .where("expires_at")
                .below(Date.now())
                .delete();
            id = crypto.randomUUID();
            const key = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["wrapKey", "unwrapKey"],
            );
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const wrapped = await crypto.subtle.wrapKey(
                "raw",
                await derive(password, this.profile.salt, true),
                key,
                {
                    name: "AES-GCM",
                    iv,
                    additionalData: sessionContext(this.profile),
                },
            );
            await directory.sessions.put({
                id,
                profile_id: this.profile.id,
                key,
                expires_at: Date.now() + 7 * 86400000,
            });
            sessionStorage.setItem(
                sessionStorageKey,
                JSON.stringify({
                    id,
                    iv: [...iv],
                    wrapped_key: [...new Uint8Array(wrapped)],
                } satisfies SessionEnvelope),
            );
        } catch {
            if (id) await directory.sessions.delete(id);
        }
    }
    async export() {
        const boxes = await this.db.records.toArray();
        return {
            format: "sinlink-encrypted-v1",
            profile: this.profile,
            boxes: boxes.map((b) => ({
                ...b,
                cipher: [...new Uint8Array(b.cipher)],
            })),
            exported_at: new Date().toISOString(),
        };
    }
    async proposals(data: any) {
        if (
            data?.format !== "sinlink-encrypted-v1" ||
            !Array.isArray(data.boxes)
        )
            throw new Error("Invalid Sinlink backup.");
        const results: any[] = [];
        for (const raw of data.boxes) {
            if (raw.kind === "outbox") {
                results.push(
                    await this.open({
                        ...raw,
                        cipher: new Uint8Array(raw.cipher).buffer,
                    }),
                );
            }
        }
        return results;
    }
    async import(data: any, password?: string) {
        if (
            data?.format !== "sinlink-encrypted-v1" ||
            data.profile?.id !== this.profile.id ||
            data.profile?.device_id !== this.profile.device_id
        )
            throw new Error(
                "Restore only to the original account and device. Use recovery mode on a fresh browser.",
            );
        const reader = password
            ? new Vault(data.profile, await derive(password, data.profile.salt))
            : this;
        // Never overwrite allocations or rewind counters. Restore missing work only, preserving operation IDs.
        await this.transaction(async () => {
            for (const raw of data.boxes) {
                if (!["outbox", "invoice", "customer", "vehicle"].includes(raw.kind))
                    continue;
                const b = { ...raw, cipher: new Uint8Array(raw.cipher).buffer };
                const value = await Dexie.waitFor(reader.open(b));
                if (!(await this.db.records.get(b.id)))
                    await this.db.records.put(
                        await Dexie.waitFor(this.seal(b.id, b.kind, value)),
                    );
            }
        });
    }
}

function sessionContext(profile: Profile): Uint8Array<ArrayBuffer> {
    return enc.encode(
        JSON.stringify([profile.id, profile.device_id, profile.salt]),
    );
}

export async function clearVaultSession(profileId?: string): Promise<void> {
    let envelope: SessionEnvelope | undefined;
    try {
        const saved = sessionStorage.getItem(sessionStorageKey);
        sessionStorage.removeItem(sessionStorageKey);
        if (saved) envelope = JSON.parse(saved);
    } catch {}
    if (profileId) {
        await directory.sessions.where("profile_id").equals(profileId).delete();
    } else if (envelope?.id) {
        await directory.sessions.delete(envelope.id);
    }
}

export async function restoreVaultSession(
    verified?: Pick<VaultAccess, "user" | "company">,
): Promise<{ vault: Vault; access: VaultAccess } | undefined> {
    let opened: Vault | undefined;
    try {
        if (typeof sessionStorage === "undefined") return;
        const saved = sessionStorage.getItem(sessionStorageKey);
        if (!saved) return;
        const envelope: SessionEnvelope = JSON.parse(saved);
        const session = await directory.sessions.get(envelope.id);
        if (!session || session.expires_at <= Date.now()) {
            await clearVaultSession();
            return;
        }
        const profile = await directory.profiles.get(session.profile_id);
        if (
            !profile ||
            (verified &&
                (verified.user.id !== profile.user.id ||
                    verified.company.business_id !== profile.business_id ||
                    !verified.user.active))
        ) {
            await clearVaultSession();
            return;
        }
        const key = await crypto.subtle.unwrapKey(
            "raw",
            new Uint8Array(envelope.wrapped_key),
            session.key,
            {
                name: "AES-GCM",
                iv: new Uint8Array(envelope.iv),
                additionalData: sessionContext(profile),
            },
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
        opened = new Vault(profile, key);
        const access = await opened.get<VaultAccess>("meta", "access");
        if (
            !access ||
            access.user.id !== profile.user.id ||
            access.company.business_id !== profile.business_id ||
            (!verified &&
                (!access.user.active ||
                    !Number.isFinite(access.grant_until) ||
                    access.grant_until <= Date.now()))
        ) {
            throw new Error("Saved session is no longer valid.");
        }
        return { vault: opened, access };
    } catch {
        opened?.close();
        await clearVaultSession();
    }
}

export async function createVault(
    user: User,
    company: Company,
    password: string,
) {
    if (password.length < 8)
        throw new Error("Use at least 8 characters for the password.");
    const profile: Profile = {
        id: company.business_id + "-" + user.id,
        user,
        business_id: company.business_id,
        salt: [...crypto.getRandomValues(new Uint8Array(16))],
        device_id: crypto.randomUUID(),
        credential: "password",
    };
    if (await directory.profiles.get(profile.id))
        throw new Error(
            "This account already has saved data. Unlock it with its password.",
        );
    if (await Dexie.exists("sinlink-" + profile.id))
        throw new Error(
            "Existing device storage has lost its directory entry. Recover an encrypted backup instead of replacing local data.",
        );
    const vault = new Vault(profile, await derive(password, profile.salt));
    await vault.put("meta", "access", {
        user,
        company,
        verified_at: Date.now(),
        grant_until: Date.now() + 7 * 86400000,
    });
    await vault.put("meta", "device", { registered: false });
    await directory.profiles.put(JSON.parse(JSON.stringify(profile)));
    return vault;
}
export async function unlockVault(
    profile: Profile,
    password: string,
    onlineVerified = false,
) {
    const vault = new Vault(profile, await derive(password, profile.salt));
    let access: any;
    try {
        access = await vault.get("meta", "access");
    } catch {
        vault.close();
        throw new VaultPasswordError("Password is incorrect.");
    }
    if (!access)
        throw new Error(
            "Device data is unavailable. Restore an encrypted backup or register a new device.",
        );
    if (!onlineVerified && access.grant_until < Date.now()) {
        vault.close();
        throw new Error(
            "Offline access expired. Sign in online to renew this device for 7 days.",
        );
    }
    return { vault, access };
}
// Recovery uses the original encryption salt but a NEW device identity. Old allocations are never restored.
export async function recoverVault(
    data: any,
    password: string,
    user: User,
    company: Company,
) {
    if (
        data?.format !== "sinlink-encrypted-v1" ||
        data.profile?.id !== company.business_id + "-" + user.id
    )
        throw new Error(
            "This backup belongs to a different business or account.",
        );
    if (await directory.profiles.get(data.profile.id))
        throw new Error("Use Import backup on the existing device instead.");
    const original = new Vault(
        data.profile,
        await derive(password, data.profile.salt),
    );
    if (!Array.isArray(data.boxes))
        throw new Error("Invalid encrypted backup.");
    try {
        await original.transaction(async () => {
            for (const raw of data.boxes) {
                const box = { ...raw, cipher: new Uint8Array(raw.cipher).buffer };
                await original.db.records.put(box);
            }
            await original.get("meta", "access");
            // Decrypt all rows before committing a backup, including operation records.
            for (const kind of ["invoice", "customer", "vehicle", "outbox", "allocation"])
                await original.all(kind);
        });
    } catch (e) {
        original.close();
        if (e instanceof DOMException && e.name === "OperationError")
            throw new VaultPasswordError(
                "Backup password is incorrect, or the file is damaged.",
            );
        throw e;
    }
    const profile = { ...data.profile, user, device_id: crypto.randomUUID() };
    await original.db.records.where("kind").equals("allocation").delete();
    await original.remove("meta", "reservation");
    await original.put("meta", "device", { registered: false });
    // Keep original operation device IDs. Server accepts them only for the original actor and registered old device.
    await directory.profiles.put(JSON.parse(JSON.stringify(profile)));
    original.profile = profile;
    return original;
}

export async function readBackupProposals(data: any, password: string) {
    if (data?.format !== "sinlink-encrypted-v1" || !data.profile?.salt)
        throw new Error("Choose a valid Sinlink encrypted backup.");
    const reader = new Vault(
        data.profile,
        await derive(password, data.profile.salt),
    );
    try {
        return await reader.proposals(data);
    } catch {
        throw new Error(
            "Backup password is incorrect, or the file is damaged.",
        );
    } finally {
        reader.close();
    }
}
