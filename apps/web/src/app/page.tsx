import { webPublicConfig } from "../config/public-env";
import { Dashboard } from "./dashboard";

export default function HomePage() {
  return (
    <main>
      <Dashboard apiUrl={webPublicConfig.apiUrl} />
    </main>
  );
}
