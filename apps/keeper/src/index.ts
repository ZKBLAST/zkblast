export type KeeperJob = Readonly<{ name: string; enabled: boolean }>;

export function enabledJobs(jobs: readonly KeeperJob[]): readonly KeeperJob[] {
  return jobs.filter((job) => job.enabled);
}
