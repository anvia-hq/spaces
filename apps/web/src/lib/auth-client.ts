import { createAuthClient } from "better-auth/react";

/**
 * Same-origin client: in development Vite proxies `/api` to the API, and in a
 * deployment the API serves the console, so the auth surface is always found at
 * `/api/auth` on the page's own origin.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
