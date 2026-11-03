# S6X Editor — Design system "Tahoe" (Liquid Glass)

Thuần HTML/CSS, không dependency, không tải gì từ Internet. Font: Be Vietnam Pro (`assets/fonts/`, nạp qua `@font-face` đường dẫn tương đối `../../../../assets/fonts/`, chạy cả `file://` lẫn server editor vì `/assets/` đã được serve).

Tệp: `tahoe.css` (tokens + vật liệu + nền), `components.css` (thành phần, tiền tố `.t-`), `mockup.html` (trình diễn; mở trực tiếp bằng trình duyệt), `screens/` (ảnh chụp), `shot.sh` (chụp bằng Chrome headless: `./shot.sh <tên> <rộng> <cao> <hash>`; hash: `dark|light`, `45` = khung 4:5, `safe` = bật lưới, `gold`, `gallery`, `ctx`, `pop`).

## 1. Cách dùng nhanh
```html
<html lang="vi" data-theme="dark" data-accent="blue">   <!-- bỏ data-theme = theo hệ thống -->
<link rel="stylesheet" href="design/tahoe.css"><link rel="stylesheet" href="design/components.css">
<body class="t-root">
```
- Chế độ: `data-theme="dark|light"` (Tối là mặc định cho dựng phim). Một bộ token duy nhất nhờ `color-scheme` + `light-dark()` (Chrome 123+, Safari 17.5+, Firefox 120+).
- Màu nhấn: `data-accent="blue"` (#0A84FF, nền nút #0071E3 để chữ trắng đạt 4.5:1) hoặc `"gold"` (#C5A059, chữ trên nền vàng là #1C1507).
- Hình nền: `.t-wallpaper` (hoặc `background: var(--wall)`).

## 2. Tokens
| Nhóm | Token |
|---|---|
| Chữ | `--font-ui`, `--fs-11/12/13/15/17/22/28`, `--fw-regular 400 / medium 600 / bold 700 / heavy 800` (Be Vietnam Pro không có 500), `--ls-body -.006em`, `--ls-title -.02em`, `--ls-caps .05em` |
| Nhãn | `--label` (≥7:1), `--label-2` (≥4.5:1, chữ phụ), `--label-3` (chỉ placeholder/vô hiệu) |
| Nhấn | `--accent`, `--accent-fill`, `--accent-on`, `--accent-text`, `--accent-soft`, `--accent-line`; trạng thái `--danger --warn --ok` |
| Fill / kẻ | `--fill-1/2/3`, `--sep`, `--track` |
| Kính 4 cấp | `--mat-1 ultraThin`, `--mat-2 thin`, `--mat-3 regular`, `--mat-4 thick` + `--blur-1..4` (20/28/40/60px, saturate 150–180%) + `--mat-N-solid` (nền đặc dự phòng) |
| Specular | `--edge`, `--edge-top`, `--edge-out`, `--sheen`, `--spec` (= inset 1px sáng phía trên + vành 1px) |
| Bóng | `--shadow-1/2/3`, `--shadow-win` (nhiều lớp, mềm, kèm hairline 0.5px) |
| Bán kính đồng tâm | `--r-window 26` → (gutter 6) `--r-panel 20` → `--r-card 16` → (pad 8) `--r-control 12` → `--r-small 8`, `--r-clip 6`, `--r-pill 999` |
| Khoảng cách | `--s-1..8` = 4/8/12/16/20/24/32; `--control-h 28 / -lg 34 / -sm 22` |
| Chuyển động | `--ease-spring`, `--ease-out`, `--dur-1/2/3` = 160/240/320ms |
| Focus | outline 3px `--ring-color` (màu nhấn 55%) cho `:focus-visible` |
| Clip | `--hue-video/graphic/title/subtitle/audio/music` (nền/viền/chữ clip suy ra bằng `color-mix`) |

Dự phòng: `@supports not (backdrop-filter)` và `prefers-reduced-transparency` → nền đặc, bỏ blur/sheen. `prefers-reduced-motion` → mọi chuyển động ~0. `prefers-contrast: more` → viền/kẻ đậm hơn.

## 3. Quy tắc dùng
1. Kính chỉ cho lớp "nổi" (cửa sổ, panel, toolbar, popover, menu, toast). Bên trong panel dùng `--fill-*`, không chồng kính lên kính quá 2 lớp.
2. Bán kính lồng nhau theo công thức: con = cha − khoảng đệm. Control trong panel luôn 12 hoặc pill.
3. Chỉ một màu nhấn trên màn hình; màu clip chỉ dùng ở timeline. Đỏ chỉ cho "xoá/lỗi", cam cho cảnh báo.
4. Chữ trên kính dùng `--label/-2`; chữ nhấn dùng `--accent-text` (không dùng `--accent` cho chữ nhỏ).
5. Không emoji làm icon. Icon: SVG inline nét 1.5px (sprite `<symbol>` trong mockup, class `.t-ico`).
6. Số/timecode dùng `.t-num` (tabular-nums).
7. Video luôn nằm trên nền tối trung tính (`.t-stage`) để không ảnh hưởng cảm nhận màu.

## 4. Sơ đồ bố cục
```
┌─ .t-window ───────────────────────────────────────────────────────────┐
│ .t-titlebar: [đèn] [Tiêu đề]        [.t-toolbar][.t-toolbar][chip][Lưu][Xuất]│
│ .t-body (grid, gutter 6)                                              │
│ ┌ .t-panel--side ┐ ┌ .t-panel--stage ──────────┐ ┌ .t-panel--insp ┐  │
│ │ .t-tabs        │ │ .t-stage > .t-canvas[16:9]│ │ .t-insp-head    │  │
│ │ .t-subtabs     │ │   .t-sel .t-safegrid …    │ │ .t-group ×N     │  │
│ │ preset/SFX/…   │ │ .t-transport (pill nổi)   │ │ (details)       │  │
│ └────────────────┘ └───────────────────────────┘ └─────────────────┘  │
│ ┌ .t-panel--tl: .t-tl__bar · .t-ruler · .t-track ×N (.t-clip) ───────┐│
└───────────────────────────────────────────────────────────────────────┘
```
Khung xem trước: `.t-canvas[data-ar="16:9"|"4:5"|"9:16"]` tự vừa khít stage (container query); `--u` (=.84cqh) là đơn vị chữ lớp phủ, nên chữ co giãn theo khung. 16:9 là mặc định; đổi tỉ lệ chỉ cần đổi `data-ar`, inspector/timeline không phụ thuộc. Vùng an toàn là lưới TUỲ CHỌN `.t-safegrid.is-on` (title-safe 90%, action-safe 93%, chia ba) — mặc định tắt. Lớp `.t-safe--top/bottom` (sọc đỏ che UI nền tảng) vẫn còn trong CSS cho khung dọc, không dùng mặc định.

## 5. Danh sách lớp chính
- Cửa sổ: `t-window t-titlebar t-lights t-toolbar t-body t-panel(--side|--stage|--insp|--tl) t-panel__head/__title/__scroll t-caption t-sep t-vsep`
- Điều khiển: `t-btn(--primary|--ghost|--destructive|--icon|--sm|--lg|--block) t-seg(--block|--lg) t-switch t-slider(--center|--v) t-slider-db t-meter t-field t-select t-search t-stepper t-color t-swatch(es) t-chip(--ok|--dirty|--err)`
- Lớp nổi: `t-popover(--up) t-menu t-tip [data-tip] t-toast t-toast-host t-hud t-sheet` (+ `.is-open`, `.is-static`)
- Sidebar: `t-tabs t-subtabs t-pane t-tiles t-tile(--wide|--round) t-presets t-preset t-preset__thumb t-dots t-mini(--sub|--lower|--call|--text) t-list t-sfx t-wave t-outline`
- Inspector: `t-insp-head t-group t-group__body t-prop t-prop__ctl t-grid2 t-notice(--info)`
- Xem trước: `t-stage t-canvas t-transport t-play t-timecode t-sel(--warn|--ghost) t-sel__h t-sel__tag t-guide t-safegrid(+__title/__action/__thirds) t-safe`
- Timeline: `t-tl t-tl__bar t-tl__scroll t-tl__inner t-ruler t-tick(--major) t-range t-track(.is-locked|.is-hidden) t-track__head/__name/__btns t-tbtn(--mute|--solo) t-clip(--video|--graphic|--title|--subtitle|--audio|--music|--sfx; .is-selected .is-dragging) t-clip__label/__edge/__thumbs t-fade(--in|--out) t-fade-shade t-gain t-duck t-playhead t-snap t-dragtip t-marquee`
- Biến CSS theo track/clip: `--pps` (px/giây, đặt trên `.t-tl`), `--head-w`, `--h` (cao track); clip dùng `left:calc(start*var(--pps))`.

## 6. Hướng dẫn tích hợp cho editor hiện tại (index.html / editor.js / editor.css)
Nguyên tắc: thêm 2 link CSS + `class="t-root"` + `data-theme="dark"`, rồi đổi tên class; KHÔNG đổi `id` (editor.js bám theo id). Trong editor.js, nơi tạo phần tử cần đổi `className` — bảng dưới.

| Hiện tại | Lớp mới |
|---|---|
| `body` (grid 44px/1fr/260px) | `body.t-root.t-wallpaper > .t-window` rồi `.t-body`; `#timeline` cao `--timeline-h` |
| `#top` `.brand` | `header.t-titlebar` + `.t-lights` + `.t-titlebar__title` (`#jobName` → `.t-titlebar__doc`) |
| `.tools` nút `+ Chữ`, `+ Callout`, `Hoàn tác`… | `.t-toolbar` > `button.t-btn.t-btn--ghost.t-btn--icon` (icon SVG + `data-tip`); `.sep` → `.t-vsep`; `#btnDel` thêm `.t-btn--destructive` |
| `#saveState.chip(.ok/.dirty/.err)` | `.t-chip.t-chip--ok/--dirty/--err` (editor.js dòng ~81–102 đổi chuỗi class) |
| `#btnSave` / `#btnExport.gold` | `.t-btn` / `.t-btn.t-btn--primary` |
| `#preview` + `#stageArea` | `section.t-panel.t-panel--stage` > `.t-stage` |
| `#stage` | `.t-canvas` (đặt `data-ar` theo `project.aspect`: "16:9" / "4:5"); JS vẫn đặt kích thước thật bằng px nếu cần — hoặc bỏ và để CSS tự vừa |
| `#transport`, `#btnPlay`, `#timecode`/`#totalcode` | `.t-transport` (pill nổi), `.t-btn--primary.t-play`, `.t-timecode` + `<small>` |
| `#btnSafe`, `#safePlat` | `button.t-btn.t-btn--ghost.t-btn--sm` (toggle `.is-on`) + `.t-popover` chọn lưới; `#safeUi` render `.t-safegrid` thay `.safe` mặc định |
| `.selbox` / `.selbox.warn/.multi/.ghost` | `.t-sel` / `.t-sel--warn` / (`multi` giữ nét đứt) / `.t-sel--ghost` |
| `.handle` | `.t-sel__h` |
| `.guide.v/.h` | `.t-guide.t-guide--v/--h` (`.show` → toggle opacity bằng class `.is-on` nếu muốn, hoặc giữ inline) |
| `#props` / `#propsBody` | `aside.t-panel.t-panel--insp` > `.t-panel__scroll` |
| `.sec` (tiêu đề nhóm) | `details.t-group > summary` + `.t-group__body` (mặc định mở "Nội dung", "Vị trí") |
| `.row > label + .ctl` | `.t-prop > label + .t-prop__ctl` |
| `input[type=text/number]`, `textarea`, `select` | `.t-field` / `.t-stepper` (số) / `.t-select > select.t-field` |
| `input[type=range]` | `.t-slider` (+ gán `--p` khi `input`, xem JS cuối mockup) |
| `input[type=color]` + `.sw i` | `.t-color` (`.t-swatch` + hex + alpha) và `.t-swatches` |
| `.warnbox` | `.t-notice` (cam) |
| `.bigbtn` | `.t-btn.t-btn--block` |
| `.hint`, `.empty` | `.t-kbd` / `color:var(--label-2)` |
| `#timeline`, `#tlScroll`, `#tlInner` | `.t-panel--tl > .t-tl > .t-tl__scroll > .t-tl__inner` (đặt `--pps` = `zoom` px/giây) |
| `#ruler`, `.rhead`, `#rulerLane`, `.tick(.minor)` | `.t-ruler`, `.t-ruler__head`, `.t-ruler__lane`, `.t-tick(.t-tick--major)` (nhãn trong `.t-tick__t`) |
| `.trow` `.thead` `.nm` `.lane` | `.t-track` `.t-track__head` `.t-track__name` `.t-track__lane` (`.hid` → `.is-hidden`, `.lck` → `.is-locked`, `.lane.drop` → `.t-track--drop`) |
| nút M/S/khoá/ẩn/× trong header | `.t-tbtn` (`.t-tbtn--mute`, `.t-tbtn--solo`, `aria-pressed`) |
| `.blk.k-<type>` | `.t-clip` + `--graphic` (callout/lowerThird/text/image/shape), `--title` (scene/tiêu đề mục), `--subtitle`; `.sel` → `.is-selected`; `.eL/.eR` → `.t-clip__edge--l/--r`; đang kéo → `.is-dragging` |
| `#playhead > .ph-head` | `.t-playhead > .t-playhead__head` (đặt `left` = headW + t·pps) |
| (mới) track Giọng/SFX/Nhạc | `.t-clip--audio/--music/--sfx` + `<svg class="t-wave">` (polygon đối xứng, `viewBox` = px×px, `preserveAspectRatio=none`), `.t-fade--in/out` + `.t-fade-shade`, `.t-gain`, `.t-duck` (path đường gain dạng điểm [giây,%]) — xem JS "waveform"/"đường gain ducking" cuối mockup |
| (mới) snap / kéo | `.t-snap` (vạch vàng + thoi) và `.t-dragtip`; vùng chọn `.t-marquee`; dải thời gian `.t-range` |
| `#toast` | `.t-toast-host > .t-toast` (+ `.is-show`) hoặc `.t-hud` |
| `dialog#exportDlg` | `.t-sheet` + `.t-sheet__card` (hoặc giữ `<dialog>` với `.t-popover`-style kính thick) |
| (mới) thư viện preset/SFX | `.t-tabs`, `.t-subtabs`, `.t-presets > .t-preset` (+ `.t-dots` biến thể), `.t-list > .t-sfx` (`.is-playing`) |

Gợi ý theo từng bước: (1) link CSS + `t-root` + bọc `.t-window`; (2) đổi class tĩnh trong index.html; (3) đổi chuỗi class trong editor.js (`blk`, `trow`, `thead`, `lane`, `selbox`, `handle`, `row`, `sec`, `chip`); (4) thêm sprite icon; (5) xoá CSS cũ trong editor.css trùng tên (`button`, `input`, `.row`, `.blk`…) vì `components.css` đã bao phủ. Chú ý: nhiều selector gốc của editor.css là selector phần tử trần (`button{…}`, `input{…}`) nên phải bỏ/giới hạn khi tích hợp, nếu không sẽ đè lên `.t-btn`/`.t-field`.

## 7. Đã kiểm tra
Ảnh chụp trong `screens/` (Chrome headless): tối & sáng ở 1568×880 và 1280×800; 4:5 + lưới an toàn; thư viện thành phần. Đã soi tràn chữ/ dấu tiếng Việt/ tương phản qua 3 vòng chỉnh. Giới hạn: icon `i-magnet` vẽ dạng móng ngựa đơn giản; tương phản chữ trên kính chỉ kiểm bằng mắt + công thức token, chưa chạy công cụ đo tự động.
