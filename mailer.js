const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail', // ✅ Gmail вместо smtp.yandex.ru
  auth: {
    user: 'technoperiphery@gmail.com',
    pass: 'kuphohwsjgsqagun' // ✅ Пароль приложения Gmail без пробелов
  }
});

function sendConfirmationEmail(to, name) {
  return transporter.sendMail({
    from: '"TechnoPeriphery" <technoperiphery@gmail.com>',
    to,
    subject: '✅ Ваш аккаунт подтверждён',
    html: `
      <p>Здравствуйте, <strong>${name}</strong>!</p>
      <p>Ваш аккаунт был успешно подтверждён администратором. Теперь вы можете войти в систему и оформить заказ.</p>
      <p style="color: #00c8ff;">Спасибо, что выбрали ТехноПериферию 💙</p>
    `
  });
}

module.exports = { sendConfirmationEmail };
