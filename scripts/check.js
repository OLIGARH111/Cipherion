import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
let failed=false;
for(const directory of ['server','public','tests','scripts'])for(const file of readdirSync(directory).filter(f=>f.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',directory+'/'+file],{stdio:'inherit'});if(result.status!==0)failed=true;}
process.exitCode=failed?1:0;
