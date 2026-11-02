"use client";

import { Copy,KeyRound,RefreshCw,Webhook } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";

type Authorization = Readonly<{ ownerAddress: string;signature: string;signedAt: string }>;
type Snapshot = Readonly<{
  apiKeys: readonly Readonly<{ key_id: string;name: string;key_prefix: string;scopes: string[];status: string;last_used_at: string | null }>[];
  webhooks: readonly Readonly<{ endpoint_id: string;url: string;event_types: string[];status: string }>[];
  deliveries: readonly Readonly<{ delivery_id: string;event_type: string;status: string;attempts: number;last_error_code: string | null }>[];
}>;
type OnceSecret = Readonly<{ secret?: string;signingSecret?: string;verificationToken?: string;endpointId?: string }>;
const scopes=["launchpads:read","launches:read","trades:read","fees:read","webhooks:read"] as const;
const events=["token.launched","trade.executed","fee.accrued","fee.claimed","graduation.completed","graduation.failed"] as const;

async function detailHash(detail: unknown) {
  const bytes=new TextEncoder().encode(JSON.stringify(detail));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map((value)=>value.toString(16).padStart(2,"0")).join("");
}

export function LaunchpadDeveloperSettings({ launchpadIds }: Readonly<{ launchpadIds: readonly string[] }>) {
  const { address,config }=useApp();
  const [launchpadId,setLaunchpadId]=useState(launchpadIds[0] ?? "");
  const [snapshot,setSnapshot]=useState<Snapshot | null>(null);
  const [keyName,setKeyName]=useState("Production integration");
  const [webhookUrl,setWebhookUrl]=useState("");
  const [once,setOnce]=useState<OnceSecret | null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string | null>(null);

  async function authorize(action: string,detail: unknown): Promise<Authorization> {
    if (!address || !config || !window.ethereum) throw new Error("CONNECT_OWNER_WALLET");
    const signedAt=new Date().toISOString();
    const text=["ZKBLAST Launchpad Developer Action",`Chain ID: ${config.chainId}`,`Launchpad ID: ${launchpadId}`,`Action: ${action}`,`Detail Hash: ${await detailHash(detail)}`,`Signed At: ${signedAt}`].join("\n");
    const signature=await window.ethereum.request({ method: "personal_sign",params: [text,address] });
    if (typeof signature!=="string") throw new Error("SIGNATURE_INVALID");
    return { ownerAddress: address,signature,signedAt };
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);setMessage(null);
    try { await work(); } catch(error) { setMessage(error instanceof Error ? error.message : "DEVELOPER_ACTION_FAILED"); }
    finally { setBusy(false); }
  }
  async function refresh() {
    const authorization=await authorize("developer.snapshot",{});
    setSnapshot(await apiRequest(webPublicConfig.apiUrl,`/v1/launchpads/${launchpadId}/developer/snapshot`,{ method:"POST",body:JSON.stringify({ authorization }) }));
  }
  async function createKey() {
    const detail={ name:keyName,scopes:[...scopes] };
    const authorization=await authorize("api_key.create",detail);
    const result=await apiRequest<OnceSecret>(webPublicConfig.apiUrl,`/v1/launchpads/${launchpadId}/developer/api-keys`,{ method:"POST",body:JSON.stringify({ ...detail,authorization }) });
    setOnce(result);await refresh();
  }
  async function registerWebhook() {
    const detail={ url:webhookUrl,eventTypes:[...events] };
    const authorization=await authorize("webhook.create",detail);
    const result=await apiRequest<OnceSecret>(webPublicConfig.apiUrl,`/v1/launchpads/${launchpadId}/developer/webhooks`,{ method:"POST",body:JSON.stringify({ ...detail,authorization }) });
    setOnce(result);await refresh();
  }
  async function rotateKey(keyId: string) {
    const detail={ keyId };
    const authorization=await authorize("api_key.rotate",detail);
    setOnce(await apiRequest(webPublicConfig.apiUrl,`/v1/launchpads/${launchpadId}/developer/api-keys/${keyId}/rotate`,{ method:"POST",body:JSON.stringify({ authorization }) }));
    await refresh();
  }
  async function revokeKey(keyId: string) {
    const detail={ keyId };
    const authorization=await authorize("api_key.revoke",detail);
    await apiRequest(webPublicConfig.apiUrl,`/v1/launchpads/${launchpadId}/developer/api-keys/${keyId}`,{ method:"DELETE",body:JSON.stringify({ authorization }) });
    await refresh();
  }
  async function verifyEndpoint() {
    if (!once?.endpointId || !once.verificationToken) throw new Error("VERIFICATION_TOKEN_UNAVAILABLE");
    const detail={ endpointId:once.endpointId };
    const authorization=await authorize("webhook.verify",detail);
    await apiRequest(webPublicConfig.apiUrl,`/v1/launchpads/${launchpadId}/developer/webhooks/${once.endpointId}/verify`,{ method:"POST",body:JSON.stringify({ verificationToken:once.verificationToken,authorization }) });
    setOnce(null);await refresh();
  }
  async function retryDelivery(deliveryId: string) {
    const detail={ deliveryId };
    const authorization=await authorize("webhook.delivery.retry",detail);
    await apiRequest(webPublicConfig.apiUrl,`/v1/launchpads/${launchpadId}/developer/deliveries/${deliveryId}/retry`,{ method:"POST",body:JSON.stringify({ authorization }) });
    await refresh();
  }
  const snippet=`curl -H "x-zkblast-api-key: $ZKBLAST_API_KEY" ${webPublicConfig.apiUrl}/v1/launchpads/${launchpadId}/developer/api/status`;
  if (!launchpadIds.length) return null;
  return <section className="mt-5 border border-line bg-bg p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="label">Developer settings</p><p className="mt-2 text-xs text-muted">Owner-controlled keys, webhooks, deliveries and integration snippet.</p></div>
      <div className="flex max-w-full gap-2">
        <select aria-label="Launchpad developer settings" value={launchpadId} onChange={(event)=>{setLaunchpadId(event.target.value);setSnapshot(null);setOnce(null);}} className="min-w-0 border border-line bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-lime">
          {launchpadIds.map((id)=><option key={id} value={id}>Launchpad {id}</option>)}
        </select>
        <button disabled={busy} onClick={()=>void run(refresh)} className="border border-line p-2 text-muted hover:text-fg disabled:opacity-50" aria-label="Refresh developer settings"><RefreshCw className={`size-4 ${busy?"animate-spin":""}`}/></button>
      </div>
    </div>
    <p role="status" aria-live="polite" className={`mt-4 font-mono text-xs ${message?"border border-danger/50 p-3 text-danger":"sr-only"}`}>{message??(busy?"Developer action in progress":"Developer settings ready")}</p>
    {once && <div className="mt-4 border border-lime p-4"><p className="label text-lime">Copy now · shown once</p>{Object.entries(once).filter(([,value])=>value).map(([key,value])=><div key={key} className="mt-3 flex items-start gap-2"><code className="min-w-0 flex-1 break-all text-xs">{key}: {value}</code><button onClick={()=>void navigator.clipboard.writeText(String(value))} aria-label={`Copy ${key}`}><Copy className="size-4"/></button></div>)}{once.verificationToken&&<button disabled={busy} onClick={()=>void run(verifyEndpoint)} className="mt-4 border border-lime px-4 py-2 font-mono text-xs uppercase text-lime">Verify endpoint now</button>}</div>}
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div className="border border-line p-4"><div className="flex items-center gap-2"><KeyRound className="size-4 text-lime"/><p className="font-mono text-sm">API keys</p></div><input value={keyName} onChange={(event)=>setKeyName(event.target.value)} maxLength={80} className="mt-4 w-full border border-line bg-bg p-3 text-sm outline-none focus:border-lime"/><button disabled={busy||!keyName.trim()} onClick={()=>void run(createKey)} className="mt-3 w-full bg-lime p-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-50">Create scoped key</button><div className="mt-4 space-y-2">{snapshot?.apiKeys.map((key)=><div key={key.key_id} className="border-t border-line pt-2 text-xs"><span className="font-mono">{key.key_prefix}</span><span className="float-right uppercase text-muted">{key.status}</span><p className="mt-1 text-muted">{key.name} · {key.scopes.length} scopes</p>{key.status==="active"&&<div className="mt-2 flex gap-3"><button onClick={()=>void run(()=>rotateKey(key.key_id))} className="text-lime">Rotate</button><button onClick={()=>void run(()=>revokeKey(key.key_id))} className="text-danger">Revoke</button></div>}</div>) ?? <p className="text-xs text-muted">Unlock with the owner wallet to view keys.</p>}</div></div>
      <div className="border border-line p-4"><div className="flex items-center gap-2"><Webhook className="size-4 text-lime"/><p className="font-mono text-sm">Webhooks</p></div><input value={webhookUrl} onChange={(event)=>setWebhookUrl(event.target.value)} placeholder="https://example.com/webhooks/zkblast" className="mt-4 w-full border border-line bg-bg p-3 text-sm outline-none focus:border-lime"/><button disabled={busy||!webhookUrl.startsWith("https://")} onClick={()=>void run(registerWebhook)} className="mt-3 w-full bg-lime p-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-50">Register endpoint</button><div className="mt-4 space-y-2">{snapshot?.webhooks.map((hook)=><div key={hook.endpoint_id} className="border-t border-line pt-2 text-xs"><span className="break-all font-mono">{hook.url}</span><span className="float-right uppercase text-muted">{hook.status}</span><p className="mt-1 text-muted">{hook.event_types.length} events</p></div>) ?? <p className="text-xs text-muted">Endpoint ownership must be verified before delivery.</p>}</div></div>
    </div>
    <div className="mt-4 border border-line p-4"><p className="label">SDK / API quickstart</p><div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap bg-white/[.03] p-3 text-xs">{snippet}</code><button onClick={()=>void navigator.clipboard.writeText(snippet)} aria-label="Copy API snippet"><Copy className="size-4"/></button></div><div className="mt-4 space-y-2">{snapshot?.deliveries.slice(0,10).map((delivery)=><div key={delivery.delivery_id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs"><span>{delivery.event_type} · {delivery.status} · attempt {delivery.attempts}</span>{["failed","dead_letter"].includes(delivery.status)&&<button onClick={()=>void run(()=>retryDelivery(delivery.delivery_id))} className="text-lime">Retry</button>}</div>) ?? <p className="text-xs text-muted">Unlock to view delivery attempts.</p>}</div></div>
  </section>;
}
