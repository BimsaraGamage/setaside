import { useEffect, useState } from "react";
import { api } from "./api";

export function App() {
  const [database, setDatabase] = useState<"checking" | "ok" | "down">("checking");

  useEffect(() => {
    api.api.health
      .$get()
      .then((r) => r.json())
      .then((b) => setDatabase(b.database ? "ok" : "down"))
      .catch(() => setDatabase("down"));
  }, []);

  return (
    <main>
      <h1>Hello, Setaside</h1>
      <p className="status" data-state={database}>
        {database === "checking" ? "Checking…" : database === "ok" ? "All set" : "Can't reach the server"}
      </p>
    </main>
  );
}
