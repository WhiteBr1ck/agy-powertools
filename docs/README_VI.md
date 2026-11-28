<div align="center">
  <img src="../assets/logo.svg" width="72" height="72" alt="Agy Powertools Logo" />
  <h1>Agy Powertools</h1>
  <p><strong>Plugin mở rộng giao diện nguyên bản cho Antigravity 2.0</strong></p>
  <p>Giao diện đa ngôn ngữ, thống kê Context &amp; mức sử dụng, bố cục gọn, phân nhánh &amp; sửa tin nhắn, chuyển đổi nhiều tài khoản, Proxy không cần TUN, hỗ trợ SSH &amp; WSL2</p>
  <!-- plugin-badges:start -->
  <p>
    <a href="https://github.com/WhiteBr1ck/agy-powertools/releases"><img src="https://img.shields.io/github/v/release/WhiteBr1ck/agy-powertools?label=Release&color=2563eb" height="20" alt="Release" /></a>
    <a href="https://github.com/WhiteBr1ck/agy-powertools/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/WhiteBr1ck/agy-powertools/ci.yml?label=CI" height="20" alt="CI" /></a>
    <a href="../LICENSE"><img src="https://img.shields.io/github/license/WhiteBr1ck/agy-powertools?label=License&color=16a34a" height="20" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Antigravity-2.35.0-0f172a" height="20" alt="Antigravity 2.35.0" />
    <img src="https://img.shields.io/badge/Node.js-%3E%3D22.13-339933" height="20" alt="Node.js >= 22.13" />
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20WSL2-475569" height="20" alt="Platform" />
  </p>
  <!-- plugin-badges:end -->
  <p><a href="../README.md">简体中文</a> | <a href="README_ZH_TW.md">繁體中文</a> | <a href="../README_EN.md">English</a> | <a href="README_FR.md">Français</a> | <a href="README_JA.md">日本語</a> | <a href="README_KO.md">한국어</a> | <a href="README_DE.md">Deutsch</a> | <a href="README_ES.md">Español</a> | <a href="README_RU.md">Русский</a> | <strong>Tiếng Việt</strong></p>
  <p>
    <a href="#anh-chup-man-hinh">Ảnh chụp màn hình</a> |
    <a href="#tinh-nang">Tính năng</a> |
    <a href="#cai-dat">Cài đặt</a> |
    <a href="#cau-hinh">Cấu hình</a> |
    <a href="#lich-su-phien-ban">Lịch sử phiên bản</a>
  </p>
</div>

<p align="center">
  <img src="./images/hero-workspace.png" alt="Giao diện làm việc Agy Powertools" width="100%" />
</p>

> Gắn vào Antigravity 2.0 qua giao diện debug cục bộ và chỉ đọc các tệp session SQLite và JSONL cục bộ ở chế độ chỉ đọc. Plugin không sửa đổi tệp cài đặt của ứng dụng và không mở trang web bên ngoài.

---

<a id="anh-chup-man-hinh"></a>
## Ảnh chụp màn hình

<table>
  <tr>
    <th width="50%">Context Window &amp; Thống kê tốc độ</th>
    <th width="50%">Tiến độ tác vụ &amp; Quota trong Overview</th>
  </tr>
  <tr>
    <td>
      <img src="./images/card-composer.png" alt="Context window và thống kê tốc độ" width="100%" />
      <p>Xem mức dùng Context, tỷ lệ tái sử dụng Cache và tốc độ sinh token ngay cạnh bộ chọn model, kèm tùy chọn vòng Quota bao quanh khung nhập liệu.</p>
    </td>
    <td>
      <img src="./images/card-overview-panel.png" alt="Tiến độ tác vụ và Quota trong Overview" width="100%" />
      <p>Theo dõi từng bước thực thi trực tiếp, thời gian mỗi bước và Quota model còn lại ở bảng Overview bên phải; nhấn vào tiêu đề mục để thu gọn.</p>
    </td>
  </tr>
  <tr>
    <th>Tổng quan sử dụng (Giao diện Sáng)</th>
    <th>Tổng quan sử dụng (Giao diện Tối)</th>
  </tr>
  <tr>
    <td>
      <img src="./images/card-dashboard-light.png" alt="Tổng quan sử dụng ở giao diện sáng" width="100%" />
      <p>Mặc định hiển thị theo chu kỳ Quota tuần hiện tại, gồm số request, Token, tỷ lệ cache hit, chi phí ước tính, biểu đồ nhiệt 53 tuần và tình trạng từng model.</p>
    </td>
    <td>
      <img src="./images/card-dashboard-dark.png" alt="Tổng quan sử dụng ở giao diện tối" width="100%" />
      <p>Tự động đồng bộ giao diện sáng/tối của ứng dụng, so sánh tỷ trọng Token, chi phí, tỷ lệ cache hit và tốc độ giữa các model.</p>
    </td>
  </tr>
  <tr>
    <th>Danh sách Request &amp; Bất thường Cache</th>
    <th>Đa tài khoản &amp; Quản lý Quota (Mặc định tắt)</th>
  </tr>
  <tr>
    <td>
      <img src="./images/card-requests.png" alt="Danh sách request và cảnh báo bất thường cache" width="100%" />
      <p>Lọc request theo tài khoản, model, hội thoại và trạng thái; gắn cờ các lần rớt Cache bất thường trong khoảng thời gian ngắn (bỏ qua cold start và compaction).</p>
    </td>
    <td>
      <img src="./images/card-accounts.png" alt="Chuyển đổi nhiều tài khoản và quản lý Quota" width="100%" />
      <p>Lưu và chuyển đổi nhiều tài khoản Google cục bộ qua kho khóa bảo mật của hệ điều hành, xem Quota 5 giờ và theo tuần tại một nơi.</p>
    </td>
  </tr>
  <tr>
    <th>Cài đặt Ngôn ngữ &amp; Hiển thị</th>
    <th>Proxy không cần TUN (Mặc định tắt)</th>
  </tr>
  <tr>
    <td>
      <img src="./images/card-settings.png" alt="Cài đặt ngôn ngữ và hiển thị" width="100%" />
      <p>Hỗ trợ 10 ngôn ngữ giao diện, chia 5 danh mục có tìm kiếm trực tiếp, bật/tắt bố cục gọn, tô màu tin nhắn, đơn vị Token và tiền tệ hiển thị.</p>
    </td>
    <td>
      <img src="./images/card-proxy.png" alt="Cài đặt Proxy riêng không cần TUN" width="100%" />
      <p>Định tuyến riêng Antigravity qua HTTP hoặc SOCKS5 kèm kiểm tra kết nối tích hợp, ép HTTP/1.1 và xác minh cập nhật trong ứng dụng.</p>
    </td>
  </tr>
</table>

---

<a id="tinh-nang"></a>
## Tính năng

- **Giao diện đa ngôn ngữ (10 ngôn ngữ)**: Việt hóa (và 9 ngôn ngữ khác) cho các bảng Powertools, menu thường dùng của Antigravity, hộp thoại cấp quyền, cài đặt và iframe Swarm, giữ nguyên nội dung chat và khối code.
- **Đo lường Context và tốc độ**: Thêm vòng tròn sử dụng Context (kèm tỷ lệ tái sử dụng Cache, số lần nén và thanh planner/executor của Orchestrator) cùng đồng hồ tốc độ (`tok/s`, TTFT, thời gian model vs tool, chi phí phiên ước tính) ngay cạnh khung nhập, bao gồm cả thống kê Subagent.
- **Dashboard sử dụng và log Request cục bộ**: Thêm trang `Powertools` ở thanh bên kết hợp dữ liệu Desktop và `agy` CLI, gồm tổng quan sử dụng (biểu đồ nhiệt 53 tuần, biểu đồ tròn Token/chi phí, bảng model), nhật ký từng request, cờ bất thường Cache, nút copy lỗi 1 chạm, ước tính Quota, làm mới bảng giá API chính thức, tùy chọn đơn vị Token (`K / M / B` hoặc `Wan / Yi`) và tiền tệ hiển thị (`USD $` / `CNY ¥` tự động đồng bộ tỷ giá ngầm).
- **Bố cục gọn và cập nhật theo giai đoạn**: Giữ nguyên cỡ chữ của ứng dụng trong khi tinh chỉnh giãn dòng và khoảng cách khối; hiển thị tiến độ ngắn gọn trong lượt chạy nhiều bước và tự gập vào tiêu đề thời gian xử lý khi hoàn tất.
- **Phân nhánh hội thoại và sửa tin nhắn tại chỗ**: Tạo nhánh (fork) hội thoại mới từ bất kỳ phản hồi hoặc menu hội thoại nào với đầy đủ lịch sử (kể cả hội thoại có Subagent), hoặc sửa trực tiếp tin nhắn đã gửi ngay trên khung nhập nguyên bản của Antigravity.
- **Chuyển đổi nhiều tài khoản (mặc định tắt)**: Dùng Windows Credential Manager, macOS Keychain hoặc Linux Secret Service để cô lập nhiều tài khoản Google không lưu token văn bản thuần; theo dõi Quota 5 giờ / tuần ở thanh bên và tùy chọn tự chuyển khi cạn Quota.
- **Proxy riêng cho ứng dụng không cần TUN (mặc định tắt)**: Tiêm cờ Proxy và biến môi trường chỉ cho Antigravity khi khởi động lại, hỗ trợ kiểm tra HTTP CONNECT / SOCKS5, nhắc khi cold-start và tùy chọn `GODEBUG=http2client=0` để giảm lỗi ngắt `EOF`.
- **Hỗ trợ SSH Remote và WSL2**: Đọc dữ liệu phiên từ xa, Subagent và thống kê trên cửa sổ `SSH` qua OpenSSH cục bộ mà không cần cài gì lên server; hỗ trợ Antigravity trên Windows kết hợp WSL2 ở cả chế độ mạng NAT và Mirrored, lưu trữ thông tin đăng nhập lai và ủy quyền khởi động lại.
- **Menu chuột phải cho tệp và tiện ích nhỏ**: Chuột phải vào liên kết tệp hoặc cây Files để đính kèm vào chat, mở, mở thư mục chứa, sao chép tệp hoặc đường dẫn (kể cả đường dẫn NAS / SMB LAN trên Windows); bổ sung các mục thu gọn Tiến độ tác vụ & Quota trong Overview, bộ đếm chưa đọc trên thanh tiêu đề, vòng Quota và tô màu tin nhắn người dùng.

---

## Tính năng vui (Nhưng đẹp mắt)

<p align="center">
  <img src="./images/card-border-beam.webp" alt="Hiệu ứng viền sáng khung nhập khi đang xử lý" width="100%" />
</p>

- **Viền sáng chuyển động khi đang xử lý (mặc định tắt)**: Lấy cảm hứng từ [border-beam-ios](https://github.com/ismnoiet/border-beam-ios), dùng shader WebGL SDF bo góc nhẹ. Tạo vệt sáng mượt chạy đều quanh khung nhập liệu khi agent đang làm việc và mờ dần về 0% tải CPU/GPU khi lượt chạy kết thúc. Chuyển mượt với vòng sáng Quota khi bật cả hai, kèm 6 bảng màu (`Gemini`, `Aurora`, `Colorful`, `Neon`, `Accent`, `Quota`) và nút **Thử xem trước** trong Cài đặt.

---

<a id="cai-dat"></a>
## Cài đặt

> Yêu cầu: Đã cài và mở Antigravity ít nhất một lần. Sử dụng Node.js cục bộ `>= 22.13` hoặc tự động dùng `agy-node` đi kèm Antigravity. Không cần `npm install` hay quyền quản trị viên.

### Cách 1: Nhờ Agent cài giúp (khuyến nghị)

Gửi prompt sau cho Antigravity hoặc một coding agent cục bộ khác:

> Please install Agy Powertools from https://github.com/WhiteBr1ck/agy-powertools . Read README_EN.md and docs/INSTALL_AGENT.md first, and run the unified installer provided by the project using local Node.js or Antigravity's bundled runtime. Keep all other plugins, account settings, and chat history intact, and do not force-close the running client. Verify the installed version afterward and remind me if a client restart is needed.

Xem thêm chi tiết tại [Hướng dẫn cài đặt cho Agent](INSTALL_AGENT.md).

### Cách 2: Cài qua dòng lệnh

Tải và giải nén bản ZIP mới nhất từ [Releases](https://github.com/WhiteBr1ck/agy-powertools/releases) (hoặc clone repository này), sau đó chạy:

```powershell
# Windows (PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

```sh
# macOS / Linux / WSL2
sh ./install.sh
```

Cài đặt lại vẫn giữ nguyên các thiết lập đã lưu và không tự đóng ép Antigravity đang chạy. Sau khi xong tác vụ hiện tại, hãy khởi động lại Antigravity; mục **Powertools** sẽ xuất hiện ở thanh bên trái. Trên macOS, mặc định plugin không tạo bản sao `.app` thừa (khi mở `Antigravity.app` gốc mà chưa có cờ debug, plugin tự động khởi chạy lại một lần kèm cờ debug); nếu muốn mở một bước từ Spotlight hoặc Launchpad, bạn có thể tùy chọn tạo ứng dụng khởi chạy nhẹ `~/Applications/Antigravity (Powertools).app` ngay trong **Cài đặt -> Hệ thống -> Khởi chạy macOS**.

### Cập nhật và gỡ bỏ

- **Cập nhật trong ứng dụng**: Vào **Powertools -> Cài đặt -> Giới thiệu -> Kiểm tra cập nhật** rồi nhấn **Cài đặt cập nhật**. Gói tải về được kiểm tra SHA-256 và tự động khôi phục (rollback) nếu khởi động lỗi.
- **Gỡ cài đặt**: Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1` (Windows) hoặc `sh ./uninstall.sh` (macOS / Linux / WSL2). Thêm `--keep-settings` nếu muốn giữ lại tùy chọn đã lưu. Lịch sử chat, tài khoản và các plugin khác hoàn toàn không bị ảnh hưởng.

---

<a id="cau-hinh"></a>
## Cấu hình

Mọi thiết lập áp dụng trực tiếp trong **Powertools -> Cài đặt** (được phân thành 5 danh mục kèm thanh tìm kiếm trực tiếp và xuất/nhập JSON) và tự động lưu (**Khôi phục mặc định** nằm trong mục **Hệ thống -> Sao lưu & đặt lại cài đặt**).

<details>
<summary><strong>Mở rộng toàn bộ danh sách cài đặt, biến môi trường và đường dẫn</strong></summary>

### Chung & Hiển thị

| Thiết lập | Mặc định | Mô tả |
| --- | --- | --- |
| Bật Powertools | Bật | Công tắc tổng; tạm dừng mọi mở rộng giao diện mà vẫn giữ cấu hình đã lưu |
| Ngôn ngữ | `简体中文` | Chọn một trong 10 ngôn ngữ giao diện (bao gồm `Tiếng Việt`) |
| Phông chữ và độ đậm cục bộ | Mặc định app | Tìm theo tên bản địa hoặc họ font để áp dụng; chỉnh độ đậm riêng; đặt lại để về mặc định; Terminal vẫn dùng font riêng |
| Bố cục gọn | Bật | Giảm chiều cao dòng (`1.4`) và khoảng cách khối/tool trong khi giữ nguyên cỡ chữ |
| Tô màu bong bóng tin nhắn người dùng | Tắt | Thêm nền màu và viền cho tin nhắn người dùng (Accent, 5 mẫu màu, màu tùy chỉnh và thanh trượt độ đậm 10%-100%) |
| Luôn hiện thanh điều hướng hội thoại | Bật | Giữ thanh nhảy giữa các lượt trong hội thoại nhiều lượt luôn hiển thị |
| Giữ mở Overview khi chuyển hội thoại | Bật | Lưu trạng thái mở/đóng bảng Overview bên phải khi chuyển đổi chat |
| Số hội thoại mỗi dự án | `Mặc định (6)` | Điều chỉnh số chat hiển thị mỗi dự án ở thanh bên (`Mặc định (6)`, `1-10`, hoặc `Hiện tất cả`) |
| Kéo thả thư mục vào thanh bên | Bật | Tạo hoặc mở dự án bằng cách kéo thả thư mục cục bộ vào thanh bên (có tùy chọn con tự động ghim) |
| Viền sáng cho hội thoại đang chạy ở thanh bên | Tắt | Hiển thị viền sáng quanh khung hội thoại đang chạy với 3 kiểu (**Quét đáy**, **Xung sáng bên trong**, **Hào quang bên ngoài**), hỗ trợ ẩn vòng xoay 4 chấm gốc, chọn màu và cảnh báo hổ phách khi chờ xác nhận |
| Nhóm hội thoại đang chạy ở thanh bên | Tắt | Ghim mục Đang chạy thu gọn được ở đầu thanh bên hiển thị tất cả chat, dự án, Subagent đang hoạt động và cảnh báo chờ xác nhận |
| Huy hiệu chưa đọc trên thanh tiêu đề | Bật | Hiện số `(N)` chưa đọc trên tiêu đề cửa sổ/thanh tác vụ khi chat chạy nền hoàn tất |

### Thống kê & Tiến độ

| Thiết lập | Mặc định | Mô tả |
| --- | --- | --- |
| Đơn vị Token | `K / M / B (Quốc tế)` | Chọn đơn vị rút gọn quốc tế `K / M / B` (tự chuyển lên `B` từ 1 tỷ) hoặc `Wan / Yi` tiếng Trung |
| Đơn vị tiền tệ hiển thị | `USD ($)` | Chuyển đổi hiển thị chi phí ước tính giữa `USD ($)` và `CNY (¥)` với tỷ giá tự động cập nhật ngầm trên toàn bộ Tổng quan, Bảng giá và thống kê |
| Vòng tròn Context | Bật | Hiển thị vòng mức dùng Context, chi tiết tái sử dụng Cache và thanh theo từng model của Orchestrator |
| Tốc độ & thống kê | Bật | Hiển thị đồng hồ tốc độ và mở chi tiết thống kê phiên kèm chi phí ước tính |
| Tiến độ tác vụ | Bật | Mục thu gọn trong Overview hiển thị danh sách kiểm tra, giai đoạn hiện tại và thời lượng từng bước |
| Hiện Quota trong Overview | Tắt | Mục thu gọn trong Overview hiển thị Quota 5 giờ và hàng tuần còn lại |
| Mở nhanh Overview ở thanh tiêu đề | Tắt | Thêm nút Powertools ở góc trên bên phải để mở popover 6 tab ngay trên hội thoại hiện tại |
| Vòng sáng Quota quanh khung nhập | Tắt | Vẽ vòng Quota còn lại theo chiều kim đồng hồ quanh khung nhập (xanh ngọc, hổ phách hoặc đỏ), kèm tùy chọn chu kỳ (`Tự động`, `Tuần`, `5 giờ`) |
| Viền sáng chuyển động khi đang xử lý | Tắt | Chạy hiệu ứng viền sáng mượt quanh khung nhập khi đang xử lý (0% tải khi nghỉ), chuyển mượt với vòng sáng Quota, có 6 bảng màu & Xem trước |
| Context & thống kê Subagent | Bật | Hiển thị model, mức dùng Context, Token, tỷ lệ cache hit, tốc độ và chi phí cho từng Subagent |
| Thời lượng lượt chạy / Mở rộng tool | Bật | Hiển thị tổng thời gian ở lượt đã xong và nhấn để mở rộng chi tiết tool |
| Thống kê cuối mỗi lượt trả lời | Tắt | Hiện model, tỷ lệ cache hit, Token vào/ra và chi phí ước tính ở chân phản hồi, rê chuột để xem chi tiết |

### Tính năng mở rộng, Tài khoản, Proxy & Hệ thống

| Thiết lập | Mặc định | Mô tả |
| --- | --- | --- |
| Cập nhật tiến độ theo giai đoạn | Bật | Báo cáo tiến độ ngắn trong lượt chạy tool nhiều bước và gập lại khi xong |
| Tìm kiếm & đọc song song | Tắt | Hướng dẫn agent gộp nhiều thao tác tìm kiếm và đọc tệp trong một lượt |
| Tìm kiếm toàn văn trong hộp thoại gốc | Bật | Mở rộng modal tìm kiếm hội thoại gốc để tìm nội dung tin nhắn, khối code, lệnh và nhảy thẳng tới lượt khớp |
| Phân nhánh / Sửa tin nhắn / Menu tệp | Bật | Phân nhánh hội thoại nguyên bản, sửa tin nhắn tại chỗ và menu chuột phải cho tệp (kèm Mở bằng... và nhảy tới `#L:C`) |
| Nhận diện lệnh SSH khi dán | Bật | Tự trích xuất `user@host:port` khi dán `ssh -p PORT user@host` vào ô SSH Host (tự loại bỏ mật khẩu đi kèm) |
| Bật chuyển đổi nhiều tài khoản | Tắt | Cần chủ động bật kèm cảnh báo rủi ro; bộ chuyển ở thanh bên, dạng danh sách/thẻ, xem 5H/tuần và tự chuyển tài khoản |
| Proxy cho ứng dụng (không cần TUN) | Tắt | Nhập giao thức/host/port, kiểm tra kết nối, nhắc khi cold-start và ép HTTP/1.1 |
| Đồng bộ mức dùng đa thiết bị | Tắt | Gộp thống kê sử dụng giữa các thiết bị qua thư mục dùng chung (`syncDir`) hoặc SSH (`syncSshHosts`, hỗ trợ bật/tắt 1 chạm host phát hiện sẵn) mà không đồng bộ nội dung chat; gồm bộ lọc và biểu đồ theo thiết bị, sao chép prompt cho Agent, `scripts/sync.mjs` và [SYNC_AGENT.md](./SYNC_AGENT.md) |
| Khởi chạy trực tiếp macOS | Tắt | Chỉ hiện trên macOS: tạo/hiển thị trong Finder/xóa `~/Applications/Antigravity (Powertools).app` và sao chép lệnh khởi chạy |
| Mục tiêu Context (Thử nghiệm) | `Mặc định` | Chọn `Mặc định`, `256K`, `500K` hoặc `1M` (`Mặc định` giữ nguyên thiết lập gốc) |

### Biến môi trường & đường dẫn

| Tên / Đường dẫn | Mô tả |
| --- | --- |
| `ANTIGRAVITY_USER_DATA_DIR` | Thư mục dữ liệu người dùng Antigravity tùy chỉnh cho profile tách biệt |
| `ANTIGRAVITY_CLI_DATA_DIR` | Thư mục dữ liệu `agy` CLI tùy chỉnh (mặc định `~/.gemini/antigravity-cli`) |
| `AGY_POWERTOOLS_SYNC_DIR` | Thư mục dùng chung mặc định cho đồng bộ mức dùng đa thiết bị |
| `AGY_POWERTOOLS_DEVICE_NAME` | Tên thiết bị mặc định hiển thị trong bộ lọc đa thiết bị |
| `ANTIGRAVITY_CDP_PORT_FILE` | Đường dẫn chỉ định tới `DevToolsActivePort` (cũng hỗ trợ `AGY_BROWSER_ACTIVE_PORT_FILE`) |
| `~/.gemini/config/plugins/agy-powertools/` | Thư mục chứa tệp plugin và script thực thi đã cài |
| `~/.gemini/antigravity/plugin_data/agy-powertools/` | Dữ liệu cài đặt đã lưu, metadata tài khoản, mẫu Quota và bộ nhớ đệm bảng giá |

</details>

---

<a id="lich-su-phien-ban"></a>
## Lịch sử phiên bản

### v2.16.14
- **Sửa lỗi hồi quy chuyển đổi tài khoản trên Windows báo `process-list-unavailable` và bỏ qua bước khôi phục thông tin đăng nhập (closes #120)**: Viết lại `listWindowsCredentialWriters()` trong [relaunch-worker.mjs](../scripts/relaunch-worker.mjs) để tránh hết thời gian chờ do quét không giới hạn `tasklist /FI USERNAME`, bằng cách chạy trước lệnh toàn phần tốc độ cao `tasklist /FO CSV /NH`, bỏ qua `PID 0` (`System Idle Process`) không khớp, và chỉ truy vấn thu hẹp theo từng cặp `IMAGENAME + USERNAME` trùng khớp (có hỗ trợ thông báo không tìm thấy bản địa hóa) khi còn tiến trình ghi thông tin đăng nhập.
- **Sửa lỗi khởi động lại kèm Proxy trên WSL2 và vòng lặp sai lệch trạng thái `not-applied` (closes #113)**: Luôn sao chép `relaunch-worker.mjs` sang thư mục `%TEMP%` của Windows cùng `cwd` tương ứng (tránh treo đường dẫn 9P UNC vượt quá timeout ACK 6 giây), chuyển tiếp và kiểm duyệt danh sách cho phép cho `--wsl-distro=<distro>`, đồng thời trong [relaunch-worker.mjs](../scripts/relaunch-worker.mjs) truyền một chiều và tự động dọn dẹp các biến môi trường proxy, `AGY_POWERTOOLS_PROXY_SPEC` cùng `GODEBUG` qua các mục `WSLENV` `/u` đối với tác vụ WSL2.
- **Ưu tiên phát hiện runtime Node 22.5+ hỗ trợ `node:sqlite` trên máy chủ SSH từ xa (gộp PR #117, cảm ơn `@dubhe`)**: Cập nhật [ssh-remote.mjs](../lib/ssh-remote.mjs) để dò qua `nvm`, `fnm`, `mise`, `asdf`, `volta` và `~/.antigravity-hub-server/bin/agy-node` nhằm chọn phiên bản Node cao nhất hỗ trợ `node:sqlite`, bổ sung lọc khớp neo theo phân đoạn phiên bản và đảm bảo an toàn với `set -e`.

### v2.16.13
- **Chuyển đổi tiền tệ CNY sang tỷ giá thực tự động cập nhật ngầm (dự phòng cố định `6.7`, không có giao diện chỉnh tỷ giá)**: Bổ sung `createExchangeRateStore` trong [pricing.mjs](../lib/pricing.mjs) tự động lấy tỷ giá USD sang CNY công khai miễn phí qua `createProxyFetcher()` (nguồn chính `open.er-api.com`, nguồn dự phòng `api.frankfurter.app`, lưu đệm cục bộ 24 giờ, dự phòng ngầm `6.7` khi ngoại tuyến) đồng thời gỡ bỏ ô nhập tỷ giá thủ công và ghi chú tỷ giá tham khảo khỏi Cài đặt và Bảng giá.
- **Sửa lỗi thiếu thống kê cuối mỗi lượt trả lời và nút phân nhánh `...` trên Antigravity 2.35.2 (closes #111)**: Bổ sung hàm trợ giúp chuyên trách `findResponseActionRow()` duyệt ngược các phần tử cha trong một lượt vượt qua `[data-turn-content]` / `worked-for-collapsible`, gỡ lớp bọc tooltip đơn nút và nhận diện dự phòng theo tầng qua thuộc tính, ký tự biểu tượng, tooltip liên kết và siêu dữ liệu React fiber, đồng thời khôi phục bộ nhớ đệm `responseDoneCache`.
- **Giữ nguyên độ rộng popover Mở nhanh Overview nhờ không gian trống bên trái trên cửa sổ hẹp (closes #110, gộp PR #109, cảm ơn `@qimengdunjia`)**: Thay thế mức co cố định `64vw` của `.pt-qp-pop` bằng giá trị đo động `--pt-qp-max-w` nhằm giữ bố cục rộng hai cột trên dải kích thước cửa sổ `960px–1468px` và tự dọn dẹp thuộc tính khi đóng, tắt hoặc gỡ bỏ.
- **Bổ sung bản địa hóa tiếng Việt (`vi`) và tài liệu `docs/README_VI.md` (gộp PR #112, cảm ơn `@nhattuan612`)**: Mở rộng Powertools lên 10 ngôn ngữ hiển thị với đủ 623 mục `uiEntries` đồng bộ từ `v2.16.12`+, chuẩn hóa khớp biểu thức chính quy `Worked for` / `Đã xử lý` và gắn liên kết chuyển ngôn ngữ `Tiếng Việt` trên toàn bộ 10 tệp README.

### v2.16.12
- **Thiết kế lại giao diện Cài đặt theo danh mục kèm tìm kiếm trực tiếp xuyên suốt**: Tổ chức lại trang Cài đặt thành 5 danh mục phân đoạn phía trên (**Chung**, **Viền sáng & Thanh bên**, **Thống kê & Hội thoại**, **Tài khoản & Proxy**, **Hệ thống**) cùng thanh tìm kiếm trực tiếp; lồng 4 tùy chọn phụ (ẩn vòng xoay 4 chấm, chu kỳ vòng sáng Quota, nhấn thời lượng để mở rộng tool, tự động ghim dự án kéo thả) vào ngăn kéo của mục cha, loại bỏ 3 dòng cấu hình trùng lặp trong khi vẫn giữ nguyên dữ liệu đã lưu, gộp Xuất / Nhập / Đặt lại thành một hàng gọn gàng và giữ thẻ Giới thiệu luôn hiển thị ở cuối trang.
- **Thêm 2 kiểu viền sáng thanh bên mới: Xung sáng bên trong và Hào quang bên ngoài**: Sử dụng viền động siêu mảnh 1px kết hợp 3 quầng sáng chuyển động và nhịp thở lệch pha, dải chuyển sắc mượt cho các bảng màu đa sắc, hào quang ngoài gọn gàng không bị cắt viền, khung xem trước cố định không giật layout, bản địa hóa đầy đủ và tinh chỉnh tương phản sáng/tối trong khi vẫn giữ **Quét đáy** làm mặc định.
- **Hỗ trợ khởi chạy trực tiếp một bước trên macOS (closes #87, closes #101, gộp PR #105, cảm ơn `@puyialeng233-spec`)**: Bổ sung bộ khởi chạy cấu hình trực tiếp [launch-macos.mjs](../scripts/launch-macos.mjs) cùng các nút dành riêng cho macOS trong Cài đặt (**Tạo biểu tượng khởi chạy**, **Hiển thị trong Finder**, **Xóa biểu tượng khởi chạy**, **Sao chép lệnh khởi chạy**) quản lý gói ứng dụng nhẹ `LSUIElement` `~/Applications/Antigravity (Powertools).app` với đồng bộ biểu tượng `.icns` và dọn dẹp `lsregister -f/-u` tự động.
- **Thêm tùy chọn đơn vị Token, hiển thị tiền tệ CNY với tỷ giá tự động cập nhật ngầm và định dạng thời lượng theo giờ**:
  - Bổ sung **Đơn vị Token** (`K / M / B` quốc tế tự đổi sang `B` từ 1 tỷ trở lên, hoặc `Wan / Yi` tiếng Trung) trên Tổng quan, Yêu cầu, Cửa sổ Context, Thống kê phiên, Subagent và chân phản hồi;
  - Bổ sung **Đơn vị tiền tệ hiển thị** (`USD $` / `CNY ¥`) đồng bộ toàn bộ Tổng quan, Bảng giá, Yêu cầu, thống kê phiên và chân phản hồi, với tỷ giá USD sang CNY được tự động làm mới ngầm (lưu đệm cục bộ 24 giờ và dự phòng ngoại tuyến);
  - Tự động chuyển các thời lượng `>= 1 giờ` sang định dạng giờ/phút/giây (`21h 53m 18s`) trong Thống kê phiên và Subagent, đồng thời định dạng `h:mm:ss` trong đồng hồ Tiến độ tác vụ.
- **Cải thiện chi tiết giao diện và tương tác**: Khắc phục lỗi tự mở tooltip của Subagent đầu tiên khi nhấn vòng tròn Context (chỉ kích hoạt khi focus bằng bàn phím `:focus-visible`) và giới hạn vùng hover đúng tên Subagent; gỡ tooltip thừa trên quả cầu và tiêu đề Tiến độ tác vụ; loại bỏ dòng Cache window không còn dùng trong Thống kê phiên; thay chữ `stop` bị vỡ trên nút Dừng xem trước bằng biểu tượng SVG sắc nét.
- **Tăng cường độ ổn định backend và bảo mật (chọn lọc PR #102, PR #103, PR #105, PR #106, cảm ơn `@puyialeng233-spec`)**:
  - Thiết lập rõ `NODE_USE_ENV_PROXY: "0"` trong `sidecar.json` và worker cập nhật để cách ly biến môi trường proxy kế thừa từ hệ điều hành;
  - Nhận diện `language_server_windows_*.exe` và `agy.exe` kèm kiểm tra `tasklist` an toàn (fail-closed), giữ nguyên `ANTIGRAVITY_USER_DATA_DIR` tùy chỉnh, kiểm tra email thông tin đăng nhập fail-closed bằng `.NET JavaScriptSerializer` và siết chặt cơ chế gán Quota đa tài khoản cùng khóa chống chuyển đổi đồng thời;
  - Bổ sung giai đoạn `submitting`, `requestId` đơn điệu và `lastUpdateActionAt` trong `sidecar-ui.mjs` để loại bỏ tranh chấp poll khi cập nhật;
  - Neo chặt đường dẫn gốc bằng `realpathSync.native` chống `TOCTOU` và kiểm tra `assertOwnedPath` trên mọi đường dẫn dọn dẹp/mở khóa trong [lifecycle.mjs](../lib/lifecycle.mjs) và [update-manager.mjs](../lib/update-manager.mjs).

### v2.16.11
- **Sửa lỗi crash sidecar khi dùng Proxy SOCKS5 và tăng độ ổn định khi khởi động lại kèm Proxy (#93, #64)**: Bỏ `NODE_USE_ENV_PROXY`, chuyển `lib/pricing.mjs` sang `createProxyFetcher()`, nâng timeout ACK trên Windows lên 6 giây và giữ cooldown chặn relaunch qua các chu kỳ poll.
- **Sửa lỗi lẫn thông tin đăng nhập đa tài khoản và giải mã tiền tố Keyring macOS (#97, #95)**: Thêm `refreshHash` và kiểm tra chống ghi đè chéo, xử lý dọn dẹp `language_server.exe` trước khi khôi phục thông tin đăng nhập, kiểm tra đối chiếu `fromLsAddress` và giải mã tiền tố `go-keyring-base64:` trên macOS.
- **Hỗ trợ NTFS junction `.gemini` trên Windows và sửa kẹt banner cài đặt trên Aux Pane (#96, #100)**: Cho phép symlink/junction ở thư mục gốc trong `assertOwnedPath` nhưng vẫn chặn symlink lồng bên trong, hỗ trợ fallback copy `EXDEV` khác phân vùng.
- **Sửa độ đậm font tùy chỉnh không đều và lệch `font-variation-settings` trên `body`**: Dùng thang biến `--agy-fw-*` đồng bộ trong `lib/native-ui.js`.
- **Sửa lỗi hỏng bộ nhớ Node 24 trên Windows khi quét shortcut `.lnk`**: Thay bằng bộ quét byte không cấp phát (`containsFoldedBytes`) trong `lib/launcher.mjs`.
- **Nâng giới hạn mục `custom-i18n.json` lên 2000 ký tự và gộp 3 PR cộng đồng (#94, PR #98, PR #86, PR #83)**.

### v2.16.10
- **Sửa lỗi HTTPS tunnel bỏ qua Proxy khi kiểm tra cập nhật (PR #92, #90)**.
- **Sửa nhấp nháy cửa sổ gõ tiếng (IME) trên Windows trong các lượt gọi tool dài (#89)**.
- **Thêm Xuất / Nhập cài đặt cá nhân dạng JSON (#88)**: Loại bỏ thông tin xác thực trong URL Proxy và tách riêng các khóa bí mật/đa tài khoản cục bộ.

### v2.16.9
- **Thay thế bộ khởi động lại PowerShell/`.lnk` trên Windows bằng static Node.js worker (`scripts/relaunch-worker.mjs`)** để loại bỏ cảnh báo nhầm từ AV/EDR doanh nghiệp.
- **Sửa giá trị đỉnh tốc độ (`peakTps`) bị thổi phồng** do luồng tool-call ngắn hoặc buffer flush cuối lượt.

### v2.16.8
- **Chuyển tệp kéo thả quá dung lượng (> 20 MB) thành tham chiếu tệp gốc (#46)**.
- **Giới hạn phạm vi dịch menu hiển thị ở thanh bên trong ngữ cảnh menu (PR #82)** để không làm biến dạng tên dự án, hội thoại hoặc khối code.

### v2.16.7
- **Hỗ trợ đa ngôn ngữ nguyên bản (gồm PR #80 tiếng Pháp)** với kiến trúc tải gói ngôn ngữ theo yêu cầu (`lib/locales/`), tự nhận diện ngôn ngữ hệ điều hành và ghi đè qua `custom-i18n.json`.

Xem toàn bộ lịch sử phiên bản đầy đủ tại [README_EN.md](../README_EN.md#changelog).

---

## Giấy phép & liên kết

- **Giấy phép**: [MIT License](../LICENSE) (lịch chọn khoảng ngày tùy biến từ HextaUI dùng `react-day-picker` và `date-fns`; xem [lib/vendor/NOTICE.txt](../lib/vendor/NOTICE.txt))
- **Báo lỗi**: [GitHub Issues](https://github.com/WhiteBr1ck/agy-powertools/issues) (vui lòng ghi rõ hệ điều hành, phiên bản Antigravity và phiên bản plugin)
- **Cộng đồng**: [LINUX DO](https://linux.do/)
