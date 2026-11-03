# Quy trình làm video hướng dẫn: quay màn hình + cảnh minh hoạ → Premiere

Ngày viết: 30/10/2026. Video mẫu chạy thật: **Hướng dẫn sử dụng phần mềm** (16:9, 6:19).

Tài liệu dành cho người làm video vận hành pipeline cùng Claude Code. Có hai loại bước:

- **✋ NGƯỜI DUYỆT**: người làm video phải xem và chốt.
- **⚙ LỆNH**: chạy lệnh. Các lệnh đều chạy ở thư mục gốc repo `repo cũ`.

Trong tài liệu:

- `<Tài liệu>` là tên thư mục của video. Ví dụ: `Hướng dẫn sử dụng phần mềm`.
- `D` là viết tắt của `output/<Tài liệu>`.

---

## 0. Kết quả cuối cùng

| Thứ | Ở đâu | Dùng để |
|---|---|---|
| Sequence Premiere | project `.prproj` (đặt **ngoài** `input/`) | Dựng tiếp, xuất video cuối |
| Gói Premiere | `D/premiere/` gồm `timeline.xml`, `media/`, `timeline-phu-de.srt` | Nhập vào Premiere |
| Bản xem trước | `D/premiere/timeline-xem-truoc.mp4` (960×540) | Soát nhanh, không phải bản giao |

Video có hai loại đoạn đan xen:

- **Quay màn hình** (`m01…m20`): clip người dùng tự quay, có thuyết minh TTS và phụ đề. Thao tác tay chạy đúng tốc độ thật.
- **Cảnh minh hoạ scene-kit** (`s01…s16`): dùng cho mở đầu, kết, và các bước mà clip không quay được.

---

## 1. Chuẩn bị đầu vào

1. Bỏ các clip quay màn hình vào `input/<Tài liệu>/`, đặt tên `1.mp4`, `2.mp4`, `3.mp4`… theo đúng thứ tự thao tác.
2. Bỏ tài liệu nguồn vào cùng thư mục (HTML, MD…).
3. **✋ Chốt thứ tự ưu tiên nguồn khi các nguồn mâu thuẫn.** Video mẫu dùng thứ tự: *Giới thiệu* (thông tin thực tế) → *Bản đồ vận hành* (chi tiết thao tác) → màn hình (mô tả thao tác đang diễn ra).
4. **Không bao giờ sửa file trong `input/`.** Project Premiere cũng không được lưu trong `input/`.

## 2. Chốt định dạng với người duyệt (✋ bắt buộc trước khi làm)

| Mục | Video mẫu |
|---|---|
| Khung hình | 16:9 |
| Giọng · tone · tốc độ | Hải Đăng · tự nhiên · 1.1 |
| Thời lượng | Video hướng dẫn **không giới hạn 3 phút**. Ưu tiên hướng dẫn kỹ từng thao tác. |
| Làm mờ thông tin trên màn hình | Không |
| Bước không quay | Chèn cảnh minh hoạ scene-kit đúng chỗ trong dòng thời gian |

## 3. Đọc clip và ghi chú thao tác

1. **⚙ Làm ảnh dò mỗi 2 giây một khung** cho từng clip:

   ```bash
   ffmpeg -i "input/<Tài liệu>/1.mp4" -vf "fps=0.5,scale=640:360,tile=3x3" c1-%02d.jpg
   ```

   Mỗi tấm 9 khung tương ứng 18 giây. Khung thứ k của tấm n nằm ở giây `18(n−1) + 2k`.

2. Ghi lại từng thao tác theo giây vào `D/nguon-tong-hop.md`: bấm gì, gõ gì, hộp nào hiện ra. File này đồng thời là nguồn cho `script:validate`.
3. Chép chữ từ các tài liệu HTML vào cùng file `D/nguon-tong-hop.md`.
4. Đánh dấu các chỗ **không nên đưa vào video**, ví dụ khung logo chen vào giữa clip. Video mẫu có khung "Sáu Bánh" ở clip 2, giây 48,4–49,0.

## 4. Viết bản nháp lời đọc (✋ duyệt)

File: `D/ban-nhap-loi-doc.md`. Mỗi đoạn ghi rõ loại:

- **[SC] Đoạn quay màn hình**: mã `m01…`, clip, giây vào/ra, lời đọc, nhãn góc, nguồn.
- **[SK] Cảnh minh hoạ**: chèn đúng chỗ clip không quay. Mỗi câu là một nhịp hình.

Quy tắc viết:

- **Thao tác phải tả cụ thể:** bấm vào đâu, chọn gì, gõ gì, nhìn chỗ nào trên màn hình. Gặp đoạn chờ thì dùng thời gian đó giải thích trợ lý đang làm gì.
- **Ước độ dài lời đọc:** giọng Hải Đăng ở tốc độ 1.1 đọc khoảng **19–22 ký tự/giây**. Một đoạn hình L giây chứa được khoảng `(L − 0,8) × 20` ký tự. Viết dài hơn mức này thì hình phải đứng (giữ khung cuối) để chờ lời.
- **Tên tiếng Anh khó đọc:** để nguyên trong phụ đề, chỉ đổi cách đọc bằng trường `spoken`. Ví dụ: INDEX → "in-đếch", PDF → "pi đi ép", Red-Team → "rét tim".
- **Các nguồn mâu thuẫn:** theo nguồn ưu tiên đã chốt ở bước 1. Video mẫu không đọc các con số chưa kiểm chứng, không nêu tên người duyệt, không đọc đường dẫn nội bộ.
- **Bỏ câu thừa:** câu nào người duyệt thấy không cần (ví dụ "chưa có gói trả phí") thì bỏ ngay từ bước này. Sửa sau khi đã dựng tốn hơn nhiều (xem bước 14).

## 5. Dựng bộ cảnh minh hoạ scene-kit

1. Viết bộ cảnh riêng cho video ở `scripts/scene-kit/sets/<set>.mjs`. Bộ mẫu là `phapche1.mjs`.
   - Không dùng template có sẵn.
   - Chữ trên hình tối thiểu 28 px. Cả cảnh **không quá 25 từ** (`rules_lint` đếm cả dấu "·" và số).
   - Không chép nguyên 5 từ liền nhau từ lời đọc lên hình.
2. **⚙** Dựng cảnh:

   ```bash
   node scripts/scene-kit/build.mjs
   ```

3. **⚙** Xem trước từng cảnh và soát bằng mắt ảnh cuối cảnh. Sửa bố cục cho tới khi không còn chữ đè, chữ tràn.

   ```bash
   npx tsx scripts/scene-kit/preview.ts "frame-<set>-<cảnh>" 9 "0,0,0" "<thư mục ảnh>"
   ```

## 6. Viết `script.json` cho phần cảnh minh hoạ

1. Mỗi cảnh gồm `id`, `templateId`, lời đọc và `voiceSegments` (mỗi câu một nhịp). `visual` chép từ `templates/<id>/beats.json`.
2. **Thêm `"sfx": { "name": "none" }` cho mọi cảnh.** Nếu thiếu, pipeline tự trộn tiếng whoosh và pop vào chung file giọng, sau này không gỡ ra được. SFX sẽ đặt riêng ở bước 11.
3. Viết `D/plan.json` (phân tích + `lengthDecision`). `rules_lint` bắt buộc phải có file này.
4. **⚙** Kiểm kịch bản. Kết quả phải là 0 lỗi; cảnh báo "vượt 3 phút" là bình thường với video hướng dẫn.

   ```bash
   npm run script:validate -- "D/script.json"
   ```

> Video mẫu tạo `script.json` bằng một script sinh tạm (`mkscript.mjs`, đọc bảng lời đọc và `beats.json`). Script này chưa có trong repo.

## 7. Viết `screencast.json` cho phần quay màn hình

Các trường chính:

- `segments`: mỗi đoạn gồm `id`, `clip`, `in`, `out`, `text`, và tuỳ chọn `spoken`, `callout`, `maxSpeed`.
- `sequence`: thứ tự đan xen, ví dụ `[{sk:[s01…s04]}, {sc:[m01…m08]}, {sk:[s06]}, …]`.

Quy tắc:

- **`maxSpeed`:** thao tác tay để 1–1,2. Đoạn chờ trợ lý chạy để tối đa **1,5**: tua nhanh hơn mức này người xem sẽ mất mạch, và lời đọc giải thích lúc chờ cũng không còn chỗ.
- **Mốc `in` / `out`:** đặt đúng chỗ đổi thao tác, tránh khung logo. Nên tách đoạn dài thành nhiều đoạn nhỏ để câu nào khớp hình của câu đó.
- **Thứ tự cảnh:** các cảnh trong `sequence` phải đúng **y hệt thứ tự trong `script.json`**. Sai thứ tự thì bước ghép sẽ cắt nhầm cảnh mà không báo lỗi.

## 8. Tạo giọng và nghe thử (✋ cổng giọng)

1. **⚙** Tạo giọng cho phần cảnh minh hoạ. Kết quả ra `D/voice-preview.mp3` và `timeline.json`.

   ```bash
   npm run pipeline:voice -- "D/script.json"
   ```

2. **⚙** Tạo giọng cho phần quay màn hình. Lệnh in bảng từng đoạn kèm "giữ khung cuối X s".

   ```bash
   npx tsx scripts/screencast/screencast-mix.ts "D/screencast.json" --voice-preview
   ```

3. Đọc bảng vừa in:
   - Đoạn thao tác tay mà giữ khung trên 1,5 s: rút lời, hoặc dời mốc `in`/`out`.
   - Giữ khung trên một màn tin nhắn tĩnh thì chấp nhận được.
4. **✋ Người duyệt nghe hai file thử.** Chú ý các tên tiếng Anh và các chữ đã đổi cách đọc. Duyệt xong mới chạy bước 9.

## 9. Render

1. **⚙** Duyệt kịch bản và render cảnh minh hoạ. `--preview waived` chỉ dùng khi người duyệt nói rõ là bỏ qua bước nghe thử.

   ```bash
   npm run approve -- "D/script.json" --confirmed-by "<tên người duyệt>" --preview confirmed
   npm run pipeline -- "D/script.json"
   npm run sync:check -- "D/script.json"
   npm run video:qa -- "D"
   ```

   Mở `D/sync-check.md` soát từng câu. `video:qa` có thể báo "băng đỏ" ở chỗ cảnh cố ý vẽ khối màu đỏ; mở ảnh xem tận mắt rồi mới kết luận.

2. **⚙** Render phần quay màn hình:

   ```bash
   npx tsx scripts/screencast/screencast-mix.ts "D/screencast.json" --render all --stills
   npx tsx scripts/screencast/screencast-mix.ts "D/screencast.json" --render all --clean
   npx tsx scripts/screencast/screencast-mix.ts "D/screencast.json" --concat
   npx tsx scripts/screencast/screencast-mix.ts "D/screencast.json" --concat --clean
   ```

   - `--render all --stills`: render có in phụ đề, kèm ảnh giữa và cuối mỗi đoạn trong `D/stills/` để soát.
   - `--render all --clean`: bản không in phụ đề và nhãn góc, dùng làm nền cho editor và Premiere.
   - `--concat`: bản in cứng, chỉ để tham khảo hình.
   - `--concat --clean`: bản sạch, ghép đều 30 khung/giây. Lệnh này ghi thêm `editor-overlays.json`.

## 10. (Tuỳ chọn) Chỉnh trong editor S6X

1. **⚙** Tạo job editor và mở editor:

   ```bash
   npx tsx scripts/screencast/screencast-editor-job.ts "D/screencast.json"
   npm run th:proxy -- "<Tài liệu>/editor"
   npm run th:clips-build -- "<Tài liệu>/editor"
   npm run editor -- "<Tài liệu>/editor"
   ```

2. **✋** Trong editor, người làm cắt và ghép các đoạn (đã chia sẵn theo từng đoạn), sửa phụ đề và nhãn góc, thêm nhạc.
3. **Chỉ một người hoặc một máy ghi vào job tại một thời điểm.** Lệnh tạo job từ chối dựng lại job đã có chỉnh sửa (`revision > 0`).

## 11. Nhạc và SFX (các quy tắc đã chốt với người duyệt)

| Loại | Quy tắc |
|---|---|
| Nhạc nền | Một bài, nhóm doanh nghiệp, nhịp nhẹ (video mẫu dùng *Coordination*). Lặp cho đủ video, −18 dB, fade vào 2 s, fade ra 4 s, tự hạ −14 dB khi có lời đọc. |
| Phần tử cảnh minh hoạ bật ra | **Chỉ tiếng pop nhẹ**: `pop`, `pop-bubble`, `tap`, khoảng −20 dB. Xoay vòng file, không lặp liền nhau. Hai tiếng cách nhau ≥ 1 s, cụm phần tử bật cùng lúc chỉ một tiếng. |
| Nhãn góc bật ra | Tiếng pop nhẹ |
| Click chuột | `click-ui` khoảng −7,5 dB, đặt **đúng lúc click thật**, dò theo vòng gợn xanh tím của con trỏ trên clip. Rê chuột không có tiếng. |
| Không dùng | ding, chime, whoosh, swoosh, sweep chuyển cảnh |

Cách làm thực tế ở video mẫu (các script tạm, chưa có lệnh chính thức trong repo):

- **Tiếng pop cảnh minh hoạ:** chạy kịch bản chuyển động của từng cảnh với hàm giả để lấy giờ bật ra của từng phần tử, đặt tiếng theo kiểu chuyển động, rồi lọc cho thưa.
- **Tiếng click:** dò vòng gợn trên từng khung với điều kiện là cụm nhỏ, gần tròn, tâm rỗng. **Phải soát bằng mắt từng điểm**, vì video mẫu dò ra 44 điểm mà có 7 điểm nhầm. Cú click nào không có vòng gợn (lúc màn hình đang thu phóng) thì đặt theo khung giao diện đổi đột ngột ngay sau thao tác.

## 12. Đóng gói và nhập vào Premiere

1. **✋** Tạo project Premiere **ngoài `input/`**. Video mẫu dùng ổ Z.
2. Mở project đó, bật panel **Script Rough Cut Bridge**.
3. **⚙** Đóng gói và nhập:

   ```bash
   npx tsx scripts/screencast/premiere-package.ts "D/screencast.json" --job editor --preview \
     --seq-name "<Tên video> · bản …" --import "<đường dẫn .prproj>"
   ```

Lệnh tự làm các việc sau:

- Dựng video sạch đều 30 khung/giây và dò vị trí từng phần cảnh minh hoạ theo điểm cắt cứng.
- Đặt các track:

  | Track | Nội dung |
  |---|---|
  | V1 | 15 clip cảnh minh hoạ (mỗi cảnh một file riêng, để thay được) và các khối quay màn hình |
  | V2 | Nhãn góc dạng PNG, chụp từ chính editor, luôn tắt trước cảnh kế tiếp |
  | A1 | Nguyên từng file giọng TTS gốc, căn vị trí theo âm thanh (sai lệch ≤ nửa khung), có bộ giới hạn đỉnh |
  | A2 | Nhạc đã hạ sẵn ở những chỗ có lời |
  | A3+ | SFX |

- Đặt tên file trong `media/` theo băm nội dung: nội dung đổi thì ra tên mới, không đè file Premiere đang khoá.
- **Tự kiểm khớp hình từng khung, lệch là dừng.**
- `--preview`: dựng bản xem trước đúng theo XML và in mức âm lượng (đích −16 LUFS, đỉnh dưới −1,5 dBTP).

Nếu lệnh báo "Panel cầu nối trong Premiere đang tắt", mở lại project, bật panel rồi chạy lại.

**✋ Từ đây Premiere là bản chuẩn.** Mỗi lần nhập là một sequence mới, nên những gì đã chỉnh tay trên sequence cũ sẽ không mang sang. Chỉ nhập lại khi người làm chưa chỉnh tay, hoặc đã ghi lại những gì cần làm lại.

## 13. Soát trước khi giao (checklist)

- [ ] Tự kiểm hình: đạt N/N khung (lệnh tự in ra).
- [ ] Xem trước: khoảng −16 LUFS, đỉnh dưới −1,5 dBTP. Khi xuất từ Premiere, bật Loudness Normalization −16 LUFS.
- [ ] Ảnh khớp câu `sync-check.md`: đủ số câu, mỗi câu hiện đúng hình của câu đó.
- [ ] Bảng ảnh tại từng tiếng click: con trỏ đang ở đúng nút đang bấm.
- [ ] Các điểm nối giữa cảnh minh hoạ và quay màn hình: không có nhãn góc dính sang cảnh, khung đầu cảnh sạch.
- [ ] Các chỗ người làm cắt giọng: liệt kê chỗ nào lẹm vào lời để người làm kéo mép clip ra.

## 14. Sửa sau khi đã vào Premiere

| Việc | Cách làm |
|---|---|
| Sửa hình một cảnh, lời giữ nguyên | Render lại cảnh. Trong Premiere: chuột phải clip → **Replace Footage**. Độ dài không đổi nên không phải kéo lại gì. |
| Sửa lời một cảnh (video mẫu: bỏ câu "chưa có gói trả phí" ở s14) | Theo 5 bước bên dưới bảng. |
| Đổi SFX | Sửa lớp SFX trong project của job, đóng gói lại. Không sửa tay trên sequence cũ. |

Các bước sửa lời một cảnh:

1. Sửa lời trong `script.json`, rồi `pipeline:voice` → `approve` → `pipeline`.
2. `--concat --clean` để ghép lại video sạch.
3. Dời các lớp nằm sau cảnh đó. Cảnh ngắn đi bao nhiêu thì dời bấy nhiêu; riêng tiếng pop **trong chính cảnh đó phải tính lại** theo nhịp mới, vì các phần tử bật ra theo tỷ lệ độ dài câu.
4. `th:clips-build`, rồi đóng gói lại.
5. Nếu Premiere đang khoá file cảnh, đóng project trước rồi mới render.

## 15. Lỗi đã gặp ở video mẫu và cách tránh

| Lỗi | Nguyên nhân | Đã xử lý / cách tránh |
|---|---|---|
| Ghi đè chỉnh sửa của người dùng trong editor | Chạy lại lệnh tạo job lúc người dùng đang chỉnh | Lệnh từ chối job có `revision > 0`. Trước khi ghi, hỏi người dùng dừng chỉnh. |
| Lệch 1–3 khung giữa Premiere và editor | Bản ghép thiếu mốc thời gian ở vài khung; đếm khung theo thứ tự ≠ đọc theo thời gian | `--concat` giờ xuất đều 30 khung/giây; lệnh đóng gói tự dựng bản đều 30 khung/giây và tự kiểm |
| Clip 1 khung ở ranh giới làm lệch phần sau | Mốc cắt của editor lệch ranh giới đoạn 1 khung | Gộp clip liền nhau cùng file; phần này có bài kiểm tra `premiere-timeline.check.ts` |
| Vẫn nghe whoosh dù đã bỏ SFX | Pipeline scene-kit tự trộn whoosh và pop vào giọng | `"sfx": {"name":"none"}` cho mọi cảnh |
| Giọng khựng, lẹm lời ở chỗ nối | Cắt giọng ra từ bản đã ghép | Đặt nguyên từng file TTS gốc, căn vị trí theo âm thanh |
| Giọng vỡ tiếng (đỉnh +0,2 dBTP) | Premiere không có bộ giới hạn đỉnh như bộ trộn editor | Nướng gain và bộ giới hạn đỉnh vào bản sao file giọng |
| Nhãn góc dính sang cảnh minh hoạ | Đoạn quay màn hình bị cắt bớt cuối, nhãn vẫn mang độ dài gốc | Nhãn luôn tắt trước cảnh kế tiếp 6 khung |
| Không ghi được file mới | Premiere đang khoá file | Tên file theo băm nội dung; render lại cảnh thì đóng project trước |
| Không nhập được XML | Cầu nối chỉ nhận XML trong thư mục `outputs` của nó và không nhận dòng `<!DOCTYPE>` | `--import` tự chép XML vào đó; XML không có DOCTYPE |
| Dò vị trí cảnh sai 1 khung | Hình scene-kit đứng yên, lệch 1–2 khung vẫn trông giống hệt | Dò bằng 3 khung đầu, ngay điểm cắt cứng |

## 16. Việc còn để ngỏ (đưa vào repo khi làm video sau)

- Đưa vào repo thành lệnh chính thức ba việc đang làm bằng script tạm: sinh `script.json` từ bảng lời đọc, dò click theo vòng gợn, đặt tiếng pop cho cảnh minh hoạ.
- Thêm hiệu ứng bật vào (fade ngắn) cho nhãn góc trong Premiere. Hiện nhãn là ảnh tĩnh.
