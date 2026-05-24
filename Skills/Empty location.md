# Mục đích
Tìm ra các location trống (có thể sử dụng được) để chuẩn bị cho việc nhập hàng và xuất danh sách này ra file Excel.

# Rule
1/ Lấy toàn bộ danh sách location từ file `Master Location.xlsx` (trong thư mục Master Data/Master Location).
2/ Loại bỏ các location không được sử dụng từ file `Location Non use.xlsx` (trong thư mục Master Data/Location - Non use).
3/ Loại bỏ các location đang chứa hàng, được lấy từ file Inventory mới nhất (trong thư mục Input/Inventory).
4/ Loại bỏ các location đã được chỉ định (blocked) bởi các file ASN đã được tạo ra trong thư mục `Output/ASN Output`.
5/ Xuất danh sách các location còn trống ra file Excel tên là `Empty Location.xlsx` lưu vào thư mục `Output/Empty Location`.
