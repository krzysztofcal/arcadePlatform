// Syntax check all JS/MJS + inline <script> in HTML
import fs from "node:fs"; import path from "node:path"; import fg from "fast-glob"; import * as acorn from "acorn";
const ROOT=process.cwd(); const patterns=["js/**/*.js","js/**/*.mjs","netlify/functions/**/*.mjs","**/*.html","!node_modules/**","!dist/**","!build/**","!**/*.min.js"];
const htmlRe=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi; const getAttr=(a,n)=>(new RegExp(`${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,"i").exec(a)||[])[2]??"";
function parse(code,t,f){acorn.parse(code,{ecmaVersion:"latest",sourceType:t,allowHashBang:!0});}
let fails=[]; const files=await fg(patterns,{dot:!1,cwd:ROOT});
for(const rel of files){const file=path.join(ROOT,rel);const src=fs.readFileSync(file,"utf8");
 if(rel.endsWith(".html")){let m;while((m=htmlRe.exec(src))!==null){const a=m[1]||"",c=m[2]||"";if(/\bsrc=/.test(a))continue;const t=(getAttr(a,"type")||"").toLowerCase();
   if(t&&t!=="module"&&t!=="application/javascript"&&t!=="text/javascript"&&t!=="")continue;
   try{parse(c,t==="module"?"module":"script",`${rel}<script>`);}catch(e){fails.push(`${rel}<script>: ${e.message}`);}}}
 else{try{parse(src,rel.endsWith(".mjs")?"module":"script",rel);}catch(e){fails.push(`${rel}: ${e.message}`);}}}
if(fails.length){console.error("✖ Syntax errors found:\n"+fails.map(f=>"  - "+f).join("\n"));process.exit(1);}else{console.log(`✔ Syntax OK (${files.length} files)`);}
