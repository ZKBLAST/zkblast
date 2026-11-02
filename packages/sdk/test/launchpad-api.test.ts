import assert from "node:assert/strict";
import test from "node:test";
import { LaunchpadApiClient,launchpadCapabilities,resolveLaunchpadApiRuntime } from "../src/launchpad-api.js";

test("runtime rejects cross-network and insecure configuration",()=>{
  assert.throws(()=>resolveLaunchpadApiRuntime({ apiUrl:"https://api.example",environment:"mainnet",chainId:46630,explorerUrl:"https://explorer.example" }),(error: unknown)=>(error as { code?: string }).code==="INVALID_CHAIN");
  assert.throws(()=>resolveLaunchpadApiRuntime({ apiUrl:"http://api.example",environment:"mainnet",chainId:4663,explorerUrl:"https://explorer.example" }),(error: unknown)=>(error as { code?: string }).code==="INVALID_API_CONFIG");
});
test("client creates deterministic bounded public requests",async()=>{
  const requests: string[]=[];
  const fetcher: typeof fetch=async (input)=>{ requests.push(String(input));return new Response(JSON.stringify({ items:[],nextCursor:null,indexedBlock:"1",finalizedBlock:"1",observedAt:"2026-11-02T00:00:00Z" }),{ status:200,headers:{ "content-type":"application/json" } }); };
  const client=new LaunchpadApiClient(resolveLaunchpadApiRuntime({ apiUrl:"https://api.example/",environment:"mainnet",chainId:4663,explorerUrl:"https://explorer.example" }),fetcher);
  await client.records({ limit:25 });
  assert.equal(requests[0],"https://api.example/v1/launchpads/records?limit=25");
  assert.throws(()=>client.records({ limit:101 }),(error: unknown)=>(error as { code?: string }).code==="INVALID_LIMIT");
});
test("DLMM capability is explicit and fail-closed",()=>{
  assert.deepEqual(launchpadCapabilities({ launchpad:{},dbc:{} }),{ launchpad:true,damm:true,dlmm:false });
  assert.equal(launchpadCapabilities({ launchpad:{},dbc:{ dlmmGraduationAdapter:"0x1" } }).dlmm,true);
});
