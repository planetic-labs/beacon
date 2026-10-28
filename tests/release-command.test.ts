import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const script=fileURLToPath(new URL("../scripts/release.sh",import.meta.url));
const day="v2026.10.27",sha="a".repeat(40);
function run({tags=[],releases=[],scenario="",args=[]}:{tags?:string[];releases?:string[];scenario?:string;args?:string[]}={}){
 const root=mkdtempSync(join(tmpdir(),"beacon-release-command-"));
 try{
  writeFileSync(join(root,"gh"),`#!/usr/bin/env node
const fs=require('node:fs');const a=process.argv.slice(2),s=process.env.FAKE_SCENARIO,p=a.find(v=>v.startsWith('repos/'))||'';
fs.appendFileSync(process.env.FAKE_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='api'&&a.includes('--help')){console.log(s==='old-cli'?'Usage: gh api':'Usage: gh api --slurp');process.exit(0);}
if(a[0]==='repo'){console.log('example/beacon');process.exit(0);}
if(a[0]==='release'){
 if(s==='publish-failure')process.exit(1);
 console.log('https://github.com/example/beacon/releases/tag/'+a[2]);process.exit(0);
}
if(p.endsWith('/branches/main'))console.log('${sha}');
else if(p.endsWith('/checks.yml/runs'))console.log(s==='ci-pending'?'':'${sha}');
else if(p.includes('/check-runs?')){
 if(!a.includes('--paginate')||!a.includes('--slurp'))process.exit(4);
 const check=(name,id,conclusion,app='github-actions',status='completed')=>({name,id,conclusion,status,app:{slug:app}});
 const pages=[{check_runs:[check('Analyze (actions)',10,'success')]},
   {check_runs:[check('Analyze (javascript-typescript)',20,s==='codeql-failure'?'failure':'success')]}];
 if(s==='newer-check-failed')pages[1].check_runs.push(check('Analyze (actions)',30,'failure'));
 if(s==='older-check-failed')pages[1].check_runs.push(check('Analyze (actions)',5,'failure'));
 if(s==='newer-check-pending')pages[1].check_runs.push(check('Analyze (actions)',30,null,'github-actions','in_progress'));
 if(s==='missing-check')pages[1].check_runs=[];
 if(s==='untrusted-check')pages[1].check_runs[0].app.slug='untrusted-app';
 if(s==='untrusted-newer-failure')pages[1].check_runs.push(check('Analyze (actions)',30,'failure','untrusted-app'));
 if(s==='later-page-failed'){console.error('page failed');process.exit(1);}
 if(a.includes('--jq')||a.includes('--template')){console.error('slurp cannot be combined with projections');process.exit(2);}
 console.log(JSON.stringify(pages));
}
else if(p.includes('/tags?')){
 if(!a.includes('--paginate'))process.exit(4);
 console.log(process.env.FAKE_TAGS);
 if(fs.existsSync(process.env.FAKE_OCCUPIED))console.log('${day}');
}
else if(p.includes('/releases?')){
 if(!a.includes('--paginate'))process.exit(4);
 console.log(process.env.FAKE_RELEASES);
}
else if(p.endsWith('/git/refs')){
 if(s==='conflict'&&!fs.existsSync(process.env.FAKE_OCCUPIED)){
  fs.writeFileSync(process.env.FAKE_OCCUPIED,'yes');console.error('HTTP 422: Reference already exists');process.exit(1);
 }
 if(s==='network-failure'){console.error('connection refused');process.exit(1);}
 if(s==='permission-failure'){console.error('HTTP 403: forbidden');process.exit(1);}
}
else if(p.includes('/git/ref/tags/')){if(!fs.existsSync(process.env.FAKE_OCCUPIED))process.exit(1);}
else process.exit(3);
`,{mode:0o755});
  // Use real jq where available; minimal CI uses a fixed projection fixture.
  const jq=spawnSync("sh",["-c","command -v jq"],{encoding:"utf8"});
  writeFileSync(join(root,"jq"),`#!/usr/bin/env node
const a=process.argv.slice(2),cp=require('node:child_process');
if(process.env.FAKE_REAL_JQ){const r=cp.spawnSync(process.env.FAKE_REAL_JQ,a,{stdio:'inherit'});process.exit(r.status??1);}
const s=process.env.FAKE_SCENARIO;
console.log(['codeql-failure','newer-check-failed','newer-check-pending','missing-check','untrusted-check'].includes(s)?1:2);
`,{mode:0o755});
  writeFileSync(join(root,"date"),"#!/bin/sh\n[ \"$TZ\" = Europe/Moscow ] || exit 1\nprintf '2026.10.27\\n'\n",{mode:0o755});
  const result=spawnSync("sh",[script,...args],{encoding:"utf8",env:{...process.env,PATH:`${root}:${process.env.PATH}`,FAKE_REAL_JQ:jq.status===0?jq.stdout.trim():"",FAKE_SCENARIO:scenario,FAKE_TAGS:tags.join("\n"),FAKE_RELEASES:releases.join("\n"),FAKE_LOG:join(root,"calls"),FAKE_OCCUPIED:join(root,"occupied")}});
  const calls:string[][]=existsSync(join(root,"calls"))?readFileSync(join(root,"calls"),"utf8").trim().split("\n").map(line=>JSON.parse(line)):[];
  return {...result,calls};
 }finally{rmSync(root,{recursive:true,force:true});}
}
const published=(calls:string[][])=>calls.filter(call=>call[0]==="release");
test("first release is dated in Moscow and pinned to the checked remote commit",()=>{
 const r=run();assert.equal(r.status,0,r.stderr);const command=published(r.calls)[0];
 assert.equal(command[2],day);assert.equal(command[command.indexOf("--target")+1],sha);assert.ok(command.includes("--verify-tag"));
 const reserve=r.calls.find(call=>call.includes("repos/example/beacon/git/refs"))!;assert.ok(reserve.includes(`sha=${sha}`));assert.ok(reserve.includes(`ref=refs/tags/${day}`));
});
test("uses the maximum patch across tags and draft releases, ignoring unrelated names",()=>{
 const r=run({tags:[day,`${day}-patch2`,"v2026.10.26-patch99",`${day}-patch.30`],releases:[`${day}-patch10`]});
 assert.equal(r.status,0,r.stderr);assert.equal(published(r.calls)[0][2],`${day}-patch11`);
 const baseOnly=run({tags:[day]});assert.equal(published(baseOnly.calls)[0][2],`${day}-patch1`);
});
test("dry-run has no writes and pending or failed checks cannot create releases",()=>{
 const dry=run({args:["--dry-run"]});assert.equal(dry.status,0);assert.match(dry.stdout,/Dry run/);assert.equal(published(dry.calls).length,0);assert.equal(dry.calls.some(call=>call.includes("POST")),false);
 for(const scenario of ["ci-pending","codeql-failure"]){const r=run({scenario});assert.notEqual(r.status,0);assert.equal(r.calls.some(call=>call.includes("POST")),false);assert.equal(published(r.calls).length,0);}
});
test("concurrent tag reservations retry, but network and permission failures stop",()=>{
 const r=run({scenario:"conflict"});assert.equal(r.status,0,r.stderr);assert.equal(published(r.calls)[0][2],`${day}-patch1`);
 for(const scenario of ["network-failure","permission-failure"]){const failed=run({scenario});assert.notEqual(failed.status,0);assert.equal(published(failed.calls).length,0);}
});
test("failed publication leaves the reserved tag intact and reports recovery",()=>{
 const r=run({scenario:"publish-failure"});assert.notEqual(r.status,0);assert.match(r.stderr,/tag was kept/);assert.equal(r.calls.some(call=>call.includes("DELETE")),false);
});

test("all CodeQL pages are checked and the newest trusted result wins with native --slurp",()=>{
 const old=run({scenario:"older-check-failed",args:["--dry-run"]});assert.equal(old.status,0,old.stderr);
 for(const scenario of ["newer-check-failed","newer-check-pending","missing-check","untrusted-check","later-page-failed"]){
  const r=run({scenario});assert.notEqual(r.status,0);assert.equal(published(r.calls).length,0);assert.equal(r.calls.some(call=>call.includes("POST")),false);
 }
});

test("untrusted newer runs cannot replace GitHub Actions results",()=>{
 const r=run({scenario:"untrusted-newer-failure",args:["--dry-run"]});assert.equal(r.status,0,r.stderr);
});
test("outdated CLI fails clearly before any repository access or writes",()=>{
 const r=run({scenario:"old-cli"});assert.notEqual(r.status,0);assert.match(r.stderr,/Update GitHub CLI/);
 assert.equal(r.calls.length,1);assert.deepEqual(r.calls[0],["api","--help"]);
});
