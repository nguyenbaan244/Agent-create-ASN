# Mục đích
Phân tích file Inventory để tìm ra những location bị đặt sai (Wrong Location) - tức là location chứa pallet có SKU hoặc Batch khác nhau.

# Luồng dữ liệu (Cloud - Supabase Storage)
- **Input**: File Inventory (.xlsx) đọc từ Supabase Storage `input/inventory/` (buffer). User upload qua giao diện web.
- **Output**: File `Wrong Location.xlsx` được tạo dưới dạng buffer và upload lên Supabase Storage `output/wrong-location/`. User download qua giao diện web.
- Tất cả xử lý trong RAM (buffer-based), không đọc/ghi filesystem.

# Rule
1/ Đọc file Inventory dưới dạng buffer (không đọc từ ổ cứng).
2/ Nhóm các pallet theo cột `Loc` (Location).
3/ Loại bỏ các ID bắt đầu bằng `MIXD` hoặc `POSM` (không tính vào phân tích).
4/ Kiểm tra mỗi location: nếu trong 1 location có nhiều hơn 1 SKU hoặc nhiều hơn 1 Lottable01 (Batch), đánh dấu đó là Wrong Location.
5/ Xuất danh sách các pallet nằm trong Wrong Location ra file Excel `Wrong Location.xlsx` dưới dạng buffer.
6/ Trả về kết quả bao gồm: số lượng wrong location, số lượng pallet bị ảnh hưởng, preview 5 dòng đầu, và buffer file Excel.

# Các cột cần thiết trong file Inventory
- `Loc` - Mã location
- `SKU` - Mã sản phẩm
- `Lottable01` - Batch/Lô hàng
- `ID` - Mã pallet
