const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
function walk(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const files=['src','scripts','test'].flatMap(walk).filter(file=>/\.(?:cjs|js)$/.test(file));let failures=0;
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){console.error(file,result.stderr);failures++;}}
for(const required of ['src/renderer/index.html','src/renderer/styles.css','src/preload.cjs','src/native/SpeechHost.cs','src/native/speech-host.ps1'])if(!fs.existsSync(required)){console.error('Missing',required);failures++;}
console.log(`Syntax and required assets: ${files.length} JavaScript files checked; ${failures} failures.`);process.exitCode=failures?1:0;
