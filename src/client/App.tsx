import { authClient } from "./auth";
import { SignIn } from "./SignIn";
import { SignInSettings } from "./SignInSettings";

export function App() {
  const session = authClient.useSession();

  if (session.isPending) return <main className="loading mute">Loading…</main>;
  if (!session.data) return <SignIn onSignedIn={() => session.refetch()} />;

  return (
    <main>
      <h1>Hello, {session.data.user.name}</h1>
      <p className="mute">Today, Plan, Money and Past come in the next build steps.</p>
      <h2>Settings</h2>
      <SignInSettings onSignedOut={() => session.refetch()} />
    </main>
  );
}
