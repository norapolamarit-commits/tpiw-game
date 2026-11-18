# V1 System Audit — TPIW

**Audit date:** 2026-11-14  
**Repository:** `3963mae-design/thai-life-sim`  
**Baseline branch:** `main`  
**Baseline commit:** `c066f79e7f45b62e2ca0e71f210e5fa51927462e`  
**Latest CI run:** [Tests #43590633687](https://github.com/3963mae-design/thai-life-sim/actions/runs/43590633687) — success

เอกสารนี้เป็นการตรวจโครงสร้างจากไฟล์และ CI ของ Repository ณ baseline ข้างต้น รวมถึงบันทึกผล Playtest ที่ผู้พัฒนาเล่าไว้ในบทสนทนา ไม่ใช่การรับรองจากการทดสอบบนอุปกรณ์จริง

## 1. เกณฑ์การให้ระดับ

| ระดับ | ความหมาย |
|---|---|
| **1 — Complete** | ขอบเขตของระบบชัดเจน มีการทำงานครบและมีหลักฐานการทดสอบเพียงพอสำหรับขอบเขตนั้น |
| **2 — Functional** | มีระบบที่ใช้งานได้และมีโค้ด/การทดสอบรองรับ แต่ยังต้องปรับสมดุลหรือทดสอบเพิ่ม |
| **3 — Incomplete** | มีโครงสร้างหรือมีฟีเจอร์บางส่วน แต่ยังขาดสิ่งจำเป็นต่อ V1 |
| **4 — Missing** | ยังไม่พบระบบหรือความสามารถที่ V1 ต้องมี |

ระดับนี้ประเมินความพร้อมเพื่อ V1 ไม่ใช่คะแนนคุณภาพโค้ด

## 2. สรุปสถานะระบบ

| ระบบ | ระดับ | หลักฐาน/สภาพปัจจุบัน | งานคงเหลือ |
|---|---|---|---|
| Boot / Database | **2 — Functional** | `js/main.js`, `js/core/db.js`; Manifest โหลดข้อมูล 20 ไฟล์ | ตรวจทุก Error ที่เกิดจริงและทดสอบกรณีฐานข้อมูลขาด |
| Turn / Year Loop | **2 — Functional** | `turn_manager.js`; มี annual pipeline, event queue, free action และ primary action | เพิ่ม Full-life test แบบต่อเนื่อง |
| Age / Life Phase | **2 — Functional** | `profile.lifePhaseId` และกฎช่วงวัย 6 ช่วงใน Core Rules | ตรวจการเปลี่ยนวัยทุก boundary และความสอดคล้องกับ Event |
| Event Engine | **2 — Functional** | `event_engine.js`; มี eligibility, queue, weighted pool mixing และ fallback | ปรับคุณภาพ Event/Choice และทดสอบผลระยะยาว |
| Life Path ที่ผู้เล่นกำหนด | **4 — Missing** | ตรวจไม่พบระบบเลือก Life Path ที่แยกจากช่วงวัย; `lifePhaseId` เป็นช่วงอายุตามกฎ | ออกแบบข้อมูล/การเลือก/ผลต่อ Event และบันทึกลง State ใน Phase 5C |
| Stats / Traits / Status | **2 — Functional** | มีการบวก/ลบ Stat, Flag/Status, Passive และ Threshold logic | ตรวจสมดุลการขึ้นถึง 100 เร็วเกินไปและการสะสมผลซ้ำ |
| Family / Relationships | **2 — Functional** | `social_engine.js`, NPC/Relationship data, tests ด้านความสัมพันธ์และทายาท | ตรวจอิทธิพลการเลี้ยงดู/ความสัมพันธ์ต่อการสนับสนุนและโอกาส |
| Education / Career | **2 — Functional** | `career_edu_engine.js`, Education & Jobs data, lifecycle tests | ตรวจการเชื่อมกับ Life Path และทดสอบเส้นทางเรียน/ทำงานต่อเนื่อง |
| Economy / Personal Finance | **2 — Functional** | `economy_engine.js`, มี cash, piggyBank, parentAnnualSupport และ living cost | ปรับเงินสนับสนุนตามวัย/ฐานะ และจำลองหลายเส้นทาง |
| Assets / Debt / Crisis | **2 — Functional** | ระบบสินทรัพย์ ผ่อนชำระ เงินกู้และ Emergency Debt พร้อม lifecycle tests | ตรวจ exploit, ยอดคงเหลือ และผลกระทบข้ามปี |
| Market / Investments | **2 — Functional** | Market & Investments data และ lifecycle tests | ตรวจความเสี่ยง/ผลตอบแทนระยะยาวและการเข้าถึงตามวัย |
| Ending / Inheritance | **2 — Functional** | `ending_engine.js`; death, ending tier, will, inheritance และรุ่นถัดไป | ทดสอบการเชื่อมจาก Full-life run และการไม่คำนวณมรดกซ้ำ |
| Save / Load | **2 — Functional** | `state.js`; versioned GameState, MetaState, migration/recovery tests | ทดสอบบน Browser/อุปกรณ์จริงและทวน schema migration |
| UI Screens | **2 — Functional** | Router, Lobby/Reborn, 5 gameplay tabs, Ending และ screen-render tests | ทดสอบการแตะ/เลื่อน/keyboard/safe area บนอุปกรณ์จริง |
| Audio | **3 — Incomplete** | BGM MP3 2 แทร็ก; Synth SFX ผ่าน Web Audio; มี toggle เปิด/ปิดและ BGM volume | Hybrid MP3 SFX, Mixer, Master/SFX Volume, settings UI และ duplicate-sound regression |
| PWA / Offline | **3 — Incomplete** | มี manifest และ link จาก index.html แต่ manifest อ้างไอคอน 192/512 ที่ไม่อยู่ใน Tree; ไม่พบ Service Worker | เติม icon assets และ Service Worker หากจะประกาศรองรับ Install/Offline หรือจำกัดคำกล่าวอ้าง |
| Automated tests / Data validation | **1 — Complete (เฉพาะขอบเขตอัตโนมัติปัจจุบัน)** | CI ล่าสุด 111 passed, 0 failed; validator ผ่าน 20 files / 562 events / 1,191 choices | เพิ่ม Full-life, balance, browser/device และ manual QA |
| Documentation / Onboarding | **3 — Incomplete** | มี `docs/PHASE_4O_READINESS.md`; ไม่พบ `README.md` ใน Repository snapshot | เพิ่มวิธีรันเกม/ทดสอบ ขอบเขต V1 และคู่มือรายงานปัญหา |
| Full-life Integration QA | **3 — Incomplete** | มี lifecycle integration หลายระบบและ final regression ของ opening life | ต้องมี test scenario เดียวที่เล่นต่อเนื่องตั้งแต่เกิดจนจบชีวิต/ส่งต่อทายาท |

## 3. สิ่งที่ตรวจสอบยืนยันจาก Repository

### 3.1 โครงสร้าง Repository

- พบไฟล์ทั้งหมด 70 รายการใน Git Tree
- มี JavaScript modules แยกเป็น `core`, `engine`, `ui`
- มี JSON data 20 ไฟล์ตาม `DATA_MANIFEST` ใน `js/core/db.js`
- มี Event Pool 12 ไฟล์ และ data configuration หลัก 8 ไฟล์
- พบ test files 16 ไฟล์
- มี `.github/workflows/test.yml` ซึ่งรัน `npm test` และ `npm run validate:data`
- `package.json` มี script สำหรับ test และ validate:data; ไม่พบ README.md

### 3.2 CI ล่าสุด

Workflow run [#43590633687](https://github.com/3963mae-design/thai-life-sim/actions/runs/43590633687) ทำงานบน baseline commit `c066f79` เมื่อ 2026-11-14 และจบด้วย Success:

- `npm test`: **111 tests, 111 passed, 0 failed**
- `npm run validate:data`: **20 files, 562 events, 1,191 choices**
- ทั้งขั้น Run tests และ Validate game data ผ่าน

รายงานเดิม `docs/PHASE_4O_READINESS.md` อ้าง baseline commit `9f18703` และ 110 tests จึงเป็น Snapshot ก่อนหน้า ไม่ควรนำตัวเลข 110 ไปอ้างเป็นผล CI ล่าสุด

### 3.3 Event Pool กับ Life Path

`event_engine.js` แบ่งถัง Event เป็น:

- `life_phase`
- `career`
- `relationship`
- `location_karma`

มีการสุ่มถังแบบ Weighted Pool Mixing และใช้ fallback เมื่อถังที่สุ่มได้ไม่มี Event ที่เข้าเงื่อนไข โดยอายุ 13–59 ปีตั้งเป้าดึง Event จากสองถัง ส่วนช่วงอายุอื่นดึงหนึ่งถัง (นอกเหนือจากการ์ด Milestone/ความเสี่ยงที่อาจถูกเพิ่ม)

สิ่งนี้เป็นระบบเลือก Event จากหมวดหมู่และช่วงวัย ไม่ใช่ระบบ Life Path ที่ผู้เล่นกำหนดเอง จากการตรวจ `event_engine.js`, Core Rules, Milestones, Traits และ Education/Jobs ไม่พบ key หรือ flow สำหรับ player-selected Life Path จึงจัดเป็น Missing จนกว่าจะมีการ implement และมี test ยืนยัน

### 3.4 PWA / Offline

- `index.html` โหลด `manifest.json`
- `manifest.json` อ้าง `assets/icons/icon-192.png` และ `assets/icons/icon-512.png`
- Git Tree ปัจจุบันไม่มีไฟล์ไอคอนตาม path ดังกล่าว
- ไม่พบไฟล์ Service Worker ใน Git Tree

ดังนั้นมี Manifest บางส่วน แต่ยังไม่มีหลักฐานรองรับคำกล่าวอ้างว่า Install/Offline พร้อมใช้งาน

### 3.5 Audio

`js/ui/audio.js` ปัจจุบันมี BGM MP3 สองแทร็กและ Synth SFX ผ่าน Oscillator มีการเก็บ preference ใน localStorage แต่ preference ปัจจุบันมี `bgmVolume` และ toggle สำหรับ BGM/SFX ไม่มี Mixer ที่แยก Master/BGM/SFX volume และยังไม่มี MP3 SFX ใน Tree

การกดปุ่มทั่วไปมี document click listener เรียกเสียงคลิก ส่วน `toggleSfx()` ก็เรียก `playSfx('click')` เมื่อเปิด SFX จึงควรตรวจการ bind จริงใน Settings ก่อนแก้ เพื่อป้องกันเสียงคลิกซ้ำ

## 4. Playtest Findings จากผู้พัฒนา

จากการทดลองเล่นที่ผู้พัฒนาแจ้งไว้ ปัญหาที่ควรนำไปตรวจใน Phase 5B–5D ได้แก่:

1. เกมรู้สึกง่ายเกินไป และสามารถกด Choice ต่อโดยไม่จำเป็นต้องอ่านรายละเอียด
2. บาง Choice เปิดเผยผลเปลี่ยน Stat ทำให้การตัดสินใจคาดเดาง่ายเกินไป
3. Stat บางตัวขึ้นถึง 100 ตั้งแต่อายุยังน้อย
4. Event หลายรายการมี Choice เพียงสองข้อ และความแตกต่างระหว่างทางเลือกยังไม่เด่นชัด

รายการนี้เป็นข้อสังเกตจาก Playtest ไม่ใช่ผลวัดจาก Automated Test จึงต้องแปลงเป็น Test Scenario และเกณฑ์ Balance ที่ตรวจซ้ำได้

## 5. Priority Backlog

| Priority | งาน | Phase | เหตุผล |
|---|---|---|---|
| **P0** | ออกแบบ/ทำ Life Path ให้เป็นระบบที่ผู้เล่นเลือกและเห็นผลจริง | 5C | เป็นส่วนหนึ่งของทิศทางเกมที่ยังไม่ปรากฏในโค้ดปัจจุบัน |
| **P0** | สร้าง Full-life integration test ตั้งแต่เกิดถึง Ending | 5E | CI ปัจจุบันยืนยัน subsystem และ opening-life แต่ยังไม่ยืนยันหนึ่งชีวิตเต็ม |
| **P0** | ปรับสมดุลเศรษฐกิจ/เงินสนับสนุน/Stat growth | 5B | ตรงกับปัญหาความง่ายและ Stat เต็มเร็วจาก Playtest |
| **P1** | ปรับ Choice ให้มี trade-off และผลตามมา | 5D | เพิ่มคุณภาพการตัดสินใจโดยไม่ต้องเพิ่มจำนวน Event อย่างไร้ขอบเขต |
| **P1** | Manual test Android Chrome + Desktop และ Save/Reload | 5E/5G | DOM mock ไม่ยืนยันพฤติกรรมบนอุปกรณ์จริง |
| **P1** | Hybrid Audio Mixer และ UI ตั้งค่าเสียง | 5F | ระบบปัจจุบันยังไม่มี MP3 SFX และแยกระดับเสียงไม่ครบ |
| **P1** | ตัดสินใจเรื่อง PWA: เติม Icons/Service Worker หรือไม่ประกาศ Offline | 5G | ป้องกัน Release claim ที่ไม่ตรงกับ implementation |
| **P1** | README / Runbook / Bug report guide | 5G | ช่วยให้ผู้เล่นทดลองและผู้พัฒนาอื่นเริ่มต้นได้ |
| **P2** | เพิ่ม Event/Content หลังวิเคราะห์ coverage และ repetition | 5D+ | ไม่ควรเพิ่มจำนวนก่อนตรวจคุณภาพและความซ้ำ |

## 6. Phase Gate

### Phase 5A — Design Freeze
- [x] Scope ของ V1 ถูกระบุและแยกสิ่งที่เลื่อนไป V2
- [x] Acceptance Criteria ถูกกำหนด
- [x] Audit ระบุระดับระบบและรายการความเสี่ยง
- [x] Baseline commit และผล CI ล่าสุดถูกบันทึก

### เงื่อนไขก่อนปิด V1
- [ ] P0 ทุกข้อปิดแล้ว
- [ ] ไม่มี Critical/High bug ที่ขัดขวางการเล่นจบ
- [ ] Acceptance Criteria ด้าน Full-life, Save/Load และ Mobile ผ่าน
- [ ] ผู้เล่นภายนอกอย่างน้อย 3 คนทดลองและไม่มี Blocker ค้าง
- [ ] คู่มือเริ่มต้นและข้อจำกัดการใช้งานถูกเผยแพร่

---

**ข้อสรุป:** Repository มีแกน Engine, Data, UI และ Automated Regression ที่ทำงานจริง พร้อมฐานทดสอบ 111 tests ที่ผ่านบน CI ล่าสุด แต่ยังไม่ควรเรียกว่า Release-ready จนกว่าจะปิด Life Path, Balance, Full-life QA และ Device QA
