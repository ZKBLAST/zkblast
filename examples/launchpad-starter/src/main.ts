import { LaunchpadApiClient,resolveLaunchpadApiRuntime } from "@zkblast/sdk";

const apiUrl=import.meta.env.VITE_ZKBLAST_API_URL as string;
const config=await fetch(`${apiUrl.replace(/\/$/u,"")}/v1/config`).then((response)=>response.json());
const runtime=resolveLaunchpadApiRuntime({ ...config,apiUrl });
const client=new LaunchpadApiClient(runtime);
document.querySelector("#network")!.textContent=`${runtime.environment} · chain ${runtime.chainId}`;
document.querySelector("#load")!.addEventListener("click",async()=>{
  const page=await client.records({ limit:12 });
  document.querySelector("#result")!.textContent=JSON.stringify(page,null,2);
});
