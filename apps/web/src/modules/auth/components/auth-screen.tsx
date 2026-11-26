import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Mark } from "@/components/console/mark";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { signIn, signUp } from "@/lib/auth-client.ts";
import { useLoginProviders } from "../hooks/use-login-providers.ts";
import type { AuthMode } from "../types.ts";
import { GithubSignInButton } from "./github-sign-in-button.tsx";

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useLoginProviders();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result =
      mode === "sign-in"
        ? await signIn.email({ email: email.trim(), password })
        : await signUp.email({
            email: email.trim(),
            password,
            name: name.trim() || email.split("@")[0] || "spaces user",
          });

    if (result.error) {
      setError(result.error.message ?? "That did not work.");
      setBusy(false);
      return;
    }

    window.location.replace("/");
  }

  const signingUp = mode === "sign-up";

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/3 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(237,237,237,0.07),transparent)]" />
      </div>

      <div className="relative w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Mark size={38} />
          <span className="text-lg font-semibold tracking-heading text-foreground">spaces</span>
        </div>

        <div className="flex flex-col">
          {providers?.github && (
            <div className="mb-5 flex flex-col gap-4">
              <GithubSignInButton onError={setError} />
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span aria-hidden className="h-px flex-1 bg-border" />
                or
                <span aria-hidden className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          <Form className="flex flex-col gap-3.5" onSubmit={submit}>
            {signingUp && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete={signingUp ? "new-password" : "current-password"}
                placeholder={signingUp ? "At least 8 characters" : "••••••••"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-base leading-relaxed text-destructive"
              >
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
              {busy ? (
                <Spinner className="size-3.5" />
              ) : (
                <>
                  {signingUp ? "Create account" : "Sign in"}
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          </Form>

          <p className="mt-4 text-center text-base text-muted-foreground">
            {signingUp ? "Already have an account?" : "New here?"}{" "}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-base font-medium text-foreground"
              onClick={() => {
                setMode(signingUp ? "sign-in" : "sign-up");
                setError(null);
              }}
            >
              {signingUp ? "Sign in" : "Create an account"}
            </Button>
          </p>
        </div>
      </div>
    </div>
  );
}
