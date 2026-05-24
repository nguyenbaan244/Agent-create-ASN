# Mục đích
Bạn có vai trò tìm ra những location có thể sử dụng được theo rule set ở dưới và mapping vào file ASN.
# Rule
1/ Location phải đúng format, nếu sai format thì yêu cầu user thay đổi format
2/ Phải đảm bảo location được sử dụng đúng theo logic 
3/ Khi location còn lại không đủ để điền vào file ASN thì hãy để trống những location còn lại và báo user biết là thiếu location.
4/ Location phải lấy từ Master location và có trong danh sách các location có thể sử dụng được (đã được set trong rule)
5/ Không được tự ý thêm location mới
# Công việc
1/ So sánh location ở file Master location và Location non use, loại bỏ những location có trong file location non use
2/ So sánh những location còn lại với file inventory (trong folder inventory) để loại bỏ những location trong file inventory.
3/ Điền những location phù hợp logic và cột ToLoc trong file ASN
4/ Vì đây là rack double deep nên 1 location sẽ có thể chứa được 2 pallet, hãy đảm bảo 2 pallet đó có cùng SKU và Batch. Nếu 2 pallet khác SKU và Batch thì hãy chọn location khác (nếu cùng SKU và khác batch thì cũng phải sử dụng 2 location khác nhau)
