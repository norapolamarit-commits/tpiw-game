import { applyStatEffects } from './stat_engine.js';

const KEYS=['health','happiness','intelligence','connections','appearance'];
export function resetAnnualPassiveStatEffects(state){if(state?.turn)state.turn.annualPassiveStatEffects={};}
export function collectAnnualPassiveStatEffects(state,effects){
 if(!state?.turn||!effects||typeof effects!=='object')return;
 if(!state.turn.annualPassiveStatEffects||typeof state.turn.annualPassiveStatEffects!=='object')state.turn.annualPassiveStatEffects={};
 for(const key of [...KEYS,'merit','karma']){
  const v=Number(effects[key]??0);if(Number.isFinite(v)&&v!==0)state.turn.annualPassiveStatEffects[key]=Number(state.turn.annualPassiveStatEffects[key]||0)+v;
 }
}
export function applyAnnualPassiveStatEffects(state,capRules=[]){
 if(!state?.stats||!state?.turn)return{};
 const totals=state.turn.annualPassiveStatEffects||{},applied={},capped={};
 for(const key of KEYS){
  const current=Number(state.stats[key]||0),total=Number(totals[key]||0);
  const rule=Array.isArray(capRules)?capRules.find(x=>current>=Number(x.min_stat??0)&&current<=Number(x.max_stat??100)):null;
  const cap=Math.max(0,Number(rule?.max_positive_gain??3));
  capped[key]=Math.min(Math.max(0,total),cap)+Math.min(0,total);
 }
 const resolved=applyStatEffects(state,{...capped,merit:Number(totals.merit||0),karma:Number(totals.karma||0)});
 for(const key of [...KEYS,'merit'])applied[key]=resolved[key]||0;
 state.turn.annualPassiveStatEffects={};return applied;
}
