/**
 * HNL QLTC – in-app, read-only user guide.
 * UI names refer to DEV 21420a955 (2026-10-24). The Golden screenshots are
 * reference images, not authorisation to make changes or a claim of Native Golden.
 */
export interface GuideTopic {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  mobileNote?: string;
  caution?: string;
  example?: string;
  desktopImage?: string;
  mobileImage?: string;
}
export interface GuideGroup {
  id: string;
  title: string;
  summary: string;
  desktopEntry: string;
  mobileEntry: string;
  topics: GuideTopic[];
}
const T = (id: string, title: string, summary: string, steps: string[], extra: Partial<GuideTopic> = {}): GuideTopic => ({id,title,summary,steps,...extra});
const image = (name: string) => `/user-guide/${name}.webp`;

export const guideGroups: GuideGroup[] = [
  {
    id:'start',title:'Bắt đầu & điều hướng',summary:'Đăng nhập, dự án, khác biệt giao diện PC và điện thoại.',
    desktopEntry:'Trên PC, sử dụng thanh điều hướng dọc phía trái hoặc tiêu đề của không gian làm việc.',
    mobileEntry:'Trên điện thoại, sử dụng thanh điều hướng dưới màn hình; các mục bổ sung nằm trong «Thêm».',
    topics:[
      T('login','Đăng nhập tài khoản Google','Đăng nhập đúng tài khoản được mời vào dự án.',[
        'Mở Web DEV hoặc ứng dụng HNL QLTC, chọn Đăng nhập bằng Google.',
        'Chọn tài khoản Google đã được ADMIN cấp quyền; hoàn tất xác thực trên trang đăng nhập.',
        'Đợi danh sách dự án và dữ liệu đồng bộ xuất hiện rồi mới thực hiện công việc.',
        'Nếu không thấy dự án, kiểm tra đúng email và nhờ ADMIN xác nhận lời mời; không tự tạo dữ liệu thay thế.'
      ],{desktopImage:image('login-desktop'),mobileImage:image('login-mobile'),example:'Tài khoản mới chưa được cấp quyền vẫn có thể đăng nhập nhưng chưa chắc thấy dự án.'}),
      T('projects','Chọn và chuyển dự án','Tránh ghi báo cáo, ảnh hoặc phiếu kho nhầm dự án.',[
        'Mở danh sách dự án từ khu vực tiêu đề/quản lý dự án.',
        'Kiểm tra tên, khu vực và thành viên của dự án trước khi chọn.',
        'Chuyển dự án và đợi dữ liệu dự án đích tải đủ.',
        'Xác nhận lại tên dự án trước khi thêm Defect, quân số, phiếu hoặc ảnh.'
      ],{caution:'Không nhập dữ liệu vào dự án khác chỉ vì dự án cần dùng chưa hiển thị.'}),
      T('pc-navigation','Điều hướng giao diện PC','Thanh trái, bảng nội dung và cửa sổ chức năng.',[
        'Nhìn thanh điều hướng dọc bên trái, chọn Trang chủ, Mặt bằng, Quân số, Kho hoặc Khối lượng.',
        'Các mục Checklist, Trao đổi, HNL AI (nếu được bật), Cài đặt nằm trong cùng hệ điều hướng.',
        'Trong một mục, dùng tab, bộ lọc, nút Mở/Đóng của đúng bảng chức năng.',
        'Sau khi thao tác trong hộp thoại, bấm Đóng hoặc trở lại; kiểm tra thông báo lưu thành công.'
      ],{desktopImage:image('desktop-modern-pc'),mobileImage:image('mobile'),mobileNote:'Giao diện điện thoại thay thanh trái bằng thanh điều hướng dưới; không cố thu nhỏ PC để tìm nút.'}),
      T('mobile-navigation','Điều hướng trên điện thoại','Thanh dưới, mục Thêm và các cửa sổ dạng tấm.',[
        'Chạm biểu tượng Trang chủ, Mặt bằng, Quân số hoặc Kho ở thanh dưới.',
        'Chạm Thêm để mở Khối lượng, Checklist, Trao đổi, HNL AI hoặc Cài đặt nếu các mục được hiển thị.',
        'Cuộn dọc nội dung; mở từng thẻ/cửa sổ để xem chức năng bên trong.',
        'Sử dụng nút Đóng hoặc thao tác Back của hệ thống để trở về đúng màn hình.'
      ],{mobileImage:image('mobile'),mobileNote:'Không cần bật “Trang web cho máy tính”; nên dùng giao diện di động mặc định.'}),
      T('sync-status','Đọc trạng thái đồng bộ','Phân biệt dữ liệu mới trên máy và dữ liệu đã có trên Cloud.',[
        'Xem biểu tượng/trạng thái kết nối và thông tin đồng bộ hiện trên giao diện.',
        'Nếu đang offline, giữ ứng dụng và dữ liệu cục bộ; không coi dữ liệu là đã xuất hiện ở thiết bị khác.',
        'Khi có mạng, mở Trung tâm đồng bộ trong Cài đặt để đối chiếu trạng thái và hàng đợi.',
        'Đăng nhập thiết bị khác để kiểm tra dữ liệu/ảnh thật sau khi đồng bộ hoàn tất.'
      ],{caution:'Tin nhắn offline và một số hàng đợi vẫn thuộc nhóm cần kiểm toán P1; không đóng ứng dụng ngay khi còn tác vụ chờ.'})
    ]
  },
  {
    id:'home',title:'Trang chủ & thông báo',summary:'Tổng quan tiến độ, nhắc hạn và truy cập nhanh.',
    desktopEntry:'Chọn Trang chủ ở thanh điều hướng trái.',
    mobileEntry:'Chạm Trang chủ tại thanh dưới cùng.',
    topics:[
      T('dashboard','Đọc bảng tổng quan','Nắm tình hình dự án và số liệu cần xử lý.',[
        'Xác nhận đang ở đúng dự án, thời điểm và phạm vi dữ liệu.',
        'Đọc các chỉ số tiến độ, Defect, quân số hoặc kho nếu được hiển thị.',
        'Chạm/bấm vào thẻ tổng quan hoặc lối tắt để mở phân hệ gốc.',
        'Đối chiếu số liệu chi tiết tại phân hệ trước khi dùng cho nghiệm thu hoặc báo cáo.'
      ]),
      T('notifications','Trung tâm thông báo','Theo dõi cập nhật tiến độ, việc cần làm và Defect.',[
        'Mở Trung tâm thông báo từ biểu tượng hoặc khu vực thông báo.',
        'Chọn nhóm/thẻ thông báo và dùng bộ lọc để tìm nội dung liên quan.',
        'Mở mục nguồn để xem thông tin chi tiết, tình trạng và thời hạn.',
        'Sau khi xử lý, quay về kiểm tra thông báo có cập nhật đúng hay không.'
      ],{desktopImage:image('pc-notification-center-live-buttons')}),
      T('deadlines','Cảnh báo công việc đến hạn','Đọc thời hạn và chuyển đến đúng bản ghi.',[
        'Xác định ngày đến hạn, trạng thái và căn/tầng/đội liên quan.',
        'Mở bản ghi gốc để kiểm tra tình trạng thực tế và người phụ trách.',
        'Nếu có quyền, cập nhật tiến độ/ghi chú đúng phạm vi cho phép.',
        'Đối chiếu cảnh báo sau đồng bộ; không chỉ dựa vào số tổng quan.'
      ]),
      T('shortcuts','Truy cập nhanh đúng phân hệ','Đi thẳng đến dữ liệu cần thao tác.',[
        'Từ Trang chủ, chọn lối tắt hoặc mở trực tiếp mục tương ứng ở menu.',
        'Kiểm tra bộ lọc dự án/khu/tầng đã áp dụng trước đó.',
        'Chọn bản ghi cần xem, thao tác hoặc xuất báo cáo.',
        'Dùng quay lại để không đánh mất vị trí đang làm việc.'
      ])
    ]
  },
  {
    id:'floorplan',title:'Mặt bằng, căn & Defect',summary:'Mặt bằng PDF/ảnh, tầng/căn, điểm lỗi, ảnh và nghiệm thu.',
    desktopEntry:'Chọn Mặt bằng trên thanh điều hướng trái.',
    mobileEntry:'Chạm Mặt bằng ở thanh điều hướng dưới.',
    topics:[
      T('floor-list','Chọn khu, tầng và mặt bằng','Đúng tầng và đúng căn trước khi đánh dấu.',[
        'Mở danh sách mặt bằng và chọn đúng Khu/Khối, Tầng.',
        'Kiểm tra tên hoặc mã tầng; với tên tầng giống nhau, dùng đúng nhóm Khu/Khối.',
        'Chọn mặt bằng tương ứng và đợi ảnh/PDF hiển thị rõ.',
        'Xác minh căn/vị trí trực tiếp trên mặt bằng trước khi thao tác.'
      ],{caution:'Không suy luận tầng chỉ từ tên khi nhiều khu cùng có Tầng 1.'}),
      T('floor-upload','Thêm hoặc thay mặt bằng','Quản lý bản vẽ đúng quyền và không mất liên kết.',[
        'Mở phần quản lý mặt bằng của tầng.',
        'Nếu được cấp quyền, chọn chức năng thêm/thay và chọn ảnh/PDF nguồn.',
        'Kiểm tra bản xem trước, hướng xoay và mức độ rõ chữ trước khi lưu.',
        'Sau khi đồng bộ, mở lại trên một thiết bị khác để xác nhận ảnh đã tải thật.'
      ],{caution:'EDITOR/VIEWER không được tự vượt quyền quản lý mặt bằng; không xóa ảnh cũ trước khi bản mới được xác minh.'}),
      T('floor-zoom','Thu phóng và di chuyển bản vẽ','Xem đúng vị trí, tránh đánh dấu lệch.',[
        'Chọn mặt bằng rồi phóng lớn khu vực cần kiểm tra.',
        'Dùng chuột/cuộn hoặc thao tác hai ngón trên điện thoại để phóng/thu phù hợp.',
        'Di chuyển đến đúng căn, quan sát góc và tỷ lệ hiện tại.',
        'Trước khi thêm điểm, kiểm tra lại vị trí của nó sau thao tác zoom.'
      ],{mobileNote:'Trên điện thoại dùng hai ngón để phóng/thu; hạn chế chạm nhầm vào điểm Defect khi đang kéo bản vẽ.'}),
      T('room-create','Quản lý căn hoặc khu vực','Danh sách căn, ID và trạng thái theo tầng.',[
        'Mở danh sách căn của mặt bằng đang chọn.',
        'Tìm căn bằng mã/tên; kiểm tra thuộc đúng khu và tầng.',
        'Nếu được phép, tạo hoặc điều chỉnh căn theo công cụ của giao diện.',
        'Kiểm tra ID liên kết, hạng mục và dữ liệu Defect/Checklist sau khi lưu.'
      ],{caution:'Không xóa hoặc tạo lại căn để sửa tên; điều đó có thể ảnh hưởng liên kết lịch sử.'}),
      T('defect-create','Tạo Defect tại căn','Ghi lỗi, vị trí, người phụ trách và thời hạn.',[
        'Chọn đúng tầng/căn hoặc vị trí trên mặt bằng và mở chức năng thêm Defect.',
        'Nhập nhóm lỗi, nội dung ngắn gọn, tình trạng và thời hạn khi có.',
        'Đính kèm ảnh hiện trạng rõ vị trí; kiểm tra ảnh trước khi lưu.',
        'Lưu bản ghi, kiểm tra có trong danh sách Defect rồi đối chiếu trên thiết bị khác.'
      ],{example:'Ví dụ: Trần thạch cao phòng A-101 – thiếu vít, kèm ảnh chụp rõ khu vực.'}),
      T('defect-update','Cập nhật và nghiệm thu Defect','Giữ lịch sử, ảnh và đúng tiến độ công việc.',[
        'Mở Defect từ danh sách hoặc dấu trên mặt bằng.',
        'Đọc trạng thái hiện có, lịch sử và các ảnh đính kèm.',
        'Chỉnh đúng trường được phân quyền; bổ sung ảnh hoàn thành nếu cần.',
        'Lưu, kiểm tra trạng thái/ngày hạn và xác nhận trên tài khoản khác.'
      ],{caution:'Khi nhiều người cùng sửa, cần kiểm tra giá trị mới nhất; không ghi đè trạng thái vừa được người khác cập nhật.'}),
      T('defect-photo','Ảnh Defect và đồng bộ Cloud','Ảnh phải tải được ở thiết bị khác, không chỉ thấy thumbnail cục bộ.',[
        'Mở Defect, chọn Thêm ảnh từ máy ảnh/thư viện.',
        'Chờ ảnh hoàn tất quá trình tải và lưu metadata liên kết.',
        'Đóng/mở lại Defect, thử ảnh toàn kích thước.',
        'Đăng nhập tài khoản thứ hai trên thiết bị khác để kiểm tra file ảnh thật.'
      ],{caution:'Không xóa ảnh Cloud hoặc bản gốc nếu chưa có kiểm tra tham chiếu, size và checksum.'}),
      T('floor-export','Xuất bản vẽ, Defect và báo cáo','Kiểm tra phạm vi xuất và ảnh kèm theo.',[
        'Mở chức năng xuất báo cáo/đánh dấu trên mặt bằng tương ứng.',
        'Chọn phạm vi tầng/căn, loại báo cáo và điều kiện lọc.',
        'Xem trước bố cục, chú giải và vị trí marker tránh che số phòng.',
        'Xuất PDF/Excel, mở tệp để kiểm tra tên, số liệu và ảnh đã có.'
      ])
    ]
  },
  {
    id:'crew',title:'Quân số & nhật ký thi công',summary:'Ghi nhận nhân lực, ảnh hiện trường, nhật ký và báo cáo.',
    desktopEntry:'Chọn Quân số ở thanh điều hướng trái.',
    mobileEntry:'Chạm Quân số ở thanh dưới.',
    topics:[
      T('crew-daily','Nhập quân số theo ngày','Theo dõi đội, công việc, số người và địa điểm.',[
        'Chọn ngày báo cáo và đúng dự án/khu/tầng.',
        'Chọn đội thi công hoặc nhân sự theo danh mục hiện có.',
        'Điền số lượng, công việc thực tế, ghi chú cần thiết.',
        'Lưu và kiểm tra dòng mới trong bảng quân số/ngày.'
      ],{example:'Ví dụ: Đội trần chìm 8 người thi công tầng 3 khu B.'}),
      T('crew-photos','Gắn ảnh nhật ký hiện trường','Minh chứng thực tế theo đúng bản ghi.',[
        'Mở mục quân số/nhật ký phù hợp.',
        'Chọn ảnh hiện trường, kiểm tra ngày, góc chụp và nội dung.',
        'Lưu và theo dõi đồng bộ đến khi ảnh không còn trong hàng chờ.',
        'Đăng nhập thiết bị khác để thử xem ảnh gốc.'
      ]),
      T('crew-history','Lịch sử nhật ký','Tra lại ngày, tầng và nội dung cũ.',[
        'Mở lịch sử nhật ký thi công và chọn mốc thời gian cần tìm.',
        'Lọc theo tầng/đội, đối chiếu nhật ký với báo cáo thực tế.',
        'Mở bản ghi để xem ảnh và thông tin chi tiết.',
        'Nếu chỉnh sửa bản ghi cũ, kiểm tra quyền và lịch sử thay đổi.'
      ]),
      T('crew-copy','Sao chép nhật ký sang ngày khác','Phân biệt sao chép bổ sung và sao chép đè toàn ngày.',[
        'Chọn ngày nguồn và ngày đích.',
        'Xem kỹ cảnh báo nếu ngày đích đã có dữ liệu.',
        'Đối chiếu số dòng và phạm vi trước khi xác nhận sao chép đè.',
        'Kiểm tra dữ liệu ngày đích sau đồng bộ; phục hồi nếu nhầm.'
      ],{caution:'Cơ chế sao chép đè ngày có thể thay toàn bộ bản ghi ngày đích; tuyệt đối không xác nhận khi chưa kiểm tra.'}),
      T('crew-report','Xuất báo cáo quân số','Kiểm tra số liệu, chia sẻ và xuất file.',[
        'Mở bộ lọc báo cáo Quân số, chọn khoảng ngày và nhóm/tầng.',
        'Xem lại bảng tổng hợp và các hình ảnh minh chứng.',
        'Chọn hình thức xuất/chia sẻ được hỗ trợ.',
        'Mở file xuất kiểm tra định dạng, ngày và tổng số người.'
      ],{desktopImage:image('crew-share-1280x800'),mobileImage:image('crew-share-393x852')})
    ]
  },
  {
    id:'warehouse',title:'Kho vật tư & phiếu',summary:'Danh mục, nhập/xuất, tồn kho, yêu cầu và thùng rác phiếu.',
    desktopEntry:'Chọn Kho ở thanh điều hướng bên trái.',
    mobileEntry:'Chạm Kho ở thanh điều hướng dưới.',
    topics:[
      T('stock-catalog','Danh mục vật tư','Tra mã vật tư, quy cách, đơn vị và nhóm.',[
        'Mở danh mục vật tư trong phân hệ Kho.',
        'Tìm theo tên/mã, kiểm tra đơn vị tính và nhóm vật tư.',
        'Nếu có quyền quản lý, thêm hoặc sửa đúng trường danh mục.',
        'Kiểm tra liên kết của vật tư với phiếu cũ trước khi đổi mã/tên.'
      ],{desktopImage:image('catalog-click-1280x800'),mobileImage:image('catalog-click-393x852')}),
      T('stock-in','Tạo phiếu nhập kho','Nhập vật tư và ghi nhận chứng từ.',[
        'Mở danh sách phiếu, chọn tạo phiếu Nhập.',
        'Chọn ngày, nguồn nhập, vật tư, đơn vị và số lượng.',
        'Kiểm tra số phiếu và dòng vật tư trùng trước khi lưu.',
        'Đợi xác nhận lưu, mở lại phiếu và đối chiếu số dư kho.'
      ],{caution:'Không bấm lưu lặp liên tục khi mạng yếu; kiểm tra danh sách phiếu để tránh nhập trùng.'}),
      T('stock-out','Tạo phiếu xuất kho','Theo dõi vật tư xuất cho đội và công việc.',[
        'Mở phiếu Xuất, chọn ngày và đối tượng nhận.',
        'Chọn vật tư theo mã, nhập khối lượng hoặc số lượng xuất.',
        'Kiểm tra tồn khả dụng, đơn vị và mục đích sử dụng.',
        'Lưu, mở phiếu và đối chiếu ảnh hưởng tồn kho.'
      ],{caution:'Tồn kho đang có rủi ro kiểm toán liên kết phiếu–số dư P1-07; với số liệu quan trọng cần kiểm chứng bằng chứng từ.'}),
      T('stock-balance','Kiểm tra tồn kho & đối chiếu phiếu','Tồn phải khớp nhập – xuất – điều chỉnh hợp lệ.',[
        'Mở báo cáo tồn kho, chọn dự án/kho/nhóm vật tư.',
        'So sánh số dư với các phiếu nhập, xuất đã lưu.',
        'Kiểm tra phiếu bị xóa mềm/khôi phục hoặc chờ đồng bộ.',
        'Nếu lệch, ghi nhận mã vật tư và chứng từ; không sửa thẳng balance bằng cách không kiểm soát.'
      ],{caution:'P1-07: Rules balance chưa chứng nhận bắt buộc ledger đối ứng; không dùng chỉnh số dư trực tiếp để vá lệch.'}),
      T('stock-request','Đơn đặt hàng và nhu cầu vật tư','Lập yêu cầu và theo dõi trạng thái.',[
        'Mở phần yêu cầu/đơn đặt hàng hoặc nhu cầu vật tư.',
        'Chọn nhóm vật tư, khối lượng, đơn vị và dự án/khu tương ứng.',
        'Kiểm tra trạng thái bản nháp, chờ gửi và đã đồng bộ.',
        'Đối chiếu đơn từ tài khoản khác trước khi dùng làm cơ sở mua hàng.'
      ]),
      T('stock-export','Xuất/chia sẻ phiếu kho','Tải Excel/PDF đúng biểu mẫu.',[
        'Mở phiếu hoặc danh sách phiếu và chọn thao tác Xuất/Chia sẻ.',
        'Chọn định dạng PDF, Excel hoặc ảnh nếu màn hình cung cấp.',
        'Kiểm tra các tùy chọn phạm vi, loại phiếu và định dạng số.',
        'Mở tệp đã xuất để kiểm tra số chứng từ, hàng/cột và số liệu.'
      ],{desktopImage:image('voucher-export-1280x800'),mobileImage:image('voucher-export-393x852')}),
      T('stock-restore','Khôi phục phiếu đã xóa','Khôi phục từ thùng rác và kiểm tra tồn.',[
        'Mở phần phiếu đã xóa hoặc Thùng rác của Kho.',
        'Lọc/tìm đúng số phiếu; xem ngày và các dòng vật tư.',
        'Chọn khôi phục khi được phân quyền, kiểm tra thông báo.',
        'Đối chiếu số lượng, trạng thái và tồn kho sau khi khôi phục.'
      ],{caution:'Không xóa vĩnh viễn phiếu để giải quyết số dư chưa khớp; cần bảo toàn chứng từ.'}),
      T('stock-paper','In mẫu phiếu và chứng từ','Xem trước bố cục chứng từ.',[
        'Mở phiếu cần in và xem trước khổ giấy.',
        'Kiểm tra thông tin đơn vị, bảng vật tư, người giao/nhận.',
        'Chọn xuất/in khi các trường quan trọng đã đủ.',
        'So sánh bản in với dữ liệu trong danh sách phiếu.'
      ],{desktopImage:image('voucher-paper-1280x800'),mobileImage:image('voucher-paper-393x852')})
    ]
  },
  {
    id:'volume',title:'Khối lượng & định mức',summary:'Khối lượng công việc, chỉnh nhanh, Excel và vật tư dự tính.',
    desktopEntry:'Chọn Khối lượng trong thanh trái.',
    mobileEntry:'Mở Thêm ở thanh dưới rồi chọn Khối lượng.',
    topics:[
      T('volume-list','Danh sách khối lượng','Theo dõi hạng mục, tầng, đơn vị và giá trị.',[
        'Chọn dự án/khu/tầng và mở danh sách Khối lượng.',
        'Kiểm tra tên hạng mục, nhóm việc, đơn vị đo và số lượng.',
        'Dùng bộ lọc/sắp xếp để so sánh các dòng liên quan.',
        'Đối chiếu báo cáo với dòng nguồn trước khi quyết định khối lượng nghiệm thu.'
      ]),
      T('volume-edit','Thêm/sửa khối lượng công việc','Giữ liên kết ID tầng và hạng mục.',[
        'Mở dòng hoặc chức năng thêm khối lượng.',
        'Chọn hạng mục, tầng/khu và nhập thông số hoặc khối lượng.',
        'Kiểm tra đơn vị, công thức và các liên kết liên quan.',
        'Lưu, mở lại dòng để xác nhận ID tầng không đổi khi chỉ sửa ô khác.'
      ],{caution:'Nếu các khu có tên tầng giống nhau, cần xác nhận đúng Khu/Khối trước khi lưu.'}),
      T('quick-edit','Bảng chỉnh nhanh','Nhập/sửa hàng loạt và lưu an toàn.',[
        'Mở Bảng chỉnh nhanh tại đúng phân hệ, chọn các dòng cần làm việc.',
        'Lọc theo hạng mục, tầng hoặc khóa tìm kiếm.',
        'Chỉnh nội dung, kiểm tra ô đổi màu hoặc cảnh báo trước khi bấm Lưu.',
        'Sau lưu, đối chiếu các dòng được thay đổi, đặc biệt nếu trước đó có lọc/ẩn hàng.'
      ],{caution:'Đang kiểm toán trường hợp chọn dòng A rồi lọc ẩn A nhưng bấm Xóa; tránh xóa nhiều dòng khi bộ lọc thay đổi.'}),
      T('excel-io','Nhập/xuất Excel khối lượng','Kiểm tra định dạng số, tên và ID kỹ thuật.',[
        'Chọn tệp Excel/nguồn nhập đúng biểu mẫu phần mềm.',
        'Xem trước dữ liệu, dấu thập phân, tên tầng và hạng mục.',
        'Chỉ xác nhận sau khi kiểm tra số dòng mới, dòng sửa và xung đột.',
        'Xuất Excel đối chiếu lại số lượng, đơn vị, công thức và bảng nguồn.'
      ]),
      T('norms','Định mức vật tư','Dùng định mức theo hạng mục và phiên bản.',[
        'Mở danh sách Định mức trong Khối lượng hoặc Cài đặt/Quản lý mẫu.',
        'Chọn hạng mục và định mức tương ứng, đối chiếu đơn vị.',
        'Thay đổi định mức khi được phân quyền và hiểu ảnh hưởng vật tư dự tính.',
        'Kiểm tra nhu cầu vật tư cập nhật và các dòng vừa thay đổi.'
      ]),
      T('material-need','Tính nhu cầu vật tư','Từ khối lượng sang nhu cầu mua/cấp vật tư.',[
        'Mở phần tính nhu cầu vật tư từ khối lượng hiện có.',
        'Chọn phạm vi dự án/khu/tầng/hạng mục.',
        'Kiểm tra định mức, hệ số và kết quả tổng hợp.',
        'Xuất hoặc chuyển danh sách nhu cầu sau khi đối chiếu kho và dữ liệu nguồn.'
      ])
    ]
  },
  {
    id:'checklist',title:'Checklist & tiến độ',summary:'Kiểm tra công việc, trạng thái và lịch sử theo tầng/căn.',
    desktopEntry:'Chọn Checklist ở thanh điều hướng trái (nếu tài khoản có mục này).',
    mobileEntry:'Chạm Thêm rồi chọn Checklist (nếu được hiển thị).',
    topics:[
      T('checklist-list','Mở checklist theo tầng/căn','Kiểm đúng vị trí thi công.',[
        'Chọn dự án, tầng và căn cần kiểm tra.',
        'Mở bảng Checklist, xác định hạng mục theo yêu cầu nghiệm thu.',
        'Kiểm tra trạng thái từng dòng và ghi chú hiện trường.',
        'Nếu chưa thấy checklist, kiểm tra quyền và bộ lọc trước khi tạo mới.'
      ]),
      T('checklist-update','Cập nhật trạng thái kiểm tra','Đúng hạng mục, đúng quyền người thực hiện.',[
        'Mở dòng checklist, đọc tiêu chí và trạng thái cũ.',
        'Đối chiếu thực tế rồi đánh dấu trạng thái phù hợp.',
        'Bổ sung ghi chú/ảnh nếu form cung cấp và lưu.',
        'Kiểm tra trạng thái khi mở lại hoặc đồng bộ ở thiết bị khác.'
      ],{caution:'VIEWER không được thay đổi nội dung; không chỉnh dữ liệu hoàn thành thay người không có quyền.'}),
      T('checklist-progress','Tiến độ theo căn và tầng','Đọc tổng hợp theo trạng thái công việc.',[
        'Dùng bộ lọc tầng/căn và nhóm hạng mục.',
        'Đối chiếu số mục hoàn thành, đang làm và chưa làm.',
        'Mở từng mục có vấn đề để xem lý do và thời điểm.',
        'Chỉ dùng số tổng hợp sau khi đồng bộ đủ dữ liệu mới nhất.'
      ]),
      T('checklist-history','Lịch sử và xuất checklist','Truy xuất nguồn ghi nhận.',[
        'Chọn đúng bộ lọc và mở lịch sử/báo cáo nếu giao diện có.',
        'Kiểm tra tên hạng mục, căn, tầng, người cập nhật và ngày.',
        'Chọn loại xuất khi được hỗ trợ.',
        'Đối chiếu bản xuất với danh sách checklist hiện hành.'
      ])
    ]
  },
  {
    id:'chat',title:'Trao đổi & liên hệ',summary:'Tin nhắn, tệp đính kèm, thông báo và hàng đợi offline.',
    desktopEntry:'Chọn Trao đổi ở thanh điều hướng trái.',
    mobileEntry:'Mở Thêm rồi chọn Trao đổi.',
    topics:[
      T('chat-read','Xem hội thoại dự án','Theo dõi tin theo đúng hội thoại và dự án.',[
        'Mở Trao đổi và chọn cuộc trò chuyện cần xem.',
        'Đọc thời gian, người gửi và các tệp đính kèm.',
        'Dùng danh sách hội thoại hoặc tìm kiếm nếu có.',
        'Đối chiếu dữ liệu khi chuyển tài khoản hoặc thiết bị.'
      ],{}),
      T('chat-send','Gửi tin nhắn và ảnh','Theo dõi xác nhận Cloud của tin.',[
        'Chọn đúng cuộc trò chuyện, nhập nội dung.',
        'Gắn ảnh/tệp nếu cần và xem trước trước khi gửi.',
        'Bấm Gửi, đợi trạng thái được lưu hoặc đồng bộ.',
        'Kiểm tra nội dung xuất hiện từ tài khoản nhận trước khi đóng phiên.'
      ],{caution:'Tin offline chưa lưu bền vào outbox có nguy cơ mất khi tải lại trang (P1-02). Nếu đang mất mạng, không coi “đã xếp hàng” là chắc chắn đã gửi.'}),
      T('chat-offline','Tin nhắn khi mất mạng','An toàn với mạng yếu, tránh thất lạc.',[
        'Kiểm tra trạng thái mạng trước khi gửi nội dung quan trọng.',
        'Nếu có cảnh báo chờ, giữ nguyên bản nháp hoặc sao chép nội dung quan trọng bên ngoài.',
        'Khi mạng trở lại, mở hội thoại và kiểm tra tin đã có trên thiết bị khác.',
        'Nếu không thấy tin, ghi nhận thời điểm/tài khoản để hỗ trợ kỹ thuật kiểm tra.'
      ],{caution:'Chức năng này đang được audit an toàn outbox; không hướng dẫn xóa cache, đăng xuất hay reload khi còn tin chưa được xác nhận.'}),
      T('member-contact','Liên hệ thành viên','Gọi/nhắn khi có số điện thoại và được cấp quyền.',[
        'Tìm thành viên từ Trung tâm bảo mật & phân quyền hoặc thẻ liên hệ liên quan.',
        'Mở Liên hệ; chọn thao tác được hiển thị tùy nền tảng.',
        'Xác minh đúng tên/số điện thoại trước khi mở ứng dụng bên ngoài.',
        'Nếu không thấy số, kiểm tra quyền truy cập; không suy luận thông tin cá nhân.'
      ],{caution:'VIEWER không được truy cập thông tin liên hệ riêng tư.'})
    ]
  },
  {
    id:'settings',title:'Cài đặt, dữ liệu & khôi phục',summary:'Thông tin dự án, sao lưu, đồng bộ, Health Center và thùng rác.',
    desktopEntry:'Bấm Cài đặt ở cuối thanh điều hướng bên trái.',
    mobileEntry:'Mở Thêm rồi chọn Cài đặt.',
    topics:[
      T('settings-project','Thông tin dự án','Tên dự án, địa điểm, nhà thầu và người kiểm tra.',[
        'Mở Cài đặt, phần Thông tin dự án.',
        'Xác minh tên dự án, địa điểm, tên nhà thầu và người kiểm tra.',
        'Nếu là ADMIN, chỉnh trường cần thiết và lưu.',
        'Kiểm tra tên hiển thị/báo cáo sau đồng bộ trên thiết bị khác.'
      ],{caution:'EDITOR và VIEWER chỉ xem thông tin dự án; không tự vượt quyền.'}),
      T('settings-sync','Trung tâm đồng bộ & sao lưu','Quan sát tình trạng Cloud và bản sao.',[
        'Mở thẻ Trung tâm đồng bộ & sao lưu trong Cài đặt.',
        'Đọc trạng thái kết nối, số lượng bản ghi/ảnh chờ nếu hiển thị.',
        'Chỉ thực hiện đồng bộ, sao lưu/khôi phục khi đã hiểu nguồn dữ liệu nào là mới nhất.',
        'Kiểm tra kết quả và so sánh trên thiết bị khác, không ghi đè dữ liệu mù.'
      ],{caution:'Sao lưu không thay thế xác minh ảnh thật trên R2 hoặc dữ liệu của tài khoản khác.'}),
      T('settings-health','Health Center – kiểm tra dữ liệu','Phát hiện bất nhất trước khi sửa.',[
        'Mở Cài đặt → Trung tâm kiểm tra dữ liệu (Health Center).',
        'Chạy hoặc xem kết quả kiểm tra theo khả năng giao diện.',
        'Đọc phân loại lỗi/cảnh báo và danh sách bản ghi ảnh hưởng.',
        'Chỉ áp dụng sửa chữa an toàn sau khi xem preview/phạm vi và có bản sao lưu.'
      ],{caution:'Không dùng thao tác repair hàng loạt trên dữ liệu thật chỉ vì bảng báo bất nhất.'}),
      T('settings-diagnostic','Chẩn đoán hệ thống','Lấy thông tin tình trạng phục vụ hỗ trợ kỹ thuật.',[
        'Mở phần nhật ký/chẩn đoán ở Cài đặt nếu có.',
        'Chọn xem kết nối, dữ liệu Cloud và trạng thái đồng bộ.',
        'Chỉ xuất gói log cần thiết, kiểm tra thông tin nhạy cảm trước khi chia sẻ.',
        'Không xóa log/bộ nhớ khi còn việc đang chờ đồng bộ.'
      ]),
      T('settings-templates','Quản lý mẫu','Mẫu đội, hạng mục, định mức, vật tư, thiết bị.',[
        'Mở Cài đặt → Quản lý mẫu.',
        'Chọn đúng loại mẫu muốn chỉnh.',
        'Kiểm tra các bản ghi đang dùng mẫu trước khi đổi tên/nội dung.',
        'Lưu mẫu và thử trên một bản ghi phù hợp; tránh xóa mẫu đang có liên kết.'
      ]),
      T('settings-format','Định dạng số & ngày tháng','Dấu nghìn, dấu thập phân và lịch.',[
        'Mở Cài đặt → Cài đặt định dạng số & ngày tháng.',
        'Chọn kiểu số Việt Nam (1.234,56) hoặc quốc tế (1,234.56).',
        'Chọn kiểu ngày hiển thị phù hợp hồ sơ.',
        'Xem lại phiếu và Excel trước khi xuất để tránh đọc sai số lượng.'
      ]),
      T('settings-images','Chất lượng ảnh & dung lượng','Ảnh mặt bằng, Defect và Quân số có nhu cầu khác nhau.',[
        'Mở Cài đặt → Chất lượng ảnh & dung lượng.',
        'Chọn chất lượng phù hợp riêng cho Mặt bằng, Defect hoặc Quân số.',
        'Kiểm tra ảnh mới tải lên rõ chữ và chi tiết hiện trường.',
        'Đối chiếu dung lượng, thời gian đồng bộ và ảnh thật trên thiết bị khác.'
      ]),
      T('settings-trash','Thùng rác & phục hồi','Khôi phục trước khi xóa vĩnh viễn.',[
        'Mở Cài đặt → Thùng rác.',
        'Lọc đúng bản ghi/phiếu cần khôi phục và kiểm tra thông tin liên quan.',
        'Khôi phục nếu có thể, sau đó xác minh trạng thái nguồn và ảnh.',
        'Chỉ cân nhắc xóa vĩnh viễn sau kiểm toán tham chiếu dữ liệu/ảnh và bản sao lưu.'
      ],{caution:'Không xóa Cloud “mù”; dữ liệu/ảnh có thể còn được bản ghi khác tham chiếu.'})
    ]
  },
  {
    id:'security',title:'Phân quyền & thành viên',summary:'ADMIN/EDITOR/VIEWER, PIN, điện thoại và bảo mật dữ liệu.',
    desktopEntry:'Mở Trung tâm bảo mật & phân quyền từ khu vực quản trị dự án.',
    mobileEntry:'Mở menu quản lý/bảo mật dự án rồi chọn Trung tâm bảo mật & phân quyền nếu tài khoản được phép.',
    topics:[
      T('roles','Hiểu ba vai trò','ADMIN quản lý; EDITOR cập nhật theo quyền; VIEWER chỉ xem.',[
        'Đọc vai trò hiện tại của tài khoản trong Trung tâm bảo mật.',
        'ADMIN quản trị thành viên và các thiết lập được cấp; EDITOR chỉ sửa các nghiệp vụ cho phép.',
        'VIEWER không được thao tác sửa/xóa và không được thấy một số dữ liệu riêng tư.',
        'Nếu thiếu chức năng, kiểm tra vai trò trước; không dùng tài khoản khác để bỏ qua kiểm soát.'
      ],{}),
      T('security-members','Quản lý thành viên dự án','Mời và xác nhận đúng tài khoản.',[
        'Vào danh sách thành viên của đúng dự án.',
        'ADMIN kiểm tra email, tên và vai trò trước khi thêm/mời.',
        'Kiểm tra lời mời được chấp nhận và vai trò sau đồng bộ.',
        'Khi thu hồi quyền, kiểm tra lại truy cập từ phiên đang đăng nhập.'
      ],{caution:'Không nâng quyền tự động khi chưa có xác nhận của ADMIN.'}),
      T('security-phone','Thêm/sửa số điện thoại thành viên','Cùng hàng Liên hệ – Reset PIN – Xóa trên PC Modern.',[
        'ADMIN mở Trung tâm bảo mật & phân quyền, tìm thành viên theo email.',
        'Trên PC Modern, bấm Thêm/Sửa số điện thoại ở ngay bên trái Liên hệ; trên di động nút nằm dưới thẻ thành viên.',
        'Nhập số điện thoại chính xác, lưu bằng trình chỉnh sửa hiện có.',
        'Mở lại để xác nhận; với tài khoản VIEWER, thông tin liên hệ riêng tư không được hiển thị.'
      ],{mobileNote:'Nút sửa số điện thoại ở dưới thẻ trên điện thoại và PC Classic, không nằm cùng hàng PC Modern.',caution:'Chỉ ADMIN có quyền quản lý mới được cập nhật liên hệ.'}),
      T('security-pin','PIN ứng dụng và Reset PIN','Khóa ứng dụng, không thay quyền Cloud.',[
        'Mở phần PIN hoặc thao tác Reset PIN của thành viên theo quyền.',
        'Đọc cảnh báo về hiệu lực của PIN sau khi thiết bị kết nối.',
        'Thực hiện xác nhận theo form và kiểm tra đăng nhập/mở khóa lại.',
        'Không chia sẻ PIN hoặc mã xác thực qua chat, ảnh chụp màn hình.'
      ],{desktopImage:image('pc-security-center-live-buttons')}),
      T('security-delete','Gỡ thành viên khỏi dự án','Bảo vệ quyền và dữ liệu đã có.',[
        'ADMIN xác định đúng email và dự án trước thao tác xóa/gỡ.',
        'Đọc cảnh báo xác nhận, kiểm tra phạm vi quyền bị thu hồi.',
        'Chỉ xác nhận khi đã chắc chắn, sau đó kiểm tra danh sách.',
        'Xác nhận bản ghi lịch sử/ảnh và quyền các thành viên khác không thay đổi.'
      ],{caution:'Gỡ quyền không đồng nghĩa được phép xóa dữ liệu lịch sử hoặc ảnh của thành viên.'})
    ]
  },
  {
    id:'advanced',title:'HNL AI, xuất dữ liệu & an toàn',summary:'Trợ lý AI (nếu được bật), báo cáo tổng hợp và xử lý rủi ro.',
    desktopEntry:'Chọn mục tương ứng trong thanh trái hoặc chức năng Xuất tại phân hệ đang dùng.',
    mobileEntry:'Chọn Thêm → mục tương ứng hoặc thao tác Xuất tại màn hình hiện tại.',
    topics:[
      T('ai-use','Trợ lý HNL AI (nếu được bật)','Hỏi về dữ liệu và kiểm tra nguồn.',[
        'Mở HNL AI nếu menu và tài khoản được cấu hình cho chức năng này.',
        'Nhập câu hỏi nêu rõ dự án, phạm vi tầng và loại số liệu.',
        'Đọc kết quả và các nguồn tham chiếu nếu hiển thị.',
        'Đối chiếu số liệu quan trọng với bảng gốc; không dùng trả lời AI để trực tiếp xóa/sửa dữ liệu.'
      ],{caution:'AI có thể nhầm số liệu hoặc phạm vi; không coi là bằng chứng nghiệm thu độc lập.'}),
      T('reports','Xuất và chia sẻ báo cáo','PDF/Excel phải đúng phạm vi và có thể mở lại.',[
        'Mở chức năng xuất trong đúng phân hệ (Kho, Quân số, Khối lượng, Defect…).',
        'Chọn bộ lọc ngày/khu/tầng, khổ giấy và loại dữ liệu.',
        'Xem trước nội dung, hình ảnh, định dạng số và tên tệp.',
        'Xuất file, mở kiểm tra trên thiết bị đích; chỉ chia sẻ cho người được phép.'
      ]),
      T('offline-reconnect','Làm việc offline và kết nối lại','Không mất ảnh, phiếu và trạng thái chờ.',[
        'Trước khi mất mạng, mở đúng dự án và kiểm tra dữ liệu đang được lưu cục bộ.',
        'Trong offline, theo dõi trạng thái bản ghi/ảnh chờ, hạn chế thay đổi quan trọng đồng thời trên nhiều máy.',
        'Khi kết nối lại, mở màn hình đồng bộ và đợi có xác nhận thành công.',
        'Dùng tài khoản/thiết bị thứ hai đối chiếu bản ghi và tệp ảnh thực tế.'
      ],{caution:'Không xóa cache, đăng xuất hoặc gỡ ứng dụng nếu đang còn hàng đợi chưa xác nhận Cloud.'}),
      T('safe-delete','Xóa vĩnh viễn dữ liệu và ảnh Cloud','Chỉ xóa sau khi chứng minh không còn tham chiếu.',[
        'Xác định đúng bản ghi/phiếu/ảnh, dự án và mốc sao lưu.',
        'Kiểm tra thùng rác, lịch sử khôi phục, chứng từ và các liên kết liên quan.',
        'Với ảnh, cần đối chiếu các tham chiếu đến cùng tệp Cloud, kích thước và checksum khi có.',
        'Không tiến hành purge khi chưa qua gate an toàn và xác nhận dữ liệu không còn được sử dụng.'
      ],{caution:'Xóa vật lý Cloud có thể không phục hồi. P1 Cloud purge/orphan vẫn đang audit, vì vậy đây là hướng dẫn phòng ngừa, không phải nút xóa tự động.'})
    ]
  }
];

export const getGuideTopicCount = () => guideGroups.reduce((count, group) => count + group.topics.length, 0);
