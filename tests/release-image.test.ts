import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const validate = createRequire(import.meta.url)("../.github/scripts/release-image.cjs");
const revision = "a".repeat(40);
function fixture() {
  const state = {
    context: { eventName:"release", payload:{action:"published",release:{tag_name:"v2026.10.27",draft:false}},repo:{owner:"Example",repo:"Beacon"} },
    tagged:revision, comparison:"ahead",
    runs:[{id:10,head_sha:revision,status:"completed",conclusion:"success"}],
    checks:["Analyze (actions)","Analyze (javascript-typescript)"].map((name,id)=>({name,id,status:"completed",conclusion:"success",app:{slug:"github-actions"}})),
  };
  const outputs:Record<string,string>={};
  const client={
    rest:{repos:{getCommit:async()=>({data:{sha:state.tagged}}),compareCommits:async()=>({data:{status:state.comparison}})},actions:{listWorkflowRuns:async()=>({data:{workflow_runs:state.runs}})},checks:{listForRef:()=>{}}},
    paginate:async()=>state.checks,
  };
  return {state,outputs,run:()=>validate({github:client,context:state.context,revision,core:{setOutput:(key:string,value:string)=>{outputs[key]=value;}}})};
}
test("a release publishes only the checked commit with immutable version metadata",async()=>{
  const f=fixture();await f.run();assert.deepEqual(f.outputs,{image:"ghcr.io/example/beacon",tag:"v2026.10.27",version:"2026.10.27",revision});
  f.state.context.payload.release.tag_name="v2026.10.27-patch1";await f.run();assert.equal(f.outputs.version,"2026.10.27-patch1");
  for(const tag of ["v2024.02.29","v2026.10.27-patch2","v2026.10.27-patch12"]){f.state.context.payload.release.tag_name=tag;await f.run();assert.equal(f.outputs.tag,tag);}
});
test("ordinary commits, drafts and unsafe tag names never authorize publishing",async()=>{
  for(const tag of ["latest","main","v2026.10.27\n","v1.2.3","v2026.02.30","v2025.02.29","v2026.13.01","v2026.1.01","v2026.10.27-patch0","v2026.10.27-patch01","v2026.10.27-patch.1","v2026.10.27+build.4","v01.2.3","v2026.10.27\nvalue=other","v2026.10.27;echo test"]){const f=fixture();f.state.context.payload.release.tag_name=tag;await assert.rejects(f.run());assert.deepEqual(f.outputs,{});}
  const f=fixture();f.state.context.eventName="push";await assert.rejects(f.run());
  f.state.context.eventName="release";f.state.context.payload.release.draft=true;await assert.rejects(f.run());
});
test("moved tags and commits outside main are rejected",async()=>{
  const f=fixture();f.state.tagged="b".repeat(40);await assert.rejects(f.run(),/tag changed/);
  f.state.tagged=revision;for(const status of ["behind","diverged"]){f.state.comparison=status;await assert.rejects(f.run(),/part of main/);}
});
test("a missing, pending, failed or superseded CI success cannot publish",async()=>{
  const f=fixture();f.state.runs=[];await assert.rejects(f.run(),/CI/);
  for(const [status,conclusion] of [["in_progress",""],["completed","failure"],["completed","cancelled"]]){
    f.state.runs=[{id:10,head_sha:revision,status,conclusion}];await assert.rejects(f.run(),/CI/);
  }
  f.state.runs=[{id:10,head_sha:revision,status:"completed",conclusion:"success"},{id:11,head_sha:revision,status:"completed",conclusion:"failure"}];await assert.rejects(f.run(),/CI/);
});
test("both trusted security analyses must pass for the same release commit",async()=>{
  const f=fixture();f.state.checks.pop();await assert.rejects(f.run(),/security analysis/);
  const g=fixture();g.state.checks[0].conclusion="skipped";await assert.rejects(g.run(),/security analysis/);
  const h=fixture();h.state.checks[0].app.slug="other-app";await assert.rejects(h.run(),/security analysis/);
});

const existingRelease = createRequire(import.meta.url)("../.github/scripts/release-registry.cjs");
test("a missing registry image can be published, but authentication and network failures cannot",()=>{
  for(const [stderr,missing] of [["ERROR: ghcr.io/example/beacon:v2026.10.27: not found",true],["manifest unknown",true],["unauthorized: authentication required",false],["connect: connection refused",false],["500 Internal Server Error",false]] as const){
    const outputs:Record<string,string>={};
    const run=()=>existingRelease({image:"ghcr.io/example/beacon",tag:"v2026.10.27",revision,version:"2026.10.27",core:{setOutput:(key:string,value:string)=>{outputs[key]=value;}},inspect:()=>{throw {stderr};}});
    if(missing){run();assert.equal(outputs.exists,"false");}else{assert.throws(run,/publication stopped/);assert.deepEqual(outputs,{});}
  }
});
test("a published image is reused only when both version and commit match",()=>{
  const digest="sha256:"+"b".repeat(64),outputs:Record<string,string>={};
  const annotations={"org.opencontainers.image.revision":revision,"org.opencontainers.image.version":"2026.10.27"};
  const run=()=>existingRelease({image:"ghcr.io/example/beacon",tag:"v2026.10.27",revision,version:"2026.10.27",core:{setOutput:(key:string,value:string)=>{outputs[key]=value;}},inspect:(args:string[])=>args[0]==="--raw"?JSON.stringify({annotations}):digest});
  run();assert.deepEqual(outputs,{exists:"true",digest});
  annotations["org.opencontainers.image.revision"]="c".repeat(40);assert.throws(run,/refusing to overwrite/);
  annotations["org.opencontainers.image.revision"]=revision;annotations["org.opencontainers.image.version"]="2.0.0";assert.throws(run,/refusing to overwrite/);
});
