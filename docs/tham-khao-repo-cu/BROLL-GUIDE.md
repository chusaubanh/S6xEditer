# Hướng dẫn viết `broll-plan.json` (Chế độ C)

Mục tiêu: cứ 3–6 giây có một thay đổi thị giác có chủ đích, minh hoạ đúng câu đang nói. AI viết kế hoạch, `npm run th:broll -- <job>` dựng thành layer (`meta.source: "ai"`), người dùng chỉnh trong editor. Dựng lại sẽ xoá layer AI cũ, giữ layer của người dùng.

Trước khi viết: đọc `transcript.cut.json` (thời gian đã là timeline sau cắt), `outline.json`, storyboard `broll-storyboard.md` của job, set scene-kit riêng của bài (mẫu: `templates/frame-tcvbh2-*`; thư viện `assets/th-assets/` đã huỷ 23/10/2026), và `subject.json` (vùng mặt, nếu có; chưa có thì `npm run th:subject -- <job> --face x,y,w,h`).

## Nguyên tắc chọn công cụ

| Tình huống trong lời nói | Dùng | Ghi chú |
|---|---|---|
| Thay đổi thị giác mỗi 3–6 s | bất kỳ beat nào bên dưới | khoảng trống không hình > 6 s là lỗi |
| Mở đầu mỗi ý lớn (theo `outline`) | `cutaway` hoặc `keyword` | cutaway bổ trợ 2–6 s; cutaway thay thế dài theo lời giảng, tới ~18 s (đã thay 23/10/2026); sau đó quay lại người nói ≥ 2 s |
| Danh từ cụ thể (điện thoại, file, biểu đồ) | `overlay` vẽ riêng trong set scene-kit của bài | (đã thay 23/10/2026: không còn `asset` từ thư viện chung) |
| Con số, quy tắc, tên riêng | `keyword` hoặc overlay | chỉ đưa con số người nói đã nói; không vẽ lên người nói |
| Câu nhấn mạnh | `zoom` 1.15–1.25× | 1–3 s, không chồng nhau |
| Giải thích dài > 15 s chưa có hình | `cutaway` thay thế hoặc `overlay` nhiều beat | (đã thay 23/10/2026: bỏ `pip`; người nói biến mất khi cutaway, không thu nhỏ) |
| Chuyển sang ý mới | `transitionIn`/`transitionOut` của cutaway, hoặc beat `transition` | chỉ ở ranh giới ý; flash/wipe/panel/iris/shutter |

## Luật cứng (th:broll cảnh báo, không tự sửa nội dung)

| Luật | Hệ quả khi vi phạm |
|---|---|
| Không che mặt người nói | `position: auto` tự né; vị trí chỉ định đè mặt sẽ bị cảnh báo; không có chỗ → bỏ beat |
| Tối đa 2 asset/keyword cùng lúc | beat thứ 3 bị bỏ, có cảnh báo |
| Cutaway bổ trợ 2–6 s (cutaway thay thế dài theo lời giảng, tới ~18 s); sau cutaway ≥ 2 s người nói | cảnh báo |
| Trong title-safe (x 6–94%, y 5–95%), không đè phụ đề | `auto` tự né phụ đề đang hiện |
| `videoMoves` (zoom/kenburns/pip) không chồng thời gian | move sau bị bỏ, có cảnh báo |
| Mật độ tối đa | khoảng 1 beat / 3 s; không dồn nhiều hiệu ứng vào một câu |
| Không vẽ lên người nói | KHÔNG đặt hình vẽ/khoanh/gạch/mũi tên trỏ lên cơ thể người nói (người dùng chốt 22/10/2026: nhạy cảm). Chỉ chữ/hình đặt ở mép, hai bên, không chạm người; muốn nhấn thì dùng zoom hoặc keyword ở mép |
| Overlay dịch người nói | Mọi beat `overlay` (và `keyword` đặt ở mép) phải có `side` (`left`/`right` = phía minh hoạ chiếm). `th:broll` sinh `project.videoShifts` đẩy người nói sang phía ngược lại (tâm ~70% hoặc ~30% chiều ngang) suốt overlay, ease 0.5 s, bắt đầu trước overlay 0.3 s; overlay liền nhau cùng phía gộp một lần dịch, khác phía thì chéo mượt. Xác định `side` bằng cách mở scene (nội dung thật nằm bên nào); nội dung ở giữa/hai bên thì dồn về một bên |
| Mọi phần tử xuất hiện đều có SFX | Mỗi layer chữ/callout/asset/lower third có SFX lúc vào (ở mọi mật độ); mỗi phần tử bật ra trong scene (mốc `inputs.delays` hoặc mặc định của template, loại theo `beats.json`: pop / stamp / scribble / slide) có SFX nhẹ, hai pop cách nhau ≥ 0.25 s. Zoom do camera auto không có SFX |

## Trường của beat

| Trường | Ý nghĩa |
|---|---|
| `id` | duy nhất, vd. `b01` |
| `start`/`end` | giây trên timeline đã cắt; hoặc `anchor: { phrase \| wordIndex, offset, dur }` neo theo từ trong `transcript.cut.json` |
| `kind` | `asset` `cutaway` `zoom` `pip` `kenburns` `keyword` `transition` |
| `assetId` | id trong manifest (kind asset) |
| `templateId`, `inputs` | scene-kit (cutaway, pip) |
| `text` | chữ của `keyword` (≤ 8 từ) |
| `position` | `auto` (mặc định) `left` `right` `top` `center` hoặc `{x,y,w,h}` (% canvas) |
| `tint`, `draw` | đổi màu asset đơn sắc; vẽ nét dần (`true` hoặc `{dur}`) |
| `scale` | zoom/kenburns, 1–2 (mặc định zoom 1.2, kenburns 1.12) |
| `transitionIn`/`transitionOut` | `{kind, dur, dir?}` đặt ở điểm vào/ra cutaway |
| `presetId`, `variantId`, `sfx`, `note` | ghi vào meta; `note` để người duyệt đọc |

Màu nhấn chỉ có vàng `#C5A059`; đỏ chỉ cho nghĩa "sai". Không dùng React/GSAP; chuyển động lấy từ preset có sẵn.

**Hai bảng "Luật cứng" và "Nguyên tắc chọn công cụ" ở trên là bản ban đầu 22/10; chỗ nào mâu thuẫn thì "Quy tắc cứng", "Cập nhật sau brainstorm" và phần "Khi người dùng tự reframe" ở dưới thắng.**

## Ví dụ 30 giây (khung 4:5, mặt ở giữa-trên; đã bỏ `asset` và `pip` 23/10/2026)

```json
{ "version": 1, "beats": [
  { "id": "b01", "start": 0.0, "end": 2.5, "kind": "keyword", "text": "Quy tắc 3 giây", "position": "top" },
  { "id": "b02", "anchor": { "phrase": "điện thoại", "dur": 3 }, "kind": "overlay", "templateId": "frame-tcvbh2-o2-unseen", "side": "left", "role": "supplement", "note": "danh từ cụ thể" },
  { "id": "b03", "start": 6.0, "end": 7.5, "kind": "zoom", "scale": 1.2, "note": "câu nhấn mạnh" },
  { "id": "b04", "start": 9.0, "end": 14.0, "kind": "cutaway", "templateId": "frame-tcvbh2-c1-deadzones",
    "transitionIn": { "kind": "flash", "dur": 0.3 }, "transitionOut": { "kind": "wipe", "dur": 0.4, "dir": "left" }, "note": "mở ý lớn 2" },
  { "id": "b05", "start": 17.0, "end": 20.0, "kind": "overlay", "templateId": "frame-tcvbh2-o3-rightcol", "side": "right", "role": "supplement", "note": "con số người nói đã nói" },
  { "id": "b06", "start": 20.5, "end": 29.0, "kind": "cutaway", "templateId": "frame-tcvbh2-c3-attention", "role": "replace", "note": "giải thích dài, minh hoạ thay lời nói" }
] }
```

Quy trình: viết plan → `npm run th:broll -- <job> --dry` (xem bảng và cảnh báo) → sửa plan cho hết cảnh báo → `npm run th:broll -- <job>` (ghi `project.json`, tự thêm SFX theo gói của project, mặc định `corporate`) → người dùng chỉnh trong editor.

## Cập nhật sau brainstorm (22/10/2026)

| Mục | Quy định |
|---|---|
| Không còn thư viện asset chung | minh hoạ vẽ riêng cho từng bài bằng scene-kit (set riêng của job, vd. `tcvbh2`). Beat `asset` (nếu dùng) ghi `src` là đường dẫn SVG trực tiếp |
| `kind: "cutaway"` | scene nền đặc phủ kín, người nói biến mất; bổ trợ 2–6 s, thay thế dài theo lời giảng tới ~18 s (đã thay 23/10/2026) |
| `kind: "overlay"` | scene nền trong suốt, luôn phủ toàn khung (x0 y0 w100 h100), template tự bố cục tránh mặt; nằm ở track "Minh hoạ" trên video; không giới hạn 2–6 s |
| `side` | overlay/keyword: `left`/`right`, phía minh hoạ chiếm (người nói dịch sang phía đối diện) |
| `role` | `replace` (minh hoạ thay lời nói) hoặc `supplement` (bổ sung); chỉ ghi meta và in ra bảng |
| `templateId` | bắt buộc với overlay/cutaway. `inputs.sceneDuration` tự điền = end − start |
| `cues` | `[{phrase\|wordIndex}]` → `inputs.delays` (giây tương đối so với start, theo từ của `transcript.cut.json`) để hình xuất hiện đúng lúc từ được nói |
| `camera` | `{ "auto": true, "minGap": 3, "maxGap": 6, "scaleRange": [1.0, 1.1], "punch": 1.2 }` — tự thêm zoom nhẹ xen kẽ ở ranh giới câu, không trong cutaway (±0.5 s), tâm theo mặt (`subject.json`). Beat `zoom` trong plan dùng `punch` và được ưu tiên |
| `pip` | KHÔNG dùng (đã thay 23/10/2026): người nói biến mất khi cutaway, không thu nhỏ |

## Khi người dùng tự reframe video gốc (bổ sung 23/10/2026)

Người dùng có thể tự phóng/kéo video trong editor: khung chung `project.videoTransform` và khung riêng từng clip `videoClips[].transform` (scale 0,2–4, được phóng nhỏ hơn 1 và kéo quá mép; phần trống tô ink `#0C0C0C`). Hệ quả cho AI/`th:broll`:

- **`subject.json` có trường `transform`** = khung lúc đo (`th:subject` dò trên cut.mp4 chưa reframe ghi `{scale:1,x:0,y:0}`; `--face` nhập tay ghi khung hiện tại của project). `th:broll` so khung đó với `project.videoTransform` hiện tại: nếu khác thì **tự quy đổi vùng mặt** (tâm' = 50 + x + scale·(tâm − 50 − x_đo)/scale_đo, kích thước nhân scale/scale_đo) và in dòng quy đổi; subject.json cũ không có `transform` thì giữ nguyên (không quy đổi).
- **Khung riêng của clip không được quy đổi**: mặt/zoom/dịch do AI tính theo khung CHUNG. `th:broll` in cảnh báo "N clip có khung riêng" — kiểm tra tay các beat nằm trong clip đó. Cách an toàn: người dùng bấm "Áp cho mọi clip" (ghi khung vào khung chung, xoá override) trước khi chạy lại `th:broll`.
- **Tắt máy quay tự động** (`project.camera.aiEnabled = false`, nút trên track "Máy quay"): preview và render bỏ qua mọi `videoMoves`/`videoShifts` có `source: "ai"`; dữ liệu vẫn nằm trong project, bật lại là có lại.
- **Chỉnh tay một move/shift do AI** (kéo, kéo mép, sửa trong inspector) → editor đổi `source` thành `"user"`, nên `th:broll` chạy lại sẽ KHÔNG xoá (chỉ dựng lại các phần `source: "ai"`).
- `videoMoves`/`videoShifts` tính TƯƠNG ĐỐI trên khung đang hiệu lực (khung riêng của clip nếu có, ngoài ra khung chung): zoom nhân scale, dịch cộng vào vị trí.

## Quy tắc cứng (người dùng đặt 22–23/10/2026)

Giống mục cùng tên trong `docs/CHE-DO-C-SPEC.md`; mâu thuẫn với bảng cũ ở trên thì mục này thắng.

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
