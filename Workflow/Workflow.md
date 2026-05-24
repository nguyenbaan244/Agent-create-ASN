# Mục đích
Workflow này được tạo ra để chạy các skill trong folder skills với mục đích điền đầy đủ thông tin vào template ASN
# Công việc
1/ chạy skill Extract PDF
2/ Chạy skill Mapping location
3/ Trường hợp đã chạy skill ở bước 1 nhưng chưa đủ data, chạy tiếp skill bước 2 và quay lại check xem đã có đủ data để chạy tiếp skill bước 1 chưa.
# Rule
1/ Đảm bảo file ASN hoàn toàn chính xác với template ASN
2/ Đảm bảo dữ liệu lấy từ file PDF chính xác so với file PDF gốc
3/ Hỏi lại user khi có gì không chắc chắn
4/ Không tự đoán dữ liệu
5/ Không tự ý thay đổi số lượng, chỉ thay đổi các dữ liệu bắt buộc theo rule
6/ Không tự tạo SKU, phải check và làm theo rule
7/ Hỏi lại user khi không quét được PDF
8/ Đảm bảo các cột trong file mapping được điền đầy đủ trước khi xuất file ASN mới, nếu chưa đủ, phải chờ chạy đầy đủ các skill trước khi xuất file
