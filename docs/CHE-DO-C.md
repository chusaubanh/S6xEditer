# Chế độ C: dựng từ clip quay thật

Luồng này nhận clip quay, phiên âm, cắt, xử lý âm thanh, chỉnh trong Editor rồi xuất MP4. Giọng là âm thanh gốc, không qua VieNeu.

Đặc tả đầy đủ: [tham-khao-repo-cu/CHE-DO-C-SPEC.md](tham-khao-repo-cu/CHE-DO-C-SPEC.md), [BROLL-GUIDE.md](tham-khao-repo-cu/BROLL-GUIDE.md).

## Các bước

Cài một lần bằng `npm run th:setup`. Dấu ✋ là chỗ người dùng phải duyệt. Số bước giữ nguyên theo đặc tả, nên không có bước 13, 14.

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
15. Dựng minh hoạ bằng Remotion thành MP4; AI viết `broll-plan.json` (`side` cho overlay, zoom nhấn bằng anchor, camera auto) — xem `docs/BROLL-GUIDE.md`.
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

## Khác với tài liệu cũ

- **Không còn thư viện `templates/` và `scene-kit`.** Bỏ các bước 13-15 phần viết set scene-kit. Cảnh minh hoạ dựng bằng Remotion thành MP4, rồi đưa vào Editor như một lớp video. Project cũ có lớp cảnh `templateId` không hiển thị được lớp đó.
- **Cài đặt:** `npm run th:setup` cài đúng các phiên bản trong `requirements-asr.lock.txt`. Cần NVIDIA, driver 550 trở lên.
- **Model** nằm ở `models/`, ngoài git. Tự tải ở lần chạy đầu trên máy mới.

## Lớp phủ và xuất hình

`th:render` gọi `hyperframes@0.6.94` qua `npx`, nên lần đầu cần mạng. Luồng này tách riêng với Remotion.

## Quay màn hình và Premiere

`scripts/screencast/` dựng video quay màn hình và đóng gói timeline Premiere. Lệnh chạy nêu ở đầu từng file và ở [QUY-TRINH-VIDEO-HUONG-DAN-QUAY-MAN-HINH.md](tham-khao-repo-cu/QUY-TRINH-VIDEO-HUONG-DAN-QUAY-MAN-HINH.md).

Chưa kiểm trên repo này: dựng một video quay màn hình mới từ đầu, và mở gói Premiere trong Premiere.
