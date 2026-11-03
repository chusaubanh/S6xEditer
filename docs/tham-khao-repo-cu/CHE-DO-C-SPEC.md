# Chế độ C — Talking head từ clip quay thật (đặc tả kỹ thuật v1)

Chốt ngày 22/10/2026 (người dùng), rà và hoà giải ngày 23/10/2026. Đây là nguồn chuẩn cho mọi code và tài liệu của Chế độ C.

Mục cũ bị thay được viết lại hoặc đánh dấu `(đã thay 23/10/2026: …)` ngay tại chỗ. Thứ tự chạy thực tế (22 bước, có cảnh báo thứ tự) nằm ở "Thứ tự chạy chuẩn"; quy tắc cứng do người dùng đặt ở "Quy tắc cứng"; kinh nghiệm vận hành ở "Vận hành"; job mẫu ở "Ví dụ mẫu".

## Nguyên tắc

- Đầu vào là clip quay thật. Giọng là audio gốc, KHÔNG qua TTS VieNeu, KHÔNG qua `npm run pipeline` (chế độ A/B giữ nguyên).
- Không render thẳng video cuối: mọi bước ghi vào `output/<job>/project.json` (timeline nhiều layer). Người dùng chỉnh trong editor localhost, rồi mới xuất.
- Xuất chọn theo job: (a) `th:render` ra mp4; (b) đẩy sang Premiere qua panel "Script Rough Cut Bridge" (giai đoạn 2, chưa làm). `th:render` CHỈ chạy khi người dùng nói "xuất".
- Chỉ sao chép clip nguồn, không bao giờ di chuyển/sửa bản gốc. Không ghi đè output cũ (đổi tên `_archive-<ngày>`).
- Một việc thất bại 2 lần thì dừng và báo người dùng.
- Mọi bước ghi trạng thái vào `output/<job>/run.json` để phiên khác làm tiếp được.
- Không dùng React/GSAP/Framer Motion. Editor và overlay runtime viết HTML/CSS/JS thuần. Chuyển động dùng đúng tên preset của `scripts/scene-kit/motion.mjs`.

## Khung hình (chốt 22/10/2026)

Video đào tạo nội bộ, xem trên máy tính và điện thoại, KHÔNG đăng mạng xã hội. Mỗi job hỏi người dùng chọn một trong hai:

- **Ngang 16:9 — 1920×1080** (máy tính, TV, máy chiếu).
- **Dọc 4:5 — 1080×1350** (điện thoại; khớp sẵn kích thước cảnh scene-kit).

**Khung người nói:** mặc định crop từ eo/bụng trở lên (medium shot), KHÔNG lấy toàn thân; tuỳ chọn cận đầu-vai. Thực hiện bằng `project.videoTransform` (scale, x, y) sau `th:project`; `videoMoves` (zoom) tính tương đối trên khung crop này.

9:16 vẫn hỗ trợ kỹ thuật nhưng không phải lựa chọn mặc định; lớp phủ vùng an toàn TikTok/Reels/Shorts mặc định TẮT. Preset phải có vị trí mặc định hợp lý cho cả 16:9 và 4:5 (toạ độ % theo từng tỷ lệ).

## Model (máy RTX 3050 8 GB — chạy LẦN LƯỢT trên GPU, nhả VRAM giữa các bước)

| Việc | Model | Ghi chú |
|---|---|---|
| Phiên âm | Whisper large-v3, WhisperX, compute_type float16, language "vi" | Ứng viên A/B: PhoWhisper-large (chuyển CTranslate2). Cờ `--model` |
| Căn từ | `nguyenvulebinh/wav2vec2-base-vietnamese-250h` | word-level timestamps. KHÔNG dùng model mặc định của WhisperX 3.4.2 cho vi (`wav2vec2-base-vi` không có đầu CTC → mốc từ vô nghĩa) |
| VAD | Silero VAD | dùng để phát hiện từ đệm (xem dưới) |
| Giảm ồn | DeepFilterNet3 | GPU |
| Độ to | ~~ffmpeg loudnorm 2 lượt cho `audio.wav`~~ (đã thay 23/10/2026: `th:audio` đưa gain riêng từng clip về −18 LUFS; loudnorm master I=-16 LUFS, TP=-1.5, LRA=11 chỉ làm ở bước mix khi render) | CPU |
| Mã hoá | h264_nvenc (fallback libx264) — dùng lại `src/studio/render/video-tools.ts` nếu được | |
| Hiệu đính, dàn ý, kế hoạch đồ hoạ | Claude (AI CLI) | không chạy local |

KHÔNG dùng diarization (pyannote). Môi trường Python riêng: `.venv-asr` (không đụng `.venv-vieneu`).

**Từ đệm:** Whisper hay bỏ "ừm, à, ờ". Phát hiện bằng: vùng VAD có tiếng nói nhưng không chứa từ đã căn nào, dài ≥ 0.15 s → ứng viên từ đệm. Cộng thêm các từ khớp danh sách đệm ("ừm","ừ","à","ờ","ơ","kiểu","thì là","nói chung là"). Đưa `initial_prompt` có chứa "ừm, à, ờ" để Whisper giữ lại nhiều hơn.

## Luồng và lệnh

| Bước | Lệnh / việc | Đầu ra trong `output/<job>/` |
|---|---|---|
| 0 Cài | `npm run th:setup` (scripts/setup-asr.ps1) | `.venv-asr/` |
| 01 Tiếp nhận | `npm run th:intake -- "<clip>" [--doc "<tên tài liệu gốc>"] [--name <slug video>]` | copy vào `input/<tài liệu>/raw/`, job ở `output/<tài liệu>/<slug>/`; `media.json` (ffprobe), `run.json` |
| 02a Phiên âm | `npm run th:transcribe -- <job> [--model large-v3\|phowhisper-large]` | `transcript.raw.json`, `vad.json`, `fillers.json` |
| 02b Hiệu đính | AI viết `transcript.edited.txt` (một đoạn/dòng, cùng số dòng với segments) + `questions.md` (chỗ không chắc, kèm mốc thời gian) → hỏi người dùng → `npm run th:align-edits -- <job>` | `transcript.edited.json` (giữ timestamp từng từ, căn lại bằng diff token) |
| 02c Dàn ý | AI viết `outline.json` + `outline.md` (tóm tắt + đầu mục lớn→nhỏ, mỗi mục có start/end) | |
| ✋ Cổng | `npm run th:approve -- <job> --stage outline --note "<yêu cầu cắt của người dùng>"` | `th-approval.json` |
| 02d Cắt thô | `npm run th:cut-plan -- <job>` sinh ứng viên (từ đệm, lặng > 0.6 s, câu lặp) → AI thêm cắt theo yêu cầu (theo outline id) vào `cuts.json` → người dùng duyệt → `th:approve --stage cut` → `npm run th:cut -- <job> --aspect 16:9\|4:5` | `cuts.json`, `cut.mp4`, `transcript.cut.json` (timestamp đã ánh xạ sang timeline mới) |
| 03 Âm thanh | `npm run th:audio -- <job>` | `audio.wav` (DeepFilterNet3; gain riêng từng clip −18 LUFS — đã thay 23/10/2026, không còn loudnorm 2 lượt ở bước này; master loudnorm ở mix) |
| 05 Đồ hoạ | `npm run th:project -- <job>` dựng `project.json` nền (track video, phụ đề tự động từ transcript.cut, tiêu đề mục từ outline) → AI thêm layer đồ hoạ | `project.json` |
| 07 Chỉnh sửa | `npm run editor -- <job>` → http://localhost:4317 | lưu thẳng `project.json` (giữ bản `project.backup-<time>.json`) |
| 08 Xuất | `npm run th:render -- <job>` | `video.mp4` |

Bảng trên là khung ban đầu; các bước bổ sung (crop, `th:subject`, B-roll, intro, nguồn/proxy/clips) và THỨ TỰ thực tế nằm ở mục "Thứ tự chạy chuẩn" ngay dưới.

Đã làm sau 22/10 (không còn là giai đoạn 2): SFX theo layer, nhạc nền ducking, B-roll, video gốc chỉnh được (`videoClips`), reframe tự do. Chưa làm: xuất Premiere (xmeml + PNG/ProRes 4444), LUT màu, nhận diện mặt tự động (hiện nhập tay bằng `th:subject --face`).

## Thứ tự chạy chuẩn (22 bước — chạy thật 22–23/10/2026)

Cổng người dùng đánh dấu ✋. Cùng danh sách này nằm ở `SKILL.md` mục "Required Workflow → Nhánh Chế độ C"; hai nơi phải giống nhau.

1. `npm run th:intake -- "<clip>" [--doc "<tên tài liệu gốc>"] [--name <slug video>]` — sao chép clip vào `input/<tài liệu>/raw/`, tạo job `output/<tài liệu>/<slug>/` (job id = `"<tài liệu>/<slug>"`), sinh `media.json`, `run.json`.
2. `npm run th:transcribe -- <job>` — chạy `nvidia-smi` trước (GPU dùng chung, VRAM phải còn trống).
3. AI hiệu đính: viết `transcript.edited.txt` (đúng số dòng = số segment) + `questions.md` (chỗ không chắc: đoạn không phải lời giảng, thuật ngữ, con số, tên/chức danh người nói). ✋ **Hỏi người dùng** các câu trong `questions.md`.
4. `npm run th:align-edits -- <job>`.
5. AI viết `outline.json` (và trình bày tóm tắt + dàn ý lớn→nhỏ). ✋ **Người dùng xác nhận** dàn ý, nêu yêu cầu cắt (chuỗi video / 1 video / tóm tắt / chạy thử 1 phần) và chọn khung **16:9 hoặc 4:5**.
6. `npm run th:approve -- <job> --stage outline --note "<yêu cầu cắt>"`.
7. `npm run th:cut-plan -- <job>` (AI thêm khoảng cắt manual vào `cuts.json` theo yêu cầu của người dùng).
8. ✋ Người dùng duyệt danh sách cắt → `npm run th:approve -- <job> --stage cut`.
9. `npm run th:cut -- <job> --aspect 16:9|4:5`.
10. `npm run th:audio -- <job>`.
11. `npm run th:project -- <job>`.
12. Crop từ bụng trở lên bằng `videoTransform` (lấy mẫu ~20 khung để chọn) + `npm run th:subject -- <job> --face x,y,w,h`.
13. AI phân tích bài giảng → `broll-storyboard.md`: từng đoạn ghi cắt cảnh toàn màn hình hay overlay, vai trò thay thế/bổ trợ, minh hoạ gì, chuyển động gì, SFX gì.
14. Viết set scene-kit RIÊNG cho bài (cutaway nền đặc + overlay nền trong suốt có gradient đáy; nhịp khớp từng từ theo `transcript.cut.json`) → `node scripts/scene-kit/build.mjs <set>` + cổng QA scene-kit.
15. AI viết `broll-plan.json` (`side` cho overlay, zoom nhấn bằng anchor, camera auto) — xem `docs/BROLL-GUIDE.md`.
16. `npm run th:broll -- <job>` (planSfx, pack `corporate`).
17. `npm run th:intro -- <job> --from <s> --to <s>` (cold open bằng câu "chốt", lead-in 0,6 s, `whoosh-long-electro-01`).
18. `npm run th:source-audio -- <job>`.
19. `npm run th:proxy -- <job>`.
20. `npm run th:clips-init -- <job>`.
21. `npm run editor -- <job>` → http://localhost:4317. ✋ **Người dùng xem/chỉnh** (không có cổng duyệt storyboard riêng).
22. `npm run th:render -- <job>` — CHỈ khi người dùng nói "xuất".

**CẢNH BÁO THỨ TỰ:**

- `th:project` XOÁ mọi layer — không chạy lại sau bước 11.
- Khi project đã có `videoClips`: `th:cut`, `th:audio`, `th:intro` (kể cả `--redo`) và `th:project --force` bị từ chối.
- `th:intro` phải chạy TRƯỚC `th:clips-init` (bước 17 trước bước 20).
- **CHƯA KIỂM:** chạy lại `th:broll` sau khi đã có clips; thêm intro sau khi đã có clips (chỉ làm được qua tab Nguồn của editor).

## project.json v1

```jsonc
{
  "version": 1,
  "job": "ten-job",
  "fps": 30,
  "width": 1080, "height": 1350, "aspect": "4:5",          // hoặc 1920×1080 "16:9" (đã thay 23/10/2026: ví dụ cũ là 1080×1920 9:16)
  "duration": 182.4,                       // giây
  "source": { "video": "cut.mp4", "audio": "audio.wav" },  // tương đối với output/<job>/
  "videoTransform": { "scale": 1, "x": 0, "y": 0 },       // reframe clip gốc trong khung (x,y theo % canvas)
  "tracks": [
    {
      "id": "t-sub", "kind": "subtitle",   // "graphics" | "subtitle" | "scene" | "sfx" | "music"
      "name": "Phụ đề", "hidden": false, "locked": false,
      "layers": [ /* Layer */ ]
    }
  ]
}
```

Track trên cùng của mảng = nằm trên cùng khi hiển thị. Video nguồn luôn là nền (không nằm trong tracks).

**Layer:**

```jsonc
{
  "id": "L-0001",
  "type": "text",            // "text" | "subtitle" | "lowerThird" | "callout" | "scene" | "image" | "shape"
  "start": 12.30, "duration": 3.2,           // giây trên timeline đã cắt
  "x": 10, "y": 70, "w": 80, "h": 12,         // % canvas, góc trên trái
  "rotation": 0, "opacity": 1,
  "text": "Nội dung chữ",                    // text/subtitle/lowerThird/callout
  "subtext": "Chức danh",                    // tuỳ chọn (lowerThird)
  "words": [ { "text": "Nội", "start": 12.30, "end": 12.55 } ],  // tuỳ chọn, cho subtitle karaoke
  "style": {
    "fontFamily": "Be Vietnam Pro", "fontSize": 64, "fontWeight": 800,   // px theo canvas
    "color": "#EDEDED", "accentColor": "#C5A059", "background": "rgba(12,12,12,0.72)",
    "align": "center", "radius": 16, "padding": 24, "strokeColor": null, "strokeWidth": 0, "shadow": true
  },
  "animation": {
    "in":  { "kind": "rise", "dur": 0.45 },   // rise|drop|left|right|pop|bounce|zoom|soft|stamp|fade|none
    "out": { "kind": "fade", "dur": 0.3 },    // fade|shrink|up|down|none
    "subtitleMode": "word"                    // chỉ subtitle: "line" | "word" (tô vàng từ đang nói)
  },
  "templateId": "frame-xxx-01",              // chỉ type "scene": cảnh scene-kit toàn màn hình
  "inputs": {},                               // chỉ type "scene"
  "src": "assets/...png",                    // chỉ image
  "meta": { "outlineId": "2.1", "source": "auto|ai|user" }
}
```

Màu mặc định lấy `assets/brand/brand-guideline.json` (vàng `#C5A059` là màu nhấn duy nhất; đỏ chỉ nghĩa "sai"). Font trong `assets/fonts/`.

## Âm thanh trong project.json (bổ sung 22/10/2026)

Track `kind: "sfx"` và `kind: "music"` chứa layer `type: "audio"`. Giọng gốc (`source.audio`) hiển thị trong editor như một track cố định "Giọng" (không nằm trong `tracks`).

```jsonc
// Layer âm thanh
{
  "id": "A-0001", "type": "audio",
  "start": 12.30, "duration": 0.8,     // vị trí trên timeline (giây)
  "src": "assets/sfx/whoosh/whoosh-01.mp3",  // tương đối với repo (thư viện) hoặc output/<job>/
  "offset": 0,                           // cắt đầu file nguồn (giây)
  "gainDb": -8,                          // âm lượng layer
  "fadeIn": 0, "fadeOut": 0.05,
  "meta": { "category": "whoosh", "linkedLayerId": "L-0008", "linkEdge": "in", "source": "auto|ai|user" }
}
```

- `linkedLayerId` + `linkEdge` ("in" | "out"): SFX gắn với lúc layer đồ hoạ vào/ra. Kéo layer đồ hoạ thì SFX đi theo. Bỏ liên kết khi người dùng tự kéo SFX.
- Trường gốc của project:

```jsonc
"audio": {
  "voice": { "gainDb": 0, "muted": false },
  "music": { "duckDb": -12, "attack": 0.15, "release": 0.45 },  // nhạc tự hạ khi có giọng
  "master": { "lufs": -16, "truePeak": -1.5 }
}
```

- Render: giọng + SFX + nhạc (ducking bằng sidechaincompress theo giọng) → loudnorm master. Các SFX chồng nhau giữ dưới −1 dBTP. Module dùng chung: `src/talking-head/audio-mix.ts` — `mixProjectAudio(project, jobDir, outWav)`.

## Preset (mẫu có sẵn) — `assets/th-presets/`

Mỗi file một loại: `subtitle.json`, `lowerThird.json`, `callout.json`, `text.json`, `sfx-packs.json`.

```jsonc
{ "type": "lowerThird", "presets": [
  { "id": "lt-glass", "name": "Kính mờ", "variants": [
    { "id": "gold", "name": "Nhấn vàng", "style": { ... }, "animation": { ... }, "sfx": { "in": "whoosh-soft", "out": null } }
  ] }
] }
```

Layer ghi `meta.presetId` + `meta.variantId`. Người dùng đổi biến thể là áp lại style/animation/sfx mà giữ nguyên chữ, thời gian, vị trí. `sfx-packs.json`: gói âm thanh theo phong cách (ví dụ "Tối giản", "Năng động", "Doanh nghiệp") ánh xạ từ kiểu chuyển động (rise, pop, stamp...) sang danh mục SFX.

## Minh hoạ động / B-roll (bổ sung 22/10/2026)

Mục tiêu: video không đơn điệu — cứ 3–6 giây phải có một thay đổi thị giác có chủ đích, minh hoạ đúng câu đang nói. Năm công cụ:

1. **Asset động** *(đã thay 23/10/2026: thư viện `assets/th-assets/` đã HUỶ, thư mục không còn; minh hoạ vẽ riêng từng bài bằng scene-kit. Layer `type: "asset"` chỉ còn dùng khi `src` là đường dẫn SVG trực tiếp, không phải cách làm chuẩn)* — SVG có animation vào/ra + chuyển động lặp:
   ```jsonc
   { "type": "asset", "src": "assets/<đường-dẫn-trực-tiếp>.svg", "x":..,"y":..,"w":..,"h":..,
     "animation": { "in": {"kind":"pop","dur":0.45}, "out": {"kind":"shrink","dur":0.3},
                    "loop": {"kind":"float|pulse|wiggle|spin|bob|none", "period": 2.4, "amp": 1} },
     "draw": { "dur": 0.8 },          // tuỳ chọn: vẽ nét SVG dần (stroke-dashoffset) — mũi tên, vòng khoanh, gạch chân
     "tint": "#C5A059" }              // tuỳ chọn: đổi màu chính của SVG đơn sắc
   ```
2. **Cảnh minh hoạ (cutaway / overlay)** — layer `type: "scene"` (scene-kit riêng của bài). Cutaway nền đặc phủ kín khung, thay hình người nói; overlay nền trong suốt nằm trên người nói. Xem "Chốt sau brainstorm" và "Quy tắc cứng".
3. **Chuyển động máy quay trên video gốc** — `project.videoMoves` (mảng, không chồng thời gian). *(`mode: "pip"` đã thay 23/10/2026: KHÔNG dùng — cutaway thì người nói biến mất chứ không thu nhỏ; chỉ dùng `zoom`/`kenburns`.)*
   ```jsonc
   { "start": 12.0, "end": 15.5, "mode": "zoom|pip|kenburns",
     "scale": 1.25, "x": 0, "y": -6,           // zoom/kenburns: phóng + dịch (x,y % canvas)
     "pip": { "x": 62, "y": 58, "w": 34, "radius": 24, "shadow": true },  // pip: video thu nhỏ vào góc
     "ease": { "in": 0.35, "out": 0.35 } }     // giây chuyển vào/ra
   ```
   Ngoài các đoạn này video theo `videoTransform` tĩnh.
4. **Lớp nằm dưới video** *(đã thay 23/10/2026: không dùng — chỉ phục vụ chế độ pip đã bỏ)* — track có `"belowVideo": true` vẽ DƯỚI video (dùng cho cảnh nền khi video đang ở chế độ `pip`). Thứ tự vẽ: track belowVideo → video (theo videoMoves) → các track còn lại.
5. **Chuyển cảnh** — layer `type: "transition"`: `{"kind": "flash|wipe|panel|iris|shutter", "dur": 0.4, "color": "#C5A059", "dir": "left|right|up|down"}` — hiệu ứng phủ (không làm mờ video) đặt đúng điểm vào/ra cutaway, có SFX gắn.

**Chốt sau brainstorm (22/10/2026, người dùng):**
- Minh hoạ **vẽ riêng cho từng bài** bằng scene-kit/HyperFrames (như Chế độ A/B), KHÔNG dùng thư viện asset chung. Mỗi job có set scene-kit riêng (ví dụ `tcvbh2`).
- Hai loại cảnh: **cutaway** (nền đặc, phủ kín, người nói BIẾN MẤT — không PiP) và **overlay** (nền trong suốt, minh hoạ nhảy quanh/dưới người nói, có **dải gradient tối từ dưới lên** che bớt người nói cho minh hoạ nổi bật; không che mặt). Cả hai là layer `type: "scene"`; overlay có `meta.overlay: true`, template nền trong suốt.
- Nhịp theo lời nói. Nền tảng tối thiểu: máy quay zoom vào/ra nhẹ mỗi 3–6 s ở ranh giới câu (không trong cutaway); zoom nhấn mạnh hơn ở câu quan trọng.
- Phong cách: sang trọng, tiết chế nhưng vẫn cuốn hút như TikTok.
- Không có cổng duyệt storyboard: dựng thẳng, người dùng xem và chỉnh trong editor.

Kế hoạch minh hoạ do AI viết vào `output/<job>/broll-plan.json` (xem `docs/BROLL-GUIDE.md`), `npm run th:broll -- <job>` dựng thành layer (meta.source "ai"), người dùng chỉnh trong editor. Quy tắc cứng: không che mặt người nói; không quá 2 asset cùng lúc cạnh người nói; cutaway BỔ TRỢ 2–6 s, còn cutaway THAY THẾ dài theo lời giảng, tới ~18 s (đã thay 23/10/2026: "cutaway 2–6 s" chỉ áp cho loại bổ trợ); sau cutaway quay lại người nói ≥ 2 s; mọi thứ nằm trong title-safe; asset và chữ không đè lên phụ đề.

## Video gốc chỉnh được — videoClips (bổ sung 23/10/2026)

Người dùng chốt: người dùng tự cắt ghép video gốc trong editor (track "Video gốc" + trình duyệt video gốc). Layer **đứng yên theo giây** khi cắt/chèn video (không ripple layer).

**Nguồn sự thật duy nhất:** khi project có `videoClips`, các file `cut.mp4`, `audio.wav`, `transcript.cut.json`, `peaks.json` là SẢN PHẨM dựng từ clips (không còn là đầu vào). `th:cut`, `th:audio`, `th:intro` (kể cả `--redo`) và `th:project --force` TỪ CHỐI chạy trên job có clips. `th:render` tự dựng lại cut/voice từ clips theo hash trước pass overlay; khoá cache mix gồm hash clips; `transcript.cut.json` tạo lại từ clips mỗi lần đổi (để anchor của th:broll đúng).

```jsonc
"source": { "video": "cut.mp4", "audio": "audio.wav",
            "raw": "input/<tài liệu>/raw/<file>.mp4",          // video gốc đầy đủ (tương đối gốc repo; dạng cũ "../../input/…" vẫn đọc được)
            "rawAudio": "source-audio.wav",                   // giọng đã giảm ồn cho CẢ nguồn (DeepFilter 1 lần, KHÔNG loudnorm — master loudnorm ở mix lo)
            "proxy": "source-proxy.mp4" },                    // proxy editor: GOP ngắn (keyint ~15) + giọng đã giảm ồn mux sẵn
"videoClips": [                                               // tuần tự, không khoảng hở; thời điểm timeline = cộng dồn
  { "id": "C-0001", "kind": "hold",   "srcIn": 1474.123, "dur": 0.6 },   // khung tĩnh (lead-in intro): giữ khung tại srcIn
  { "id": "C-0002", "kind": "source", "srcIn": 1474.123, "srcOut": 1480.689 },
  { "id": "C-0003", "kind": "source", "srcIn": 177.88,   "srcOut": 189.60 }
]
"revision": 12                                                // tăng mỗi lần lưu; server từ chối PUT có revision cũ hơn bản trên đĩa (409)
```

- srcIn/srcOut là giây trên video GỐC, đã snap biên khung. Mỗi điểm nối có crossfade audio 10 ms.
- Migration job cũ: lấy biên từ `cut-map.json` + offset intro (đúng như đã snap), KHÔNG tính lại từ cuts.json. Sao lưu `project.before-clips.json`.
- Chấp nhận Giai đoạn 1: dựng lại từ clips phải trùng bản cũ: cùng số khung, |A−V| ≤ 1 khung, sai khác điểm ảnh ~0 tại khung mẫu (nhất là mọi điểm nối + lead-in), mức giọng ±0.5 LU so với audio.wav cũ.
- Giai đoạn: (1) hợp đồng + migration + dựng từ clips + parity, không UI; (2) track "Video gốc": S cắt tại playhead, kéo mép trim, Delete (ripple CHỈ video), kéo đổi thứ tự, undo; (3) trình duyệt video gốc: I/O, tô vùng đã dùng, chèn tại playhead.

## Overlay runtime (dùng chung editor + render)

`scripts/editor/public/overlay-runtime.js`: hàm thuần `mountOverlay(rootEl, project, {assetBase})` và `seek(t)` — dựng DOM cho mọi layer, tại thời điểm t tính hiển thị + trạng thái animation một cách TẤT ĐỊNH (không phụ thuộc thời gian thực). Editor gọi `seek` theo video đang phát; `th:render` dùng chính runtime này để render khung hình.

## Overlay → dịch người nói sang phía đối diện (bổ sung 22/10/2026)

- Beat `overlay` (và `keyword` ở mép) có `side: "left"|"right"` = phía minh hoạ chiếm. `buildBroll` sinh `project.videoShifts` (`[{start,end,x,ease:{in,out},source:"ai",beatId}]`, x = % canvas) đẩy người nói sang phía ngược lại (tâm ~70% khi minh hoạ bên trái, ~30% khi bên phải), ease 0.5 s, bắt đầu trước overlay 0.3 s (hoặc ẩn dưới cutaway vừa kết thúc). Overlay liền nhau cùng phía gộp một lần dịch; khác phía chéo mượt. Khoảng dịch kẹp theo room crop: |videoTransform.x + x| ≤ (scale − 1)·50.
- `videoShifts` cộng THÊM vào `videoTransform` + `videoMoves` (được chồng thời gian với videoMoves). Công thức dùng chung: `overlay-runtime.videoState` (editor) và `video-moves.ts` (render). Phụ đề vẫn căn giữa khung.
- Không vẽ/khoanh/mũi tên lên cơ thể người nói. Mọi phần tử xuất hiện đều có SFX (xem BROLL-GUIDE).

## Reframe tự do + máy quay (bổ sung 23/10/2026)

- `videoClips[].transform?: {scale 0,2–4, x, y (%canvas ±200)}` ghi đè `videoTransform` cho đúng clip; `project.camera?: {aiEnabled}` (false = bỏ qua move/shift `source:"ai"`).
- Khung hiệu lực tại t (editor `overlay-runtime.videoState`, render `video-moves.placementExprs`, CÙNG công thức): base = khung riêng của clip dưới t hoặc `videoTransform`; zoom/kenburns nhân scale và cộng dịch (kẹp tương đối theo z); `videoShifts` cộng dịch x. Video đặt vào canvas theo `scale·cover`, tâm = (50+x, 50+y)% — KHÔNG kẹp phủ kín; phần trống tô `#0C0C0C`.
- Render: mọi khung động / khung riêng theo clip / khung tĩnh không phủ kín → một lần ffmpeg: libplacebo `pos_*` + `fillcolor` (GPU) hoặc scale `eval=frame` + overlay lên nền ink (CPU, `--cpu` hoặc libplacebo lỗi). Khung tĩnh phủ kín vẫn dùng chuỗi cuvid/scale_cuda nhanh.
- Editor: bấm vào video (không trúng layer) = chọn "Video gốc": kéo = dời, tay nắm góc = phóng (Shift giữ tâm), cuộn = phóng quanh con trỏ, nhấp đúp = đặt lại, Alt tắt bám dính (phủ kín ±0,03, mép/tâm canvas ±1,2%). Mặc định sửa clip dưới playhead (khung riêng); "Áp cho mọi clip" / "Về khung chung" / ô "Sửa khung chung".
- Máy chủ báo `caps: ["clipTransform","camera"]` ở `/api/meta`; editor ẩn tính năng nếu máy chủ cũ (sẽ làm rơi trường mới khi lưu).

## Quy tắc cứng (người dùng đặt 22–23/10/2026)

Áp cho mọi job Chế độ C. Cùng danh sách này nằm ở `docs/BROLL-GUIDE.md` và là dòng "Chế độ C" của bảng RULE → CỔNG.

- **Khung người nói:** crop từ bụng trở lên, không toàn thân (đặt bằng `videoTransform`, lấy mẫu ~20 khung để chọn).
- **Không vẽ/khoanh/mũi tên lên cơ thể người nói.** Chữ/hình chỉ đặt ở mép, hai bên; muốn nhấn thì zoom hoặc keyword ở mép.
- **Overlay xuất hiện → dịch người nói sang phía đối diện** (`side`, `videoShifts`).
- **Mọi phần tử xuất hiện đều có SFX pop** — kể cả từng beat trong cảnh scene-kit (hai pop cách nhau ≥ 0,25 s).
- **Overlay chừa dải phụ đề** (y 68–88% canvas) và không che mặt.
- **Màu minh hoạ khớp lời nói** (người nói nói "phần màu xanh" thì phần đó màu xanh); **không đưa con số người nói không nói** lên hình.
- **Minh hoạ vẽ riêng từng bài** bằng scene-kit (không thư viện chung).
- **Intro cold open** dùng `whoosh-long-electro-01`.
- **Không có cổng duyệt storyboard:** `broll-storyboard.md` là tài liệu làm việc của AI; người dùng duyệt ngay trong editor.
- **Layer đứng yên theo giây** khi cắt/chèn clip (không ripple layer).
- **Nhịp thị giác 3–6 s:** cứ 3–6 giây có một thay đổi (minh hoạ, zoom, dịch); máy quay zoom vào/ra nhẹ ở ranh giới câu.
- **Phong cách:** sang trọng, tiết chế nhưng vẫn cuốn hút.
- **Đối tượng:** video đào tạo nội bộ; khung 16:9 hoặc 4:5 (hỏi người dùng mỗi job).
- **Nhạc nền** lấy từ `assets/music-th/` (có `manifest.json`); mỗi bài nhạc ghi nguồn trong `assets/music-th/SOURCES.md`.

## Vận hành (kinh nghiệm chạy thật 22–23/10/2026)

- **`#videoBox` cần `z-index: 0`** trong editor; nếu không, overlay biến mất ở chế độ clips (video đè lên).
- **QA phải bắt đầu phát bằng click thật** vào nút phát; `play()` gọi bằng script bị trình duyệt chặn autoplay nên QA tự động sẽ thấy khung đứng yên.
- **Ctrl+F5 sau mọi thay đổi server/schema** (editor cache file tĩnh; bản cũ ghi đè trường mới khi lưu).
- **`revision` trên đĩa phải ≥ 1** để máy chủ chặn tab cũ ghi đè (409). Khi cần PUT thử: chỉ gửi tới máy chủ của BẢN SAO job, **không bao giờ tới cổng 4350 của người dùng**.
- **Chỉ dừng đúng PID mình khởi động**; không `taskkill` theo tên tiến trình (sẽ giết editor/GPU job của người dùng).
- **Kiểm `nvidia-smi` trước Whisper/DeepFilter**: GPU dùng chung với việc khác (RTX 3050 8 GB), VRAM phải còn trống; chạy lần lượt.
- **Chưa cài `cv2`** → không dò mặt tự động; nhập vùng mặt tay bằng `th:subject --face x,y,w,h`.
- **Sau khi chạm giới hạn API**, tiếp tục agent cũ bằng `SendMessage` (giữ nguyên ngữ cảnh) thay vì khởi tạo agent mới.

## Ví dụ mẫu

Job `output/Tiêu chuẩn video bán hàng/02-khung-hinh-vang/` (job id `"Tiêu chuẩn video bán hàng/02-khung-hinh-vang"`, bài giảng "Tiêu chuẩn video bán hàng", phần Tiêu chuẩn 2) là mẫu làm chuẩn cho bài sau.

**Bố cục thư mục (chốt 23/10/2026):** mỗi tài liệu/clip gốc một folder — `output/<tên tài liệu gốc>/<slug video>/` (ví dụ `01-ty-le-khung-hinh/`, `02-khung-hinh-vang/`), bản sao thử nghiệm ở `output/<tên tài liệu gốc>/_test/`, job demo của editor ở `output/_dev-tests/`; clip gốc ở `input/<tên tài liệu gốc>/raw/` dùng chung. `th:intake` tự xếp theo bố cục này (`--doc` để đặt tên tài liệu, `--name` là slug). Các file trong job mẫu:

- `questions.md` — câu hỏi hiệu đính gửi người dùng (bước 3).
- `outline.json` — dàn ý có start/end từng mục (bước 5).
- `broll-storyboard.md` — phân tích từng đoạn: cutaway hay overlay, thay thế hay bổ trợ, minh hoạ gì, chuyển động gì, SFX (bước 13).
- `broll-plan.json` — kế hoạch beat (`side`, `cues`, `camera`) mà `th:broll` dựng thành layer (bước 15).
- Set scene-kit **`tcvbh2`** (`scripts/scene-kit/sets/tcvbh2.mjs`, thư viện hình `_tcvbh2_art.mjs`, build ra `templates/frame-tcvbh2-*`) là khuôn cho bài sau: cutaway nền đặc + overlay nền trong suốt có gradient đáy, nhịp khớp từng từ. Bài mới viết set riêng theo khuôn này, không dùng lại cảnh của `tcvbh2`.
