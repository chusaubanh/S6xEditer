# Quy chuẩn hình và hợp đồng câu–hình

> Chép nguyên văn từ `docs/tham-khao-repo-cu/SKILL.md` (dòng 160-317) ngày 31/10/2026. Hai repo độc lập; bản này là bản dùng cho Labs.
>
> **Labs khác ở:** khổ hình do người dùng chọn (16:9, 9:16, 4:5, 1:1), không cố định 1080×1350. Ngưỡng theo pixel của khổ cũ phải đo lại theo từng khổ. Công cụ dựng là Remotion, không phải scene-kit hay HyperFrames: bỏ qua mọi chỉ dẫn về `renderer: "hyperframes"`, `scripts/scene-kit/`, `motion.mjs`, và câu cấm GSAP, vì Labs dùng GSAP qua `useGsapTimeline()`. Giữ nguyên các nguyên tắc về hình, chữ và chuyển động. Xem thêm `NANG-CAP-NHAN-SU.md` mục 10.

## Script And Scene Rules

- Use `renderer: "hyperframes"` and one aspect for the whole series.
- **Video Persona**: Differentiate between short social media clips and **Long-form Technical Training Videos (Video Đào Tạo, 3-5 minutes)**. The pacing and the hook escalate differently; the scene language is bespoke either way.
- **Scenes are designed per video, never picked from a shelf.** Each video gets
  its own scene set in `scripts/scene-kit/sets/`, drawn for its narration.
  There is no shelf left to pick from, and no catalog to browse: every generic
  template was deleted (§0d) and `templates/CATALOG.md` went with it. The only
  machine-readable description of a scene is its own `slots.json`.
- **Sentence contract** (chốt 30/09/2026 — hình nhảy theo đúng câu nói):
  **one sentence = one `voiceSegments` entry = one visual beat.** A scene with more
  than one sentence must split it into `voiceSegments`, one sentence each (at most 8
  per scene; more sentences → another scene). The pipeline synthesizes each sentence
  separately and turns its measured start time into `inputs.delays`; the template's
  `beatTimes(N, …)` has N equal to the sentence count, and beat i changes the picture
  for sentence i at `t[i]`. A beat may bring in a new picture, or add to, animate or
  change the one already on screen — but it happens at the sentence's start, never
  on a guessed time. `script:validate` rejects a segment with two sentences, a
  multi-sentence scene without segments, and a template whose beat count differs
  from its sentence count.
- **Taste-Skill Anti-Slop Standard (`.agents/skills/design-taste-frontend/`)**:
  `DESIGN_VARIANCE: 8`, `MOTION_INTENSITY: 8`, `VISUAL_DENSITY: 4`.
- Written brand forms listed in the guideline's `narration.replacements` must be spoken as their full form (`Công ty Mẫu`) in every `voiceText`.

## Visual Design Standard

Approved by the user on 2026-09-24; **on-screen text rule tightened 30/09/2026**
(see rule 0). The reference for frame, scale and motion is
`scripts/scene-kit/sets/cdkh1.mjs` ("Chân dung khách hàng · Phần 1") — read it
before designing a new set, but do **not** copy its text density: its definition
paragraphs and sub-lines break rule 0.

### 0. Hình minh họa cho lời đọc — không chép chữ lên màn hình *(chốt 30/09/2026)*

Hình ảnh giờ làm việc giống lời đọc ở trên: **bám sát nội dung, thể hiện rõ, nhưng bằng
hình và chuyển động chứ không bằng chữ.** Lời đọc giải thích; màn hình cho người xem
*thấy* điều đang được nói.

- **Không hiện lại nguyên văn, không ghi đầy đủ lên màn hình.** Không chép câu lời đọc,
  không chép câu tài liệu, không có đoạn định nghĩa hay câu phụ đề dưới tiêu đề.
- **Chữ chỉ còn là từ khóa:** nhãn ngắn, con số, số thứ tự bước, tên riêng — mỗi khối
  **≤ 8 từ**, cả cảnh **≤ 25 từ** khi đã hiện hết (cảnh trên 3 câu được thêm 5 từ mỗi câu,
  vì mỗi câu mang một hình có nhãn riêng). `script:validate` báo lỗi khi một khối
  chữ quá 8 từ hoặc trùng từ 5 từ liên tiếp trở lên với lời đọc, và cảnh báo khi cả cảnh
  quá 25 từ.
- **Câu nói nào cũng có hình minh họa phù hợp trong khung đang hiện.** Không đếm máy móc
  "một đoạn lời một hình": một hình lớn có thể đứng suốt nhiều câu cùng ý, hoặc được thêm
  chi tiết, đổi trạng thái, nối thêm hình khi câu mới nói ý mới. Điều bắt buộc là lúc nào
  câu đang đọc cũng có trên màn hình một hình đúng ý với chính câu đó, và **hình nhảy
  đúng lúc câu nói bắt đầu** — không sớm hơn, không trễ hơn (Sentence contract ở
  "Script And Scene Rules"). Ghi `visual` dạng danh sách, mỗi câu một mô tả hình. Hình phải nói được ý kể cả khi tắt tiếng: người
  xem nhìn là hiểu đang nói về cái gì và quan hệ giữa các ý (nguyên nhân → kết quả,
  trước → sau, bước này → bước kia).
- **Bám nguồn như lời đọc:** chỉ vẽ thứ có trong tài liệu — không thêm số liệu, ví dụ,
  nhân vật hay ẩn dụ làm lệch nghĩa. Con số trên màn hình phải có trong tài liệu.
- **Ghi ý đồ hình vào `visual`** của mỗi cảnh trong `script.json` (thiếu thì
  `script:validate` cảnh báo): hình gì, chuyển động gì, cho đoạn lời nào. Cột này xuất
  hiện trong `script-review.md` để người duyệt đọc cùng lời đọc.
- **Hình theo loại nội dung** (cùng cách phân loại trong `analysis`):

  | Loại nội dung | Màn hình thể hiện |
  |---|---|
  | Khái niệm | Một hình ẩn dụ/hình mẫu của chính khái niệm (vd. đám đông → một người được khoanh ra), tên khái niệm làm nhãn |
  | Nguyên tắc | Biểu tượng cho từng nguyên tắc lần lượt bật sáng; nhãn 2–4 từ |
  | Quy trình | Đường đi có số bước; icon từng bước hiện và nối dây theo đúng bước đang đọc |
  | Danh sách | Icon/hình từng ý xuất hiện lần lượt, ý đang đọc sáng lên |
  | Phân loại | Các nhóm tách thành cột/khung, vật thể rơi vào đúng nhóm |
  | So sánh | Khung chia đôi, hai bên đối xứng; điểm khác biệt đổi màu/nhấp nháy |
  | Hướng dẫn | Mô phỏng thao tác (màn hình, con trỏ bấm, tay làm) theo từng bước |
  | Điều kiện / Lưu ý | Biển báo, con dấu, ngã rẽ đúng/sai |
  | Ví dụ / Tình huống | Vẽ chính tình huống trong tài liệu: nhân vật, bối cảnh, việc xảy ra |
  | Số liệu | Số lớn đếm lên, thanh mọc, biểu đồ vẽ dần — chỉ số có trong nguồn |
  | Kết luận / Điểm cần nhớ | Các icon của cả video gom về một khung, từng cái sáng lại |

The earlier dark-card style was rejected: every scene was a dark canvas, a
top-left headline and rounded translucent cards, and varying only how the cards
were arranged made every scene read as the same slide on a phone. What makes a
viewer register "new scene" is the frame, the scale, the picture and the
motion — so those are what must vary.

### 0b. Hình phải rõ — soát độ rõ, không chỉ soát đúng nhịp *(chốt 01/10/2026)*

Hai video OKRs đầu tiên đúng nhịp từng câu nhưng bị trả về vì **nhìn không rõ**. Soát
khớp theo câu chỉ trả lời "hình có lên đúng lúc không"; mục này trả lời "người xem có
hiểu hình không". Mọi cảnh phải qua đủ các điểm sau trước khi render:

1. **Lấp đầy khung.** Ở trạng thái cuối, nội dung phủ ≥ 62% chiều cao vùng dùng được và
   không có dải trống nào cao hơn 260 px. Đo bằng
   `python scripts/scene-kit/audit_frame.py <ảnh cuối cảnh>`. Cảnh ít nội dung thì phóng to
   hình, không để nửa khung trống.
2. **Chữ đọc được trên điện thoại.** Nhãn ≥ 28 px (canvas 1080), nhãn chính ≥ 34 px.
   `build.mjs` in cảnh báo `! chữ nhỏ hơn 28px` — không được còn cảnh báo.
3. **Biểu tượng nào cũng có nghĩa ngay.** Hình ẩn dụ (tên lửa, bóng đèn, ống nghiệm, bệ
   phóng, cán cân…) phải kèm nhãn 1–3 từ nói nó là gì. Không để biểu tượng đứng một mình
   mà người xem phải đoán.
4. **Tương phản.** Không vẽ mực trên nền mực, vàng trên nền vàng. Kiểm từng biểu tượng
   trên đúng màu nền của cảnh (lỗi đã gặp: cọc mốc đen trên nền đen chỉ còn đĩa tròn lơ
   lửng; kính lúp, bánh răng biến mất).
5. **Trạng thái đúng nghĩa.** Dấu tích, thanh đầy, "100%" chỉ hiện khi lời đọc nói việc
   đó đã xong/đạt. Cột mốc chưa tới thì là cột mốc trống, không phải dấu tích.
6. **Không bóng mờ chồng lớp.** Nội dung của câu trước hoặc ở nguyên chỗ và vẫn rõ, hoặc
   biến mất hẳn (hay thu nhỏ về một góc). Không làm mờ rồi vẽ nội dung mới đè lên.
7. **Không nét thừa.** Đường nối phải đi từ một vật tới một vật; không có đường chéo cắt
   ngang hình, "tia" trang trí trông như vết xước.
8. **Hình gắn liền nhau.** Phần của cùng một vật (tên lửa và lửa đẩy, cọc và biển) phải
   dính nhau; hàng thẻ phải cân giữa khung, không lệch sát mép.
9. **Nhìn ảnh cỡ thật.** Người vẽ và QA mở ảnh cuối cảnh ở 1080×1350 (không phải ảnh
   ghép thu nhỏ) và tự hỏi: tắt tiếng, người mới xem có nói được cảnh này đang nói gì không?
10. **Đọc được ở 360 px (chốt 15/10/2026).** Chữ 28 px ở khung 1080 chỉ còn ~9 px trên điện thoại. `scene:qa` xuất `phone-sheet.png` — mọi cảnh ở 360 px trong một ảnh; người soi phải đọc được nhãn chính trên ảnh đó, nếu không thì phóng nhãn hoặc bớt chữ. Máy không đo được "đọc được", nên đây là mắt người.

### 0c. Taste rules cho khung hình video *(từ taste-skill, chọn lọc 01/10/2026)*

`.agents/skills/design-taste-frontend/` (taste-skill của Leonxlnx, đã cài, bản mới nhất) viết cho
trang web. Người vẽ cảnh đọc mục 4.2, 4.4, 4.7, 4.9 và 9 của nó; các điểm dưới đây là phần áp
được cho khung hình 1080×1350 và là bắt buộc:

1. **Một hệ bo góc cho cả video** (shape consistency lock): thẻ lớn 28–34 px, chip/nhãn bo tròn
   hẳn, ô nhỏ 16–20 px. Không trộn góc vuông với góc tròn tuỳ hứng.
2. **Khoá màu nhấn** (color consistency lock): chỉ vàng thương hiệu làm màu nhấn. Màu thứ hai
   (đỏ san hô) chỉ dùng cho đúng một nghĩa trong cả video — "sai / chưa đạt" — không dùng trang trí.
3. **Không lặp một kiểu bố cục quá hai cảnh liền nhau** (section-layout-repetition ban): lưới thẻ,
   hàng ngang, chia đôi, một hình khổng lồ… phải xen kẽ. Tránh mặc định "ba thẻ bằng nhau xếp hàng".
4. **Thẻ chỉ dùng khi cần nhóm nội dung.** Không bọc mọi thứ trong thẻ; để hình lớn đứng thẳng
   trên nền khi nó là nhân vật chính.
5. **Bóng đổ nhuốm màu nền**, không dùng bóng đen thuần trên nền sáng; không viền phát sáng neon.
6. **Khoảng cách đều và có chủ ý:** lề 60 px, khoảng giữa các khối theo bội số 20 px; không có
   phần tử lơ lửng với khe hở lẻ.
7. **Phân cấp bằng độ đậm và màu trước, cỡ chữ sau:** mỗi cảnh một điểm nhấn lớn nhất, các nhãn
   cùng cấp cùng cỡ.
8. **Không số liệu "trông cho chuyên nghiệp"** (fake-precise numbers): con số trên hình phải có
   trong tài liệu; cột, thanh minh hoạ thì để trống nhãn.
9. **Tự soát chữ trước khi giao** (copy self-audit): đọc lại mọi nhãn trên khung; nhãn nào tối
   nghĩa, cụt, hay "nghe cho hay" thì viết lại cho rõ.

**Chuyển động** (taste-skill §5–§7, high-end-visual-design §5–§6) — video của ta là trang web
được chụp từng khung, nên áp trực tiếp. Đã đóng gói thành bộ chuyển động dùng chung
`scripts/scene-kit/motion.mjs` (`${MOTION}`: `enter`, `leave`, `stagger`, `spread`, `draw`, `grow`,
`wipe`, `travel`, `turn`, `idle`, `at`); cảnh mới dùng bộ này, không tự viết hàm riêng:

10. **Chuyển động phải có lý do:** thể hiện thứ tự, nguyên nhân → kết quả, đổi trạng thái, hoặc
    chỉ chỗ cần nhìn. Không trả lời được "nó nói lên điều gì" thì bỏ.
11. **Có khối lượng, có đàn hồi:** easing lấy từ `EASE` (`out`, `heavy`, `spring`, `inOut`, `slam`),
    thời lượng lấy từ `DUR`; cấm `linear`, `ease-in-out` và thời lượng tự đặt.
12. **Chỉ animate `transform`, `opacity`** (thêm `clip-path`, `stroke-dashoffset`, blur ngắn lúc
    vào); không animate `top/left/width/height`.
13. **Tối đa ba thứ vào cùng lúc**, còn lại so le 0,14 giây.
14. **Mỗi cảnh tối đa một chuyển động lặp** (trôi nhẹ); hình thông tin thì đứng yên.
15. **Một phần tử một animation** — bộ chuyển động tự hiện băng đỏ "LỖI: … có 2 animation" lên
    khung hình nếu vi phạm.
16. **Kiểu chuyển động theo loại nội dung:** quy trình thì *đi* từ bước này sang bước kia
    (`travel`, `draw`); so sánh thì *quét* vào từ hai phía (`wipe`); số liệu thì *mọc* (`grow`);
    kết luận/đánh giá thì *đóng dấu* (`stamp`); hình chính vào *nặng, mềm* (`soft`); nhãn nhỏ *bật* (`pop`).

Phần của taste-skill **không áp** ở đây: đổi phông, đổi bảng màu sang hệ khác (bảng màu S6X là
cố định), thư viện icon/React/Tailwind/GSAP/Framer Motion (trình dựng cần keyframe CSS tua được),
hiệu ứng theo cuộn trang và di chuột, dark mode, `prefers-reduced-motion`, và lệnh cấm SVG tự vẽ (kho minh
hoạ `illus.mjs` là SVG phẳng theo nhận diện thương hiệu).


## Brand And Typography

Use `assets/brand/logo.png` and the palette in
`assets/brand/brand-guideline.json`. Primary display accents are `#C5A059` and `#E0C286`;
the main canvas is `#0C0C0C`.

All rendered videos must feature the faint brand watermark (`assets/brand/watermark.png`) in the top-right corner (`top: 44px, right: 44px`, `width: 84px`, `opacity: 0.40`). The pipeline applies this automatically during final audio-video muxing (`muxAudioOntoVideo`).

Apply these Vietnamese typography safeguards:

1. Normalize dynamic text with `normalize("NFC")`.
2. Use solid text colors.
3. Never use `background-clip: text`, transparent text fill, or transparent display text.
   Chromium clips stacked Vietnamese marks with this technique.
4. Wait for `document.fonts.ready` before measuring.
5. Use safe vertical padding and a line height that contains stacked marks.
6. Prevent browser-selected hero wrapping. Balance at most two lines, then fit
   deterministically after fonts load.
7. Keep large Vietnamese display text at zero letter spacing.

Run `src/render/typography-safety.test.ts` after template edits.

