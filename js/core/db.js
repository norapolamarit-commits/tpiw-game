/**
 * js/core/db.js
 * ระบบโหลดฐานข้อมูล JSON ทั้ง 20 ไฟล์จาก ./data/ และสร้าง Memory Index สำหรับสืบค้นความเร็วสูง
 */

const DATA_BASE_PATH = './data';

/**
 * รายการไฟล์ JSON ทั้ง 20 ไฟล์ของโปรเจกต์
 */
export const DATA_MANIFEST = {
  coreRules: 'Core_Rules_&_Locations.json',
  milestones: 'Milestones_&_Licenses.json',
  market: 'Market_&_Investments.json',
  shop: 'Items_&_Assets_Shop.json',
  traits: 'Traits_&_Statuses.json',
  eduJobs: 'Education_&_Jobs.json',
  npcs: 'NPC_&_Relationships.json',
  loansCrisesEndings: '9_Loans_Crises_&_Endings.json',

  // Event Pools (12 ไฟล์)
  eventsPhase1: 'Events_Phase1_Infant.json',
  eventsPhase2: 'Events_Phase2_Child.json',
  eventsPhase3: 'Events_Phase3_Teen.json',
  eventsPhase4: 'Events_Phase4_YoungAdult.json',
  eventsPhase5: 'Events_Phase5_MiddleAge.json',
  eventsPhase6: 'Events_Phase6_Elder.json',
  eventsJobsGig: 'Events_Jobs_PartTime_&_Gig.json',
  eventsJobsCorp: 'Events_Jobs_Corporate_&_Pro.json',
  eventsJobsGovBiz: 'Events_Jobs_Gov_&_Business.json',
  eventsRelFamily: 'Events_Rel_Family_&_Friends.json',
  eventsRelRomance: 'Events_Rel_Romance_&_Children.json',
  eventsLocKarma: 'Events_Locations_&_Karma.json'
};

class GameDatabase {
  constructor() {
    this.isLoaded = false;
    this.raw = {};
    this.loadErrors = [];

    // โครงสร้าง Index ค้นหาด้วย ID แบบ O(1)
    this.indexes = {
      locations: new Map(),
      classes: new Map(),
      coreStats: new Map(),
      specialStats: new Map(),
      traitsAndFlags: new Map(),
      innateTraits: new Map(),
      milestonesByAge: new Map(),
      licenses: new Map(),
      featureGates: new Map(),
      activities: new Map(),
      programs: new Map(),
      jobs: new Map(),
      instruments: new Map(),
      shopItems: new Map(),
      loans: new Map(),
      npcArchetypes: new Map(),
      partnerArchetypes: new Map(),
      spouseTraits: new Map(),
      relActions: new Map(),
      events: new Map(),
      crisisEvents: new Map()
    };
  }

  /**
   * สร้าง URL ที่ปลอดภัยสำหรับชื่อไฟล์ที่มีอักขระพิเศษ เช่น '&' หรือช่องว่าง
   * @param {string} filename
   * @returns {string}
   */
  buildFileUrl(filename) {
    return `${DATA_BASE_PATH}/${encodeURIComponent(filename)}`;
  }

  /**
   * โหลดไฟล์ JSON เดี่ยวพร้อมดักจับ Error
   * @param {string} key
   * @param {string} filename
   * @returns {Promise<object>}
   */
  async fetchJsonFile(key, filename) {
    // ลองโหลดทั้ง path ปกติและ encoded path เพื่อรองรับ WebView/Local Server บน Acode ทุกรูปแบบ
    const candidateUrls = [
      `${DATA_BASE_PATH}/${filename}`,
      this.buildFileUrl(filename)
    ];

    let lastError = null;
    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} (${res.statusText})`);
        }
        const json = await res.json();
        return json;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`[DB] โหลดไฟล์ "${filename}" (${key}) ไม่สำเร็จ: ${lastError?.message || lastError}`);
  }

  /**
   * โหลดข้อมูล JSON ทั้ง 20 ไฟล์เข้าสู่ Memory และสร้าง Index
   * @param {object} [options]
   * @param {boolean} [options.strict=false] หากเป็น true จะ throw ทันทีถ้ามีไฟล์ใดโหลดไม่สำเร็จ
   * @param {(loaded: number, total: number, filename: string) => void} [options.onProgress] callback แจ้งความคืบหน้า
   * @returns {Promise<{ success: boolean, loadedCount: number, totalCount: number, errors: string[] }>}
   */
  async loadAllData(options = {}) {
    const { strict = false, onProgress = null } = options;
    const entries = Object.entries(DATA_MANIFEST);
    const totalCount = entries.length;
    let loadedCount = 0;

    this.isLoaded = false;
    this.raw = {};
    this.loadErrors = [];

    const promises = entries.map(async ([key, filename]) => {
      try {
        const data = await this.fetchJsonFile(key, filename);
        this.raw[key] = data;
        loadedCount++;
        if (typeof onProgress === 'function') {
          onProgress(loadedCount, totalCount, filename);
        }
      } catch (err) {
        this.loadErrors.push(err.message);
        console.error(err.message);
      }
    });

    await Promise.allSettled(promises);

    // ทุกไฟล์ใน Manifest เป็นส่วนหนึ่งของฐานข้อมูลเกม จึงต้องโหลดครบก่อนเริ่มเกม
    const requiredKeys = Object.keys(DATA_MANIFEST);
    const missingRequired = requiredKeys.filter((key) => !this.raw[key]);

    if (missingRequired.length > 0 || (strict && this.loadErrors.length > 0)) {
      this.isLoaded = false;
      throw new Error(
        `ไม่สามารถเริ่มเกมได้เนื่องจากโหลดฐานข้อมูลไม่ครบ (${missingRequired.join(', ')}). รายละเอียด: ${this.loadErrors.join(' | ')}`
      );
    }

    this.buildIndexes();
    this.isLoaded = true;

    return {
      success: this.loadErrors.length === 0,
      loadedCount,
      totalCount,
      errors: [...this.loadErrors]
    };
  }

  /**
   * สร้าง Index สำหรับการสืบค้นทุกหมวดหมู่ใน Memory
   */
  buildIndexes() {
    for (const map of Object.values(this.indexes)) {
      map.clear();
    }

    // 1. Core Rules & Locations
    const core = this.raw.coreRules;
    if (core) {
      (core.locations || []).forEach((loc) => this.indexes.locations.set(loc.location_id, loc));
      (core.social_classes || []).forEach((cls) => this.indexes.classes.set(cls.class_id, cls));
      (core.core_stats_definitions || []).forEach((st) => this.indexes.coreStats.set(st.stat_id, st));
      (core.special_stats_definitions || []).forEach((st) => this.indexes.specialStats.set(st.stat_id, st));
    }

    // 2. Traits, Tags, Flags & Statuses
    const traits = this.raw.traits;
    if (traits) {
      const traitGroups = [
        'innate_traits',
        'talent_tags',
        'social_and_origin_flags',
        'health_and_mental_statuses',
        'financial_and_legal_flags'
      ];
      for (const group of traitGroups) {
        for (const item of traits[group] || []) {
          this.indexes.traitsAndFlags.set(item.id, { ...item, category_group: group });
          if (group === 'innate_traits') {
            this.indexes.innateTraits.set(item.id, item);
          }
        }
      }
    }

    // 3. Milestones, Licenses & Feature Gates
    const ms = this.raw.milestones;
    if (ms) {
      for (const m of ms.mandatory_age_milestones || []) {
        const list = this.indexes.milestonesByAge.get(m.trigger_age) || [];
        list.push(m);
        this.indexes.milestonesByAge.set(m.trigger_age, list);
      }
      (ms.licenses_and_permits || []).forEach((lic) => this.indexes.licenses.set(lic.license_id, lic));
      (ms.system_feature_gates || []).forEach((gate) => this.indexes.featureGates.set(gate.gate_id, gate));
    }

    // 4. Education & Jobs (รวมทุกประเภทอาชีพไว้ใน jobs index พร้อมระบุ job_category)
    const eduJobs = this.raw.eduJobs;
    if (eduJobs) {
      (eduJobs.age_progression_activities || []).forEach((act) =>
        this.indexes.activities.set(act.activity_id, act)
      );
      (eduJobs.higher_education_programs || []).forEach((prog) =>
        this.indexes.programs.set(prog.program_id, prog)
      );

      const jobBuckets = [
        { key: 'part_time_and_gig_jobs', category: 'part_time_gig' },
        { key: 'corporate_and_professional_careers', category: 'corporate' },
        { key: 'civil_service_careers', category: 'civil_service' },
        { key: 'entrepreneur_and_business_careers', category: 'business' }
      ];
      for (const bucket of jobBuckets) {
        for (const job of eduJobs[bucket.key] || []) {
          this.indexes.jobs.set(job.job_id, {
            ...job,
            job_category: bucket.category
          });
        }
      }
    }

    // 5. Market & Investments
    const market = this.raw.market;
    if (market) {
      (market.financial_instruments || []).forEach((inst) =>
        this.indexes.instruments.set(inst.instrument_id, inst)
      );
    }

    // 6. Shop Items & Assets (7 หมวด)
    const shop = this.raw.shop;
    if (shop) {
      const shopCategories = [
        'childhood_school_shop',
        'gadgets_and_it',
        'courses_and_business_starters',
        'family_romance_and_merit',
        'travel_and_wellness',
        'vehicles_assets',
        'real_estate_assets'
      ];
      for (const cat of shopCategories) {
        for (const item of shop[cat] || []) {
          this.indexes.shopItems.set(item.item_id, { ...item, shop_category: cat });
        }
      }
    }

    // 7. NPCs & Relationships
    const npcs = this.raw.npcs;
    if (npcs) {
      (npcs.family_and_friend_archetypes || []).forEach((arch) =>
        this.indexes.npcArchetypes.set(arch.archetype_id, arch)
      );
      (npcs.romantic_partner_archetypes || []).forEach((part) =>
        this.indexes.partnerArchetypes.set(part.archetype_id, part)
      );
      (npcs.spouse_financial_traits_and_events || []).forEach((tr) =>
        this.indexes.spouseTraits.set(tr.trait_id, tr)
      );
      (npcs.relationship_actions || []).forEach((act) =>
        this.indexes.relActions.set(act.action_id, act)
      );
    }

    // 8. Loans, Crises & Endings
    const lce = this.raw.loansCrisesEndings;
    if (lce) {
      (lce.loan_products_and_credit_rules?.loan_products || []).forEach((loan) =>
        this.indexes.loans.set(loan.loan_id, loan)
      );
      (lce.rng_risk_and_crisis_events || []).forEach((evt) =>
        this.indexes.crisisEvents.set(evt.event_id, evt)
      );
    }

    // 9. Event Pools ทั้ง 12 ไฟล์
    const eventPoolKeys = [
      'eventsPhase1', 'eventsPhase2', 'eventsPhase3',
      'eventsPhase4', 'eventsPhase5', 'eventsPhase6',
      'eventsJobsGig', 'eventsJobsCorp', 'eventsJobsGovBiz',
      'eventsRelFamily', 'eventsRelRomance', 'eventsLocKarma'
    ];
    for (const poolKey of eventPoolKeys) {
      const poolData = this.raw[poolKey];
      if (!poolData || !Array.isArray(poolData.events)) continue;
      for (const evt of poolData.events) {
        this.indexes.events.set(evt.event_id, { ...evt, source_pool: poolKey });
      }
    }
  }

  // ==================== Helper Getters ====================

  getGameConstants() {
    return this.raw.coreRules?.game_constants || null;
  }

  getLocation(id) {
    return this.indexes.locations.get(id) || null;
  }

  getAllLocations() {
    return Array.from(this.indexes.locations.values());
  }

  getClass(id) {
    return this.indexes.classes.get(id) || null;
  }

  getAllClasses() {
    return Array.from(this.indexes.classes.values());
  }

  /**
   * ค้นหาช่วงวัยตามอายุปัจจุบัน (เช่น phase_1_infant .. phase_6_elder)
   * @param {number} age
   */
  getLifePhaseByAge(age) {
    const phases = this.raw.coreRules?.game_constants?.life_phases || {};
    for (const [phaseId, info] of Object.entries(phases)) {
      if (age >= info.min_age && age <= info.max_age) {
        const baseCost =
          this.raw.coreRules?.game_constants?.base_annual_living_cost_by_phase?.[phaseId] ?? 0;
        return { phaseId, ...info, baseAnnualLivingCost: baseCost };
      }
    }
    return null;
  }

  /**
   * ดึงชื่อภาษาไทยของค่า connections ตามช่วงอายุจริง (ความเอ็นดู / เพื่อนฝูง / เส้นสาย)
   * @param {number} age
   * @returns {string}
   */
  getConnectionsLabelByAge(age) {
    const connDef = this.indexes.coreStats.get('connections');
    if (connDef && Array.isArray(connDef.dynamic_names_by_age)) {
      const match = connDef.dynamic_names_by_age.find(
        (d) => age >= d.min_age && age <= d.max_age
      );
      if (match) return match.name_th;
    }
    return 'เส้นสาย';
  }

  getTraitOrFlag(id) {
    return this.indexes.traitsAndFlags.get(id) || null;
  }

  getInnateTrait(id) {
    return this.indexes.innateTraits.get(id) || null;
  }

  getAllInnateTraits() {
    return Array.from(this.indexes.innateTraits.values());
  }

  getMilestonesAtAge(age) {
    return this.indexes.milestonesByAge.get(age) || [];
  }

  getLicense(id) {
    return this.indexes.licenses.get(id) || null;
  }

  getFeatureGate(id) {
    return this.indexes.featureGates.get(id) || null;
  }

  getJob(id) {
    return this.indexes.jobs.get(id) || null;
  }

  getProgram(id) {
    return this.indexes.programs.get(id) || null;
  }

  getActivity(id) {
    return this.indexes.activities.get(id) || null;
  }

  getShopItem(id) {
    return this.indexes.shopItems.get(id) || null;
  }

  getInstrument(id) {
    return this.indexes.instruments.get(id) || null;
  }

  getLoanProduct(id) {
    return this.indexes.loans.get(id) || null;
  }

  getEvent(eventId) {
    return this.indexes.events.get(eventId) || this.indexes.crisisEvents.get(eventId) || null;
  }

  getThaiNamePools() {
    return this.raw.npcs?.thai_name_pools || null;
  }
}

export const db = new GameDatabase();
export const loadAllData = (options) => db.loadAllData(options);
export const getLocation = (id) => db.getLocation(id);
export const getClass = (id) => db.getClass(id);
export default db;
