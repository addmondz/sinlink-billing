<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useApp } from "./store";
import {
    FileText,
    Car,
    Users,
    UserRoundCog,
    Settings,
    RefreshCw,
    Plus,
    LogOut,
    Wifi,
    WifiOff,
    Download,
    Menu,
} from "@lucide/vue";
import { useRegisterSW } from "virtual:pwa-register/vue";
import Modal from "./components/Modal.vue";
import PasswordField from "./components/PasswordField.vue";
import { VaultPasswordError, type Profile } from "./lib/vault";
const app = useApp(),
    router = useRouter(),
    email = ref(""),
    password = ref(""),
    previousPassword = ref(""),
    accountPassword = ref(""),
    error = ref(""),
    busy = ref(false),
    selected = ref<Profile>(),
    mode = ref<"login" | "migrate">("login"),
    showLogout = ref(false),
    logoutBusy = ref(false),
    logoutError = ref("");
const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
    onRegisterError(e) {
        console.error("Service worker registration", e);
    },
});
const existing = computed(() =>
    app.verified
        ? app.profiles.find(
              (p) =>
                  p.user.id === app.verified!.user.id &&
                  p.business_id === app.verified!.company.business_id,
          )
        : undefined,
);
const pending = computed(
    () => app.operations.filter((o) => o.state !== "archived").length,
);
const hasUnsyncedData = computed(
    () =>
        pending.value > 0 ||
        app.invoices.some(
            (invoice) => invoice.local_only || invoice.local_dirty,
        ),
);
const isSimpleInvoiceEditor = computed(
    () =>
        !!app.user?.simple_mode &&
        router.currentRoute.value.meta.invoiceEditor === true,
);
watch(
    () => app.user?.role,
    (role) => {
        if (
            role &&
            role !== "admin" &&
            router.currentRoute.value.meta.requiresAdmin
        ) {
            void router.replace("/");
        }
    },
);
const installEvent = ref<any>(),
    installHelp = ref(false);
onMounted(() => {
    void app.init();
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        installEvent.value = e;
    });
});
async function login() {
    busy.value = true;
    error.value = "";
    try {
        await app.login(email.value, password.value);
    } catch (e) {
        if (e instanceof VaultPasswordError && app.verified) {
            selected.value = existing.value;
            accountPassword.value = password.value;
            mode.value = "migrate";
        } else {
            error.value = (e as Error).message;
        }
    } finally {
        password.value = "";
        busy.value = false;
    }
}
async function migrate() {
    busy.value = true;
    error.value = "";
    try {
        await app.open(
            selected.value,
            previousPassword.value,
            undefined,
            accountPassword.value,
        );
        accountPassword.value = "";
    } catch (e) {
        error.value = (e as Error).message;
    } finally {
        password.value = "";
        previousPassword.value = "";
        busy.value = false;
    }
}
function resetLogin() {
    mode.value = "login";
    error.value = "";
    password.value = "";
    previousPassword.value = "";
    accountPassword.value = "";
    selected.value = undefined;
    app.verified = undefined;
}
async function install() {
    if (installEvent.value) {
        await installEvent.value.prompt();
        installEvent.value = undefined;
    } else installHelp.value = true;
}
async function requestLogout() {
    logoutBusy.value = true;
    logoutError.value = "";
    try {
        await app.flushDraft();
    } catch (e) {
        logoutError.value = (e as Error).message;
    } finally {
        logoutBusy.value = false;
        showLogout.value = true;
    }
}
async function logout() {
    if (logoutBusy.value) return;
    logoutBusy.value = true;
    logoutError.value = "";
    try {
        await app.flushDraft();
        if (hasUnsyncedData.value) return;
        await app.logout();
        showLogout.value = false;
        resetLogin();
        await router.replace("/");
    } catch (e) {
        logoutError.value = (e as Error).message;
    } finally {
        logoutBusy.value = false;
    }
}
async function lock() {
    await app.flushDraft();
    await app.lock();
    resetLogin();
}
async function update() {
    await app.flushDraft();
    await updateServiceWorker(true);
}
</script>
<template>
    <div v-if="app.booting" class="boot-screen">Opening Sinlink…</div>
    <div v-else-if="!app.user" class="auth-layout">
        <div class="auth-story">
            <div class="brand">
                <span class="brand-symbol">S</span
                ><span>SINLINK<small>AUTO ACCESSORIES</small></span>
            </div>
            <div>
                <span class="eyebrow light">LESS ADMIN. MORE DRIVE.</span>
                <h1>Every sale,<br />taken care of.</h1>
                <p>
                    Cash sales invoicing for the shop floor.<br />Ready wherever
                    the day takes you.
                </p>
            </div>
            <small>MYR · Asia/Kuala_Lumpur · Works offline after setup</small>
        </div>
        <main class="auth-main">
            <div class="auth-card">
                <span class="eyebrow">YOUR SHOP, IN SYNC</span>
                <h1>
                    {{
                        mode === "login"
                            ? "Welcome back"
                            : "Update saved data access"
                    }}
                </h1>
                <p class="muted">
                    {{
                        mode === "login"
                            ? "Sign in to your Sinlink account."
                            : "You are signed in. Enter the previous password or device passphrase once to keep your saved work. Your account password will unlock it from now on."
                    }}
                </p>
                <p v-if="error" class="error" role="alert">{{ error }}</p>
                <form
                    v-if="mode === 'login'"
                    @submit.prevent="login"
                    class="stack"
                >
                    <label
                        >Email<input
                            v-model="email"
                            type="email"
                            required
                            autocomplete="username"
                            autofocus
                    /></label>
                    <PasswordField
                        label="Password"
                        v-model="password"
                        required
                        autocomplete="current-password"
                    />
                    <button class="button primary full" :disabled="busy">
                        {{ busy ? "Signing in…" : "Sign in" }}
                    </button>
                </form>
                <form v-else @submit.prevent="migrate" class="stack">
                    <p class="account-tag">
                        {{ selected?.user.name || app.verified?.user.name }} ·
                        {{ selected?.user.email || app.verified?.user.email }}
                    </p>
                    <PasswordField
                        label="Previous password or passphrase"
                        v-model="previousPassword"
                        required
                        autocomplete="off"
                        autofocus
                    />
                    <button class="button primary full" :disabled="busy">
                        {{ busy ? "Opening…" : "Use account password" }}
                    </button>
                    <button
                        type="button"
                        class="text-button"
                        @click="resetLogin"
                    >
                        Back to sign in
                    </button>
                </form>
            </div>
        </main>
    </div>
    <div
        v-else
        class="app-layout"
        :class="{ 'simple-mode': app.user.simple_mode }"
    >
        <aside class="sidebar no-print">
            <RouterLink to="/" class="brand"
                ><span class="brand-symbol">S</span
                ><span>SINLINK<small>AUTO ACCESSORIES</small></span></RouterLink
            ><span class="nav-caption">WORKSPACE</span>
            <nav>
                <RouterLink to="/" exact-active-class="active"
                    ><FileText :size="20" />Invoices</RouterLink
                ><RouterLink to="/customers" active-class="active"
                    ><Users :size="20" />Customers</RouterLink
                ><RouterLink
                    v-if="!app.user.simple_mode"
                    to="/cars"
                    active-class="active"
                    ><Car :size="20" />Cars</RouterLink
                ><RouterLink
                    v-if="app.user.role === 'admin'"
                    to="/staff"
                    active-class="active"
                    ><UserRoundCog :size="20" />Staff</RouterLink
                ><RouterLink
                    v-if="app.user.role === 'admin'"
                    to="/settings"
                    active-class="active"
                    ><Settings :size="20" />Settings</RouterLink
                >
            </nav>
            <div class="sidebar-bottom">
                <RouterLink to="/sync" class="sync-link"
                    ><RefreshCw
                        :size="18"
                        :class="{ spinning: app.syncing }"
                    /><span
                        >Sync status<small>{{
                            pending
                                ? pending + " changes queued"
                                : "All work saved"
                        }}</small></span
                    ><span v-if="pending" class="count-badge">{{
                        pending
                    }}</span></RouterLink
                ><button class="install-link" @click="install">
                    <Download :size="17" />Install application
                </button>
                <div class="user-card">
                    <span class="avatar">{{ app.user.name.slice(0, 1) }}</span
                    ><span
                        >{{ app.user.name
                        }}<small>{{
                            app.user.role === "admin"
                                ? "Administrator"
                                : "Staff"
                        }}</small></span
                    ><button
                        class="icon-button"
                        aria-label="Sign out"
                        :disabled="logoutBusy"
                        @click="requestLogout"
                    >
                        <LogOut :size="18" />
                    </button>
                </div>
            </div>
        </aside>
        <div class="workspace">
            <header class="topbar no-print">
                <span class="shop-label"
                    >Cash sales <span>/</span> Shop workspace</span
                ><span class="mobile-brand">SINLINK</span>
                <div class="connection">
                    <span
                        :class="['connection-dot', { offline: !app.online }]"
                    /><span>{{
                        app.syncing
                            ? "Syncing…"
                            : !app.online
                              ? "Offline · saved on device"
                              : app.needsAuth
                                ? "Sign in to sync"
                                : pending
                                  ? pending + " pending"
                                  : "Connected & up to date"
                    }}</span
                    ><button
                        class="icon-button"
                        aria-label="Sync now"
                        @click="app.sync"
                    >
                        <RefreshCw
                            :size="16"
                            :class="{ spinning: app.syncing }"
                        />
                    </button>
                    <button
                        class="icon-button mobile-only"
                        aria-label="Sign out"
                        :disabled="logoutBusy"
                        @click="requestLogout"
                    >
                        <LogOut :size="18" />
                    </button>
                </div>
            </header>
            <div v-if="app.needsAuth && app.online" class="banner no-print">
                Your online session needs authentication. Local work is safe.
                <button class="text-button" @click="lock">
                    Lock & sign in
                </button>
            </div>
            <div v-if="needRefresh" class="banner no-print">
                An application update is ready. Drafts and queued changes are
                kept.
                <button class="text-button" @click="update">
                    Update safely
                </button>
            </div>
            <div v-if="offlineReady" class="toast no-print" role="status">
                Application ready for offline use.
                <button class="text-button" @click="offlineReady = false">
                    Dismiss
                </button>
            </div>
            <main class="page"><RouterView :key="$route.path" /></main>
        </div>
        <nav class="mobile-nav no-print">
            <RouterLink to="/"><FileText :size="20" />Invoices</RouterLink
            ><RouterLink
                v-if="app.user.role === 'admin' && !app.user.simple_mode"
                to="/customers"
                ><Users :size="20" />Customers</RouterLink
            ><button
                v-if="isSimpleInvoiceEditor"
                type="button"
                class="new-tab"
                disabled
                aria-current="page"
                aria-label="New invoice in progress"
            >
                <Plus :size="24" /><span>New</span><small>In progress</small>
            </button>
            <RouterLink v-else to="/invoices/new" class="new-tab"
                ><Plus :size="24" /><span>New</span></RouterLink
            ><RouterLink v-if="app.user.role === 'staff'" to="/customers"
                ><Users :size="20" />Customers</RouterLink
            ><RouterLink
                v-if="app.user.role === 'admin' && !app.user.simple_mode"
                to="/sync"
                ><RefreshCw :size="20" />Sync
                <span v-if="pending">({{ pending }})</span></RouterLink
            ><RouterLink v-if="app.user.role === 'admin'" to="/settings"
                ><Settings :size="20" />Settings</RouterLink
            >
        </nav>
    </div>
    <Modal v-if="showLogout" @close="showLogout = false"
        ><template #title
            ><h2>{{ hasUnsyncedData ? "Unsynced data" : "Sign out?" }}</h2>
        </template>
        <p v-if="hasUnsyncedData" role="alert">
            Please don’t sign out yet. You have unsynced data.
        </p>
        <p v-else-if="!logoutError">Are you sure you want to sign out?</p>
        <p v-if="logoutError" class="error" role="alert">{{ logoutError }}</p>
        <div class="form-actions">
            <button
                class="button secondary"
                :disabled="logoutBusy"
                @click="showLogout = false"
            >
                {{ hasUnsyncedData || logoutError ? "Okay" : "Cancel" }}
            </button>
            <button
                v-if="!hasUnsyncedData && !logoutError"
                class="button danger"
                :disabled="logoutBusy"
                @click="logout"
            >
                {{ logoutBusy ? "Signing out…" : "Sign out" }}
            </button>
        </div></Modal
    >
    <Modal v-if="installHelp" @close="installHelp = false"
        ><template #title><h2>Install Sinlink</h2></template>
        <p>
            On iPhone or iPad, open this app in Safari, tap Share, then
            <b>Add to Home Screen</b>.
        </p>
        <p>
            On Android or desktop Chrome, open the browser menu and choose
            <b>Install app</b> or <b>Add to Home screen</b>.
        </p>
        <p class="muted">
            Installation and offline caching require HTTPS, or localhost during
            development. Sign in online once to finish setup.
        </p></Modal
    >
</template>
