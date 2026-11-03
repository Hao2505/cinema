// Trang chính sách: hiện email liên hệ nếu server có cấu hình CONTACT_EMAIL (điền vào data-email lúc trả trang).
const span = document.getElementById('contact');
const email = (span?.dataset.email || '').trim();
if (span && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email)) {
  const a = document.createElement('a');
  a.href = `mailto:${email}`;
  a.textContent = email;
  span.append(', hoặc email ', a);
}
