# S6xEditer

Pipeline dựng video đào tạo tiếng Việt cùng Claude Code. Có hai luồng:

- **Từ tài liệu:** viết kịch bản, vẽ hình cho từng câu, thu giọng VieNeu, render MP4 bằng Remotion. Có thể xuất project CapCut nhiều lớp.
- **Từ clip quay thật (Chế độ C):** phiên âm, cắt, xử lý âm thanh, chỉnh trong Editor, xuất MP4.

> **Giấy phép Remotion:** đơn vị vì lợi nhuận có trên 3 nhân viên phải mua Company License. Xem [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Cần có

| | Tối thiểu |
| :--- | :--- |
| Hệ điều hành | Windows 10 hoặc 11 |
| Node | 22 trở lên |
| GPU | NVIDIA, driver 550 trở lên, để chạy nhanh. Không có GPU thì luồng tài liệu chạy bằng CPU, chậm hơn nhiều. Chế độ C cần NVIDIA |
| Ổ đĩa | 30 GB; thêm 25 GB nếu cài Chế độ C |

## Cài đặt

```powershell
npm run setup
npm run doctor
```

`npm run setup` tự cài FFmpeg và uv qua winget nếu máy chưa có. Model giọng đọc tự tải ở lần dùng đầu. Chế độ C cài thêm bằng `npm run th:setup`.

## Làm video mẫu

```powershell
mkdir "output\Pha-tra"; copy "samples\Pha-tra\script.json" "output\Pha-tra\"
npm run script:validate -- "Pha-tra"
npm run approve -- "Pha-tra" script --by "tên bạn"
# Mở cửa sổ khác và chạy: npm run tts:server
npm run voice -- "Pha-tra"
npm run stills -- "Pha-tra"
npm run approve -- "Pha-tra" visual --by "tên bạn"
npm run render -- "Pha-tra"
```

Video ra ở `output/Pha-tra/video.mp4`.

## Đọc gì tiếp

| Cần | Tài liệu |
| :--- | :--- |
| Các bước làm một video | [docs/QUY-TRINH.md](docs/QUY-TRINH.md) |
| Dựng từ clip quay thật | [docs/CHE-DO-C.md](docs/CHE-DO-C.md) |
| Quy chuẩn kịch bản và hình | [docs/QUY-CHUAN-KICH-BAN.md](docs/QUY-CHUAN-KICH-BAN.md), [docs/QUY-CHUAN-HINH.md](docs/QUY-CHUAN-HINH.md) |

Muốn dùng thương hiệu riêng: thay logo trong `assets/brand/` và `public/brand/`, sửa tên trong `assets/brand/brand-guideline.json`.
