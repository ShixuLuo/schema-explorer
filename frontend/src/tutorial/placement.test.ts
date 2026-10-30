import test from 'node:test';
import assert from 'node:assert/strict';
import {placePopover,type Box} from '../shared/floating-placement.ts';
const overlaps=(a:Box,b:Box)=>a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;
for (const panelOpen of [true,false]) test(`migration instructions leave fields, Advanced, and footer controls clear (parameters ${panelOpen?'open':'hidden'})`,()=>{
  const viewport={width:1280,height:720};
  const controls:Box[]=[
    {left:140,top:248,width:675,height:34},
    {left:140,top:344,width:675,height:22},
    {left:140,top:572,width:44,height:30},
    {left:1000,top:572,width:60,height:30},
    {left:1070,top:572,width:70,height:30},
    {left:975,top:128,width:168,height:24},
    ...(panelOpen?[{left:840,top:168,width:306,height:384}]:[]),
  ];
  const box=placePopover({left:115,top:110,width:1050,height:510},{width:300,height:320},viewport,controls,false);
  assert.ok(controls.every(control=>!overlaps(box,control)),JSON.stringify(box));
  assert.ok(box.left>=12&&box.top>=12&&box.left+box.width<=1268&&box.top+box.height<=708);
});
test('a small highlighted control stays clear and placement is deterministic',()=>{
  const target={left:1100,top:30,width:32,height:32};
  const args=[target,{width:300,height:240},{width:1280,height:720},[target],true] as const;
  const box=placePopover(...args);
  assert.ok(!overlaps(box,target));
  assert.deepEqual(placePopover(...args),box);
});
test('limited space keeps the entire card inside the viewport',()=>{
  const box=placePopover({left:0,top:0,width:320,height:480},{width:300,height:480},{width:320,height:480},[{left:0,top:0,width:320,height:480}],false);
  assert.ok(box.left>=12&&box.top>=12&&box.left+box.width<=308&&box.top+box.height<=468);
});

test('relation controls and tutorial instructions fit around the visible diagram labels',()=>{
  const canvas={width:1280,height:584};
  const nodes:Box[]=[
    {left:203,top:153,width:125,height:276},
    {left:553,top:150,width:173,height:66},
    {left:553,top:250,width:173,height:66},
    {left:553,top:350,width:173,height:66},
    {left:953,top:253,width:125,height:68},
    {left:381,top:399,width:128,height:18},
    {left:395,top:274,width:110,height:18},
    {left:739,top:323,width:45,height:20},
  ];
  const guide={left:902,top:323,width:300,height:296};
  const box=placePopover({left:380,top:392,width:0,height:0},{width:520,height:174},canvas,[...nodes,guide],false);
  assert.ok([...nodes,guide].every(o=>!overlaps(box,o)),JSON.stringify(box));
});

test('a narrow clear strip is preferable to covering a target-field explanation',()=>{
  const target={left:120,top:106,width:1040,height:508};
  const visible:Box[]=[
    {left:141,top:250.5,width:678,height:33},
    {left:141,top:344,width:678,height:22},
    {left:840,top:168,width:306,height:384},
    {left:141,top:572,width:44,height:30},
    {left:1000,top:572,width:140,height:30},
  ];
  const guide=placePopover(target,{width:300,height:321},{width:1280,height:720},visible,false);
  assert.ok(visible.every(o=>!overlaps(guide,o)));
});
