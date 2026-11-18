import {db} from '../core/db.js';
export const DEFAULT_LIFE_PATH_ID='life_path_balanced';
export function getAvailableLifePaths(){
 const p=db.raw.coreRules?.game_constants?.life_paths;
 return Array.isArray(p)&&p.length?p:[{path_id:DEFAULT_LIFE_PATH_ID,name_th:'สมดุลทุกด้าน',description_th:'กระจายเหตุการณ์ตามน้ำหนักพื้นฐานของเกม',event_pool_weight_multipliers:{life_phase:1,career:1,relationship:1,location_karma:1}}];
}
export function normalizeLifePathId(id){
 const paths=getAvailableLifePaths();return paths.some(x=>x.path_id===id)?id:(paths.find(x=>x.path_id===DEFAULT_LIFE_PATH_ID)?.path_id||paths[0].path_id);
}
export function getLifePathPoolWeights(pathId,baseWeights={}){
 const paths=getAvailableLifePaths(),path=paths.find(x=>x.path_id===pathId)||paths.find(x=>x.path_id===DEFAULT_LIFE_PATH_ID)||paths[0];
 const mult=path?.event_pool_weight_multipliers||{},out={};
 for(const [k,v] of Object.entries(baseWeights))out[k]=Number((Math.max(0,Number(v||0))*Math.max(0,Number(mult[k]??1))).toFixed(4));
 return out;
}
