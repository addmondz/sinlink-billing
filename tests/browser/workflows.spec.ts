import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
const creds = JSON.parse(
    fs.readFileSync("storage/test-artifacts/login.json", "utf8"),
);
async function signIn(page: Page, path = "/") {
    await page.goto(path);
    await page.getByLabel("Email", { exact: true }).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    let response = await Promise.all([
        page.waitForResponse(
            (response) =>
                response.url().endsWith("/api/login") &&
                response.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    if (response[0].status() === 429) {
        const retryAfter = Number(response[0].headers()["retry-after"] || 60);
        await page.waitForTimeout((retryAfter + 1) * 1000);
        await page.getByLabel("Password", { exact: true }).fill(creds.password);
        await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
    }
    await expect(
        page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        if (app.user.simple_mode) await app.setSimpleMode(false);
    });
    await expect
        .poll(
            async () =>
                (await (await page.request.get("/api/me")).json()).user
                    .simple_mode,
        )
        .toBe(false);
    await expect(page.locator(".list-footer"))
        .toContainText(/100 offline/)
        .catch(async (e) => {
            console.log(
                await page.evaluate(() => {
                    const a = (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                    return {
                        message: a.syncMessage,
                        online: a.online,
                        needsAuth: a.needsAuth,
                    };
                }),
            );
            throw e;
        });
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });
    await page.reload();
    await unlock(page);
    await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.setSimpleMode(false);
    });
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s.get("app")
                        .syncing,
            ),
        )
        .toBe(false);
}

test("customer forms preserve edits when dismissed and show accessible phone errors", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page
            .getByRole("link", { name: "Customers", exact: true })
            .first()
            .click();
        await page
            .getByRole("button", { name: "Create customer", exact: true })
            .first()
            .click();
        const dialog = page.getByRole("dialog", {
            name: "Create customer",
            exact: true,
        });
        await dialog
            .getByLabel("Name", { exact: true })
            .fill("Unsaved customer details");
        await dialog.getByLabel("Phone", { exact: true }).fill("0123");

        for (const dismiss of [
            () => page.mouse.click(5, 5),
            () => page.keyboard.press("Escape"),
            () =>
                dialog
                    .getByRole("button", { name: "Close dialog", exact: true })
                    .click(),
            () =>
                dialog
                    .getByRole("button", { name: "Cancel", exact: true })
                    .click(),
        ]) {
            await dismiss();
            await expect(
                dialog.getByRole("button", {
                    name: "Keep editing",
                    exact: true,
                }),
            ).toBeFocused();
            await dialog
                .getByRole("button", { name: "Keep editing", exact: true })
                .click();
            await expect(
                dialog.getByLabel("Name", { exact: true }),
            ).toHaveValue("Unsaved customer details");
            await expect(
                dialog.getByLabel("Phone", { exact: true }),
            ).toHaveValue("0123");
        }
        await dialog
            .getByRole("button", { name: "Save customer", exact: true })
            .click();
        await expect(dialog.getByRole("alert")).toBeFocused();
        await expect(dialog.getByRole("alert")).toBeInViewport();
        await expect(
            dialog.getByLabel("Phone", { exact: true }),
        ).toHaveAttribute("aria-invalid", "true");
        await expect(
            dialog.getByLabel("Phone", { exact: true }),
        ).toHaveAttribute(
            "aria-describedby",
            (await dialog.getByRole("alert").getAttribute("id")) as string,
        );
        await dialog
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        await dialog
            .getByRole("button", { name: "Discard changes", exact: true })
            .click();
        await expect(dialog).toHaveCount(0);
    }
});

test("mobile invoice errors stay visible and locking keeps an unfinished draft", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    await page.setViewportSize({ width: 390, height: 844 });
    const displayToggle = page.getByRole("button", { name: /Larger text/ });
    await displayToggle.click();
    await expect(displayToggle).toHaveAttribute("aria-pressed", "true");
    await expect(
        page
            .locator(".mobile-nav")
            .getByRole("link", { name: "Customers", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "New Invoice", exact: true }).click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+\/edit$/);
    const draftUrl = page.url();
    const description = "Unfinished invoice kept after locking";
    await page.getByLabel("Item 1 description").fill(description);
    for (const action of ["Save Draft", "Issue Invoice"]) {
        await page.getByRole("button", { name: action, exact: true }).click();
        await expect(page.getByRole("alert")).toContainText(
            "Select a customer",
        );
        await expect(page.getByRole("alert")).toBeFocused();
        await expect(page.getByRole("alert")).toBeInViewport();
        await expect(
            page.getByLabel("Find customer by mobile number"),
        ).toHaveAttribute("aria-invalid", "true");
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
        dialog.getByRole("link", { name: /Unfinished invoice/ }),
    ).toHaveAttribute("href", new URL(draftUrl).pathname);
    await dialog
        .getByRole("button", { name: "Lock & keep work", exact: true })
        .click();
    await expect(
        page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".app-layout")).toHaveCount(0);
    await page.getByLabel("Email", { exact: true }).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toBeVisible();
    const draftPath = new URL(draftUrl).pathname.replace(/\/edit$/, "");
    const draft = page.locator('.invoice-card[href="' + draftPath + '"]');
    await expect(draft.locator("time")).toHaveAttribute(
        "datetime",
        /^\d{4}-\d{2}-\d{2}$/,
    );
    await draft.click();
    await page.getByRole("link", { name: "Edit Draft", exact: true }).click();
    await expect(page).toHaveURL(draftUrl);
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        description,
    );
});

test("a first visit supports offline PDF downloads without reloading", async ({
    page,
    context,
}) => {
    await page.goto("/");
    const firstNavigation = await page.evaluate(() => performance.timeOrigin);
    await page.getByLabel("Email", { exact: true }).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText("Application ready for offline use.", { exact: false }),
    ).toBeVisible();
    expect(
        await page.evaluate(() => !!navigator.serviceWorker.controller),
    ).toBe(true);
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s.get("app")
                        .syncing,
            ),
        )
        .toBe(false);
    await context.setOffline(true);
    const id = await localDocument(page, "First visit offline PDF");
    await page
        .locator('a[href="/invoices/' + id + '"]')
        .first()
        .click();
    const downloaded = page.waitForEvent("download");
    await page
        .getByRole("button", { name: "Download PDF", exact: true })
        .click();
    const pdf = await downloaded;
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    expect(await pdf.failure()).toBeNull();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
        firstNavigation,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
});

test("customer phones are formatted and invalid numbers can be filtered and corrected offline", async ({
    page,
    context,
}) => {
    await signIn(page);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const app = (
                    document.getElementById("app") as any
                ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                return app.syncing;
            }),
        )
        .toBe(false);
    await context.setOffline(true);
    await page
        .getByRole("link", { name: "Customers", exact: true })
        .first()
        .click();
    const group = "Phone review " + Date.now();
    await page
        .getByRole("button", { name: "Create customer", exact: true })
        .first()
        .click();
    await page.getByLabel("Name", { exact: true }).fill(group + " new");
    await page.getByLabel("Phone", { exact: true }).fill("0123");
    await page
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(page.getByRole("alert")).toContainText(
        "Enter a valid phone number",
    );
    await page.getByLabel("Phone", { exact: true }).fill("162726866");
    await page
        .getByLabel("Email", { exact: true })
        .fill("phone-review@example.test");
    await page
        .getByLabel("Address", { exact: true })
        .fill("12 Jalan Kemuning Permai, Shah Alam");
    await page.getByLabel("Notes", { exact: true }).fill("Workshop customer");
    await page
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const rows = page.locator(".customer-table tbody tr");
    const customerRow = (suffix: string) =>
        rows.filter({
            has: page.getByRole("link", {
                name: group + " " + suffix,
                exact: true,
            }),
        });
    await page.getByLabel("Search customers").fill(group);
    await expect(page.locator(".customer-table th")).toHaveText([
        "Customer",
        "Phone",
        "Email",
        "Address",
        "Actions",
    ]);
    await expect(customerRow("new")).toContainText("+60162726866");
    await expect(customerRow("new")).toContainText("phone-review@example.test");
    await expect(customerRow("new")).toContainText(
        "12 Jalan Kemuning Permai, Shah Alam",
    );

    await page.evaluate(async (group) => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        for (const [suffix, phone, normalized_phone] of [
            ["short", "0123", "60123"],
            ["empty", "", ""],
            ["letters", "not a phone", ""],
            ["legacy", "0162726866", "60162726866"],
        ]) {
            const id = crypto.randomUUID();
            await app.vault.put("customer", id, {
                id,
                name: group + " " + suffix,
                phone,
                normalized_phone,
                version: 1,
                created_by: app.user.id,
            });
        }
        await app.refresh();
    }, group);
    await page.getByLabel("Search customers").fill(group);
    await expect(rows).toHaveCount(5);
    await page.getByLabel("Filter phone numbers").selectOption("invalid");
    await expect(rows).toHaveCount(3);
    await expect(customerRow("short")).toContainText("Invalid phone number");
    await page.getByLabel("Search customers").fill(group + " letters");
    await expect(rows).toHaveCount(1);
    await page.getByLabel("Search customers").fill(group + " missing");
    await expect(
        page.getByRole("heading", { name: "No matching customers" }),
    ).toBeVisible();
    await page.getByLabel("Search customers").fill(group);
    await page.getByLabel("Filter phone numbers").selectOption("valid");
    await expect(rows).toHaveCount(2);
    await page.getByLabel("Search customers").fill("0162726866");
    await expect(customerRow("new")).toBeVisible();
    await expect(customerRow("legacy")).toBeVisible();
    await page.getByLabel("Search customers").fill(group);
    await page.getByLabel("Filter phone numbers").selectOption("invalid");
    await page
        .getByRole("button", { name: "Edit " + group + " short", exact: true })
        .click();
    await page.getByLabel("Phone", { exact: true }).fill("0162726866");
    await page
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await page.getByLabel("Filter phone numbers").selectOption("all");
    await expect(rows).toHaveCount(5);
    await expect(customerRow("short")).toContainText("+60162726866");
    await page.screenshot({
        path: "storage/test-artifacts/normal-customers-desktop.png",
        fullPage: true,
    });
    const customer = customerRow("new");
    const customerUrl = await customer
        .getByRole("link", { name: group + " new", exact: true })
        .getAttribute("href");
    await customer.hover();
    await expect(customer).toHaveCSS("background-color", "rgb(240, 246, 242)");
    await customer.locator("summary").click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(customer.locator("details")).toHaveAttribute("open", "");
    await customer.locator(".customer-phone").click();
    await expect(page).toHaveURL(customerUrl!);
    await expect(
        page.getByRole("heading", { name: group + " new", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".customer-details")).toContainText(
        "+60162726866",
    );
    await page
        .getByRole("button", { name: "Edit customer", exact: true })
        .click();
    await page
        .getByLabel("Notes", { exact: true })
        .fill("Updated from customer details offline");
    await page
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".customer-details")).toContainText(
        "Updated from customer details offline",
    );
    await page.locator(".back-link").click();
    await page.getByLabel("Search customers").fill(group + " new");
    const customerLink = page.getByRole("link", {
        name: group + " new",
        exact: true,
    });
    await customerLink.focus();
    await customerLink.press("Enter");
    await expect(page).toHaveURL(customerUrl!);
    await page.locator(".back-link").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Search customers").fill(group + " new");
    await expect(page.locator(".customer-table")).not.toBeVisible();
    const mobileCustomer = page.locator(".customer-mobile-list .customer-row");
    await expect(mobileCustomer).toHaveCount(1);
    await expect(mobileCustomer).toBeVisible();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: "storage/test-artifacts/normal-customers-mobile.png",
    });
    await mobileCustomer.locator(".customer-contact").click();
    await expect(page).toHaveURL(customerUrl!);
});
async function unlock(page: Page) {
    const wasOnline = await page.evaluate(() => navigator.onLine);
    if (wasOnline) await page.context().setOffline(true);
    await expect(
        page
            .locator(".app-layout")
            .or(page.getByRole("button", { name: "Sign in", exact: true })),
    ).toBeVisible();
    if (!(await page.locator(".app-layout").isVisible())) {
        await page.getByLabel("Email", { exact: true }).fill(creds.email);
        await page.getByLabel("Password", { exact: true }).fill(creds.password);
        await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
    }
    await expect(page.locator(".sidebar")).toBeVisible();
    if (wasOnline) {
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        (
                            document.getElementById("app") as any
                        ).__vue_app__.config.globalProperties.$pinia._s.get(
                            "app",
                        ).syncing,
                ),
            )
            .toBe(false);
        await page.context().setOffline(false);
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const app = (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                    return app.online && !app.needsAuth && !app.syncing;
                }),
            )
            .toBe(true);
    }
}
async function item(page: Page, description: string) {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("Item 1 description").fill(description);
    await page.getByLabel("Item 1 quantity").fill("1.005");
    await page.getByLabel("Item 1 unit price").fill("1.00");
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        description,
    );
    await expect(page.getByLabel("Item 1 quantity")).toHaveValue("1.005");
    await expect(page.getByLabel("Item 1 unit price")).toHaveValue("1.00");
    await expect(page.locator(".summary-total strong")).toHaveText("RM 1.01");
}

test("account password unlocks offline data and rejects an incorrect password", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    await page.evaluate(async () => {
        await (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s
            .get("app")
            .lock();
    });
    await page.reload();
    await expect(page.locator(".local-accounts")).toHaveCount(0);
    await expect(page.locator('.auth-card input[type="file"]')).toHaveCount(0);
    await expect(page.locator(".auth-note")).toHaveCount(0);
    await page.getByLabel("Email", { exact: true }).fill(creds.email);
    await page
        .getByLabel("Password", { exact: true })
        .fill("Incorrect password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByRole("alert")).toHaveText("Password is incorrect.");
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
});

for (const path of [
    "/invoices/96e3e4b3-68d6-44b1-8e40-94109596c0bf/edit",
    "/invoices/new",
]) {
    test(
        "sign-in opens the invoice list instead of resuming " + path,
        async ({ page }) => {
            const invoiceRequests: string[] = [];
            page.on("request", (request) => {
                if (/\/api\/invoices\/[^/?]+/.test(request.url())) {
                    invoiceRequests.push(request.url());
                }
            });

            await signIn(page, path);

            await expect(page).toHaveURL("/");
            await expect(page.getByRole("alert")).toHaveCount(0);
            await expect(page.locator(".editor-layout")).toHaveCount(0);
            expect(invoiceRequests).toEqual([]);
            expect(
                await page.evaluate(() =>
                    (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s
                        .get("app")
                        .invoices.some((invoice: any) => invoice.local_only),
                ),
            ).toBe(false);
        },
    );
}

test("offline sign-in opens the invoice list and retains the previous draft", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    const description = "Draft retained after signing in " + Date.now();
    const id = await localDocument(page, description);
    await page.goto("/invoices/" + id + "/edit");
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        description,
    );
    await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.flushDraft();
        await app.lock();
    });
    await page.getByLabel("Email", { exact: true }).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL("/");
    await expect(
        page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.goto("/invoices/" + id + "/edit");
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        description,
    );
});

test("an unavailable draft link returns to the invoice list", async ({
    page,
}) => {
    await signIn(page);
    const id = "96e3e4b3-68d6-44b1-8e40-94109596c0bf";
    await page.route("**/api/invoices/" + id, (route) =>
        route.fulfill({
            status: 404,
            json: {
                message:
                    "No query results for model [App\\Models\\Invoice] " + id,
            },
        }),
    );
    const response = page.waitForResponse((response) =>
        response.url().endsWith("/api/invoices/" + id),
    );

    await page.goto("/invoices/" + id + "/edit");

    expect((await response).status()).toBe(404);
    await expect(page).toHaveURL("/");
    await expect(
        page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
});

test("refresh keeps the current account and saved invoice open online and offline", async ({
    page,
    context,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signIn(page);
    const description = "Invoice retained after refresh " + Date.now();
    const id = await localDocument(page, description);
    const device = await page.evaluate(
        () =>
            (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("app").vault
                .profile.device_id,
    );

    await page.goto("/invoices/" + id + "/edit");
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        description,
    );
    await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
    expect((await page.request.get("/api/me")).status()).toBe(200);
    await page.reload();
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        description,
    );

    await context.setOffline(true);
    await page.getByLabel("Item 1 description").fill(description + " offline");
    await expect(
        page.getByText("Saved on this device", { exact: true }),
    ).toBeVisible();
    await page.reload();

    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        description + " offline",
    );
    await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".connection")).toContainText("Offline");
    expect(
        await page.evaluate(
            () =>
                (
                    document.getElementById("app") as any
                ).__vue_app__.config.globalProperties.$pinia._s.get("app").vault
                    .profile.device_id,
        ),
    ).toBe(device);
    expect(errors).toEqual([]);
});

test("a previous device password is requested once and saved drafts survive migration", async ({
    page,
    context,
}) => {
    await signIn(page);
    const id = await localDocument(page, "Draft kept after password migration");
    await page.goto("/invoices/" + id + "/edit");
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        "Draft kept after password migration",
    );
    await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.vault.useAccountPassword("Previous device phrase 2026!");
        await app.lock();
    });
    await page.getByLabel("Email", { exact: true }).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Update saved data access" }),
    ).toBeVisible();
    await page
        .getByLabel("Previous password or passphrase")
        .fill("Incorrect password");
    await page.getByRole("button", { name: "Use account password" }).click();
    await expect(page.getByRole("alert")).toHaveText("Password is incorrect.");
    await page
        .getByLabel("Previous password or passphrase")
        .fill("Previous device phrase 2026!");
    await page.getByRole("button", { name: "Use account password" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page).toHaveURL("/");

    await context.setOffline(true);
    await page.goto("/invoices/" + id + "/edit");
    await unlock(page);
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        "Draft kept after password migration",
    );
});

test("online sale, staff, snapshots, real offline reopen, PDF, cancellation, ordered sync and mobile", async ({
    page,
    context,
}) => {
    const staffName = "Browser Cashier " + Date.now(),
        staffUpdated = staffName + " Updated";
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await signIn(page);
    // Administrator staff create, update, reset and deactivate through real forms.
    await page.getByRole("link", { name: "Staff", exact: true }).click();
    await page.getByRole("button", { name: "Add staff", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill(staffName);
    await page
        .getByLabel("Email", { exact: true })
        .fill("staff-" + Date.now() + "@example.test");
    await page
        .getByLabel(/^Password/)
        .fill("Random test " + Date.now() + " xY!");
    await page.getByRole("button", { name: "Save staff" }).click();
    await expect(page.getByRole("heading", { name: staffName })).toBeVisible();
    await page
        .getByRole("button", { name: "Edit " + staffName, exact: true })
        .click();
    await page.getByLabel("Name", { exact: true }).fill(staffUpdated);
    await page.getByLabel("Account status").selectOption({ label: "Inactive" });
    await page
        .getByLabel("Reset password")
        .fill("Reset test " + Date.now() + " xZ!");
    await page.getByRole("button", { name: "Save staff" }).click();
    await expect(
        page.getByRole("heading", { name: staffUpdated }),
    ).toContainText("Inactive");
    await page
        .getByRole("link", { name: "Invoices", exact: true })
        .first()
        .click();
    await page
        .getByRole("link", { name: "New Invoice", exact: true })
        .first()
        .click();
    await page
        .getByLabel("Find customer by mobile number")
        .fill("Offline Aisha " + Date.now());
    await page.getByRole("button", { name: /Create customer/ }).click();
    await page.getByLabel("Phone", { exact: true }).fill("012-777 1234");
    await page
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await item(page, "Window tint installation");
    await expect(
        page.getByText("Saved on this device", { exact: true }),
    ).toBeVisible();
    const draftUrl = page.url();
    await page.reload();
    await unlock(page);
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        "Window tint installation",
    );
    expect(page.url()).toBe(draftUrl);
    await page
        .getByRole("button", { name: "Issue Invoice", exact: true })
        .click();
    await expect(page.locator("h1").first()).toHaveText(/^\d{5,}$/);
    const number = await page.locator("h1").first().textContent();
    await expect(page.locator(".detail-strip")).toContainText("Synced");
    const pdfEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    await (await pdfEvent).saveAs("storage/test-artifacts/invoice.pdf");
    await page.screenshot({
        path: "storage/test-artifacts/invoice-desktop.png",
        fullPage: true,
    });
    // Offline network controls, reopen, create customer and issue using a reserved number.
    await context.setOffline(true);
    await page.reload();
    await unlock(page);
    await expect(page.locator(".connection")).toContainText("Offline");
    await page
        .getByRole("link", { name: "Invoices", exact: true })
        .first()
        .click();
    await page
        .getByRole("link", { name: "New Invoice", exact: true })
        .first()
        .click();
    await page
        .getByLabel("Find customer by mobile number")
        .fill("Created entirely offline");
    await page.getByRole("button", { name: /Create customer/ }).click();
    await page.getByLabel("Phone", { exact: true }).fill("+60 11 9876 5432");
    await page
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await item(page, "Offline accessories");
    await page
        .getByRole("button", { name: "Issue Invoice", exact: true })
        .click();
    await expect(page.locator("h1").first()).toHaveText(/^\d{5,}$/);
    const offlineNumber = await page.locator("h1").first().textContent();
    expect(offlineNumber).not.toBe(number);
    const offlinePdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    await (await offlinePdf).saveAs("storage/test-artifacts/offline.pdf");
    await page.evaluate(() => {
        window.print = () => {};
    });
    await page.getByRole("button", { name: "Print", exact: true }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".invoice-paper")).toBeVisible();
    await page.pdf({
        path: "storage/test-artifacts/browser-print.pdf",
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
    });
    await page.emulateMedia({ media: "screen" });
    await page
        .getByRole("button", { name: "Cancel invoice", exact: true })
        .click();
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(page.locator(".cancel-banner")).toContainText(
        "No reason supplied",
    );
    await page.reload();
    await unlock(page);
    await expect(page.locator(".document-stamp")).toHaveText("CANCELLED");
    await expect(page.locator("h1").first()).toHaveText(offlineNumber!);
    await page
        .getByRole("link", { name: "Sync status", exact: false })
        .first()
        .click();
    await expect(page.locator(".sync-overview")).toContainText("3");
    await context.setOffline(false);
    await page
        .getByRole("button", { name: "Sync now", exact: true })
        .last()
        .click();
    await expect(
        page.getByRole("heading", { name: "All caught up" }),
    ).toBeVisible();
    await page
        .getByRole("link", { name: "Invoices", exact: true })
        .first()
        .click();
    await expect(page.locator(".invoice-table")).toContainText(offlineNumber!);
    await expect(page.locator(".invoice-table")).toContainText(/cancelled/i);
    // Session expiry retains unsynced draft and customer operations.
    await context.setOffline(true);
    await page
        .getByRole("link", { name: "Customers", exact: true })
        .first()
        .click();
    await page
        .getByRole("button", { name: "Create customer", exact: true })
        .first()
        .click();
    await page
        .getByLabel("Name", { exact: true })
        .fill("Session-preserved customer");
    await page.getByLabel("Phone", { exact: true }).fill("0191234567");
    await page
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expireSession(page, context);
    await context.setOffline(false);
    await page
        .getByRole("link", { name: "Sync status", exact: false })
        .first()
        .click();
    await page
        .getByRole("button", { name: "Sync now", exact: true })
        .last()
        .click();
    await expect(page.locator(".banner").first()).toContainText(
        "authentication",
    );
    await expect(page.locator(".operation-row")).toContainText(
        "Session-preserved customer",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: "New", exact: true }).click();
    await page.getByLabel("Find customer by mobile number").fill("0191234567");
    await page
        .getByRole("button", { name: /Session-preserved customer/ })
        .click();
    await item(page, "Mobile card entry");
    await page.screenshot({
        path: "storage/test-artifacts/mobile-entry.png",
        fullPage: true,
    });
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
});

async function expireSession(page: Page, context: BrowserContext) {
    await expect
        .poll(() =>
            page.evaluate(() => {
                const a = (
                    document.getElementById("app") as any
                ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                return a.syncing;
            }),
        )
        .toBe(false);
    const csrf = await page.request.get("/api/csrf");
    const token = (await csrf.json()).token;
    const response = await page.request.post("/api/logout", {
        data: {},
        headers: { "X-CSRF-TOKEN": token, Accept: "application/json" },
    });
    expect(response.status()).toBe(200);
    await context.clearCookies();
}

async function localDocument(page: Page, description: string, count = 1) {
    return page.evaluate(
        async ({ description, count }) => {
            const app = (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("app");
            const customer =
                app.customers[0] ??
                (await app.saveCustomer({
                    name: "PDF customer",
                    phone: "012345678",
                }));
            const items = Array.from({ length: count }, (_, i) => ({
                id: crypto.randomUUID(),
                description:
                    count > 1
                        ? `${description} ${i + 1} — Professional fitting, wiring checks and complete installation. Long descriptions wrap cleanly on every page.`
                        : description,
                quantity: "1.005",
                unit: "PCS",
                unit_price: "1.00",
                amount_cents: 101,
            }));
            const invoice = {
                id: crypto.randomUUID(),
                status: "draft",
                invoice_number: null,
                invoice_date: "2026-10-17",
                customer_id: customer.id,
                customer_snapshot: {
                    name: customer.name,
                    phone: customer.phone,
                    address: customer.address ?? "",
                    email: customer.email ?? "",
                },
                company_snapshot: JSON.parse(JSON.stringify(app.company)),
                vehicle_registration: "TEST 1234",
                car_model: "Test vehicle",
                notes:
                    count > 1 ? "Installation and acceptance. ".repeat(45) : "",
                items,
                total_cents: 101 * count,
                subtotal_cents: 101 * count,
                total_quantity: (1.005 * count).toFixed(3),
                version: 0,
                created_by: app.user.id,
                creator: { id: app.user.id, name: app.user.name },
                device_id: app.vault.profile.device_id,
                created_at: new Date().toISOString(),
                local_only: true,
            };
            const saved = await app.persistDraft(invoice);
            return saved.id;
        },
        { description, count },
    );
}

test("invoice PDFs open native sharing and handle cancellation and retry", async ({
    page,
    context,
}) => {
    await page.addInitScript(() => {
        const state = window as any;
        state.shareCalls = [];
        state.shareOutcome = "success";
        Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: (data: ShareData) =>
                data.files?.every((file) => file.type === "application/pdf") ??
                false,
        });
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async (data: ShareData) => {
                const activated = navigator.userActivation.isActive;
                state.shareCalls.push({
                    activated,
                    hasUrl: "url" in data,
                    files: await Promise.all(
                        (data.files ?? []).map(async (file) => ({
                            name: file.name,
                            type: file.type,
                            header: await file.slice(0, 5).text(),
                        })),
                    ),
                });
                if (state.shareOutcome === "cancel")
                    throw new DOMException("Cancelled", "AbortError");
                if (state.shareOutcome === "error")
                    throw new DOMException("Failed", "DataError");
            },
        });
    });
    await signIn(page);
    await context.setOffline(true);
    const id = await localDocument(page, "Invoice shared from phone");
    const number = await page.evaluate(async (id) => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        return (await app.issue(await app.vault.get("invoice", id)))
            .invoice_number;
    }, id);
    await page.goto("/invoices/" + id);
    await page.setViewportSize({ width: 390, height: 844 });
    const share = page.getByRole("button", {
        name: "Share to WhatsApp",
        exact: true,
    });
    await expect(share).toBeEnabled();
    await share.click();
    await expect
        .poll(() => page.evaluate(() => (window as any).shareCalls.length))
        .toBe(1);
    expect(await page.evaluate(() => (window as any).shareCalls[0])).toEqual({
        activated: true,
        hasUrl: false,
        files: [
            { name: number + ".pdf", type: "application/pdf", header: "%PDF-" },
        ],
    });
    await page.evaluate(() => ((window as any).shareOutcome = "cancel"));
    await share.click();
    await expect(share).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.evaluate(() => ((window as any).shareOutcome = "error"));
    await share.click();
    await expect(page.getByRole("alert")).toContainText(
        "Could not open sharing",
    );
    await page.evaluate(() => ((window as any).shareOutcome = "success"));
    await share.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(share).toBeEnabled();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: "storage/test-artifacts/whatsapp-share-mobile.png",
        fullPage: true,
    });
});

for (const support of ["missing", "unsupported files"]) {
    test(
        "desktop WhatsApp sharing offers the PDF and customer chat when sharing is " +
            support,
        async ({ page, context }) => {
            await page.addInitScript((support) => {
                Object.defineProperty(navigator, "canShare", {
                    configurable: true,
                    value: support === "missing" ? undefined : () => false,
                });
                Object.defineProperty(navigator, "share", {
                    configurable: true,
                    value:
                        support === "missing"
                            ? undefined
                            : () => {
                                  throw new Error(
                                      "Native sharing should not be used",
                                  );
                              },
                });
            }, support);
            await signIn(page);
            await context.setOffline(true);
            const id = await localDocument(page, "Desktop WhatsApp invoice");
            await page.goto("/invoices/" + id);
            const share = page.getByRole("button", {
                name: "Share to WhatsApp",
                exact: true,
            });
            await expect(share).toBeEnabled();
            await share.click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toContainText(
                "Download the PDF, open WhatsApp",
            );
            const chatUrl = new URL(
                (await dialog
                    .getByRole("link", { name: "Open WhatsApp", exact: true })
                    .getAttribute("href"))!,
            );
            expect(chatUrl.origin).toBe("https://wa.me");
            expect(chatUrl.searchParams.get("text")).toContain("draft invoice");
            expect(chatUrl.href).not.toContain("127.0.0.1");
            const download = page.waitForEvent("download");
            await dialog
                .getByRole("button", { name: "Download PDF", exact: true })
                .click();
            expect((await download).suggestedFilename()).toBe(
                "Sinlink-draft.pdf",
            );
            await expect(page.getByRole("alert")).toHaveCount(0);
            await page.screenshot({
                path: "storage/test-artifacts/whatsapp-share-desktop.png",
            });
        },
    );
}

test("invoice car details appear inside the customer online and offline", async ({
    page,
    context,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signIn(page);
    await context.setOffline(true);
    const stamp = Date.now();
    const customerName = "Automatic car customer " + stamp;
    const registration = "AUTO " + stamp;
    await page
        .locator(".page-heading")
        .getByRole("link", { name: "New Invoice", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Create customer", exact: true })
        .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(customerName);
    await dialog.getByLabel("Phone", { exact: true }).fill("0162726866");
    await dialog
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(dialog).toHaveCount(0);
    await expect(
        page.getByRole("heading", { name: customerName, exact: true }),
    ).toBeVisible();
    await page
        .getByLabel("Registration number", { exact: true })
        .fill(registration);
    await page.getByLabel("Car model", { exact: true }).fill("Perodua Myvi");
    await page.getByLabel("Item 1 description").fill("Car saved with invoice");
    await page.getByLabel("Item 1 unit price").fill("10.00");
    expect(errors).toEqual([]);
    await expect(
        page.getByLabel("Registration number", { exact: true }),
    ).toHaveValue(registration);
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        "Car saved with invoice",
    );
    await page.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
    await page
        .getByRole("link", { name: "Customers", exact: true })
        .first()
        .click();
    await page.getByLabel("Search customers").fill(customerName);
    await page.locator(".customer-table .customer-name").click();
    const customerId = new URL(page.url()).pathname.split("/").pop()!;
    const cars = page.getByRole("region", {
        name: "Customer cars",
        exact: true,
    });
    const row = cars.locator(".vehicle-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(registration);
    await expect(row).toContainText("Perodua Myvi");
    await row.hover();
    await expect(row).toHaveCSS("background-color", "rgb(240, 246, 242)");
    await row.locator(".customer-info").click();
    await expect(dialog).toContainText(customerName);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await cars.getByRole("button", { name: "Add car", exact: true }).click();
    await expect(dialog.getByLabel(new RegExp(customerName))).toBeChecked();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await cars.getByLabel("Search customer cars").fill("missing car");
    await expect(row).toHaveCount(0);
    await cars.getByLabel("Search customer cars").fill("");
    await context.setOffline(false);
    await page.evaluate(async () => {
        await (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s
            .get("app")
            .sync();
    });
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s
                        .get("app")
                        .operations.filter(
                            (operation: any) => operation.state !== "archived",
                        ).length,
            ),
        )
        .toBe(0);
    const canonicalCar = await page.evaluate(
        (registration) =>
            (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s
                .get("app")
                .vehicles.find(
                    (vehicle: any) => vehicle.registration === registration,
                ),
        registration,
    );
    const serverCar = await (
        await page.request.get("/api/vehicles/" + canonicalCar.id)
    ).json();
    expect(serverCar.customer_ids).toContain(customerId);
    expect(serverCar.registration).toBe(registration);
    await context.setOffline(true);
    await page.reload();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(registration);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await cars.screenshot({
        path: "storage/test-artifacts/customer-cars-mobile.png",
    });
});

test("offline multipage A4 and A5 PDFs, draft marking and print layout", async ({
    page,
    context,
}) => {
    await signIn(page);
    // Keep existing company fields; choose paper through the real administrator form.
    await page
        .getByRole("link", { name: "Settings", exact: true })
        .first()
        .click();
    await page.getByLabel(/Paper size/).selectOption("A4");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".success")).toBeVisible();
    await context.setOffline(true);
    const id = await localDocument(page, "Long invoice line", 84);
    await page.goto("/invoices/" + id);
    await unlock(page);
    await expect(page.locator(".document-stamp")).toHaveText(
        Array(await page.locator(".invoice-sheet").count()).fill("DRAFT"),
    );
    const pdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    await (await pdf).saveAs("storage/test-artifacts/long-a4.pdf");
    await page.evaluate(() => {
        window.print = () => {};
    });
    await page.getByRole("button", { name: "Print", exact: true }).click();
    await page.pdf({
        path: "storage/test-artifacts/long-print.pdf",
        preferCSSPageSize: true,
        printBackground: true,
    });
    await context.setOffline(false);
    await page
        .getByRole("link", { name: "Settings", exact: true })
        .first()
        .click();
    await page.getByLabel(/Paper size/).selectOption("A5");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".success")).toBeVisible();
    await context.setOffline(true);
    const a5 = await localDocument(page, "A5 long invoice line", 40);
    await page.goto("/invoices/" + a5);
    await unlock(page);
    const a5Pdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    await (await a5Pdf).saveAs("storage/test-artifacts/long-a5.pdf");
    await context.setOffline(false);
    await page
        .getByRole("link", { name: "Settings", exact: true })
        .first()
        .click();
    await page.getByLabel(/Paper size/).selectOption("A4");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".success")).toBeVisible();
});

test("two browser tabs issue distinct numbers and sync one event per invoice", async ({
    page,
    context,
}) => {
    await signIn(page);
    const second = await context.newPage();
    await second.goto("/");
    await unlock(second);
    await context.setOffline(true);
    const [a, b] = await Promise.all([
        localDocument(page, "Parallel A " + Date.now()),
        localDocument(second, "Parallel B " + Date.now()),
    ]);
    const issueInTab = (tab: Page, id: string) =>
        tab.evaluate(async (id) => {
            const app = (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("app");
            const draft = await app.vault.get("invoice", id);
            return await app.issue(draft);
        }, id);
    const [one, two] = await Promise.all([
        issueInTab(page, a),
        issueInTab(second, b),
    ]);
    expect(one.invoice_number).not.toBe(two.invoice_number);
    await context.setOffline(false);
    const synchronize = (tab: Page) =>
        tab.evaluate(async () => {
            const app = (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("app");
            await app.sync();
        });
    await Promise.all([synchronize(page), synchronize(second)]);
    await expect
        .poll(async () =>
            page.evaluate(() => {
                const app = (
                    document.getElementById("app") as any
                ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                return app.operations.filter((o: any) => o.state !== "archived")
                    .length;
            }),
        )
        .toBe(0);
    for (const id of [a, b]) {
        const result = await page.request.get("/api/invoices/" + id);
        expect(result.status()).toBe(200);
        const invoice = await result.json();
        expect(
            invoice.events.filter((e: any) => e.type === "issued"),
        ).toHaveLength(1);
    }
    await second.close();
});

test("waiting service worker update preserves draft and pending outbox", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    const id = await localDocument(page, "Survives an app update");
    // Expire online authentication while preserving the encrypted outbox.
    await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.saveCustomer({
            name: "Update queued customer",
            phone: "0182345678",
        });
    });
    await expireSession(page, context);
    await context.setOffline(false);
    const before = await page.evaluate(() => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        return app.operations.map((o: any) => o.id).sort();
    });
    const swFile = "public/app/sw.js",
        original = fs.readFileSync(swFile, "utf8");
    try {
        fs.writeFileSync(
            swFile,
            original + "\n/* update verification " + Date.now() + " */\n",
        );
        await page.evaluate(async () => {
            const registration =
                await navigator.serviceWorker.getRegistration();
            await registration!.update();
        });
        await expect(
            page.getByRole("button", { name: "Update safely" }),
        ).toBeVisible();
        await context.setOffline(true);
        await page.getByRole("button", { name: "Update safely" }).click();
        await unlock(page);
        const after = await page.evaluate(() => {
            const app = (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("app");
            return app.operations.map((o: any) => o.id).sort();
        });
        expect(after).toEqual(before);
        await page.goto("/invoices/" + id);
        await unlock(page);
        await expect(page.locator(".invoice-paper")).toContainText(
            "Survives an app update",
        );
    } finally {
        fs.writeFileSync(swFile, original);
    }
});

test("customer conflict keeps the local proposal and explicitly accepts the server record", async ({
    page,
    context,
}) => {
    await signIn(page);
    const stamp = Date.now();
    const data = await page.evaluate(async (stamp) => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        const customer = await app.saveCustomer({
            name: "Original " + stamp,
            phone: "0131234567",
        });
        return {
            id: customer.id,
            actor: app.user.id,
            device: app.vault.profile.device_id,
        };
    }, stamp);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const app = (
                    document.getElementById("app") as any
                ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                return app.operations.length;
            }),
        )
        .toBe(0);
    await context.setOffline(true);
    await page.evaluate(
        async ({ id, stamp }) => {
            const app = (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("app");
            const customer = await app.vault.get("customer", id);
            await app.saveCustomer({
                ...customer,
                name: "Local proposal " + stamp,
            });
        },
        { id: data.id, stamp },
    );
    const csrf = await page.request.get("/api/csrf");
    const token = (await csrf.json()).token;
    const response = await page.request.post("/api/sync/push", {
        headers: { "X-CSRF-TOKEN": token, Accept: "application/json" },
        data: {
            operations: [
                {
                    id: crypto.randomUUID(),
                    device_id: data.device,
                    actor_id: data.actor,
                    entity_id: data.id,
                    type: "customer.save",
                    payload: {
                        name: "Server edited " + stamp,
                        phone: "0131234567",
                    },
                    expected_version: 1,
                    action_at: new Date().toISOString(),
                },
            ],
        },
    });
    expect((await response.json()).results[0].ok).toBe(true);
    await context.setOffline(false);
    await page
        .getByRole("link", { name: "Sync status", exact: false })
        .first()
        .click();
    await page
        .getByRole("button", { name: "Sync now", exact: true })
        .last()
        .click();
    await expect(page.locator(".operation-row")).toContainText("conflict");
    await page
        .getByRole("button", { name: "Review", exact: true })
        .first()
        .click();
    await expect(page.getByRole("dialog")).toContainText(
        "Customer changed elsewhere",
    );
    await page
        .getByRole("button", { name: "Archive proposal & use server record" })
        .click();
    await page
        .getByRole("button", { name: "Archive proposal", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
        .getByRole("link", { name: "Customers", exact: true })
        .first()
        .click();
    await page.getByLabel("Search customers").fill("Server edited " + stamp);
    await expect(
        page.getByRole("heading", { name: "Server edited " + stamp }),
    ).toBeVisible();
    const archived = await page.evaluate((id) => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        return app.operations.find((o: any) => o.entity_id === id);
    }, data.id);
    expect(archived.state).toBe("archived");
    expect(archived.payload.name).toBe("Local proposal " + stamp);
});

test("a lost response after server commit retries the same operation without duplicating the invoice", async ({
    page,
}) => {
    await signIn(page);
    const id = await localDocument(page, "Receipt replay " + Date.now());
    let dropped = false,
        operationId = "",
        replayId = "";
    await page.route("**/api/sync/push", async (route) => {
        const op = route.request().postDataJSON().operations[0];
        const response = await route.fetch();
        if (op.type === "invoice.issue" && !dropped) {
            operationId = op.id;
            dropped = true;
            await route.abort("failed");
        } else {
            if (op.type === "invoice.issue") replayId = op.id;
            await route.fulfill({ response });
        }
    });
    await page.evaluate(async (id) => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.issue(await app.vault.get("invoice", id));
    }, id);
    await expect.poll(() => dropped).toBe(true);
    const committed = await page.request.get("/api/invoices/" + id);
    expect(committed.status()).toBe(200);
    const number = (await committed.json()).invoice_number;
    await page
        .getByRole("link", { name: "Sync status", exact: false })
        .first()
        .click();
    await expect(page.locator(".operation-row")).toContainText(
        "invoice · issue",
    );
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "All caught up" }),
    ).toBeVisible();
    expect(replayId).toBe(operationId);
    const result = await (await page.request.get("/api/invoices/" + id)).json();
    expect(result.invoice_number).toBe(number);
    expect(result.events.filter((e: any) => e.type === "issued")).toHaveLength(
        1,
    );
    await page.unroute("**/api/sync/push");
});

test("password visibility can be toggled without submitting or changing the password", async ({
    page,
}) => {
    await page.goto("/");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("A visible test password!");
    await expect(password).toHaveAttribute("type", "password");
    await page
        .getByRole("button", { name: "Show password", exact: true })
        .click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("A visible test password!");
    await page
        .getByRole("button", { name: "Hide password", exact: true })
        .click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("A visible test password!");
    await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
});

test("invoice customer suggestions only show matching phone numbers offline", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    const stamp = Date.now();
    await page.evaluate(async (stamp) => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.saveCustomer({
            name: "Phone match A " + stamp,
            phone: "0179876501",
        });
        await app.saveCustomer({
            name: "Phone match B " + stamp,
            phone: "+60179876502",
        });
        await app.saveCustomer({
            name: "01798765 unrelated " + stamp,
            phone: "0189876503",
        });
    }, stamp);
    await page.getByRole("link", { name: "New Invoice", exact: true }).click();
    const phone = page.getByLabel("Find customer by mobile number");
    const suggestions = page.locator(".customer-matches button");
    await expect(suggestions).toHaveCount(0);
    await phone.fill("01");
    await expect(suggestions).toHaveCount(0);
    await phone.fill("01798765");
    await expect(suggestions).toHaveCount(2);
    await expect(page.locator(".customer-matches")).not.toContainText(
        "unrelated",
    );
    await phone.fill("+60 17-9876-502");
    await expect(suggestions).toHaveCount(1);
    await suggestions.first().click();
    await expect(page.locator(".selected-customer")).toContainText(
        "Phone match B " + stamp,
    );
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await phone.fill("0195432109");
    await expect(suggestions).toHaveCount(0);
    await page.getByRole("button", { name: /Create customer/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue(
        "0195432109",
    );
    await dialog
        .getByLabel("Name", { exact: true })
        .fill("New offline phone " + stamp);
    await dialog
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(page.locator(".selected-customer")).toContainText(
        "New offline phone " + stamp,
    );
});

test("record lists paginate online and offline and reset pages after searching", async ({
    page,
    context,
}) => {
    await signIn(page);
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s.get("app")
                        .syncing,
            ),
        )
        .toBe(false);
    await context.setOffline(true);
    const prefix = "Pagination " + Date.now();
    const fixtures = await page.evaluate(async (prefix) => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        const invoices: any[] = [];
        const staff: any[] = [];
        for (let index = 1; index <= 26; index++) {
            const ordinal = String(index).padStart(2, "0");
            const customer = {
                id: crypto.randomUUID(),
                name: prefix + " customer " + ordinal,
                phone: "+6018" + String(1000000 + index),
                version: 1,
                created_by: app.user.id,
            };
            const registration = prefix.toUpperCase() + " CAR " + ordinal;
            await app.vault.put("customer", customer.id, customer);
            const vehicleId = crypto.randomUUID();
            await app.vault.put("vehicle", vehicleId, {
                id: vehicleId,
                registration,
                normalized_registration: registration.replace(/[^A-Z0-9]/g, ""),
                car_model: "MYVI",
                customer_ids: [customer.id],
                version: 1,
                created_by: app.user.id,
            });
            const invoice = {
                id: crypto.randomUUID(),
                invoice_number: String(90000 + index),
                status: "issued",
                invoice_date: "2026-10-17",
                customer_id: customer.id,
                customer_snapshot: customer,
                company_snapshot: JSON.parse(JSON.stringify(app.company)),
                vehicle_registration: registration,
                car_model: "MYVI",
                notes: "",
                items: [],
                total_cents: 100,
                subtotal_cents: 100,
                total_quantity: "1.000",
                version: 1,
                created_by: app.user.id,
                device_id: app.vault.profile.device_id,
                created_at: new Date(Date.now() + index).toISOString(),
                local_only: false,
                local_dirty: false,
            };
            await app.vault.put("invoice", invoice.id, invoice);
            invoices.push(invoice);
            staff.push({
                id: 100000 + index,
                name: prefix + " staff " + ordinal,
                email: "pagination-" + index + "@example.test",
                role: "staff",
                active: true,
            });
        }
        await app.refresh();
        return { invoices, staff };
    }, prefix);
    async function checkPagination(
        label: string,
        rowSelector: string,
        server = false,
    ) {
        const pagination = page.getByRole("navigation", {
            name: label + " pagination",
        });
        const selector = pagination.locator("..").getByRole("combobox", {
            name: "Records per page",
        });
        const rows = page.locator(rowSelector);
        await expect(selector.locator("option")).toHaveText([
            "5",
            "10",
            "20",
            "50",
            "100",
        ]);
        await expect(selector).toHaveValue("5");
        await expect(rows).toHaveCount(5);
        await expect(pagination).toContainText("Showing 1 to 5 of 26 results");
        async function choosePageSize(size: number) {
            const response = server
                ? page.waitForResponse((response) => {
                      const url = new URL(response.url());
                      return (
                          url.pathname === "/api/invoices" &&
                          url.searchParams.get("per_page") === String(size)
                      );
                  })
                : undefined;
            await selector.selectOption(String(size));
            if (response) await response;
            await expect(rows).toHaveCount(Math.min(size, 26));
            await expect(pagination).toContainText(
                "1 of " + Math.ceil(26 / size),
            );
        }
        await expect(pagination).toContainText("1 of 6");
        await expect(
            pagination.getByRole("button", { name: "First page", exact: true }),
        ).toBeDisabled();
        await expect(
            pagination.getByRole("button", {
                name: "Previous page",
                exact: true,
            }),
        ).toBeDisabled();
        await pagination
            .getByRole("button", { name: "Last page", exact: true })
            .click();
        await expect(rows).toHaveCount(1);
        await expect(pagination).toContainText(
            "Showing 26 to 26 of 26 results",
        );
        await expect(pagination).toContainText("6 of 6");
        await expect(
            pagination.getByRole("button", { name: "Next page", exact: true }),
        ).toBeDisabled();
        await expect(
            pagination.getByRole("button", { name: "Last page", exact: true }),
        ).toBeDisabled();
        await pagination
            .getByRole("button", { name: "First page", exact: true })
            .click();
        await expect(pagination).toContainText("1 of 6");
        await expect(rows).toHaveCount(5);
        await pagination
            .getByRole("button", { name: "Next page", exact: true })
            .click();
        await expect(pagination).toContainText("2 of 6");
        await pagination
            .getByRole("button", { name: "Previous page", exact: true })
            .click();
        await expect(pagination).toContainText("1 of 6");
        await pagination
            .getByRole("button", { name: "Last page", exact: true })
            .click();
        await expect(pagination).toContainText("6 of 6");
        for (const size of [10, 20, 50, 100, 5]) await choosePageSize(size);
        return pagination;
    }
    for (const screen of [
        {
            name: "Customers",
            search: "Search customers",
            rows: ".customer-table tbody tr",
            exactQuery: prefix + " customer 01",
        },
        {
            name: "Cars",
            search: "Search cars",
            rows: ".vehicle-row",
            exactQuery: prefix + " CAR 01",
        },
        {
            name: "Invoices",
            search: "Search invoices",
            rows: ".invoice-table tbody tr",
            exactQuery: prefix + " customer 01",
        },
    ]) {
        await page
            .getByRole("link", { name: screen.name, exact: true })
            .first()
            .click();
        await page.getByLabel(screen.search).fill(prefix);
        const pagination = await checkPagination(screen.name, screen.rows);
        await pagination
            .getByRole("button", { name: "Next page", exact: true })
            .click();
        await expect(page.locator(screen.rows)).toHaveCount(5);
        await expect(pagination).toContainText("Showing 6 to 10 of 26 results");
        await page.getByLabel(screen.search).fill(screen.exactQuery);
        await expect(pagination).toContainText("1 of 1");
        await expect(page.locator(screen.rows)).toHaveCount(1);
        await expect(pagination).toContainText("Showing 1 to 1 of 1 results");
        if (screen.name === "Cars") {
            const row = page.locator(screen.rows);
            await row.hover();
            await expect(row).toHaveCSS(
                "background-color",
                "rgb(240, 246, 242)",
            );
            await row.locator(".customer-info").click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toContainText("MYVI");
            await expect(dialog).toContainText(prefix + " customer 01");
            await expect(dialog.getByRole("textbox")).toHaveCount(0);
            await dialog
                .getByRole("button", { name: "Edit car", exact: true })
                .click();
            await expect(
                dialog.getByLabel("Registration number", { exact: true }),
            ).toHaveValue(screen.exactQuery.toUpperCase());
            await dialog
                .getByRole("button", { name: "Cancel", exact: true })
                .click();
            await expect(dialog).toHaveCount(0);
            await row.getByRole("button", { name: /^Edit car / }).click();
            await expect(dialog).toHaveCount(1);
            await expect(
                dialog.getByLabel("Car model", { exact: true }),
            ).toHaveValue("MYVI");
            await dialog
                .getByRole("button", { name: "Cancel", exact: true })
                .click();
            await expect(dialog).toHaveCount(0);
            await page.setViewportSize({ width: 390, height: 844 });
            await row.getByRole("button", { name: /^View / }).focus();
            await page.keyboard.press("Enter");
            await expect(dialog).toContainText(prefix + " customer 01");
            await dialog
                .getByRole("button", { name: "Close", exact: true })
                .click();
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        window.innerWidth,
                ),
            ).toBe(true);
            await page.setViewportSize({ width: 1440, height: 1000 });
        }
        await page.getByLabel(screen.search).fill("No pagination matches");
        await expect(pagination).toContainText("Showing 0 to 0 of 0 results");
        await expect(
            pagination.getByRole("button", { name: "Next page", exact: true }),
        ).toBeDisabled();
    }
    await page.getByLabel("Search invoices").fill(prefix);
    const invoiceRow = page.locator(".invoice-table tbody tr").first();
    const invoiceUrl = await invoiceRow
        .locator(".invoice-number")
        .getAttribute("href");
    await invoiceRow.hover();
    await expect(invoiceRow).toHaveCSS(
        "background-color",
        "rgb(240, 246, 242)",
    );
    await invoiceRow.locator("td").nth(2).click();
    await expect(page).toHaveURL(invoiceUrl!);
    await expect(page.locator(".document-preview")).toBeVisible();
    await page.locator(".back-link").click();
    await page.getByLabel("Search invoices").fill(prefix);
    const invoiceLink = page
        .locator(".invoice-table tbody tr .invoice-number")
        .first();
    await invoiceLink.focus();
    await invoiceLink.press("Enter");
    await expect(page).toHaveURL(invoiceUrl!);
    await page.locator(".back-link").click();
    await page.getByLabel("Search invoices").fill(prefix);
    await page.screenshot({
        path: "storage/test-artifacts/listing-pagination-desktop.png",
        fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePagination = page.getByRole("navigation", {
        name: "Invoices pagination",
    });
    await mobilePagination
        .locator("..")
        .getByRole("combobox", { name: "Records per page" })
        .selectOption("5");
    await expect(page.locator(".invoice-card")).toHaveCount(5);
    await mobilePagination
        .getByRole("button", { name: "Last page", exact: true })
        .click();
    await expect(page.locator(".invoice-card")).toHaveCount(1);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: "storage/test-artifacts/listing-pagination-mobile.png",
        fullPage: true,
    });
    const invoiceCard = page.locator(".invoice-card").first();
    const mobileInvoiceUrl = await invoiceCard.getAttribute("href");
    await invoiceCard.hover();
    await expect(invoiceCard).toHaveCSS(
        "background-color",
        "rgb(240, 246, 242)",
    );
    await invoiceCard.click();
    await expect(page).toHaveURL(mobileInvoiceUrl!);
    await page.locator(".back-link").click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        app.operations = Array.from({ length: 26 }, (_, index) => ({
            id: crypto.randomUUID(),
            type: "customer.save",
            payload: { name: "Queued " + index },
            entity_id: crypto.randomUUID(),
            state: "pending",
            attempts: 0,
            action_at: new Date().toISOString(),
        }));
    });
    await page
        .getByRole("link", { name: "Sync status", exact: false })
        .first()
        .click();
    await checkPagination("Local operations", ".operation-row");
    await page.evaluate(() => {
        (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app").operations =
            [];
    });
    const requestedPages: number[] = [];
    const requestedPageSizes: number[] = [];
    await page.route("**/api/invoices?**", async (route) => {
        const parameters = new URL(route.request().url()).searchParams;
        const pageNumber = Number(parameters.get("page") || 1);
        const pageSize = Number(parameters.get("per_page") || 5);
        requestedPages.push(pageNumber);
        requestedPageSizes.push(pageSize);
        await route.fulfill({
            json: {
                data: fixtures.invoices.slice(
                    (pageNumber - 1) * pageSize,
                    pageNumber * pageSize,
                ),
                total: 26,
                last_page: Math.ceil(26 / pageSize),
            },
        });
    });
    await page.route("**/api/staff", (route) =>
        route.fulfill({ json: fixtures.staff }),
    );
    await page.route("**/api/sync/reviews", (route) =>
        route.fulfill({
            json: Array.from({ length: 26 }, (_, index) => ({
                id: String(index),
                actor_id: 1,
                status: "open",
                operation: { type: "customer.save" },
                error: "Review " + index,
            })),
        }),
    );
    await context.setOffline(false);
    await page.getByRole("link", { name: "Staff", exact: true }).click();
    const staffPagination = await checkPagination("Staff", ".customer-row");
    await staffPagination
        .getByRole("button", { name: "Next page", exact: true })
        .click();
    const staffSearch = page.getByLabel("Search staff");
    await staffSearch.fill("  " + prefix.toUpperCase() + "  ");
    await expect(staffPagination).toContainText("Showing 1 to 5 of 26 results");
    await staffSearch.fill("  PAGINATION-26@EXAMPLE.TEST  ");
    await expect(staffPagination).toContainText("Showing 1 to 1 of 1 results");
    const staffRow = page.locator(".customer-row");
    await staffRow.hover();
    await expect(staffRow).toHaveCSS("background-color", "rgb(240, 246, 242)");
    await staffRow.locator(".customer-info").click();
    const staffDialog = page.getByRole("dialog");
    await expect(staffDialog).toContainText(fixtures.staff[25].email);
    await expect(staffDialog.getByRole("textbox")).toHaveCount(0);
    await staffDialog
        .getByRole("button", { name: "Edit staff", exact: true })
        .click();
    await expect(staffDialog.getByLabel("Name", { exact: true })).toHaveValue(
        fixtures.staff[25].name,
    );
    await staffDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
    await expect(staffDialog).toHaveCount(0);
    await staffSearch.fill("No matching teammate");
    await expect(
        page.getByRole("heading", { name: "No matching staff", exact: true }),
    ).toBeVisible();
    await expect(staffPagination).toContainText("Showing 0 to 0 of 0 results");
    await staffSearch.fill(fixtures.staff[25].email);
    await page.route("**/api/staff/" + fixtures.staff[25].id, async (route) => {
        const input = route.request().postDataJSON();
        fixtures.staff[25].email = input.email;
        await route.fulfill({ json: fixtures.staff[25] });
    });
    await staffRow.getByRole("button", { name: /^Edit / }).click();
    await expect(staffDialog).toHaveCount(1);
    await staffDialog
        .getByLabel("Email", { exact: true })
        .fill("renamed-teammate@example.test");
    await staffDialog
        .getByRole("button", { name: "Save staff", exact: true })
        .click();
    await expect(staffDialog).toHaveCount(0);
    await expect(staffSearch).toHaveValue("");
    await expect(staffPagination).toContainText(
        "Showing 26 to 26 of 26 results",
    );
    await expect(staffRow).toContainText("renamed-teammate@example.test");
    await page.setViewportSize({ width: 390, height: 844 });
    await staffRow.getByRole("button", { name: /^View / }).focus();
    await page.keyboard.press("Enter");
    await expect(staffDialog).toContainText("renamed-teammate@example.test");
    await staffDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
        .getByRole("link", { name: "Invoices", exact: true })
        .first()
        .click();
    await checkPagination("Invoices", ".invoice-table tbody tr", true);
    expect(requestedPages).toContain(6);
    expect(requestedPageSizes).toEqual(
        expect.arrayContaining([5, 10, 20, 50, 100]),
    );
    await page
        .getByRole("link", { name: "Sync status", exact: false })
        .first()
        .click();
    await checkPagination("Administrator reviews", ".review-row");
});

test("cars can be selected and added directly while creating an invoice offline", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    await page
        .locator(".page-heading")
        .getByRole("link", { name: "New Invoice", exact: true })
        .click();
    const carPicker = page.getByRole("combobox", {
        name: "Select car",
        exact: true,
    });
    const addCar = page.getByRole("button", { name: "Add car", exact: true });
    await expect(carPicker).toHaveCount(0);
    await expect(addCar).toBeVisible();
    await expect(addCar).toBeDisabled();
    await expect(
        page.getByRole("link", { name: "Manage shared cars", exact: true }),
    ).toHaveCount(0);

    const stamp = Date.now();
    const customerName = "Invoice car driver " + stamp;
    await page
        .getByRole("button", { name: "Create customer", exact: true })
        .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(customerName);
    await dialog.getByLabel("Phone", { exact: true }).fill("0162726866");
    await dialog
        .getByRole("button", { name: "Save customer", exact: true })
        .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("No cars", { exact: true })).toBeVisible();
    await expect(carPicker).toHaveCount(0);
    await expect(page.locator(".simple-steps")).toHaveCount(0);
    await page
        .getByLabel("Item 1 description")
        .fill("Invoice kept while adding cars");
    const draftUrl = page.url();

    const registrations = ["CAR " + stamp + " A", "CAR " + stamp + " B"];
    const carIds: string[] = [];
    for (const registration of registrations) {
        await addCar.click();
        dialog = page.getByRole("dialog");
        await expect(
            dialog.getByRole("heading", { name: "Add car", exact: true }),
        ).toBeVisible();
        await expect(dialog.getByLabel(new RegExp(customerName))).toBeChecked();
        await dialog
            .getByLabel("Registration number", { exact: true })
            .fill(registration);
        await dialog.getByLabel("Car model", { exact: true }).fill("MYVI");
        await dialog
            .getByRole("button", { name: "Save car", exact: true })
            .click();
        await expect(dialog).toHaveCount(0);
        await expect(carPicker).toBeEnabled();
        await expect(page.getByText("No cars", { exact: true })).toHaveCount(0);
        await expect(
            page.getByLabel("Registration number", { exact: true }),
        ).toHaveValue(registration);
        carIds.push(await carPicker.inputValue());
        expect(page.url()).toBe(draftUrl);
    }
    await carPicker.selectOption(carIds[0]!);
    await expect(
        page.getByLabel("Registration number", { exact: true }),
    ).toHaveValue(registrations[0]!);
    await expect(page.getByLabel("Car model", { exact: true })).toHaveValue(
        "MYVI",
    );
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        "Invoice kept while adding cars",
    );
    await expect(
        page.getByText("Saved on this device", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await unlock(page);
    await expect(carPicker).toHaveValue(carIds[0]!);
    await expect(
        page.getByLabel("Registration number", { exact: true }),
    ).toHaveValue(registrations[0]!);
    await page.screenshot({
        path: "storage/test-artifacts/invoice-car-selection.png",
        fullPage: true,
    });
});

test("sign out confirms synced work and blocks queued changes and unsynced drafts", async ({
    page,
    context,
}) => {
    await signIn(page);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Are you sure you want to sign out?");
    await expect(
        dialog.getByRole("button", { name: "Sync first", exact: true }),
    ).toHaveCount(0);
    await expect(
        dialog.getByRole("button", { name: "Lock device", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".sidebar")).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.saveCustomer({
            name: "Sign out check " + Date.now(),
            phone: "0162726866",
        });
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Your work is saved on this device");
    await expect(
        dialog.getByRole("button", { name: "Sign out", exact: true }),
    ).toHaveCount(0);
    await dialog
        .getByRole("button", { name: "Keep working", exact: true })
        .click();

    await context.setOffline(false);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const app = (
                    document.getElementById("app") as any
                ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                return app.operations.filter(
                    (operation: any) => operation.state !== "archived",
                ).length;
            }),
        )
        .toBe(0);
    const draftId = await localDocument(page, "Sign out draft check");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Your work is saved on this device");
    await expect(
        dialog.getByRole("button", { name: "Sign out", exact: true }),
    ).toHaveCount(0);
    await dialog
        .getByRole("button", { name: "Keep working", exact: true })
        .click();

    await page.goto("/invoices/" + draftId + "/edit");
    await unlock(page);
    await page.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const app = (
                    document.getElementById("app") as any
                ).__vue_app__.config.globalProperties.$pinia._s.get("app");
                return (
                    app.operations.length === 0 &&
                    app.invoices.every(
                        (invoice: any) =>
                            !invoice.local_only && !invoice.local_dirty,
                    )
                );
            }),
        )
        .toBe(true);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Are you sure you want to sign out?");
    await page.screenshot({
        path: "storage/test-artifacts/sign-out-confirmation.png",
    });
    await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    expect(
        (
            await page.request.get("/api/me", {
                headers: { Accept: "application/json" },
            })
        ).status(),
    ).toBe(401);
    await page.reload();
    await expect(
        page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".app-layout")).toHaveCount(0);
});

test("staff land on invoices and cannot open staff management or settings", async ({
    page,
}) => {
    await signIn(page);
    const stamp = Date.now();
    const staffName = "Landing staff " + stamp;
    const staffEmail = "landing-staff-" + stamp + "@example.test";
    await page.getByRole("link", { name: "Staff", exact: true }).click();
    await page.getByRole("button", { name: "Add staff", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(staffName);
    await dialog.getByLabel("Email", { exact: true }).fill(staffEmail);
    await dialog.getByLabel(/^Password/).fill(creds.password);
    await dialog.getByLabel(/Simple mode/).check();
    await dialog
        .getByRole("button", { name: "Save staff", exact: true })
        .click();
    await expect(
        page.getByRole("heading", { name: staffName, exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
    await expect(
        page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();

    await page.goto("/staff");
    await page.getByLabel("Email", { exact: true }).fill(staffEmail);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(
        page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".user-card")).toContainText(staffName);
    await expect(
        page.getByRole("link", { name: "Staff", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveCount(0);
    expect((await page.request.get("/api/staff")).status()).toBe(403);
    await page
        .getByRole("link", { name: "Customers", exact: true })
        .first()
        .click();
    await expect(
        page.getByRole("heading", { name: "Customers", exact: true }),
    ).toBeVisible();
    await page
        .getByRole("link", { name: "Invoices", exact: true })
        .first()
        .click();
    for (const path of ["/staff", "/settings"]) {
        await page.evaluate(async (path) => {
            await (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$router.push(path);
        }, path);
        await expect(page).toHaveURL("/");
    }
    await page.screenshot({
        path: "storage/test-artifacts/staff-landing-desktop.png",
        fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
        page.getByRole("link", { name: "Customers", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await page.screenshot({
        path: "storage/test-artifacts/staff-landing-mobile.png",
        fullPage: true,
    });
    expect(
        await page
            .locator(".mobile-nav a")
            .evaluateAll((links) =>
                links.map((link) => link.getAttribute("href")),
            ),
    ).toEqual(["/", "/invoices/new", "/customers"]);
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: "Customers", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Filter phone numbers")).toHaveCount(0);
});

test("simple mode lists keep contact and sale essentials readable on desktop and mobile", async ({
    page,
    context,
}) => {
    await signIn(page);
    await context.setOffline(true);
    const fixtures = await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        const names = [
            "Aisha Rahman",
            "Daniel Lim",
            "Mei Ling Tan",
            "Ravi Kumar",
            "Siti Nur Aisyah Binti Abdul Rahman",
            "Zarina Abdullah",
        ];
        const customers = names.map((name, index) => ({
            id: crypto.randomUUID(),
            name,
            phone: "+6012" + (3456700 + index),
            email: "customer-" + index + "@example.test",
            address: "12 Jalan Kemuning Permai, Shah Alam",
            notes: "Customer notes belong on the detail page",
            version: 1,
            created_by: app.user.id,
        }));
        const invoices = customers.map((customer, index) => ({
            id: crypto.randomUUID(),
            invoice_number: String(90001 + index),
            status:
                index === 1 ? "draft" : index === 2 ? "cancelled" : "issued",
            invoice_date: "2026-10-17",
            customer_id: customer.id,
            customer_snapshot: customer,
            company_snapshot: JSON.parse(JSON.stringify(app.company)),
            vehicle_registration: "CAR DETAIL ONLY",
            car_model: "MYVI",
            notes: "",
            items: [],
            total_cents: 4500 + index * 1250,
            subtotal_cents: 4500 + index * 1250,
            total_quantity: "1.000",
            version: 1,
            created_by: app.user.id,
            creator: { name: "Internal record author" },
            device_id: app.vault.profile.device_id,
            created_at: new Date(Date.now() - index).toISOString(),
            local_only: false,
            local_dirty: false,
        }));
        for (const customer of customers)
            await app.vault.put("customer", customer.id, customer);
        for (const invoice of invoices)
            await app.vault.put("invoice", invoice.id, invoice);
        app.customers = customers;
        app.invoices = invoices;
        app.operations = [
            {
                id: crypto.randomUUID(),
                entity_id: invoices[3].id,
                state: "failed",
            },
        ];
        app.user = { ...app.user, role: "staff", simple_mode: true };
        return { customers, invoices };
    });
    await page
        .getByRole("link", { name: "Customers", exact: true })
        .first()
        .click();
    const customerRows = page.locator(".customer-row");
    await expect(customerRows).toHaveCount(5);
    await expect(page.getByLabel("Records per page")).toHaveValue("5");
    await expect(page.getByLabel("Filter phone numbers")).toHaveCount(0);
    await expect(page.locator(".customers-panel")).not.toContainText(
        fixtures.customers[0].email,
    );
    await expect(page.locator(".customers-panel")).not.toContainText(
        fixtures.customers[0].address,
    );
    await expect(page.locator(".customers-panel")).not.toContainText(
        fixtures.customers[0].notes,
    );
    await page.screenshot({
        path: "storage/test-artifacts/simple-customers-desktop.png",
        fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(customerRows.first()).toContainText(
        fixtures.customers[0].phone,
    );
    expect(
        (await customerRows.first().boundingBox())!.height,
    ).toBeLessThanOrEqual(90);
    expect(
        await customerRows
            .first()
            .locator("h3")
            .evaluate((element) =>
                parseFloat(getComputedStyle(element).fontSize),
            ),
    ).toBeGreaterThanOrEqual(18);
    expect(
        (await customerRows
            .first()
            .getByRole("button", { name: /^Edit / })
            .boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await page.screenshot({
        path: "storage/test-artifacts/simple-customers-mobile.png",
        fullPage: false,
    });
    await page
        .getByLabel("Search customers")
        .fill(fixtures.customers[0].phone.slice(-4));
    await expect(customerRows).toHaveCount(1);
    await customerRows
        .first()
        .getByRole("button", { name: /^Edit / })
        .click();
    await expect(page).toHaveURL("/customers");
    await expect(
        page.getByRole("dialog").getByLabel("Name", { exact: true }),
    ).toHaveValue(fixtures.customers[0].name);
    await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
    await customerRows.first().locator(".customer-contact").click();
    await expect(page).toHaveURL("/customers/" + fixtures.customers[0].id);
    await expect(page.locator(".customer-details")).toContainText(
        fixtures.customers[0].address,
    );
    await page.locator(".back-link").click();
    const customerPagination = page.getByRole("navigation", {
        name: "Customers pagination",
    });
    await customerPagination
        .getByRole("button", { name: "Next page", exact: true })
        .click();
    await expect(customerRows).toHaveCount(1);
    await expect(customerPagination).toContainText(
        "Showing 6 to 6 of 6 results",
    );
    for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true);
    }
    await page
        .getByRole("link", { name: "Invoices", exact: true })
        .first()
        .click();
    await expect(page.locator(".invoice-table th")).toHaveText([
        "Invoice",
        "Customer",
        "Total",
        "Status",
        "Open",
    ]);
    await expect(page.locator(".invoice-table tbody tr")).toHaveCount(5);
    await expect(page.locator(".invoices-panel")).not.toContainText(
        "Internal record author",
    );
    await expect(page.locator(".invoices-panel")).not.toContainText(
        "CAR DETAIL ONLY",
    );
    await expect(page.locator(".invoice-table")).toContainText(
        "Needs attention",
    );
    await page.screenshot({
        path: "storage/test-artifacts/simple-invoices-desktop.png",
        fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const invoiceCards = page.locator(".invoice-card");
    await expect(invoiceCards).toHaveCount(5);
    await expect(invoiceCards.first()).toContainText("90001");
    await expect(invoiceCards.first()).toContainText(
        fixtures.customers[0].phone,
    );
    expect(
        (await invoiceCards.first().boundingBox())!.height,
    ).toBeLessThanOrEqual(140);
    await expect(page.locator(".invoice-cards")).toContainText(
        "Needs attention",
    );
    await page.screenshot({
        path: "storage/test-artifacts/simple-invoices-mobile.png",
        fullPage: false,
    });
    for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Search invoices").fill("90001");
    await expect(invoiceCards).toHaveCount(1);
    await invoiceCards.first().click();
    await expect(page).toHaveURL("/invoices/" + fixtures.invoices[0].id);
    await expect(page.locator(".document-preview")).toBeVisible();
});

test("shared cars and Simple mode support single-page mobile invoice creation, phone search and numbered downloads offline", async ({
    page,
    context,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signIn(page);
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s.get("app")
                        .syncing,
            ),
        )
        .toBe(false);
    await context.setOffline(true);
    const stamp = Date.now();
    const names = ["Shared driver A " + stamp, "Shared driver B " + stamp];
    const phones = [0, 1].map(
        (index) => "011" + String((stamp + index) % 100000000).padStart(8, "0"),
    );
    await page.evaluate(
        async ({ names, phones }) => {
            const app = (
                document.getElementById("app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("app");
            await app.saveCustomer({ name: names[0], phone: phones[0] });
            await app.saveCustomer({ name: names[1], phone: phones[1] });
        },
        { names, phones },
    );
    await page.getByRole("link", { name: "Cars", exact: true }).click();
    await page.getByRole("button", { name: "Create car", exact: true }).click();
    const registration = "CAR " + stamp;
    await page
        .getByLabel("Registration number", { exact: true })
        .fill(registration);
    await page.getByLabel("Car model", { exact: true }).fill("MYVI");
    for (const name of names) await page.getByLabel(new RegExp(name)).check();
    await page.getByRole("button", { name: "Save car", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("Search cars").fill(registration);
    const car = page.locator(".vehicle-row").filter({ hasText: registration });
    for (const name of names) await expect(car).toContainText(name);
    await page
        .getByRole("link", { name: "Settings", exact: true })
        .first()
        .click();
    await page.getByLabel("Simple mode", { exact: true }).check();
    await expect(page.locator(".app-layout")).toHaveClass(/simple-mode/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: "New", exact: true }).click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+\/edit$/);
    const newInvoice = page.getByRole("button", {
        name: "New invoice in progress",
        exact: true,
    });
    await expect(newInvoice).toBeDisabled();
    await expect(newInvoice).toHaveAttribute("aria-current", "page");
    await expect(newInvoice).toContainText("In progress");
    await expect(
        page.getByRole("navigation", { name: "Invoice steps" }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("heading", { name: "Customer", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("heading", { name: "Invoice details", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Item 1 description")).toBeVisible();
    await expect(page.getByLabel("Remarks")).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Issue Invoice", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Item 1 description").fill("Shared car fitting");
    await page.getByLabel("Item 1 quantity").fill("2");
    await page.getByLabel("Item 1 unit price").fill("12345.67");
    await expect(page.locator(".line-amount")).toContainText("24,691.34");
    await expect(page.locator(".summary-total strong")).toContainText(
        "24,691.34",
    );
    await page.getByLabel("Remarks").fill("Single-page sale");
    await page
        .getByRole("button", { name: "Issue Invoice", exact: true })
        .click();
    await expect(page.getByRole("alert")).toContainText(
        "Select a customer before saving or issuing.",
    );
    const phone = page.getByLabel("Find customer by mobile number");
    await phone.fill(phones[0]!);
    await expect(phone).toHaveAttribute("inputmode", "tel");
    expect(
        await phone.evaluate((element) =>
            parseFloat(getComputedStyle(element).fontSize),
        ),
    ).toBeGreaterThanOrEqual(17);
    await page.getByRole("button", { name: new RegExp(names[0]!) }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({
        path: "storage/test-artifacts/simple-invoice-in-progress.png",
        fullPage: true,
    });
    await page
        .getByRole("combobox", { name: "Select car", exact: true })
        .selectOption({ label: registration + " · MYVI" });
    await expect(
        page.getByLabel("Registration number", { exact: true }),
    ).toHaveValue(registration);
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true);
        const cards = await page.locator(".editor-main > .card").all();
        for (let index = 1; index < cards.length; index++) {
            const previous = (await cards[index - 1].boundingBox())!;
            const current = (await cards[index].boundingBox())!;
            expect(
                current.y - previous.y - previous.height,
            ).toBeGreaterThanOrEqual(30);
        }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Item 1 description")).toHaveValue(
        "Shared car fitting",
    );
    await expect(page.getByLabel("Remarks")).toHaveValue("Single-page sale");
    await page
        .getByRole("button", { name: "Issue Invoice", exact: true })
        .click();
    await expect(newInvoice).toHaveCount(0);
    await expect(
        page.getByRole("link", { name: "New", exact: true }),
    ).toBeVisible();
    await expect(page.locator("h1").first()).toHaveText(/^\d{5,}$/);
    const number = (await page.locator("h1").first().textContent())!.trim();
    const invoiceAmounts = page.locator(
        ".document-preview .invoice-sheet text",
    );
    await expect(
        invoiceAmounts.filter({ hasText: /^12,345\.67$/ }),
    ).toHaveCount(1);
    await expect(
        invoiceAmounts.filter({ hasText: /^24,691\.34$/ }),
    ).toHaveCount(3);
    const download = page.waitForEvent("download");
    await page
        .getByRole("button", { name: "Download PDF", exact: true })
        .click();
    const pdf = await download;
    expect(pdf.suggestedFilename()).toBe(number + ".pdf");
    await pdf.saveAs("storage/test-artifacts/simple-mode-invoice.pdf");
    await page
        .getByRole("link", { name: "Invoices", exact: true })
        .first()
        .click();
    await page.getByLabel("Search invoices").fill(phones[0]!);
    await expect(
        page
            .getByRole("link", { name: new RegExp("^" + number + "\\s") })
            .first(),
    ).toBeVisible();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: "storage/test-artifacts/simple-mode-mobile.png",
        fullPage: true,
    });
    await context.setOffline(false);
    await page.evaluate(async () => {
        const app = (
            document.getElementById("app") as any
        ).__vue_app__.config.globalProperties.$pinia._s.get("app");
        await app.sync();
    });
    await expect
        .poll(
            async () =>
                (await (await page.request.get("/api/me")).json()).user
                    .simple_mode,
        )
        .toBe(true);
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (
                        document.getElementById("app") as any
                    ).__vue_app__.config.globalProperties.$pinia._s
                        .get("app")
                        .operations.filter(
                            (operation: any) => operation.state !== "archived",
                        ).length,
            ),
        )
        .toBe(0);
    await page.reload();
    await expect(page.locator(".app-layout")).toHaveClass(/simple-mode/);
    await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Simple mode", { exact: true }).uncheck();
    await expect(page.locator(".app-layout")).not.toHaveClass(/simple-mode/);
    await expect
        .poll(
            async () =>
                (await (await page.request.get("/api/me")).json()).user
                    .simple_mode,
        )
        .toBe(false);
    expect(errors).toEqual([]);
});
