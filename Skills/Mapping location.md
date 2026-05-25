# Mục đích
Tìm ra những location có thể sử dụng được theo rule và mapping vào file ASN (cột ToLoc).

# Luồng dữ liệu (Cloud - Supabase Storage)
- **Master Location**: Đọc từ Supabase Storage `master-data/Master Location.xlsx` (buffer).
- **Location Non use**: Đọc từ Supabase Storage `master-data/Location Non use.xlsx` (buffer).
- **Inventory**: Đọc từ Supabase Storage `input/inventory/` - file mới nhất user upload (buffer).
- **ASN Output**: Đọc các file ASN đã tạo từ Supabase Storage `output/asn/` để xác định location đã bị blocked (buffer).
- Tất cả dữ liệu được xử lý trong RAM (buffer-based), không đọc/ghi filesystem.

# Rule
1/ Location phải đúng format, nếu sai format thì yêu cầu user thay đổi format.
2/ Phải đảm bảo location được sử dụng đúng theo logic.
3/ Khi location còn lại không đủ để điền vào file ASN thì hãy để trống những location còn lại và báo user biết là thiếu location.
4/ Location phải lấy từ Master Location và có trong danh sách các location có thể sử dụng được (đã được lọc theo rule).
5/ Không được tự ý thêm location mới.

# Công việc
1/ So sánh location ở file Master Location với Location Non use (cả 2 đọc từ Supabase Storage), loại bỏ những location có trong file Location Non use.
2/ So sánh những location còn lại với file Inventory (đọc từ Supabase Storage `input/inventory/`) để loại bỏ những location đang chứa hàng.
3/ Loại bỏ những location đã bị blocked bởi các file ASN đã tạo trước đó (đọc từ Supabase Storage `output/asn/`).
4/ Điền những location phù hợp logic vào cột ToLoc trong file ASN.
5/ Vì đây là rack double deep nên 1 location có thể chứa được 2 pallet, hãy đảm bảo 2 pallet đó có cùng SKU và Batch. Nếu 2 pallet khác SKU hoặc khác Batch thì phải sử dụng location khác nhau.
