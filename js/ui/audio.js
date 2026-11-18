/**
 * js/ui/audio.js
 * จัดการเพลงพื้นหลัง 2 แทร็ก (bgm_chill.mp3 หน้า Lobby/จุติใหม่ และ bgm_main.mp3 หน้าเล่นเกม)
 * พร้อมปลดล็อก Autoplay ตอนแตะหน้าจอครั้งแรก และเสียงกดปุ่ม SFX ผ่าน Web Audio API
 */

const AUDIO_STORAGE_KEY = 'thai_life_sim_audio_v1';

const BGM_TRACKS = {
  chill: './assets/audio/bgm_chill.mp3',
  main: './assets/audio/bgm_main.mp3'
};

const trackPlayers = {};
const failedTracks = new Set();

let currentTrackKey = 'chill';
let hasUserInteracted = false;
let audioCtx = null;
let isInitialized = false;
let prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return { bgmEnabled: true, sfxEnabled: true, bgmVolume: 0.35, sfxVolume: 0.8 };
    return { bgmEnabled: true, sfxEnabled: true, bgmVolume: 0.35, sfxVolume: 0.8, ...JSON.parse(raw) };
  } catch {
    return { bgmEnabled: true, sfxEnabled: true, bgmVolume: 0.35, sfxVolume: 0.8 };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function getOrCreatePlayer(trackKey) {
  const src = BGM_TRACKS[trackKey];
  if (!src || failedTracks.has(trackKey)) return null;

  if (!trackPlayers[trackKey]) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = prefs.bgmVolume;
    audio.addEventListener('error', () => {
      failedTracks.add(trackKey);
      console.warn(`[Audio] โหลดไฟล์ ${src} ไม่สำเร็จ`);
    });
    trackPlayers[trackKey] = audio;
  }
  return trackPlayers[trackKey];
}

function getAudioContext() {
  if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function normalizeVolume(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

export function getAudioPrefs() {
  return { ...prefs };
}

export function setBgmVolume(value) {
  prefs.bgmVolume = normalizeVolume(value, prefs.bgmVolume);
  for (const audio of Object.values(trackPlayers)) {
    if (audio) audio.volume = prefs.bgmVolume;
  }
  savePrefs();
  return prefs.bgmVolume;
}

export function setSfxVolume(value) {
  prefs.sfxVolume = normalizeVolume(value, prefs.sfxVolume);
  savePrefs();
  return prefs.sfxVolume;
}

export function pauseAllBgm() {
  for (const audio of Object.values(trackPlayers)) {
    if (audio && !audio.paused) {
      audio.pause();
    }
  }
}

export function playCurrentBgm() {
  if (!prefs.bgmEnabled) return;
  const player = getOrCreatePlayer(currentTrackKey);
  if (!player) return;

  for (const [key, audio] of Object.entries(trackPlayers)) {
    if (key !== currentTrackKey && audio && !audio.paused) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  player.volume = prefs.bgmVolume;
  if (player.paused) {
    player.play().catch(() => {
      // รอจนกว่าผู้ใช้จะแตะหน้าจอ
    });
  }
}

/**
 * สลับแทร็กเพลงตามหน้าจอ ('chill' | 'main')
 */
export function setBgmTrack(trackKey) {
  if (!BGM_TRACKS[trackKey]) return;
  if (currentTrackKey !== trackKey) {
    const prev = trackPlayers[currentTrackKey];
    if (prev) {
      prev.pause();
      prev.currentTime = 0;
    }
    currentTrackKey = trackKey;
  }

  if (hasUserInteracted && prefs.bgmEnabled) {
    playCurrentBgm();
  }
}

export function toggleBgm() {
  prefs.bgmEnabled = !prefs.bgmEnabled;
  savePrefs();
  if (prefs.bgmEnabled) {
    failedTracks.delete(currentTrackKey);
    playCurrentBgm();
  } else {
    pauseAllBgm();
  }
  return prefs.bgmEnabled;
}

export function toggleSfx() {
  prefs.sfxEnabled = !prefs.sfxEnabled;
  savePrefs();
  return prefs.sfxEnabled;
}

export function playSfx(type = 'click') {
  const volume = normalizeVolume(prefs.sfxVolume, 0.8);
  if (!prefs.sfxEnabled || volume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === 'success' || type === 'coin') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.06);
    gain.gain.setValueAtTime(0.05 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.19);
  } else if (type === 'error') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(160, now + 0.14);
    gain.gain.setValueAtTime(0.06 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.start(now);
    osc.stop(now + 0.17);
  } else {
    // A short, warm two-step chime sits above the BGM without becoming sharp or intrusive.
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(850, now + 0.065);
    osc.frequency.exponentialRampToValueAtTime(730, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11 * volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.16);
  }
}

export function initAudioSystem() {
  if (isInitialized) return;
  isInitialized = true;

  const unlockOnFirstGesture = () => {
    if (!hasUserInteracted) {
      hasUserInteracted = true;
      getAudioContext();
      if (prefs.bgmEnabled) {
        playCurrentBgm();
      }
    }
  };

  window.addEventListener('pointerdown', unlockOnFirstGesture, { passive: true });
  window.addEventListener('keydown', unlockOnFirstGesture, { passive: true });

  // เล่นเสียงคลิกอัตโนมัติเมื่อกดปุ่มใดๆ ในเกม
  document.addEventListener('click', (e) => {
    if (e.target.closest('button:not(:disabled)')) {
      playSfx('click');
    }
  });

  // พักเพลงอัตโนมัติเมื่อสลับแอปหรือพับหน้าจอ
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseAllBgm();
    } else if (hasUserInteracted && prefs.bgmEnabled) {
      playCurrentBgm();
    }
  });
}