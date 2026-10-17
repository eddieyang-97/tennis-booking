import {scenarios} from './scenarios.js';
const at=process.argv.indexOf('--scenario'),requested=at>=0?process.argv[at+1]:null;
if(requested&&!Object.hasOwn(scenarios,requested))throw Error('Unknown scenario');
for(const [name,run] of Object.entries(scenarios)){
 if(requested&&name!==requested)continue;
 try{await run();console.log(JSON.stringify({scenario:name,evidence:'simulation',outcome:'passed'}));}
 catch(error){console.error(JSON.stringify({scenario:name,evidence:'simulation',outcome:'failed',invariant:error.code||error.name}));process.exitCode=1;}
}
