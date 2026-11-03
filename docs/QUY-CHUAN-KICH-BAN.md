# Quy chuẩn kịch bản học liệu

> Chép nguyên văn từ `docs/tham-khao-repo-cu/SKILL.md` (Chế độ A, dòng 432-551) ngày 31/10/2026. Hai repo độc lập; bản này là bản dùng cho Labs. Lệnh và đường dẫn trong bài là của repo cũ; Labs chưa có lệnh nào thì coi là việc còn phải làm.

### Chế độ A — Học liệu đào tạo (mọi thư mục trong `input/` ngoài `Bài viết về AI/`)

Chị Duyên chốt ngày 30/09/2026, thay quy tắc "giữ nguyên văn từng câu" của ngày 28/09.
Việc không phải tóm tắt tài liệu thành lời đọc, mà là: **phân tích nội dung → xác định ưu
tiên → thiết kế cấu trúc nhận thức → chọn cách diễn đạt → viết lời đọc dễ tiếp thu khi người
học vừa nghe vừa nhìn.** Thứ tự ưu tiên: trung thành với nguồn → hiểu đúng → đủ cụ thể để áp
dụng → dễ tiếp thu với người trưởng thành → tối ưu thời lượng.

#### 1. Nguồn nội dung — nguyên tắc quan trọng nhất

- **Chỉ dùng thông tin có trong tài liệu.** Không thêm kiến thức ngoài (dù đúng), không suy
  đoán, không tự tạo ví dụ, tình huống, số liệu, giải thích hay lợi ích; không đổi nghĩa.
- **Được đổi cách diễn đạt:** rút gọn câu, sắp xếp lại thứ tự, chuyển văn viết thành văn
  nói, gộp ý trùng, lược chi tiết ít quan trọng, nói dễ nghe hơn — miễn giữ nguyên nghĩa.
- **Đổi cách nói, không đổi nghĩa.** Bài học 28/09 vẫn giữ: gốc *"khi kết quả không như mong
  đợi khi làm việc với người khác"* bị đổi thành *"khi thất bại"* là **sai nghĩa** ("không như
  mong đợi" gồm cả trễ tiến độ, không đúng kỳ vọng). Thuật ngữ chuyên môn và từ người biên
  soạn đã chọn kỹ thì giữ nguyên; chỉ đơn giản hoá phần diễn đạt quanh nó.
- **Ưu tiên khi chọn lọc:** mục lớn → ý chính → mục nhỏ → chi tiết → ví dụ. Không giữ chi
  tiết nhỏ mà bỏ mất ý chính của một mục lớn.
- **Tóm tắt không phải lược quá mức.** Nếu rút gọn làm nội dung chung chung, thiếu giải
  thích, mất quy trình, mất điều kiện áp dụng, mất ví dụ thực tế hoặc người học khó hình
  dung cách áp dụng → **dừng rút gọn, đi qua cổng thời lượng** (mục 3).

#### 2. Phân tích trước khi viết (`plan.json` → `analysis`)

- Đọc toàn bộ tài liệu. Chia thành nhóm nội dung và gán loại (`contentType`) theo bản chất
  thực tế: `khai-niem`, `nguyen-tac`, `quy-trinh`, `danh-sach`, `phan-loai`, `so-sanh`,
  `huong-dan`, `dieu-kien`, `luu-y`, `vi-du`, `so-lieu`, `tinh-huong`, `ket-luan`.
  `outline.json → contentHints` chỉ là gợi ý; người viết tự quyết.
- Với mỗi nhóm (`contentGroups[]`): người học cần hiểu gì; ý bắt buộc giữ (`mustKeep`); ý
  lược được (`canDrop`); ví dụ phải giữ để dễ hình dung (`examples`); chi tiết nào cần giải
  thích, phần nào để hình/chữ trên màn hình gánh, phần nào lời đọc gánh (`delivery`).
- Ghi logic tiếp nhận (`learningLogic`: cấu trúc chọn, thứ tự, lý do) và nguyên lý áp dụng
  (`principles`).
- **Mỗi loại nội dung một cách trình bày:**
  - Khái niệm → nêu bản chất → giải thích ngắn → ví dụ nếu tài liệu có.
  - Quy trình → giới thiệu toàn quy trình → nói số bước → lần lượt từng bước.
  - Danh sách → khái quát nhóm → lần lượt các ý quan trọng.
  - So sánh → tiêu chí/điểm khác biệt chính → rồi mới đến từng bên.
  - Ví dụ → đặt ngay sau khái niệm/nguyên tắc mà nó minh họa.
  - Hướng dẫn → mục tiêu/kết quả cần đạt → cách làm → lưu ý nếu tài liệu có.
  - Số liệu → chỉ đọc số cần để hiểu; số đã hiện trên màn hình thì không cần đọc lại.

#### 3. Cổng thời lượng — 3 phút hay tách video

- Mục tiêu **khoảng 3 phút, dao động 10–15 giây** (`targetDurationSec` ≤ 195). Không hy sinh
  độ đầy đủ và khả năng hiểu để ép vào 3 phút.
- Trước khi viết, tự hỏi: gói vào 3 phút thì người học có hiểu ý chính, hiểu cách áp dụng,
  đủ giải thích, còn ví dụ quan trọng, không bị quá tải, không thành bản tóm tắt chung chung?
  Ghi kết quả vào `analysis.fitsOneVideo`.
- **Đủ (`fitsOneVideo: true`)** → một video khoảng 3 phút, viết script bình thường.
- **Không đủ** → **không tự ép, không tự tách, không viết script.** Trình người dùng:
  1. tóm tắt phân tích & phân loại, tóm tắt logic tiếp nhận;
  2. nếu ép 3 phút sẽ phải bỏ gì, mất gì, vì sao ảnh hưởng hiểu/áp dụng — chỉ rõ ví dụ,
     quy trình, chi tiết thực tế có nguy cơ bị cắt (ghi vào `analysis.lossIfForced`);
  3. bảng đề xuất tách: Phần · Tên video · Nội dung chính · Nội dung quan trọng cần giữ ·
     Ví dụ/minh họa · Thời lượng dự kiến · Lý do tách. Cách chia bám cấu trúc thật của tài
     liệu; lý do dựa trên nội dung thật (nhiều nhóm độc lập, quy trình nhiều bước, ví dụ
     quan trọng, mật độ quá cao, độ phức tạp khác nhau…);
  4. phương án A (một video ~3 phút → hệ quả về độ đầy đủ) và phương án B (tách → lợi ích
     về giải thích, minh họa). Phân tích trade-off, không mặc định chọn phương án ngắn hơn.

  Dùng `AskUserQuestion`, ghi `lengthDecision: { status: "pending" }` khi đang chờ, và
  `{ status: "single" | "split", confirmedBy: "<ai> <ngày>" }` khi đã chốt.

#### 4. Cấu trúc nhận thức cho người trưởng thành

Các nguyên lý dưới đây chỉ để sắp xếp và truyền đạt nội dung đã có, không để thêm kiến thức.

1. **Relevance** — nội dung là gì, vì sao cần biết, liên quan gì đến công việc; chỉ nói khi
   tài liệu có cơ sở.
2. **Prior knowledge** — khi tài liệu nối các khái niệm với nhau: điều đã biết → nội dung
   mới → cách hiểu mới. Không đoán kiến thức nền của người học.
3. **Cụ thể trước khái quát khi phù hợp** — khái quát → giải thích → ví dụ, hoặc tình
   huống/ví dụ → rút ra nguyên tắc; chọn theo nội dung, không áp máy móc.
4. **Chunking** — gom ý liên quan thành cụm nhỏ; không dồn nhiều ý mới liên tiếp trong một
   đoạn lời.
5. **Cognitive load** — xác định ý nào cần nói, cần hiện, cần cả hai, hay bỏ khỏi lời đọc;
   lời và hình không cùng lúc đổ nhiều thông tin mới.
6. **Signaling** — câu chuyển ý, từ khóa, cấu trúc câu báo đâu là ý chính, điểm cần nhớ,
   bước tiếp theo; không lạm dụng câu dẫn.
7. **Progressive disclosure** — tổng quan → ý chính → chi tiết → ví dụ.
8. **Củng cố** — cuối video dùng điểm cần nhớ, checklist, kết luận, câu hỏi **có sẵn trong
   tài liệu**; không tự tạo.

#### 5. Lời đọc và hình

- **Lời đọc không đọc lại màn hình.** Thứ đã rõ trên thẻ, bảng, sơ đồ, quy trình thì lời đọc
  giải thích, dẫn dắt, nhấn mạnh, nối ý. Nội dung khó thể hiện bằng hình thì lời đọc gánh.
- Cột `visual` của mỗi cảnh chỉ đề xuất thứ có trong tài liệu, không tạo thông tin mới.
- **Văn nói:** tự nhiên khi đọc to, câu ngắn, ít mệnh đề, không giọng hành chính, không
  cường điệu, không ngôn ngữ quảng cáo nếu tài liệu không có, không thuật ngữ thừa, không
  ví dụ ngoài tài liệu. Không dùng "như chúng ta đã biết", "tiếp theo chúng ta sẽ…",
  "hãy cùng tìm hiểu…" (`script:validate` báo lỗi `filler-phrase`).
- Nguyên tắc 8–16 bên dưới (chống màu hồng, chuyện lần mình sai, trước/sau bằng số…)
  **không áp** cho chế độ này. Đọc số thành chữ và phát âm tên tiếng Anh theo bảng vẫn áp.

#### 6. Kịch bản gửi duyệt (`script-review.md`)

`script:validate` xuất bảng: **STT · Mục/Phần** (`section`, bám mục lục tài liệu) **· Nội dung
lồng tiếng** (`voiceText`) **· Nội dung trực quan nên xuất hiện** (`visual`) **· Thời lượng ước
tính**, cuối bảng ghi *Tổng thời lượng ước tính: X phút Y giây*. Gửi kèm tóm tắt phân tích và
logic tiếp nhận (lấy từ `analysis`).

#### 7. Tự kiểm tra trước khi gửi

1. Nguồn — có thông tin nào không nằm trong tài liệu?
2. Độ phủ — các mục lớn quan trọng đã có đủ?
3. Ưu tiên — đúng thứ tự mục lớn → ý chính → chi tiết → ví dụ?
4. Người trưởng thành — cách trình bày hợp nguyên lý ở mục 4?
5. Tải nhận thức — vừa nghe vừa nhìn có theo kịp?
6. Áp dụng được — rút gọn có làm mất ví dụ, chi tiết, hướng dẫn cần thiết?
7. Văn nói — đọc to có tự nhiên?
8. Lời/hình — lời đọc có đang đọc lại toàn bộ màn hình?
9. Thời lượng — trong 3 phút ±15 giây?
10. Tách — nếu 3 phút không đủ, đã đề xuất tách thay vì tiếp tục rút gọn?

Phát hiện vấn đề thì tự sửa trước khi gửi. Nguyên tắc cuối: **hiểu đúng → hiểu đủ → hiểu dễ →
hình dung được → nhớ được**, thay vì càng ngắn càng tốt.
