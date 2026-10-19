import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const WORKFLOW_PATH = ".github/workflows/ws-preview-deploy.yml";
const HELPER_PATH = "infra/vps/ws-preview-env-preflight.mjs";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function helperText() {
  return fs.readFileSync(HELPER_PATH, "utf8");
}

function stepBlock(section, stepName) {
  const escapedName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`- name: ${escapedName}\\n([\\s\\S]*?)(?=\\n\\s*- name:|$)`));
  assert.ok(match, `missing step block: ${stepName}`);
  return match[0];
}

test("ws preview deploy workflow keeps the preview-only manual contract", () => {
  const text = workflowText();
  const helper = helperText();
  const validateSection = text.split(/^  deploy:\n/m)[0];
  const deploySection = text.split(/^  deploy:\n/m)[1] ?? "";

  assert.match(text, /^name: WS Preview Deploy/m);
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /^\s+push:/m);
  assert.doesNotMatch(text, /^\s+pull_request:/m);

  assert.match(text, /inputs:\n\s+ref:\n\s+description: Git ref to deploy to the preview WS host\n\s+required: true\n\s+type: string/);
  assert.match(text, /ref: \$\{\{ inputs\.ref \}\}/);

  assert.match(text, /WS_PREVIEW_HOST/);
  assert.match(text, /WS_PREVIEW_USER/);
  assert.match(text, /WS_PREVIEW_SSH_KEY/);

  assert.match(text, /ws-preview\.kcswh\.pl/);
  assert.match(text, /\/opt\/arcade-ws-preview/);
  assert.match(text, /\/opt\/arcade-ws-preview\/ws-server/);
  assert.match(helper, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(text, /ws-server-preview\.service/);
  assert.match(text, /http:\/\/127\.0\.0\.1:3001\/healthz/);
  assert.match(text, /https:\/\/ws-preview\.kcswh\.pl\/healthz/);
  assert.match(helper, /WS_AUTHORITATIVE_JOIN_ENABLED=1/);
  assert.match(helper, /SUPABASE_DB_URL/);
  assert.match(helper, /POKER_WS_INTERNAL_TOKEN/);
  assert.match(text, /node --test ws-tests\/ws-preview-deploy\.workflow\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-preview-deploy\.remote-shape\.guard\.test\.mjs/);

  assert.doesNotMatch(deploySection, /ws\.kcswh\.pl/);
  assert.doesNotMatch(deploySection, /\/opt\/ws-server/);
  assert.doesNotMatch(deploySection, /\/etc\/arcadeplatform\/ws-preview\.env/);
  assert.doesNotMatch(deploySection, /ws-server\.service/);
  assert.doesNotMatch(deploySection, /\/opt\/arcade-ws-preview\/releases/);
  assert.doesNotMatch(deploySection, /ln -sfn/);
  assert.doesNotMatch(deploySection, /readlink -f/);
  assert.doesNotMatch(deploySection, /PREVIOUS_TARGET/);
  assert.doesNotMatch(validateSection, /PREVIEW_RELEASES_DIR/);
});

test("ws preview deploy validates workflow files from workflow ref and builds app from inputs.ref", () => {
  const text = workflowText();
  const validateSection = text.split(/^  deploy:\n/m)[0];
  const deploySection = text.split(/^  deploy:\n/m)[1] ?? "";

  const validateCheckout = stepBlock(validateSection, "Checkout workflow ref");
  const deployCheckout = stepBlock(deploySection, "Checkout deploy target ref");

  assert.doesNotMatch(validateCheckout, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.match(deployCheckout, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.match(validateSection, /node --test ws-tests\/ws-preview-deploy\.workflow\.guard\.test\.mjs/);
  assert.match(validateSection, /node --test ws-tests\/ws-preview-deploy\.remote-shape\.guard\.test\.mjs/);
  assert.doesNotMatch(validateSection, /Validate preview-only workflow contract literals/);
});

test("ws preview deploy serializes all refs and uses one run-scoped remote temp directory", () => {
  const text = workflowText();
  const concurrencyBlock = text.match(/^concurrency:\n([\s\S]*?)(?=\n\S)/m)?.[0] ?? "";

  assert.match(concurrencyBlock, /group: ws-preview-deploy\n/);
  assert.doesNotMatch(concurrencyBlock, /inputs\.ref/);
  assert.match(
    text,
    /PREVIEW_REMOTE_TMP_DIR: \/tmp\/arcadeplatform-ws-preview-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/
  );
  assert.match(text, /target: \$\{\{ env\.PREVIEW_REMOTE_TMP_DIR \}\}/);
  assert.match(text, /PREVIEW_REMOTE_TMP_DIR: \$\{\{ env\.PREVIEW_REMOTE_TMP_DIR \}\}/);
  assert.match(text, /TMP_ARCHIVE="\$PREVIEW_REMOTE_TMP_DIR\/\.artifacts\/ws-preview\/ws-preview-dist\.tgz"/);
});


test("ws preview deploy workflow keeps preview runtime contract and does not manage Caddy", () => {
  const text = workflowText();
  const helper = helperText();

  assert.match(text, /ws-preview\.kcswh\.pl/);
  assert.match(helper, /^#!\/usr\/bin\/node$/m);
  assert.match(text, /\/opt\/arcade-ws-preview\/ws-server/);
  assert.match(helper, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(text, /ws-server-preview\.service/);
  assert.match(text, /http:\/\/127\.0\.0\.1:3001\/healthz/);
  assert.match(helper, /preview env file must define WS_AUTHORITATIVE_JOIN_ENABLED=1/);
  assert.match(helper, /REQUIRED_NON_EMPTY/);
  for (const key of ["SUPABASE_DB_URL", "SUPABASE_STAGE_PROJECT_REF", "POKER_WS_INTERNAL_TOKEN"]) {
    assert.match(helper, new RegExp(key));
  }
  assert.match(helper, /must not define legacy WS_BOT_REACTION_MIN_MS or WS_BOT_REACTION_MAX_MS/);
  assert.match(helper, /preview env SUPABASE_URL must target SUPABASE_STAGE_PROJECT_REF/);
  assert.match(helper, /preview env SUPABASE_DB_URL must target SUPABASE_STAGE_PROJECT_REF/);
  assert.match(text, /sudo -n \/usr\/local\/sbin\/arcade-ws-preview-env-preflight/);
  assert.match(text, /sudo -n \/usr\/bin\/systemctl restart ws-server-preview\.service/);
  assert.doesNotMatch(text, /\/etc\/caddy\/Caddyfile/);
  assert.doesNotMatch(text, /infra\/vps\/Caddyfile/);
  assert.doesNotMatch(text, /Caddyfile\.preview\.example/);
});

test("ws preview deploy workflow packages and validates shared runtime files", () => {
  const text = workflowText();

  assert.match(text, /PREVIEW_STAGE_WS_DIR:/);
  assert.match(text, /mkdir -p "\$PREVIEW_STAGE_WS_DIR"/);
  assert.match(text, /cp -R ws-server\/poker "\$PREVIEW_STAGE_WS_DIR"\/poker/);
  assert.match(text, /cp -R ws-server\/observability "\$PREVIEW_STAGE_WS_DIR"\/observability/);
  assert.match(text, /cp -R ws-server\/shared\/poker-domain "\$PREVIEW_STAGE_WS_DIR"\/shared\/poker-domain/);
  assert.match(text, /cp -R ws-server\/node_modules "\$PREVIEW_STAGE_WS_DIR"\/node_modules/);
  assert.match(text, /RELEASE_ENVIRONMENT: preview/);
  assert.match(text, /release-metadata\.json/);
  assert.match(text, /releaseSha: process\.env\.RELEASE_SHA/);
  assert.match(text, /deployRef: process\.env\.DEPLOY_REF/);
  assert.match(text, /cp -R ws-server\/node_modules "\$PREVIEW_STAGE_DIR"\/node_modules/);
  assert.match(text, /cp -R shared "\$PREVIEW_STAGE_DIR"\/shared/);
  assert.match(text, /cp netlify\/functions\/_shared\/chips-ledger\.mjs "\$PREVIEW_STAGE_DIR"\/netlify\/functions\/_shared\//);
  assert.match(text, /node --input-type=module -e "await import\('\.\/ws-server\/shared\/poker-domain\/inactive-cleanup-deps\.mjs'\)"/);
  assert.match(text, /test -f "\$TMP_EXTRACT_DIR\/shared\/poker-domain\/join\.mjs"/);
  assert.match(text, /test -f "\$TMP_EXTRACT_DIR\/ws-server\/server\.mjs"/);
  assert.match(text, /test -f "\$PREVIEW_STAGE_WS_DIR\/release-metadata\.json"/);
  assert.match(text, /test -f "\$TMP_EXTRACT_DIR\/ws-server\/shared\/poker-domain\/inactive-cleanup-deps\.mjs"/);
  assert.match(text, /test -f "\$TMP_EXTRACT_DIR\/netlify\/functions\/_shared\/chips-ledger\.mjs"/);
  assert.match(text, /test -f "\$TMP_EXTRACT_DIR\/netlify\/functions\/_generated\/deploy-context\.mjs"/);
  assert.match(text, /test -d "\$TMP_EXTRACT_DIR\/node_modules\/postgres"/);
  assert.match(text, /rsync -a --no-owner --no-group --checksum --delete --omit-dir-times "\$TMP_EXTRACT_DIR\/ws-server\/" "\$PREVIEW_APP_DIR"\//);
  assert.match(text, /mkdir -p "\$PREVIEW_BASE_DIR\/shared"/);
  assert.match(text, /rsync -a --no-owner --no-group --checksum --delete --omit-dir-times "\$TMP_EXTRACT_DIR\/shared\/" "\$PREVIEW_BASE_DIR\/shared"\//);
  assert.match(text, /mkdir -p "\$PREVIEW_BASE_DIR\/netlify\/functions\/_shared"/);
  assert.match(text, /rsync -a --no-owner --no-group --checksum --delete --omit-dir-times "\$TMP_EXTRACT_DIR\/netlify\/functions\/_shared\/" "\$PREVIEW_BASE_DIR\/netlify\/functions\/_shared"\//);
  assert.match(text, /mkdir -p "\$PREVIEW_BASE_DIR\/netlify\/functions\/_generated"/);
  assert.match(text, /rsync -a --no-owner --no-group --checksum --delete --omit-dir-times "\$TMP_EXTRACT_DIR\/netlify\/functions\/_generated\/" "\$PREVIEW_BASE_DIR\/netlify\/functions\/_generated"\//);
  assert.match(text, /test -f "\$PREVIEW_BASE_DIR\/netlify\/functions\/_generated\/deploy-context\.mjs"/);
  assert.match(text, /mkdir -p "\$PREVIEW_BASE_DIR\/node_modules"/);
  assert.match(text, /rsync -a --no-owner --no-group --checksum --delete --omit-dir-times "\$TMP_EXTRACT_DIR\/node_modules\/" "\$PREVIEW_BASE_DIR\/node_modules"\//);
  assert.doesNotMatch(text, /sudo -n (?:bash|node|rsync|mkdir|rm|test|tar)\b/);
  assert.doesNotMatch(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR"\/ "\$PREVIEW_BASE_DIR"\//);
});

test("poker deployment doc states the unified preview Caddy ownership model", () => {
  const text = fs.readFileSync("docs/poker-deployment.md", "utf8");

  assert.match(text, /manual-only/i);
  assert.match(text, /does not manage Caddy/i);
  assert.match(text, /infra\/vps\/Caddyfile` is the single source of truth for both production and preview WS routing/i);
  assert.match(text, /ws-preview\.kcswh\.pl/);
  assert.match(text, /\/opt\/arcade-ws-preview\/ws-server/);
  assert.match(text, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(text, /ws-server-preview\.service/);
  assert.match(text, /http:\/\/127\.0\.0\.1:3001\/healthz/);
  assert.match(text, /exact command-specific sudo/);
  assert.match(text, /WS_AUTHORITATIVE_JOIN_ENABLED=1/);
  assert.match(text, /SUPABASE_DB_URL/);
  assert.match(text, /SUPABASE_STAGE_PROJECT_REF/);
  assert.match(text, /POKER_WS_INTERNAL_TOKEN/);
  assert.match(text, /internal\/admin\/bot-reaction/);
  assert.doesNotMatch(text, /Caddyfile\.preview\.example/);
});


test("protected Preview env preflight validates Stage V3 without disclosing credentials", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = helperText().replace(/^#!.*\n/, "").replace('import fs from "node:fs";', "").replace('import { createHash } from "node:crypto";', "");
  const base = { SUPABASE_STAGE_PROJECT_REF:"krydukthwdvccggbyjfw",
    SUPABASE_URL:"https://krydukthwdvccggbyjfw.supabase.co",
    SUPABASE_DB_URL:"postgres://postgres.krydukthwdvccggbyjfw@aws-0-eu-west-3.pooler.supabase.com:6543/postgres",
    POKER_WS_INTERNAL_TOKEN:"private-internal-token",PORT:"3001",WS_AUTHORITATIVE_JOIN_ENABLED:"1" };
  const v3 = { XP_REDIS_VERSION:"3",XP_REDIS_ENV:"stage",XP_KEY_NS:"kcswh:stage:xp:v3",
    UPSTASH_REDIS_REST_URL:"https://fixture.upstash.io",UPSTASH_REDIS_REST_TOKEN:"private-redis-token" };
  function run(overrides, parentUid=0, parentMode=0o755) {
    const values={...base,...overrides};let output="";const process={argv:["node","helper","--config-only"],
      stdout:{write:text=>{output+=text;}},stderr:{write:text=>{output+=text;}}};
    const fs={constants:{O_RDONLY:0,O_NOFOLLOW:1,O_NONBLOCK:2},openSync:()=>3,
      fstatSync:()=>({isFile:()=>true,uid:0,gid:0,mode:0o600,nlink:1}),
      lstatSync:()=>({isDirectory:()=>true,uid:parentUid,gid:0,mode:parentMode}),
      readFileSync:()=>Object.entries(values).map(([k,v])=>k+"="+v).join("\n"),closeSync:()=>{}};
    runInNewContext(source,{fs,process,URL,createHash});
    assert.doesNotMatch(output,/private-internal-token|private-redis-token/);
    return {code:process.exitCode||0,output};
  }
  assert.match(run(v3).output,/PASS CONFIG ONLY Redis V3 stage; live verification required/);
  assert.equal(run(v3).code,0);
  assert.equal(run(v3,1001).code,1,"service-owned parent is not protected by file0600");
  assert.equal(run(v3,0,0o775).code,1,"root ownership cannot compensate for group-writable parent");
  assert.equal(run({...v3,SUPABASE_DB_URL:"postgres://postgres@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres"}).code,0);
  assert.match(run({}).output,/legacy Redis; V3 not verified/);
  for (const changed of [
    {XP_KEY_NS:"kcswh:prod:xp:v3"},{XP_REDIS_VERSION:""},{XP_REDIS_ENV:""},
    {UPSTASH_REDIS_REST_URL:""},{UPSTASH_REDIS_REST_TOKEN:" "},{XP_TEST_MODE:"1"},
    {CONTEXT:"production"},{SUPABASE_STAGE_PROJECT_REF:"wrong-project"},
    {SUPABASE_URL:"https://krydukthwdvccggbyjfw.supabase.co.evil.invalid"},
    {SUPABASE_DB_URL:"postgres://postgres.wrong-project@aws-0-eu-west-3.pooler.supabase.com/postgres?ref=krydukthwdvccggbyjfw"},
  ]) assert.equal(run({...v3,...changed}).code,1);
});


test("explicit Redis live verification uses only PING and Stage EXISTS and redacts failures", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = helperText().replace(/^#!.*\n/, "").replace('import fs from "node:fs";', "").replace('import { createHash } from "node:crypto";', "");
  const text = ["SUPABASE_STAGE_PROJECT_REF=krydukthwdvccggbyjfw",
    "SUPABASE_URL=https://krydukthwdvccggbyjfw.supabase.co",
    "SUPABASE_DB_URL=postgres://postgres.krydukthwdvccggbyjfw@aws-0-eu-west-3.pooler.supabase.com/postgres",
    "POKER_WS_INTERNAL_TOKEN=private-internal-token", "PORT=3001", "WS_AUTHORITATIVE_JOIN_ENABLED=1",
    "XP_REDIS_VERSION=3", "XP_REDIS_ENV=stage", "XP_KEY_NS=kcswh:stage:xp:v3",
    "UPSTASH_REDIS_REST_URL=https://fixture.upstash.io", "UPSTASH_REDIS_REST_TOKEN=private-redis-token"].join("\n");
  for (const scenario of ["ok", "default", "quota", "redirect", "config-changed", "unapproved-config"]) {
    const calls=[];let output="",reads=0,finish;
    const completed=new Promise(resolve=>{finish=resolve;});
    const process={argv:scenario==="default"?["node","helper"]:["node","helper","--verify-redis"],stdout:{write:s=>{output+=s;finish();}},
      stderr:{write:s=>{output+=s;finish();}}};
    const fs={constants:{O_RDONLY:0,O_NOFOLLOW:1,O_NONBLOCK:2},openSync:path=>path.endsWith("manifest.json")?4:3,
      fstatSync:()=>({isFile:()=>true,uid:0,gid:0,mode:0o600,nlink:1}),
      lstatSync:path=>({isDirectory:()=>true,uid:0,gid:0,mode:path==="/var/backups/arcade-ws-preview-v3"?0o700:0o755}),closeSync:()=>{},
      readFileSync:fd=>{
        if(fd===4)return JSON.stringify({version:1,phase:"complete",desired:{env:scenario==="unapproved-config"?"wrong":createHash("sha256").update(text).digest("hex")}});
        reads++;return text+(scenario==="config-changed"&&reads>1?"\nCHANGED=1":"");
      }};
    const fetch=async(url,options)=>{
      calls.push({url,options});
      if(scenario==="redirect")throw new Error("private-redis-token must not leak");
      return {ok:scenario!=="quota",json:async()=>[{result:"PONG"},{result:1}]};
    };
    runInNewContext(source,{fs,process,URL,fetch,AbortSignal,createHash});
    await completed;
    if(scenario==="unapproved-config"){
      assert.equal(calls.length,0);assert.equal(process.exitCode,1);assert.doesNotMatch(output,/PASS|private-redis-token/);continue;
    }
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,"https://fixture.upstash.io/pipeline");
    assert.equal(calls[0].options.redirect,"error");
    assert.deepEqual(JSON.parse(calls[0].options.body),[["PING"],["EXISTS","kcswh:stage:xp:v3:lifecycle:epoch"]]);
    assert.doesNotMatch(output,/private-redis-token|private-internal-token|fixture\.upstash/);
    if(["ok","default"].includes(scenario))assert.match(output,/PASS LIVE.*cutover NOT attested/);
    else {assert.equal(process.exitCode,1);assert.doesNotMatch(output,/PASS/);}
  }
});


test("V3 deploy gate rejects legacy/config-only and accepts only actual LIVE output", async () => {
  const {spawnSync}=await import("node:child_process");
  const text=workflowText();
  const block=text.match(/# BEGIN REDIS DEPLOY GATE\n([\s\S]*?)# END REDIS DEPLOY GATE/);
  assert.ok(block,"missing independent Redis deployment gate");
  for(const result of ["PASS", "PASS legacy Redis; V3 not verified", "PASS CONFIG ONLY Redis V3 stage; live verification required", "PASS LIVE Redis V3 stage; epochPresent=0; cutover NOT attested"]) {
    const run=spawnSync("bash",["-ec",block[1]],{encoding:"utf8",env:{...process.env,XP_REDIS_VERSION:"3",PREFLIGHT_RESULT:result}});
    assert.equal(run.status,result.startsWith("PASS LIVE")?0:1);
  }
});

test("V3 generated context gate rejects foreign Stage/version and checks both artifact copies", async () => {
  const {spawnSync}=await import("node:child_process");
  const os=await import("node:os");
  const path=await import("node:path");
  const workflow=workflowText();
  const match=workflow.match(/verify_deploy_context\(\) \{[\s\S]*?node --input-type=module -e '\n([\s\S]*?)\n\s+' "\$1"/);
  assert.ok(match);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"preview-context-"));
  try {
    const file=path.join(dir,"context.mjs");
    for(const values of [ ["deploy-preview","3","stage"], ["production","3","stage"], ["deploy-preview","2","stage"], ["deploy-preview","3","prod"], ["unknown",null,null] ]) {
      fs.writeFileSync(file,["BUILD_DEPLOY_CONTEXT","BUILD_XP_REDIS_VERSION","BUILD_XP_REDIS_ENV"].map((key,i)=>`export const ${key}=${JSON.stringify(values[i])};`).join("\n"));
      const result=spawnSync(process.execPath,["--input-type=module","-e",match[1],file]);
      assert.equal(result.status,values.join()==="deploy-preview,3,stage"?0:1);
    }
    assert.equal((workflow.match(/verify_deploy_context "\$/g)||[]).length,4);
    assert.ok(workflow.indexOf('# END REDIS DEPLOY GATE')<workflow.indexOf('rsync -a --no-owner'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
