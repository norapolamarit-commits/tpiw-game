const PARENTS=new Set(['npc_arch_father','npc_arch_mother']);
export function getParentalSupportMultiplier(state,rules={}){
 const list=state?.relationships?.npcs;if(!Array.isArray(list))return 1;
 const parents=list.filter(n=>PARENTS.has(n?.archetypeId));if(!parents.length)return 1;
 const living=parents.filter(n=>n.isAlive!==false);if(!living.length)return 0;
 const avg=living.reduce((sum,n)=>sum+Math.min(100,Math.max(0,Number(n.relationship??50))),0)/living.length;
 const factor=Number(rules.base??0.6)+Number(rules.relationship_scale??0.4)*(avg/100);
 return Math.min(1,Math.max(0,factor*(living.length===1?Number(rules.single_parent_multiplier??0.7):1)));
}
/** Direct-paid support is household assistance, never player cash or net worth. */
export function calculateParentalSupport({state,age,baseAnnualSupport,gameConstants={}}){
 const currentAge=Math.floor(Number(age??state?.profile?.age??0)),base=Math.max(0,Number(baseAnnualSupport||0));
 const supportMultiplier=getParentalSupportMultiplier(state,gameConstants.parent_support_relationship_multiplier||{});
 const familySupportCapacity=Math.round(base*supportMultiplier);
 if(currentAge<0||currentAge>17||base<=0||supportMultiplier<=0)return{cashAllowance:0,familyPaidSupport:0,familySupportCapacity,supportMultiplier,ageRate:0};
 const bands=Array.isArray(gameConstants.parent_allowance_by_age)?gameConstants.parent_allowance_by_age:[];
 const band=bands.find(x=>currentAge>=Number(x.min_age)&&currentAge<=Number(x.max_age));
 const ageRate=Math.max(0,Math.min(1,Number(band?.rate??0))),minimum=Math.max(0,Number(band?.minimum_annual_cash||0));
 let cashAllowance=Math.round(Math.max(familySupportCapacity*ageRate,minimum*supportMultiplier));
 if(currentAge<=6&&state?.innateTraits?.includes('trait_easy_baby'))cashAllowance=Math.round(cashAllowance*1.15);
 // The allowance is a transfer from the family's finite annual support budget.
 // A minimum allowance must never create money beyond that budget (notably class_1 at ages 13-17).
 const annualCashCap=Math.max(0,Number(gameConstants.max_annual_cash_allowance??Number.MAX_SAFE_INTEGER));
 cashAllowance=Math.min(familySupportCapacity,annualCashCap,Math.max(0,cashAllowance));
 return{cashAllowance,familyPaidSupport:Math.max(0,familySupportCapacity-cashAllowance),familySupportCapacity,supportMultiplier,ageRate};
}
