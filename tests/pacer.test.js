import test from 'node:test';
import assert from 'node:assert/strict';
import {createPacer,throttle} from '../server/pacer.js';

test('background jobs run every check while active and once a minute when idle',()=>{
  let t=0,runs=0;const pacer=createPacer({clock:()=>t});
  const check=pacer.every(1000,60_000,()=>{runs++;});pacer.stop();
  check();assert.equal(runs,1,'first check always runs');
  t=1000;check();assert.equal(runs,1,'idle: waits for the slow period');
  pacer.nudge();t=2000;check();assert.equal(runs,2,'active after a request');
  t=3000;check();assert.equal(runs,3);
  t=1000+120_000+1;check();assert.equal(runs,4,'idle again: runs once, a minute after the last run');
  t+=1000;check();assert.equal(runs,4,'idle: skips fast checks');
  t+=60_000;check();assert.equal(runs,5,'idle job still runs once a minute');
});

test('throttle runs rare cleanup at most once per period',()=>{
  let t=0,runs=0;const job=throttle(600_000,()=>runs++,()=>t);
  job();job();assert.equal(runs,1);t=600_000;job();assert.equal(runs,2);
});
