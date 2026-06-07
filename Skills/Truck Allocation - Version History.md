# Truck Load Allocation Engine — Lịch sử phát triển Version 1 & Version 2

> Tài liệu này mô tả chi tiết **cách thức và quá trình** phát triển thuật toán chia tải cho xe (Truck Load Allocation) từ bản đầu tiên cho đến Version 2 hiện tại.

---

## Tổng quan

| Thuộc tính | Version 1 | Version 2 |
|---|---|---|
| **Tên gọi** | Pallet-First Bin Packing | Volume-Priority Assignment |
| **Chiến lược chính** | Tách chẵn/lẻ → Chia pallet chẵn trước → Gộp lẻ sau | Xếp lớn→nhỏ vào xe lớn→nhỏ → Rebalance → Xử lý dư |
| **Ràng buộc SKU** | Không giới hạn số xe/SKU | Tối đa 2 xe/SKU |
| **Thời điểm phát triển** | 06/06/2026 (sáng → chiều) | 06/06/2026 (chiều → tối) |
| **File chính** | `truck_allocation.js` | `truck_allocation.js` (cùng file, chọn qua UI) |

---

## PHẦN 1: VERSION 1 — "Pallet-First Bin Packing"

### 1.1. Khởi tạo ban đầu (Commit: `26165c0`)

**Yêu cầu từ user:**
- Tạo tab mới "Truck Allocation" trên giao diện ASN Agent Hub
- Đọc file OB Request (Excel), hiển thị danh sách PO
- Cho phép user chọn số lượng xe (2T/5T/8T/15T/Cont40) cho từng PO
- Chia hàng vào xe đảm bảo không vượt tải trọng

**Các file được tạo/sửa:**
- `truck_allocation.js` — Logic backend chia tải
- `public/index.html` — Thêm tab Truck Allocation vào sidebar
- `public/app.js` — Logic frontend upload file, hiển thị PO, gửi config
- `public/style.css` — Style cho các component mới
- `server.js` — Thêm 2 endpoint: `/api/truck-allocation/preview` và `/api/truck-allocation/execute`

**Thuật toán ban đầu (rất đơn giản):**
- Duyệt từng dòng hàng (SKU), nhét vào xe đầu tiên còn chỗ
- Không có logic ưu tiên pallet chẵn
- Không có cân bằng tải giữa các xe

### 1.2. Các vòng lặp sửa lỗi và cải tiến

#### Lỗi 1: Thuật toán không dùng thông số từ Goods Specification (`016292d`)
- **Vấn đề:** Code fix cứng tải trọng xe (8T = 8000kg), trong khi Goods Spec quy định 8T = 7900kg
- **Sửa:** Parse bảng "Master data of truck" từ file Goods Specification để lấy `Max load (Kg)` và `CBM` chính xác
- **Thêm:** `Math.floor()` để đảm bảo số thùng luôn là số nguyên

#### Lỗi 2: Không nhận dạng được cột header (`7cfb02e`)
- **Vấn đề:** Cột `Item code` viết hoa chữ I, code tìm chữ thường → không parse được SKU
- **Sửa:** Chuyển tất cả header sang `.toLowerCase().trim()` trước khi so sánh

#### Lỗi 3: Chỉ chia được 1 xe dù user chọn 2-3 xe (`88e9dda`)
- **Vấn đề:** Khi xe đầu tiên gần đầy (còn 2kg trống), code tính ra 0 thùng có thể nhét → dừng vòng lặp hoàn toàn → xe 2, 3 không bao giờ được sử dụng
- **Sửa:** Khi xe hiện tại không đủ chỗ cho 1 thùng → bỏ qua xe đó, chuyển sang xe tiếp theo (thay vì `break` toàn bộ)

#### Yêu cầu: Giữ nguyên format Excel (`51aee9d`)
- **Vấn đề:** Thư viện `XLSX` (SheetJS) chỉ xuất text, không giữ được màu sắc, font, border
- **Sửa:** Chuyển sang dùng `ExcelJS` — clone format từ template sheet gốc (màu nền, border, font bold, chiều rộng cột)
- **Thách thức:** ExcelJS không cài được trực tiếp trên Google Drive do giới hạn filesystem → phải cài ở thư mục tạm rồi fallback require path

#### Lỗi 4: Trùng tên worksheet (`1cedae0`, `3948bff`)
- **Vấn đề:** File upload có sẵn sheet tên `PO1-0626`, khi tạo sheet mới cùng tên → crash
- **Sửa:** Đổi tên template sheet thành tên tạm, xóa sheet cũ trùng tên trước khi tạo mới

#### Yêu cầu: Cấu trúc output giống sheet mẫu PHUONG (`73917e0`)
- **Vấn đề:** User muốn file xuất có 2 phần: Đề bài (dữ liệu gốc + dòng Total) ở trên, kết quả chia xe ở dưới
- **Sửa:** Viết lại hoàn toàn phần xuất Excel:
  1. Xuất các dòng gốc của PO (Đề bài)
  2. Dòng Total (font đỏ, nền vàng)
  3. Dòng trống ngăn cách
  4. Kết quả chia từng xe với subtotal

### 1.3. Tiến hóa thuật toán chia tải (V1)

Thuật toán V1 trải qua **6 lần viết lại** trước khi đạt được phiên bản ổn định:

#### Lần 1: Single-pass sequential (`26165c0`)
```
Duyệt từng SKU → nhét vào xe đầu tiên còn chỗ
```
❌ Không ưu tiên pallet chẵn, không cân bằng

#### Lần 2: 2-pass full pallets first (`c183846`)
```
Pass 1: Chia pallet chẵn cho từng SKU
Pass 2: Chia thùng lẻ còn lại
```
❌ Xử lý từng SKU tuần tự → SKU đầu chiếm hết xe → SKU sau bị xé lẻ

#### Lần 3: Bin packing với load balancing (`0081493`)
```
Cố nhét gọn 1 SKU vào 1 xe → nếu không vừa → chia ra nhiều xe
Luôn chọn xe trống nhất
```
❌ Vẫn xé lẻ pallet khi cố cân bằng

#### Lần 4: 2-pass rạch ròi (`c5a0134`)
```
Pass 1: Chỉ full pallets, chọn xe trống nhất
Pass 2: Chỉ odd cartons
```
❌ Chọn xe trống nhất → nhồi nhét 1 xe → xe khác trống

#### Lần 5: Pre-split + Best-fit (`1e872a2`, `b8f7989`)
```
STEP 0: Tách TẤT CẢ SKU thành 2 danh sách riêng:
        - fullPalletItems (phần chẵn)
        - oddCartonItems (phần lẻ)
STEP 1: Chia hết fullPalletItems (Best-fit: chọn xe VỪA VẶN nhất)
STEP 2: Chia hết oddCartonItems
```
❌ Phần lẻ vẫn bị xé thành 2 mảnh qua while loop

#### Lần 6 (FINAL V1): Odd cartons không bao giờ bị xé (`6fcd364`)
```
STEP 0: Force-assign priority items (nếu user chỉ định truck type)
STEP 1: Pre-split mọi SKU → fullPalletItems[] + oddCartonItems[]
STEP 2: Chia fullPalletItems (Best-fit descending, nặng nhất trước)
         → Nếu 1 xe không đủ → tách theo đơn vị pallet nguyên
STEP 3: Chia oddCartonItems → MỖI item lẻ chỉ vào ĐÚNG 1 XE
         → Best-fit: xe nhỏ nhất còn đủ chỗ
```
✅ Thuật toán ổn định, được user chấp nhận

### 1.4. Cải tiến UI sau khi thuật toán V1 ổn định

| Commit | Tính năng |
|---|---|
| `53ea46f` | Kết quả chia xe hiển thị inline (gradient header, utilization bar, pallet chips) |
| `833a8cb` | Thêm cột CBM vào Excel và web UI |
| `21e265e` | Dòng Total ở cuối mỗi xe (PCS, Cartons, Weight, Pallets, CBM) |
| `006674a` | Header bảng kết quả có gradient bold |
| `b1dc2d5` | Truck type selector: user có thể force-assign SKU+Batch vào loại xe cụ thể |
| `a002c09` | Bảng preview hiển thị tất cả dòng gốc thay vì tổng hợp |
| `925f35f` | Ẩn các cột không cần thiết (SO, DN, Address...) khỏi preview |
| `f1a10a9` | Thêm cột Type vào tất cả bảng |
| `8758b2b` | Thanh CBM utilization (X/Y = Z%) với progress bar |
| `735c5f0` | Lưu trạng thái vào localStorage, thêm nút Reset |
| `9621628` | Modal xác nhận Reset với animation premium |
| `c1a4b3b` | Đánh dấu logic hiện tại là "Version 1", chuẩn bị slot cho V2 |

---

## PHẦN 2: VERSION 2 — "Volume-Priority Assignment"

### 2.1. Lý do tạo Version 2

V1 hoạt động tốt cho các trường hợp đơn giản (1-2 loại xe, ít SKU). Tuy nhiên có nhược điểm:
- Không giới hạn số xe mà 1 SKU có thể bị chia ra → tăng pick lines tại kho
- Best-fit có thể dẫn đến phân bổ không tối ưu khi mix nhiều loại xe
- Không có cơ chế rebalance sau khi chia xong

### 2.2. Thiết kế Version 2 (`1d2c6e0`)

**Commit đầu tiên:** Implement Logic V2 + thêm UI selector (radio button V1/V2)

**Kiến trúc V2:**

```
B1: Volume-Priority Assignment (multi-pass)
    → Sắp xếp lines theo totalWeight GIẢM DẦN
    → Sắp xếp trucks theo capacity GIẢM DẦN
    → Gán từng line vào xe có NHIỀU CHỖ NHẤT
    → Nếu vượt tải → chỉ lấy full pallets
    → Lặp lại cho đến khi không còn gì để gán

Rebalance:
    → Duyệt xe từ nặng→nhẹ
    → Di chuyển items nhẹ sang xe nhẹ hơn
    → Ưu tiên xe đã có cùng SKU (giảm pick lines)

B2: Xử lý dư (nếu còn)
    → Tách thành full pallets + odd cartons
    → Chia full pallets (best-fit, ưu tiên xe đã có SKU)
    → Chia odd cartons (best-fit, ưu tiên merge)

Ràng buộc: Tối đa 2 xe/SKU (skuTruckMap)
```

### 2.3. Quá trình tinh chỉnh V2

#### Iteration 1: Bản gốc (`1d2c6e0`)
- Logic cơ bản hoạt động nhưng chưa xử lý edge cases
- Ràng buộc max 2 splits/SKU đôi khi quá nghiêm ngặt

#### Iteration 2: No over-stuffing (`d75950f`)
- **Vấn đề:** B1 nhồi quá nhiều vào 1 xe → xe khác trống
- **Sửa:** Khi line vượt capacity → chỉ lấy full pallets, không lấy lẻ
- Thêm rebalance: di chuyển items < 1 pallet sang xe khác

#### Iteration 3: Lightest truck as target (`ae7a9d6`)
- **Rebalance cải tiến:** Ưu tiên xe nhẹ nhất làm target
- Consolidate same-SKU: gộp items cùng SKU khi di chuyển

#### Iteration 4: Best-fit strategy (`a2ee5cf`)
- **Thay đổi chiến lược:** Small lines → small trucks, large lines → large trucks
- Mục tiêu: tận dụng xe 2T thay vì để trống

#### Iteration 5: Revert to large-trucks-first (`aa45e4f`)
- **Vấn đề:** Best-fit khiến xe lớn bị bỏ trống
- **Sửa:** B1 quay lại large-trucks-first
- Aggressive rebalance: duyệt xe nặng nhất trước, di chuyển items nhẹ nhất sang xe nhẹ nhất

#### Iteration 6: Multi-pass B1 (`0bee3c1`)
- **Vấn đề:** B1 single-pass bỏ sót cartons khi 1 xe không đủ chỗ
- **Sửa:** B1 chạy vòng lặp `while(assignedSomething)` — tiếp tục gán cho đến khi không còn gì để gán

#### Iteration 7: Fallback relax constraint (`c8306dc`)
- **Vấn đề:** Ràng buộc max 2 trucks/SKU quá cứng → một số cartons bị mất
- **Sửa:** Khi không còn xe nào đáp ứng ràng buộc → tự động nới lỏng, cho phép gán vào bất kỳ xe nào còn chỗ

#### Iteration 8: Prefer same SKU in B2 (`b898785`)
- **Cải tiến B2:** Khi chia odd cartons, ưu tiên xe đã có cùng SKU
- Merge vào existing item thay vì tạo dòng mới → giảm pick lines

### 2.4. Sửa lỗi Excel corruption (song song với V2)

| Commit | Vấn đề | Giải pháp |
|---|---|---|
| `29f798a` | File Excel bị corrupt khi mở | Bỏ column width override, dùng `veryHidden` thay `hidden` |
| `d6d537f` | `spliceColumns` làm hỏng XML | Bỏ hoàn toàn `spliceColumns`, ghi CBM per-sheet, clone column width an toàn |
| `14a44be` | Tên file output dùng ngày hiện tại | Trích ngày từ tên file OB Request |
| `f41a551` | PO chỉ có 1 xe vẫn thêm `_T1` | Chỉ thêm suffix `_T` khi PO dùng nhiều xe |

### 2.5. Chuyển mặc định sang V2

| Commit | Thay đổi |
|---|---|
| `a9b55ee` | Mặc định radio button chọn V2, server fallback cũng dùng V2 |
| `f66eccc` | Nút Reset force radio về V2 |
| `db30970` | JS force V2 mỗi lần load trang (override browser cache) |

---

## PHẦN 3: SO SÁNH CHI TIẾT 2 VERSIONS

### 3.1. Flow xử lý

#### Version 1:
```
Input → Parse OB + Goods Spec
      → STEP 0: Force-assign priorities (nếu có)
      → STEP 1: Pre-split TẤT CẢ SKU thành fullPallet[] + oddCarton[]
      → STEP 2: Chia fullPallet[] (Best-fit, nặng nhất trước)
      → STEP 3: Chia oddCarton[] (mỗi item vào đúng 1 xe)
      → Output Excel + Summary
```

#### Version 2:
```
Input → Parse OB + Goods Spec
      → STEP 0: Force-assign priorities (nếu có)
      → B1: Volume-Priority (multi-pass, lớn→nhỏ → xe lớn→nhỏ)
      → Rebalance: Di chuyển items nhẹ từ xe nặng sang xe nhẹ
      → B2: Xử lý dư (full pallets → odd cartons, prefer same SKU)
      → Output Excel + Summary
```

### 3.2. Ưu/Nhược điểm

| Tiêu chí | V1 | V2 |
|---|---|---|
| Giữ pallet chẵn | ✅ Rất tốt (tách trước) | ✅ Tốt (full pallets on overflow) |
| Giới hạn split SKU | ❌ Không giới hạn | ✅ Max 2 xe/SKU |
| Cân bằng tải | ⚠️ Phụ thuộc best-fit | ✅ Có rebalance phase |
| Giảm pick lines | ⚠️ Không tối ưu | ✅ Ưu tiên gộp same-SKU |
| Xử lý edge cases | ⚠️ Có thể mất cartons | ✅ Fallback relax constraints |
| Đơn giản/dễ hiểu | ✅ Logic rõ ràng | ⚠️ Phức tạp hơn |

### 3.3. Cấu trúc code trong `truck_allocation.js`

```javascript
// Line 406: if (version === 'v1') {
//   ... ALLOCATION LOGIC V1 (line 406-567)
// } else {
//   ... ALLOCATION LOGIC V2 (line 569-863)
// }
```

Cả 2 version dùng chung:
- `parseGoodsSpec()` — Parse master data
- `preview()` — Preview PO data
- `execute()` — Entry point (nhận param `version`)
- STEP 0 (Force-assign priorities)
- Excel output generation (line 865-1133)

---

## PHẦN 4: TIMELINE PHÁT TRIỂN

```
06/06/2026 09:37  — Bắt đầu: Tạo tab Truck Allocation + logic cơ bản
06/06/2026 09:50  — Thêm bảng preview PO + 3 cấp priority
06/06/2026 09:59  — User phản hồi: thuật toán sai, không ưu tiên pallet chẵn
06/06/2026 10:12  — Fix: chỉ chia 1 xe thay vì 2-3 xe
06/06/2026 10:25  — Yêu cầu: giữ format Excel + cột Pallet → Chuyển sang ExcelJS
06/06/2026 10:47  — Yêu cầu: cấu trúc output giống sheet PHUONG
06/06/2026 11:01  — Viết lại thuật toán: 2-pass (chẵn trước, lẻ sau)
06/06/2026 11:10  — User: 1 SKU chia 3 xe, không cân bằng → Viết lại lần 3
06/06/2026 16:57  — User: vẫn sai → Pre-split tất cả SKU trước khi chia
06/06/2026 17:41  — Best-fit bin packing (xe vừa vặn nhất)
06/06/2026 18:09  — Fix: odd cartons không bao giờ bị xé → V1 HOÀN THÀNH
06/06/2026 18:21  — Cải tiến UI: kết quả inline, gradient, utilization bars
06/06/2026 18:32  — Thêm cột CBM
06/06/2026 18:41  — Dòng Total cuối mỗi xe
           ...     — Nhiều cải tiến UI tiếp theo
06/06/2026        — Tag V1, bắt đầu phát triển V2
06/06/2026        — V2: Volume-Priority + Rebalance + Max 2 splits/SKU
06/06/2026        — V2 qua 8 iterations tinh chỉnh
06/06/2026        — Chuyển mặc định sang V2
06/06/2026        — Fix Excel corruption (nhiều commits)
```

---

## PHẦN 5: BÀI HỌC RÚT RA

1. **Thuật toán bin packing phức tạp hơn tưởng tượng:** 6 lần viết lại V1, 8 iterations V2
2. **Pre-split là chìa khóa:** Tách chẵn/lẻ TRƯỚC KHI chia → tránh xé lẻ pallet
3. **Best-fit vs Most-space:** Best-fit tốt hơn cho giữ pallet chẵn, Most-space tốt hơn cho cân bằng → V2 kết hợp cả hai (Most-space ở B1, Best-fit ở B2)
4. **Ràng buộc cần có fallback:** Max 2 splits/SKU là lý tưởng nhưng cần fallback khi không khả thi
5. **ExcelJS cần cẩn thận:** `spliceColumns` gây corrupt XML, phải viết trực tiếp
6. **Rebalance phase quan trọng:** Phân bổ ban đầu hiếm khi tối ưu, cần bước cân bằng lại
