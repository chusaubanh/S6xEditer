// SINH TỰ ĐỘNG bởi `npm run voice:sync` — đừng sửa tay.
// Nguồn: VieNeu-TTS 3.8.3 (28 giọng preset), đọc qua GET /voices.
// Sửa tay sẽ trôi khỏi engine: bản 3.3.0 có 20 giọng, 3.8.3 có 25, và vùng miền
// của "Xuân Vĩnh" từng bị ghi sai trong bản chép tay.

export const VIENEU_STYLES = ["tu_nhien", "tin_tuc", "doc_truyen"] as const;
export type VieNeuStyle = (typeof VIENEU_STYLES)[number];

/** Phiên bản engine đã sinh ra danh sách này; vào cả cache key của giọng đọc. */
export const VIENEU_ENGINE_VERSION = "3.8.3";

export const VIENEU_VOICES = [
  { id: "Adam bựa", gender: "nam", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: true, description: "Phong cách tự nhiên" },
  { id: "Trúc Ly", gender: "nữ", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: true, description: "Phong cách tự nhiên" },
  { id: "Thiện Minh", gender: "nam", region: "Bắc", defaultStyle: "doc_truyen", editorsPick: true, description: "Phong cách kể chuyện" },
  { id: "Mai Anh", gender: "nữ", region: "Bắc", defaultStyle: "tin_tuc", editorsPick: true, description: "Phong cách tin tức" },
  { id: "Hải Đăng", gender: "nam", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: true, description: "Phong cách tự nhiên" },
  { id: "Thùy Dung", gender: "nữ", region: "Nam", defaultStyle: "tin_tuc", editorsPick: true, description: "Phong cách tin tức" },
  { id: "Thiền Tâm Đức", gender: "nam", region: "Bắc", defaultStyle: "doc_truyen", editorsPick: true, description: "Phong cách kể chuyện" },
  { id: "Ngọc Huyền", gender: "nữ", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: true, description: "Giọng đọc tự nhiên" },
  { id: "Quang Sơn", gender: "nam", region: "Trung", defaultStyle: "tu_nhien", editorsPick: true, description: "Phong cách tự nhiên" },
  { id: "Ngọc Trân", gender: "nữ", region: "Trung", defaultStyle: "tu_nhien", editorsPick: true, description: "Phong cách tự nhiên" },
  { id: "Minh Đức", gender: "nam", region: "Bắc", defaultStyle: "tin_tuc", editorsPick: false, description: "Phong cách tin tức" },
  { id: "Phạm Tuyên", gender: "nam", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: false, description: "Phong cách tự nhiên" },
  { id: "Thái Sơn", gender: "nam", region: "Nam", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách kể chuyện" },
  { id: "Xuân Vĩnh", gender: "nam", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: false, description: "Phong cách tự nhiên" },
  { id: "Thanh Bình", gender: "nam", region: "Bắc", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách kể chuyện" },
  { id: "Ngọc Linh", gender: "nữ", region: "Bắc", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách kể chuyện" },
  { id: "Đoan Trang", gender: "nữ", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: false, description: "Phong cách tự nhiên" },
  { id: "Thục Đoan", gender: "nữ", region: "Nam", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách kể chuyện" },
  { id: "Minh Triết", gender: "nam", region: "Nam", defaultStyle: "tin_tuc", editorsPick: false, description: "Phong cách tin tức" },
  { id: "Mỹ Duyên", gender: "nữ", region: "Nam", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách đọc truyện" },
  { id: "Quỳnh Anh", gender: "nữ", region: "Bắc", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách đọc truyện" },
  { id: "Đức Trí", gender: "nam", region: "Nam", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách đọc truyện" },
  { id: "Kim Thanh", gender: "nữ", region: "Nam", defaultStyle: "doc_truyen", editorsPick: false, description: "Phong cách đọc truyện" },
  { id: "Adam", gender: "nam", region: "Nam", defaultStyle: "tu_nhien", editorsPick: false, description: "Giọng đọc tự nhiên" },
  { id: "Quốc Tuấn", gender: "nam", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: false, description: "Phong cách tự nhiên" },
  { id: "Trúc Ly cũ", gender: "nữ", region: "Bắc", defaultStyle: "tu_nhien", editorsPick: false, description: "Phong cách tự nhiên (bản 3.3.0)" },
  { id: "Xuân Vĩnh cũ", gender: "nam", region: "Nam", defaultStyle: "tu_nhien", editorsPick: false, description: "Phong cách tự nhiên (bản 3.3.0)" },
  { id: "Mai Anh cũ", gender: "nữ", region: "Bắc", defaultStyle: "tin_tuc", editorsPick: false, description: "Phong cách tin tức (bản 3.3.0)" },
] as const satisfies ReadonlyArray<{
  id: string;
  gender: "nam" | "nữ";
  region: "Bắc" | "Trung" | "Nam";
  defaultStyle: VieNeuStyle;
  /** Giọng tác giả engine khuyến nghị (⭐ trong danh sách preset). */
  editorsPick: boolean;
  description: string;
}>;

export type VieNeuVoiceId = (typeof VIENEU_VOICES)[number]["id"];
export const VIENEU_VOICE_IDS = VIENEU_VOICES.map((voice) => voice.id) as [
  VieNeuVoiceId,
  ...VieNeuVoiceId[],
];

export function isVieNeuVoice(value: string): value is VieNeuVoiceId {
  return VIENEU_VOICE_IDS.includes(value as VieNeuVoiceId);
}
