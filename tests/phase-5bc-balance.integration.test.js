import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DATA_MANIFEST,db} from '../js/core/db.js';
import {calculateParentalSupport,getParentalSupportMultiplier} from '../js/core/family_support.js';
import {createEmptyGameState,createNewCharacter} from '../js/core/state.js';
import {getAnnualEventPoolWeights} from '../js/engine/event_engine.js';
import {getLifePathPoolWeights,normalizeLifePathId} from '../js/engine/life_path_engine.js';
import {processAnnualCareerAndStudyProgression} from '../js/engine/career_edu_engine.js';
import {applyAnnualPassiveStatEffects,collectAnnualPassiveStatEffects,resetAnnualPassiveStatEffects} from '../js/core/annual_passive_stats.js';
const oldRaw=db.raw,oldLoaded=db.isLoaded,oldStorage=globalThis.localStorage,storage=new Map(),oldIndexes=Object.fromEntries(Object.entries(db.indexes).map(([k,m])=>[k,new Map(m)])),fixture={};
for(const [k,file] of Object.entries(DATA_MANIFEST))fixture[k]=JSON.parse(await readFile(fileURLToPath(new URL(`../data/${file}`,import.meta.url)),'utf8'));
test.beforeEach(()=>{storage.clear();globalThis.localStorage={getItem(k){return storage.has(k)?storage.get(k):null;},setItem(k,v){storage.set(k,String(v));},removeItem(k){storage.delete(k);}};db.raw=structuredClone(fixture);db.buildIndexes();db.isLoaded=true;});
test.after(()=>{db.raw=oldRaw;db.isLoaded=oldLoaded;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;for(const [k,m] of Object.entries(db.indexes)){m.clear();for(const [id,v] of oldIndexes[k])m.set(id,v);}});
function parents({fa=true,mo=true,fr=80,mr=85}={}){const s=createEmptyGameState();s.relationships.npcs=[{id:'f',archetypeId:'npc_arch_father',isAlive:fa,relationship:fr},{id:'m',archetypeId:'npc_arch_mother',isAlive:mo,relationship:mr}];return s;}

test('family allowance changes by age and separates direct-paid support from player cash',()=>{
 const s=parents(),g=db.getGameConstants(),base=24000;
 const a=calculateParentalSupport({state:s,age:4,baseAnnualSupport:base,gameConstants:g});
 const b=calculateParentalSupport({state:s,age:5,baseAnnualSupport:base,gameConstants:g});
 const c=calculateParentalSupport({state:s,age:7,baseAnnualSupport:base,gameConstants:g});
 const d=calculateParentalSupport({state:s,age:13,baseAnnualSupport:base,gameConstants:g});
 const adult=calculateParentalSupport({state:s,age:18,baseAnnualSupport:base,gameConstants:g});
 assert.equal(a.cashAllowance,0);assert.equal(a.familyPaidSupport,22320);
 assert.equal(b.cashAllowance,2232);assert.equal(c.cashAllowance,4464);assert.equal(d.cashAllowance,8928);
 assert.equal(adult.cashAllowance,0);assert.equal(adult.familyPaidSupport,0);
});
test('poor-family teen allowance is capped by the actual family support budget',()=>{
 const s=parents({fr:100,mr:100}),g=db.getGameConstants();
 const result=calculateParentalSupport({state:s,age:13,baseAnnualSupport:1200,gameConstants:g});
 assert.equal(result.familySupportCapacity,1200);
 assert.equal(result.cashAllowance,1200);
 assert.equal(result.familyPaidSupport,0);
 assert.ok(result.cashAllowance+result.familyPaidSupport<=result.familySupportCapacity);
});

test('high-income family allowance respects the annual personal-cash ceiling',()=>{
 const s=parents({fr:100,mr:100}),g=db.getGameConstants();
 const result=calculateParentalSupport({state:s,age:13,baseAnnualSupport:600000,gameConstants:g});
 assert.equal(result.cashAllowance,10000);
 assert.equal(result.familyPaidSupport,590000);
 assert.equal(result.cashAllowance+result.familyPaidSupport,result.familySupportCapacity);
});

test('parent relationship and household composition affect support multipliers',()=>{
 const rule=db.getGameConstants().parent_support_relationship_multiplier;
 assert.equal(getParentalSupportMultiplier(parents({fr:100,mr:100}),rule),1);
 assert.equal(getParentalSupportMultiplier(parents({fa:false,mr:100}),rule),0.7);
 assert.equal(getParentalSupportMultiplier(parents({fa:false,mo:false}),rule),0);
});
test('easy-baby boosts early-childhood allowance and low-income minimum is respected',()=>{
 const a=parents(),b=parents();b.innateTraits=['trait_easy_baby'];const g=db.getGameConstants();
 const x=calculateParentalSupport({state:a,age:5,baseAnnualSupport:1200,gameConstants:g});
 const y=calculateParentalSupport({state:b,age:5,baseAnnualSupport:1200,gameConstants:g});
 assert.equal(x.cashAllowance,279);assert.equal(y.cashAllowance,Math.round(x.cashAllowance*1.15));
 assert.equal(normalizeLifePathId('unknown'),'life_path_balanced');
});
test('Life Path biases event pools without excluding any pool',()=>{
 const base={life_phase:40,career:30,relationship:15,location_karma:15};
 const c=getLifePathPoolWeights('life_path_career',base),f=getLifePathPoolWeights('life_path_family',base),x=getLifePathPoolWeights('life_path_explorer',base);
 assert.deepEqual(getLifePathPoolWeights('life_path_balanced',base),base);
 assert.ok(c.career>c.life_phase);assert.ok(f.relationship>f.career);assert.ok(x.location_karma>x.relationship);
 assert.deepEqual(Object.keys(c).sort(),Object.keys(base).sort());
 const s=createEmptyGameState();s.profile.lifePathId='life_path_career';
 assert.equal(getAnnualEventPoolWeights(s).career,52.5);assert.equal(getAnnualEventPoolWeights(s).relationship,11.25);
});
test('new life stores selected Life Path and falls back for unknown IDs',()=>{
 const a=createNewCharacter('class_3','loc_bangkok','male','ทดสอบเส้นทาง',{purchasedTraitIds:['trait_quick_learner'],lifePathId:'life_path_family'});
 const b=createNewCharacter('class_3','loc_bangkok','male','ทดสอบสำรอง',{purchasedTraitIds:['trait_quick_learner'],lifePathId:'unknown'});
 assert.equal(a.profile.lifePathId,'life_path_family');assert.equal(b.profile.lifePathId,'life_path_balanced');
});
test('annual passive stat gains are cumulatively capped while negative effects remain full',()=>{
 const s=createEmptyGameState();Object.assign(s.stats,{health:70,happiness:85,intelligence:95,connections:70,merit:10});
 resetAnnualPassiveStatEffects(s);
 collectAnnualPassiveStatEffects(s,{health:2,happiness:3,intelligence:4,connections:3,merit:4});
 collectAnnualPassiveStatEffects(s,{health:2,happiness:-4,intelligence:-5,connections:3,merit:2});
 const r=applyAnnualPassiveStatEffects(s,db.getGameConstants().annual_passive_stat_gain_caps);
 assert.equal(r.health,1);assert.equal(r.happiness,-1);assert.equal(r.intelligence,-1);assert.equal(r.connections,1);assert.equal(r.merit,6);
 assert.deepEqual(s.turn.annualPassiveStatEffects,{});
});
test('annual career and study passives use the shared diminishing-gain cap',()=>{
 const s=createEmptyGameState();s.profile.age=15;s.careerAndEdu.currentActivityId='test_activity';
 s.stats.health=70;s.stats.intelligence=95;
 const originalGetActivity=db.getActivity;
 db.getActivity=(id)=>id==='test_activity'?{min_age:0,max_age:100,yearly_stat_effects:{health:5,intelligence:5}}:null;
 try{
  resetAnnualPassiveStatEffects(s);
  processAnnualCareerAndStudyProgression(s,{deferAnnualPassives:true});
  assert.equal(s.stats.health,70,'recurring career passives are deferred to the annual aggregator');
  const applied=applyAnnualPassiveStatEffects(s,db.getGameConstants().annual_passive_stat_gain_caps);
  assert.equal(applied.health,1);
  assert.equal(applied.intelligence,0);
   assert.ok(s.statCounters.statGainRemainders.intelligence > 0);
 } finally { db.getActivity=originalGetActivity; }
});

test('stacked Trait and Status multipliers remain within configured bounds',async()=>{
 const {getCombinedActionMultipliers}=await import('../js/engine/economy_engine.js');
 const s=createEmptyGameState();s.flags=['stack'];
 db.indexes.traitsAndFlags.set('stack',{id:'stack',category_group:'financial_and_legal_flags',action_multipliers:{study_efficiency:10,work_efficiency:10,business_income:10,medical_cost:0,lucky_draw_chance:10,vehicle_maintenance_cost:10,loan_interest_rate:10}});
 const r=getCombinedActionMultipliers(s);
 assert.equal(r.study_efficiency,1.75);assert.equal(r.work_efficiency,1.75);assert.equal(r.business_income,2);
 assert.equal(r.medical_cost,0);assert.equal(r.lucky_draw_chance,2.5);assert.equal(r.vehicle_maintenance_cost,2.5);assert.equal(r.loan_interest_rate,2.5);
});

test('age-based progression hides future license, education, job and shop entries', async () => {
 const {getAvailableEducationPrograms,getAvailableLicenses,getCategorizedJobsForUI}=await import('../js/engine/career_edu_engine.js');
 const {renderTab2WorkStudy}=await import('../js/ui/tab2_work_study.js');
 const {renderTab5LifestyleShop}=await import('../js/ui/tab5_lifestyle_shop.js');
 const s=createEmptyGameState();s.profile.age=12;s.flags=['flag_thai_id_card'];s.finance.cash=100000;s.finance.hasPiggyBankSmashed=true;s.turn.freeActionPoints=3;s.turn.maxFreeActionPoints=3;
 assert.equal(getAvailableLicenses(s).some(x=>x.license_id==='lic_motorcycle'),false);
 assert.equal(getAvailableEducationPrograms(s).length,0);
 assert.equal(Object.values(getCategorizedJobsForUI(s)).flat().length,0);
 const workHtml=renderTab2WorkStudy(s,{onRefresh(){}}).html;
 assert.equal(workHtml.includes('สอบใบอนุญาต'),false);
 assert.equal(workHtml.includes('มหาวิทยาลัย/ปวส.'),false);
 const shopHtml=renderTab5LifestyleShop(s,{onRefresh(){}}).html;
 assert.equal(shopHtml.includes('ยานพาหนะ'),false);
 assert.equal(shopHtml.includes('มอเตอร์ไซค์จ่ายตลาดมือสอง'),false);
});

test('motorcycle purchase requires the matching license even when age and cash are sufficient', async () => {
 const {buyShopItem}=await import('../js/engine/economy_engine.js');
 const s=createEmptyGameState();s.profile.age=15;s.finance.cash=100000;s.finance.hasPiggyBankSmashed=true;s.turn.freeActionPoints=3;
 const denied=buyShopItem(s,'asset_secondhand_motorcycle','cash');
 assert.equal(denied.success,false);
 s.flags.push('flag_motor_license');
 const allowed=buyShopItem(s,'asset_secondhand_motorcycle','cash');
 assert.equal(allowed.success,true);
});

test('repeatable resellable assets grant purchase stats only on first lifetime acquisition', async () => {
 const {buyShopItem}=await import('../js/engine/economy_engine.js');
 const s=createEmptyGameState();
 s.profile.age=15;s.finance.cash=100000;s.finance.hasPiggyBankSmashed=true;
 const first=buyShopItem(s,'item_flagship_iphone','cash');
 const happinessAfterFirst=s.stats.happiness;
 const second=buyShopItem(s,'item_flagship_iphone','cash');
 assert.equal(first.success,true);
 assert.equal(second.success,true);
 assert.equal(s.finance.ownedAssets.filter(x=>x.itemId==='item_flagship_iphone').length,2);
 assert.equal(s.stats.happiness,happinessAfterFirst,'second purchase must not repeat the asset-type stat reward');
 assert.deepEqual(s.finance.statRewardedRepeatableAssetTypes,['item_flagship_iphone']);
});

test('repeatable non-resellable purchases still grant their effects every time', async () => {
 const {buyShopItem}=await import('../js/engine/economy_engine.js');
 const s=createEmptyGameState();
 s.profile.age=20;s.finance.cash=2000;s.finance.hasPiggyBankSmashed=true;
 s.turn.freeActionPoints=3;
 const first=buyShopItem(s,'item_temple_sanghadana','cash');
 const second=buyShopItem(s,'item_temple_sanghadana','cash');
 assert.equal(first.success,true);
 assert.equal(second.success,true);
 assert.equal(s.stats.merit,10);
 assert.equal(s.turn.freeActionPoints,1);
});

test('school activity annual rewards are moderated while preserving distinct trade-offs', () => {
 const activities=new Map(db.raw.eduJobs.age_progression_activities.map(a=>[a.activity_id,a]));
 const study=activities.get('act_school_study_hard').yearly_stat_effects;
 const cram=activities.get('act_school_cram_class').yearly_stat_effects;
 const football=activities.get('act_school_football_club').yearly_stat_effects;
 const pc=activities.get('act_school_pc_cafe').yearly_stat_effects;
 const music=activities.get('act_school_music_art_club').yearly_stat_effects;
 assert.equal(study.intelligence,3);
 assert.equal(study.health,-1);
 assert.equal(cram.intelligence,4);
 assert.equal(cram.health,-2);
 assert.equal(cram.happiness,-2);
 assert.equal(football.health,3);
 assert.equal(football.connections,2);
 assert.equal(pc.happiness,3);
 assert.equal(pc.health,-2);
 assert.equal(music.connections,3);
 assert.equal(music.happiness,3);
 assert.ok(cram.intelligence>study.intelligence);
 assert.ok(football.health>study.health);
 assert.ok(music.connections>pc.connections);
});

test('higher education programs have moderated distinct annual intelligence gains', () => {
 const programs=new Map(db.raw.eduJobs.higher_education_programs.map(p=>[p.program_id,p]));
 assert.equal(programs.get('edu_deg_medicine').yearly_stat_effects.intelligence,5);
 assert.equal(programs.get('edu_deg_it').yearly_stat_effects.intelligence,5);
 assert.equal(programs.get('edu_deg_law').yearly_stat_effects.intelligence,4);
 assert.equal(programs.get('edu_deg_business').yearly_stat_effects.intelligence,3);
 assert.equal(programs.get('edu_deg_comm_arts').yearly_stat_effects.intelligence,3);
 assert.equal(programs.get('edu_high_vocational').yearly_stat_effects.intelligence,2);
 assert.ok(programs.get('edu_deg_medicine').yearly_stat_effects.health<0);
 assert.ok(programs.get('edu_deg_business').yearly_stat_effects.connections>
   programs.get('edu_deg_medicine').yearly_stat_effects.connections);
 assert.ok(programs.get('edu_deg_comm_arts').yearly_stat_effects.happiness>
   programs.get('edu_deg_it').yearly_stat_effects.happiness);
});

test('high responsibility careers exchange larger income for recurring wellbeing costs', () => {
 const jobs=new Map([
  ...db.raw.eduJobs.corporate_and_professional_careers,
  ...db.raw.eduJobs.civil_service_careers,
  ...db.raw.eduJobs.entrepreneur_and_business_careers
 ].map(j=>[j.job_id,j]));
 const ceo=jobs.get('career_c_level_ceo').yearly_stat_effects;
 const doctor=jobs.get('career_medical_doctor').yearly_stat_effects;
 const exec=jobs.get('career_multinational_exec').yearly_stat_effects;
 const manager=jobs.get('career_senior_manager').yearly_stat_effects;
 const gov=jobs.get('gov_high_ranking_official').yearly_stat_effects;
 const cafe=jobs.get('own_cafe_and_restaurant').yearly_stat_effects;
 assert.equal(ceo.health,-6);
 assert.equal(ceo.happiness,1);
 assert.equal(ceo.connections,5);
 assert.equal(doctor.health,-5);
 assert.equal(doctor.happiness,1);
 assert.equal(exec.health,-5);
 assert.equal(exec.happiness,1);
 assert.equal(manager.health,-4);
 assert.equal(manager.happiness,0);
 assert.equal(gov.health,-4);
 assert.equal(cafe.health,-4);
 assert.ok(ceo.health<manager.health);
 assert.ok(ceo.happiness<jobs.get('gov_civil_officer').yearly_stat_effects.happiness);
 assert.ok(doctor.merit===5);
});

test('life-course stat progression stress test keeps recurring gains bounded', () => {
 const constants=db.getGameConstants();
 const caps=constants.annual_passive_stat_gain_caps;
 const jobs=new Map([
  ...db.raw.eduJobs.corporate_and_professional_careers,
  ...db.raw.eduJobs.civil_service_careers
 ].map(j=>[j.job_id,j]));
 const runPath=(careerId)=>{
  const state=createEmptyGameState();
  state.stats.health=70;state.stats.happiness=70;
  state.stats.intelligence=50;state.stats.connections=50;state.stats.appearance=50;
  const career=jobs.get(careerId);
  for(let age=15;age<=65;age++){
   resetAnnualPassiveStatEffects(state);
   if(age<=17) collectAnnualPassiveStatEffects(state,{health:-1,happiness:-1,intelligence:3,connections:1});
   if(age>=18&&age<=23) collectAnnualPassiveStatEffects(state,{health:-1,happiness:0,intelligence:3,connections:2});
   if(age>=career.min_age) collectAnnualPassiveStatEffects(state,career.yearly_stat_effects);
   applyAnnualPassiveStatEffects(state,caps);
  }
  return state.stats;
 };
 const doctor=runPath('career_medical_doctor');
 const executive=runPath('career_c_level_ceo');
 for(const stats of [doctor,executive]){
  for(const key of ['health','happiness','intelligence','connections','appearance']){
   assert.ok(stats[key]>=0&&stats[key]<=100,`${key} remains within bounds`);
  }
  assert.ok(Object.values(stats).filter(v=>v===100).length<5,'a full life should not automatically max every core stat');
 }
 assert.ok(doctor.health<70,'long-term high-responsibility work accumulates a health cost');
 assert.ok(jobs.get('career_c_level_ceo').yearly_stat_effects.health<jobs.get('career_medical_doctor').yearly_stat_effects.health,'CEO annual Health penalty is larger than the medical role penalty');
 assert.ok(doctor.merit>executive.merit,'medical service retains its distinct Merit progression');
});
