# Talking Head

Đây là luồng B / Chế độ C: nhận clip quay thật, phiên âm, hiệu đính, cắt,
xử lý audio và tạo asset video/B-roll. Nó không dùng TTS và không phụ thuộc
vào `document-video`.

Đọc theo thứ tự: `cli.ts` → `commands-text.ts` / `commands-media.ts` →
`project-schema.ts` → `render-overlay.ts`.

Sau QA, dùng `studio:package talking-head` để đưa asset đã duyệt vào Studio.
Project Chế độ C hiện hữu vẫn được giữ nguyên để tương thích editor cũ.
