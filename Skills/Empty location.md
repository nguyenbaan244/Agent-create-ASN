# Mục đích
Tìm ra các location trống (có thể sử dụng được) để chuẩn bị cho việc nhập hàng và xuất danh sách ra file Excel.

# Luồng dữ liệu (Cloud - Supabase Storage)
- **Master Location**: Đọc từ Supabase Storage `master-data/Master Location.xlsx` (buffer).
- **Location Non use**: Đọc từ Supabase Storage `master-data/Location Non use.xlsx` (buffer).
- **Inventory**: Đọc từ Supabase Storage `input/inventory/` - file mới nhất (buffer).
- **ASN Output**: Đọc các file ASN đã tạo từ Supabase Storage `output/asn/` (buffer) để loại bỏ location đã bị blocked.
- **Output**: File `Empty Location.xlsx` được tạo dưới dạng buffer và upload lên Supabase Storage `output/empty-location/`. User download qua giao diện web.
- Tất cả xử lý trong RAM (buffer-based), không đọc/ghi filesystem.

# Rule
1/ Lấy toàn bộ danh sách location từ file `Master Location.xlsx` (đọc buffer từ Supabase Storage `master-data/`).
2/ Loại bỏ các location không được sử dụng từ file `Location Non use.xlsx` (đọc buffer từ Supabase Storage `master-data/`).
3/ Loại bỏ các location đang chứa hàng, từ file Inventory mới nhất (đọc buffer từ Supabase Storage `input/inventory/`).
4/ Loại bỏ các location đã được chỉ định (blocked) bởi các file ASN đã tạo ra (đọc buffer từ Supabase Storage `output/asn/`).
5/ Xuất danh sách các location còn trống ra file Excel `Empty Location.xlsx` dưới dạng buffer, upload lên Supabase Storage `output/empty-location/`.
