/**
 * js/ui/pixel_photos.js
 * รูปภาพพิกเซลสำหรับโพสต์ในโซเชียล (วาดด้วย canvas ไม่ใช้ไฟล์รูป)
 */

const W = 80;
const H = 60;

const n2 = (x, y, seed) => ((Math.imul(x * 73856093 ^ y * 19349663 ^ seed, 2654435761) >>> 0) % 100) / 100;

export function drawPhoto(canvas, kind, seed = 1) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const r = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const sky = (top, bottom, split = 36) => { for (let y = 0; y < H; y++) r(y < split ? top : bottom, 0, y, W, 1); };
  const person = (x, y, shirt, skin = '#F0C9A0', hair = '#3a2a10') => {
    r('rgba(0,0,0,.2)', x - 1, y + 17, 11, 2);
    r('#2b2b3a', x + 1, y + 12, 3, 6); r('#2b2b3a', x + 5, y + 12, 3, 6);
    r(shirt, x, y + 5, 9, 8); r(skin, x + 1, y - 2, 7, 7); r(hair, x + 1, y - 3, 7, 3);
    r('#1b1b1b', x + 3, y + 1, 1, 1); r('#1b1b1b', x + 6, y + 1, 1, 1); r('#c0503a', x + 4, y + 3, 2, 1);
  };
  switch (kind) {
    case 'cat':
      sky('#EFE2C8', '#C9A56F', 40);
      r('#8A5A33', 0, 40, W, 3);
      r('#E8791A', 28, 24, 26, 18); r('#E8791A', 30, 14, 22, 14);
      r('#E8791A', 30, 10, 5, 6); r('#E8791A', 47, 10, 5, 6);
      r('#FFD9A8', 33, 20, 16, 7); r('#1b1b1b', 35, 19, 3, 3); r('#1b1b1b', 44, 19, 3, 3); r('#C0503A', 40, 24, 2, 2);
      r('#FFD84A', 33, 6, 16, 4); r('#FFD84A', 33, 3, 3, 4); r('#FFD84A', 39, 2, 3, 5); r('#FFD84A', 46, 3, 3, 4);
      break;
    case 'food':
      sky('#8B5A33', '#6B4423', 0);
      r('#F5F0E6', 14, 12, 52, 38); r('#E4DACA', 16, 14, 48, 34);
      for (let i = 0; i < 4; i++) { const x = 20 + i * 11, y = 18 + (i % 2) * 12; r('#FFFFFF', x, y, 11, 9); r('#FFC21A', x + 3, y + 2, 5, 5); }
      break;
    case 'game':
      sky('#16152B', '#16152B', 0);
      r('#2D2B52', 8, 6, 64, 28); r('#5B5BFF', 12, 10, 56, 20); r('#FFE27A', 20, 16, 4, 4); r('#FF6B6B', 50, 14, 4, 4); r('#6BFF9E', 56, 20, 4, 4);
      r('#7A7A8E', 14, 40, 52, 14); r('#3A3A4A', 20, 44, 4, 6); r('#3A3A4A', 18, 46, 8, 2); r('#E8456B', 46, 44, 4, 4); r('#4DA6FF', 54, 46, 4, 4);
      break;
    case 'study':
      sky('#2B2236', '#6B4423', 36);
      r('#F5F0E6', 12, 24, 26, 20); r('#F5F0E6', 42, 24, 26, 20); r('#C9C1B0', 38, 24, 4, 20);
      for (let i = 0; i < 5; i++) { r('#8A8A8A', 15, 28 + i * 3, 20, 1); r('#8A8A8A', 45, 28 + i * 3, 20, 1); }
      r('#FFD84A', 60, 10, 3, 14); r('#FFD84A', 56, 8, 11, 3); r('rgba(255,216,74,.25)', 50, 14, 26, 26);
      break;
    case 'run':
      sky('#8FD0FF', '#4E9A3F', 30);
      r('#C9B08A', 0, 40, W, 12); for (let x = 0; x < W; x += 12) r('#fff', x, 45, 7, 1);
      person(34, 20, '#E8456B');
      r('#fff', 52, 24, 14, 1); r('#fff', 56, 28, 12, 1);
      break;
    case 'art':
      sky('#F5F0E6', '#E4DACA', 0);
      r('#8A5A33', 18, 6, 44, 38); r('#FFFFFF', 21, 9, 38, 32);
      r('#A87A4A', 29, 18, 22, 16); r('#A87A4A', 31, 16, 18, 20); r('#6B4423', 35, 22, 2, 2); r('#6B4423', 44, 26, 2, 2); r('#6B4423', 38, 30, 2, 2);
      r('#8A5A33', 30, 46, 30, 3); r('#E8456B', 22, 48, 4, 8); r('#4DA6FF', 28, 48, 4, 8);
      break;
    case 'guitar':
      sky('#F2D8A8', '#C9A56F', 0);
      r('#A0612B', 22, 30, 28, 24); r('#A0612B', 26, 22, 20, 12); r('#2b1a0b', 32, 34, 8, 8);
      r('#5B3A1E', 46, 6, 5, 28); r('#5B3A1E', 44, 4, 9, 5);
      for (let i = 0; i < 4; i++) r('#E8E8E8', 36 + i, 8, 1, 40);
      break;
    case 'sea':
      sky('#8FD0FF', '#2B6FC4', 26);
      r('#FFE27A', 62, 6, 10, 10); r('#E8D08A', 0, 40, W, 20);
      for (let x = 0; x < W; x += 8) r('#9ACFF5', x, 28 + (x % 16 ? 0 : 2), 5, 1);
      r('#E5503A', 32, 44, 14, 8); r('#E5503A', 28, 42, 5, 4); r('#E5503A', 45, 42, 5, 4); r('#1b1b1b', 35, 45, 2, 2); r('#1b1b1b', 41, 45, 2, 2);
      break;
    case 'friends':
      sky('#FFB86B', '#6B4A8A', 34);
      r('#4E9A3F', 0, 40, W, 20);
      person(8, 26, '#E8456B', '#F0C9A0', '#1b1b1b'); person(22, 26, '#4DA6FF', '#D9A878'); person(36, 26, '#FFD84A', '#F0C9A0', '#6B3A1E');
      person(50, 26, '#6BFF9E', '#C99568', '#1b1b1b'); person(64, 26, '#B26BFF', '#F0C9A0', '#3a2a10');
      r('#FF6B6B', 38, 8, 6, 5); r('#FF6B6B', 44, 8, 6, 5); r('#FF6B6B', 40, 12, 8, 4);
      break;
    case 'pride': {
      const cols = ['#E8456B', '#F28B2A', '#FFD84A', '#4EBF6A', '#4DA6FF', '#8A5BE8'];
      sky('#CFE8FF', '#CFE8FF', 0);
      cols.forEach((c, i) => r(c, 0, 14 + i * 5, W, 5));
      r('#FFFFFF', 6, 4, 20, 6); r('#FFFFFF', 12, 2, 12, 6); r('#FFFFFF', 54, 8, 18, 5);
      person(34, 40, '#FFFFFF', '#D9A878', '#8A5BE8');
      break;
    }
    case 'selfie':
      sky('#FFD9C9', '#FFB8A0', 0);
      r('#F0C9A0', 22, 8, 36, 40); r('#3a2a10', 20, 4, 40, 14); r('#3a2a10', 18, 12, 6, 22); r('#3a2a10', 56, 12, 6, 22);
      r('#fff', 28, 24, 8, 6); r('#fff', 44, 24, 8, 6); r('#1b1b1b', 31, 25, 3, 4); r('#1b1b1b', 47, 25, 3, 4);
      r('#C0503A', 33, 38, 14, 3); r('#F0A8A8', 26, 33, 6, 3); r('#F0A8A8', 48, 33, 6, 3);
      r('#4DA6FF', 30, 48, 20, 12);
      break;
    default:
      sky('#1b1b25', '#1b1b25', 0);
      r('#3a3a4a', 26, 10, 28, 36); r('#16161f', 30, 14, 20, 28); r('#8f8fa0', 38, 22, 4, 4); r('#8f8fa0', 40, 28, 2, 6);
  }
  // เม็ดเกรนฟิล์มให้ดูเป็นรูปถ่าย
  for (let i = 0; i < 40; i++) { const x = Math.floor(n2(i, seed, 7) * W), y = Math.floor(n2(seed, i, 9) * H); r('rgba(255,255,255,.08)', x, y, 1, 1); }
}
