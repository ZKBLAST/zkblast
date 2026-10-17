import { webPublicConfig } from "../../config/public-env";
import { Dashboard } from "../dashboard";

export default function ApplicationPage() {
  return <Dashboard apiUrl={webPublicConfig.apiUrl} />;
}
