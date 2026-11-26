import { app } from "../app.ts";
import { auth } from "../modules/auth/service.ts";

type SocialProviderConfig = { clientId?: string } | (() => unknown) | undefined;

function clientIdOf(provider: SocialProviderConfig): string | null {
  if (typeof provider === "object") return provider.clientId ?? null;

  return null;
}

async function probe() {
  const me = await app.request("/api/v1/me", { headers: { authorization: "Bearer test_key" } });
  const meBody = (await me.json()) as { principal: { kind: string }; login: { github: boolean } };

  const signUp = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `${crypto.randomUUID()}@example.com`,
      password: "correct-horse-battery",
      name: "probe",
    }),
  });

  const social = await app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/" }),
  });

  return {
    meStatus: me.status,
    login: meBody.login,
    principalKind: meBody.principal.kind,
    signUpStatus: signUp.status,
    socialStatus: social.status,
    clientId: clientIdOf(auth.options.socialProviders?.github),
  };
}

console.log(JSON.stringify(await probe()));
