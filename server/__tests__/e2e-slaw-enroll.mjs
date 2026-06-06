// Live E2E: boot the real botfather tower (pglite), then drive the exact
// SLAW reporter wire flow (enroll -> pending -> approve -> poll key -> heartbeat
// -> sync squad+cost) over HTTP. Proves the instance<->tower contract.
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@slaw-botfather/db";
import { createApp } from "./dist/app.js";
import { LiveHub, attachLiveStream } from "./dist/services/live-stream.js";

// --- boot tower on pglite ---
const client = new PGlite();
for (const f of readdirSync("../packages/db/migrations").filter(f=>f.endsWith(".sql")).sort())
  for (const s of readFileSync("../packages/db/migrations/"+f,"utf8").split("--> statement-breakpoint"))
    if (s.trim()) await client.exec(s.trim());
const db = drizzle(client, { schema: schema });
const config = { port: 8911, databaseUrl: "x", offlineAfterMissedHeartbeats:3, heartbeatIntervalSec:60, staleAfterHours:24, ingestRateLimitPerMin:1000 };
const app = createApp(db, config);
const server = app.listen(8911);
attachLiveStream(server, db, new LiveHub());
await sleep(400);
const B = "http://127.0.0.1:8911";
const J = r=>r.json();
const P = (p,b,h={})=>fetch(B+p,{method:"POST",headers:{"content-type":"application/json",...h},body:b?JSON.stringify(b):undefined});

let ok = true;
const check = (name,cond)=>{ console.log(`${cond?"✓":"✗"} ${name}`); if(!cond) ok=false; };

// --- SLAW-side identity (matches buildIdentity shape) ---
const identity = { machineId:"slaw-e2e-machine-001", instanceId:"default", hostname:"DEV-LAPTOP", os:"darwin", slawVersion:"0.4.2" };

// 1. enroll (token-less) -> pending
const enr = await J(await P("/api/ingest/v1/enroll", { protocolVersion:1, instance:identity, capabilities:{reportIssueTitles:true, liveStream:false} }));
check("enroll returns pending", enr.state==="pending" && !enr.apiKey);

// 2. poll before approval -> still pending
const poll1 = await J(await P("/api/ingest/v1/enroll/poll", { protocolVersion:1, enrollmentId:enr.enrollmentId }));
check("poll before approval = pending, no key", poll1.state==="pending" && !poll1.apiKey);

// 3. admin sees it in queue, approves
const queue = await J(await fetch(B+"/api/admin/approvals"));
check("instance in approval queue", queue.pending.some(p=>p.enrollmentId===enr.enrollmentId));
await P(`/api/admin/approvals/${enr.enrollmentId}/approve`);

// 4. poll -> active + key
const poll2 = await J(await P("/api/ingest/v1/enroll/poll", { protocolVersion:1, enrollmentId:enr.enrollmentId }));
check("poll after approval = active + key", poll2.state==="active" && !!poll2.apiKey);
const key = poll2.apiKey;
const auth = { authorization:"Bearer "+key };

// 5. heartbeat
const hb = await J(await P("/api/ingest/v1/heartbeat", { protocolVersion:1, sentAt:new Date().toISOString(), status:"ok", uptimeSec:5, counts:{squads:1,agents:2,activeRuns:1,openIssues:3}, spend:{todayCents:1500,monthCents:1500}, lastEventCursor:null }, auth));
check("heartbeat acknowledged", hb.acknowledged===true);

// 6. sync a squad upsert + a cost fact (exact reporter payload shape)
const now=new Date().toISOString();
const sync = await J(await P("/api/ingest/v1/sync", { protocolVersion:1, sentAt:now, batchCursor:"e2e-1",
  upserts:[{type:"squad",localId:"sq-e2e",name:"platform-core",status:"active",budgetMonthlyCents:25000,spentMonthlyCents:1500,updatedAt:now}],
  facts:[{type:"cost_event",localId:"ce-e2e",squadLocalId:"sq-e2e",agentLocalId:null,issueLocalId:null,projectLocalId:null,provider:"anthropic",biller:"anthropic",billingType:"metered_api",model:"claude-opus-4-6",inputTokens:1200,cachedInputTokens:300,outputTokens:450,costCents:1500,occurredAt:now}] }, auth));
check("sync accepted 1 upsert + 1 fact", sync.accepted.upserts===1 && sync.accepted.facts===1);

// 7. replay dedupes the fact
const sync2 = await J(await P("/api/ingest/v1/sync", { protocolVersion:1, sentAt:new Date().toISOString(), batchCursor:"e2e-2",
  upserts:[], facts:[{type:"cost_event",localId:"ce-e2e",squadLocalId:"sq-e2e",agentLocalId:null,issueLocalId:null,projectLocalId:null,provider:"anthropic",biller:"anthropic",billingType:"metered_api",model:"claude-opus-4-6",inputTokens:1200,cachedInputTokens:300,outputTokens:450,costCents:1500,occurredAt:now}] }, auth));
check("replayed fact deduplicated", sync2.accepted.facts===0 && sync2.accepted.deduplicated===1);

// 8. tower fleet shows the instance with the squad + spend
const fleet = await J(await fetch(B+"/api/admin/fleet"));
const inst = fleet.instances.find(i=>i.machineId===identity.machineId);
check("fleet shows enrolled instance", !!inst && inst.status==="ok");
check("fleet shows 1 squad + $15.00 MTD", inst && inst.squadCount===1 && inst.spendMtdCents===1500);

// 9. revoke kills the key (instance would flip to revoked)
await P(`/api/admin/instances/${inst.id}/revoke`);
const hb2 = await fetch(B+"/api/ingest/v1/heartbeat", {method:"POST",headers:{"content-type":"application/json",...auth},body:JSON.stringify({protocolVersion:1,sentAt:new Date().toISOString(),status:"ok",uptimeSec:6,counts:{squads:1,agents:2,activeRuns:0,openIssues:3},spend:{todayCents:1500,monthCents:1500},lastEventCursor:null})});
check("revoked key rejected (401)", hb2.status===401);

server.close();
console.log(ok ? "\nE2E PASS" : "\nE2E FAIL");
process.exit(ok?0:1);
