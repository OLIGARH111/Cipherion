import test from 'node:test';
import assert from 'node:assert/strict';
import {allowed} from '../server/permissions.js';
const chat={permissions:JSON.stringify({text:true,photo:true,info:false})};
test('banned users have no permissions, including with forged admin grants',()=>assert.equal(allowed({role:'banned',rules:'{"admin":{"info":true}}'},chat,'info'),false));
test('owner has all permissions',()=>assert.equal(allowed({role:'owner'},chat,'ban'),true));
test('ordinary members cannot access administrative operations',()=>assert.equal(allowed({role:'member',rules:'{}'},chat,'ban'),false));
test('individual restrictions override group defaults and expire',()=>{const member={role:'member',rules:JSON.stringify({overrides:{text:false,info:true},until:200})};assert.equal(allowed(member,chat,'text',100),false);assert.equal(allowed(member,chat,'info',100),true);assert.equal(allowed(member,chat,'text',300),true);assert.equal(allowed(member,chat,'info',300),false);});
test('admins receive only explicitly granted administrative permissions',()=>{const member={role:'admin',rules:'{"admin":{"ban":true}}'};assert.equal(allowed(member,chat,'ban'),true);assert.equal(allowed(member,chat,'permissions'),false);});
