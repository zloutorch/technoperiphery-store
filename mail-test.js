const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'technoperiphery@gmail.com',
    pass: 'kuphohwsjgsqagun' // ← пароль приложения без пробелов
  }
});

transporter.sendMail({
  from: '"TechnoPeriphery" <technoperiphery@gmail.com>',
  to: 'diana2005rus64@mail.ru', // или другая почта
  subject: '✅ Тестовое письмо через Gmail',
  html: `<p>Если вы это видите — всё работает 🎉</p>`
})
.then(() => console.log('✅ Письмо отправлено!'))
.catch(err => console.error('❌ Ошибка:', err.message));
