import { ADDITIONAL_RANDOM_TEMPLATES } from './additional_random_templates.js';
import { EVENT_CONFIG } from '../core/event_settings.js';

const make = (id, category, rarity, minAge, maxAge, title, description, choices, extra = {}) => ({
  id, category, rarity, minAge, maxAge, title, description, choices,
  triggerConditions: [], probabilityWeight: 1, cooldownTurns: EVENT_CONFIG.cooldownTurns, aiGenerated: false, ...extra
});

const diversity = (id, title, description, topic, listen, act, extra = {}) => make(
  `random_diversity_${id}`, 'diversity', 'uncommon', 13, 100, title, description,
  [
    { label: listen, effects: { connections: 2, intelligence: 1 } },
    { label: act, effects: { connections: 1, merit: 1, happiness: 1 } }
  ],
  { educationalTopic: topic, oncePerLife: true, ...extra }
);

const encounter = (id, age, title, description, name, genderIdentity, identityShared, roleTitle, label, extra = {}) => make(
  `random_meet_${id}`, 'friendship', 'uncommon', age, 85, title, description,
  [
    { label, effects: { connections: 2, happiness: 1 }, meetNpc: { name, genderIdentity, identityShared, roleTitle } },
    { label: 'ทักทายอย่างสุภาพแล้วกลับไปทำธุระของตน', effects: { happiness: 1, intelligence: 1 } }
  ],
  { oncePerLife: true, ...extra }
);

export const GENDER_DIVERSE_ENCOUNTERS = [
  encounter('trans_woman', 18, 'เพื่อนร่วมงานคนใหม่', 'แพรวแนะนำตัวว่าเป็น Trans woman และชวนคุณร่วมทำงานในโครงการใหม่', 'แพรว', 'trans_woman', true, 'เพื่อนร่วมงาน', 'ตอบรับและชวนแพรววางแผนงานร่วมกัน', { triggerConditions: [{ field: 'job', op: 'neq', value: null }] }),
  encounter('trans_man', 13, 'คนรู้จักจากค่าย', 'ต้นแนะนำตัวว่าเป็น Trans man และสนใจงานอาสาเหมือนคุณ', 'ต้น', 'trans_man', true, 'เพื่อนจากค่าย', 'ชวนต้นคุยเรื่องกิจกรรมอาสา'),
  encounter('nonbinary', 13, 'ศิลปินที่งานชุมชน', 'เมฆบอกว่าตนเป็นนอนไบนารีและกำลังทำภาพวาดเกี่ยวกับชุมชน', 'เมฆ', 'nonbinary', true, 'เพื่อนจากงานศิลปะ', 'ถามเมฆถึงภาพวาดและแลกเปลี่ยนความคิด'),
  encounter('woman_mechanic', 18, 'ช่างซ่อมที่อู่ใกล้บ้าน', 'ฝนกำลังอธิบายวิธีดูแลรถให้คนในชุมชนฟังอย่างเป็นกันเอง', 'ฝน', 'woman', false, 'เพื่อนจากชุมชน', 'คุยกับฝนเรื่องการดูแลรถที่ปลอดภัย'),
  encounter('man_nurse', 18, 'อาสาสมัครสุขภาพ', 'ภพเป็นพยาบาลที่มาช่วยจัดกิจกรรมดูแลสุขภาพในชุมชน', 'ภพ', 'man', false, 'เพื่อนอาสาสมัคร', 'อาสาช่วยภพจัดกิจกรรม'),
  encounter('genderfluid', 16, 'พบกันที่งานเทศกาล', 'น้ำแนะนำตัวว่าเป็น Genderfluid และชวนคุณชมการแสดงที่ตนร่วมจัด', 'น้ำ', 'genderfluid', true, 'เพื่อนจากเทศกาล', 'ชวนคุยเรื่องการแสดงและช่วยจัดงาน'),
  encounter('agender', 18, 'โต๊ะหนังสือในห้องสมุด', 'อุ่นบอกว่าตนไม่ระบุเพศและกำลังจัดมุมหนังสือให้คนในชุมชน', 'อุ่น', 'agender', true, 'เพื่อนจากห้องสมุด', 'ช่วยอุ่นจัดหนังสือและแลกเปลี่ยนเรื่องที่อ่าน')
];

export const DIVERSITY_EVENTS = [
  diversity('heterosexual', 'ความรักของเพื่อนต่างเพศ', 'เพื่อนสองคนที่เป็นคนต่างเพศเริ่มคบกันและคุยเรื่องขอบเขตที่ทั้งคู่สบายใจ', 'รักต่างเพศและความยินยอม', 'ฟังทั้งคู่โดยไม่คิดว่ารักต่างเพศมีแบบเดียว', 'ชวนคุยเรื่องการเคารพความต้องการของกันและกัน'),
  diversity('new_classmate', 'เพื่อนร่วมห้องคนใหม่', 'เพื่อนใหม่บอกว่าตนเป็นไบระหว่างคุยเรื่องความรัก โดยไม่ได้ขอให้ใครประกาศเรื่องนี้แทน', 'ไบ', 'รับฟังโดยไม่ตั้งสมมติฐานเรื่องคนที่เพื่อนชอบ', 'ถามว่ามีเรื่องใดที่เพื่อนอยากให้ช่วยหรือไม่', { maxAge: 22 }),
  diversity('couple', 'คู่รักที่ทำลายภาพจำ', 'คุณพบคู่รักเพศเดียวกันที่ช่วยกันดูแลครอบครัวเหมือนคู่รักอื่น ๆ', 'รักเพศเดียวกัน', 'ฟังเรื่องราวของทั้งคู่โดยไม่ถามเรื่องส่วนตัวเกินจำเป็น', 'ชวนคนรอบตัวคุยถึงการเคารพคู่รักทุกแบบ'),
  diversity('questioning', 'พื้นที่ให้ค้นหาตัวเอง', 'เพื่อนกำลังสำรวจว่าตนรู้สึกดึงดูดกับใคร และยังไม่ต้องการคำตอบที่แน่นอน', 'การค้นหาตัวตน', 'บอกเพื่อนว่าไม่จำเป็นต้องรีบติดป้ายให้ตัวเอง', 'ถามว่าเพื่อนอยากให้รับฟังหรือช่วยหาข้อมูล'),
  diversity('asexual_love', 'ความเข้าใจเรื่องความรัก', 'คนรู้จักพูดว่าคนอะเซ็กชวลคงรักใครไม่ได้ เพื่อนอีกคนดูไม่สบายใจ', 'อะเซ็กชวลและความรัก', 'อธิบายว่าความดึงดูดทางเพศกับความรักเป็นคนละเรื่อง', 'ชวนคุยอย่างเคารพโดยไม่พูดแทนคนที่เกี่ยวข้อง'),
  diversity('private_story', 'เรื่องส่วนตัวที่ได้รับความไว้ใจ', 'เพื่อนเล่าเรื่องตัวตนของตนให้ฟัง และย้ำว่าไม่พร้อมบอกคนอื่น', 'ความเป็นส่วนตัว', 'ยืนยันว่าจะเก็บเรื่องนี้ไว้ตามที่เพื่อนขอ', 'ถามวิธีช่วยเพื่อนโดยไม่เปิดเผยข้อมูลของเขา'),
  diversity('pansexual', 'คำที่เพื่อนใช้เรียกตัวเอง', 'เพื่อนอธิบายว่าตนเป็นแพนเซ็กชวล และมักถูกคนอื่นตีความผิด', 'แพนเซ็กชวล', 'ฟังความหมายจากประสบการณ์ของเพื่อนเอง', 'ช่วยแก้ความเข้าใจผิดเมื่อเพื่อนอนุญาต'),
  diversity('queer', 'คำเรียกที่แต่ละคนเลือก', 'ในชมรมมีคนใช้คำว่าเควียร์เพื่ออธิบายตัวเอง แต่บางคนไม่ใช้คำนี้', 'เควียร์', 'ถามว่าควรใช้คำเรียกใดกับแต่ละคน', 'เคารพคำที่แต่ละคนเลือกโดยไม่บังคับ'),
  diversity('pronouns', 'คำเรียกที่เหมาะสม', 'เพื่อนร่วมกิจกรรมขอให้ใช้ชื่อและคำเรียกใหม่ คุณยังไม่คุ้นแต่ตั้งใจเรียนรู้', 'อัตลักษณ์ทางเพศ', 'จดจำชื่อและคำเรียกที่เพื่อนขอ', 'หากเผลอเรียกผิดให้แก้ทันทีและคุยต่ออย่างปกติ'),
  diversity('romantic_attraction', 'ความรู้สึกหลายรูปแบบ', 'เพื่อนสงสัยว่าความชอบแบบคนรักกับความดึงดูดทางเพศจำเป็นต้องตรงกันหรือไม่', 'ความดึงดูดเชิงรัก', 'ชวนอ่านข้อมูลที่อธิบายความรู้สึกทั้งสองแบบ', 'บอกว่าแต่ละคนอาจมีประสบการณ์ต่างกัน'),
  diversity('photo_consent', 'ภาพที่ยังไม่ได้ขออนุญาต', 'มีคนอยากโพสต์รูปคู่ของเพื่อนลงกลุ่มสาธารณะ แต่ยังไม่ได้ถามเจ้าตัว', 'การยินยอม', 'ชวนให้ถามเจ้าของภาพก่อนโพสต์', 'เสนอให้ใช้ภาพอื่นที่ทุกคนยินยอม'),
  diversity('outing', 'คำถามกลางโต๊ะอาหาร', 'ญาติถามคุณตรง ๆ ว่าเพื่อนคนหนึ่งเป็นคนรักเพศเดียวกันหรือไม่', 'การไม่เปิดเผยตัวตนแทนผู้อื่น', 'ตอบว่าเป็นเรื่องส่วนตัวของเพื่อน', 'เปลี่ยนไปคุยเรื่องที่เพื่อนยินดีแบ่งปัน'),
  diversity('family_talk', 'บทสนทนาในครอบครัว', 'คนในบ้านถามเรื่องความหลากหลายทางเพศด้วยความไม่คุ้นเคย', 'การสื่อสารอย่างเคารพ', 'อธิบายด้วยคำง่าย ๆ และฟังข้อสงสัย', 'ชวนดูข้อมูลที่เจ้าตัวเลือกอ่านได้'),
  diversity('school_form', 'แบบฟอร์มที่ไม่ครอบคลุม', 'แบบฟอร์มกิจกรรมมีช่องเพศให้เลือกเพียงสองแบบ และเพื่อนบางคนไม่รู้จะกรอกอย่างไร', 'การยอมรับทางสังคม', 'ถามผู้จัดว่ามีวิธีกรอกที่เคารพทุกคนไหม', 'เสนอช่องชื่อที่ต้องการใช้และช่องข้อมูลที่จำเป็นจริง ๆ', { maxAge: 22 }),
  diversity('work_joke', 'มุกในที่ทำงาน', 'เพื่อนร่วมงานเล่นมุกเกี่ยวกับอัตลักษณ์ทางเพศจนบางคนเงียบไป', 'การเลือกปฏิบัติ', 'บอกอย่างสุภาพว่ามุกนี้อาจทำให้คนอื่นไม่สบายใจ', 'ชวนทีมตกลงวิธีคุยที่เคารพกัน', { minAge: 18, maxAge: 70, triggerConditions: [{ field: 'job', op: 'neq', value: null }] }),
  diversity('ally_group', 'ชวนเข้ากลุ่มรับฟัง', 'มีการเปิดกลุ่มพูดคุยเรื่องการเคารพความหลากหลาย ผู้เข้าร่วมไม่จำเป็นต้องเปิดเผยตัวตน', 'การเป็นผู้สนับสนุน', 'เข้าฟังและเรียนรู้จากกติกากลุ่ม', 'ช่วยจัดพื้นที่ที่ทุกคนเลือกพูดหรือไม่พูดได้'),
  diversity('rejected_date', 'คำตอบที่ต้องเคารพ', 'คนที่คุณสนใจบอกว่าไม่อยากเริ่มความสัมพันธ์ในตอนนี้', 'การยินยอมในความสัมพันธ์', 'รับคำตอบโดยไม่กดดัน', 'รักษามิตรภาพตามระยะที่อีกฝ่ายสบายใจ'),
  diversity('online_post', 'คำถามในโลกออนไลน์', 'เพื่อนถูกถามเรื่องเพศวิถีในโพสต์สาธารณะทั้งที่ไม่ได้เริ่มคุยเรื่องนี้', 'ความปลอดภัยออนไลน์', 'ไม่ตอบแทนเพื่อนและแจ้งให้เพื่อนทราบ', 'ช่วยตั้งค่าความเป็นส่วนตัวหากเพื่อนต้องการ'),
  diversity('asexual_boundary', 'ขอบเขตของคนรัก', 'คู่รักคู่หนึ่งคุยกันตรง ๆ เรื่องความใกล้ชิดที่แต่ละฝ่ายสบายใจ', 'อะเซ็กชวลและขอบเขต', 'เห็นคุณค่าของการตกลงร่วมกัน', 'ชวนคุยเรื่องการยินยอมที่เปลี่ยนได้เสมอ'),
  diversity('bi_assumption', 'คำพูดที่ลดทอนตัวตน', 'มีคนพูดว่าเพื่อนไบต้องเลือกข้างให้ชัดเจน เพื่อนรู้สึกถูกปฏิเสธ', 'ไบ', 'อธิบายว่าไม่จำเป็นต้องพิสูจน์ตัวตนกับใคร', 'ถามเพื่อนว่าอยากให้ช่วยตอบหรืออยากคุยเป็นการส่วนตัว'),
  diversity('wedding', 'คำเชิญงานแต่ง', 'คู่รักเพศเดียวกันส่งคำเชิญงานแต่งมาให้คุณ ความสุขของทั้งคู่ชัดเจนในข้อความ', 'รักเพศเดียวกัน', 'ตอบรับด้วยความยินดี', 'ถามว่ามีอะไรช่วยเตรียมงานได้บ้าง', { minAge: 18 }),
  diversity('pan_stereotype', 'ความเข้าใจผิดเรื่องแพนเซ็กชวล', 'ในวงสนทนามีคนคิดว่าแพนเซ็กชวลหมายถึงชอบทุกคน เพื่อนอยากแก้ความเข้าใจผิด', 'แพนเซ็กชวล', 'เปิดพื้นที่ให้เพื่อนอธิบายถ้าเขาต้องการ', 'อธิบายว่าความเป็นไปได้ที่จะชอบใครไม่เท่ากับชอบทุกคน'),
  diversity('elder_story', 'เรื่องเล่าจากคนต่างวัย', 'ผู้ใหญ่คนหนึ่งเล่าถึงการใช้ชีวิตในช่วงที่พูดเรื่องตัวตนได้ยากกว่าเดี๋ยวนี้', 'การยอมรับทางสังคม', 'ฟังโดยไม่รีบเทียบประสบการณ์', 'ถามว่าอยากให้คนรุ่นใหม่เรียนรู้อะไรจากเรื่องนี้'),
  diversity('hug', 'ก่อนกอดปลอบใจ', 'เพื่อนเสียใจและคุณอยากกอดปลอบ แต่ยังไม่รู้ว่าเขาสบายใจกับการสัมผัสหรือไม่', 'การยินยอม', 'ถามก่อนว่าขอกอดได้ไหม', 'เสนอจะนั่งอยู่เป็นเพื่อนถ้าไม่อยากถูกแตะตัว'),
  diversity('disagreement', 'เห็นต่างโดยไม่ทำร้าย', 'เพื่อนสองคนใช้คำเรียกตัวตนต่างกันและเริ่มถกเถียงว่าแบบใดถูกกว่า', 'การสื่อสารอย่างเคารพ', 'ชวนให้แต่ละคนพูดถึงคำที่ตนสบายใจ', 'ย้ำว่าไม่จำเป็นต้องใช้คำเดียวกันทุกคน'),
  diversity('report', 'ช่องทางร้องเรียน', 'คนในกิจกรรมถูกปฏิเสธโอกาสเพราะอัตลักษณ์ทางเพศ และกำลังคิดว่าจะขอความช่วยเหลือจากใคร', 'การเลือกปฏิบัติ', 'ถามก่อนว่าเขาต้องการความช่วยเหลือแบบใด', 'ช่วยหาช่องทางร้องเรียนที่รักษาความเป็นส่วนตัว')
];

export const RANDOM_EVENT_TEMPLATES = [
  ...DIVERSITY_EVENTS,
  ...GENDER_DIVERSE_ENCOUNTERS,
  ...ADDITIONAL_RANDOM_TEMPLATES,
  make('random_daily_rain', 'daily_life', 'common', 5, 100, 'ฝนระหว่างทาง', 'ฝนตกหนักก่อนถึงจุดหมาย คุณต้องปรับแผนเดินทางในวันนี้', [
    { label: 'หาที่หลบฝนแล้วรอให้ถนนปลอดภัย', effects: { health: 2, happiness: -1 } },
    { label: 'เดินทางต่ออย่างระมัดระวัง', effects: { health: -2, happiness: 1 } }
  ], { weightHints: { regions: ['central'], provinces: ['loc_bangkok'] } }),
  make('random_education_exam', 'education', 'uncommon', 13, 22, 'ผลสอบที่ไม่คาดคิด', 'คะแนนสอบวิชาที่คุณตั้งใจอ่านออกมาต่ำกว่าที่หวัง ยังมีเวลาทบทวนวิธีเรียน', [
    { label: 'ขอคำแนะนำจากครูและวางแผนอ่านใหม่', effects: { intelligence: 3, happiness: -1 } },
    { label: 'พักใจหนึ่งวันแล้วกลับมาทบทวน', effects: { happiness: 2, intelligence: 1 } }
  ], { weightHints: { traits: ['trait_quick_learner'] } }),
  make('random_family_move', 'family', 'rare', 7, 35, 'ข่าวเรื่องย้ายบ้าน', 'ครอบครัวกำลังพิจารณาย้ายบ้านเพื่อรับมือกับค่าใช้จ่ายและโอกาสใหม่', [
    { label: 'คุยกับทุกคนถึงสิ่งที่กังวล', effects: { connections: 3, happiness: 1 } },
    { label: 'ช่วยรวบรวมข้อมูลค่าใช้จ่ายก่อนตัดสินใจ', effects: { intelligence: 2, happiness: -1 } }
  ], { weightHints: { classes: ['class_1', 'class_2'], lowMoney: true } }),
  make('random_friend_new', 'friendship', 'common', 8, 80, 'คนรู้จักใหม่', 'ระหว่างทำกิจกรรม คุณได้คุยกับคนที่มีความสนใจคล้ายกัน', [
    { label: 'ชวนคุยและแลกเปลี่ยนประสบการณ์', effects: { connections: 2, happiness: 1 }, futureStoryHooks: ['กลับมาพบเพื่อนใหม่'] },
    { label: 'ทักทายแล้วค่อยทำความรู้จักในครั้งต่อไป', effects: { happiness: 1, intelligence: 1 } }
  ]),
  make('random_friend_help', 'friendship', 'uncommon', 13, 25, 'เพื่อนขอความช่วยเหลือ', 'เพื่อนร่วมชั้นกำลังรับมือกับงานและความกดดันหลายอย่างพร้อมกัน เขาถามว่าคุณพอมีเวลาช่วยไหม', [
    { label: 'ช่วยวางแผนและทำส่วนที่รับไหว', effects: { connections: 3, happiness: -1 }, futureStoryHooks: ['เพื่อนที่เคยช่วยอาจติดต่อกลับมา'] },
    { label: 'บอกข้อจำกัดของตัวเองและแนะนำแหล่งช่วยเหลือ', effects: { intelligence: 1, health: 1 } }
  ], { oncePerLife: true }),
  make('random_romance_meeting', 'romance', 'uncommon', 18, 75, 'บทสนทนาที่น่าจดจำ', 'คุณพบคนที่คุยด้วยแล้วสบายใจ แต่ยังไม่รู้ว่าความสัมพันธ์จะพัฒนาอย่างไร', [
    { label: 'ชวนคุยต่อโดยเคารพความรู้สึกของอีกฝ่าย', effects: { happiness: 2, connections: 1 } },
    { label: 'ให้เวลากับตัวเองและทำความรู้จักอย่างช้า ๆ', effects: { happiness: 1, intelligence: 1 } }
  ], { triggerConditions: [{ field: 'partnerStatus', op: 'eq', value: null }] }),
  make('random_diversity_privacy', 'diversity', 'uncommon', 13, 100, 'เรื่องที่เพื่อนฝากไว้', 'เพื่อนเล่าเรื่องอัตลักษณ์ของตนและขอให้คุณเก็บเป็นความลับ', [
    { label: 'รับฟังและเคารพความเป็นส่วนตัว', effects: { connections: 3, happiness: 1 } },
    { label: 'ถามว่าเพื่อนต้องการความช่วยเหลือแบบใด', effects: { connections: 2, intelligence: 1 } }
  ], { educationalTopic: 'ความเป็นส่วนตัวและการยินยอม' }),
  make('random_career_offer', 'career', 'rare', 18, 70, 'คำชวนจากที่ทำงาน', 'มีคนชวนคุณรับงานที่ท้าทายขึ้น แต่ต้องแบ่งเวลาจากการพักผ่อน', [
    { label: 'รับงานและวางเวลาพักให้ชัดเจน', effects: { intelligence: 2, health: -1 } },
    { label: 'ขอรายละเอียดก่อนรับปาก', effects: { intelligence: 1, connections: 1 } }
  ], { triggerConditions: [{ field: 'job', op: 'neq', value: null }], weightHints: { hasJob: true } }),
  make('random_finance_repair', 'finance', 'common', 18, 100, 'ของใช้จำเป็นเสีย', 'ของใช้ที่ต้องพึ่งพาทุกวันเสียกะทันหัน คุณต้องเลือกระหว่างซ่อมกับจัดการแบบอื่น', [
    { label: 'จ่ายค่าซ่อมเพื่อใช้ต่อ', effects: { cash: -500, happiness: 1 } },
    { label: 'ยืมใช้ชั่วคราวและเก็บเงินก่อน', effects: { connections: -1, intelligence: 1 } }
  ]),
  make('random_health_rest', 'health', 'common', 10, 100, 'ร่างกายส่งสัญญาณ', 'คุณรู้สึกอ่อนล้าหลังจากใช้ชีวิตยุ่งหลายวัน การพักฟื้นอาจช่วยได้', [
    { label: 'หยุดพักและดูแลตัวเอง', effects: { health: 3, happiness: 1 } },
    { label: 'ปรับตารางงานให้เบาลง', effects: { health: 1, intelligence: 1 } }
  ]),
  make('random_social_bullying', 'social_issues', 'uncommon', 12, 60, 'เห็นคนถูกกลั่นแกล้ง', 'คุณเห็นคนหนึ่งถูกล้อเลียนต่อหน้าคนอื่นและสังเกตว่าเขาไม่สบายใจ', [
    { label: 'เข้าไปช่วยอย่างปลอดภัยและถามความต้องการของเขา', effects: { connections: 2, merit: 1 } },
    { label: 'แจ้งผู้ดูแลที่เหมาะสม', effects: { intelligence: 1, merit: 1 } }
  ]),
  make('random_opportunity_camp', 'opportunity', 'rare', 12, 28, 'โอกาสเข้าค่าย', 'มีค่ายพัฒนาทักษะเปิดรับสมัคร แต่คุณต้องจัดเวลาและเตรียมตัว', [
    { label: 'สมัครและฝึกทักษะล่วงหน้า', effects: { intelligence: 3, happiness: -1 } },
    { label: 'ปรึกษาคนใกล้ตัวก่อนตัดสินใจ', effects: { connections: 2, intelligence: 1 } }
  ]),
  make('random_rare_oldfriend', 'rare_events', 'legendary', 25, 90, 'ข้อความจากเพื่อนเก่า', 'คนที่เคยรู้จักกันนานมาแล้วติดต่อกลับมาและชวนเล่าเรื่องชีวิตที่ผ่านมา', [
    { label: 'ตอบกลับและนัดคุยเมื่อสะดวก', effects: { connections: 3, happiness: 2 } },
    { label: 'ตอบอย่างสุภาพและรักษาระยะที่สบายใจ', effects: { happiness: 1, intelligence: 1 } }
  ], { oncePerLife: true, weightHints: { memoryHook: 'กลับมาพบเพื่อนใหม่', previousChoiceIds: ['random_friend_new:c1'] } }),
  make('random_friend_returns', 'rare_events', 'rare', 25, 90, 'เพื่อนที่เคยช่วยติดต่อกลับมา', 'เพื่อนที่คุณเคยช่วยในช่วงวัยเรียนส่งข้อความมาขอบคุณและชวนเล่าเรื่องชีวิตหลังจากไม่ได้พบกันหลายปี', [
    { label: 'ตอบกลับและถามถึงชีวิตตอนนี้', effects: { connections: 3, happiness: 2 } },
    { label: 'ขอบคุณที่นึกถึงและนัดคุยเมื่อสะดวก', effects: { connections: 2, health: 1 } }
  ], { oncePerLife: true, triggerConditions: [{ field: 'memoryHooks', op: 'includes', value: 'เพื่อนที่เคยช่วยอาจติดต่อกลับมา' }], weightHints: { previousChoiceIds: ['random_friend_help:c1'] } }),
  make('random_edu_age17', 'education', 'common', 17, 17, 'เตรียมก้าวหลังมัธยม', 'ปีนี้คุณต้องสำรวจทางเลือกหลังเรียนจบ ทั้งการเรียนต่อและการฝึกอาชีพ', [
    { label: 'คุยกับครูแนะแนวและเปรียบเทียบหลักสูตร', effects: { intelligence: 2, connections: 1 } },
    { label: 'ลองฝึกทักษะที่สนใจก่อนตัดสินใจ', effects: { intelligence: 2, happiness: 1 } }
  ], { oncePerLife: true }),
  make('random_finance_shortfall', 'finance', 'common', 18, 100, 'เงินไม่พอถึงปลายเดือน', 'หลังหักค่าใช้จ่ายจำเป็น เงินคงเหลือน้อยกว่าที่คุณคาด', [
    { label: 'ทำบัญชีและลดรายจ่ายที่เลื่อนได้', effects: { intelligence: 2, happiness: -1 } },
    { label: 'หารายได้เสริมที่ไม่กระทบสุขภาพ', effects: { cash: 300, health: -1 } }
  ], { triggerConditions: [{ field: 'cash', op: 'lte', value: 1000 }], weightHints: { lowMoney: true } }),
  make('random_friend_confides', 'friendship', 'uncommon', 13, 100, 'เพื่อนสนิทอยากคุย', 'คนที่คุณไว้ใจกันมานานขอเวลาคุยเรื่องส่วนตัวโดยไม่ต้องการคำตัดสิน', [
    { label: 'ตั้งใจฟังและถามว่าอยากให้ช่วยอย่างไร', effects: { connections: 3, happiness: 1 } },
    { label: 'ให้พื้นที่ส่วนตัวและนัดคุยเมื่อพร้อม', effects: { connections: 2, merit: 1 } }
  ], { triggerConditions: [{ field: 'friendship', op: 'gte', value: 70 }], weightHints: { highFriendship: true } }),
  make('random_health_support', 'health', 'uncommon', 13, 100, 'วันที่ความเครียดสะสม', 'คุณสังเกตว่าความกดดันเริ่มกระทบการนอนและสมาธิ การขอความช่วยเหลือเป็นทางเลือกหนึ่ง', [
    { label: 'คุยกับคนที่ไว้ใจหรือผู้เชี่ยวชาญ', effects: { happiness: 3, connections: 1 } },
    { label: 'จัดเวลาพักและลดภาระบางส่วน', effects: { health: 2, happiness: 1 } }
  ], { triggerConditions: [{ field: 'stress', op: 'gte', value: 70 }] }),
  make('random_friend_reconcile', 'friendship', 'rare', 13, 100, 'โอกาสคุยกันอีกครั้ง', 'คนที่เคยขัดแย้งกับคุณส่งสัญญาณว่าอยากพูดคุยอย่างสงบ', [
    { label: 'นัดคุยและรับฟังมุมมองของอีกฝ่าย', effects: { connections: 2, happiness: 1 } },
    { label: 'บอกขอบเขตที่ต้องการก่อนเริ่มคุย', effects: { happiness: 2, intelligence: 1 } }
  ], { triggerConditions: [{ field: 'npcConflict', op: 'eq', value: true }] })
];

export function toLegacyEventCard(template) {
  if (template.legacyEvent) {
    return {
      ...template.legacyEvent,
      category: template.category,
      rarity: template.rarity,
      source_type: 'random_event',
      aiGenerated: false
    };
  }
  return {
    event_id: template.id,
    title_th: template.title,
    description_th: template.description,
    category: template.category,
    rarity: template.rarity,
    min_age: template.minAge,
    max_age: template.maxAge,
    educationalTopic: template.educationalTopic,
    futureStoryHooks: template.futureStoryHooks || [],
    source_type: 'random_event',
    aiGenerated: template.aiGenerated,
    choices: template.choices.map((choice, index) => ({
      choice_id: `c${index + 1}`,
      label_th: choice.label,
      outcome_text_th: `${template.title}: ${choice.label}`,
      stat_effects: choice.effects,
      ...(choice.meetNpc ? { meetNpc: choice.meetNpc } : {}),
      ...(choice.futureStoryHooks ? { futureStoryHooks: choice.futureStoryHooks } : {}),
      req_stats: {}, req_flags: [], grants_flags: [], removes_flags: []
    }))
  };
}
