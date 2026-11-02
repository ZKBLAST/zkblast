import { HostedLaunchpad } from "./HostedLaunchpad";

export default async function LaunchpadSlugPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  return <HostedLaunchpad slug={slug} />;
}
