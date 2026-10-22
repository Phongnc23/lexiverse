# LexiVerse 3.0 — Luyện tập tích hợp + game LIVE + thư viện

**Mã nguồn Windows chạy được ở local**: Python FastAPI, HTML/CSS/JavaScript, WebSocket, SQLite. Có khu vực giáo viên, học sinh vào phòng bằng QR/PIN, thư viện Sách → Bài → Từ, lớp học, chấm điểm và báo cáo. Đây là **MVP**, chưa phải sản phẩm production đã nghiệm thu tải lớn.

## 1. Chạy từ đầu trên Windows

1. Cài **Python 3.10 trở lên** (đã thử backend trên Python 3.13; người dùng trước đã chạy Python 3.12). Khi cài Python trên Windows, đánh dấu **Add Python to PATH**.
2. Giải nén file `LexiVerse-Fullstack-v3.zip`. Vào thư mục **`LexiVerse-Fullstack-v3` chứa `app.py`, `requirements.txt` và `run-windows.bat`**; đừng chạy file `.html` riêng bằng double-click.
3. Nhấp đúp **`run-windows.bat`**, hoặc mở Terminal ở thư mục dự án rồi chạy `./run-windows.bat` trong PowerShell. Giữ cửa sổ lệnh mở.
4. Mở **http://127.0.0.1:8000** (nếu trình duyệt mở sớm hơn server, Refresh một lần).
5. Bấm **Bắt đầu với vai trò giáo viên** → **Vào tài khoản demo trên máy cục bộ**.
6. Chọn **Thư viện** → **Tạo sách** (Nhật / Trung / Anh) → **Tạo bài học** → **Thêm từ** hoặc **Nhập nhiều từ**.
7. Chọn **Tổ chức LIVE**, tạo phòng, mở link học sinh trong cửa sổ ẩn danh rồi nhập biệt danh. Quay về màn Host để bắt đầu; học sinh nhập đáp án và xem kết quả.

### Nếu đã có bản LexiVerse cũ

- Giải nén bản mới vào **thư mục riêng**, không chép đè nguyên thư mục cũ ngay.
- Nếu muốn giữ dữ liệu cũ, **tắt server bản cũ** rồi sao chép `data/lexiverse.db` từ bản cũ sang `data/lexiverse.db` của bản mới (sao lưu trước). Nếu có các file `lexiverse.db-wal` và `lexiverse.db-shm`, tốt nhất dừng server và dùng cơ chế SQLite backup; không chép nóng chỉ mỗi `.db` khi đang có giao dịch.
- Nếu muốn bắt đầu với dữ liệu trống, không cần sao chép file `.db` cũ. Database sẽ tự tạo khi lần đầu chạy.
- Bộ code **không chứa database tài khoản cá nhân đã sử dụng**; zip chỉ gồm mã nguồn.

### Chạy thủ công khi file .bat gặp lỗi pip

Trong PowerShell tại thư mục project:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --no-cache-dir -r requirements.txt
Copy-Item .env.example .env -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Nếu báo `MemoryError`, đóng ứng dụng chiếm RAM, kiểm tra bộ nhớ ảo Windows, hoặc xóa `.venv` rồi cài lại bằng `--no-cache-dir`. Không xóa database để sửa lỗi pip.

## 2. Thay đổi mới ở V3

**Không còn `static/solo-game.html`.** Chức năng **Luyện tập** dùng thư viện trên máy chủ như các trang khác:

1. Đăng nhập tài khoản giáo viên (demo cục bộ hoặc Google nếu đã cấu hình).
2. Trong sidebar chọn **🎮 Luyện tập** hoặc nút **Luyện tập cá nhân** tại trang chủ.
3. Xem danh sách **Sách**, chọn **Bài học** đã có từ để mở màn hình cấu hình luyện tập.
4. Chọn **Hỗn hợp / Chính tả / Cách đọc**, chọn tốc độ, nhấn **Bắt đầu luyện tập**.
5. Gõ đáp án; phản hồi đúng/sai nhỏ nằm ngay bên dưới sân chơi; thẻ rơi không vượt mép màn hình. Có **tạm dừng**, **bỏ qua**, **chơi lại**, **nghe lại** và **ôn từ sai** sau màn chơi.
6. Có nút **🎮 Luyện bài này** ngay ở trang quản lý từ của bài. Chế độ tự luyện không cần tạo PIN hay lớp học.

**Lưu ý:** Điểm tự luyện được tính tại trình duyệt và không lưu vào bảng xếp hạng hoặc báo cáo LIVE. Danh sách thẻ tự luyện lấy qua API riêng, được bảo vệ bằng cookie của người sở hữu nội dung. Trình duyệt sử dụng Web Speech API để phát âm trong chế độ luyện tập; giọng có thể khác nhau theo hệ điều hành và bộ giọng đã cài. Game LIVE vẫn sử dụng MP3 phía server như V2.

**Thay đổi sân chơi LIVE:** Thẻ màu cam/viền vàng, nhãn loại thẻ trên góc phải và nút nghe trên góc trái như game gốc. Khi nhận câu trả lời, thanh báo kết quả gọn dưới khung game thay cho card thông báo lớn; khi lượt kết thúc, đáp án hiện ngay trong thẻ, không còn lớp phủ kín sân chơi. Tính điểm và quyền hạn vẫn do backend quyết định.

**API V3:** `GET /api/practice/lessons/{lid}/cards?mode=mixed|spelling|reading` — trả bộ từ chỉ khi người dùng đã đăng nhập và là chủ sở hữu bài. API trả đáp án cho chính chủ sở hữu phục vụ luyện tập cá nhân; không sử dụng API này cho người chơi khách/LIVE.

## 3. Các tính năng kế thừa từ V2

1. **UI/UX**: tăng spacing cho card, danh sách, form, vùng điều khiển; cập nhật trạng thái cursor; thống nhất font **Be Vietnam Pro** cùng font dự phòng Nhật/Trung; tối ưu responsive.
2. **Nhập từ vựng hàng loạt**: trong một bài học chọn **Tải mẫu CSV** hoặc **Nhập nhiều từ**. File mẫu UTF-8 BOM (mở dễ trong Excel) có đúng 5 cột: `term,meaning,pronunciation,alternatives,sort_order`. Giữ nguyên thứ tự cột, thay/xóa dòng ví dụ và lưu thành **CSV UTF-8**. Import tối đa **1.000 dòng / 2 MB** mỗi lần; báo số từ thêm và bỏ qua, bỏ qua từ trùng trong bài. API chỉ cho người sở hữu bài được import, có CSRF.
3. **Chế độ thẻ**: chỉ còn 2 nhóm **Chính tả** và **Cách đọc**, cùng tùy chọn **Hỗn hợp** (trộn hai nhóm). Không có nhóm **Nghĩa từ** riêng; nghĩa vẫn có thể là nội dung hiển thị hoặc âm thanh câu hỏi. Chọn kiểu nhập *một bàn phím* cho cả phiên theo ngôn ngữ: Nhật gõ Hiragana; Trung gõ Pinyin; Anh gõ từ tiếng Anh.
4. **Ngôn ngữ sách và lớp**: chỉ có **Anh (en), Nhật (ja), Trung giản thể (zh-CN)** ở cả UI lẫn API. Tiếng Việt vẫn dùng cho giao diện/nghĩa/giọng câu hỏi, không còn là ngôn ngữ được chọn khi tạo sách hoặc lớp mới.
5. **Âm thanh LIVE**: nút **Phát âm / Nghe lại** ở thẻ Cách đọc. Hệ thống thử tự phát lúc mở câu; trình duyệt có thể chặn autoplay nên học sinh bấm nút thủ công. Âm thanh sinh bằng `gTTS` phía server, **cần Internet khi lần đầu tạo âm thanh**, những lần sau dùng cache `data/tts/`. API học sinh **không nhận văn bản cần đọc hay đáp án trước khi kết thúc lượt**.

### Quy tắc câu hỏi theo ngôn ngữ

| Ngôn ngữ | Chính tả (2 biến thể) | Cách đọc (2 biến thể) | Đáp án nhập |
|---|---|---|---|
| Nhật | Hiện Kanji → Hiragana; Hiện nghĩa Việt → Hiragana | Nghe tiếng Nhật → Hiragana; Nghe nghĩa Việt → Hiragana | `pronunciation` Hiragana |
| Trung | Hiện Hán tự → Pinyin; Hiện nghĩa Việt → Pinyin | Nghe tiếng Trung → Pinyin; Nghe nghĩa Việt → Pinyin | `pronunciation` Pinyin |
| Anh | Gợi ý ký tự/che từ → nhập từ Anh; Hiện nghĩa Việt → nhập từ Anh | Nghe tiếng Anh → nhập từ Anh; Nghe nghĩa Việt → nhập từ Anh | `term` tiếng Anh |

Với Nhật/Trung, nếu từ thiếu `pronunciation` hoặc nhập sai hệ chữ, backend từ chối tạo phòng LIVE và báo trường hợp cần chỉnh sửa. Pinyin có thể nhập có dấu hoặc không dấu trong game LIVE; Hiragana cần đúng kí tự. Các đáp án thay thế được lọc theo ngôn ngữ và một bàn phím tương ứng.

**Ví dụ CSV tiếng Nhật**:

```csv
term,meaning,pronunciation,alternatives,sort_order
図書館,thư viện,としょかん,,1
学校,trường học,がっこう,,2
```

**Lưu ý Excel:** khi lưu, chọn **CSV UTF-8 (Comma delimited)**. Nếu dữ liệu chứa dấu phẩy, Excel sẽ tự thêm dấu nháy kép phù hợp. Nếu mở file lại mà dấu tiếng Việt/Kanji lỗi, hãy kiểm tra encoding UTF-8.

## 4. Cấu hình và kết nối database / API

- Mặc định: `DATABASE_PATH=./data/lexiverse.db` trong `.env` (SQLite tự tạo).
- Xem dữ liệu bằng **DB Browser for SQLite** → Open Database → `data/lexiverse.db`.
- Postman REST API: **http://127.0.0.1:8000/docs** (Swagger có đầy đủ endpoint).
- API teacher yêu cầu cookie phiên `lx_session`; các request ghi cần thêm `X-CSRF-Token` lấy từ `GET /api/me`.
- Truy cập game bằng QR/PIN được backend xác thực riêng bằng mã người chơi, không có quyền chỉnh sửa sách, lớp và báo cáo chủ phòng.

**Các endpoint mới:**
- `GET /api/lessons/{lid}/words/template` — tải file CSV mẫu (đăng nhập giáo viên, sở hữu bài).
- `POST /api/lessons/{lid}/words/import` — nhập CSV qua `multipart/form-data`, trường file tên `file`, thêm CSRF (giáo viên sở hữu bài).
- `GET /api/play/{sid}/audio?roundIndex=N` — file MP3 câu Cách đọc đang mở, yêu cầu cookie giáo viên hoặc `X-Player-Token` học sinh đúng phòng.

## 5. Trình tự kiểm tra nhanh

- [ ] Tạo sách mới → dropdown chỉ có Anh/Nhật/Trung.
- [ ] Tạo lớp mới → dropdown chỉ có Anh/Nhật/Trung. API gửi `language: "vi"` phải nhận lỗi `422`.
- [ ] Tạo bài → tải mẫu CSV → điền 3 dòng → nhập → `added: 3` (nếu không trùng) → xem ở danh sách từ và SQLite.
- [ ] Nhập lại file cũ → tất cả từ trùng bị bỏ qua.
- [ ] Tạo game Nhật, mode **Chính tả** → chỉ nhập Hiragana dù biến thể hiển thị Kanji hay nghĩa Việt.
- [ ] Tạo game Nhật/Trung/Anh, mode **Cách đọc** → bật âm thanh và nộp đáp án; nếu không nghe được kiểm tra Internet, bấm **Nghe lại**.
- [ ] Tạo game mode **Hỗn hợp** → chỉ có Chính tả và Cách đọc, không còn thẻ "Nghĩa từ".
- [ ] Vào Luyện tập → Sách → Bài → Chơi; thử đúng/sai, kết thúc, ôn từ sai và chơi lại.
- [ ] Đảm bảo thông báo đúng/sai ở ngay dưới sân chơi, không che thẻ hoặc bàn phím.
- [ ] Mở game trên máy tính và điện thoại để kiểm tra spacing, font và bàn phím ảo.

Chạy test tự động (sử dụng DB kiểm thử riêng trong `data/`):

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests/test_app.py tests/test_v2.py tests/test_v3.py
```

**Kiểm thử ở môi trường tạo gói**: 9 test backend/API pass, kiểm tra syntax JS của `app.js` pass. **Chưa thể kiểm thử browser end-to-end trên localhost bằng Chromium trong môi trường tạo gói** do chính sách chặn điều hướng mạng; cần thực tế rà soát thêm UI/UX trên máy Windows của bạn, bao gồm tiếng nói TTS qua Internet và nhập bằng bàn phím mobile.

## 6. Cấu trúc mã nguồn

```text
LexiVerse-Fullstack-v3/
├── app.py                     # REST + websocket + import CSV + thẻ + server TTS
├── db.py                      # SQLite tables và query helpers
├── .env.example               # cấu hình demo local
├── requirements.txt           # Python dependencies
├── run-windows.bat            # launcher Windows
├── run-linux-macos.sh
├── sample-import.json         # dữ liệu mẫu nhập từ game cũ
├── static/
│   ├── index.html             # khung ứng dụng
│   ├── app.js                 # UI chính, teacher/player/lobby + luyện tập tích hợp
│   ├── style.css              # font, spacing, responsive
├── data/.gitkeep              # DB tạo khi chạy
├── docs/                      # đặc tả gốc
└── tests/                     # test API và bảo mật
```

## 7. Triển khai công khai

Trước khi đưa lên Internet: tắt demo login (`APP_ENV=production`, `DEV_DEMO_LOGIN=false`), cấu hình `GOOGLE_CLIENT_ID`, `COOKIE_SECURE=true` và `PUBLIC_URL=https://...`, lưu trữ SQLite bền vững và HTTPS/WebSocket. Nếu triển khai nhiều máy chủ/worker, cần nâng cấp kiến trúc SQLite/scheduler/websocket (ví dụ PostgreSQL + Redis). **Chưa đủ điều kiện production** nếu chưa kiểm tra bảo mật, tải nhiều người chơi, tính ổn định dịch vụ TTS, backup và UX trên thiết bị thật.

### Chạy lại sau khi cập nhật mã nguồn

Đóng server đang chạy cổng `8000`, giải nén V3 vào thư mục **mới** và chạy `run-windows.bat`. Trên trình duyệt bấm `Ctrl+F5` để xóa CSS/JS cũ trong cache. Trong V3, truy cập `/static/solo-game.html` sẽ trả `404` vì file đã được loại bỏ chủ động. Các link tập mới ở `/app/practice` và `/app/practice/<lesson-id>`.

Nếu muốn giữ dữ liệu V2, sau khi tắt server V2 hãy sao lưu DB và chép `data/lexiverse.db` vào thư mục `data/` của V3. Hệ thống tiếp tục dùng SQLite tương thích. **Không chép thư mục `.venv`** từ hệ điều hành hoặc phiên bản Python khác.
