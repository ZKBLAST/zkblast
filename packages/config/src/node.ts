import { readFile } from "node:fs/promises";

import {
  parseDeploymentManifest,
  type DeploymentManifest,
} from "./deployment.js";

export type ManifestRuntime = Readonly<{
  environment: DeploymentManifest["environment"];
  chainId: number;
}>;

export async function loadDeploymentManifestFile(
  filePath: string,
  runtime: ManifestRuntime,
): Promise<DeploymentManifest> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read deployment manifest: ${filePath}`, {
      cause: error,
    });
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new Error(`Deployment manifest is not valid JSON: ${filePath}`, {
      cause: error,
    });
  }

  return parseDeploymentManifest(input, runtime);
}
