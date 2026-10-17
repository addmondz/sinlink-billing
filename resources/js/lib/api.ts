export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public errors: Record<string, string[]> = {},
    ) {
        super(message);
    }
}
let csrf = "";
export async function api<T = any>(
    path: string,
    options: RequestInit = {},
): Promise<T> {
    if (options.method && options.method !== "GET" && !csrf) {
        const r = await fetch("/api/csrf", {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            cache: "no-store",
        });
        csrf = (await r.json()).token;
    }
    const response = await fetch("/api" + path, {
        ...options,
        credentials: "same-origin",
        cache: "no-store",
        signal: options.signal ?? AbortSignal.timeout(20000),
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-TOKEN": csrf } : {}),
            ...options.headers,
        },
    });
    const data = await response
        .json()
        .catch(() => ({
            message: "The server returned an unexpected response.",
        }));
    if (response.status === 419) {
        csrf = "";
        throw new ApiError(
            419,
            "Session expired. Sign in again; pending local work is safe.",
        );
    }
    if (!response.ok)
        throw new ApiError(
            response.status,
            data.message ?? "Request failed.",
            data.errors ?? {},
        );
    return data as T;
}
export const send = <T = any>(path: string, data: unknown, method = "POST") =>
    api<T>(path, { method, body: JSON.stringify(data) });
export const clearCsrf = () => {
    csrf = "";
};
