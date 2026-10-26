const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const image = { large: 'https://lain.bgm.tv/pic/cover/l/fixture.jpg' };
const tv = { id: 101, type: 2, platform: 'TV', name: 'Fixture Anime II', name_cn: '动画第二季', summary: 'Overview', date: '2026-01-16', images: image, rating: { score: 8.2, total: 30 }, tags: [{name:'Fantasy'}], infobox: [{key:'别名',value:[{v:'Alternate'}]},{key:'动画制作',value:'Studio'}] };
const movie = { ...tv, id: 102, platform: '剧场版', name: 'Fixture Movie' };
const person = { id: 201, name:'Fixture Person', type:1, summary:'Biography', career:['seiyu'], birth_year:1989, birth_mon:2, birth_day:25, images:image };
const episode = (ep, sort = ep, type = 0) => ({id:500+sort,subject_id:101,type,ep,sort,name:'Episode '+ep,name_cn:'第'+ep+'集',duration_seconds:1440,airdate:'2026-01-16'});
const responses = {
  'https://bgm.tv/oauth/token_status': {access_token:'fixture-private-token',expires:4102444800},
  '/subjects/400602': {...tv,id:400602},
  '/search/subjects?limit=50&offset=0': {total:2,data:[tv,movie]},
  '/search/persons?limit=50&offset=0': {total:2,data:[person,{...person,id:202,type:2}]},
  '/subjects/101':tv, '/subjects/102':movie, '/persons/201':person,
  '/subjects/101/persons':[{...person,relation:'导演'},{id:202,type:2,name:'Studio',relation:'动画制作'}],
  '/subjects/102/persons':[{...person,relation:'导演'}],
  '/subjects/101/characters':[{id:301,name:'Hero',actors:[person]}],
  '/subjects/102/characters':[{id:301,name:'Hero',actors:[person]}],
  '/episodes?subject_id=101&limit=200&offset=0':{total:4,data:[episode(1,29),episode(2,30),episode(0,0,1),episode(0,1,2)]},
};
function setup(overrides={}, config={}, request={}) {
  const context = vm.createContext({module:{exports:{}},URL:undefined,URLSearchParams:undefined,Buffer:undefined,console:undefined,fetch:undefined,setTimeout:undefined,Intl:undefined});
  vm.runInContext(fs.readFileSync(path.join(root,'index.js'),'utf8'), context);
  const calls=[];
  const ctx={config:{...Object.fromEntries(manifest.config.map(f=>[f.key,f.default])),apiKey:'fixture-private-token',language:'zh-CN',...config},request,log:{warn(){}},app:{version:'0.1.1',locale:'en'},fetch:async(url,opts)=>{
    if(url==='https://bgm.tv/oauth/token_status') {
      assert.equal(opts.method,'POST');assert.equal(opts.body,'access_token=fixture-private-token');
      assert.equal(opts.headers.Authorization,undefined);
    } else assert.equal(opts.headers.Authorization,'Bearer fixture-private-token');
    assert.match(opts.headers['User-Agent'],/InscuraApp\/inscura-plugin-bangumi\/0\.0\.1/);
    const route=url.replace('https://api.bgm.tv/v0','');calls.push({route,opts});
    const data=Object.hasOwn(overrides,route)?overrides[route]:responses[route];
    if(data instanceof Error)throw data;
    if(!data)throw Error('Unmatched fixture: '+route);
    if(data.__status)return {ok:false,status:data.__status};
    return {ok:true,status:200,json:async()=>{if(data.__invalid)throw Error('private response');return structuredClone(data);}};
  }};
  return {plugin:context.module.exports,ctx,calls};
}
const plain = x=>JSON.parse(JSON.stringify(x));
for (const cap of ['media','tv','actor']) {
  const search={media:'searchMedia',tv:'searchTv',actor:'searchActors'}[cap];
  const detail={media:'getMediaDetail',tv:'getTvDetail',actor:'getActorDetail'}[cap];
  test(cap+': search → detail preserves identity, source images, credits and contract names',async()=>{
    const {plugin,ctx,calls}=setup(); assert.equal((await plugin.test(ctx)).ok,true); assert.ok(calls.every(x=>!x.route.includes('/me')));
    const hits=await plugin[search]('Fixture',ctx);assert.equal(hits.length,1);
    const item=await plugin[detail](hits[0].provider,hits[0].id,ctx);
    assert.equal(item.id,hits[0].id);assert.equal(item.provider,'bangumi');
    assert.ok(item[cap==='media'?'bigThumbUrl':cap==='tv'?'poster':'avatar']);
    if(cap!=='actor') {assert.equal(item.cast[0].providerActorId,'201');assert.equal(item.cast[0].roles[0].character,'Hero');assert.equal(item.crew.length,1);}
    if(cap==='media') {assert.equal(item.summary,'Overview');assert.equal(item.score,8.2);assert.equal(item.description,undefined);}
    if(cap==='actor')assert.equal(item.birthday,'1989-02-25');
    assert.ok(!JSON.stringify(item).includes('fixture-private-token'));
  });
  test(cap+': no match, missing data and images off',async()=>{
    const route=cap==='actor'?'/search/persons?limit=50&offset=0':'/search/subjects?limit=50&offset=0';
    let s=setup({[route]:{total:0,data:[]}});assert.equal((await s.plugin[search]('no-match',s.ctx)).length,0);
    const id=cap==='media'?'102':cap==='tv'?'101':'201';
    const item=cap==='actor'?{id:201,type:1,name:'Person'}:{id:Number(id),type:2,name:'Anime',platform:cap==='media'?'剧场版':'TV'};
    s=setup({['/'+(cap==='actor'?'persons':'subjects')+'/'+id]:item});
    const result=await s.plugin[detail]('bangumi',id,s.ctx);assert.equal(result[cap==='media'?'bigThumbUrl':cap==='tv'?'poster':'avatar'],undefined);
    s=setup({}, {includeImages:false});
    const hits=await s.plugin[search]('Fixture',s.ctx); const off=await s.plugin[detail]('bangumi',id,s.ctx);
    assert.ok(!JSON.stringify([hits,off]).includes('lain.bgm.tv'));
  });
  for (const failure of [401,403,404,429,500,'invalid','network','malformed']) test(cap+': '+failure+' throws instead of returning empty results',async()=>{
    const id=cap==='media'?'102':cap==='tv'?'101':'201';
    const route='/'+(cap==='actor'?'persons':'subjects')+'/'+id;
    const response=typeof failure==='number'?{__status:failure}:failure==='invalid'?{__invalid:true}:failure==='network'?new Error('secret network details'):{id:0};
    const s=setup({[route]:response});await assert.rejects(()=>s.plugin[detail]('bangumi',id,s.ctx),e=>!e.message.includes('secret network details'));
  });
}
test('missing token and malformed search page are errors',async()=>{
  let s=setup({}, {apiKey:''});await assert.rejects(()=>s.plugin.test(s.ctx),/access token/);
  s=setup({'/search/subjects?limit=50&offset=0':{}});await assert.rejects(()=>s.plugin.searchTv('Anime',s.ctx),/page response/);
});
test('TV local numbering uses ep=1, not cumulative sort=29; SP0 is preserved; OP excluded',async()=>{
  const s=setup();const result=await s.plugin.getTvDetail('bangumi','101',s.ctx);
  assert.deepEqual(plain(result.episodes.map(x=>[x.seasonNumber,x.episodeNumber])),[[1,1],[1,2],[0,0]]);
  assert.equal(result.episodes[0].runtime,24);
});
test('TV scope returns exact local episodes and complete catalogs; empty season only gets catalog',async()=>{
  const s=setup({}, {}, {tvScope:{seasons:[{seasonNumber:1,episodeNumbers:[2]},{seasonNumber:0,episodeNumbers:[]}]}});
  const r=await s.plugin.getTvDetail('bangumi','101',s.ctx);
  assert.deepEqual(plain(r.episodes.map(x=>x.episodeNumber)),[2]);assert.equal(r.seasons.length,1);
  assert.deepEqual(plain(r.episodeCatalogs[0].episodes.map(x=>x.episodeNumber)),[1,2]);assert.equal(r.episodeCatalogs.length,2);
});
test('empty or unsupported season scope skips episode requests',async()=>{
  for(const seasons of [[],[{seasonNumber:2,episodeNumbers:[1]}]]) {
    const s=setup({}, {}, {tvScope:{seasons}});const r=await s.plugin.getTvDetail('bangumi','101',s.ctx);
    assert.equal(r.episodes,undefined);assert.ok(!s.calls.some(x=>x.route.startsWith('/episodes')));
  }
});
test('fractional or duplicate numbers never produce a false complete catalog',async()=>{
  for(const data of [[episode(1),episode(1.5)],[episode(1),episode(1)]]) {
    const s=setup({'/episodes?subject_id=101&limit=200&offset=0':{total:2,data}});
    const r=await s.plugin.getTvDetail('bangumi','101',s.ctx);assert.equal(r.episodeCatalogs.length,0);
  }
});
test('pagination must finish; changed, stalled, or failed pages throw',async()=>{
  const first='/episodes?subject_id=101&limit=200&offset=0', next='/episodes?subject_id=101&limit=200&offset=1';
  let s=setup({[first]:{total:2,data:[episode(1)]},[next]:{total:2,data:[episode(2)]}});
  assert.equal((await s.plugin.getTvDetail('bangumi','101',s.ctx)).episodeCatalogs[0].episodes.length,2);
  for(const bad of [{total:2,data:[]},{total:3,data:[episode(2)]},{__status:429}]) {
    s=setup({[first]:{total:2,data:[episode(1)]},[next]:bad});await assert.rejects(()=>s.plugin.getTvDetail('bangumi','101',s.ctx));
  }
});
test('provider, capability, year and language boundaries',async()=>{
  let s=setup({}, {}, {provider:'other'});await assert.rejects(()=>s.plugin.searchTv('Anime',s.ctx));
  s=setup();await assert.rejects(()=>s.plugin.getActorDetail('bangumi','102',s.ctx));
  await assert.rejects(()=>s.plugin.getMediaDetail('bangumi','101',s.ctx));
  s=setup({}, {language:'ja'}, {year:2026});const hits=await s.plugin.searchTv('Anime',s.ctx);
  assert.equal(hits[0].title,tv.name);assert.deepEqual(JSON.parse(s.calls[0].opts.body).filter.air_date,['>=2026-01-01','<2027-01-01']);
});
test('five-language config and field declarations; numeric/image fields are not translatable',()=>{
  const labels=[...manifest.config,...Object.values(manifest.providers).flat(),...Object.values(manifest.scrapeFields).flat()];
  for(const item of labels)for(const key of ['label','help','placeholder'])if(item[key])for(const locale of ['en','zh-CN','zh-TW','ja','ko'])assert.ok(item[key][locale],key+': '+locale);
  for(const field of Object.values(manifest.scrapeFields).flat())if(['rating','birthday','year','firstAired','releaseDate','originalTitle','avatar','poster','portraitCover','gender'].includes(field.key))assert.equal(field.translatable,false,field.key);
});
// Portable fixtures for the official toolkit's validate/run/smoke commands.
if (process.env.WRITE_FIXTURES === '1') {
  fs.writeFileSync(path.join(root,'fixtures/api.json'),JSON.stringify({requests:Object.entries(responses).map(([route,json])=>({url:route.startsWith('https:')?route:'https://api.bgm.tv/v0'+route,method:route.startsWith('/search/')||route.endsWith('/token_status')?'POST':'GET',json}))},null,2)+'\n');
}

test('OAuth status rejects invalid or expired tokens even if wiki GET is cached successfully',async()=>{
  for(const status of [{__status:401},{__status:429},{__invalid:true},{access_token:'fixture-private-token',expires:1},{access_token:'wrong-token',expires:4102444800},{}]) {
    const s=setup({'https://bgm.tv/oauth/token_status':status});
    await assert.rejects(()=>s.plugin.test(s.ctx));
    assert.ok(!s.calls.some(x=>x.route==='/subjects/400602'));
  }
});

test('host underscore and standard hyphen Chinese locales preserve source Chinese titles',async()=>{
 for(const language of ['zh_CN','zh_TW','zh_Hans','zh-CN','zh-TW','zh']) {
  const s=setup({}, {language});
  assert.equal((await s.plugin.searchTv('Anime',s.ctx))[0].title,'动画第二季');
  const result=await s.plugin.getTvDetail('bangumi','101',s.ctx);
  assert.equal(result.title,'动画第二季');assert.equal(result.episodes[0].title,'第1集');
 }
});
