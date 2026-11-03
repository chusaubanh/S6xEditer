# Quy trình làm một video

Thay `<tài liệu>` bằng tên thư mục trong `input/`. Mỗi dấu **DỪNG** là chỗ người dùng phải quyết.

| Bước | Tổ | Việc | Lệnh | Đầu ra |
| :---: | :--- | :--- | :--- | :--- |
| 1 | S1 | Lập mục lục, phân tích, đánh giá thời lượng | `npm run doc:outline -- "<tài liệu>"` | `output/<tài liệu>/outline.json`, phần `analysis` |
| 2 | S1 | **DỪNG** nếu 3 phút không đủ: trình phương án tách | | `lengthDecision` |
| 3 | Master | **DỪNG** hỏi khổ hình và giọng đọc (`npm run tts:server`, `npm run voice:list`) | | `aspect`, `voice` |
| 4 | S2, S4 | Viết lời và hành động của hình từng câu; kiểm kịch bản | `npm run script:validate -- "<tài liệu>"` | `script.json`, `script-review.md` |
| 5 | Người dùng | **DỪNG** duyệt `script-review.md` | `npm run approve -- "<tài liệu>" script --by "<tên>"` | `approvals.json` |
| 6 | S3 | Thu giọng từng câu, đo mốc giờ | `npm run voice -- "<tài liệu>"` | `timeline.json`, `props.json` |
| 7 | S4, S5 | Dựng cảnh riêng trong `src/videos/<video>/`, đăng ký ở `registry.ts` | `npm run assets:optimize`, `npm run physics:bake` | Cảnh |
| 8 | S6 | Bài thử tất định, độ phủ, ảnh duyệt | `npm run gate:determinism -- "<tài liệu>"`, `npm run stills -- "<tài liệu>"` | `stills/` |
| 9 | S7 | Soi ảnh, gồm bản ẩn chữ | | Đạt hoặc trả lại |
| 10 | Người dùng | **DỪNG** duyệt bằng mắt | `npm run approve -- "<tài liệu>" visual --by "<tên>"` | `approvals.json` |
| 11 | Master, S6 | Render, chuẩn hoá −14 LUFS, QC | `npm run render -- "<tài liệu>"` | `output/<tài liệu>/video.mp4` |

Sửa `script.json` sau khi duyệt thì phiếu duyệt mất hiệu lực và lệnh sau sẽ dừng.

## Máy móc chặn những gì

| Cổng | Chặn |
| :--- | :--- |
| Hợp đồng | Câu không có mô tả hình; khổ ngoài 16:9, 9:16, 4:5, 1:1; chưa ghi phần mất khi ép thời lượng |
| `script:validate` | Chờ chốt thời lượng; quá 195 giây mà chưa tách; lời sáo; nhãn quá 8 từ hoặc chép lời đọc; từ và số không có trong tài liệu, gồm số đọc bằng chữ có mười, mươi, trăm, nghìn hoặc đi với phút, giờ, ngày, bước |
| `<Label i={n} />`, `npm test`, `render` | Chữ viết thẳng trong cảnh tại `src/videos/`; chữ trên hình phải lấy từ `labels` |
| Composition | Cảnh chưa dựng thì báo lỗi, không ra màn hình trống |
| `voice`, `render` | Chưa được người dùng duyệt |
| `gate:determinism` | Khung render lại ra hình khác; mọi khung giống hệt nhau |
| `stills` | Cuối cảnh: độ phủ dưới 62%; dải trống quá 19% chiều cao; nội dung cách mép khung dưới 60 px |
| `render` | Sai khổ, fps, codec, thời lượng; độ to lệch quá 1 LU so với −14; hình đứng yên quá 8 giây |

Ngưỡng hình đứng yên 8 giây là tạm thời; đổi bằng `--max-still`, chốt sau khi có video thật.

**Máy không chấm được:** đúng nghĩa so với tài liệu (S6 đọc đối chiếu), hình có kể được ý câu không (S7 và người dùng).

## Thêm công cụ hoặc hiệu ứng mới

Thêm một cảnh thử vào `src/fixtures/index.tsx` và mã của nó vào `scripts/gate-determinism.ts`, rồi chạy `npm run gate:determinism -- --fixtures`. Không đạt thì không dùng.

## Cài đặt máy mới

1. `npm install`
2. `uv venv .venv-vieneu --python 3.12`, rồi `uv pip install --python .venv-vieneu/Scripts/python.exe -r requirements-vieneu.lock.txt --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cu128`
3. FFmpeg và ffprobe phải có trong PATH. Model VieNeu tự tải về bộ nhớ đệm Hugging Face ở lần chạy đầu.
