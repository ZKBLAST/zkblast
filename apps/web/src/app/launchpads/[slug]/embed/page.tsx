import { HostedLaunchpadWidget } from "./HostedLaunchpadWidget";

export default async function HostedLaunchpadWidgetPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  return <HostedLaunchpadWidget slug={slug} />;
}
